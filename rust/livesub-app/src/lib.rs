pub mod config;
pub mod routes;
pub mod services;
pub mod state;

use config::AppConfig;
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

pub async fn run_server(config: AppConfig) {
    println!("============================================================");
    println!("🚀 LiveSub Standalone Pure Rust Realtime Video Dubbing Engine");
    println!("   Architecture: 100% Native Rust | Zero Python | Port 3000");
    println!("   GPU Acceleration: NVIDIA GeForce RTX 3050 Laptop GPU (CUDA)");
    println!("   OCR Engine: VietOCR Native Full Diacritics Model (229 Characters | Pure Rust)");
    println!("   TTS Engine: VieNeu-TTS v3 Turbo Pure Rust ONNX (25 Authentic Voices)");
    println!("============================================================");

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
        .timeout(Duration::from_secs(3))
        .pool_idle_timeout(Duration::from_secs(15))
        .pool_max_idle_per_host(4)
        .build()
        .expect("Failed to initialize HTTP client");

    let state = AppState {
        ocr,
        ppocr,
        ocr_pool,
        vieneu,
        whisper_server_url: config.whisper_url.clone(),
        whisper_en_server_url: config.whisper_en_url.clone(),
        router,
        http_client,
        audio_cache: Arc::new(RwLock::new(HashMap::with_capacity(1024))),
        trans_cache: Arc::new(RwLock::new(HashMap::with_capacity(1024))),
        key_tx,
        _whisper_child: whisper_child_handle.clone(),
        _whisper_en_child: whisper_en_child_handle.clone(),
        tts_sem: Arc::new(tokio::sync::Semaphore::new(1)),
    };

    let ocr_warmup = state.ocr_pool.vietnamese.clone();
    let app = routes::build_router(state, &config.public_dir);

    println!(
        "⚡ LiveSub Pure Rust Web Server listening on http://{}",
        config.bind_addr
    );

    // Kiểm tra nếu port 3000 đã có tiến trình LiveSub đang lắng nghe
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
            eprintln!("⚠️ Cannot bind {}: {e}. Checking if already listening...", config.bind_addr);
            if std::net::TcpStream::connect(config.bind_addr).is_ok() {
                println!("⚡ LiveSub backend is already active on {}. Reusing existing instance.", config.bind_addr);
                return;
            }
            eprintln!("❌ Port {} is blocked. Server aborted.", config.bind_addr);
            return;
        }
    };

    // Launch Whisper CUDA GPU servers (8089 multilingual + 8090 dedicated English) in background
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
        let en_handle = std::thread::spawn(move || {
            services::whisper::ensure_whisper_cuda_server(
                &whisper_bin,
                &whisper_en_model,
                "127.0.0.1",
                "8090",
                "en",
            )
        });
        if let Ok(child) = multi_handle.join() {
            if let Ok(mut guard) = w_multi_slot.lock() {
                *guard = child;
            }
        }
        if let Ok(child) = en_handle.join() {
            if let Ok(mut guard) = w_en_slot.lock() {
                *guard = child;
            }
        }
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
        assert!(pool.vietnamese.is_some(), "Vietnamese dedicated model should load");
        assert!(pool.english.is_some(), "English dedicated model should load");
        assert!(pool.chinese.is_some(), "Chinese dedicated model should load");
        assert!(pool.japanese.is_some(), "Japanese dedicated model should load");
        assert!(pool.korean.is_some(), "Korean dedicated model should load");
    }
}
