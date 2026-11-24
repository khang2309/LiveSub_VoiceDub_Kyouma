use crate::lexicon::{strip_accents, Lexicon};
use regex::Regex;
use std::sync::OnceLock;

static RE_JUNK: OnceLock<Regex> = OnceLock::new();
static RE_NON_ALPHA: OnceLock<Regex> = OnceLock::new();

fn get_re_junk() -> &'static Regex {
    RE_JUNK.get_or_init(|| Regex::new(r"gq|q[a-tv-z]|q[^\w\s]|[\d]").unwrap())
}

fn get_re_non_alpha() -> &'static Regex {
    RE_NON_ALPHA.get_or_init(|| Regex::new(r"[^\wÀ-ỹ]").unwrap())
}

pub fn clean_rapid_macrons(word: &str, lexicon: &Lexicon) -> String {
    let tone_mapped = word
        .replace('ā', "ã")
        .replace('Ā', "Ã")
        .replace('ē', "ê")
        .replace('Ē', "Ê")
        .replace('ī', "ĩ")
        .replace('Ī', "Ĩ")
        .replace('ō', "ô")
        .replace('Ō', "Ô")
        .replace('ū', "ũ")
        .replace('Ū', "Ũ")
        .replace('å', "ả")
        .replace('Å', "Ả")
        .replace('ů', "ủ")
        .replace('Ů', "Ủ")
        .replace('ð', "ờ")
        .replace('Ð', "Ờ");

    let clean_core = get_re_non_alpha()
        .replace_all(&tone_mapped, "")
        .to_lowercase();
    if lexicon.is_valid_word(&clean_core) {
        return tone_mapped;
    }

    // Fall back to plain vowels
    word.replace('ā', "a")
        .replace('Ā', "A")
        .replace('ē', "e")
        .replace('Ē', "E")
        .replace('ī', "i")
        .replace('Ī', "I")
        .replace('ō', "o")
        .replace('Ō', "O")
        .replace('ū', "u")
        .replace('Ū', "U")
        .replace('å', "ả")
        .replace('Å', "Ả")
        .replace('ů', "ủ")
        .replace('Ů', "Ủ")
        .replace('ð', "ờ")
        .replace('Ð', "Ờ")
}

pub fn fuse_dual_engine_words(rapid_line: &str, secondary_line: &str, lexicon: &Lexicon) -> String {
    let rapid_words: Vec<&str> = rapid_line.split_whitespace().collect();
    let sec_words: Vec<&str> = secondary_line.split_whitespace().collect();

    if rapid_words.is_empty() {
        return secondary_line.to_string();
    }
    if sec_words.is_empty() {
        return rapid_line.to_string();
    }

    if rapid_words.len() == sec_words.len() {
        let mut fused = Vec::with_capacity(rapid_words.len());
        for (r_raw, s_raw) in rapid_words.iter().zip(sec_words.iter()) {
            let r_clean = clean_rapid_macrons(r_raw, lexicon);
            let s_clean = (*s_raw).to_string();

            let r_core = get_re_non_alpha().replace_all(&r_clean, "").to_string();
            let s_core = get_re_non_alpha().replace_all(&s_clean, "").to_string();

            let r_low = r_core.to_lowercase();
            let s_low = s_core.to_lowercase();

            let r_valid = lexicon.is_valid_word(&r_low) && r_low.chars().count() > 1;
            let s_valid = lexicon.is_valid_word(&s_low) && s_low.chars().count() > 1;

            let s_has_junk = get_re_junk().is_match(&s_low);

            // Single letter dropout recovery (e.g. 'đ' -> 'để')
            if r_core.chars().count() == 1 && s_core.chars().count() > 1 && s_valid && !s_has_junk {
                fused.push(s_clean);
                continue;
            }

            let r_base = strip_accents(&r_low);
            let s_base = strip_accents(&s_low);

            if r_valid && s_valid && !s_has_junk {
                if r_base == s_base {
                    // Same word: take secondary diacritics
                    fused.push(s_clean);
                } else {
                    // Different words: RapidOCR is primary detector, keep RapidOCR!
                    fused.push(r_clean);
                }
                continue;
            }

            if r_valid && (!s_valid || s_has_junk) {
                fused.push(r_clean);
                continue;
            }

            if !r_valid && s_valid && !s_has_junk {
                if r_base == s_base
                    || s_base.starts_with(&r_base)
                    || r_base.starts_with(&s_base)
                    || (r_base.len() as isize - s_base.len() as isize).abs() <= 2
                {
                    fused.push(s_clean);
                } else {
                    fused.push(r_clean);
                }
                continue;
            }

            if s_has_junk {
                fused.push(r_clean);
            } else {
                fused.push(if s_clean.len() >= r_clean.len() {
                    s_clean
                } else {
                    r_clean
                });
            }
        }
        return fused.join(" ");
    }

    // Word counts differ: select engine with higher valid word count
    let r_valid_count = rapid_words
        .iter()
        .filter(|w| lexicon.is_valid_word(&clean_rapid_macrons(w, lexicon)))
        .count();
    let s_valid_count = sec_words
        .iter()
        .filter(|w| lexicon.is_valid_word(w))
        .count();

    if s_valid_count >= r_valid_count && s_valid_count > 0 {
        secondary_line.to_string()
    } else {
        rapid_line.to_string()
    }
}
