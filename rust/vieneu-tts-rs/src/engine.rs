use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Mutex;
use ndarray::{Array1, Array2, Array3, Array4};
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
pub const TPS: i64 = 415;
pub const TPE: i64 = 416;
pub const SGS: i64 = 417;
pub const EOS_SPEECH: i64 = 418;
pub const REF_SLOT: i64 = 414;
pub const DEFAULT_STYLE_ID: i64 = 16;
pub const NUM_LAYERS: usize = 12;

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
            .unwrap_or(8)
            / 2)
        .max(1)
        .min(8);

        tracing::info!(
            "Loading VieNeu-TTS models from {:?} with {} threads",
            config.onnx_dir,
            intra_threads
        );

        let prefill_path = config.onnx_dir.join("vieneu_prefill.onnx");
        let decode_path = config.onnx_dir.join("vieneu_decode_step.onnx");
        let acoustic_path = config.onnx_dir.join("vieneu_acoustic_cached.onnx");

        let sess_pre = Session::builder(&env)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap_or_else(|e| e.recover())
            .with_intra_threads(intra_threads)
            .unwrap_or_else(|e| e.recover())
            .commit_from_file(&prefill_path)?;

        let sess_dec = Session::builder(&env)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap_or_else(|e| e.recover())
            .with_intra_threads(intra_threads)
            .unwrap_or_else(|e| e.recover())
            .commit_from_file(&decode_path)?;

        let sess_ac = Session::builder(&env)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap_or_else(|e| e.recover())
            .with_intra_threads(intra_threads)
            .unwrap_or_else(|e| e.recover())
            .commit_from_file(&acoustic_path)?;

        let sess_codec = Session::builder(&env)?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap_or_else(|e| e.recover())
            .with_intra_threads(intra_threads)
            .unwrap_or_else(|e| e.recover())
            .commit_from_file(&config.codec_onnx_path)?;

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

        let mut text_ids = Vec::with_capacity(phone_ids.len() + 3);
        text_ids.push(DEFAULT_STYLE_ID);
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

        let max_expected = (24.0 + (2.0 * phonemes.len() as f32).ceil()) as usize;
        let max_frames = max_expected.min(300);

        let temperature = 0.8f32;
        let top_k = 25usize;
        let top_p = 0.95f32;
        let rep_pen = 1.2f32;

        let mut rng = thread_rng();
        let mut history = RepetitionHistory::new(16, DEFAULT_REP_WINDOW);
        let mut frames: Vec<[i32; 16]> = Vec::with_capacity(max_frames);

        let mut ac_sess = self.sess_ac.lock().unwrap();
        let mut dec_sess = self.sess_dec.lock().unwrap();

        for t in 0..max_frames {
            // Acoustic frame generation
            let mut tok = Array3::<f32>::zeros((1, 2, 768));
            for j in 0..768 {
                tok[[0, 0, j]] = h[j];
                tok[[0, 1, j]] = self.heads.text_emb[[SGS as usize, j]];
            }

            let pos_ids = Array2::<i64>::from_shape_vec((1, 2), vec![0, 1])
                .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;

            let empty_past_k = Array4::<f32>::zeros((1, 8, 0, 96));
            let empty_past_v = Array4::<f32>::zeros((1, 8, 0, 96));

            let ac_inputs = ort::inputs![
                "token_emb" => Tensor::from_array(tok)?,
                "position_ids" => Tensor::from_array(pos_ids)?,
                "past_k_0" => Tensor::from_array(empty_past_k)?,
                "past_v_0" => Tensor::from_array(empty_past_v)?,
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

            // Sample code 0 from slot1
            let mut logits0 = vec![0.0f32; 1024];
            for c in 0..1024 {
                let mut dot = 0.0f32;
                for h_idx in 0..768 {
                    dot += slot1[h_idx] * self.heads.audio_emb[[0, c, h_idx]];
                }
                logits0[c] = dot;
            }

            let code0 = sample(
                &logits0,
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
                let mut emb_ch = Array3::<f32>::zeros((1, 1, 768));
                for h_idx in 0..768 {
                    emb_ch[[0, 0, h_idx]] = self.heads.audio_emb[[ch - 1, prev_code, h_idx]];
                }

                let pos_ch = Array2::<i64>::from_shape_vec((1, 1), vec![ch as i64 + 1])
                    .map_err(|e| VieneuError::InvalidTensor(e.to_string()))?;

                let ch_inputs = ort::inputs![
                    "token_emb" => Tensor::from_array(emb_ch)?,
                    "position_ids" => Tensor::from_array(pos_ch)?,
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

                let mut logits_ch = vec![0.0f32; 1024];
                for c in 0..1024 {
                    let mut dot = 0.0f32;
                    for h_idx in 0..768 {
                        dot += vec_ch[h_idx] * self.heads.audio_emb[[ch, c, h_idx]];
                    }
                    logits_ch[c] = dot;
                }

                let code_ch = sample(
                    &logits_ch,
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

            // Check EOS from slot0
            let mut text_logits = vec![0.0f32; 419];
            for w in 0..419 {
                let mut dot = 0.0f32;
                for h_idx in 0..768 {
                    dot += slot0[h_idx] * self.heads.text_emb[[w, h_idx]];
                }
                text_logits[w] = dot;
            }

            let mut best_text_val = f32::NEG_INFINITY;
            let mut best_text_idx = 0;
            for (idx, &v) in text_logits.iter().enumerate() {
                if v > best_text_val {
                    best_text_val = v;
                    best_text_idx = idx;
                }
            }

            let eos = best_text_idx as i64 == EOS_SPEECH;

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
                    format!("past_k_{}", i).into(),
                    Tensor::from_array(past_k[i].clone())?.into(),
                ));
                dec_inputs.push((
                    format!("past_v_{}", i).into(),
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

        let mono_waveform = {
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
