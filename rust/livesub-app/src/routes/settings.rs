use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSettings {
    #[serde(default = "default_voice")]
    pub voice: String,
    #[serde(default = "default_source_lang")]
    pub source_lang: String,
    #[serde(default = "default_sub_mode")]
    pub sub_mode: String,
    #[serde(default = "default_true")]
    pub adaptive_speed: bool,
    #[serde(default = "default_true")]
    pub dubbing_enabled: bool,
    #[serde(default = "default_ocr_zone")]
    pub ocr_zone: String,
    #[serde(default = "default_volume")]
    pub volume: u32,
}

fn default_voice() -> String {
    "vieneu:Trúc Ly".to_string()
}
fn default_source_lang() -> String {
    "vi-VN".to_string()
}
fn default_sub_mode() -> String {
    "vi_only".to_string()
}
fn default_true() -> bool {
    true
}
fn default_ocr_zone() -> String {
    "bottom".to_string()
}
fn default_volume() -> u32 {
    100
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            voice: default_voice(),
            source_lang: default_source_lang(),
            sub_mode: default_sub_mode(),
            adaptive_speed: true,
            dubbing_enabled: true,
            ocr_zone: default_ocr_zone(),
            volume: 100,
        }
    }
}

fn get_settings_path() -> PathBuf {
    if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
        let dir = PathBuf::from(appdata).join("LiveSub Studio");
        let _ = std::fs::create_dir_all(&dir);
        return dir.join("livesub_settings.json");
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.join("livesub_settings.json");
        }
    }
    PathBuf::from("livesub_settings.json")
}

pub async fn api_get_settings(State(_state): State<AppState>) -> Json<UserSettings> {
    let path = get_settings_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<UserSettings>(&content) {
                return Json(settings);
            }
        }
    }
    Json(UserSettings::default())
}

pub async fn api_post_settings(
    State(_state): State<AppState>,
    Json(updates): Json<serde_json::Value>,
) -> Json<UserSettings> {
    let path = get_settings_path();
    let mut current = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str::<UserSettings>(&c).ok())
            .unwrap_or_default()
    } else {
        UserSettings::default()
    };

    if let Some(v) = updates.get("voice").and_then(|v| v.as_str()) {
        if !v.trim().is_empty() {
            current.voice = v.to_string();
        }
    }
    if let Some(v) = updates.get("source_lang").and_then(|v| v.as_str()) {
        current.source_lang = v.to_string();
    }
    if let Some(v) = updates.get("sub_mode").and_then(|v| v.as_str()) {
        current.sub_mode = v.to_string();
    }
    if let Some(v) = updates.get("adaptive_speed").and_then(|v| v.as_bool()) {
        current.adaptive_speed = v;
    }
    if let Some(v) = updates.get("dubbing_enabled").and_then(|v| v.as_bool()) {
        current.dubbing_enabled = v;
    }
    if let Some(v) = updates.get("ocr_zone").and_then(|v| v.as_str()) {
        current.ocr_zone = v.to_string();
    }
    if let Some(v) = updates.get("volume").and_then(|v| v.as_u64()) {
        current.volume = v as u32;
    }

    if let Ok(json_str) = serde_json::to_string_pretty(&current) {
        let _ = fs::write(&path, json_str);
    }

    Json(current)
}
