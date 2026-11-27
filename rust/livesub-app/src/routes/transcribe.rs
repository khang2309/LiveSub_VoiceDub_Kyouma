use crate::{
    config::AppConfig,
    services::{
        translate::fetch_online_translation_with_context,
        whisper::{
            detect_script_language, ensure_whisper_cuda_server, normalize_whisper_language,
            transcribe_gpu_whisper,
        },
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
    let mut previous_context = String::new();
    let mut asr_only = false;

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
        } else if name == "previous_context" {
            if let Ok(text) = field.text().await {
                previous_context = text;
            }
        } else if name == "asr_only" {
            if let Ok(text) = field.text().await {
                asr_only = matches!(text.trim().to_lowercase().as_str(), "1" | "true" | "yes");
            }
        }
    }

    let audio_bytes =
        audio_bytes.ok_or_else(|| (StatusCode::BAD_REQUEST, "Missing audio field".to_string()))?;

    let asr_started = Instant::now();
    let norm = normalize_whisper_language(&source_lang)
        .unwrap_or("auto")
        .to_string();
    let target_url = if norm == "en" {
        &state.whisper_en_server_url
    } else {
        &state.whisper_server_url
    };
    let asr_model_name = format!("Whisper CUDA ({})", state.whisper_model_name);

    let prompt_opt = if previous_context.trim().is_empty() {
        None
    } else {
        Some(previous_context.as_str())
    };

    let mut result = transcribe_gpu_whisper(
        &state.http_client,
        target_url,
        &audio_bytes,
        &source_lang,
        // Do not seed realtime ASR with previous text. During music/noise a
        // prompt can make Whisper continue the old sentence without speech.
        // Context is retained below for translation only.
        None,
    )
    .await;

    if result.is_err() {
        let port_down = tokio::time::timeout(
            std::time::Duration::from_millis(60),
            tokio::net::TcpStream::connect("127.0.0.1:8089"),
        )
        .await
        .map_or(true, |r| r.is_err());

        if port_down {
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
                None,
            )
            .await;
        }
    }

    let transcription = result.map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e))?;
    let transcript = transcription.text;

    if transcript.trim().is_empty() {
        return Ok(Json(serde_json::json!({ "empty": true })));
    }

    let asr_ms = asr_started.elapsed().as_secs_f64() * 1000.0;
    let detected_lang = if norm == "auto" {
        detect_script_language(&transcript)
            .map(str::to_string)
            .or_else(|| transcription.detected_lang.clone())
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

    if asr_only && !skip_translate {
        return Ok(Json(serde_json::json!({
            "empty": false,
            "original": transcript,
            "translated": "",
            "detected_lang": detected_lang,
            "asr_model": asr_model_name,
            "asr_only": true,
            "dubbing": false,
            "timings": {
                "asr_ms": asr_ms
            }
        })));
    }

    let translation_started = Instant::now();
    let translated = if skip_translate {
        transcript.clone()
    } else {
        let trans_lang = if norm == "auto" {
            detected_lang.as_str()
        } else {
            norm.as_str()
        };
        let t = fetch_online_translation_with_context(&state, &transcript, trans_lang, prompt_opt)
            .await;
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
    use crate::services::whisper::{
        detect_script_language, is_whisper_hallucination, is_whisper_promotional_phrase,
        normalize_whisper_language,
    };

    #[test]
    fn normalizes_only_six_supported_languages() {
        assert_eq!(normalize_whisper_language("thai"), Some("th"));
        assert_eq!(normalize_whisper_language("th-TH"), Some("th"));
        assert_eq!(normalize_whisper_language("japanese"), Some("ja"));
        assert_eq!(normalize_whisper_language("zh-CN"), Some("zh"));
        assert_eq!(normalize_whisper_language("ko-KR"), Some("ko"));
        assert_eq!(normalize_whisper_language("en-US"), Some("en"));
        assert_eq!(normalize_whisper_language("vietnamese"), Some("vi"));
        assert_eq!(normalize_whisper_language("french"), None);
        assert_eq!(normalize_whisper_language("auto"), None);
    }

    #[test]
    fn detects_script_languages_deterministically() {
        assert_eq!(detect_script_language("こんにちは世界"), Some("ja"));
        assert_eq!(detect_script_language("안녕하세요"), Some("ko"));
        assert_eq!(detect_script_language("สวัสดีครับ"), Some("th"));
        assert_eq!(detect_script_language("你好世界"), Some("zh"));
        assert_eq!(detect_script_language("Xin chào Việt Nam"), Some("vi"));
    }

    #[test]
    fn filters_whisper_hallucinations() {
        assert!(is_whisper_promotional_phrase("Thank you for watching."));
        assert!(is_whisper_promotional_phrase(
            "ご視聴ありがとうございました"
        ));
        assert!(is_whisper_hallucination("ああああああああ"));
        assert!(is_whisper_promotional_phrase(
            "Hãy subscribe cho kênh Ghiền Mì Gõ để không bỏ lỡ những video hấp dẫn"
        ));
        assert!(is_whisper_promotional_phrase(
            "Nhấn chuông và đăng ký kênh để xem video mới"
        ));
        assert!(!is_whisper_promotional_phrase(
            "Tôi đã đăng ký tham gia nhiệm vụ từ hôm qua"
        ));
        assert!(!is_whisper_hallucination("今日はいい天気ですね"));
    }
}
