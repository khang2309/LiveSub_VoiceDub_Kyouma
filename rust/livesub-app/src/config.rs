use std::path::PathBuf;

pub fn resolve_path(rel: &str) -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(rel);
            if candidate.exists() {
                return candidate;
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join(rel);
        if candidate.exists() {
            return candidate;
        }
        if let Some(parent) = cwd.parent() {
            let candidate_p = parent.join(rel);
            if candidate_p.exists() {
                return candidate_p;
            }
        }
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let candidate = PathBuf::from(local_app_data)
            .join("LiveSub Studio")
            .join(rel);
        if candidate.exists() {
            return candidate;
        }
    }
    let fallback = std::path::Path::new(r"C:\dich").join(rel);
    if fallback.exists() {
        return fallback;
    }
    PathBuf::from(rel)
}

pub fn resolve_writable_app_root() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("public").exists() || dir.join("models").exists() {
                let test_dir = dir.join("models");
                if std::fs::create_dir_all(&test_dir).is_ok() {
                    let probe = test_dir.join(".write_probe");
                    if std::fs::write(&probe, b"ok").is_ok() {
                        let _ = std::fs::remove_file(&probe);
                        return dir.to_path_buf();
                    }
                }
            }
        }
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let dir = PathBuf::from(local_app_data).join("LiveSub Studio");
        if std::fs::create_dir_all(dir.join("models")).is_ok() {
            return dir;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from(r"C:\dich"))
}

fn resolve_best_whisper_model() -> PathBuf {
    for rel in [
        "models/whisper/ggml-large-v3-turbo-q5_0.bin",
        "models/whisper/ggml-small.bin",
        "models/whisper/ggml-base.bin",
    ] {
        let p = resolve_path(rel);
        if p.is_file() {
            return p;
        }
    }
    resolve_path("models/whisper/ggml-base.bin")
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
    // Model chuyên dụng Tiếng Thái (PP-OCRv5 Thai)
    pub th_rec_model_path: PathBuf,
    pub th_dict_path: PathBuf,
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
            th_rec_model_path: resolve_path("models/ocr/th_PP-OCRv5_rec_infer.onnx"),
            th_dict_path: resolve_path("models/ocr/th_dict.txt"),
            whisper_bin_path: resolve_path("models/whisper/cuda/Release/whisper-server.exe"),
            whisper_model_path: resolve_best_whisper_model(),
            whisper_en_model_path: resolve_path("models/whisper/ggml-base.en.bin"),
            public_dir: resolve_path("public"),
        }
    }
}
