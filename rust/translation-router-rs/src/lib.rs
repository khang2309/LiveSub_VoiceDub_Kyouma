use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SourceLanguage {
    Vi,
    Ja,
    Zh,
    Th,
    En,
}

impl SourceLanguage {
    pub fn from_str(s: &str) -> Self {
        let prefix = s.split(['-', '_']).next().unwrap_or("").trim().to_lowercase();
        match prefix.as_str() {
            "ja" | "jp" | "japanese" => SourceLanguage::Ja,
            "zh" | "ch" | "chinese" | "cmn" => SourceLanguage::Zh,
            "th" | "thai" => SourceLanguage::Th,
            "en" | "eng" | "english" => SourceLanguage::En,
            "vi" | "viet" | "vietnamese" => SourceLanguage::Vi,
            _ => SourceLanguage::Vi,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            SourceLanguage::Vi => "vi",
            SourceLanguage::Ja => "ja",
            SourceLanguage::Zh => "zh",
            SourceLanguage::Th => "th",
            SourceLanguage::En => "en",
        }
    }
}

pub struct TranslationRouter {
    cache: RwLock<HashMap<(SourceLanguage, String), String>>,
    term_dict: HashMap<String, String>,
}

impl Default for TranslationRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl TranslationRouter {
    pub fn new() -> Self {
        let mut term_dict = HashMap::new();
        // Common drama / anime honorifics and phrases
        term_dict.insert("お前".to_string(), "cậu".to_string());
        term_dict.insert("あなた".to_string(), "bạn".to_string());
        term_dict.insert("先生".to_string(), "thầy".to_string());
        term_dict.insert("先輩".to_string(), "tiền bối".to_string());
        term_dict.insert("陛下".to_string(), "Bệ hạ".to_string());
        term_dict.insert("殿下".to_string(), "Điện hạ".to_string());
        term_dict.insert("娘娘".to_string(), "Nương nương".to_string());

        Self {
            cache: RwLock::new(HashMap::with_capacity(1024)),
            term_dict,
        }
    }

    /// Fast translation resolution with cache and term substitution
    pub fn translate(&self, text: &str, source: SourceLanguage) -> String {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        // If source is already Vietnamese, return directly
        if source == SourceLanguage::Vi {
            return trimmed.to_string();
        }

        // Check translation cache
        {
            if let Ok(cache) = self.cache.read() {
                if let Some(cached) = cache.get(&(source, trimmed.to_string())) {
                    return cached.clone();
                }
            }
        }

        // Term substitution / dictionary check
        let mut result = trimmed.to_string();
        for (k, v) in &self.term_dict {
            if result.contains(k) {
                result = result.replace(k, v);
            }
        }

        // Store in cache
        if let Ok(mut cache) = self.cache.write() {
            if cache.len() < 4096 {
                cache.insert((source, trimmed.to_string()), result.clone());
            }
        }

        result
    }

    pub fn should_translate(&self, source_lang: &str) -> bool {
        let lang = SourceLanguage::from_str(source_lang);
        lang != SourceLanguage::Vi
    }
}

