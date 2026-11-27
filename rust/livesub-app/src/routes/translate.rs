use crate::{
    services::translate::fetch_online_translation_with_context,
    state::{get_re_vi, AppState},
};
use axum::{extract::State, Json};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct TranslateRequest {
    pub text: String,
    #[serde(alias = "from_lang")]
    pub source_lang: Option<String>,
    #[serde(default)]
    pub previous_context: Option<String>,
}

pub async fn api_translate(
    State(state): State<AppState>,
    Json(req): Json<TranslateRequest>,
) -> Json<serde_json::Value> {
    let raw = req.text.trim();
    if raw.is_empty() {
        return Json(serde_json::json!({
            "original": "",
            "translated": "",
            "source_lang": "auto",
            "target_lang": "vi"
        }));
    }

    let source_lang_str = req.source_lang.unwrap_or_else(|| "auto".to_string());
    let norm = source_lang_str
        .split(['-', '_'])
        .next()
        .unwrap_or("auto")
        .to_lowercase();

    // Nếu nguồn chỉ định rõ là tiếng Việt:
    if norm == "vi" {
        let restored = state.ocr.restore_vietnamese(raw);
        return Json(serde_json::json!({
            "original": raw,
            "translated": restored,
            "source_lang": "vi",
            "target_lang": "vi"
        }));
    }

    // Nếu nguồn là Auto: chỉ coi là tiếng Việt nếu đã có dấu tiếng Việt rõ ràng
    let is_already_vi =
        norm == "auto" && get_re_vi().is_match(raw) && raw.split_whitespace().count() > 1;
    let translated = if is_already_vi {
        state.ocr.restore_vietnamese(raw)
    } else {
        // Nguồn là ngôn ngữ nước ngoài: Dịch trực tiếp sang tiếng Việt đầy đủ dấu
        fetch_online_translation_with_context(
            &state,
            raw,
            &source_lang_str,
            req.previous_context.as_deref(),
        )
        .await
    };

    Json(serde_json::json!({
        "original": raw,
        "translated": translated,
        "source_lang": source_lang_str,
        "target_lang": "vi"
    }))
}
