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
) -> Option<Child> {
    let check_addr = format!("{}:{}", host, port);
    if std::net::TcpStream::connect(&check_addr).is_ok() {
        println!("⚡ Whisper CUDA GPU server is active on http://{}", check_addr);
        return None;
    }

    if !exe_path.is_file() || !model_path.is_file() {
        eprintln!("⚠️ Whisper CUDA binary or model not found");
        return None;
    }

    println!("🚀 Launching Whisper CUDA GPU Server (Port {})...", port);
    let mut cmd = Command::new(exe_path);
    cmd.arg("-m")
        .arg(model_path)
        .arg("--port")
        .arg(port)
        .arg("--host")
        .arg(host)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn()
    {
        Ok(child) => {
            for _ in 0..30 {
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

pub async fn transcribe_gpu_whisper(
    http_client: &reqwest::Client,
    server_url: &str,
    audio_bytes: &[u8],
    source_lang: &str,
) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(audio_bytes.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("response_format", "json")
        .text("temperature", "0.0");

    let normalized = source_lang.split(['-', '_']).next().unwrap_or("auto");
    // Nếu là tiếng Anh và server Whisper chuyên tiếng Anh (cổng 8090) đang chạy, ưu tiên dùng cổng 8090
    let target_server = if normalized == "en" && std::net::TcpStream::connect("127.0.0.1:8090").is_ok() {
        "http://127.0.0.1:8090"
    } else {
        server_url
    };

    if normalized != "auto" && !normalized.is_empty() {
        form = form.text("language", normalized.to_string());
    }

    let inference_endpoint = format!("{}/inference", target_server.trim_end_matches('/'));
    let resp = http_client
        .post(&inference_endpoint)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Whisper GPU CUDA communication error: {e}"))?;

    let json_val = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Whisper GPU CUDA invalid JSON response: {e}"))?;

    let text = json_val
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim();

    if text.is_empty() || text.contains("[BLANK_AUDIO]") || text.contains("[Silence]") {
        Ok(String::new())
    } else {
        Ok(text.to_string())
    }
}
