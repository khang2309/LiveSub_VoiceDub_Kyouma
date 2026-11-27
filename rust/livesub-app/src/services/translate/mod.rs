pub mod providers;

use crate::state::AppState;
use providers::{
    resolve_google_sl, translate_batch_via_gemini, translate_via_batchexecute, translate_via_gtx,
    translate_via_mymemory,
};
use std::time::Duration;
use translation_router_rs::SourceLanguage;

fn cache_get(state: &AppState, cache_key: &str) -> Option<String> {
    if let Ok(c) = state.trans_cache.read() {
        return c.get(cache_key).cloned();
    }
    None
}

fn cache_put(state: &AppState, cache_key: String, value: String) {
    if value.trim().is_empty() {
        return;
    }
    if let Ok(mut c) = state.trans_cache.write() {
        if c.len() >= 4096 {
            c.clear();
        }
        c.insert(cache_key, value);
    }
}

async fn translate_hedged(state: &AppState, payload: &str, sl: &str) -> Option<String> {
    // Engine 1 + Engine 2 (Hedged): Google gtx primary, hedged to batchexecute after 120ms if gtx is slower
    let gtx_fut = translate_via_gtx(state, payload, sl);
    tokio::pin!(gtx_fut);

    tokio::select! {
        res = &mut gtx_fut => {
            if res.is_some() {
                res
            } else {
                translate_via_batchexecute(state, payload, sl).await
            }
        }
        _ = tokio::time::sleep(Duration::from_millis(120)) => {
            let batch_fut = translate_via_batchexecute(state, payload, sl);
            tokio::pin!(batch_fut);
            tokio::select! {
                res = &mut gtx_fut => {
                    if res.is_some() { res } else { batch_fut.await }
                }
                res = &mut batch_fut => {
                    if res.is_some() { res } else { gtx_fut.await }
                }
            }
        }
    }
}

pub async fn fetch_online_translation(state: &AppState, text: &str, source_lang: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let sl = resolve_google_sl(source_lang, trimmed);
    if sl == "vi" {
        return trimmed.to_string();
    }

    let cache_key = format!("{}:{}", sl, trimmed);
    if let Some(hit) = cache_get(state, &cache_key) {
        return hit;
    }

    if let Some(res) = translate_hedged(state, trimmed, &sl).await {
        cache_put(state, cache_key, res.clone());
        return res;
    }

    // Engine 3: MyMemory API (tertiary fallback)
    if let Some(final_res) = translate_via_mymemory(state, trimmed, &sl).await {
        cache_put(state, cache_key, final_res.clone());
        return final_res;
    }

    // Fall back to dictionary translation
    state
        .router
        .translate(trimmed, SourceLanguage::from_str(source_lang))
}

fn clean_context_tail(prev: &str, curr: &str) -> Option<String> {
    let normalized = prev.replace(['\r', '\n'], " ");
    let trimmed = normalized.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case(curr.trim()) {
        return None;
    }
    let char_count = trimmed.chars().count();
    let tail = if char_count > 140 {
        let sliced: String = trimmed
            .chars()
            .rev()
            .take(140)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if let Some(pos) = sliced.find(' ') {
            sliced[pos + 1..].trim().to_string()
        } else {
            sliced
        }
    } else {
        trimmed.to_string()
    };
    if tail.is_empty() || tail.eq_ignore_ascii_case(curr.trim()) {
        return None;
    }
    Some(tail)
}

/// Translates `text` while feeding the immediately preceding utterance as context
/// in a single hedged request so pronouns and ongoing clauses translate coherently.
pub async fn fetch_online_translation_with_context(
    state: &AppState,
    text: &str,
    source_lang: &str,
    previous_context: Option<&str>,
) -> String {
    let curr_clean = text.replace(['\r', '\n'], " ");
    let curr_trimmed = curr_clean.trim();
    if curr_trimmed.is_empty() {
        return String::new();
    }

    let sl = resolve_google_sl(source_lang, curr_trimmed);
    if sl == "vi" {
        return curr_trimmed.to_string();
    }

    let Some(prev_tail) = previous_context.and_then(|p| clean_context_tail(p, curr_trimmed)) else {
        return fetch_online_translation(state, curr_trimmed, source_lang).await;
    };

    let ctx_cache_key = format!("{}:ctx:{}:{}", sl, prev_tail, curr_trimmed);
    if let Some(hit) = cache_get(state, &ctx_cache_key) {
        return hit;
    }

    let joined = format!("{}\n{}", prev_tail, curr_trimmed);
    if let Some(res) = translate_hedged(state, &joined, &sl).await {
        let lines: Vec<&str> = res
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        if lines.len() == 2 {
            let candidate = lines[1].to_string();
            cache_put(state, ctx_cache_key, candidate.clone());
            return candidate;
        }
    }

    fetch_online_translation(state, curr_trimmed, source_lang).await
}

#[cfg(test)]
mod tests {
    use super::clean_context_tail;

    #[test]
    fn context_tail_handles_utf8_and_dedup() {
        assert_eq!(clean_context_tail("   ", "hello"), None);
        assert_eq!(clean_context_tail("hello", "hello"), None);
        assert_eq!(
            clean_context_tail("First line\nSecond line", "Next line"),
            Some("First line Second line".to_string())
        );
        let long_ja = "あ".repeat(300);
        let res = clean_context_tail(&long_ja, "こんにちは").unwrap();
        assert_eq!(res.chars().count(), 140);
    }
}

/// Fast batch translation for YouTube subtitles and multi-line cues.
pub async fn translate_batch(state: &AppState, texts: &[String], source_lang: &str) -> Vec<String> {
    if texts.is_empty() {
        return Vec::new();
    }

    let mut results: Vec<Option<String>> = vec![None; texts.len()];
    let mut missing_indices: Vec<usize> = Vec::new();
    let mut missing_texts: Vec<String> = Vec::new();

    for (idx, text) in texts.iter().enumerate() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            results[idx] = Some(String::new());
            continue;
        }
        let sl = resolve_google_sl(source_lang, trimmed);
        if sl == "vi" {
            results[idx] = Some(trimmed.to_string());
            continue;
        }
        let cache_key = format!("{}:{}", sl, trimmed);
        if let Some(hit) = cache_get(state, &cache_key) {
            results[idx] = Some(hit);
        } else {
            missing_indices.push(idx);
            missing_texts.push(trimmed.replace('\n', " "));
        }
    }

    if !missing_texts.is_empty() {
        let batch_sl = resolve_google_sl(source_lang, &missing_texts[0]);

        if state.gemini_api_key.is_some() {
            if let Some(gemini_out) =
                translate_batch_via_gemini(state, &missing_texts, &batch_sl).await
            {
                for (pos, trans) in gemini_out.into_iter().enumerate() {
                    let orig_idx = missing_indices[pos];
                    let sl = resolve_google_sl(source_lang, &missing_texts[pos]);
                    cache_put(
                        state,
                        format!("{}:{}", sl, missing_texts[pos]),
                        trans.clone(),
                    );
                    results[orig_idx] = Some(trans);
                }
            }
        }

        let still_missing: Vec<(usize, String)> = missing_indices
            .iter()
            .zip(missing_texts.iter())
            .filter_map(|(&idx, txt)| {
                if results[idx].is_none() {
                    Some((idx, txt.clone()))
                } else {
                    None
                }
            })
            .collect();

        if !still_missing.is_empty() {
            if still_missing.len() > 1 {
                let joined = still_missing
                    .iter()
                    .map(|(_, t)| t.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                if let Some(joined_trans) = translate_via_gtx(state, &joined, &batch_sl).await {
                    let lines: Vec<String> =
                        joined_trans.lines().map(|l| l.trim().to_string()).collect();
                    if lines.len() == still_missing.len() && lines.iter().all(|l| !l.is_empty()) {
                        for ((orig_idx, orig_txt), trans) in
                            still_missing.iter().zip(lines.into_iter())
                        {
                            let sl = resolve_google_sl(source_lang, orig_txt);
                            cache_put(state, format!("{}:{}", sl, orig_txt), trans.clone());
                            results[*orig_idx] = Some(trans);
                        }
                    }
                }
            }

            let sem = std::sync::Arc::new(tokio::sync::Semaphore::new(4));
            let mut set = tokio::task::JoinSet::new();
            for (orig_idx, orig_txt) in still_missing {
                if results[orig_idx].is_some() {
                    continue;
                }
                let state_c = state.clone();
                let sem_c = sem.clone();
                let lang_c = source_lang.to_string();
                set.spawn(async move {
                    let _permit = sem_c.acquire().await;
                    let trans = fetch_online_translation(&state_c, &orig_txt, &lang_c).await;
                    (orig_idx, trans)
                });
            }
            while let Some(res) = set.join_next().await {
                if let Ok((orig_idx, trans)) = res {
                    results[orig_idx] = Some(trans);
                }
            }
        }
    }

    results
        .into_iter()
        .enumerate()
        .map(|(i, opt)| opt.unwrap_or_else(|| texts[i].clone()))
        .collect()
}
