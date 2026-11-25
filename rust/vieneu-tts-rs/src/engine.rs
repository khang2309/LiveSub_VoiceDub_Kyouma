use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;
use ndarray::{Array1, Array2, Array3, Array4, ArrayView1, Axis};
use ort::ep::{CUDA, DirectML, ExecutionProvider};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;
use rand::thread_rng;
use tokenizers::Tokenizer;

use crate::error::VieneuError;
use crate::heads::VieneuHeads;
use crate::phonemizer::VieneuPhonemizer;
use crate::sampling::{sample, RepetitionHistory, DEFAULT_REP_WINDOW};
use crate::voices::VoiceRegistry;

pub const SAMPLE_RATE: u32 = 48_000;
pub const AUDIO_PAD: i64 = 1024;
pub const TPS: i64 = 3;
pub const TPE: i64 = 4;
pub const SGS: i64 = 5;
pub const EOS_SPEECH: i64 = 6;
pub const REF_SLOT: i64 = 7;
pub const DEFAULT_STYLE_ID: i64 = 16;
pub const NUM_LAYERS: usize = 12;

const PAST_K_NAMES: [&str; 12] = [
    "past_k_0", "past_k_1", "past_k_2", "past_k_3", "past_k_4", "past_k_5",
    "past_k_6", "past_k_7", "past_k_8", "past_k_9", "past_k_10", "past_k_11",
];
const PAST_V_NAMES: [&str; 12] = [
    "past_v_0", "past_v_1", "past_v_2", "past_v_3", "past_v_4", "past_v_5",
    "past_v_6", "past_v_7", "past_v_8", "past_v_9", "past_v_10", "past_v_11",
];

pub struct VieneuEngineConfig {
    pub onnx_dir: PathBuf,
    pub codec_onnx_path: PathBuf,
    pub tokenizer_path: PathBuf,
    pub heads_dir: PathBuf,
    pub dict_path: PathBuf,
}

impl Default for VieneuEngineConfig {
    fn default() -> Self {
        let onnx_dir = PathBuf::from("C:\\dich\\models\\vieneu");
        let codec_path = PathBuf::from("C:\\dich\\models\\moss_codec\\moss_audio_tokenizer_decode_full.onnx");
        let heads_dir = PathBuf::from("C:\\dich\\models\\vieneu_heads");
        let dict_path = PathBuf::from("C:\\dich\\tools\\sea-g2p\\python\\sea_g2p\\sea_g2p.bin");

        Self {
            tokenizer_path: onnx_dir.join("tokenizer.json"),
            onnx_dir,
            codec_onnx_path: codec_path,
            heads_dir,
            dict_path,
        }
    }
}

pub struct VieneuEngine {
    _env: ort::environment::Environment,
    sess_pre: Mutex<Session>,
    sess_dec: Mutex<Session>,
    sess_ac: Mutex<Session>,
    sess_codec: Mutex<Session>,
    tokenizer: Tokenizer,
    heads: VieneuHeads,
    voices: VoiceRegistry,
    phonemizer: VieneuPhonemizer,
}

impl VieneuEngine {
    pub fn new(config: VieneuEngineConfig) -> Result<Self, VieneuError> {
        let env = ort::init()
            .with_name("vieneu-tts")
            .build()?;

        let intra_threads = (std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            / 3)
        .max(2)
        .min(4);

        let ep_name = if CUDA::is_available().unwrap_or(false) {
            "NVIDIA CUDA Hardware GPU"
        } else if DirectML::is_available().unwrap_or(false) {
            "DirectML DirectX 12 Hardware GPU (NVIDIA RTX 3050)"
        } else {
            "CPU High-Performance P-cores"
        };

        tracing::info!(
            "Loading VieNeu-TTS models from {:?} with {} threads ({})",
            config.onnx_dir,
            intra_threads,
            ep_name
        );
        println!("🚀 VieNeu-TTS: Đang kích hoạt tăng tốc phần cứng -> {}", ep_name);

        let prefill_path = config.onnx_dir.join("vieneu_prefill.onnx");
        let decode_path = config.onnx_dir.join("vieneu_decode_step.onnx");
        let acoustic_path = config.onnx_dir.join("vieneu_acoustic_cached.onnx");

        let make_builder = || -> Result<ort::session::builder::SessionBuilder, VieneuError> {
            let mut b = Session::builder(&env)?
                .with_optimization_level(GraphOptimizationLevel::Level3)
                .unwrap_or_else(|e| e.recover())
                .with_intra_threads(intra_threads)
                .unwrap_or_else(|e| e.recover());

            if CUDA::is_available().unwrap_or(false) {
                b = b.with_execution_providers([CUDA::default().build()])
                    .unwrap_or_else(|e| e.recover());
            } else if DirectML::is_available().unwrap_or(false) {
                b = b.with_execution_providers([DirectML::default().build()])
                    .unwrap_or_else(|e| e.recover());
            }

            Ok(b)
        };

        let sess_pre = make_builder()?.commit_from_file(&prefill_path)?;
        let sess_dec = make_builder()?.commit_from_file(&decode_path)?;
        let sess_ac = make_builder()?.commit_from_file(&acoustic_path)?;
        let sess_codec = make_builder()?.commit_from_file(&config.codec_onnx_path)?;

        let tokenizer = Tokenizer::from_file(&config.tokenizer_path)
            .map_err(|e| VieneuError::Tokenizer(e.to_string()))?;

        let heads = VieneuHeads::load_from_dir(&config.heads_dir)?;
        let voices = VoiceRegistry::from_embedded()?;
        let phonemizer = VieneuPhonemizer::new(&config.dict_path)?;

        Ok(Self {
            _env: env,
            sess_pre: Mutex::new(sess_pre),
            sess_dec: Mutex::new(sess_dec),
            sess_ac: Mutex::new(sess_ac),
            sess_codec: Mutex::new(sess_codec),
            tokenizer,
            heads,
            voices,
            phonemizer,
        })
    }

    pub fn list_voices(&self) -> Vec<String> {
        self.voices.list_voices()
    }

    pub fn default_voice(&self) -> &str {
        &self.voices.default_voice
    }

    pub fn infer(&self, text: &str, voice_query: &str) -> Result<Vec<u8>, VieneuError> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(Vec::new());
        }

        let (voice_name, preset) = self.voices.get_voice(voice_query).ok_or_else(|| {
            VieneuError::VoiceNotFound(voice_query.to_string())
        })?;

        tracing::info!("Synthesizing with VieNeu-TTS voice '{}' for: {}", voice_name, text);

        let phonemes = self.phonemizer.phonemize(text);
        if phonemes.trim().is_empty() {
            return Ok(Vec::new());
        }

        let encoding = self
            .tokenizer
            .encode(phonemes.as_str(), false)
            .map_err(|e| VieneuError::Tokenizer(e.to_string()))?;
        let phone_ids = encoding.get_ids();

        let style_id = match preset.style.as_deref() {
            Some("tin_tuc") => 17,
            Some("doc_truyen") => 18,
            _ => DEFAULT_STYLE_ID,
        };

        let mut text_ids = Vec::with_capacity(phone_ids.len() + 3);
        text_ids.push(style_id);
        text_ids.push(TPS);
        for &pid in phone_ids {
            text_ids.push(pid as i64);
        }
        text_ids.push(TPE);

        let ref_codes = &preset.codes;
        let t_text = text_ids.len();
        let t_ref = ref_codes.len();
        let t_prompt = t_text + t_ref;

        let mut rows = Array2::<i64>::from_elem((t_prompt, 17), AUDIO_PAD);
        for t in 0..t_text {
            rows[[t, 0]] = text_ids[t];
        }
        for r in 0..t_ref {
            let row_idx = t_text + r;
            rows[[row_idx, 0]] = REF_SLOT;
            for ch in 0..16 {
                rows[[row_idx, ch + 1]] = ref_codes[r][ch];
            }
        }

        let anchor = self.heads.speaker_anchor(&preset.speaker_emb)?;
        let prompt_embeds = self.heads.embed_rows(&rows, Some(&anchor));

        // Run prefill session
        let (mut h, mut past_k, mut past_v) = {
            let mut pre_sess = self.sess_pre.lock().unwrap();
            let prompt_inputs = ort::inputs![
                "inputs_embeds" => Tensor::from_array(prompt_embeds)?,
            ];
            let outputs = pre_sess.run(prompt_inputs)?;

            let (_, hidden_slice) = outputs[0].try_extract_tensor::<f32>()?;
            let offset = (t_prompt - 1) * 768;
            let last_h = hidden_slice[offset..offset + 768].to_vec();

            let mut pk = Vec::with_capacity(NUM_LAYERS);
            let mut pv = Vec::with_capacity(NUM_LAYERS);
            for i in 0..NUM_LAYERS {
                let (shape, data) = outputs[1 + i].try_extract_tensor::<f32>()?;
                let dims = shape.as_ref();
                let arr = Array4::from_shape_vec(
                    (dims[0] as usize, dims[1] as usize, dims[2] as usize, dims[3] as usize),
                    data.to_vec(),
                )
                .map_err(|e| VieneuError::InvalidTensor(format!("past_k_{}: {}", i, e)))?;
                pk.push(arr);
            }
            for i in 0..NUM_LAYERS {
                let (shape, data) = outputs[1 + NUM_LAYERS + i].try_extract_tensor::<f32>()?;
                let dims = shape.as_ref();
                let arr = Array4::from_shape_vec(
                    (dims[0] as usize, dims[1] as usize, dims[2] as usize, dims[3] as usize),
                    data.to_vec(),
                )
                .map_err(|e| VieneuError::InvalidTensor(format!("past_v_{}: {}", i, e)))?;
                pv.push(arr);
            }
            (last_h, pk, pv)
        };

        let max_expected = (3.0 + (1.15 * phone_ids.len() as f32).ceil()).max(6.0).min(180.0) as usize;
        let max_frames = max_expected;

        let temperature = 0.8f32;
        let top_k = 25usize;
        let top_p = 0.95f32;
        let rep_pen = 1.2f32;

        let mut rng = thread_rng();
        let mut history = RepetitionHistory::new(16, DEFAULT_REP_WINDOW);
        let mut frames: Vec<[i32; 16]> = Vec::with_capacity(max_frames);

        let mut ac_sess = self.sess_ac.lock().unwrap();
        let mut dec_sess = self.sess_dec.lock().unwrap();

        let empty_past_k = Array4::<f32>::zeros((1, 8, 0, 96));
        let empty_past_v = Array4::<f32>::zeros((1, 8, 0, 96));

        // Precompute channel position IDs and allocate channel embedding buffer once
        let pos_ch_list: Vec<Array2<i64>> = (1..16)
            .map(|ch| Array2::from_shape_vec((1, 1), vec![ch as i64 + 1]).unwrap())
            .collect();
        let mut emb_ch = Array3::<f32>::zeros((1, 1, 768));

        let min_speech_frames = ((phone_ids.len() as f32) * 0.70).floor().max(3.0) as usize;

        for t in 0..max_frames {
            // Acoustic frame generation
            let mut tok = Array3::<f32>::zeros((1, 2, 768));
            for j in 0..768 {
                tok[[0, 0, j]] = h[j];
                tok[[0, 1, j]] = self.heads.text_emb[[SGS as usize, j]];
            }

            let pos_ids = Array2::<i64>::from_shape_vec((1, 2), vec![0, 1])
                .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;

            let ac_inputs = ort::inputs![
                "token_emb" => Tensor::from_array(tok)?,
                "position_ids" => Tensor::from_array(pos_ids)?,
                "past_k_0" => Tensor::from_array(empty_past_k.clone())?,
                "past_v_0" => Tensor::from_array(empty_past_v.clone())?,
            ];

            let (slot0, slot1, mut pk_ac, mut pv_ac) = {
                let ac_out = ac_sess.run(ac_inputs)?;
                let (_, hidden_data) = ac_out[0].try_extract_tensor::<f32>()?;
                let slot0 = hidden_data[0..768].to_vec();
                let slot1 = hidden_data[768..1536].to_vec();

                let (s1, d1) = ac_out[1].try_extract_tensor::<f32>()?;
                let dims1 = s1.as_ref();
                let pk = Array4::from_shape_vec(
                    (dims1[0] as usize, dims1[1] as usize, dims1[2] as usize, dims1[3] as usize),
                    d1.to_vec(),
                )
                .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;

                let (s2, d2) = ac_out[2].try_extract_tensor::<f32>()?;
                let dims2 = s2.as_ref();
                let pv = Array4::from_shape_vec(
                    (dims2[0] as usize, dims2[1] as usize, dims2[2] as usize, dims2[3] as usize),
                    d2.to_vec(),
                )
                .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;

                (slot0, slot1, pk, pv)
            };

            // Sample code 0 from slot1 (vectorized dot product)
            let slot1_arr = ArrayView1::from(&slot1);
            let emb0 = self.heads.audio_emb.index_axis(Axis(0), 0);
            let logits0_arr = emb0.dot(&slot1_arr);
            let logits0 = logits0_arr.as_slice().unwrap();

            let code0 = sample(
                logits0,
                temperature,
                top_k,
                top_p,
                rep_pen,
                history.get_channel(0),
                &mut rng,
            );
            history.add(0, code0);

            let mut current_codes = [0i64; 16];
            current_codes[0] = code0;

            // Generate channels 1..15
            for ch in 1..16 {
                let prev_code = current_codes[ch - 1] as usize;
                for h_idx in 0..768 {
                    emb_ch[[0, 0, h_idx]] = self.heads.audio_emb[[ch - 1, prev_code, h_idx]];
                }

                let pos_ch = &pos_ch_list[ch - 1];

                let ch_inputs = ort::inputs![
                    "token_emb" => Tensor::from_array(emb_ch.clone())?,
                    "position_ids" => Tensor::from_array(pos_ch.clone())?,
                    "past_k_0" => Tensor::from_array(pk_ac)?,
                    "past_v_0" => Tensor::from_array(pv_ac)?,
                ];

                let (vec_ch, next_pk, next_pv) = {
                    let out_ch = ac_sess.run(ch_inputs)?;
                    let (_, h_ch_data) = out_ch[0].try_extract_tensor::<f32>()?;
                    let vec_ch = h_ch_data[0..768].to_vec();

                    let (s1, d1) = out_ch[1].try_extract_tensor::<f32>()?;
                    let dims1 = s1.as_ref();
                    let pk = Array4::from_shape_vec(
                        (dims1[0] as usize, dims1[1] as usize, dims1[2] as usize, dims1[3] as usize),
                        d1.to_vec(),
                    )
                    .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;

                    let (s2, d2) = out_ch[2].try_extract_tensor::<f32>()?;
                    let dims2 = s2.as_ref();
                    let pv = Array4::from_shape_vec(
                        (dims2[0] as usize, dims2[1] as usize, dims2[2] as usize, dims2[3] as usize),
                        d2.to_vec(),
                    )
                    .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;

                    (vec_ch, pk, pv)
                };

                pk_ac = next_pk;
                pv_ac = next_pv;

                // Vectorized channel projection
                let vec_ch_arr = ArrayView1::from(&vec_ch);
                let emb_ch_view = self.heads.audio_emb.index_axis(Axis(0), ch);
                let logits_ch_arr = emb_ch_view.dot(&vec_ch_arr);
                let logits_ch = logits_ch_arr.as_slice().unwrap();

                let code_ch = sample(
                    logits_ch,
                    temperature,
                    top_k,
                    top_p,
                    rep_pen,
                    history.get_channel(ch),
                    &mut rng,
                );
                history.add(ch, code_ch);
                current_codes[ch] = code_ch;
            }

            // Check EOS from slot0 (vectorized dot product)
            let slot0_arr = ArrayView1::from(&slot0);
            let text_logits_arr = self.heads.text_emb.dot(&slot0_arr);
            let text_logits = text_logits_arr.as_slice().unwrap();

            let mut best_text_val = f32::NEG_INFINITY;
            let mut best_text_idx = 0;
            for (idx, &v) in text_logits.iter().enumerate() {
                if v > best_text_val {
                    best_text_val = v;
                    best_text_idx = idx;
                }
            }

            let eos = best_text_idx as i64 == EOS_SPEECH
                || (t >= min_speech_frames && text_logits[EOS_SPEECH as usize] >= best_text_val - 1.35);

            let mut frame_i32 = [0i32; 16];
            for k in 0..16 {
                frame_i32[k] = current_codes[k] as i32;
            }
            frames.push(frame_i32);

            if eos {
                break;
            }

            // Next step in decode backbone
            let mut slot_rows = Array2::<i64>::from_elem((1, 17), AUDIO_PAD);
            slot_rows[[0, 0]] = SGS;
            for k in 0..16 {
                slot_rows[[0, k + 1]] = current_codes[k];
            }
            let se = self.heads.embed_rows(&slot_rows, Some(&anchor));

            let pos_dec = Array2::<i64>::from_shape_vec((1, 1), vec![(t_prompt + t) as i64])
                .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;

            let mut dec_inputs = ort::inputs![
                "inputs_embeds" => Tensor::from_array(se)?,
                "position_ids" => Tensor::from_array(pos_dec)?,
            ];
            for i in 0..NUM_LAYERS {
                dec_inputs.push((
                    PAST_K_NAMES[i].into(),
                    Tensor::from_array(past_k[i].clone())?.into(),
                ));
                dec_inputs.push((
                    PAST_V_NAMES[i].into(),
                    Tensor::from_array(past_v[i].clone())?.into(),
                ));
            }

            let dec_out = dec_sess.run(dec_inputs)?;
            let (_, h_dec_data) = dec_out[0].try_extract_tensor::<f32>()?;
            h = h_dec_data[0..768].to_vec();

            for i in 0..NUM_LAYERS {
                let (s, d) = dec_out[1 + i].try_extract_tensor::<f32>()?;
                let dims = s.as_ref();
                past_k[i] = Array4::from_shape_vec(
                    (dims[0] as usize, dims[1] as usize, dims[2] as usize, dims[3] as usize),
                    d.to_vec(),
                )
                .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;
            }
            for i in 0..NUM_LAYERS {
                let (s, d) = dec_out[1 + NUM_LAYERS + i].try_extract_tensor::<f32>()?;
                let dims = s.as_ref();
                past_v[i] = Array4::from_shape_vec(
                    (dims[0] as usize, dims[1] as usize, dims[2] as usize, dims[3] as usize),
                    d.to_vec(),
                )
                .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;
            }
        }

        if frames.is_empty() {
            return Err(VieneuError::EmptyAudio);
        }

        drop(ac_sess);
        drop(dec_sess);

        // MOSS Codec Decode
        let n_frames = frames.len();
        let mut codes_arr = Array3::<i32>::zeros((1, n_frames, 16));
        for (i, frame) in frames.iter().enumerate() {
            for ch in 0..16 {
                codes_arr[[0, i, ch]] = frame[ch];
            }
        }
        let lengths = Array1::<i32>::from_shape_vec(1, vec![n_frames as i32])
            .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;

        let mut mono_waveform = {
            let mut codec = self.sess_codec.lock().unwrap();
            let codec_inputs = ort::inputs![
                "audio_codes" => Tensor::from_array(codes_arr)?,
                "audio_code_lengths" => Tensor::from_array(lengths)?,
            ];
            let out = codec.run(codec_inputs)?;
            let (shape, wav_data) = out[0].try_extract_tensor::<f32>()?;
            let dims = shape.as_ref();
            let n_samples = dims[2] as usize;
            let mut mono = Vec::with_capacity(n_samples);
            let ch0 = &wav_data[0..n_samples];
            let ch1 = &wav_data[n_samples..2 * n_samples];
            for s in 0..n_samples {
                mono.push((ch0[s] + ch1[s]) * 0.5);
            }
            mono
        };

        // Smooth cosine micro-fade at boundaries (fade-in ~10ms, fade-out ~15ms)
        // to completely eliminate neural codec DC offset discontinuities / click-pop artifacts.
        if mono_waveform.len() > 64 {
            let fade_in_samples = (SAMPLE_RATE as usize * 10 / 1000).min(mono_waveform.len() / 4);
            for i in 0..fade_in_samples {
                let factor = 0.5 * (1.0 - (std::f32::consts::PI * i as f32 / fade_in_samples as f32).cos());
                mono_waveform[i] *= factor;
            }
            let fade_out_samples = (SAMPLE_RATE as usize * 15 / 1000).min(mono_waveform.len() / 4);
            let len = mono_waveform.len();
            for i in 0..fade_out_samples {
                let factor = 0.5 * (1.0 - (std::f32::consts::PI * i as f32 / fade_out_samples as f32).cos());
                mono_waveform[len - 1 - i] *= factor;
            }
        }

        let mut cursor = Cursor::new(Vec::new());
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        for &s in &mono_waveform {
            let clamped = (s.max(-1.0).min(1.0) * 32767.0) as i16;
            writer.write_sample(clamped)?;
        }
        writer.finalize()?;

        Ok(cursor.into_inner())
    }
}
