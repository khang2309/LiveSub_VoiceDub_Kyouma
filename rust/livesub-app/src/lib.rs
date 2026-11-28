pub mod bootstrap;
pub mod config;
pub mod routes;
pub mod services;
pub mod state;

use config::{resolve_path, AppConfig};
use ocr_engine_rs::OcrEngine as DiacriticEngine;
use state::AppState;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, RwLock},
    time::Duration,
};
use translation_router_rs::TranslationRouter;
use vieneu_tts_rs::{VieneuEngine, VieneuEngineConfig};

pub static OVERLAY_CHANNEL: OnceLock<tokio::sync::broadcast::Sender<bool>> = OnceLock::new();

pub fn get_overlay_sender() -> tokio::sync::broadcast::Sender<bool> {
    OVERLAY_CHANNEL
        .get_or_init(|| {
            let (tx, _rx) = tokio::sync::broadcast::channel(16);
            tx
        })
        .clone()
}

fn load_env_map() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let env_path = resolve_path(".env");
    if let Ok(content) = std::fs::read_to_string(env_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = trimmed.split_once('=') {
                let key = k.trim().to_string();
                let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
                if !key.is_empty() && !val.is_empty() {
                    map.insert(key, val);
                }
            }
        }
    }
    for key in [
        "GEMINI_API_KEY",
        "GEMINI_TRANSLATION_MODEL",
        "TRANSLATION_MODE",
    ] {
        if let Ok(val) = std::env::var(key) {
            if !val.trim().is_empty() {
                map.insert(key.to_string(), val.trim().to_string());
            }
        }
    }
    map
}

pub async fn run_server(mut config: AppConfig) {
    bootstrap::ensure_models_ready(&config).await;
    let bind_addr = config.bind_addr;
    config = AppConfig::default();
    config.bind_addr = bind_addr;

    let whisper_model_name = config
        .whisper_model_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("ggml-base.bin")
        .to_string();
    let use_dedicated_en_server =
        whisper_model_name.contains("base") || whisper_model_name.contains("tiny");

    println!("============================================================");
    println!("🚀 LiveSub Standalone Pure Rust Realtime Video Dubbing Engine");
    println!("   Architecture: 100% Native Rust | Zero Python | Port 3000");
    println!("   Languages: VI, JA, EN, ZH, KO, TH (6 Languages Focused)");
    println!("   ASR Model: {} (CUDA GPU)", whisper_model_name);
    println!("   OCR Engine: VietOCR + PP-OCR Dedicated (VI/EN/ZH/JA/KO/TH)");
    println!("   TTS Engine: VieNeu-TTS v3 Turbo Pure Rust ONNX (25 Authentic Voices)");
    println!("============================================================");

    let env_map = load_env_map();
    let gemini_api_key = env_map.get("GEMINI_API_KEY").cloned();
    let gemini_model = env_map
        .get("GEMINI_TRANSLATION_MODEL")
        .cloned()
        .unwrap_or_else(|| "gemini-2.5-flash-lite".to_string());
    let translation_mode = env_map
        .get("TRANSLATION_MODE")
        .cloned()
        .unwrap_or_else(|| "fastest".to_string());

    let ocr = Arc::new(DiacriticEngine::new());
    let ocr_pool = services::ocr::load_all_ocr_models(&config);
    let ppocr = ocr_pool.vietnamese.clone();

    println!("🧠 Initializing VieNeu-TTS v3 Turbo pure Rust native inference engine...");
    let vieneu = Arc::new(
        VieneuEngine::new(VieneuEngineConfig::default())
            .expect("Failed to initialize VieNeu-TTS pure Rust engine"),
    );
    println!("✅ VieNeu-TTS initialized successfully with 25 authentic voices (100% offline).");

    let (key_tx, _key_rx) = tokio::sync::broadcast::channel::<String>(32);

    let whisper_child_handle = Arc::new(Mutex::new(None));
    let whisper_en_child_handle = Arc::new(Mutex::new(None));
    let router = Arc::new(TranslationRouter::new());
    let http_client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(4))
        .connect_timeout(Duration::from_secs(2))
        .tcp_nodelay(true)
        .pool_idle_timeout(Duration::from_secs(60))
        .pool_max_idle_per_host(16)
        .build()
        .expect("Failed to initialize HTTP client");

    let state = AppState {
        ocr,
        ppocr,
        ocr_pool,
        vieneu,
        whisper_server_url: config.whisper_url.clone(),
        whisper_en_server_url: if use_dedicated_en_server {
            config.whisper_en_url.clone()
        } else {
            config.whisper_url.clone()
        },
        whisper_model_name,
        router,
        http_client: http_client.clone(),
        gemini_api_key,
        gemini_model,
        translation_mode,
        audio_cache: Arc::new(RwLock::new(HashMap::with_capacity(1024))),
        trans_cache: Arc::new(RwLock::new(HashMap::with_capacity(2048))),
        key_tx,
        _whisper_child: whisper_child_handle.clone(),
        _whisper_en_child: whisper_en_child_handle.clone(),
        // Measured on RTX 3050 4 GB: two concurrent VieNeu requests improve
        // four-line throughput ~34%; three/four only worsen tail latency.
        tts_sem: Arc::new(tokio::sync::Semaphore::new(2)),
        tts_generation: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        tts_stream_requests: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        tts_last_first_chunk_us: Arc::new(std::sync::atomic::AtomicU64::new(0)),
    };

    let ocr_warmup = state.ocr_pool.vietnamese.clone();
    let app = routes::build_router(state, &config.public_dir);

    println!(
        "⚡ LiveSub Pure Rust Web Server listening on http://{}",
        config.bind_addr
    );

    if std::net::TcpStream::connect(config.bind_addr).is_ok() {
        println!(
            "⚡ Port {} is already active. Reusing existing LiveSub backend engine.",
            config.bind_addr
        );
        return;
    }

    let listener = match tokio::net::TcpListener::bind(config.bind_addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "⚠️ Cannot bind {}: {e}. Checking if already listening...",
                config.bind_addr
            );
            if std::net::TcpStream::connect(config.bind_addr).is_ok() {
                println!(
                    "⚡ LiveSub backend is already active on {}. Reusing existing instance.",
                    config.bind_addr
                );
                return;
            }
            eprintln!("❌ Port {} is blocked. Server aborted.", config.bind_addr);
            return;
        }
    };

    // Launch Whisper CUDA GPU server(s) in background
    let whisper_bin = config.whisper_bin_path.clone();
    let whisper_multi_model = config.whisper_model_path.clone();
    let whisper_en_model = config.whisper_en_model_path.clone();
    let w_multi_slot = whisper_child_handle.clone();
    let w_en_slot = whisper_en_child_handle.clone();
    tokio::task::spawn_blocking(move || {
        let multi_bin = whisper_bin.clone();
        let multi_handle = std::thread::spawn(move || {
            services::whisper::ensure_whisper_cuda_server(
                &multi_bin,
                &whisper_multi_model,
                "127.0.0.1",
                "8089",
                "auto",
            )
        });
        let en_handle = if use_dedicated_en_server {
            Some(std::thread::spawn(move || {
                services::whisper::ensure_whisper_cuda_server(
                    &whisper_bin,
                    &whisper_en_model,
                    "127.0.0.1",
                    "8090",
                    "en",
                )
            }))
        } else {
            None
        };
        if let Ok(child) = multi_handle.join() {
            if let Ok(mut guard) = w_multi_slot.lock() {
                *guard = child;
            }
        }
        if let Some(h) = en_handle {
            if let Ok(child) = h.join() {
                if let Ok(mut guard) = w_en_slot.lock() {
                    *guard = child;
                }
            }
        }
    });

    // Warm up Google Translate TLS/DNS connection pools in background so the very first phrase is instant
    let http_gtx = http_client.clone();
    tokio::spawn(async move {
        let _ = http_gtx
            .get("https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=hello")
            .send()
            .await;
    });
    tokio::spawn(async move {
        let _ = http_client
            .get("https://translate.google.com/generate_204")
            .send()
            .await;
    });

    // Warm up GPU OCR DirectX12/CUDA shaders in background so the very first subtitle runs at ~40ms
    if let Some(vi_ocr) = ocr_warmup {
        tokio::task::spawn_blocking(move || {
            let dummy = image::DynamicImage::new_rgb8(960, 288);
            let _ = vi_ocr.run_from_image(&dummy);
        });
    }

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("⚠️ Axum server terminated: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_models() {
        let config = AppConfig::default();
        let pool = services::ocr::load_all_ocr_models(&config);
        assert!(
            pool.vietnamese.is_some(),
            "Vietnamese dedicated model should load"
        );
        assert!(
            pool.english.is_some(),
            "English dedicated model should load"
        );
        assert!(
            pool.chinese.is_some(),
            "Chinese dedicated model should load"
        );
        assert!(
            pool.japanese.is_some(),
            "Japanese dedicated model should load"
        );
        assert!(pool.korean.is_some(), "Korean dedicated model should load");
        if config.th_rec_model_path.is_file() {
            assert!(pool.thai.is_some(), "Thai dedicated model should load");
        }
    }
}
