use crate::services::whisper::detect_script_language;
use crate::state::AppState;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use translation_router_rs::SourceLanguage;

static GEMINI_COOLDOWN_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub async fn translate_live_via_gemini(
    state: &AppState,
    text: &str,
    sl: &str,
    previous_context: Option<&str>,
) -> Option<String> {
    let api_key = state.gemini_api_key.as_deref()?;
    if api_key.is_empty() || text.trim().is_empty() {
        return None;
    }

    let now = now_epoch_ms();
    if now < GEMINI_COOLDOWN_UNTIL_MS.load(Ordering::Relaxed) {
        return None;
    }

    let context_block = previous_context
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(|c| {
            format!(
                "Previous line for context (do NOT translate this): \"{}\"\n",
                c
            )
        })
        .unwrap_or_default();

    let prompt = format!(
        "{}Translate ONLY the following spoken subtitle line from '{}' into natural, concise, fluent Vietnamese for real-time video dubbing (keep pronouns and tone consistent with the context; return ONLY the Vietnamese line, no quotes or notes):\n{}",
        context_block,
        sl,
        text.trim()
    );

    let payload = serde_json::json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 96
        }
    });

    // Prefer the sub-second lite models for live speech/subtitles
    for model in ["gemini-flash-lite-latest", "gemini-2.5-flash-lite"] {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, api_key
        );
        let Ok(resp) = state
            .http_client
            .post(&url)
            .timeout(Duration::from_millis(1350))
            .json(&payload)
            .send()
            .await
        else {
            continue;
        };
        if resp.status().as_u16() == 429 || resp.status().as_u16() == 403 {
            GEMINI_COOLDOWN_UNTIL_MS.store(now_epoch_ms() + 25_000, Ordering::Relaxed);
            return None;
        }
        if !resp.status().is_success() {
            continue;
        }
        let Ok(json_val) = resp.json::<serde_json::Value>().await else {
            continue;
        };
        let Some(raw_text) = json_val
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        let cleaned = raw_text
            .trim()
            .trim_matches('"')
            .trim()
            .lines()
            .next()
            .unwrap_or("")
            .trim();
        if !cleaned.is_empty() {
            return Some(cleaned.to_string());
        }
    }
    None
}

pub fn resolve_google_sl(source_lang: &str, text: &str) -> String {
    let trimmed_lang = source_lang.trim();
    let lower_lang = trimmed_lang.to_lowercase();
    if lower_lang.is_empty() || lower_lang == "auto" {
        if let Some(script_lang) = detect_script_language(text) {
            return if script_lang == "zh" {
                "zh-CN".to_string()
            } else {
                script_lang.to_string()
            };
        }
        return "auto".to_string();
    }
    if lower_lang.starts_with("zh") {
        if lower_lang.contains("tw") || lower_lang.contains("hant") {
            return "zh-TW".to_string();
        }
        return "zh-CN".to_string();
    }
    let prefix = lower_lang.split(['-', '_']).next().unwrap_or("auto");
    let mapped = SourceLanguage::from_str(prefix);
    if mapped != SourceLanguage::Auto {
        mapped.code().to_string()
    } else {
        "auto".to_string()
    }
}

pub async fn translate_via_gtx(state: &AppState, text: &str, sl: &str) -> Option<String> {
    let gtx_url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl={}&tl=vi&dt=t&q={}",
        sl,
        urlencoding::encode(text)
    );
    let res = state
        .http_client
        .get(&gtx_url)
        .timeout(Duration::from_millis(1600))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let val = res.json::<serde_json::Value>().await.ok()?;
    let sentences = val.get(0).and_then(|v| v.as_array())?;
    let mut translated_text = String::new();
    for s in sentences {
        if let Some(part) = s.get(0).and_then(|v| v.as_str()) {
            translated_text.push_str(part);
        }
    }
    let res_trimmed = translated_text.trim();
    if res_trimmed.is_empty() {
        None
    } else {
        Some(res_trimmed.to_string())
    }
}

pub async fn translate_via_batchexecute(state: &AppState, text: &str, sl: &str) -> Option<String> {
    let inner_payload = serde_json::json!([[text, sl, "vi", true], [null]]).to_string();
    let freq = serde_json::json!([[["MkEWBc", inner_payload, null, "0"]]]);
    let body = format!("f.req={}&", urlencoding::encode(&freq.to_string()));
    let batch_url = "https://translate.google.com/_/TranslateWebserverUi/data/batchexecute?rpcids=MkEWBc&hl=en-US&soc-app=1&soc-platform=1&soc-device=1&rt=c";

    let res = state
        .http_client
        .post(batch_url)
        .timeout(Duration::from_millis(1800))
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded;charset=UTF-8",
        )
        .body(body)
        .send()
        .await
        .ok()?;
    let text_resp = res.text().await.ok()?;
    for line in text_resp.lines() {
        let l_trimmed = line.trim();
        if l_trimmed.starts_with('[') && !l_trimmed.starts_with("[[\"e\"") {
            if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(l_trimmed) {
                if let Some(arr) = chunk.as_array() {
                    for item in arr {
                        if item.get(0).and_then(|v| v.as_str()) == Some("wrb.fr") {
                            if let Some(payload_str) = item.get(2).and_then(|v| v.as_str()) {
                                if let Ok(inner) =
                                    serde_json::from_str::<serde_json::Value>(payload_str)
                                {
                                    let mut translated_text = String::new();
                                    if let Some(sentences) =
                                        inner.pointer("/1/0/0/5").and_then(|v| v.as_array())
                                    {
                                        for s in sentences {
                                            if let Some(part) = s.get(0).and_then(|v| v.as_str()) {
                                                translated_text.push_str(part);
                                            }
                                        }
                                    } else if let Some(single) =
                                        inner.pointer("/1/0/0/0").and_then(|v| v.as_str())
                                    {
                                        translated_text.push_str(single);
                                    }
                                    let final_res = translated_text.trim();
                                    if !final_res.is_empty() {
                                        return Some(final_res.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

pub async fn translate_via_mymemory(state: &AppState, text: &str, sl: &str) -> Option<String> {
    let mymemory_url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair={}|vi",
        urlencoding::encode(text),
        if sl == "auto" { "en" } else { sl }
    );
    let res = state
        .http_client
        .get(&mymemory_url)
        .timeout(Duration::from_millis(1800))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let val = res.json::<serde_json::Value>().await.ok()?;
    let trans = val
        .pointer("/responseData/translatedText")
        .and_then(|v| v.as_str())?;
    let t_trimmed = trans.trim();
    if !t_trimmed.is_empty() && !t_trimmed.eq_ignore_ascii_case(text) {
        Some(t_trimmed.to_string())
    } else {
        None
    }
}

pub async fn translate_batch_via_gemini(
    state: &AppState,
    texts: &[String],
    sl: &str,
) -> Option<Vec<String>> {
    let api_key = state.gemini_api_key.as_deref()?;
    if api_key.is_empty() || texts.is_empty() {
        return None;
    }

    let numbered = texts
        .iter()
        .enumerate()
        .map(|(idx, line)| format!("[{}] {}", idx + 1, line.replace('\n', " ")))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = format!(
        "Translate each numbered subtitle line from '{}' into natural, concise, fluent Vietnamese suitable for video dubbing. \
        Preserve pronouns, tone, and anime/drama context across lines. \
        Return ONLY a JSON array of strings with the exact same length ({}) and order, no markdown.\n\n{}",
        sl,
        texts.len(),
        numbered
    );

    let payload = serde_json::json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    });

    let candidate_models = [
        state.gemini_model.as_str(),
        "gemini-2.5-flash-lite",
        "gemini-flash-lite-latest",
    ];
    for model in candidate_models {
        if model.trim().is_empty() {
            continue;
        }
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model.trim(),
            api_key
        );
        let Ok(resp) = state
            .http_client
            .post(&url)
            .timeout(Duration::from_secs(4))
            .json(&payload)
            .send()
            .await
        else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(json_val) = resp.json::<serde_json::Value>().await else {
            continue;
        };
        let Some(raw_text) = json_val
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        let cleaned = raw_text
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();
        if let Ok(arr) = serde_json::from_str::<Vec<String>>(cleaned) {
            if arr.len() == texts.len() && arr.iter().all(|s| !s.trim().is_empty()) {
                return Some(arr.into_iter().map(|s| s.trim().to_string()).collect());
            }
        }
    }
    None
}
