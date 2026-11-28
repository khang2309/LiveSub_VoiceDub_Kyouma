use crate::{
    services::tts::{is_edge_voice, prepare_tts_text, synthesize_tts, synthesize_tts_bytes},
    state::AppState,
};
use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use serde::Deserialize;
use std::convert::Infallible;
use std::io::{Error as IoError, ErrorKind};
use std::sync::atomic::Ordering;
use tokio_stream::wrappers::ReceiverStream;
use vieneu_tts_rs::VieneuError;

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

    let cache_key = format!("tts:{}:{}", selected_voice, target_text);
    if let Ok(cache) = state.audio_cache.read() {
        if let Some(wav) = cache.get(&cache_key) {
            let pcm = extract_wav_pcm_s16le(wav).unwrap_or_else(|| wav.clone());
            return pcm_stream_response(Body::from(pcm), "hit");
        }
    }

    let Ok(permit) = state.tts_sem.clone().acquire_owned().await else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "TTS engine is shutting down",
        )
            .into_response();
    };
    let engine = state.vieneu.clone();
    let audio_cache = state.audio_cache.clone();
    let stream_requests = state.tts_stream_requests.clone();
    let last_first_chunk_us = state.tts_last_first_chunk_us.clone();
    let text = target_text;
    let voice = selected_voice.replace("vieneu:", "");
    let (sender, receiver) = tokio::sync::mpsc::channel::<Result<Bytes, Infallible>>(4);
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        stream_requests.fetch_add(1, Ordering::Relaxed);
        let started_at = std::time::Instant::now();
        let mut first_chunk = true;
        let mut full_pcm = Vec::new();
        let result = engine.infer_stream(&text, &voice, |samples| {
            if first_chunk {
                last_first_chunk_us.store(
                    started_at.elapsed().as_micros().min(u64::MAX as u128) as u64,
                    Ordering::Relaxed,
                );
                first_chunk = false;
            }
            let mut bytes = Vec::with_capacity(samples.len() * 2);
            for sample in samples {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
            full_pcm.extend_from_slice(&bytes);
            sender.blocking_send(Ok(Bytes::from(bytes))).map_err(|_| {
                VieneuError::Io(IoError::new(ErrorKind::BrokenPipe, "TTS stream closed"))
            })
        });
        if let Err(error) = result {
            if !matches!(&error, VieneuError::Io(io) if io.kind() == ErrorKind::BrokenPipe) {
                eprintln!("VieNeu streaming synthesis failed: {error}");
            }
        } else if !full_pcm.is_empty() {
            if let Ok(mut cache) = audio_cache.write() {
                if cache.len() >= 512 {
                    if let Some(oldest_key) = cache.keys().next().cloned() {
                        cache.remove(&oldest_key);
                    }
                }
                cache.insert(cache_key, pcm_s16le_to_wav(&full_pcm));
            }
        }
    });

    pcm_stream_response(Body::from_stream(ReceiverStream::new(receiver)), "miss")
}

fn pcm_stream_response(body: Body, cache: &'static str) -> Response {
    let mut response = body.into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert("x-audio-format", HeaderValue::from_static("pcm_s16le"));
    headers.insert("x-audio-sample-rate", HeaderValue::from_static("48000"));
    headers.insert("x-audio-channels", HeaderValue::from_static("1"));
    headers.insert("x-safe-playback-rate", HeaderValue::from_static("2.0"));
    headers.insert("x-tts-streaming", HeaderValue::from_static("1"));
    headers.insert("x-tts-cache", HeaderValue::from_static(cache));
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

fn pcm_s16le_to_wav(pcm: &[u8]) -> Vec<u8> {
    let data_len = pcm.len().min(u32::MAX as usize - 36) as u32;
    let mut wav = Vec::with_capacity(44 + data_len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&48_000u32.to_le_bytes());
    wav.extend_from_slice(&96_000u32.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(&pcm[..data_len as usize]);
    wav
}

#[cfg(test)]
mod tests {
    use super::{extract_wav_pcm_s16le, pcm_s16le_to_wav};

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

    #[test]
    fn streaming_pcm_cache_round_trips_as_wav() {
        let pcm = vec![1, 2, 3, 4, 5, 6];
        let wav = pcm_s16le_to_wav(&pcm);
        assert_eq!(extract_wav_pcm_s16le(&wav), Some(pcm));
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

    let edge_batch = voice.map(is_edge_voice).unwrap_or(false);

    // Edge requests are remote/network-bound, so two-way batching improves
    // lookahead throughput without delaying the local realtime engine. VieNeu
    // background prefetch deliberately uses one GPU slot at a time: the other
    // slot stays available for OCR/Whisper dialogue immediately after a source
    // switch instead of being occupied by stale YouTube CC generation.
    let mut generated = Vec::with_capacity(texts.len());
    for chunk in texts.chunks(2) {
        if state.tts_generation.load(Ordering::Acquire) != generation {
            break;
        }
        if edge_batch && chunk.len() == 2 {
            let (first, second) = tokio::join!(
                synthesize_tts_bytes(&state, &chunk[0], voice),
                synthesize_tts_bytes(&state, &chunk[1], voice)
            );
            generated.push(first);
            generated.push(second);
        } else {
            for text in chunk {
                if state.tts_generation.load(Ordering::Acquire) != generation {
                    break;
                }
                generated.push(synthesize_tts_bytes(&state, text, voice).await);
            }
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
