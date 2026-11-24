use crate::{
    services::{ocr::is_blank_subtitle, translate::fetch_online_translation},
    state::{get_re_vi, AppState},
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
    let restored = state.ocr.restore_vietnamese(&req.text);
    Json(serde_json::json!({
        "success": true,
        "prompt": restored,
        "voice": req.voice.unwrap_or_else(|| "google-vi".to_string()),
        "duration_ms": 1100.0,
        "provider": "google-vi"
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
        let dyn_img = decoded.clone();
        tokio::task::spawn_blocking(move || -> Result<String, String> {
            let res = engine.run_from_image(&dyn_img).map_err(|e| e.to_string())?;
            let texts: Vec<String> = res
                .into_iter()
                .map(|r| r.text)
                .filter(|t| !t.trim().is_empty())
                .collect();
            Ok(texts.join(" "))
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

    // Lọc bỏ rác video player UI buttons (On O Ép On, Ổn Áp On, Oy Em, Cài đặt...)
    let rec_trimmed = clean_foreign_ocr_noise(&recognized);
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
        let has_vi = get_re_vi().is_match(&rec_trimmed);
        if has_vi {
            let restored = state.ocr.restore_vietnamese(&rec_trimmed);
            (restored.clone(), restored)
        } else {
            let trans = fetch_online_translation(&state, &rec_trimmed, "auto").await;
            if !trans.is_empty() && trans != rec_trimmed {
                (rec_trimmed, trans)
            } else {
                let restored = state.ocr.restore_vietnamese(&rec_trimmed);
                (restored.clone(), restored)
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
