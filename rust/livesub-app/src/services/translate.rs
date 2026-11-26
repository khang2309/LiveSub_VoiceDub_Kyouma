use crate::state::AppState;
use translation_router_rs::SourceLanguage;

pub async fn fetch_online_translation(state: &AppState, text: &str, source_lang: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Check in-memory cache
    let cache_key = format!("{}:{}", source_lang, trimmed);
    if let Ok(c) = state.trans_cache.read() {
        if let Some(hit) = c.get(&cache_key) {
            return hit.clone();
        }
    }

    let trimmed_lang = source_lang.trim();
    let lower_lang = trimmed_lang.to_lowercase();
    let sl_owned: String = if lower_lang.is_empty() || lower_lang == "auto" {
        "auto".to_string()
    } else if lower_lang.starts_with("zh") {
        if lower_lang.contains("tw") || lower_lang.contains("hant") {
            "zh-TW".to_string()
        } else {
            "zh-CN".to_string()
        }
    } else {
        let prefix = lower_lang.split(['-', '_']).next().unwrap_or("auto");
        let mapped = SourceLanguage::from_str(prefix);
        if mapped != SourceLanguage::Auto {
            mapped.code().to_string()
        } else if (2..=3).contains(&prefix.len()) && prefix.chars().all(|c| c.is_ascii_alphabetic()) {
            prefix.to_string()
        } else {
            "auto".to_string()
        }
    };
    let sl = sl_owned.as_str();

    // Engine 1: Google Translate single endpoint (client=gtx) - fast (<60ms), 100% reliable, full UTF-8 diacritics
    let gtx_url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl=vi&dt=t&q={}",
        sl,
        urlencoding::encode(trimmed)
    );

    if let Ok(res) = state.http_client.get(&gtx_url).send().await {
        if res.status().is_success() {
            if let Ok(val) = res.json::<serde_json::Value>().await {
                if let Some(sentences) = val.get(0).and_then(|v| v.as_array()) {
                    let mut translated_text = String::new();
                    for s in sentences {
                        if let Some(part) = s.get(0).and_then(|v| v.as_str()) {
                            translated_text.push_str(part);
                        }
                    }
                    let res_trimmed = translated_text.trim();
                    if !res_trimmed.is_empty() {
                        let final_res = res_trimmed.to_string();
                        if let Ok(mut c) = state.trans_cache.write() {
                            if c.len() < 4096 {
                                c.insert(cache_key.clone(), final_res.clone());
                            }
                        }
                        return final_res;
                    }
                }
            }
        }
    }

    // Engine 2: Google Translate batchexecute endpoint (fallback)
    let inner_payload = serde_json::json!([[trimmed, sl, "vi", true], [null]]).to_string();
    let freq = serde_json::json!([[["MkEWBc", inner_payload, null, "0"]]]);
    let body = format!("f.req={}&", urlencoding::encode(&freq.to_string()));
    let batch_url = "https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=MkEWBc&hl=en-US&soc-app=1&soc-platform=1&soc-device=1&rt=c";

    if let Ok(res) = state
        .http_client
        .post(batch_url)
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
                let l_trimmed = line.trim();
                if l_trimmed.starts_with('[') && !l_trimmed.starts_with("[[\"e\"") {
                    if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(l_trimmed) {
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
                                            let final_res = translated_text.trim();
                                            if !final_res.is_empty() {
                                                let verified_res = final_res.to_string();
                                                if let Ok(mut c) = state.trans_cache.write() {
                                                    if c.len() < 4096 {
                                                        c.insert(cache_key.clone(), verified_res.clone());
                                                    }
                                                }
                                                return verified_res;
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

    // Engine 3: MyMemory API (tertiary fallback)
    let mymemory_url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}|vi",
        urlencoding::encode(trimmed),
        if sl == "auto" { "en" } else { sl }
    );
    if let Ok(res) = state.http_client.get(&mymemory_url).send().await {
        if res.status().is_success() {
            if let Ok(val) = res.json::<serde_json::Value>().await {
                if let Some(trans) = val.pointer("/responseData/translatedText").and_then(|v| v.as_str()) {
                    let t_trimmed = trans.trim();
                    if !t_trimmed.is_empty() && !t_trimmed.eq_ignore_ascii_case(trimmed) {
                        let final_res = t_trimmed.to_string();
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

    // Fall back to dictionary translation
    state
        .router
        .translate(trimmed, SourceLanguage::from_str(source_lang))
}
