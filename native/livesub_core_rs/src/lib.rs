use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use pyo3::exceptions::PyRuntimeError;
use pyo3::prelude::*;

#[derive(Clone, Debug)]
struct CaptionEntry {
    source: String,
    canonical: String,
    seen_at_ms: u64,
}

#[derive(Default)]
struct SessionState {
    entries: VecDeque<CaptionEntry>,
    last_sequence: HashMap<String, u64>,
}

#[derive(Debug, PartialEq)]
struct GateDecision {
    accepted: bool,
    similarity: f64,
    reason: &'static str,
}

#[pyclass]
pub struct CaptionGate {
    sessions: Mutex<HashMap<String, SessionState>>,
    window_ms: u64,
    max_entries: usize,
}

#[pymethods]
impl CaptionGate {
    #[new]
    #[pyo3(signature = (window_ms=5000, max_entries=32))]
    fn new(window_ms: u64, max_entries: usize) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            window_ms,
            max_entries,
        }
    }

    fn check(
        &self,
        session_id: &str,
        source: &str,
        text: &str,
        sequence: u64,
        now_ms: u64,
    ) -> PyResult<(bool, f64, String)> {
        let decision = self
            .check_inner(session_id, source, text, sequence, now_ms)
            .map_err(PyRuntimeError::new_err)?;
        Ok((
            decision.accepted,
            decision.similarity,
            decision.reason.to_owned(),
        ))
    }

    #[pyo3(signature = (session_id=None))]
    fn reset(&self, session_id: Option<&str>) -> PyResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| PyRuntimeError::new_err("caption gate lock poisoned"))?;
        if let Some(id) = session_id {
            sessions.remove(id);
        } else {
            sessions.clear();
        }
        Ok(())
    }
}

impl CaptionGate {
    fn check_inner(
        &self,
        session_id: &str,
        source: &str,
        text: &str,
        sequence: u64,
        now_ms: u64,
    ) -> Result<GateDecision, String> {
        let canonical = canonicalize_caption(text);
        if canonical.is_empty() {
            return Ok(GateDecision {
                accepted: false,
                similarity: 0.0,
                reason: "empty",
            });
        }

        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "caption gate lock poisoned".to_owned())?;
        let state = sessions.entry(session_id.to_owned()).or_default();

        state
            .entries
            .retain(|entry| now_ms.saturating_sub(entry.seen_at_ms) <= self.window_ms);

        if sequence > 0 {
            if let Some(last_sequence) = state.last_sequence.get(source) {
                if sequence <= *last_sequence {
                    return Ok(GateDecision {
                        accepted: false,
                        similarity: 1.0,
                        reason: "stale_sequence",
                    });
                }
            }
            state.last_sequence.insert(source.to_owned(), sequence);
        }

        let mut best_similarity = 0.0_f64;
        for entry in &state.entries {
            let similarity = caption_similarity(&canonical, &entry.canonical);
            best_similarity = best_similarity.max(similarity);

            if entry.source != source && is_equivalent(&canonical, &entry.canonical, similarity) {
                return Ok(GateDecision {
                    accepted: false,
                    similarity,
                    reason: "cross_source_duplicate",
                });
            }

            if entry.source == source
                && canonical == entry.canonical
                && now_ms.saturating_sub(entry.seen_at_ms) <= self.window_ms
            {
                return Ok(GateDecision {
                    accepted: false,
                    similarity: 1.0,
                    reason: "same_source_duplicate",
                });
            }
        }

        state.entries.push_back(CaptionEntry {
            source: source.to_owned(),
            canonical,
            seen_at_ms: now_ms,
        });
        let max_entries = self.max_entries.max(1);
        while state.entries.len() > max_entries {
            state.entries.pop_front();
        }

        Ok(GateDecision {
            accepted: true,
            similarity: best_similarity,
            reason: "accepted",
        })
    }
}

#[pyfunction]
fn canonicalize_caption(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut pending_space = false;

    for character in text.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            if pending_space && !output.is_empty() {
                output.push(' ');
            }
            output.push(character);
            pending_space = false;
        } else {
            pending_space = !output.is_empty();
        }
    }

    output
}

fn is_equivalent(left: &str, right: &str, similarity: f64) -> bool {
    if left == right || similarity >= 0.88 {
        return true;
    }

    let (shorter, longer) = if left.len() <= right.len() {
        (left, right)
    } else {
        (right, left)
    };
    shorter.len() >= 12
        && longer.contains(shorter)
        && shorter.len() as f64 / longer.len() as f64 >= 0.82
}

fn caption_similarity(left: &str, right: &str) -> f64 {
    if left == right {
        return 1.0;
    }
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }

    let left_chars: Vec<char> = left.chars().collect();
    let right_chars: Vec<char> = right.chars().collect();
    let mut previous: Vec<usize> = (0..=right_chars.len()).collect();
    let mut current = vec![0; right_chars.len() + 1];

    for (left_index, left_char) in left_chars.iter().enumerate() {
        current[0] = left_index + 1;
        for (right_index, right_char) in right_chars.iter().enumerate() {
            let substitution = previous[right_index] + usize::from(left_char != right_char);
            let insertion = current[right_index] + 1;
            let deletion = previous[right_index + 1] + 1;
            current[right_index + 1] = substitution.min(insertion).min(deletion);
        }
        std::mem::swap(&mut previous, &mut current);
    }

    let max_len = left_chars.len().max(right_chars.len()) as f64;
    1.0 - previous[right_chars.len()] as f64 / max_len
}

#[pyfunction]
fn pcm16<'py>(py: Python<'py>, samples: &[u8]) -> PyResult<Bound<'py, pyo3::types::PyBytes>> {
    if samples.len() % 4 != 0 {
        return Err(pyo3::exceptions::PyValueError::new_err("incomplete float32 sample"));
    }
    pyo3::types::PyBytes::new_with(py, samples.len() / 2, |out| {
        for (src, dst) in samples.chunks_exact(4).zip(out.chunks_exact_mut(2)) {
            let value = f32::from_le_bytes(src.try_into().unwrap());
            dst.copy_from_slice(&((value.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
        Ok(())
    })
}

#[pymodule]
fn livesub_core_rs(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(pcm16, module)?)?;
    module.add_class::<CaptionGate>()?;
    module.add_function(wrap_pyfunction!(canonicalize_caption, module)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_case_punctuation_and_spacing() {
        assert_eq!(
            canonicalize_caption("  With the ARENA now smaller.  "),
            "with the arena now smaller"
        );
    }

    #[test]
    fn rejects_equivalent_caption_from_other_source_inside_window() {
        let gate = CaptionGate::new(5_000, 32);
        let first = gate
            .check_inner("session-a", "ocr", "With the arena now smaller.", 1, 1_000)
            .expect("first caption should be checked");
        let duplicate = gate
            .check_inner("session-a", "asr", "With the arena now smaller", 1, 1_400)
            .expect("second caption should be checked");

        assert!(first.accepted);
        assert!(!duplicate.accepted);
        assert_eq!(duplicate.reason, "cross_source_duplicate");
    }

    #[test]
    fn accepts_progressive_caption_from_same_source() {
        let gate = CaptionGate::new(5_000, 32);
        let _ = gate
            .check_inner("session-a", "ocr", "I engineer everything", 1, 1_000)
            .expect("first caption should be checked");
        let expanded = gate
            .check_inner(
                "session-a",
                "ocr",
                "I engineer everything that will happen in these games",
                2,
                1_700,
            )
            .expect("expanded caption should be checked");

        assert!(expanded.accepted);
    }

    #[test]
    fn accepts_same_caption_after_window_expires() {
        let gate = CaptionGate::new(2_000, 32);
        let _ = gate
            .check_inner("session-a", "ocr", "Thank you", 1, 1_000)
            .expect("first caption should be checked");
        let later = gate
            .check_inner("session-a", "asr", "Thank you", 1, 3_100)
            .expect("later caption should be checked");

        assert!(later.accepted);
    }

    #[test]
    fn rejects_stale_sequence_from_same_source() {
        let gate = CaptionGate::new(5_000, 32);
        let _ = gate
            .check_inner("session-a", "asr", "new line", 4, 1_000)
            .expect("new caption should be checked");
        let stale = gate
            .check_inner("session-a", "asr", "old line", 3, 1_100)
            .expect("stale caption should be checked");

        assert!(!stale.accepted);
        assert_eq!(stale.reason, "stale_sequence");
    }
}

