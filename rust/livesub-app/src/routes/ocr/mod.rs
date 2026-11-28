pub mod postprocess;

use crate::{
    services::{
        ocr::is_blank_subtitle,
        translate::{fetch_online_translation, fetch_online_translation_with_context},
        tts::synthesize_tts_bytes,
    },
    state::AppState,
};
use axum::{
    body::Bytes,
    extract::{Multipart, State},
    http::StatusCode,
    Json,
};
use postprocess::{
    clean_and_validate_vietnamese_ocr, clean_foreign_ocr_noise, is_pure_ocr_junk,
    preserve_recognized_tones,
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

pub async fn api_ocr_subtitle(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let mut image_bytes: Option<Bytes> = None;
    let mut source_lang = "auto".to_string();
    let mut previous_context = String::new();

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
        } else if name == "previous_context" {
            if let Ok(text) = field.text().await {
                previous_context = text;
            }
        }
    }

    let img_data = match image_bytes {
        Some(b) => b,
        None => return Err((StatusCode::BAD_REQUEST, "Missing image field".to_string())),
    };

    let start_ocr = Instant::now();
    let (selected_engine, engine_name) = state.ocr_pool.select_engine(&source_lang);
    let (is_blank, recognized, ocr_confidence, line_boxes) = tokio::task::spawn_blocking(
        move || -> Result<(bool, String, f32, Vec<serde_json::Value>), (StatusCode, String)> {
            let decoded = image::load_from_memory(&img_data)
                .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid image: {e}")))?;

            if is_blank_subtitle(&decoded) {
                return Ok((true, String::new(), 0.0, Vec::new()));
            }

            let Some(engine) = selected_engine else {
                return Ok((false, String::new(), 0.0, Vec::new()));
            };

            let mut dyn_img = decoded;
            let (w, h) = (dyn_img.width(), dyn_img.height());
            if h < 64 {
                let scale_factor = (72.0 / h as f32).max(1.3).min(2.5);
                let new_w = (w as f32 * scale_factor) as u32;
                let new_h = (h as f32 * scale_factor) as u32;
                dyn_img = dyn_img.resize(new_w, new_h, image::imageops::FilterType::Lanczos3);
            }

            let res = engine.run_from_image(&dyn_img).map_err(|e| {
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("OCR inference failed: {e}"),
                )
            })?;
            let accepted: Vec<(String, f32, f64, f64)> = res
                .into_iter()
                .filter_map(|r| {
                    let text = r.text.trim().to_owned();
                    let compact_len = text.chars().filter(|c| c.is_alphanumeric()).count();
                    let threshold = if compact_len <= 8 { 0.48 } else { 0.62 };
                    let points: Vec<_> = r.bounding_box.exterior().points().collect();
                    let center_x = points.iter().map(|p| p.x()).sum::<f64>()
                        / points.len().max(1) as f64
                        / w.max(1) as f64;
                    let center_y = points.iter().map(|p| p.y()).sum::<f64>()
                        / points.len().max(1) as f64
                        / h.max(1) as f64;
                    (!text.is_empty() && r.confidence >= threshold).then_some((
                        text,
                        r.confidence,
                        center_x,
                        center_y,
                    ))
                })
                .collect();
            let mut joined = String::new();
            let mut confidence_sum = 0.0_f32;
            for (idx, (line, confidence, _, _)) in accepted.iter().enumerate() {
                if idx > 0 && !joined.is_empty() {
                    joined.push('\n');
                }
                joined.push_str(line);
                confidence_sum += confidence;
            }
            let confidence = if accepted.is_empty() {
                0.0
            } else {
                confidence_sum / accepted.len() as f32
            };
            let boxes = accepted
                .iter()
                .map(|(text, confidence, x, y)| {
                    serde_json::json!({
                        "text": text, "confidence": confidence, "center_x": x, "center_y": y
                    })
                })
                .collect();
            Ok((false, joined, confidence, boxes))
        },
    )
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("OCR worker failed: {e}"),
        )
    })??;

    if is_blank {
        return Ok(Json(serde_json::json!({
            "empty": true,
            "original": "",
            "translated": "",
            "confidence": 0.0
        })));
    }

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
        .unwrap_or("vi")
        .to_lowercase();
    let is_foreign_source = matches!(norm_lang.as_str(), "en" | "ja" | "zh" | "ko" | "th");
    let is_vietnamese_source = norm_lang == "vi";

    let rec_lines: Vec<String> = recognized
        .lines()
        .map(clean_foreign_ocr_noise)
        .filter(|line| !line.is_empty() && !is_pure_ocr_junk(line))
        .collect();
    let rec_trimmed = rec_lines.join("\n");
    if rec_trimmed.is_empty() || is_pure_ocr_junk(&rec_trimmed) {
        return Ok(Json(serde_json::json!({
            "empty": true,
            "original": "",
            "translated": "",
            "confidence": 0.0,
            "timings": { "ocr_ms": ocr_ms }
        })));
    }

    let ctx_opt = if previous_context.trim().is_empty() {
        None
    } else {
        Some(previous_context.as_str())
    };
    let (cleaned_original, translated) = if is_foreign_source {
        let trans =
            fetch_online_translation_with_context(&state, &rec_trimmed, &norm_lang, ctx_opt).await;
        (rec_trimmed, trans)
    } else if is_vietnamese_source {
        let validated = rec_lines
            .iter()
            .filter_map(|line| {
                let restored = state.ocr.restore_vietnamese(line);
                let restored = preserve_recognized_tones(line, &restored);
                let clean = clean_and_validate_vietnamese_ocr(&restored);
                (!clean.is_empty()).then_some(clean)
            })
            .collect::<Vec<_>>()
            .join("\n");
        if validated.is_empty() {
            return Ok(Json(serde_json::json!({
                "empty": true,
                "original": "",
                "translated": "",
                "confidence": 0.0,
                "timings": { "ocr_ms": ocr_ms }
            })));
        }
        (validated.clone(), validated)
    } else {
        let vi_markers_count = rec_trimmed
            .chars()
            .filter(|c| "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ".contains(*c))
            .count();
        let has_common_vi_word = crate::state::get_re_vi().is_match(&rec_trimmed);
        let is_genuine_vi = vi_markers_count >= 1 || has_common_vi_word;

        if is_genuine_vi {
            let validated = rec_lines
                .iter()
                .filter_map(|line| {
                    let restored = state.ocr.restore_vietnamese(line);
                    let restored = preserve_recognized_tones(line, &restored);
                    let clean = clean_and_validate_vietnamese_ocr(&restored);
                    (!clean.is_empty()).then_some(clean)
                })
                .collect::<Vec<_>>()
                .join("\n");
            if validated.is_empty() {
                return Ok(Json(serde_json::json!({
                    "empty": true,
                    "original": "",
                    "translated": "",
                    "confidence": 0.0,
                    "timings": { "ocr_ms": ocr_ms }
                })));
            }
            (validated.clone(), validated)
        } else {
            let detected_script =
                crate::services::whisper::detect_script_language(&rec_trimmed).unwrap_or("auto");
            let trans = fetch_online_translation(&state, &rec_trimmed, detected_script).await;
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
        "lines": cleaned_original.lines().collect::<Vec<_>>(),
        "translated_lines": translated.lines().collect::<Vec<_>>(),
        "line_boxes": line_boxes,
        "translation_provider": "rust_native_pipeline",
        "timings": {
            "ocr_ms": ocr_ms,
            "translation_ms": trans_ms,
        },
        "confidence": ocr_confidence,
        "ocr_engine": engine_name
    })))
}
