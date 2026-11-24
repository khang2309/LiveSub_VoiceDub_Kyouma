use std::path::Path;
use ndarray::{Array1, Array2, Array3};
use crate::error::VieneuError;

pub struct VieneuHeads {
    pub text_emb: Array2<f32>,     // (419, 768)
    pub audio_emb: Array3<f32>,    // (16, 1024, 768)
    pub xvec_w: Array2<f32>,       // (768, 192)
    pub xvec_b: Array1<f32>,       // (768,)
    pub xvec_ln_w: Array1<f32>,    // (768,)
    pub xvec_ln_b: Array1<f32>,    // (768,)
    pub xvec_ln_eps: f32,
}

impl VieneuHeads {
    pub fn load_from_dir<P: AsRef<Path>>(dir: P) -> Result<Self, VieneuError> {
        let dir = dir.as_ref();

        let text_emb_bytes = std::fs::read(dir.join("text_emb.bin"))?;
        let audio_emb_bytes = std::fs::read(dir.join("audio_emb.bin"))?;
        let xvec_w_bytes = std::fs::read(dir.join("xvec_w.bin"))?;
        let xvec_b_bytes = std::fs::read(dir.join("xvec_b.bin"))?;
        let xvec_ln_w_bytes = std::fs::read(dir.join("xvec_ln_w.bin"))?;
        let xvec_ln_b_bytes = std::fs::read(dir.join("xvec_ln_b.bin"))?;
        let xvec_ln_eps_bytes = std::fs::read(dir.join("xvec_ln_eps.bin"))?;

        let text_emb_vec = Self::bytes_to_f32_vec(&text_emb_bytes)?;
        let audio_emb_vec = Self::bytes_to_f32_vec(&audio_emb_bytes)?;
        let xvec_w_vec = Self::bytes_to_f32_vec(&xvec_w_bytes)?;
        let xvec_b_vec = Self::bytes_to_f32_vec(&xvec_b_bytes)?;
        let xvec_ln_w_vec = Self::bytes_to_f32_vec(&xvec_ln_w_bytes)?;
        let xvec_ln_b_vec = Self::bytes_to_f32_vec(&xvec_ln_b_bytes)?;
        let xvec_ln_eps_vec = Self::bytes_to_f32_vec(&xvec_ln_eps_bytes)?;

        let text_emb = Array2::from_shape_vec((419, 768), text_emb_vec)
            .map_err(|e| VieneuError::InvalidTensor(format!("text_emb shape: {}", e)))?;

        let audio_emb = Array3::from_shape_vec((16, 1024, 768), audio_emb_vec)
            .map_err(|e| VieneuError::InvalidTensor(format!("audio_emb shape: {}", e)))?;

        let xvec_w = Array2::from_shape_vec((768, 192), xvec_w_vec)
            .map_err(|e| VieneuError::InvalidTensor(format!("xvec_w shape: {}", e)))?;

        let xvec_b = Array1::from_shape_vec(768, xvec_b_vec)
            .map_err(|e| VieneuError::InvalidTensor(format!("xvec_b shape: {}", e)))?;

        let xvec_ln_w = Array1::from_shape_vec(768, xvec_ln_w_vec)
            .map_err(|e| VieneuError::InvalidTensor(format!("xvec_ln_w shape: {}", e)))?;

        let xvec_ln_b = Array1::from_shape_vec(768, xvec_ln_b_vec)
            .map_err(|e| VieneuError::InvalidTensor(format!("xvec_ln_b shape: {}", e)))?;

        let xvec_ln_eps = xvec_ln_eps_vec.get(0).copied().unwrap_or(1e-5);

        Ok(Self {
            text_emb,
            audio_emb,
            xvec_w,
            xvec_b,
            xvec_ln_w,
            xvec_ln_b,
            xvec_ln_eps,
        })
    }

    fn bytes_to_f32_vec(bytes: &[u8]) -> Result<Vec<f32>, VieneuError> {
        if bytes.len() % 4 != 0 {
            return Err(VieneuError::InvalidTensor("Byte length not multiple of 4".into()));
        }
        let count = bytes.len() / 4;
        let mut out = Vec::with_capacity(count);
        for chunk in bytes.chunks_exact(4) {
            let val = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            out.push(val);
        }
        Ok(out)
    }

    pub fn speaker_anchor(&self, speaker_emb: &[f32]) -> Result<Array1<f32>, VieneuError> {
        if speaker_emb.len() != 192 {
            return Err(VieneuError::InvalidTensor(format!(
                "speaker_emb length must be 192, got {}",
                speaker_emb.len()
            )));
        }

        // v = speaker_emb @ xvec_w.T + xvec_b
        // xvec_w is (768, 192). For each row i in 0..768:
        // v[i] = sum_j (speaker_emb[j] * xvec_w[i, j]) + xvec_b[i]
        let mut v = vec![0.0f32; 768];
        let mut sum = 0.0f64;
        for i in 0..768 {
            let mut dot = 0.0f32;
            for j in 0..192 {
                dot += speaker_emb[j] * self.xvec_w[[i, j]];
            }
            let val = dot + self.xvec_b[i];
            v[i] = val;
            sum += val as f64;
        }

        let mean = (sum / 768.0) as f32;
        let mut var_sum = 0.0f64;
        for i in 0..768 {
            let diff = (v[i] - mean) as f64;
            var_sum += diff * diff;
        }
        let var = (var_sum / 768.0) as f32;
        let std_inv = 1.0 / (var + self.xvec_ln_eps).sqrt();

        let mut anchor = Array1::<f32>::zeros(768);
        for i in 0..768 {
            let norm = (v[i] - mean) * std_inv;
            anchor[i] = norm * self.xvec_ln_w[i] + self.xvec_ln_b[i];
        }

        Ok(anchor)
    }

    pub fn embed_rows(
        &self,
        rows: &Array2<i64>,
        anchor: Option<&Array1<f32>>,
    ) -> Array3<f32> {
        let t_len = rows.nrows();
        let mut emb = Array2::<f32>::zeros((t_len, 768));

        for t in 0..t_len {
            let text_id = rows[[t, 0]] as usize;
            if text_id < 419 {
                for h in 0..768 {
                    emb[[t, h]] += self.text_emb[[text_id, h]];
                }
            }

            for ch in 0..16 {
                let code = rows[[t, ch + 1]];
                if code != 1024 && code >= 0 && (code as usize) < 1024 {
                    let c = code as usize;
                    for h in 0..768 {
                        emb[[t, h]] += self.audio_emb[[ch, c, h]];
                    }
                }
            }

            if let Some(anc) = anchor {
                for h in 0..768 {
                    emb[[t, h]] += anc[h];
                }
            }
        }

        // Insert batch axis: (1, T, 768)
        emb.insert_axis(ndarray::Axis(0))
    }
}
