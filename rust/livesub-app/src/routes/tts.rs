use crate::{services::tts::synthesize_tts, state::AppState};
use axum::{
    extract::State,
    response::Response,
    Json,
};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct TtsRequest {
    pub text: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub voice: Option<String>,
}

pub async fn api_tts(State(state): State<AppState>, Json(req): Json<TtsRequest>) -> Response {
    synthesize_tts(&state, &req.text).await
}

pub async fn api_tts_stream(State(state): State<AppState>, Json(req): Json<TtsRequest>) -> Response {
    synthesize_tts(&state, &req.text).await
}

pub async fn api_tts_batch(
    State(_state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let count = payload
        .get("texts")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    Json(serde_json::json!({
        "success": true,
        "count": count
    }))
}
