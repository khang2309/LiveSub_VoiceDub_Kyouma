use crate::{
    services::{
        ocr::is_blank_subtitle, translate::fetch_online_translation, tts::synthesize_tts_bytes,
    },
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

fn is_pure_ocr_junk(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return true;
    }
    // Pure timecodes or scrubber fragments like ":59", "59 :59", "2 Y", "Y, Ô", "10", "04:40 / 23:59"
    static RE_JUNK_TIMECODE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_tc = RE_JUNK_TIMECODE.get_or_init(|| {
        regex::Regex::new(r"^(?:[.:]?\s*\d{1,2}(?::\d{2})?(?:\s*[/|\\]\s*\d{1,2}[:.]\d{1,2})?\s*|\b\d+\s*[yYoO]\b|[yYoO]\s*,\s*[ôÔoO]|Mu\s*\d+\.?|\d+\s*Y|\d+)$").unwrap()
    });
    if re_tc.is_match(t) {
        return true;
    }
    // Single or double character non-alphabetic or random ASCII junk e.g. "Or", "Si", "Og", "ạ E", "Cd", "Oy", "Cx"
    let letters: String = t.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.len() <= 2 {
        let low = letters.to_lowercase();
        static GENUINE_SHORT_VI: &[&str] = &[
            "ra", "đi", "có", "là", "và", "ở", "ăn", "về", "ta", "họ", "nó", "ba", "mẹ", "ơn", "ạ",
            "ơi", "ôi", "ơ", "dạ", "ừ", "ai", "gì", "rõ", "im", "đã", "sẽ", "kìa", "đây", "đó",
            "xe", "cũ", "xa", "to", "bố", "cô", "chú", "bác", "anh", "em", "ông", "bà", "chị",
        ];
        if !GENUINE_SHORT_VI.contains(&low.as_str()) {
            return true;
        }
    }
    false
}

fn clean_foreign_ocr_noise(text: &str) -> String {
    let re_player_junk = regex::Regex::new(r"(?i)\s*(?:On\s+O\s+Ép\s+On|Ổn\s+Áp\s+On|On\s+Cx\s+Oy|Oy\s+Em|Cài\s+đặt\s+Ơ\s+On|Cào\s+Cào|Cd\s+Ê\s+Ẩm|Cư\s+Pui|Kevin\s+(?:Cd|On|Oy)|On\s+Cào).*$").unwrap();
    let cleaned = re_player_junk.replace_all(text, "").trim().to_string();
    if is_pure_ocr_junk(&cleaned) {
        return String::new();
    }
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

    let (selected_engine, engine_name) = state.ocr_pool.select_engine(&source_lang);
    let (is_blank, recognized, ocr_confidence) = tokio::task::spawn_blocking(move || -> Result<(bool, String, f32), (StatusCode, String)> {
        // Decode image inside blocking worker so async HTTP executor stays completely free.
        let decoded = image::load_from_memory(&img_data)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid image: {e}")))?;

        if is_blank_subtitle(&decoded) {
            return Ok((true, String::new(), 0.0));
        }

        let Some(engine) = selected_engine else {
            return Ok((false, String::new(), 0.0));
        };

        let mut dyn_img = decoded;
        let (w, h) = (dyn_img.width(), dyn_img.height());
        // Scale up low-resolution subtitles with Lanczos3 filter to preserve Vietnamese circumflex (ô, ê, â) and diacritic marks
        if h < 64 {
            let scale_factor = (72.0 / h as f32).max(1.3).min(2.5);
            let new_w = (w as f32 * scale_factor) as u32;
            let new_h = (h as f32 * scale_factor) as u32;
            dyn_img = dyn_img.resize(new_w, new_h, image::imageops::FilterType::Lanczos3);
        }

        let res = engine
            .run_from_image(&dyn_img)
            .map_err(|e| (StatusCode::UNPROCESSABLE_ENTITY, format!("OCR inference failed: {e}")))?;
        let accepted: Vec<(String, f32)> = res
            .into_iter()
            .filter(|r| r.confidence >= 0.58)
            .filter_map(|r| {
                let text = r.text.trim().to_owned();
                (!text.is_empty()).then_some((text, r.confidence))
            })
            .collect();
        let mut joined = String::new();
        let mut confidence_sum = 0.0_f32;
        for (idx, (line, confidence)) in accepted.iter().enumerate() {
            if idx > 0 && !joined.is_empty() {
                joined.push(' ');
            }
            joined.push_str(line);
            confidence_sum += confidence;
        }
        let confidence = if accepted.is_empty() {
            0.0
        } else {
            confidence_sum / accepted.len() as f32
        };
        Ok((false, joined, confidence))
    })
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
    let is_foreign_source = matches!(
        norm_lang.as_str(),
        "en" | "ja" | "zh" | "ko" | "th" | "fr" | "de" | "es" | "ru"
    );
    let is_vietnamese_source = !is_foreign_source;

    // Luôn lọc bỏ rác video player UI buttons, scrubber timestamps, player OSD
    let rec_trimmed = clean_foreign_ocr_noise(&recognized);
    if rec_trimmed.is_empty() || is_pure_ocr_junk(&rec_trimmed) {
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
        let restored = preserve_recognized_tones(&rec_trimmed, &restored);
        (restored.clone(), restored)
    } else {
        // Tự động nhận diện (Auto):
        // Chỉ coi là Vietsub nếu có tối thiểu 2 dấu tiếng Việt rõ rệt hoặc từ vựng tiếng Việt phổ biến
        let vi_markers_count = rec_trimmed
            .chars()
            .filter(|c| "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ".contains(*c))
            .count();
        let has_common_vi_word = crate::state::get_re_vi().is_match(&rec_trimmed);
        let is_genuine_vi = vi_markers_count >= 1 || has_common_vi_word;

        if is_genuine_vi {
            let restored = state.ocr.restore_vietnamese(&rec_trimmed);
            let restored = preserve_recognized_tones(&rec_trimmed, &restored);
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
        "confidence": ocr_confidence,
        "ocr_engine": engine_name
    })))
}

fn has_vietnamese_tone_mark(text: &str) -> bool {
    const VIETNAMESE_TONE_MARKS: &str =
        "àáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ\
         ÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ";
    text.chars().any(|c| VIETNAMESE_TONE_MARKS.contains(c))
}

/// The language model may add missing accents, but it must not replace a tone
/// mark the visual recognizer actually saw (for example sắc -> hỏi).
fn preserve_recognized_tones(recognized: &str, restored: &str) -> String {
    let source: Vec<_> = recognized.split_whitespace().collect();
    let candidate: Vec<_> = restored.split_whitespace().collect();
    if source.len() != candidate.len() {
        return recognized.to_owned();
    }

    source
        .iter()
        .zip(candidate)
        .map(|(original, replacement)| {
            if has_vietnamese_tone_mark(original) {
                *original
            } else {
                replacement
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::preserve_recognized_tones;

    #[test]
    fn preserves_tones_seen_by_the_visual_model() {
        assert_eq!(
            preserve_recognized_tones("Tôi muốn thử", "Tôi muốn thứ"),
            "Tôi muốn thử"
        );
    }

    #[test]
    fn permits_restoring_a_missing_tone() {
        assert_eq!(
            preserve_recognized_tones("Toi muon thu", "Tôi muốn thử"),
            "Tôi muốn thử"
        );
    }
}
