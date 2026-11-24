use crate::state::{get_re_ws, AppState};
use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};

pub async fn synthesize_tts(state: &AppState, text: &str) -> Response {
    let cleaned = get_re_ws().replace_all(text.trim(), " ").to_string();
    if cleaned.is_empty() {
        return (StatusCode::BAD_REQUEST, "Text required").into_response();
    }

    let restored = state.ocr.restore_vietnamese(&cleaned);
    let cache_key = format!("tts:{}", restored);

    // 1. Check in-memory audio cache
    if let Ok(c) = state.audio_cache.read() {
        if let Some(audio_bytes) = c.get(&cache_key) {
            let mut res = audio_bytes.clone().into_response();
            res.headers_mut()
                .insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/mpeg"));
            res.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=86400"),
            );
            return res;
        }
    }

    // 2. Fetch high-fidelity Vietnamese audio from Google TTS endpoint
    let url = format!(
        "https://translate.google.com/translate_tts?ie=UTF-8&tl=vi&client=tw-ob&q={}",
        urlencoding::encode(&restored)
    );

    if let Ok(resp) = state.http_client.get(&url).send().await {
        if resp.status().is_success() {
            if let Ok(bytes) = resp.bytes().await {
                if bytes.len() > 200 {
                    let audio_vec = bytes.to_vec();
                    if let Ok(mut c) = state.audio_cache.write() {
                        if c.len() < 2048 {
                            c.insert(cache_key, audio_vec.clone());
                        }
                    }
                    let mut res = audio_vec.into_response();
                    res.headers_mut()
                        .insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/mpeg"));
                    res.headers_mut().insert(
                        header::CACHE_CONTROL,
                        HeaderValue::from_static("public, max-age=86400"),
                    );
                    return res;
                }
            }
        }
    }

    (
        StatusCode::BAD_GATEWAY,
        "No real TTS provider produced audio",
    )
        .into_response()
}
