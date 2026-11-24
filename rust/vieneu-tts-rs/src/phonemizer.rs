use std::path::Path;
use regex::Regex;
use sea_g2p_rs::g2p::G2PEngine;
use sea_g2p_rs::lang::vi::Normalizer;
use sea_g2p_rs::punc::apply_punc_norm;
use crate::error::VieneuError;

pub struct VieneuPhonemizer {
    normalizer: Normalizer,
    engine: G2PEngine,
    emotion_split_re: Regex,
}

impl VieneuPhonemizer {
    pub fn new<P: AsRef<Path>>(dict_path: P) -> Result<Self, VieneuError> {
        let p_str = dict_path.as_ref().to_str().ok_or_else(|| {
            VieneuError::Phonemize("Dictionary path is not valid UTF-8".into())
        })?;

        let normalizer = Normalizer::new("vi", Some(p_str));
        let engine = G2PEngine::new(p_str)
            .map_err(|e| VieneuError::Phonemize(format!("Failed to load sea-g2p dictionary: {}", e)))?;

        let emotion_split_re = Regex::new(r"(\[[^\]]+\]|<\|emotion_\d+\|>)").unwrap();

        Ok(Self {
            normalizer,
            engine,
            emotion_split_re,
        })
    }

    fn map_emotion_tag(tag: &str) -> Option<&'static str> {
        let t = tag.trim();
        if t.starts_with("<|emotion_") && t.ends_with("|>") {
            // Keep already-resolved tokens
            return Some(match t {
                "<|emotion_1|>" => "<|emotion_1|>",
                "<|emotion_2|>" => "<|emotion_2|>",
                "<|emotion_3|>" => "<|emotion_3|>",
                _ => "<|emotion_1|>",
            });
        }
        if t.starts_with('[') && t.ends_with(']') {
            let inner = t[1..t.len() - 1].trim().to_lowercase();
            return match inner.as_str() {
                "chuckle" | "cười" | "cuoi" => Some("<|emotion_1|>"),
                "sigh" | "thở dài" | "tho dai" => Some("<|emotion_2|>"),
                "clear throat" | "hắng giọng" | "hang giong" => Some("<|emotion_3|>"),
                _ => None,
            };
        }
        None
    }

    pub fn phonemize(&self, text: &str) -> String {
        let text = text.trim();
        if text.is_empty() {
            return String::new();
        }

        if !text.contains('[') && !text.contains("<|emotion_") {
            let norm = self.normalizer.normalize(text, true);
            let phones = self.engine.phonemize(&norm);
            return apply_punc_norm(&phones);
        }

        let attaching_punct = ".,!?;:…)]}\"'’”";
        let mut out = String::new();

        // Split text by emotion patterns
        let mut last_idx = 0;
        for mat in self.emotion_split_re.find_iter(text) {
            let before = &text[last_idx..mat.start()];
            if !before.trim().is_empty() {
                let norm = self.normalizer.normalize(before, false);
                let phones = self.engine.phonemize(&norm);
                let ph = phones.trim();
                if !ph.is_empty() {
                    if out.is_empty() {
                        out.push_str(ph);
                    } else if let Some(first_char) = ph.chars().next() {
                        if attaching_punct.contains(first_char) {
                            out.push_str(ph);
                        } else {
                            out.push(' ');
                            out.push_str(ph);
                        }
                    }
                }
            }

            let token_str = mat.as_str();
            if let Some(emo) = Self::map_emotion_tag(token_str) {
                if out.is_empty() {
                    out.push_str(emo);
                } else {
                    out.push(' ');
                    out.push_str(emo);
                }
            } else {
                // Unrecognized bracket span, phonemize as text
                let norm = self.normalizer.normalize(token_str, false);
                let phones = self.engine.phonemize(&norm);
                let ph = phones.trim();
                if !ph.is_empty() {
                    if out.is_empty() {
                        out.push_str(ph);
                    } else {
                        out.push(' ');
                        out.push_str(ph);
                    }
                }
            }

            last_idx = mat.end();
        }

        let remainder = &text[last_idx..];
        if !remainder.trim().is_empty() {
            let norm = self.normalizer.normalize(remainder, false);
            let phones = self.engine.phonemize(&norm);
            let ph = phones.trim();
            if !ph.is_empty() {
                if out.is_empty() {
                    out.push_str(ph);
                } else if let Some(first_char) = ph.chars().next() {
                    if attaching_punct.contains(first_char) {
                        out.push_str(ph);
                    } else {
                        out.push(' ');
                        out.push_str(ph);
                    }
                }
            }
        }

        apply_punc_norm(&out)
    }
}
