pub mod ocr;
pub mod pipeline;
pub mod settings;
pub mod transcribe;
pub mod translate;
pub mod tts;
pub mod youtube;

use crate::state::AppState;
use axum::{
    routing::{get, post},
    Router,
};
use std::path::Path;
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
};

pub fn build_router(state: AppState, public_dir: &Path) -> Router {
    let serve_dir =
        ServeDir::new(public_dir).fallback(ServeFile::new(public_dir.join("index.html")));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/tts-status", get(pipeline::api_tts_status))
        .route("/api/tts/status", get(pipeline::api_tts_status))
        .route("/api/control/key", post(pipeline::api_control_key))
        .route("/api/control/poll", get(pipeline::api_control_poll))
        .route("/api/overlay/toggle", post(pipeline::api_overlay_toggle))
        .route("/api/pipeline-status", get(pipeline::api_pipeline_status))
        .route(
            "/api/settings",
            get(settings::api_get_settings).post(settings::api_post_settings),
        )
        .route("/api/translate", post(translate::api_translate))
        .route("/api/ocr-subtitle", post(ocr::api_ocr_subtitle))
        .route("/api/dub-subtitle", post(ocr::api_dub_subtitle))
        .route("/api/tts", post(tts::api_tts))
        .route("/api/tts-stream", post(tts::api_tts_stream))
        .route("/api/tts-batch", post(tts::api_tts_batch))
        .route("/api/transcribe", post(transcribe::api_transcribe))
        .route("/api/youtube-subtitles", post(youtube::api_youtube_subtitles))
        .route(
            "/api/youtube-subtitles-sync",
            get(youtube::api_youtube_subtitles_sync),
        )
        .route_service("/overlay", ServeFile::new(public_dir.join("overlay.html")))
        .fallback_service(serve_dir)
        .layer(cors)
        .with_state(state)
}
