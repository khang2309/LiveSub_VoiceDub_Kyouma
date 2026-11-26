use crate::state::{get_re_ws, AppState};
use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};

pub async fn synthesize_tts_bytes(state: &AppState, text: &str, voice: Option<&str>) -> Option<Vec<u8>> {
    let cleaned = get_re_ws().replace_all(text.trim(), " ").to_string();
    if cleaned.is_empty() {
        return None;
    }

    let target_text = if crate::state::get_re_vi().is_match(&cleaned) {
        cleaned
    } else {
        state.ocr.restore_vietnamese(&cleaned)
    };

    let selected_voice = voice.unwrap_or("edge:Hoài My");
    let cache_key = format!("tts:{}:{}", selected_voice, target_text);

    // 1. Check in-memory audio cache
    if let Ok(c) = state.audio_cache.read() {
        if let Some(audio_bytes) = c.get(&cache_key) {
            return Some(audio_bytes.clone());
        }
    }

    // 2. High-speed Realtime Edge-TTS (~200ms) integration
    let voice_lower = selected_voice.to_lowercase();
    let is_edge = voice_lower.starts_with("edge:")
        || voice_lower.starts_with("ms:")
        || voice_lower.contains("hoài my")
        || voice_lower.contains("hoaimy")
        || voice_lower.contains("nam minh")
        || voice_lower.contains("namminh")
        || voice_lower == "edge"
        || voice_lower == "auto-fast";

    if is_edge {
        let edge_voice_param = if voice_lower.contains("nam") { "namminh" } else { "hoaimy" };
        let edge_url = "http://127.0.0.1:3005/api/tts";
        let payload = serde_json::json!({
            "text": target_text,
            "voice": edge_voice_param
        });

        if let Ok(resp) = state.http_client.post(edge_url).json(&payload).send().await {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    let vec = bytes.to_vec();
                    if !vec.is_empty() {
                        if let Ok(mut c) = state.audio_cache.write() {
                            if c.len() >= 512 {
                                if let Some(oldest_key) = c.keys().next().cloned() {
                                    c.remove(&oldest_key);
                                }
                            }
                            c.insert(cache_key, vec.clone());
                        }
                        return Some(vec);
                    }
                }
            }
        }
    }

    // 3. Pure Rust native offline VieNeu-TTS synthesis (torch-free, python-free)
    // Parallel GPU generation: semaphore lock removed to enable concurrent sentence generation
    let vieneu = state.vieneu.clone();
    let text_clone = target_text.clone();
    let clean_voice = selected_voice.replace("vieneu:", "");

    let wav_res = tokio::task::spawn_blocking(move || {
        vieneu.infer(&text_clone, &clean_voice)
    })
    .await;

    if let Ok(Ok(wav_bytes)) = wav_res {
        if !wav_bytes.is_empty() {
            if let Ok(mut c) = state.audio_cache.write() {
                if c.len() >= 512 {
                    if let Some(oldest_key) = c.keys().next().cloned() {
                        c.remove(&oldest_key);
                    }
                }
                c.insert(cache_key, wav_bytes.clone());
            }
            return Some(wav_bytes);
        }
    } else if let Ok(Err(e)) = wav_res {
        eprintln!("VieNeu-TTS synthesis error: {:?}", e);
    }

    None
}

pub async fn synthesize_tts(state: &AppState, text: &str, voice: Option<&str>) -> Response {
    if let Some(audio_vec) = synthesize_tts_bytes(state, text, voice).await {
        let is_wav = audio_vec.starts_with(b"RIFF");
        let ctype = if is_wav { "audio/wav" } else { "audio/mpeg" };

        let mut res = audio_vec.into_response();
        res.headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static(ctype));
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400"),
        );
        res.headers_mut().insert(
            axum::http::HeaderName::from_static("x-safe-playback-rate"),
            HeaderValue::from_static("2.0"),
        );
        res
    } else {
        (
            StatusCode::BAD_GATEWAY,
            "TTS engine did not produce audio",
        )
            .into_response()
    }
}
