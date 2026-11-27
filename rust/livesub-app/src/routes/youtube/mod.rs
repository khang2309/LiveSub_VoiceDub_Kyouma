pub mod parser;

pub use parser::SubtitleSegment;

use crate::{services::translate::translate_batch, state::AppState};
use axum::{
    extract::{Query, State},
    Json,
};
use parser::{extract_video_id, parse_transcript_xml, select_caption_track};
use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, RwLock},
};

#[derive(Clone)]
struct CachedYouTubeTrack {
    lang_code: String,
    segments: Vec<SubtitleSegment>,
}

static YOUTUBE_CACHE: LazyLock<Arc<RwLock<HashMap<String, CachedYouTubeTrack>>>> =
    LazyLock::new(|| Arc::new(RwLock::new(HashMap::new())));

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

    let requested_lang = req
        .caption_language
        .as_deref()
        .unwrap_or("auto")
        .to_lowercase();

    let track = match select_caption_track(caption_tracks, &requested_lang) {
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

    if !is_vi && total > 0 {
        let initial_count = total.min(12);
        let initial_texts: Vec<String> = segments[..initial_count]
            .iter()
            .map(|s| s.original.clone())
            .collect();
        let translated = translate_batch(&state, &initial_texts, &lang_code).await;
        for (i, trans) in translated.into_iter().enumerate() {
            if !trans.trim().is_empty() {
                segments[i].translated = trans;
            }
        }
        for i in initial_count..total {
            segments[i].translated = String::new();
        }
    }

    if let Ok(mut cache) = YOUTUBE_CACHE.write() {
        cache.insert(
            video_id.clone(),
            CachedYouTubeTrack {
                lang_code: lang_code.clone(),
                segments: segments.clone(),
            },
        );
    }

    let has_more = !is_vi && total > 12;

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
    let mut cached_lang = "auto".to_string();
    let mut total = 0;
    let mut done = true;

    if let Ok(cache) = YOUTUBE_CACHE.read() {
        if let Some(entry) = cache.get(&video_id) {
            cached_lang = entry.lang_code.clone();
            total = entry.segments.len();
            if from_idx < total {
                let to_idx = (from_idx + 24).min(total);
                segments_to_translate = entry.segments[from_idx..to_idx].to_vec();
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

    let pending_texts: Vec<String> = segments_to_translate
        .iter()
        .map(|s| s.original.clone())
        .collect();
    let translated_texts = translate_batch(&state, &pending_texts, &cached_lang).await;

    for (seg, trans) in segments_to_translate
        .iter_mut()
        .zip(translated_texts.into_iter())
    {
        if seg.translated.is_empty() || seg.translated == seg.original {
            if !trans.trim().is_empty() {
                seg.translated = trans;
            } else {
                seg.translated = seg.original.clone();
            }
        }
    }

    if let Ok(mut cache) = YOUTUBE_CACHE.write() {
        if let Some(entry) = cache.get_mut(&video_id) {
            for seg in &segments_to_translate {
                if seg.index < entry.segments.len() {
                    entry.segments[seg.index].translated = seg.translated.clone();
                }
            }
        }
    }

    Json(serde_json::json!({
        "success": true,
        "from_idx": from_idx,
        "segments": segments_to_translate,
        "done": done,
        "total": total
    }))
}
