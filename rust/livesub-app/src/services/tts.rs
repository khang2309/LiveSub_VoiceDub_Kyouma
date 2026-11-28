use crate::state::{get_re_ws, AppState};
use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use regex::Regex;
use std::sync::OnceLock;

pub fn sanitize_dubbing_text(text: &str) -> String {
    static NON_SPEECH_CUE_RE: OnceLock<Regex> = OnceLock::new();
    let re = NON_SPEECH_CUE_RE.get_or_init(|| {
        Regex::new(
            r"(?ix)\s*[\[(]\s*(?:
            âm\s*nhạc|nhạc(?:\s*nền)?|music|applause|tiếng\s*vỗ\s*tay|vỗ\s*tay|
            cheering|reo\s*hò|laughter|tiếng\s*cười|cười|sound\s*track|soundtrack|
            ost|bgm|instrumental
        )\s*[\])]\s*",
        )
        .expect("valid non-speech cue regex")
    });

    if text
        .chars()
        .any(|c| matches!(c, '♪' | '♫' | '♬' | '♩' | '🎵' | '🎶'))
    {
        return String::new();
    }
    get_re_ws()
        .replace_all(re.replace_all(text, " ").trim(), " ")
        .trim_matches(|c| matches!(c, '~' | '～' | ' '))
        .trim()
        .to_string()
}

pub fn prepare_tts_text(state: &AppState, text: &str) -> Option<String> {
    let cleaned = sanitize_dubbing_text(text);
    if cleaned.is_empty() {
        return None;
    }
    Some(if crate::state::get_re_vi().is_match(&cleaned) {
        cleaned
    } else {
        state.ocr.restore_vietnamese(&cleaned)
    })
}

#[cfg(test)]
mod tests {
    use super::sanitize_dubbing_text;

    #[test]
    fn removes_non_speech_only_captions() {
        assert_eq!(sanitize_dubbing_text("[âm nhạc]"), "");
        assert_eq!(sanitize_dubbing_text("[MUSIC]"), "");
        assert_eq!(sanitize_dubbing_text("♪ lời bài hát ♪"), "");
    }

    #[test]
    fn keeps_dialogue_around_embedded_cues() {
        assert_eq!(
            sanitize_dubbing_text("ra nhiều [âm nhạc] giả thuyết có thể xảy ra"),
            "ra nhiều giả thuyết có thể xảy ra"
        );
    }
}

pub async fn synthesize_tts_bytes(
    state: &AppState,
    text: &str,
    voice: Option<&str>,
) -> Option<Vec<u8>> {
    let target_text = prepare_tts_text(state, text)?;

    let selected_voice = voice.unwrap_or("vieneu:Trúc Ly");
    let cache_key = format!("tts:{}:{}", selected_voice, target_text);

    // 1. Check in-memory audio cache
    if let Ok(c) = state.audio_cache.read() {
        if let Some(audio_bytes) = c.get(&cache_key) {
            return Some(audio_bytes.clone());
        }
    }

    // Bound VieNeu to the best measured realtime concurrency. This
    // pipelines VieNeu's separately locked ONNX stages without allowing a
    // request stampede to destroy p95/p99 freshness.
    let _tts_permit = state.tts_sem.acquire().await.ok()?;

    // Pure Rust native offline VieNeu-TTS synthesis (torch-free, python-free)
    // Parallel GPU generation: semaphore lock removed to enable concurrent sentence generation
    let vieneu = state.vieneu.clone();
    let text_clone = target_text.clone();
    let clean_voice = selected_voice.replace("vieneu:", "");

    let wav_res =
        tokio::task::spawn_blocking(move || vieneu.infer(&text_clone, &clean_voice)).await;

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
        (StatusCode::BAD_GATEWAY, "TTS engine did not produce audio").into_response()
    }
}
