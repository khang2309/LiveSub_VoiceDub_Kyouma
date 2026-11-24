use crate::{
    services::tts::{synthesize_tts, synthesize_tts_bytes},
    state::AppState,
};
use axum::{
    extract::State,
    response::Response,
    Json,
};
use base64::Engine;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct TtsRequest {
    pub text: String,
    #[serde(default)]
    pub voice: Option<String>,
}

pub async fn api_tts(State(state): State<AppState>, Json(req): Json<TtsRequest>) -> Response {
    synthesize_tts(&state, &req.text, req.voice.as_deref()).await
}

pub async fn api_tts_stream(State(state): State<AppState>, Json(req): Json<TtsRequest>) -> Response {
    synthesize_tts(&state, &req.text, req.voice.as_deref()).await
}

pub async fn api_tts_batch(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let b64_engine = base64::engine::general_purpose::STANDARD;
    let voice = payload.get("voice").and_then(|v| v.as_str());

    let texts: Vec<String> = payload
        .get("texts")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .take(3)
                .collect()
        })
        .unwrap_or_default();

    let mut items = Vec::with_capacity(texts.len());
    for text in &texts {
        if let Some(bytes) = synthesize_tts_bytes(&state, text, voice).await {
            items.push(serde_json::json!({
                "text": text,
                "audio_base64": b64_engine.encode(&bytes),
                "format": "mp3"
            }));
        } else {
            items.push(serde_json::json!({
                "text": text,
                "audio_base64": null,
                "format": "none"
            }));
        }
    }

    Json(serde_json::json!({
        "success": true,
        "count": items.len(),
        "items": items
    }))
}
