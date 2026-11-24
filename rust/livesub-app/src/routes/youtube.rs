use crate::{services::translate::fetch_online_translation, state::AppState};
use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, RwLock},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubtitleSegment {
    pub index: usize,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub original: String,
    pub translated: String,
}

static YOUTUBE_CACHE: LazyLock<Arc<RwLock<HashMap<String, Vec<SubtitleSegment>>>>> =
    LazyLock::new(|| Arc::new(RwLock::new(HashMap::new())));

fn extract_video_id(url_or_id: &str) -> Option<String> {
    let trimmed = url_or_id.trim();
    if trimmed.len() == 11 && !trimmed.contains('/') && !trimmed.contains('?') {
        return Some(trimmed.to_string());
    }
    if let Some(pos) = trimmed.find("v=") {
        let rest = &trimmed[pos + 2..];
        let id: String = rest
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if id.len() == 11 {
            return Some(id);
        }
    }
    for prefix in &["youtu.be/", "/shorts/", "/embed/"] {
        if let Some(pos) = trimmed.find(prefix) {
            let rest = &trimmed[pos + prefix.len()..];
            let id: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if id.len() == 11 {
                return Some(id);
            }
        }
    }
    None
}

fn clean_transcript_text(text: &str) -> String {
    let mut decoded = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");

    if let Ok(re_num) = regex::Regex::new(r"&#(\d+);") {
        decoded = re_num
            .replace_all(&decoded, |caps: &regex::Captures| {
                if let Ok(code) = caps[1].parse::<u32>() {
                    if let Some(ch) = char::from_u32(code) {
                        return ch.to_string();
                    }
                }
                caps[0].to_string()
            })
            .to_string();
    }

    if let Ok(re_hex) = regex::Regex::new(r"&#x([0-9a-fA-F]+);") {
        decoded = re_hex
            .replace_all(&decoded, |caps: &regex::Captures| {
                if let Ok(code) = u32::from_str_radix(&caps[1], 16) {
                    if let Some(ch) = char::from_u32(code) {
                        return ch.to_string();
                    }
                }
                caps[0].to_string()
            })
            .to_string();
    }

    decoded
        .replace('\u{200b}', "")
        .replace('\u{200c}', "")
        .replace('\u{200d}', "")
        .replace('\u{feff}', "")
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_transcript_xml(xml: &str) -> Vec<SubtitleSegment> {
    let mut segments = Vec::new();

    // 1. Format srv3: <p t="ms" d="ms">...<s>word</s>...</p>
    if let Ok(re_p) = regex::Regex::new(r#"<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)</p>"#) {
        let re_s = regex::Regex::new(r#"<s[^>]*>([^<]*)</s>"#).unwrap();
        let re_tags = regex::Regex::new(r#"<[^>]+>"#).unwrap();

        for cap in re_p.captures_iter(xml) {
            let start_ms: u64 = cap.get(1).map_or(0, |m| m.as_str().parse().unwrap_or(0));
            let dur_ms: u64 = cap.get(2).map_or(0, |m| m.as_str().parse().unwrap_or(0));
            let inner = cap.get(3).map_or("", |m| m.as_str());

            let mut text = String::new();
            for s_cap in re_s.captures_iter(inner) {
                text.push_str(s_cap.get(1).map_or("", |m| m.as_str()));
            }
            if text.is_empty() {
                text = re_tags.replace_all(inner, "").to_string();
            }

            let cleaned = clean_transcript_text(&text);
            if !cleaned.is_empty() {
                let start = start_ms as f64 / 1000.0;
                let duration = dur_ms as f64 / 1000.0;
                segments.push(SubtitleSegment {
                    index: segments.len(),
                    start,
                    end: ((start + duration) * 1000.0).round() / 1000.0,
                    duration,
                    original: cleaned.clone(),
                    translated: cleaned,
                });
            }
        }
    }

    // 2. Format classic: <text start="s" dur="s">content</text>
    if segments.is_empty() {
        if let Ok(re_text) = regex::Regex::new(r#"<text\s+start="([\d\.]+)"\s+dur="([\d\.]+)"[^>]*>([^<]*)</text>"#) {
            for cap in re_text.captures_iter(xml) {
                let start: f64 = cap.get(1).map_or(0.0, |m| m.as_str().parse().unwrap_or(0.0));
                let dur: f64 = cap.get(2).map_or(0.0, |m| m.as_str().parse().unwrap_or(0.0));
                let raw = cap.get(3).map_or("", |m| m.as_str());
                let cleaned = clean_transcript_text(raw);
                if !cleaned.is_empty() {
                    segments.push(SubtitleSegment {
                        index: segments.len(),
                        start,
                        end: ((start + dur) * 1000.0).round() / 1000.0,
                        duration: dur,
                        original: cleaned.clone(),
                        translated: cleaned,
                    });
                }
            }
        }
    }

    // Deduplicate adjacent overlapping identical segments
    let mut deduped: Vec<SubtitleSegment> = Vec::new();
    for seg in segments {
        if let Some(last) = deduped.last_mut() {
            if last.original == seg.original && (seg.start - last.start).abs() < 0.3 {
                last.end = last.end.max(seg.end);
                last.duration = ((last.end - last.start) * 1000.0).round() / 1000.0;
                continue;
            }
        }
        let mut s = seg;
        s.index = deduped.len();
        deduped.push(s);
    }

    deduped
}

#[derive(Deserialize)]
pub struct YouTubeSubtitlesRequest {
    pub url: String,
    #[serde(default)]
    pub caption_language: Option<String>,
    #[serde(default)]
    pub target_lang: Option<String>,
}

pub async fn api_youtube_subtitles(
    State(state): State<AppState>,
    Json(req): Json<YouTubeSubtitlesRequest>,
) -> Json<serde_json::Value> {
    let video_id = match extract_video_id(&req.url) {
        Some(id) => id,
        None => {
            return Json(serde_json::json!({
                "success": false,
                "error": "URL YouTube không hợp lệ hoặc không trích xuất được ID video",
                "segments": []
            }));
        }
    };

    // 1. Fetch metadata & caption tracks from YouTube Innertube Android endpoint
    let innertube_payload = serde_json::json!({
        "context": {
            "client": {
                "clientName": "ANDROID",
                "clientVersion": "20.10.38"
            }
        },
        "videoId": video_id
    });

    let resp = state
        .http_client
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("Content-Type", "application/json")
        .header(
            "User-Agent",
            "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
        )
        .json(&innertube_payload)
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Lỗi kết nối YouTube Innertube API: {}", e),
                "segments": []
            }));
        }
    };

    let data: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Lỗi đọc dữ liệu phản hồi từ YouTube: {}", e),
                "segments": []
            }));
        }
    };

    let title = data
        .get("videoDetails")
        .and_then(|vd| vd.get("title"))
        .and_then(|t| t.as_str())
        .unwrap_or("YouTube Video")
        .to_string();

    let tracks = data
        .get("captions")
        .and_then(|c| c.get("playerCaptionsTracklistRenderer"))
        .and_then(|p| p.get("captionTracks"))
        .and_then(|ct| ct.as_array());

    let caption_tracks = match tracks {
        Some(t) if !t.is_empty() => t,
        _ => {
            return Json(serde_json::json!({
                "success": false,
                "error": "Video này không có phụ đề sẵn (Closed Captions)",
                "segments": []
            }));
        }
    };

    // 2. Select track: Priority to Vietnamese if available, else requested lang, else English
    let requested_lang = req
        .caption_language
        .as_deref()
        .unwrap_or("auto")
        .to_lowercase();

    let mut chosen_track: Option<&serde_json::Value> = None;

    if requested_lang == "vi" {
        chosen_track = caption_tracks
            .iter()
            .find(|t| t.get("languageCode").and_then(|c| c.as_str()) == Some("vi"));
    } else if requested_lang != "auto" {
        chosen_track = caption_tracks.iter().find(|t| {
            t.get("languageCode")
                .and_then(|c| c.as_str())
                .map_or(false, |lc| lc.starts_with(&requested_lang))
        });
    }

    if chosen_track.is_none() {
        // Priority 1: Vietnamese track
        chosen_track = caption_tracks
            .iter()
            .find(|t| t.get("languageCode").and_then(|c| c.as_str()) == Some("vi"));
    }
    if chosen_track.is_none() {
        // Priority 2: English manual track
        chosen_track = caption_tracks.iter().find(|t| {
            t.get("languageCode").and_then(|c| c.as_str()) == Some("en")
                && t.get("kind").is_none()
        });
    }
    if chosen_track.is_none() {
        // Priority 3: English auto track
        chosen_track = caption_tracks
            .iter()
            .find(|t| t.get("languageCode").and_then(|c| c.as_str()) == Some("en"));
    }
    if chosen_track.is_none() {
        // Fallback: first available track
        chosen_track = caption_tracks.first();
    }

    let track = match chosen_track {
        Some(t) => t,
        None => {
            return Json(serde_json::json!({
                "success": false,
                "error": "Không tìm thấy track phụ đề phù hợp trên video",
                "segments": []
            }));
        }
    };

    let base_url = match track.get("baseUrl").and_then(|u| u.as_str()) {
        Some(u) => u,
        None => {
            return Json(serde_json::json!({
                "success": false,
                "error": "Track phụ đề không có URL tải",
                "segments": []
            }));
        }
    };

    let lang_code = track
        .get("languageCode")
        .and_then(|c| c.as_str())
        .unwrap_or("en")
        .to_string();

    let is_manual = track.get("kind").is_none();
    let caption_source = if is_manual { "manual" } else { "asr" };

    // 3. Download transcript XML
    let tr_resp = state
        .http_client
        .get(base_url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)",
        )
        .send()
        .await;

    let xml = match tr_resp {
        Ok(r) => r.text().await.unwrap_or_default(),
        Err(e) => {
            return Json(serde_json::json!({
                "success": false,
                "error": format!("Lỗi tải dữ liệu transcript XML: {}", e),
                "segments": []
            }));
        }
    };

    let mut segments = parse_transcript_xml(&xml);
    if segments.is_empty() {
        return Json(serde_json::json!({
            "success": false,
            "error": "Track phụ đề rỗng hoặc không thể phân tích nội dung",
            "segments": []
        }));
    }

    let is_vi = lang_code == "vi";
    let total = segments.len();

    // If not Vietnamese, translate the first 2 segments in parallel immediately so playback & dubbing can begin instantly
    if !is_vi {
        let initial_count = total.min(2);
        let mut set = tokio::task::JoinSet::new();
        for i in 0..initial_count {
            let state_clone = state.clone();
            let orig = segments[i].original.clone();
            let lang = lang_code.clone();
            set.spawn(async move {
                let trans = fetch_online_translation(&state_clone, &orig, &lang).await;
                (i, trans)
            });
        }
        while let Some(res) = set.join_next().await {
            if let Ok((i, trans)) = res {
                segments[i].translated = trans;
            }
        }
        for i in initial_count..total {
            segments[i].translated = String::new();
        }
    }

    // Save all segments into in-memory cache for subsequent sync
    if let Ok(mut cache) = YOUTUBE_CACHE.write() {
        cache.insert(video_id.clone(), segments.clone());
    }

    let has_more = !is_vi && total > 6;

    Json(serde_json::json!({
        "success": true,
        "title": title,
        "caption_language": lang_code,
        "caption_source": caption_source,
        "segments": segments,
        "has_more_translations": has_more,
        "total": total
    }))
}

#[derive(Deserialize)]
pub struct YouTubeSyncQuery {
    pub url: Option<String>,
    pub from_idx: Option<usize>,
}

pub async fn api_youtube_subtitles_sync(
    State(state): State<AppState>,
    Query(query): Query<YouTubeSyncQuery>,
) -> Json<serde_json::Value> {
    let from_idx = query.from_idx.unwrap_or(0);
    let url_str = query.url.unwrap_or_default();
    let video_id = match extract_video_id(&url_str) {
        Some(id) => id,
        None => {
            return Json(serde_json::json!({
                "success": false,
                "from_idx": from_idx,
                "segments": [],
                "done": true,
                "total": 0
            }));
        }
    };

    let mut segments_to_translate = Vec::new();
    let mut total = 0;
    let mut done = true;

    if let Ok(cache) = YOUTUBE_CACHE.read() {
        if let Some(cached_segs) = cache.get(&video_id) {
            total = cached_segs.len();
            if from_idx < total {
                let to_idx = (from_idx + 6).min(total);
                segments_to_translate = cached_segs[from_idx..to_idx].to_vec();
                done = to_idx >= total;
            }
        }
    }

    if segments_to_translate.is_empty() {
        return Json(serde_json::json!({
            "success": true,
            "from_idx": from_idx,
            "segments": [],
            "done": true,
            "total": total
        }));
    }

    // Translate batch with throttled concurrency (max 2 parallel) to prevent Google IP rate limiting
    let sem = Arc::new(tokio::sync::Semaphore::new(2));
    let mut set = tokio::task::JoinSet::new();
    for (i, mut seg) in segments_to_translate.into_iter().enumerate() {
        let state_clone = state.clone();
        let sem_clone = sem.clone();
        set.spawn(async move {
            let _permit = sem_clone.acquire().await;
            if seg.translated.is_empty() || seg.translated == seg.original {
                seg.translated = fetch_online_translation(&state_clone, &seg.original, "auto").await;
            }
            (i, seg)
        });
    }

    let mut translated_indexed = Vec::new();
    while let Some(res) = set.join_next().await {
        if let Ok((i, seg)) = res {
            translated_indexed.push((i, seg));
        }
    }
    translated_indexed.sort_by_key(|(i, _)| *i);
    let translated_batch: Vec<SubtitleSegment> = translated_indexed.into_iter().map(|(_, s)| s).collect();

    // Update cache
    if let Ok(mut cache) = YOUTUBE_CACHE.write() {
        if let Some(cached_segs) = cache.get_mut(&video_id) {
            for seg in &translated_batch {
                if seg.index < cached_segs.len() {
                    cached_segs[seg.index].translated = seg.translated.clone();
                }
            }
        }
    }

    Json(serde_json::json!({
        "success": true,
        "from_idx": from_idx,
        "segments": translated_batch,
        "done": done,
        "total": total
    }))
}
