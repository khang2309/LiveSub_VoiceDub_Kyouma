use std::path::PathBuf;

fn resolve_path(rel: &str) -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(rel);
            if candidate.exists() {
                return candidate;
            }
        }
    }
    let fallback = std::path::Path::new(r"C:\dich").join(rel);
    if fallback.exists() {
        return fallback;
    }
    PathBuf::from(rel)
}

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub bind_addr: std::net::SocketAddr,
    pub whisper_url: String,
    pub whisper_en_url: String,
    pub det_model_path: PathBuf,
    // Model chuyên dụng Tiếng Việt
    pub vi_rec_model_path: PathBuf,
    pub vi_dict_path: PathBuf,
    // Model chuyên dụng Tiếng Anh (Latin)
    pub en_rec_model_path: PathBuf,
    pub en_dict_path: PathBuf,
    // Model chuyên dụng Tiếng Trung
    pub zh_rec_model_path: PathBuf,
    pub zh_dict_path: PathBuf,
    // Model chuyên dụng Tiếng Nhật (Hiragana, Katakana, Kanji)
    pub ja_rec_model_path: PathBuf,
    pub ja_dict_path: PathBuf,
    // Model chuyên dụng Tiếng Hàn (Hangul)
    pub ko_rec_model_path: PathBuf,
    pub ko_dict_path: PathBuf,
    // Whisper Models
    pub whisper_bin_path: PathBuf,
    pub whisper_model_path: PathBuf,
    pub whisper_en_model_path: PathBuf,
    pub public_dir: PathBuf,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            bind_addr: std::net::SocketAddr::from(([0, 0, 0, 0], 3000)),
            whisper_url: "http://127.0.0.1:8089".to_string(),
            whisper_en_url: "http://127.0.0.1:8090".to_string(),
            det_model_path: resolve_path("models/ocr/ch_PP-OCRv4_det_infer.onnx"),
            vi_rec_model_path: resolve_path("models/ocr/vietocr_viesvtr_v7.onnx"),
            vi_dict_path: resolve_path("models/ocr/vietocr_keys.txt"),
            en_rec_model_path: resolve_path("models/ocr/en_PP-OCRv4_rec_infer.onnx"),
            en_dict_path: resolve_path("models/ocr/en_dict.txt"),
            zh_rec_model_path: resolve_path("models/ocr/ch_PP-OCRv4_rec_infer.onnx"),
            zh_dict_path: resolve_path("models/ocr/ppocr_keys_v1.txt"),
            ja_rec_model_path: resolve_path("models/ocr/japan_PP-OCRv3_rec_infer.onnx"),
            ja_dict_path: resolve_path("models/ocr/japan_dict.txt"),
            ko_rec_model_path: resolve_path("models/ocr/korean_PP-OCRv3_rec_infer.onnx"),
            ko_dict_path: resolve_path("models/ocr/korean_dict.txt"),
            whisper_bin_path: resolve_path("models/whisper/cuda/Release/whisper-server.exe"),
            whisper_model_path: resolve_path("models/whisper/ggml-base.bin"),
            whisper_en_model_path: resolve_path("models/whisper/ggml-base.en.bin"),
            public_dir: resolve_path("public"),
        }
    }
}
