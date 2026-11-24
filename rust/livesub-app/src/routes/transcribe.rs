use crate::{
    services::{translate::fetch_online_translation, whisper::transcribe_gpu_whisper},
    state::AppState,
};
use axum::{
    body::Bytes,
    extract::{Multipart, State},
    http::StatusCode,
    Json,
};
use std::time::Instant;

pub async fn api_transcribe(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut audio_bytes: Option<Bytes> = None;
    let mut source_lang = "auto".to_string();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or_default().to_string();
        if name == "audio" || name == "file" {
            let data = field
                .bytes()
                .await
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            if data.len() < 500 {
                return Ok(Json(serde_json::json!({
                    "empty": true,
                    "reason": "audio too small"
                })));
            }
            if data.len() > 25 * 1024 * 1024 {
                return Err((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Audio chunk too large (max 25MB)".to_string(),
                ));
            }
            audio_bytes = Some(data);
        } else if name == "source_lang" {
            if let Ok(text) = field.text().await {
                source_lang = text;
            }
        }
    }

    let audio_bytes =
        audio_bytes.ok_or_else(|| (StatusCode::BAD_REQUEST, "Missing audio field".to_string()))?;

    let asr_started = Instant::now();
    let norm = source_lang
        .split(['-', '_'])
        .next()
        .unwrap_or("auto")
        .to_lowercase();
    let (target_url, asr_model_name) = if norm == "en" {
        (
            &state.whisper_en_server_url,
            "Whisper English Dedicated Model (ggml-base.en.bin)",
        )
    } else {
        (
            &state.whisper_server_url,
            "Whisper Multilingual Model (ggml-base.bin)",
        )
    };

    let transcript = transcribe_gpu_whisper(
        &state.http_client,
        target_url,
        &audio_bytes,
        &source_lang,
    )
    .await
    .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e))?;

    if transcript.trim().is_empty() {
        return Ok(Json(serde_json::json!({ "empty": true })));
    }

    let asr_ms = asr_started.elapsed().as_secs_f64() * 1000.0;
    let translation_started = Instant::now();
    let translated = fetch_online_translation(&state, &transcript, &source_lang).await;
    Ok(Json(serde_json::json!({
        "empty": false,
        "original": transcript,
        "translated": translated,
        "detected_lang": source_lang,
        "asr_model": asr_model_name,
        "dubbing": false,
        "timings": {
            "asr_ms": asr_ms,
            "translation_ms": translation_started.elapsed().as_secs_f64() * 1000.0
        }
    })))
}
