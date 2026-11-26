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
    if t.is_empty() || t.contains("[UNK]") {
        return true;
    }
    // Pure timecodes or video player scrubber fragments (e.g. ":59", "04:40 / 23:59", "10")
    static RE_JUNK_TIMECODE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_tc = RE_JUNK_TIMECODE.get_or_init(|| {
        regex::Regex::new(r"^(?:[.:]?\s*\d{1,2}(?::\d{2})?(?:\s*[/|\\]\s*\d{1,2}[:.]\d{1,2})?\s*|\b\d+\s*[yYoO]\b|[yYoO]\s*,\s*[ôÔoO]|Mu\s*\d+\.?|\d+\s*Y|\d+)$").unwrap()
    });
    if re_tc.is_match(t) {
        return true;
    }
    // Isolated single-character non-vowel symbol
    let letters: String = t.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.chars().count() == 1 {
        let low = letters.to_lowercase();
        let has_vowel = low.chars().any(|c| {
            "aáàảãạăắằẳẵặâấầẩẫậeéèẻẽẹêếềểễệiíìỉĩịoóòỏõọôốồổỗộơớờởỡợuúùủũụưứừửữựyýỳỷỹỵ"
                .contains(c)
        });
        if !has_vowel {
            return true;
        }
    }
    false
}

fn clean_foreign_ocr_noise(text: &str) -> String {
    // Strip video player timecodes / scrubber fragments without hardcoding dialogue words
    static RE_OSD: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_osd = RE_OSD.get_or_init(|| {
        regex::Regex::new(r"(?i)(?:\b\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s*[/|\\]\s*\d{1,2}[:.]\d{1,2})?\b|\s+(?:\d+_?\s*[E]|[#*]\s*[E]|[/|\\]\s*)$|\s+\.\s+[A-Z]$)").unwrap()
    });
    let mut cleaned = re_osd.replace_all(text, "").trim().to_string();
    cleaned = cleaned.replace("[UNK]", " ").split_whitespace().collect::<Vec<_>>().join(" ");
    if is_pure_ocr_junk(&cleaned) {
        return String::new();
    }
    cleaned
}

fn is_valid_vi_token(tok: &str) -> bool {
    let core = tok
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    if core.is_empty() {
        return false;
    }
    if core.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if core.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }
    let has_vowel = core.chars().any(|c| {
        "aeiouyàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ"
            .contains(c)
    });
    if !has_vowel {
        return false;
    }
    let lex = ocr_engine_rs::lexicon::Lexicon::global();
    lex.syllables.contains(&core) || lex.words.contains(&core)
}

fn clean_and_validate_vietnamese_ocr(text: &str) -> String {
    let raw_tokens: Vec<&str> = text.split_whitespace().collect();
    if raw_tokens.is_empty() {
        return String::new();
    }

    let alpha_tokens: Vec<&str> = raw_tokens
        .iter()
        .copied()
        .filter(|tok| tok.chars().any(|c| c.is_alphabetic()))
        .collect();
    if alpha_tokens.is_empty() {
        return String::new();
    }

    // For short <= 3-word OCR fragments, reject if ANY alphabetic token is phonotactically
    // invalid (not a valid Vietnamese syllable) — eliminates texture noise like "rít lũ lei",
    // "hít lulan", "Cuối Gg", "ta lu4", "uiateuht" without hardcoding any words.
    if alpha_tokens.len() <= 3 && alpha_tokens.iter().any(|tok| !is_valid_vi_token(tok)) {
        return String::new();
    }

    // Trim invalid edge tokens (e.g. corner watermark fragments attached to the end of a valid sentence)
    let mut start = 0;
    let mut end = raw_tokens.len();
    while start < end && !is_valid_vi_token(raw_tokens[start]) {
        start += 1;
    }
    while end > start && !is_valid_vi_token(raw_tokens[end - 1]) {
        end -= 1;
    }
    if start >= end {
        return String::new();
    }

    let kept = &raw_tokens[start..end];
    let kept_alpha: Vec<&str> = kept
        .iter()
        .copied()
        .filter(|tok| tok.chars().any(|c| c.is_alphabetic()))
        .collect();
    if kept_alpha.is_empty() {
        return String::new();
    }

    let valid_count = kept_alpha.iter().filter(|t| is_valid_vi_token(t)).count();
    if valid_count * 100 < kept_alpha.len() * 60 {
        return String::new();
    }

    let joined = kept.join(" ");
    if is_pure_ocr_junk(&joined) {
        return String::new();
    }
    joined
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
            .filter(|r| r.confidence >= 0.62)
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
    let is_vietnamese_source = norm_lang == "vi";

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
        let validated = clean_and_validate_vietnamese_ocr(&restored);
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
        // Tự động nhận diện (Auto):
        // Chỉ coi là Vietsub nếu có tối thiểu 1 dấu tiếng Việt rõ rệt hoặc từ vựng tiếng Việt phổ biến
        let vi_markers_count = rec_trimmed
            .chars()
            .filter(|c| "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ".contains(*c))
            .count();
        let has_common_vi_word = crate::state::get_re_vi().is_match(&rec_trimmed);
        let is_genuine_vi = vi_markers_count >= 1 || has_common_vi_word;

        if is_genuine_vi {
            let restored = state.ocr.restore_vietnamese(&rec_trimmed);
            let restored = preserve_recognized_tones(&rec_trimmed, &restored);
            let validated = clean_and_validate_vietnamese_ocr(&restored);
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

fn has_any_vietnamese_diacritic(text: &str) -> bool {
    const VIETNAMESE_DIACRITICS: &str =
        "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ\
         ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ";
    text.chars().any(|c| VIETNAMESE_DIACRITICS.contains(c))
}

/// The language model may restore completely unaccented sentences and repair invalid/confusable
/// OCR syllables (e.g. "biểt" -> "biết", "thừ" -> "thử", "cúa" -> "của"), while preserving every
/// valid Vietnamese syllable already recognized by the visual model (including toneless valid
/// words like "do", "Cao", "hai", "cô", "xa").
fn preserve_recognized_tones(recognized: &str, restored: &str) -> String {
    if !has_any_vietnamese_diacritic(recognized) {
        return restored.to_owned();
    }

    let source: Vec<_> = recognized.split_whitespace().collect();
    let candidate: Vec<_> = restored.split_whitespace().collect();
    if source.len() != candidate.len() {
        return restored.to_owned();
    }

    let lex = ocr_engine_rs::lexicon::Lexicon::global();
    source
        .iter()
        .zip(candidate)
        .map(|(original, replacement)| {
            let core_orig = original
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase();
            let core_repl = replacement
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase();
            if core_orig.is_empty() || core_orig == core_repl {
                return replacement;
            }
            let is_valid_orig = lex.syllables.contains(&core_orig);
            let is_rare_ocr_confusion =
                ocr_engine_rs::lexicon::is_rare_override_syllable(&core_orig);
            if !is_valid_orig || is_rare_ocr_confusion {
                replacement
            } else {
                *original
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::{
        clean_and_validate_vietnamese_ocr, clean_foreign_ocr_noise, is_pure_ocr_junk,
        preserve_recognized_tones,
    };

    #[test]
    fn preserves_tones_seen_by_the_visual_model() {
        assert_eq!(
            preserve_recognized_tones("Tôi muốn thử", "Tôi muốn thứ"),
            "Tôi muốn thử"
        );
        assert_eq!(
            preserve_recognized_tones("Tất nhiên là do thiên nhiên rồi.", "Tất nhiên là đó thiên nhiên rồi."),
            "Tất nhiên là do thiên nhiên rồi."
        );
        assert_eq!(
            preserve_recognized_tones("Hai vị và Cao Thuận", "Hải vị và Cào Thuận"),
            "Hai vị và Cao Thuận"
        );
    }

    #[test]
    fn permits_restoring_a_missing_tone() {
        assert_eq!(
            preserve_recognized_tones("Toi muon thu", "Tôi muốn thử"),
            "Tôi muốn thử"
        );
    }

    #[test]
    fn permits_fixing_invalid_and_confusable_tones() {
        assert_eq!(
            preserve_recognized_tones("Hắn biểt và thừ cúa tôi", "Hắn biết và thử của tôi"),
            "Hắn biết và thử của tôi"
        );
    }

    #[test]
    fn rejects_empty_screen_watermarks_and_gibberish() {
        for junk in [
            "uiateuht",
            "wiateukt",
            "iateubds",
            "lateuhh",
            "ít lũ Lmi",
            "hít lulan",
            "Cuối Gg",
            "Uin",
            "ta lu4",
            "Ngưotặ",
            "bít lũ/ uiateuhty",
            "Ch![UNK]n6i[UNK]dien",
        ] {
            let pre = clean_foreign_ocr_noise(junk);
            if !pre.is_empty() {
                assert!(
                    is_pure_ocr_junk(&pre) || clean_and_validate_vietnamese_ocr(&pre).is_empty(),
                    "Expected '{junk}' to be rejected as background/watermark junk"
                );
            }
        }
    }

    #[test]
    fn preserves_genuine_vietnamese_dialogue_and_strips_edge_watermark() {
        assert_eq!(
            clean_and_validate_vietnamese_ocr("Một cô gái từ nơi xa lạ. iateuhty"),
            "Một cô gái từ nơi xa lạ."
        );
        assert_eq!(
            clean_and_validate_vietnamese_ocr("Phải rồi, đó là lý do gia đình nàng tới tìm"),
            "Phải rồi, đó là lý do gia đình nàng tới tìm"
        );
        assert_eq!(
            clean_and_validate_vietnamese_ocr("Sao?"),
            "Sao?"
        );
        assert_eq!(
            clean_and_validate_vietnamese_ocr("Đã chơi!"),
            "Đã chơi!"
        );
        assert_eq!(
            clean_and_validate_vietnamese_ocr("Xa quá!"),
            "Xa quá!"
        );
        assert_eq!(
            clean_and_validate_vietnamese_ocr("Miu meo, miu meo"),
            "Miu meo, miu meo"
        );
    }
}
