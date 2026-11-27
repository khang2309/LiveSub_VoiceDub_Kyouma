use geo_types::Polygon;
use image::RgbImage;
use ort::ep::{DirectML, CUDA};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use pure_onnx_ocr::preprocessing::RecTextRegion;
use std::path::Path;

pub fn build_gpu_session(model_path: &Path) -> Result<(Session, &'static str), String> {
    let env = vieneu_tts_rs::shared_ort_env().map_err(|e| e.to_string())?;

    if let Ok(builder) = Session::builder(&env) {
        let b = builder
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap_or_else(|e| e.recover())
            .with_intra_threads(1)
            .unwrap_or_else(|e| e.recover());
        if let Ok(mut b_cuda) =
            b.with_execution_providers([CUDA::default().build().error_on_failure()])
        {
            if let Ok(sess) = b_cuda.commit_from_file(model_path) {
                return Ok((sess, "NVIDIA CUDA GPU"));
            }
        }
    }

    if let Ok(builder) = Session::builder(&env) {
        let b = builder
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .unwrap_or_else(|e| e.recover())
            .with_intra_threads(1)
            .unwrap_or_else(|e| e.recover())
            .with_memory_pattern(false)
            .unwrap_or_else(|e| e.recover())
            .with_parallel_execution(false)
            .unwrap_or_else(|e| e.recover());
        if let Ok(mut b_dml) =
            b.with_execution_providers([DirectML::default().build().error_on_failure()])
        {
            if let Ok(sess) = b_dml.commit_from_file(model_path) {
                return Ok((sess, "DirectML GPU (RTX 3050 DirectX 12)"));
            }
        }
    }

    Err(format!(
        "Neither CUDA nor DirectML GPU EP could initialize for {:?}",
        model_path
    ))
}

pub fn aspect_ratio(image: &RgbImage) -> f32 {
    let height = image.height().max(1) as f32;
    image.width() as f32 / height
}

pub fn polygon_to_text_region(polygon: &Polygon<f64>, image_dims: (u32, u32)) -> RecTextRegion {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for point in polygon.exterior().points() {
        min_x = min_x.min(point.x());
        max_x = max_x.max(point.x());
        min_y = min_y.min(point.y());
        max_y = max_y.max(point.y());
    }

    let image_width = image_dims.0.max(1);
    let image_height = image_dims.1.max(1);
    let width_limit = image_width as f64;
    let height_limit = image_height as f64;

    let mut x1 = min_x.floor().max(0.0);
    let mut y1 = min_y.floor().max(0.0);
    let mut x2 = max_x.ceil().min(width_limit);
    let mut y2 = max_y.ceil().min(height_limit);

    if x2 <= x1 {
        x2 = (x1 + 1.0).min(width_limit);
    }
    if y2 <= y1 {
        y2 = (y1 + 1.0).min(height_limit);
    }
    if x2 <= x1 {
        x1 = (width_limit - 1.0).max(0.0);
        x2 = width_limit;
    }
    if y2 <= y1 {
        y1 = (height_limit - 1.0).max(0.0);
        y2 = height_limit;
    }

    let x = (x1.floor() as u32).min(image_width - 1);
    let y = (y1.floor() as u32).min(image_height - 1);
    let width = ((x2 - x1).ceil().max(1.0) as u32)
        .min(image_width - x)
        .max(1);
    let height = ((y2 - y1).ceil().max(1.0) as u32)
        .min(image_height - y)
        .max(1);

    RecTextRegion {
        x,
        y,
        width,
        height,
    }
}
