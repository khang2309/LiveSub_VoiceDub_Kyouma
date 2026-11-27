pub mod lang_filter;

pub use lang_filter::{
    detect_script_language, is_whisper_hallucination, is_whisper_promotional_phrase,
    normalize_whisper_language,
};

use lang_filter::pick_best_supported_lang;
use std::{
    path::Path,
    process::{Child, Command},
    time::Duration,
};

pub fn ensure_whisper_cuda_server(
    exe_path: &Path,
    model_path: &Path,
    host: &str,
    port: &str,
    default_lang: &str,
) -> Option<Child> {
    let check_addr = format!("{}:{}", host, port);
    if std::net::TcpStream::connect(&check_addr).is_ok() {
        println!(
            "⚡ Whisper CUDA GPU server is active on http://{}",
            check_addr
        );
        return None;
    }

    if !exe_path.is_file() || !model_path.is_file() {
        eprintln!(
            "⚠️ Whisper CUDA binary or model not found: exe={:?} model={:?}",
            exe_path, model_path
        );
        return None;
    }

    println!(
        "🚀 Launching Whisper CUDA GPU Server (Port {}, model={:?}, lang={})...",
        port,
        model_path.file_name().unwrap_or_default(),
        default_lang
    );
    let mut cmd = Command::new(exe_path);
    if let Some(dir) = exe_path.parent() {
        cmd.current_dir(dir);
    }
    cmd.arg("-m")
        .arg(model_path)
        .arg("--port")
        .arg(port)
        .arg("--host")
        .arg(host)
        .arg("-l")
        .arg(default_lang)
        .arg("-bo")
        .arg("1")
        .arg("-bs")
        .arg("1")
        .arg("-mc")
        .arg("64")
        .arg("-nth")
        .arg("0.65")
        .arg("--suppress-nst")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(child) => {
            for _ in 0..80 {
                std::thread::sleep(Duration::from_millis(150));
                if std::net::TcpStream::connect(&check_addr).is_ok() {
                    println!("✅ Whisper CUDA GPU server ready on port {}", port);
                    break;
                }
            }
            Some(child)
        }
        Err(e) => {
            eprintln!("Failed to spawn Whisper CUDA server: {e}");
            None
        }
    }
}

#[derive(Debug, Clone)]
pub struct WhisperTranscription {
    pub text: String,
    pub detected_lang: Option<String>,
}

fn should_keep_segment(no_speech: f64, avg_logprob: f64, compression_ratio: f64) -> bool {
    let likely_music_or_noise = no_speech > 0.38 && avg_logprob < -0.65;
    no_speech <= 0.58 && avg_logprob >= -0.95 && compression_ratio <= 2.4 && !likely_music_or_noise
}

fn should_keep_text_segment(
    text: &str,
    no_speech: f64,
    avg_logprob: f64,
    compression_ratio: f64,
) -> bool {
    if !should_keep_segment(no_speech, avg_logprob, compression_ratio)
        || is_whisper_hallucination(text)
    {
        return false;
    }
    // Promotional language is not proof of hallucination. Reject it only when
    // the acoustic evidence is also weak; confident spoken promos remain valid.
    let weak_acoustic_evidence = no_speech > 0.18 || avg_logprob < -0.52 || compression_ratio > 1.9;
    !(is_whisper_promotional_phrase(text) && weak_acoustic_evidence)
}

fn wav_duration_seconds(audio_bytes: &[u8]) -> f64 {
    if audio_bytes.len() <= 44 {
        return 0.0;
    }
    // Browser capture emits mono 16 kHz PCM16 WAV: 32,000 bytes/second.
    audio_bytes.len().saturating_sub(44) as f64 / 32_000.0
}

fn transcript_is_implausibly_dense(text: &str, duration_seconds: f64) -> bool {
    if text.trim().is_empty() || duration_seconds <= 0.0 {
        return false;
    }

    let word_count = text.split_whitespace().count();
    let cjk_chars = text
        .chars()
        .filter(|c| matches!(*c as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0x3040..=0x30FF | 0xAC00..=0xD7AF))
        .count();
    let sentence_endings = text
        .chars()
        .filter(|c| matches!(*c, '.' | '!' | '?' | '\u{3002}' | '\u{FF01}' | '\u{FF1F}'))
        .count();

    let max_words = (duration_seconds * 4.5).ceil() as usize + 3;
    let max_cjk_chars = (duration_seconds * 13.0).ceil() as usize + 8;
    let max_sentence_endings = duration_seconds.ceil() as usize + 1;
    word_count > max_words || cjk_chars > max_cjk_chars || sentence_endings > max_sentence_endings
}

pub async fn transcribe_gpu_whisper(
    http_client: &reqwest::Client,
    server_url: &str,
    audio_bytes: &[u8],
    source_lang: &str,
    prompt_context: Option<&str>,
) -> Result<WhisperTranscription, String> {
    let part = reqwest::multipart::Part::bytes(audio_bytes.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let normalized = normalize_whisper_language(source_lang).unwrap_or("auto");
    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("response_format", "verbose_json")
        .text("temperature", "0.0")
        .text("no_speech_thold", "0.65")
        .text("language", normalized.to_string());

    if let Some(ctx) = prompt_context {
        let trimmed_ctx = ctx.trim();
        if !trimmed_ctx.is_empty() {
            let mut tail: String = trimmed_ctx
                .chars()
                .rev()
                .take(280)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            if trimmed_ctx.chars().count() > 280 {
                if let Some(ws_pos) = tail.find(' ') {
                    tail = tail[ws_pos + 1..].to_string();
                }
            }
            if !tail.trim().is_empty() {
                form = form.text("prompt", tail);
            }
        }
    }

    let target_server = if server_url.contains(":8090") {
        let addr_ok = tokio::time::timeout(
            Duration::from_millis(40),
            tokio::net::TcpStream::connect("127.0.0.1:8090"),
        )
        .await
        .map_or(false, |r| r.is_ok());
        if addr_ok {
            "http://127.0.0.1:8090"
        } else {
            "http://127.0.0.1:8089"
        }
    } else {
        server_url
    };

    let inference_endpoint = format!("{}/inference", target_server.trim_end_matches('/'));
    let resp = http_client
        .post(&inference_endpoint)
        .timeout(Duration::from_secs(12))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Whisper GPU CUDA communication error ({inference_endpoint}): {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Whisper GPU CUDA HTTP {status}: {body}"));
    }

    let json_val = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Whisper GPU CUDA invalid JSON response: {e}"))?;

    let filtered_text = if let Some(segments) = json_val.get("segments").and_then(|s| s.as_array())
    {
        let mut parts: Vec<String> = Vec::new();
        for seg in segments {
            let no_speech = seg
                .get("no_speech_prob")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let avg_logprob = seg
                .get("avg_logprob")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let compression_ratio = seg
                .get("compression_ratio")
                .and_then(|v| v.as_f64())
                .unwrap_or(1.0);
            if !should_keep_segment(no_speech, avg_logprob, compression_ratio) {
                continue;
            }
            if let Some(seg_text) = seg.get("text").and_then(|t| t.as_str()) {
                let st = seg_text.trim();
                if !st.is_empty()
                    && should_keep_text_segment(st, no_speech, avg_logprob, compression_ratio)
                {
                    parts.push(st.to_string());
                }
            }
        }
        parts.join(" ")
    } else {
        json_val
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };

    let text = filtered_text.trim();
    let audio_duration = wav_duration_seconds(audio_bytes);
    if is_whisper_hallucination(text) || transcript_is_implausibly_dense(text, audio_duration) {
        return Ok(WhisperTranscription {
            text: String::new(),
            detected_lang: None,
        });
    }

    let detected_lang = detect_script_language(text)
        .map(str::to_string)
        .or_else(|| pick_best_supported_lang(&json_val));

    Ok(WhisperTranscription {
        text: text.to_string(),
        detected_lang,
    })
}

#[cfg(test)]
mod segment_quality_tests {
    use super::{should_keep_segment, should_keep_text_segment, transcript_is_implausibly_dense};

    #[test]
    fn keeps_confident_quiet_dialogue() {
        assert!(should_keep_segment(0.34, -0.62, 1.25));
    }

    #[test]
    fn rejects_music_like_uncertain_segment() {
        assert!(!should_keep_segment(0.44, -0.72, 1.18));
    }

    #[test]
    fn rejects_repetitive_hallucination_shape() {
        assert!(!should_keep_segment(0.08, -0.25, 2.7));
    }

    #[test]
    fn promo_requires_weak_acoustic_evidence_to_be_rejected() {
        let promo = "Hãy subscribe cho kênh Ghiền Mì Gõ để không bỏ lỡ video hấp dẫn";
        assert!(!should_keep_text_segment(promo, 0.31, -0.68, 1.2));
        assert!(should_keep_text_segment(promo, 0.03, -0.22, 1.2));
    }

    #[test]
    fn rejects_many_hallucinated_sentences_from_a_short_clip() {
        let text = "Day la mot cau. Day la cau thu hai. Day la cau thu ba. Day la cau thu bon.";
        assert!(transcript_is_implausibly_dense(text, 1.5));
    }

    #[test]
    fn keeps_a_plausible_short_utterance() {
        assert!(!transcript_is_implausibly_dense("Anh di dau vay?", 1.5));
    }
}
