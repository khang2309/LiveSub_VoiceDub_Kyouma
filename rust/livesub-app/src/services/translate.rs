use crate::state::AppState;
use translation_router_rs::SourceLanguage;

pub async fn fetch_online_translation(state: &AppState, text: &str, source_lang: &str) -> String {
    // Check in-memory cache
    let cache_key = format!("{}:{}", source_lang, text);
    if let Ok(c) = state.trans_cache.read() {
        if let Some(hit) = c.get(&cache_key) {
            return hit.clone();
        }
    }

    let lang_code = SourceLanguage::from_str(source_lang).code();
    let sl = if lang_code == "auto" {
        "auto"
    } else {
        lang_code
    };

    let inner_payload = serde_json::json!([[text, sl, "vi", true], [null]]).to_string();
    let freq = serde_json::json!([[["MkEWBc", inner_payload, null, "0"]]]);
    let body = format!("f.req={}&", urlencoding::encode(&freq.to_string()));
    let url = "https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=MkEWBc&hl=en-US&soc-app=1&soc-platform=1&soc-device=1&rt=c";

    if let Ok(res) = state
        .http_client
        .post(url)
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded;charset=UTF-8",
        )
        .body(body)
        .send()
        .await
    {
        if let Ok(text_resp) = res.text().await {
            for line in text_resp.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('[') && !trimmed.starts_with("[[\"e\"") {
                    if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        if let Some(arr) = chunk.as_array() {
                            for item in arr {
                                if item.get(0).and_then(|v| v.as_str()) == Some("wrb.fr") {
                                    if let Some(payload_str) = item.get(2).and_then(|v| v.as_str()) {
                                        if let Ok(inner) = serde_json::from_str::<serde_json::Value>(payload_str) {
                                            let mut translated_text = String::new();
                                            if let Some(sentences) = inner.pointer("/1/0/0/5").and_then(|v| v.as_array()) {
                                                for s in sentences {
                                                    if let Some(part) = s.get(0).and_then(|v| v.as_str()) {
                                                        translated_text.push_str(part);
                                                    }
                                                }
                                            } else if let Some(single) = inner.pointer("/1/0/0/0").and_then(|v| v.as_str()) {
                                                translated_text.push_str(single);
                                            }
                                            let final_res = translated_text.trim().to_string();
                                            if !final_res.is_empty() {
                                                if let Ok(mut c) = state.trans_cache.write() {
                                                    if c.len() < 4096 {
                                                        c.insert(cache_key, final_res.clone());
                                                    }
                                                }
                                                return final_res;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Fall back to dictionary translation
    state
        .router
        .translate(text, SourceLanguage::from_str(source_lang))
}
