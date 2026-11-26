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
        println!("⚡ Whisper CUDA GPU server is active on http://{}", check_addr);
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
        "🚀 Launching Whisper CUDA GPU Server (Port {}, lang={})...",
        port, default_lang
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
            for _ in 0..60 {
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

pub fn normalize_whisper_language(raw: &str) -> Option<&'static str> {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() || trimmed == "auto" {
        return None;
    }
    let code = match trimmed.split(['-', '_']).next().unwrap_or("") {
        "en" | "english" => "en",
        "vi" | "vietnamese" => "vi",
        "th" | "thai" => "th",
        "ja" | "jp" | "japanese" => "ja",
        "zh" | "cmn" | "chinese" => "zh",
        "ko" | "kor" | "korean" => "ko",
        "fr" | "french" => "fr",
        "de" | "german" => "de",
        "es" | "spanish" => "es",
        "ru" | "russian" => "ru",
        "id" | "indonesian" => "id",
        "ms" | "malay" => "ms",
        "lo" | "lao" => "lo",
        "km" | "khmer" => "km",
        "hi" | "hindi" => "hi",
        "ar" | "arabic" => "ar",
        "pt" | "portuguese" => "pt",
        "it" | "italian" => "it",
        "tr" | "turkish" => "tr",
        "nl" | "dutch" => "nl",
        "pl" | "polish" => "pl",
        "uk" | "ukrainian" => "uk",
        "tl" | "tagalog" => "tl",
        "my" | "burmese" | "myanmar" => "my",
        "ta" | "tamil" => "ta",
        "yue" | "cantonese" => "zh",
        _ => return None,
    };
    Some(code)
}

fn is_whisper_non_speech(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return true;
    }
    let low = t.to_lowercase();
    if matches!(
        low.as_str(),
        "[blank_audio]"
            | "[silence]"
            | "(silence)"
            | "[music]"
            | "(music)"
            | "[applause]"
            | "(applause)"
            | "[laughter]"
            | "(laughter)"
            | "[音楽]"
            | "(音楽)"
            | "♪"
            | "♪♪"
    ) {
        return true;
    }
    (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')'))
}

pub async fn transcribe_gpu_whisper(
    http_client: &reqwest::Client,
    server_url: &str,
    audio_bytes: &[u8],
    source_lang: &str,
) -> Result<WhisperTranscription, String> {
    let part = reqwest::multipart::Part::bytes(audio_bytes.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let normalized = source_lang
        .split(['-', '_'])
        .next()
        .unwrap_or("auto")
        .trim()
        .to_lowercase();
    let lang_arg = if normalized.is_empty() {
        "auto".to_string()
    } else {
        normalized.clone()
    };

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("response_format", "verbose_json")
        .text("temperature", "0.0")
        .text("language", lang_arg);

    // Nếu là tiếng Anh và server Whisper chuyên tiếng Anh (cổng 8090) đang chạy, ưu tiên dùng cổng 8090;
    // mọi ngôn ngữ khác (bao gồm Tiếng Thái 'th', Nhật, Trung, Hàn, auto...) dùng server đa ngôn ngữ cổng 8089.
    let target_server = if normalized == "en" && std::net::TcpStream::connect("127.0.0.1:8090").is_ok() {
        "http://127.0.0.1:8090"
    } else if server_url.contains(":8090") && std::net::TcpStream::connect("127.0.0.1:8090").is_err() {
        "http://127.0.0.1:8089"
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

    let text = json_val
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim();

    if is_whisper_non_speech(text) {
        return Ok(WhisperTranscription {
            text: String::new(),
            detected_lang: None,
        });
    }

    let detected_lang = json_val
        .get("detected_language")
        .or_else(|| json_val.get("language"))
        .and_then(|v| v.as_str())
        .and_then(normalize_whisper_language)
        .map(str::to_string);

    Ok(WhisperTranscription {
        text: text.to_string(),
        detected_lang,
    })
}
