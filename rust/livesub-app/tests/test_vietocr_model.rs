use pure_onnx_ocr::OcrEngineBuilder;
use std::path::PathBuf;

#[test]
fn test_load_vietocr_model() {
    let det_path = if PathBuf::from("models/ocr/ch_PP-OCRv4_det_infer.onnx").is_file() {
        PathBuf::from("models/ocr/ch_PP-OCRv4_det_infer.onnx")
    } else {
        PathBuf::from("../../models/ocr/ch_PP-OCRv4_det_infer.onnx")
    };
    let rec_path = if PathBuf::from("models/ocr/vietocr_viesvtr_v7.onnx").is_file() {
        PathBuf::from("models/ocr/vietocr_viesvtr_v7.onnx")
    } else {
        PathBuf::from("../../models/ocr/vietocr_viesvtr_v7.onnx")
    };
    let dict_path = if PathBuf::from("models/ocr/vietocr_keys.txt").is_file() {
        PathBuf::from("models/ocr/vietocr_keys.txt")
    } else {
        PathBuf::from("../../models/ocr/vietocr_keys.txt")
    };
    let img_path = if PathBuf::from("models/ocr/test_vi_sentence.png").is_file() {
        PathBuf::from("models/ocr/test_vi_sentence.png")
    } else {
        PathBuf::from("../../models/ocr/test_vi_sentence.png")
    };

    let yaml = "PreProcess:\n  transform_ops:\n  - RecResizeImg:\n      image_shape:\n      - 3\n      - 64\n      - 320\nPostProcess:\n  name: CTCLabelDecode\n";

    println!("Testing OcrEngineBuilder with VietOCR ONNX model...");
    let engine = OcrEngineBuilder::new()
        .det_model_path(&det_path)
        .rec_model_path(&rec_path)
        .dictionary_path(&dict_path)
        .rec_config_yaml(yaml)
        .build();

    match engine {
        Ok(engine) => {
            println!("✅ Successfully loaded VietOCR ONNX model with pure_onnx_ocr!");
            if img_path.is_file() {
                match engine.run_from_path(&img_path) {
                    Ok(results) => {
                        println!("Recognized {} text boxes:", results.len());
                        for (i, r) in results.iter().enumerate() {
                            println!("  Box #{}: text='{}', conf={:.2}", i, r.text, r.confidence);
                        }
                        assert!(!results.is_empty(), "Should recognize at least 1 box");
                    }
                    Err(e) => panic!("❌ Inference error: {:?}", e),
                }
            } else {
                println!("ℹ️ Test image {:?} not found, skipping inference test.", img_path);
            }
        }
        Err(e) => panic!("❌ Load error: {:?}", e),
    }
}

#[test]
fn test_gpu_vietocr_inference() {
    let det_path = if PathBuf::from("models/ocr/ch_PP-OCRv4_det_infer.onnx").is_file() {
        PathBuf::from("models/ocr/ch_PP-OCRv4_det_infer.onnx")
    } else {
        PathBuf::from("../../models/ocr/ch_PP-OCRv4_det_infer.onnx")
    };
    let rec_path = if PathBuf::from("models/ocr/vietocr_viesvtr_v7.onnx").is_file() {
        PathBuf::from("models/ocr/vietocr_viesvtr_v7.onnx")
    } else {
        PathBuf::from("../../models/ocr/vietocr_viesvtr_v7.onnx")
    };
    let dict_path = if PathBuf::from("models/ocr/vietocr_keys.txt").is_file() {
        PathBuf::from("models/ocr/vietocr_keys.txt")
    } else {
        PathBuf::from("../../models/ocr/vietocr_keys.txt")
    };
    if !det_path.is_file() || !rec_path.is_file() || !dict_path.is_file() {
        return;
    }

    let backend = livesub_app::services::ocr::load_ppocr_vietnamese(&det_path, &rec_path, &dict_path)
        .expect("Should load VietOCR backend");
    println!("Loaded VietOCR backend on: {}", backend.device_label());
    assert!(backend.is_gpu(), "Expected GPU execution provider for VietOCR");

    // Verify inference runs without error on GPU
    let img = image::DynamicImage::new_rgb8(640, 128);
    let res = backend.run_from_image(&img).expect("GPU inference should succeed");
    assert!(res.is_empty());
}
