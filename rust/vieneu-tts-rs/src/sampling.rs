use std::collections::VecDeque;
use rand::Rng;

pub const DEFAULT_REP_WINDOW: usize = 64;

pub struct RepetitionHistory {
    channels: Vec<VecDeque<i64>>,
    window: usize,
}

impl RepetitionHistory {
    pub fn new(n_channels: usize, window: usize) -> Self {
        let mut channels = Vec::with_capacity(n_channels);
        for _ in 0..n_channels {
            channels.push(VecDeque::with_capacity(window + 1));
        }
        Self { channels, window }
    }

    pub fn add(&mut self, channel: usize, code: i64) {
        if let Some(deque) = self.channels.get_mut(channel) {
            deque.push_back(code);
            if deque.len() > self.window {
                deque.pop_front();
            }
        }
    }

    pub fn get_channel(&self, channel: usize) -> Option<&VecDeque<i64>> {
        self.channels.get(channel)
    }
}

pub fn sample(
    logits: &[f32],
    temperature: f32,
    top_k: usize,
    top_p: f32,
    rep_pen: f32,
    history: Option<&VecDeque<i64>>,
    rng: &mut impl Rng,
) -> i64 {
    let mut modified: Vec<f32> = logits.to_vec();

    // Apply repetition penalty
    if (rep_pen - 1.0).abs() > 1e-4 {
        if let Some(hist) = history {
            for &code in hist {
                let idx = code as usize;
                if idx < modified.len() {
                    let val = modified[idx];
                    modified[idx] = if val < 0.0 { val * rep_pen } else { val / rep_pen };
                }
            }
        }
    }

    // Greedy argmax if temperature <= 0
    if temperature <= 0.0 {
        let mut max_val = f32::NEG_INFINITY;
        let mut max_idx = 0;
        for (i, &v) in modified.iter().enumerate() {
            if v > max_val {
                max_val = v;
                max_idx = i;
            }
        }
        return max_idx as i64;
    }

    let inv_temp = 1.0 / temperature;
    for v in &mut modified {
        *v *= inv_temp;
    }

    let v_len = modified.len();
    let mut candidates: Vec<usize> = (0..v_len).collect();

    // Top-K selection
    if top_k > 0 && top_k < v_len {
        candidates.sort_unstable_by(|&a, &b| {
            modified[b]
                .partial_cmp(&modified[a])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        candidates.truncate(top_k);
    } else {
        candidates.sort_unstable_by(|&a, &b| {
            modified[b]
                .partial_cmp(&modified[a])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    // Softmax over sorted candidates
    let max_logit = modified[candidates[0]];
    let mut exp_vals = Vec::with_capacity(candidates.len());
    let mut sum_exp = 0.0f32;
    for &idx in &candidates {
        let e = (modified[idx] - max_logit).exp();
        exp_vals.push(e);
        sum_exp += e;
    }

    let inv_sum = 1.0 / sum_exp.max(1e-12);
    let mut probs: Vec<f32> = exp_vals.into_iter().map(|e| e * inv_sum).collect();

    // Top-P (nucleus) filtering
    if top_p > 0.0 && top_p < 1.0 {
        let mut cum_sum = 0.0f32;
        let mut cutoff = candidates.len();
        for (i, &p) in probs.iter().enumerate() {
            cum_sum += p;
            if cum_sum > top_p {
                cutoff = i + 1;
                break;
            }
        }
        candidates.truncate(cutoff);
        probs.truncate(cutoff);

        let p_sum: f32 = probs.iter().sum();
        let inv_p_sum = 1.0 / p_sum.max(1e-12);
        for p in &mut probs {
            *p *= inv_p_sum;
        }
    }

    // Sample from categorical distribution
    let r: f32 = rng.gen();
    let mut acc = 0.0f32;
    for (i, &p) in probs.iter().enumerate() {
        acc += p;
        if r <= acc || i == probs.len() - 1 {
            return candidates[i] as i64;
        }
    }

    candidates[0] as i64
}
