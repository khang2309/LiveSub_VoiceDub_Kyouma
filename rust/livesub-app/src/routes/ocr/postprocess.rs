pub fn is_promotional_cta(text: &str) -> bool {
    let low = text
        .to_lowercase()
        .replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace(), " ");
    let normalized = low.split_whitespace().collect::<Vec<_>>().join(" ");
    let has_channel_context = ["kênh", "channel", "video", "chuông", "bell"]
        .iter()
        .any(|marker| normalized.contains(marker));

    normalized.contains("subscribe")
        || (has_channel_context
            && ["đăng ký", "theo dõi", "nhấn chuông", "bấm chuông", "ủng hộ"]
                .iter()
                .any(|intent| normalized.contains(intent)))
        || (normalized.contains("không bỏ lỡ") && normalized.contains("video"))
        || normalized.contains("like and subscribe")
        || normalized.contains("like share subscribe")
        || normalized.contains("thanks for watching")
        || normalized.contains("thank you for watching")
}

pub fn is_pure_ocr_junk(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() || t.contains("[UNK]") || is_promotional_cta(t) {
        return true;
    }
    static RE_JUNK_TIMECODE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_tc = RE_JUNK_TIMECODE.get_or_init(|| {
        regex::Regex::new(r"^(?:[.:]?\s*\d{1,2}(?::\d{2})?(?:\s*[/|\\]\s*\d{1,2}[:.]\d{1,2})?\s*|\b\d+\s*[yYoO]\b|[yYoO]\s*,\s*[ôÔoO]|Mu\s*\d+\.?|\d+\s*Y|\d+)$").unwrap()
    });
    if re_tc.is_match(t) {
        return true;
    }
    let letters: String = t.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.chars().count() == 1 {
        let low = letters.to_lowercase();
        let has_vowel = low.chars().any(|c| {
            "aáàảãạăắằẳẵặâấầẩẫậeéèẻẽẹêếềểễệiíìỉĩịoóòỏõọôốồổỗộơớờởỡợuúùủũụưứừửữựyýỳỷỹỵ".contains(c)
        });
        if !has_vowel {
            return true;
        }
    }
    false
}

pub fn clean_foreign_ocr_noise(text: &str) -> String {
    static RE_OSD: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_osd = RE_OSD.get_or_init(|| {
        regex::Regex::new(r"(?i)(?:\b\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s*[/|\\]\s*\d{1,2}[:.]\d{1,2})?\b|\s+(?:\d+_?\s*[E]|[#*]\s*[E]|[/|\\]\s*)$|\s+\.\s+[A-Z]$)").unwrap()
    });
    let mut cleaned = re_osd.replace_all(text, "").trim().to_string();
    cleaned = cleaned
        .replace("[UNK]", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if is_pure_ocr_junk(&cleaned) {
        return String::new();
    }
    cleaned
}

fn is_valid_vi_token(tok: &str) -> bool {
    let core = tok
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    if core.is_empty() {
        return false;
    }
    if core.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if core.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }
    let has_vowel = core.chars().any(|c| {
        "aeiouyàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ".contains(c)
    });
    if !has_vowel {
        return false;
    }
    let lex = ocr_engine_rs::lexicon::Lexicon::global();
    lex.syllables.contains(&core) || lex.words.contains(&core)
}

pub fn clean_and_validate_vietnamese_ocr(text: &str) -> String {
    let raw_tokens: Vec<&str> = text.split_whitespace().collect();
    if raw_tokens.is_empty() {
        return String::new();
    }

    let alpha_tokens: Vec<&str> = raw_tokens
        .iter()
        .copied()
        .filter(|tok| tok.chars().any(|c| c.is_alphabetic()))
        .collect();
    if alpha_tokens.is_empty() {
        return String::new();
    }

    if alpha_tokens.len() <= 3 && alpha_tokens.iter().any(|tok| !is_valid_vi_token(tok)) {
        return String::new();
    }

    let mut start = 0;
    let mut end = raw_tokens.len();
    while start < end && !is_valid_vi_token(raw_tokens[start]) {
        start += 1;
    }
    while end > start && !is_valid_vi_token(raw_tokens[end - 1]) {
        end -= 1;
    }
    if start >= end {
        return String::new();
    }

    let kept = &raw_tokens[start..end];
    let kept_alpha: Vec<&str> = kept
        .iter()
        .copied()
        .filter(|tok| tok.chars().any(|c| c.is_alphabetic()))
        .collect();
    if kept_alpha.is_empty() {
        return String::new();
    }

    let valid_count = kept_alpha.iter().filter(|t| is_valid_vi_token(t)).count();
    if valid_count * 100 < kept_alpha.len() * 60 {
        return String::new();
    }

    let joined = kept.join(" ");
    if is_pure_ocr_junk(&joined) {
        return String::new();
    }
    joined
}

fn has_any_vietnamese_diacritic(text: &str) -> bool {
    const VIETNAMESE_DIACRITICS: &str =
        "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ\
         ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴĐ";
    text.chars().any(|c| VIETNAMESE_DIACRITICS.contains(c))
}

/// The language model may restore completely unaccented sentences and repair invalid/confusable
/// OCR syllables while preserving every valid Vietnamese syllable already recognized visually.
pub fn preserve_recognized_tones(recognized: &str, restored: &str) -> String {
    if !has_any_vietnamese_diacritic(recognized) {
        return restored.to_owned();
    }

    let source: Vec<_> = recognized.split_whitespace().collect();
    let candidate: Vec<_> = restored.split_whitespace().collect();
    if source.len() != candidate.len() {
        return restored.to_owned();
    }

    let lex = ocr_engine_rs::lexicon::Lexicon::global();
    source
        .iter()
        .zip(candidate)
        .map(|(original, replacement)| {
            let core_orig = original
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase();
            let core_repl = replacement
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase();
            if core_orig.is_empty() || core_orig == core_repl {
                return replacement;
            }
            let is_valid_orig = lex.syllables.contains(&core_orig);
            let is_rare_ocr_confusion =
                ocr_engine_rs::lexicon::is_rare_override_syllable(&core_orig);
            if !is_valid_orig || is_rare_ocr_confusion {
                replacement
            } else {
                *original
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::{
        clean_and_validate_vietnamese_ocr, clean_foreign_ocr_noise, is_promotional_cta,
        is_pure_ocr_junk, preserve_recognized_tones,
    };

    #[test]
    fn preserves_tones_seen_by_the_visual_model() {
        assert_eq!(
            preserve_recognized_tones("Tôi muốn thử", "Tôi muốn thứ"),
            "Tôi muốn thử"
        );
        assert_eq!(
            preserve_recognized_tones(
                "Tất nhiên là do thiên nhiên rồi.",
                "Tất nhiên là đó thiên nhiên rồi."
            ),
            "Tất nhiên là do thiên nhiên rồi."
        );
        assert_eq!(
            preserve_recognized_tones("Hai vị và Cao Thuận", "Hải vị và Cào Thuận"),
            "Hai vị và Cao Thuận"
        );
    }

    #[test]
    fn permits_restoring_a_missing_tone() {
        assert_eq!(
            preserve_recognized_tones("Toi muon thu", "Tôi muốn thử"),
            "Tôi muốn thử"
        );
    }

    #[test]
    fn permits_fixing_invalid_and_confusable_tones() {
        assert_eq!(
            preserve_recognized_tones("Hắn biểt và thừ cúa tôi", "Hắn biết và thử của tôi"),
            "Hắn biết và thử của tôi"
        );
    }

    #[test]
    fn rejects_empty_screen_watermarks_and_gibberish() {
        for junk in [
            "uiateuht",
            "wiateukt",
            "iateubds",
            "lateuhh",
            "ít lũ Lmi",
            "hít lulan",
            "Cuối Gg",
            "Uin",
            "ta lu4",
            "Ngưotặ",
            "bít lũ/ uiateuhty",
            "Ch![UNK]n6i[UNK]dien",
        ] {
            let pre = clean_foreign_ocr_noise(junk);
            if !pre.is_empty() {
                assert!(
                    is_pure_ocr_junk(&pre) || clean_and_validate_vietnamese_ocr(&pre).is_empty(),
                    "Expected '{junk}' to be rejected as background/watermark junk"
                );
            }
        }
    }

    #[test]
    fn rejects_channel_promotions_without_dropping_normal_dialogue() {
        assert!(is_promotional_cta(
            "Hãy subscribe cho kênh Ghiền Mì Gõ để không bỏ lỡ những video hấp dẫn"
        ));
        assert!(is_promotional_cta(
            "Nhấn chuông và đăng ký kênh để xem video mới"
        ));
        assert!(!is_promotional_cta(
            "Tôi đã đăng ký tham gia nhiệm vụ từ hôm qua"
        ));
        assert!(!is_promotional_cta(
            "Đoạn video này chính là bằng chứng của chúng ta"
        ));
    }

    #[test]
    fn preserves_genuine_vietnamese_dialogue_and_strips_edge_watermark() {
        assert_eq!(
            clean_and_validate_vietnamese_ocr("Một cô gái từ nơi xa lạ. iateuhty"),
            "Một cô gái từ nơi xa lạ."
        );
        assert_eq!(
            clean_and_validate_vietnamese_ocr("Phải rồi, đó là lý do gia đình nàng tới tìm"),
            "Phải rồi, đó là lý do gia đình nàng tới tìm"
        );
        assert_eq!(clean_and_validate_vietnamese_ocr("Sao?"), "Sao?");
        assert_eq!(clean_and_validate_vietnamese_ocr("Đã chơi!"), "Đã chơi!");
        assert_eq!(clean_and_validate_vietnamese_ocr("Xa quá!"), "Xa quá!");
        assert_eq!(
            clean_and_validate_vietnamese_ocr("Miu meo, miu meo"),
            "Miu meo, miu meo"
        );
    }
}
