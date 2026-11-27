use crate::config::AppConfig;
use crate::services::gpu_ocr::{GpuOcrEngine, OcrEngineBackend, SharedDetSession};
use crate::state::OcrEnginePool;
use image::{DynamicImage, GenericImageView};
use pure_onnx_ocr::OcrEngineBuilder;
use std::{path::Path, sync::Arc};

pub fn load_ppocr_model(
    det_path: &Path,
    rec_path: &Path,
    dict_path: &Path,
    yaml: Option<&str>,
    name: &str,
) -> Option<Arc<OcrEngineBackend>> {
    load_ppocr_model_with_det(None, det_path, rec_path, dict_path, yaml, name, 64)
}

pub fn load_ppocr_model_with_det(
    shared_det: Option<&Arc<SharedDetSession>>,
    det_path: &Path,
    rec_path: &Path,
    dict_path: &Path,
    yaml: Option<&str>,
    name: &str,
    target_height: u32,
) -> Option<Arc<OcrEngineBackend>> {
    if !det_path.is_file() || !rec_path.is_file() || !dict_path.is_file() {
        eprintln!("⚠️ Model files not found for {name}: rec={rec_path:?}, dict={dict_path:?}");
        return None;
    }

    // 1. Prefer GPU ONNX Runtime execution (NVIDIA CUDA / DirectML)
    let det_handle = if let Some(existing) = shared_det {
        Ok(Arc::clone(existing))
    } else {
        SharedDetSession::load(det_path).map(Arc::new)
    };

    if let Ok(det) = det_handle {
        match GpuOcrEngine::load(det, rec_path, dict_path, target_height) {
            Ok(gpu_engine) => {
                println!(
                    "🚀 OCR Model: {name} loaded on {} (Zero CPU bottleneck)",
                    gpu_engine.ep_name
                );
                return Some(Arc::new(OcrEngineBackend::Gpu(Arc::new(gpu_engine))));
            }
            Err(e) => {
                eprintln!("⚠️ GPU OCR init failed for {name}, falling back to CPU tract-onnx: {e}");
            }
        }
    }

    // 2. Fallback to pure_onnx_ocr (CPU tract-onnx)
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
            println!("🚀 OCR Model: {name} loaded successfully (CPU fallback)");
            Some(Arc::new(OcrEngineBackend::Cpu(Arc::new(engine))))
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

    // Share ONE DBNet detection session in GPU VRAM across all 5 languages
    let shared_det = if config.det_model_path.is_file() {
        SharedDetSession::load(&config.det_model_path)
            .ok()
            .map(Arc::new)
    } else {
        None
    };

    // 1. Model chuyên dụng Tiếng Việt (VietOCR VieSVTR - 229 ký tự dấu, chiều cao 64px)
    let vietnamese = load_ppocr_model_with_det(
        shared_det.as_ref(),
        &config.det_model_path,
        &config.vi_rec_model_path,
        &config.vi_dict_path,
        Some(vi_yaml),
        "VietOCR Native Model (VieSVTR / Tiếng Việt)",
        64,
    );

    // 2. Model chuyên dụng Tiếng Anh (PP-OCRv4 Latin / English - 95 ký tự, chiều cao 48px)
    let english = load_ppocr_model_with_det(
        shared_det.as_ref(),
        &config.det_model_path,
        &config.en_rec_model_path,
        &config.en_dict_path,
        Some(ppocr_yaml),
        "PP-OCRv4 English Dedicated Model",
        48,
    );

    // 3. Model chuyên dụng Tiếng Trung (PP-OCRv4 Chinese - 6625 ký tự Hán, chiều cao 48px)
    let chinese = load_ppocr_model_with_det(
        shared_det.as_ref(),
        &config.det_model_path,
        &config.zh_rec_model_path,
        &config.zh_dict_path,
        Some(ppocr_yaml),
        "PP-OCRv4 Chinese Dedicated Model",
        48,
    );

    // 4. Model chuyên dụng Tiếng Nhật (PP-OCRv3 Japanese - 4399 ký tự, chiều cao 48px)
    let japanese = load_ppocr_model_with_det(
        shared_det.as_ref(),
        &config.det_model_path,
        &config.ja_rec_model_path,
        &config.ja_dict_path,
        Some(ppocr_yaml),
        "PP-OCRv3 Japanese Dedicated Model",
        48,
    );

    // 5. Model chuyên dụng Tiếng Hàn (PP-OCRv3 Korean - Hangul, chiều cao 48px)
    let korean = load_ppocr_model_with_det(
        shared_det.as_ref(),
        &config.det_model_path,
        &config.ko_rec_model_path,
        &config.ko_dict_path,
        Some(ppocr_yaml),
        "PP-OCRv3 Korean Dedicated Model",
        48,
    );

    // 6. Model chuyên dụng Tiếng Thái (PP-OCRv5 Thai, chiều cao 32px)
    let th_yaml = "PreProcess:\n  transform_ops:\n  - RecResizeImg:\n      image_shape:\n      - 3\n      - 32\n      - 320\nPostProcess:\n  name: CTCLabelDecode\n";
    let thai = load_ppocr_model_with_det(
        shared_det.as_ref(),
        &config.det_model_path,
        &config.th_rec_model_path,
        &config.th_dict_path,
        Some(th_yaml),
        "PP-OCRv5 Thai Dedicated Model",
        32,
    );

    OcrEnginePool {
        vietnamese,
        english,
        chinese,
        japanese,
        korean,
        thai,
    }
}

pub fn load_ppocr_vietnamese(
    det_path: &Path,
    rec_path: &Path,
    dict_path: &Path,
) -> Option<Arc<OcrEngineBackend>> {
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
