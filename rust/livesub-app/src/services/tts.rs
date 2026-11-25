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

    let selected_voice = voice.unwrap_or("Trúc Ly");
    let cache_key = format!("tts:{}:{}", selected_voice, target_text);

    // 1. Check in-memory audio cache
    if let Ok(c) = state.audio_cache.read() {
        if let Some(audio_bytes) = c.get(&cache_key) {
            return Some(audio_bytes.clone());
        }
    }

    // 2. Pure Rust native offline VieNeu-TTS synthesis (torch-free, python-free)
    let vieneu = state.vieneu.clone();
    let text_clone = target_text.clone();
    let voice_clone = selected_voice.to_string();

    let wav_res = tokio::task::spawn_blocking(move || {
        vieneu.infer(&text_clone, &voice_clone)
    })
    .await;

    if let Ok(Ok(wav_bytes)) = wav_res {
        if !wav_bytes.is_empty() {
            if let Ok(mut c) = state.audio_cache.write() {
                if c.len() < 4096 {
                    c.insert(cache_key, wav_bytes.clone());
                }
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
        let mut res = audio_vec.into_response();
        res.headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/wav"));
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
            "VieNeu-TTS native engine did not produce audio",
        )
            .into_response()
    }
}
