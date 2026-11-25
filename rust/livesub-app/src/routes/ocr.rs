use crate::{
    services::{ocr::is_blank_subtitle, translate::fetch_online_translation, tts::synthesize_tts_bytes},
    state::AppState,
};
use axum::{
    body::Bytes,
    extract::{Multipart, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use std::time::Instant;

#[derive(Deserialize)]
pub struct DubRequest {
    pub text: String,
    #[serde(default)]
    pub voice: Option<String>,
}

pub async fn api_dub_subtitle(
    State(state): State<AppState>,
    Json(req): Json<DubRequest>,
) -> Json<serde_json::Value> {
    let target_text = req.text.trim().to_string();
    let voice_name = req.voice.as_deref().unwrap_or("Trúc Ly");
    let mut audio_b64 = String::new();

    if let Some(wav_bytes) = synthesize_tts_bytes(&state, &target_text, Some(voice_name)).await {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        audio_b64 = STANDARD.encode(&wav_bytes);
    }

    Json(serde_json::json!({
        "success": !audio_b64.is_empty(),
        "prompt": target_text,
        "audio_base64": audio_b64,
        "audio_mime": "audio/wav",
        "voice": voice_name,
        "duration_ms": 1100.0,
        "provider": "vieneu-tts-rs"
    }))
}

fn clean_foreign_ocr_noise(text: &str) -> String {
    let re_player_junk = regex::Regex::new(r"(?i)\s*(?:On\s+O\s+Ép\s+On|Ổn\s+Áp\s+On|On\s+Cx\s+Oy|Oy\s+Em|Cài\s+đặt\s+Ơ\s+On|Cào\s+Cào|Cd\s+Ê\s+Ẩm|Cư\s+Pui|Kevin\s+(?:Cd|On|Oy)|On\s+Cào).*$").unwrap();
    let cleaned = re_player_junk.replace_all(text, "").trim().to_string();
    cleaned
}

pub async fn api_ocr_subtitle(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut image_bytes: Option<Bytes> = None;
    let mut source_lang = "auto".to_string();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or_default().to_string();
        if name == "image" || name == "file" {
            let data = field
                .bytes()
                .await
                .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
            if data.is_empty() {
                return Err((StatusCode::BAD_REQUEST, "Image buffer empty".to_string()));
            }
            if data.len() > 10 * 1024 * 1024 {
                return Err((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Image too large (max 10MB)".to_string(),
                ));
            }
            image_bytes = Some(data);
        } else if name == "source_lang" {
            if let Ok(text) = field.text().await {
                source_lang = text;
            }
        }
    }

    let img_data = match image_bytes {
        Some(b) => b,
        None => return Err((StatusCode::BAD_REQUEST, "Missing image field".to_string())),
    };

    let start_ocr = Instant::now();

    // Decode image first so malformed uploads cannot reach the inference engine.
    let decoded = image::load_from_memory(&img_data)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid image: {e}")))?;

    let is_blank = is_blank_subtitle(&decoded);

    if is_blank {
        return Ok(Json(serde_json::json!({
            "empty": true,
            "original": "",
            "translated": "",
            "confidence": 0.0
        })));
    }

    let (selected_engine, engine_name) = state.ocr_pool.select_engine(&source_lang);
    let recognized = if let Some(engine) = selected_engine {
        let mut dyn_img = decoded;
        let (w, h) = (dyn_img.width(), dyn_img.height());
        // Scale up low-resolution subtitles with Lanczos3 filter to preserve Vietnamese diacritic marks
        if h < 42 {
            let scale_factor = (54.0 / h as f32).max(1.5).min(2.5);
            let new_w = (w as f32 * scale_factor) as u32;
            let new_h = (h as f32 * scale_factor) as u32;
            dyn_img = dyn_img.resize(new_w, new_h, image::imageops::FilterType::Lanczos3);
        }

        tokio::task::spawn_blocking(move || -> Result<String, String> {
            let res = engine.run_from_image(&dyn_img).map_err(|e| e.to_string())?;
            let texts: Vec<String> = res
                .into_iter()
                .map(|r| r.text)
                .filter(|t| !t.trim().is_empty())
                .collect();
            let mut joined = String::new();
            for (idx, line) in texts.iter().enumerate() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if idx > 0 && !joined.is_empty() {
                    joined.push(' ');
                }
                joined.push_str(trimmed);
            }
            Ok(joined)
        })
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("OCR worker failed: {e}"),
            )
        })?
        .map_err(|e| {
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                format!("OCR inference failed: {e}"),
            )
        })?
    } else {
        String::new()
    };

    let ocr_ms = start_ocr.elapsed().as_secs_f64() * 1000.0;

    if recognized.trim().is_empty() {
        return Ok(Json(serde_json::json!({
            "empty": true,
            "original": "",
            "translated": "",
            "confidence": 0.0,
            "timings": { "ocr_ms": ocr_ms }
        })));
    }

    let start_trans = Instant::now();
    let norm_lang = source_lang
        .split(['-', '_'])
        .next()
        .unwrap_or("auto")
        .to_lowercase();
    let is_vietnamese_source = norm_lang == "vi";
    let is_foreign_source = matches!(
        norm_lang.as_str(),
        "en" | "ja" | "zh" | "ko" | "th" | "fr" | "de" | "es" | "ru"
    );

    // Chỉ lọc bỏ rác video player UI buttons (On O Ép On, Ổn Áp On, Oy Em, Cài đặt...) khi ở chế độ Vietsub
    let rec_trimmed = if norm_lang == "vi" {
        clean_foreign_ocr_noise(&recognized)
    } else {
        recognized.trim().to_string()
    };
    if rec_trimmed.is_empty() {
        return Ok(Json(serde_json::json!({
            "empty": true,
            "original": "",
            "translated": "",
            "confidence": 0.0,
            "timings": { "ocr_ms": ocr_ms }
        })));
    }

    let (cleaned_original, translated) = if is_foreign_source {
        // Nguồn là ngôn ngữ nước ngoài (Anh, Nhật, Trung...):
        // Tuyệt đối KHÔNG gắn dấu tiếng Việt vào từ tiếng Anh! Dịch trực tiếp sang tiếng Việt.
        let trans = fetch_online_translation(&state, &rec_trimmed, &norm_lang).await;
        (rec_trimmed, trans)
    } else if is_vietnamese_source {
        // Nguồn phụ đề tiếng Việt (Vietsub):
        let restored = state.ocr.restore_vietnamese(&rec_trimmed);
        (restored.clone(), restored)
    } else {
        // Tự động nhận diện (Auto):
        // Chỉ coi là Vietsub nếu có tối thiểu 2 dấu tiếng Việt rõ rệt hoặc từ vựng tiếng Việt phổ biến
        let vi_markers_count = rec_trimmed
            .chars()
            .filter(|c| "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ".contains(*c))
            .count();
        let has_common_vi_word = crate::state::get_re_vi().is_match(&rec_trimmed);
        let is_genuine_vi = vi_markers_count >= 2 || (vi_markers_count >= 1 && has_common_vi_word);

        if is_genuine_vi && (rec_trimmed.contains(' ') || rec_trimmed.chars().count() > 3) {
            let restored = state.ocr.restore_vietnamese(&rec_trimmed);
            (restored.clone(), restored)
        } else {
            let trans = fetch_online_translation(&state, &rec_trimmed, "auto").await;
            if !trans.is_empty() {
                (rec_trimmed, trans)
            } else {
                (rec_trimmed.clone(), rec_trimmed)
            }
        }
    };
    let trans_ms = start_trans.elapsed().as_secs_f64() * 1000.0;

    Ok(Json(serde_json::json!({
        "empty": false,
        "original": cleaned_original,
        "translated": translated,
        "translation_provider": "rust_native_pipeline",
        "timings": {
            "ocr_ms": ocr_ms,
            "translation_ms": trans_ms,
        },
        "confidence": 0.98,
        "ocr_engine": engine_name
    })))
}
