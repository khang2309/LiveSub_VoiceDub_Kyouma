use crate::state::AppState;
use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct YouTubeSubtitlesRequest {
    pub url: String,
    #[serde(default)]
    pub caption_language: Option<String>,
    #[serde(default)]
    pub target_lang: Option<String>,
}

pub async fn api_youtube_subtitles(
    State(_state): State<AppState>,
    Json(req): Json<YouTubeSubtitlesRequest>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "success": true,
        "title": "YouTube Subtitles",
        "caption_language": req.caption_language.unwrap_or_else(|| "vi".to_string()),
        "caption_source": "manual",
        "segments": []
    }))
}

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct YouTubeSyncQuery {
    pub url: Option<String>,
    pub from_idx: Option<usize>,
}

pub async fn api_youtube_subtitles_sync(
    Query(query): Query<YouTubeSyncQuery>,
) -> Json<serde_json::Value> {
    let from_idx = query.from_idx.unwrap_or(0);
    Json(serde_json::json!({
        "success": true,
        "from_idx": from_idx,
        "segments": [],
        "done": true,
        "total": 0
    }))
}
