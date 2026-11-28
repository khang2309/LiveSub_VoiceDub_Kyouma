use std::collections::HashMap;
use serde::Deserialize;
use crate::error::VieneuError;

#[derive(Debug, Clone, Deserialize)]
pub struct VoicePreset {
    pub description: Option<String>,
    pub gender: Option<String>,
    pub region: Option<String>,
    pub style: Option<String>,
    pub speaker_emb: Vec<f32>,
    pub codes: Vec<Vec<i64>>,
    pub aliases: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct VoiceData {
    pub default_voice: String,
    pub presets: HashMap<String, VoicePreset>,
}

#[derive(Debug, Clone)]
pub struct VoiceRegistry {
    pub default_voice: String,
    pub presets: HashMap<String, VoicePreset>,
    alias_map: HashMap<String, String>,
}

impl VoiceRegistry {
    pub fn from_embedded() -> Result<Self, VieneuError> {
        let json_str = include_str!("../assets/voices_v3_turbo.json");
        Self::from_json_str(json_str)
    }

    pub fn from_json_str(json_str: &str) -> Result<Self, VieneuError> {
        let data: VoiceData = serde_json::from_str(json_str)?;
        let mut alias_map = HashMap::new();

        for (name, preset) in &data.presets {
            let norm = Self::normalize_key(name);
            alias_map.insert(norm, name.clone());

            if let Some(aliases) = &preset.aliases {
                for alias in aliases {
                    alias_map.insert(Self::normalize_key(alias), name.clone());
                }
            }
        }

        // Compatibility mappings for the remaining local voice labels.
        alias_map.insert("google-vi".to_string(), "Trúc Ly".to_string());
        alias_map.insert("nam minh".to_string(), "Hải Đăng".to_string());
        alias_map.insert("hoài my".to_string(), "Trúc Ly".to_string());
        alias_map.insert("hoai my".to_string(), "Trúc Ly".to_string());
        alias_map.insert("minh quan".to_string(), "Hải Đăng".to_string());
        alias_map.insert("minh quân".to_string(), "Hải Đăng".to_string());
        alias_map.insert("nu".to_string(), "Trúc Ly".to_string());
        alias_map.insert("nam".to_string(), "Hải Đăng".to_string());

        Ok(Self {
            default_voice: data.default_voice,
            presets: data.presets,
            alias_map,
        })
    }

    pub fn normalize_key(input: &str) -> String {
        let mut s = input.trim();
        // Strip common prefixes
        if let Some(stripped) = s.strip_prefix("vieneu:") {
            s = stripped.trim();
        }
        if let Some(idx) = s.find('(') {
            s = s[..idx].trim();
        }
        // Filter emojis / non-alphanumeric except space
        let cleaned: String = s
            .chars()
            .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '-' || *c == '_')
            .collect();
        cleaned.trim().to_lowercase()
    }

    pub fn get_voice(&self, query: &str) -> Option<(&str, &VoicePreset)> {
        if let Some((k, preset)) = self.presets.get_key_value(query) {
            return Some((k.as_str(), preset));
        }

        let norm = Self::normalize_key(query);
        if let Some(canonical) = self.alias_map.get(&norm) {
            if let Some((k, preset)) = self.presets.get_key_value(canonical) {
                return Some((k.as_str(), preset));
            }
        }

        // Partial match fallback
        for (name, preset) in &self.presets {
            let n = Self::normalize_key(name);
            if n.contains(&norm) || norm.contains(&n) {
                return Some((name.as_str(), preset));
            }
        }

        // Default voice fallback
        if let Some((k, preset)) = self.presets.get_key_value(&self.default_voice) {
            return Some((k.as_str(), preset));
        }

        // Any voice
        self.presets.iter().next().map(|(k, v)| (k.as_str(), v))
    }

    pub fn list_voices(&self) -> Vec<String> {
        let mut names: Vec<String> = self.presets.keys().cloned().collect();
        names.sort();
        names
    }
}
