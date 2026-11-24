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

    let selected_voice = voice.unwrap_or("vi-VN-HoaiMyNeural");
    let cache_key = format!("tts:{}:{}", selected_voice, target_text);

    // 1. Check in-memory audio cache
    if let Ok(c) = state.audio_cache.read() {
        if let Some(audio_bytes) = c.get(&cache_key) {
            return Some(audio_bytes.clone());
        }
    }

    // 2. Try Edge TTS local service for authentic high-fidelity neural voices (Hoai My / Nam Minh)
    let edge_payload = serde_json::json!({
        "text": target_text,
        "voice": selected_voice
    });

    if let Ok(resp) = state
        .http_client
        .post("http://127.0.0.1:3005/tts")
        .json(&edge_payload)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(bytes) = resp.bytes().await {
                if bytes.len() > 100 {
                    let audio_vec = bytes.to_vec();
                    if let Ok(mut c) = state.audio_cache.write() {
                        if c.len() < 4096 {
                            c.insert(cache_key.clone(), audio_vec.clone());
                        }
                    }
                    return Some(audio_vec);
                }
            }
        }
    }

    // 3. Fallback to Google TTS endpoint if Edge TTS is unreachable
    let url = format!(
        "https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q={}",
        urlencoding::encode(&target_text)
    );

    if let Ok(resp) = state.http_client.get(&url).send().await {
        if resp.status().is_success() {
            if let Ok(bytes) = resp.bytes().await {
                if bytes.len() > 100 {
                    let audio_vec = bytes.to_vec();
                    if let Ok(mut c) = state.audio_cache.write() {
                        if c.len() < 4096 {
                            c.insert(cache_key, audio_vec.clone());
                        }
                    }
                    return Some(audio_vec);
                }
            }
        }
    }

    None
}

pub async fn synthesize_tts(state: &AppState, text: &str, voice: Option<&str>) -> Response {
    if let Some(audio_vec) = synthesize_tts_bytes(state, text, voice).await {
        let mut res = audio_vec.into_response();
        res.headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/mpeg"));
        res.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400"),
        );
        res
    } else {
        (
            StatusCode::BAD_GATEWAY,
            "No real TTS provider produced audio",
        )
            .into_response()
    }
}
