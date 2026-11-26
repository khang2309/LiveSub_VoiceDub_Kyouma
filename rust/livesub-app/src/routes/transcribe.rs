use crate::{
    config::AppConfig,
    services::{
        translate::fetch_online_translation,
        whisper::{ensure_whisper_cuda_server, transcribe_gpu_whisper},
    },
    state::{get_re_vi, AppState},
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

    let mut result = transcribe_gpu_whisper(
        &state.http_client,
        target_url,
        &audio_bytes,
        &source_lang,
    )
    .await;

    if result.is_err() && std::net::TcpStream::connect("127.0.0.1:8089").is_err() {
        let cfg = AppConfig::default();
        let _ = tokio::task::spawn_blocking(move || {
            ensure_whisper_cuda_server(
                &cfg.whisper_bin_path,
                &cfg.whisper_model_path,
                "127.0.0.1",
                "8089",
                "auto",
            )
        })
        .await;
        result = transcribe_gpu_whisper(
            &state.http_client,
            &state.whisper_server_url,
            &audio_bytes,
            &source_lang,
        )
        .await;
    }

    let transcription = result.map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e))?;
    let transcript = transcription.text;

    if transcript.trim().is_empty() {
        return Ok(Json(serde_json::json!({ "empty": true })));
    }

    let asr_ms = asr_started.elapsed().as_secs_f64() * 1000.0;
    let detected_lang = if norm == "auto" {
        transcription
            .detected_lang
            .clone()
            .unwrap_or_else(|| "auto".to_string())
    } else {
        norm.clone()
    };

    let has_vi_diacritics = transcript.chars().any(|c| {
        "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ\
         ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴĐ"
            .contains(c)
    });
    let skip_translate = norm == "vi"
        || (norm == "auto"
            && detected_lang == "vi"
            && (has_vi_diacritics || get_re_vi().is_match(&transcript)));

    let translation_started = Instant::now();
    let translated = if skip_translate {
        transcript.clone()
    } else {
        let trans_lang = if norm == "auto" {
            detected_lang.as_str()
        } else {
            source_lang.as_str()
        };
        let t = fetch_online_translation(&state, &transcript, trans_lang).await;
        if t.trim().is_empty() {
            transcript.clone()
        } else {
            t
        }
    };
    Ok(Json(serde_json::json!({
        "empty": false,
        "original": transcript,
        "translated": translated,
        "detected_lang": detected_lang,
        "asr_model": asr_model_name,
        "dubbing": false,
        "timings": {
            "asr_ms": asr_ms,
            "translation_ms": translation_started.elapsed().as_secs_f64() * 1000.0
        }
    })))
}

#[cfg(test)]
mod tests {
    use crate::services::whisper::normalize_whisper_language;

    #[test]
    fn normalizes_thai_and_multilingual_whisper_names() {
        assert_eq!(normalize_whisper_language("thai"), Some("th"));
        assert_eq!(normalize_whisper_language("th-TH"), Some("th"));
        assert_eq!(normalize_whisper_language("japanese"), Some("ja"));
        assert_eq!(normalize_whisper_language("french"), Some("fr"));
        assert_eq!(normalize_whisper_language("vietnamese"), Some("vi"));
        assert_eq!(normalize_whisper_language("auto"), None);
    }
}
