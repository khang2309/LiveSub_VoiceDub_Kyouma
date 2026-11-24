use crate::{
    services::translate::fetch_online_translation,
    state::{get_re_vi, AppState},
};
use axum::{extract::State, Json};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct TranslateRequest {
    pub text: String,
    pub source_lang: Option<String>,
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
    let restored = state.ocr.restore_vietnamese(raw);
    if restored.trim().is_empty() {
        return Json(serde_json::json!({
            "original": "",
            "translated": "",
            "source_lang": source_lang_str,
            "target_lang": "vi"
        }));
    }
    let is_already_vi = get_re_vi().is_match(&restored) || source_lang_str == "vi";

    let translated = if is_already_vi {
        restored.clone()
    } else {
        fetch_online_translation(&state, &restored, &source_lang_str).await
    };

    Json(serde_json::json!({
        "original": raw,
        "translated": translated,
        "source_lang": source_lang_str,
        "target_lang": "vi"
    }))
}
