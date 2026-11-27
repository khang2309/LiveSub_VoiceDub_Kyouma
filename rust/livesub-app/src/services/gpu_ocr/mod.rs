pub mod geometry;

use geo_types::Polygon;
use geometry::{aspect_ratio, build_gpu_session, polygon_to_text_region};
use image::{imageops, DynamicImage, GenericImageView, RgbImage};
use ndarray::{Array2, Array3, Ix4};
use ort::session::Session;
use ort::value::Tensor;
use pure_onnx_ocr::crop::{crop_quad, min_area_quad};
use pure_onnx_ocr::dictionary::RecDictionary;
use pure_onnx_ocr::engine::OcrResult;
use pure_onnx_ocr::postprocessing::{
    DetPolygonUnclipper, DetPolygonUnclipperConfig, DetPostProcessor, DetPostProcessorConfig,
};
use pure_onnx_ocr::preprocessing::{
    DetPreProcessor, DetPreProcessorConfig, RecPreProcessor, RecPreProcessorConfig,
};
use pure_onnx_ocr::recognition::{RecInferenceOutput, RecPostProcessor, RecPostProcessorConfig};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Unified OCR backend enum allowing CUDA/DirectML GPU execution with safe CPU fallback.
pub enum OcrEngineBackend {
    Gpu(Arc<GpuOcrEngine>),
    Cpu(Arc<pure_onnx_ocr::OcrEngine>),
}

impl OcrEngineBackend {
    pub fn run_from_image(&self, image: &DynamicImage) -> Result<Vec<OcrResult>, String> {
        match self {
            OcrEngineBackend::Gpu(engine) => engine.run_from_image(image),
            OcrEngineBackend::Cpu(engine) => {
                engine.run_from_image(image).map_err(|e| e.to_string())
            }
        }
    }

    pub fn is_gpu(&self) -> bool {
        matches!(self, OcrEngineBackend::Gpu(_))
    }

    pub fn device_label(&self) -> &'static str {
        match self {
            OcrEngineBackend::Gpu(e) => e.ep_name,
            OcrEngineBackend::Cpu(_) => "CPU (tract-onnx fallback)",
        }
    }
}

/// Shared ONNX Runtime detection session (loaded once in GPU VRAM across all languages).
pub struct SharedDetSession {
    pub session: Mutex<Session>,
    pub input_name: String,
    pub ep_name: &'static str,
}

/// GPU-accelerated OCR Engine running DBNet detection and SVTR/VieSVTR recognition via `ort`.
pub struct GpuOcrEngine {
    det: Arc<SharedDetSession>,
    rec_session: Mutex<Session>,
    rec_input_name: String,
    det_pre: DetPreProcessor,
    det_post: DetPostProcessor,
    det_unclipper: DetPolygonUnclipper,
    rec_pre: RecPreProcessor,
    rec_post: RecPostProcessor,
    rec_batch_size: usize,
    pub ep_name: &'static str,
}

impl SharedDetSession {
    pub fn load(det_path: &Path) -> Result<Self, String> {
        let (session, ep_name) = build_gpu_session(det_path)?;
        let input_name = session
            .inputs()
            .first()
            .map(|o| o.name().to_string())
            .unwrap_or_else(|| "x".to_string());
        Ok(Self {
            session: Mutex::new(session),
            input_name,
            ep_name,
        })
    }
}

impl GpuOcrEngine {
    pub fn load(
        det: Arc<SharedDetSession>,
        rec_path: &Path,
        dict_path: &Path,
        target_height: u32,
    ) -> Result<Self, String> {
        let (rec_session, ep_name) = build_gpu_session(rec_path)?;
        let rec_input_name = rec_session
            .inputs()
            .first()
            .map(|o| o.name().to_string())
            .unwrap_or_else(|| "x".to_string());

        let mut dictionary = RecDictionary::from_path(dict_path)
            .map_err(|e| format!("Dictionary load error {:?}: {e}", dict_path))?;
        if let Some(shape) = rec_session
            .outputs()
            .first()
            .and_then(|o| o.dtype().tensor_shape())
        {
            if let Some(&classes) = shape.last() {
                if classes > 0 && (classes as usize) > dictionary.len() {
                    dictionary = dictionary.with_space_char();
                }
            }
        }
        let dictionary = Arc::new(dictionary);
        let rec_post = RecPostProcessor::new(
            Arc::clone(&dictionary),
            RecPostProcessorConfig {
                blank_id: dictionary.blank_id(),
                ..Default::default()
            },
        );

        let rec_pre = RecPreProcessor::new(RecPreProcessorConfig {
            target_height,
            max_width: 320,
            ..Default::default()
        });

        Ok(Self {
            det,
            rec_session: Mutex::new(rec_session),
            rec_input_name,
            det_pre: DetPreProcessor::new(DetPreProcessorConfig {
                limit_side_len: 1600,
                ..Default::default()
            }),
            det_post: DetPostProcessor::new(DetPostProcessorConfig::default()),
            det_unclipper: DetPolygonUnclipper::new(DetPolygonUnclipperConfig {
                unclip_ratio: 1.65,
                ..Default::default()
            }),
            rec_pre,
            rec_post,
            rec_batch_size: 8,
            ep_name,
        })
    }

    pub fn run_from_image(&self, image: &DynamicImage) -> Result<Vec<OcrResult>, String> {
        let image_dims = image.dimensions();
        if image_dims.0 == 0 || image_dims.1 == 0 {
            return Ok(Vec::new());
        }

        let preprocessed_det = self.det_pre.process(image).map_err(|e| e.to_string())?;
        let det_view = preprocessed_det
            .tensor
            .to_plain_array_view::<f32>()
            .map_err(|e| e.to_string())?;
        let det_arr4 = det_view
            .into_dimensionality::<Ix4>()
            .map_err(|e| e.to_string())?
            .to_owned();

        let probability_map: Array2<f32> = {
            let mut sess = self
                .det
                .session
                .lock()
                .map_err(|e| format!("DET lock poisoned: {e}"))?;
            let det_inputs = ort::inputs![
                self.det.input_name.as_str() => Tensor::from_array(det_arr4).map_err(|e| e.to_string())?,
            ];
            let outputs = sess.run(det_inputs).map_err(|e| e.to_string())?;
            let (shape, data) = outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let dims = shape.as_ref();
            if dims.len() != 4 || dims[0] != 1 || dims[1] != 1 || dims[2] <= 0 || dims[3] <= 0 {
                return Err(format!("Unexpected DBNet output shape: {:?}", dims));
            }
            Array2::from_shape_vec((dims[2] as usize, dims[3] as usize), data.to_vec())
                .map_err(|e| e.to_string())?
        };

        let boxes = self
            .det_post
            .db_boxes(&probability_map, &self.det_unclipper)
            .map_err(|e| e.to_string())?;
        if boxes.is_empty() {
            return Ok(Vec::new());
        }

        let (scale_x, scale_y) = preprocessed_det.inverse_scale();
        let (width_f, height_f) = (image_dims.0 as f64, image_dims.1 as f64);
        let mut polygons: Vec<Polygon<f64>> = boxes
            .into_iter()
            .map(|det_box| {
                let mut coords: Vec<geo_types::Coord<f64>> = det_box
                    .quad
                    .iter()
                    .map(|&(x, y)| geo_types::Coord {
                        x: (x * scale_x).round().clamp(0.0, width_f),
                        y: (y * scale_y).round().clamp(0.0, height_f),
                    })
                    .collect();
                let min_y = coords.iter().map(|c| c.y).fold(f64::INFINITY, f64::min);
                let max_y = coords.iter().map(|c| c.y).fold(f64::NEG_INFINITY, f64::max);
                let pad_y = ((max_y - min_y) * 0.16).clamp(3.0, 14.0);
                for c in &mut coords {
                    if (c.y - min_y) <= (max_y - min_y) * 0.5 {
                        c.y = (c.y - pad_y).clamp(0.0, height_f);
                    } else {
                        c.y = (c.y + pad_y).clamp(0.0, height_f);
                    }
                }
                coords.push(coords[0]);
                Polygon::new(geo_types::LineString::from(coords), vec![])
            })
            .collect();

        let img_w_f = image_dims.0 as f64;
        if img_w_f > 100.0 && !polygons.is_empty() {
            let max_box_h = polygons
                .iter()
                .map(|p| polygon_to_text_region(p, image_dims).height as f64)
                .fold(0.0_f64, f64::max);
            polygons.retain(|p| {
                let r = polygon_to_text_region(p, image_dims);
                let w = r.width as f64;
                let h = r.height as f64;
                let cx = r.x as f64 + w * 0.5;
                let is_extreme_corner = cx < img_w_f * 0.12 || cx > img_w_f * 0.88;
                let is_tiny_corner =
                    is_extreme_corner && w < img_w_f * 0.15 && h <= (max_box_h * 0.85).max(32.0);
                !is_tiny_corner
            });
            if polygons.is_empty() {
                return Ok(Vec::new());
            }
        }

        polygons.sort_by(|a, b| {
            let ra = polygon_to_text_region(a, image_dims);
            let rb = polygon_to_text_region(b, image_dims);
            let row_tol = (ra.height.min(rb.height) / 2).max(8);
            if ra.y.abs_diff(rb.y) <= row_tol {
                ra.x.cmp(&rb.x)
            } else {
                ra.y.cmp(&rb.y)
            }
        });

        let rec_target_h = self.rec_pre.config().target_height;
        let rgb = image.to_rgb8();
        let crops: Vec<RgbImage> = polygons
            .iter()
            .map(|polygon| {
                let crop = if let Some(c) =
                    min_area_quad(polygon).and_then(|quad| crop_quad(&rgb, &quad))
                {
                    c
                } else {
                    let region = polygon_to_text_region(polygon, image_dims);
                    imageops::crop_imm(&rgb, region.x, region.y, region.width, region.height)
                        .to_image()
                };
                if crop.height() > 0 && crop.height() < rec_target_h {
                    let new_w = ((crop.width() as f32)
                        * (rec_target_h as f32 / crop.height() as f32))
                        .round()
                        .max(1.0) as u32;
                    imageops::resize(&crop, new_w, rec_target_h, imageops::FilterType::Lanczos3)
                } else {
                    crop
                }
            })
            .collect();

        if crops.is_empty() {
            return Ok(Vec::new());
        }

        let mut order: Vec<usize> = (0..crops.len()).collect();
        order.sort_by(|&a, &b| aspect_ratio(&crops[a]).total_cmp(&aspect_ratio(&crops[b])));
        let chunks: Vec<&[usize]> = order.chunks(self.rec_batch_size.max(1)).collect();

        let mut ordered_results: Vec<Option<OcrResult>> = vec![None; crops.len()];

        for chunk in chunks {
            let batch_crops: Vec<RgbImage> = chunk.iter().map(|&idx| crops[idx].clone()).collect();
            let rec_batch = self
                .rec_pre
                .process_images(&batch_crops)
                .map_err(|e| e.to_string())?;
            let rec_view = rec_batch
                .tensor
                .to_plain_array_view::<f32>()
                .map_err(|e| e.to_string())?;
            let rec_arr4 = rec_view
                .into_dimensionality::<Ix4>()
                .map_err(|e| e.to_string())?
                .to_owned();
            let batch_size = rec_arr4.shape()[0];

            let logits: Array3<f32> = {
                let mut sess = self
                    .rec_session
                    .lock()
                    .map_err(|e| format!("REC lock poisoned: {e}"))?;
                let rec_inputs = ort::inputs![
                    self.rec_input_name.as_str() => Tensor::from_array(rec_arr4).map_err(|e| e.to_string())?,
                ];
                let outputs = sess.run(rec_inputs).map_err(|e| e.to_string())?;
                let (shape, data) = outputs[0]
                    .try_extract_tensor::<f32>()
                    .map_err(|e| e.to_string())?;
                let dims = shape.as_ref();
                if dims.len() != 3 || dims[0] as usize != batch_size {
                    return Err(format!("Unexpected REC output shape: {:?}", dims));
                }
                Array3::from_shape_vec(
                    (dims[0] as usize, dims[1] as usize, dims[2] as usize),
                    data.to_vec(),
                )
                .map_err(|e| e.to_string())?
            };

            let time_steps = logits.dim().1;
            let max_width = rec_batch.max_width as f32;
            let scale = if max_width > 0.0 {
                time_steps as f32 / max_width
            } else {
                0.0
            };
            let valid_timesteps = rec_batch
                .valid_widths
                .iter()
                .map(|w| {
                    let mut steps = if scale > 0.0 {
                        (scale * *w as f32).round() as isize
                    } else {
                        time_steps as isize
                    };
                    steps = steps.clamp(1, time_steps as isize);
                    steps as usize
                })
                .collect::<Vec<_>>();

            let rec_out = RecInferenceOutput {
                logits,
                valid_timesteps,
            };
            let decoded = self.rec_post.process(&rec_out).map_err(|e| e.to_string())?;

            for (&orig_idx, seq) in chunk.iter().zip(decoded) {
                ordered_results[orig_idx] = Some(OcrResult {
                    text: seq.text,
                    confidence: seq.confidence,
                    bounding_box: polygons[orig_idx].clone(),
                });
            }
        }

        let mut results = Vec::with_capacity(crops.len());
        for item in ordered_results {
            if let Some(res) = item {
                results.push(res);
            }
        }
        Ok(results)
    }
}
