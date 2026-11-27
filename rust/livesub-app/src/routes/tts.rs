use crate::{
    services::tts::{is_edge_voice, prepare_tts_text, synthesize_tts, synthesize_tts_bytes},
    state::AppState,
};
use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use serde::Deserialize;
use std::sync::atomic::Ordering;

#[derive(Deserialize)]
pub struct TtsRequest {
    pub text: String,
    #[serde(default)]
    pub voice: Option<String>,
}

pub async fn api_tts(State(state): State<AppState>, Json(req): Json<TtsRequest>) -> Response {
    synthesize_tts(&state, &req.text, req.voice.as_deref()).await
}

pub async fn api_tts_stream(
    State(state): State<AppState>,
    Json(req): Json<TtsRequest>,
) -> Response {
    let selected_voice = req.voice.as_deref().unwrap_or("vieneu:default");
    let Some(target_text) = prepare_tts_text(&state, &req.text) else {
        return (StatusCode::BAD_REQUEST, "No speakable dialogue").into_response();
    };

    if is_edge_voice(selected_voice) {
        let voice_lower = selected_voice.to_lowercase();
        let edge_voice = if voice_lower.contains("nam") {
            "namminh"
        } else {
            "hoaimy"
        };
        let payload = serde_json::json!({ "text": target_text, "voice": edge_voice });
        if let Ok(upstream) = state
            .http_client
            .post("http://127.0.0.1:3005/api/tts-stream")
            .json(&payload)
            .send()
            .await
        {
            if upstream.status().is_success() {
                let streaming = upstream
                    .headers()
                    .get("x-tts-streaming")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("1")
                    .to_owned();
                let cache = upstream
                    .headers()
                    .get("x-tts-cache")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("miss")
                    .to_owned();
                let mut response = Body::from_stream(upstream.bytes_stream()).into_response();
                let headers = response.headers_mut();
                headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/mpeg"));
                headers.insert("x-audio-format", HeaderValue::from_static("mp3"));
                headers.insert("x-audio-sample-rate", HeaderValue::from_static("24000"));
                headers.insert("x-audio-channels", HeaderValue::from_static("1"));
                if let Ok(value) = HeaderValue::from_str(&streaming) {
                    headers.insert("x-tts-streaming", value);
                }
                if let Ok(value) = HeaderValue::from_str(&cache) {
                    headers.insert("x-tts-cache", value);
                }
                return response;
            }
        }
        return synthesize_tts(&state, &target_text, Some(selected_voice)).await;
    }

    let Some(wav) = synthesize_tts_bytes(&state, &target_text, Some(selected_voice)).await else {
        return (StatusCode::BAD_GATEWAY, "TTS engine did not produce audio").into_response();
    };
    let pcm = extract_wav_pcm_s16le(&wav).unwrap_or(wav);
    let mut response = pcm.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert("x-audio-format", HeaderValue::from_static("pcm_s16le"));
    headers.insert("x-audio-sample-rate", HeaderValue::from_static("48000"));
    headers.insert("x-audio-channels", HeaderValue::from_static("1"));
    headers.insert("x-safe-playback-rate", HeaderValue::from_static("2.0"));
    response
}

#[derive(Deserialize)]
pub struct TtsCancelRequest {
    #[serde(default)]
    pub generation: Option<u64>,
}

pub async fn api_tts_cancel(
    State(state): State<AppState>,
    Json(req): Json<TtsCancelRequest>,
) -> Json<serde_json::Value> {
    let current = state.tts_generation.load(Ordering::Acquire);
    let requested = req.generation.unwrap_or_else(|| current.saturating_add(1));
    let generation = state
        .tts_generation
        .fetch_max(requested, Ordering::AcqRel)
        .max(requested);
    Json(serde_json::json!({ "success": true, "generation": generation }))
}

fn extract_wav_pcm_s16le(wav: &[u8]) -> Option<Vec<u8>> {
    if wav.len() < 12 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return None;
    }
    let mut offset = 12usize;
    while offset.checked_add(8)? <= wav.len() {
        let chunk_id = &wav[offset..offset + 4];
        let size = u32::from_le_bytes(wav[offset + 4..offset + 8].try_into().ok()?) as usize;
        let data_start = offset + 8;
        let data_end = data_start.checked_add(size)?;
        if data_end > wav.len() {
            return None;
        }
        if chunk_id == b"data" {
            return Some(wav[data_start..data_end].to_vec());
        }
        offset = data_end + (size & 1);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::extract_wav_pcm_s16le;

    #[test]
    fn extracts_pcm_data_from_riff_without_audio_transcoding() {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&40u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&[1, 0, 1, 0, 0x80, 0xbb, 0, 0, 0, 0x77, 1, 0, 2, 0, 16, 0]);
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&4u32.to_le_bytes());
        wav.extend_from_slice(&[1, 2, 3, 4]);

        assert_eq!(extract_wav_pcm_s16le(&wav), Some(vec![1, 2, 3, 4]));
    }

    #[test]
    fn rejects_non_wav_payloads() {
        assert_eq!(extract_wav_pcm_s16le(b"ID3 mp3"), None);
    }
}

pub async fn api_tts_batch(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let b64_engine = base64::engine::general_purpose::STANDARD;
    let voice = payload.get("voice").and_then(|v| v.as_str());
    let current_generation = state.tts_generation.load(Ordering::Acquire);
    let generation = payload
        .get("generation")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| current_generation.saturating_add(1));
    state.tts_generation.fetch_max(generation, Ordering::AcqRel);

    let texts: Vec<String> = payload
        .get("texts")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .take(16)
                .collect()
        })
        .unwrap_or_default();

    // Generate two cues at a time. On the target RTX 3050 this is the best
    // measured throughput/tail-latency balance; larger fan-out is slower.
    let mut generated = Vec::with_capacity(texts.len());
    for chunk in texts.chunks(2) {
        if state.tts_generation.load(Ordering::Acquire) != generation {
            break;
        }
        if chunk.len() == 2 {
            let (first, second) = tokio::join!(
                synthesize_tts_bytes(&state, &chunk[0], voice),
                synthesize_tts_bytes(&state, &chunk[1], voice)
            );
            generated.push(first);
            generated.push(second);
        } else {
            generated.push(synthesize_tts_bytes(&state, &chunk[0], voice).await);
        }
        if state.tts_generation.load(Ordering::Acquire) != generation {
            break;
        }
    }

    let mut items = Vec::with_capacity(texts.len());
    for (text, audio) in texts.iter().zip(generated.into_iter()) {
        if let Some(bytes) = audio {
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
        "cancelled": state.tts_generation.load(Ordering::Acquire) != generation,
        "generation": generation,
        "count": items.len(),
        "items": items
    }))
}
