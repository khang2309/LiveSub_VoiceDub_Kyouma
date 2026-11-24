use ocr_engine_rs::OcrEngine as DiacriticEngine;
use pure_onnx_ocr::OcrEngine as PpOcrEngine;
use regex::Regex;
use std::{
    collections::HashMap,
    process::Child,
    sync::{Arc, Mutex, OnceLock, RwLock},
};
use translation_router_rs::TranslationRouter;

static RE_VI_MARKERS: OnceLock<Regex> = OnceLock::new();
static RE_WHITESPACE: OnceLock<Regex> = OnceLock::new();

pub fn get_re_vi() -> &'static Regex {
    RE_VI_MARKERS.get_or_init(|| {
        Regex::new(r"(?i)[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]|\b(?:không|được|người|chúng|tôi|bạn|của|trong|một|cho|với|như|đã|sẽ|đang|vậy|từ|đó|những|ngon|kinh|quá|gớm|lắm|thôi|nhé|sao|chứ|nhỉ|còn|nữa|lại|đây|này)\b").unwrap()
    })
}

pub fn get_re_ws() -> &'static Regex {
    RE_WHITESPACE.get_or_init(|| Regex::new(r"\s+").unwrap())
}

#[derive(Clone)]
pub struct OcrEnginePool {
    pub vietnamese: Option<Arc<PpOcrEngine>>,
    pub english: Option<Arc<PpOcrEngine>>,
    pub chinese: Option<Arc<PpOcrEngine>>,
    pub japanese: Option<Arc<PpOcrEngine>>,
    pub korean: Option<Arc<PpOcrEngine>>,
}

impl OcrEnginePool {
    pub fn select_engine(&self, lang: &str) -> (Option<Arc<PpOcrEngine>>, &'static str) {
        let norm = lang.split(['-', '_']).next().unwrap_or("auto").to_lowercase();
        match norm.as_str() {
            "vi" => (
                self.vietnamese.clone(),
                "VietOCR VieSVTR Dedicated Model (229 Dấu Tiếng Việt)",
            ),
            "en" => (
                self.english.clone(),
                "PP-OCRv4 English Dedicated Model (95 Ký tự Latinh)",
            ),
            "zh" => (
                self.chinese.clone(),
                "PP-OCRv4 Chinese Dedicated Model (6625 Ký tự Hán)",
            ),
            "ja" => (
                self.japanese.clone(),
                "PP-OCRv3 Japanese Dedicated Model (4399 Ký tự Hiragana/Katakana/Kanji)",
            ),
            "ko" => (
                self.korean.clone(),
                "PP-OCRv3 Korean Dedicated Model (Hangul Chuyên dụng)",
            ),
            _ => (
                self.vietnamese.clone().or_else(|| self.english.clone()),
                "LiveSub Dynamic Model Auto Route",
            ),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub ocr: Arc<DiacriticEngine>,
    pub ppocr: Option<Arc<PpOcrEngine>>,
    pub ocr_pool: OcrEnginePool,
    pub whisper_server_url: String,
    pub whisper_en_server_url: String,
    pub router: Arc<TranslationRouter>,
    pub http_client: reqwest::Client,
    pub audio_cache: Arc<RwLock<HashMap<String, Vec<u8>>>>,
    pub trans_cache: Arc<RwLock<HashMap<String, String>>>,
    pub _whisper_child: Arc<Mutex<Option<Child>>>,
    pub _whisper_en_child: Arc<Mutex<Option<Child>>>,
}
