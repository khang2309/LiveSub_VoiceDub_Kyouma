use crate::config::AppConfig;
use crate::state::OcrEnginePool;
use image::{DynamicImage, GenericImageView};
use pure_onnx_ocr::{OcrEngine as PpOcrEngine, OcrEngineBuilder};
use std::{path::Path, sync::Arc};

pub fn load_ppocr_model(
    det_path: &Path,
    rec_path: &Path,
    dict_path: &Path,
    yaml: Option<&str>,
    name: &str,
) -> Option<Arc<PpOcrEngine>> {
    if !det_path.is_file() || !rec_path.is_file() || !dict_path.is_file() {
        eprintln!("⚠️ Model files not found for {name}: rec={rec_path:?}, dict={dict_path:?}");
        return None;
    }

    let mut builder = OcrEngineBuilder::new();
    builder = builder
        .det_model_path(det_path)
        .rec_model_path(rec_path)
        .dictionary_path(dict_path);

    if let Some(y) = yaml {
        builder = builder.rec_config_yaml(y);
    }

    match builder.build() {
        Ok(engine) => {
            println!("🚀 OCR Model: {name} loaded successfully (Pure Rust)");
            Some(Arc::new(engine))
        }
        Err(e) => {
            eprintln!("⚠️ Failed to build {name}: {e}");
            None
        }
    }
}

pub fn load_all_ocr_models(config: &AppConfig) -> OcrEnginePool {
    let vi_yaml = "PreProcess:\n  transform_ops:\n  - RecResizeImg:\n      image_shape:\n      - 3\n      - 64\n      - 320\nPostProcess:\n  name: CTCLabelDecode\n";
    let ppocr_yaml = "PreProcess:\n  transform_ops:\n  - RecResizeImg:\n      image_shape:\n      - 3\n      - 48\n      - 320\nPostProcess:\n  name: CTCLabelDecode\n";

    // 1. Model chuyên dụng Tiếng Việt (VietOCR VieSVTR - 229 ký tự dấu)
    let vietnamese = load_ppocr_model(
        &config.det_model_path,
        &config.vi_rec_model_path,
        &config.vi_dict_path,
        Some(vi_yaml),
        "VietOCR Native Model (VieSVTR / Tiếng Việt)",
    );

    // 2. Model chuyên dụng Tiếng Anh (PP-OCRv4 Latin / English - 95 ký tự)
    let english = load_ppocr_model(
        &config.det_model_path,
        &config.en_rec_model_path,
        &config.en_dict_path,
        Some(ppocr_yaml),
        "PP-OCRv4 English Dedicated Model",
    );

    // 3. Model chuyên dụng Tiếng Trung (PP-OCRv4 Chinese - 6625 ký tự Hán)
    let chinese = load_ppocr_model(
        &config.det_model_path,
        &config.zh_rec_model_path,
        &config.zh_dict_path,
        Some(ppocr_yaml),
        "PP-OCRv4 Chinese Dedicated Model",
    );

    // 4. Model chuyên dụng Tiếng Nhật (PP-OCRv3 Japanese - 4399 ký tự Hiragana/Katakana/Kanji)
    let japanese = load_ppocr_model(
        &config.det_model_path,
        &config.ja_rec_model_path,
        &config.ja_dict_path,
        Some(ppocr_yaml),
        "PP-OCRv3 Japanese Dedicated Model",
    );

    // 5. Model chuyên dụng Tiếng Hàn (PP-OCRv3 Korean - Hangul Chuyên dụng)
    let korean = load_ppocr_model(
        &config.det_model_path,
        &config.ko_rec_model_path,
        &config.ko_dict_path,
        Some(ppocr_yaml),
        "PP-OCRv3 Korean Dedicated Model",
    );

    OcrEnginePool {
        vietnamese,
        english,
        chinese,
        japanese,
        korean,
    }
}

pub fn load_ppocr_vietnamese(
    det_path: &Path,
    rec_path: &Path,
    dict_path: &Path,
) -> Option<Arc<PpOcrEngine>> {
    let yaml = "PreProcess:\n  transform_ops:\n  - RecResizeImg:\n      image_shape:\n      - 3\n      - 64\n      - 320\nPostProcess:\n  name: CTCLabelDecode\n";
    load_ppocr_model(det_path, rec_path, dict_path, Some(yaml), "VietOCR VieSVTR")
}

pub fn is_blank_subtitle(dyn_img: &DynamicImage) -> bool {
    let (w, h) = dyn_img.dimensions();
    if w < 10 || h < 5 {
        return true;
    }

    // Sample pixels to compute brightness variance
    let mut sum: u64 = 0;
    let mut sum_sq: u64 = 0;
    let count = (w * h).min(2000);
    let step = ((w * h) / count).max(1);

    let mut sampled = 0;
    for i in (0..(w * h)).step_by(step as usize) {
        let x = i % w;
        let y = i / w;
        let p = dyn_img.get_pixel(x, y);
        let lum = ((p[0] as u32 * 299 + p[1] as u32 * 587 + p[2] as u32 * 114) / 1000) as u64;
        sum += lum;
        sum_sq += lum * lum;
        sampled += 1;
    }

    if sampled > 0 {
        let mean = sum / sampled;
        let variance = (sum_sq / sampled).saturating_sub(mean * mean);
        variance < 35 // Subtitle regions have high text-contrast variance
    } else {
        false
    }
}
