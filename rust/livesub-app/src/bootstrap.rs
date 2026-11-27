use crate::config::{resolve_path, resolve_writable_app_root, AppConfig};
use axum::{
    extract::State,
    http::HeaderValue,
    routing::{get, post},
    Json, Router,
};
use std::{
    io::{BufRead, BufReader},
    path::Path,
    process::{Command, Stdio},
    sync::{Arc, RwLock},
};
use tower_http::{
    cors::{Any, CorsLayer},
    services::ServeDir,
};

#[derive(Clone, Debug)]
struct BootstrapState {
    status: String,
    stage: String,
    message: String,
    step: u8,
    total_steps: u8,
}

impl Default for BootstrapState {
    fn default() -> Self {
        Self {
            status: "downloading".to_string(),
            stage: "checking".to_string(),
            message: "Đang kiểm tra bộ model AI trên máy...".to_string(),
            step: 0,
            total_steps: 4,
        }
    }
}

#[derive(Clone)]
struct BootstrapRouterState {
    progress: Arc<RwLock<BootstrapState>>,
    retry_tx: tokio::sync::mpsc::Sender<()>,
}

fn has_valid_file(rel: &str, min_bytes: u64) -> bool {
    let p = resolve_path(rel);
    match std::fs::metadata(&p) {
        Ok(m) => m.is_file() && m.len() >= min_bytes,
        Err(_) => false,
    }
}

pub fn are_required_models_present() -> bool {
    let whisper_model_ok =
        has_valid_file("models/whisper/ggml-large-v3-turbo-q5_0.bin", 100_000_000)
            || has_valid_file("models/whisper/ggml-small.bin", 50_000_000)
            || has_valid_file("models/whisper/ggml-base.bin", 50_000_000);

    whisper_model_ok
        && has_valid_file("models/whisper/cuda/Release/whisper-server.exe", 100_000)
        && has_valid_file("models/vieneu/vieneu_prefill.onnx", 100_000)
        && has_valid_file("models/vieneu/vieneu_decode_step.onnx", 100_000)
        && has_valid_file("models/vieneu/vieneu_acoustic_cached.onnx", 1_000_000)
        && has_valid_file("models/vieneu/vieneu_backbone_shared.data", 100_000_000)
        && has_valid_file("models/vieneu_heads/text_emb.bin", 100_000)
        && has_valid_file("models/vieneu/sea_g2p.bin", 1_000_000)
        && has_valid_file(
            "models/moss_codec/moss_audio_tokenizer_decode_full.onnx",
            100_000,
        )
        && has_valid_file(
            "models/moss_codec/moss_audio_tokenizer_decode_shared.data",
            1_000_000,
        )
        && has_valid_file("models/ocr/ch_PP-OCRv4_det_infer.onnx", 1_000_000)
}

async fn bootstrap_status_handler(
    State(state): State<BootstrapRouterState>,
) -> Json<serde_json::Value> {
    let s = state.progress.read().map(|g| g.clone()).unwrap_or_default();
    Json(serde_json::json!({
        "status": s.status,
        "stage": s.stage,
        "message": s.message,
        "step": s.step,
        "total_steps": s.total_steps
    }))
}

async fn bootstrap_retry_handler(
    State(state): State<BootstrapRouterState>,
) -> Json<serde_json::Value> {
    let _ = state.retry_tx.try_send(());
    Json(serde_json::json!({ "status": "retrying" }))
}

fn update_progress_from_line(progress: &Arc<RwLock<BootstrapState>>, line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    println!("[setup-models] {trimmed}");
    if let Ok(mut g) = progress.write() {
        g.status = "downloading".to_string();
        if trimmed.contains("[1/4]") {
            g.step = 1;
            g.stage = "whisper".to_string();
            g.message = "Bước 1/4: Đang tải Whisper CUDA GPU (~570 MB)...".to_string();
        } else if trimmed.contains("[2/4]") {
            g.step = 2;
            g.stage = "vieneu".to_string();
            g.message = "Bước 2/4: Đang tải VieNeu-TTS Tiếng Việt (~560 MB)...".to_string();
        } else if trimmed.contains("[3/4]") {
            g.step = 3;
            g.stage = "moss".to_string();
            g.message = "Bước 3/4: Đang tải MOSS Audio Codec (~43 MB)...".to_string();
        } else if trimmed.contains("[4/4]") {
            g.step = 4;
            g.stage = "ocr".to_string();
            g.message = "Bước 4/4: Đang kiểm tra model OCR 6 ngôn ngữ...".to_string();
        } else if let Some(rest) = trimmed.strip_prefix("GET ") {
            g.message = format!("Bước {}/4: Đang tải {}", g.step.max(1), rest.trim());
        } else if let Some(rest) = trimmed.strip_prefix("HEAD ") {
            g.message = format!("Bước {}/4: Đang giải nén {}", g.step.max(1), rest.trim());
        }
    }
}

fn run_setup_models_blocking(
    script_path: &Path,
    target_root: &Path,
    progress: &Arc<RwLock<BootstrapState>>,
) -> Result<(), String> {
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script_path.to_string_lossy(),
        "-TargetRoot",
        &target_root.to_string_lossy(),
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Không khởi chạy được PowerShell tải model: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            update_progress_from_line(progress, &line);
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Lỗi chờ tiến trình tải model: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("setup-models.ps1 thất bại với mã {}", output.status)
        } else {
            err
        });
    }
    Ok(())
}

/// Ensures all required AI models exist on disk before starting the main engine.
/// If any are missing on first launch, runs an embedded status endpoint on `config.bind_addr`
/// while downloading models automatically, then releases the socket for the full server.
pub async fn ensure_models_ready(config: &AppConfig) {
    if are_required_models_present() {
        return;
    }

    println!("📦 First-run setup detected: downloading required AI models automatically...");
    let script_path = resolve_path("rust/setup-models.ps1");
    let target_root = resolve_writable_app_root();

    let progress = Arc::new(RwLock::new(BootstrapState::default()));
    let (retry_tx, mut retry_rx) = tokio::sync::mpsc::channel::<()>(4);
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_static("*"))
        .allow_methods(Any)
        .allow_headers(Any);

    let router_state = BootstrapRouterState {
        progress: progress.clone(),
        retry_tx,
    };

    let app = Router::new()
        .route("/api/pipeline-status", get(bootstrap_status_handler))
        .route("/api/bootstrap-retry", post(bootstrap_retry_handler))
        .fallback_service(ServeDir::new(&config.public_dir))
        .layer(cors)
        .with_state(router_state);

    let listener = tokio::net::TcpListener::bind(config.bind_addr).await.ok();
    let server_handle = listener.map(|l| {
        tokio::spawn(async move {
            let _ = axum::serve(l, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await;
        })
    });

    loop {
        if !script_path.is_file() {
            if let Ok(mut g) = progress.write() {
                g.status = "download_error".to_string();
                g.message = format!(
                    "Không tìm thấy script tải model tại {}",
                    script_path.display()
                );
            }
        } else {
            if let Ok(mut g) = progress.write() {
                g.status = "downloading".to_string();
                g.message = "Đang tải bộ model AI lần đầu (cần kết nối Internet)...".to_string();
            }
            let sp = script_path.clone();
            let tr = target_root.clone();
            let pr = progress.clone();
            let res = tokio::task::spawn_blocking(move || run_setup_models_blocking(&sp, &tr, &pr))
                .await
                .unwrap_or_else(|e| Err(format!("Task lỗi: {e}")));

            match res {
                Ok(()) if are_required_models_present() => {
                    println!(
                        "✅ All first-run AI models downloaded successfully into {}",
                        target_root.display()
                    );
                    break;
                }
                Ok(()) => {
                    if let Ok(mut g) = progress.write() {
                        g.status = "download_error".to_string();
                        g.message =
                            "Tải xong nhưng vẫn thiếu tệp model. Bấm Thử tải lại để kiểm tra."
                                .to_string();
                    }
                }
                Err(err) => {
                    eprintln!("❌ First-run model download failed: {err}");
                    if let Ok(mut g) = progress.write() {
                        g.status = "download_error".to_string();
                        g.message =
                            format!("Không tải được model AI (kiểm tra kết nối mạng): {err}");
                    }
                }
            }
        }

        // Wait until user clicks Retry in loader UI
        if retry_rx.recv().await.is_none() {
            break;
        }
    }

    let _ = shutdown_tx.send(());
    if let Some(h) = server_handle {
        let _ = h.await;
    }
}
