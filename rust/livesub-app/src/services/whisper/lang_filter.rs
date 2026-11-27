/// Strictly restricted to the 6 supported languages: vi, ja, en, zh, ko, th.
pub fn normalize_whisper_language(raw: &str) -> Option<&'static str> {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() || trimmed == "auto" {
        return None;
    }
    let code = match trimmed.split(['-', '_']).next().unwrap_or("") {
        "vi" | "viet" | "vietnamese" => "vi",
        "ja" | "jp" | "japanese" => "ja",
        "en" | "eng" | "english" => "en",
        "zh" | "ch" | "cmn" | "yue" | "cantonese" | "chinese" => "zh",
        "ko" | "kor" | "korean" => "ko",
        "th" | "thai" => "th",
        _ => return None,
    };
    Some(code)
}

/// Deterministic Unicode script detection for Japanese, Korean, Thai, Chinese, and Vietnamese.
pub fn detect_script_language(text: &str) -> Option<&'static str> {
    let mut kana_count = 0usize;
    let mut hangul_count = 0usize;
    let mut thai_count = 0usize;
    let mut han_count = 0usize;
    let mut vi_diacritic_count = 0usize;

    for c in text.chars() {
        match c {
            '\u{3040}'..='\u{30FF}' | '\u{31F0}'..='\u{31FF}' => kana_count += 1,
            '\u{AC00}'..='\u{D7AF}' | '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}' => {
                hangul_count += 1
            }
            '\u{0E00}'..='\u{0E7F}' => thai_count += 1,
            '\u{4E00}'..='\u{9FFF}' | '\u{3400}'..='\u{4DBF}' => han_count += 1,
            c if "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴĐ"
                .contains(c) =>
            {
                vi_diacritic_count += 1
            }
            _ => {}
        }
    }

    if thai_count >= 2 {
        return Some("th");
    }
    if hangul_count >= 1 {
        return Some("ko");
    }
    if kana_count >= 1 {
        return Some("ja");
    }
    if han_count >= 1 {
        return Some("zh");
    }
    if vi_diacritic_count >= 1 {
        return Some("vi");
    }
    None
}

pub fn is_whisper_hallucination(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return true;
    }
    if t.chars().any(|c| matches!(c, '♪' | '♫' | '♬' | '♩')) {
        return true;
    }
    let low = t.to_lowercase();
    if low.contains("[music]")
        || low.contains("(music)")
        || low.contains("[音楽]")
        || low.contains("(音楽)")
        || low.contains("[applause]")
        || low.contains("[blank_audio]")
    {
        return true;
    }
    if matches!(
        low.as_str(),
        "[blank_audio]"
            | "[silence]"
            | "(silence)"
            | "[music]"
            | "(music)"
            | "[applause]"
            | "(applause)"
            | "[laughter]"
            | "(laughter)"
            | "[音楽]"
            | "(音楽)"
            | "♪"
            | "♪♪"
    ) {
        return true;
    }
    if (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')')) {
        return true;
    }

    let chars: Vec<char> = t.chars().filter(|c| !c.is_whitespace()).collect();
    if chars.len() >= 6 {
        let first = chars[0];
        if chars.iter().all(|&c| c == first) {
            return true;
        }
    }

    false
}

/// These phrases are common Whisper priors, but may also be genuine dialogue.
/// Callers must combine this signal with acoustic uncertainty before dropping it.
pub fn is_whisper_promotional_phrase(text: &str) -> bool {
    let low = text.trim().to_lowercase();
    if low.is_empty() {
        return false;
    }
    let has_channel = low.contains("kênh") || low.contains("channel");
    let has_video_promo = low.contains("video")
        || low.contains("không bỏ lỡ")
        || low.contains("nhấn chuông")
        || low.contains("bấm chuông")
        || low.contains("ủng hộ");
    (low.contains("subscribe") && has_channel)
        || ((low.contains("đăng ký") || low.contains("theo dõi")) && has_channel && has_video_promo)
        || (low.contains("không bỏ lỡ") && low.contains("video"))
        || low.contains("thanks for watching")
        || low.contains("thank you for watching")
        || low.contains("チャンネル登録よろしくお願いします")
        || low.contains("ご視聴ありがとうございました")
        || low.contains("subtitles by the amara.org community")
        || low.contains("amara.org")
        || low.contains("mbc 뉴스")
}

pub fn pick_best_supported_lang(json_val: &serde_json::Value) -> Option<String> {
    if let Some(raw) = json_val
        .get("detected_language")
        .or_else(|| json_val.get("language"))
        .and_then(|v| v.as_str())
        .and_then(normalize_whisper_language)
    {
        return Some(raw.to_string());
    }

    if let Some(probs) = json_val
        .get("language_probabilities")
        .or_else(|| json_val.get("detected_language_probability"))
        .and_then(|v| v.as_object())
    {
        let mut best_lang: Option<&'static str> = None;
        let mut best_prob: f64 = -1.0;
        for (k, v) in probs {
            if let Some(norm) = normalize_whisper_language(k) {
                if let Some(p) = v.as_f64() {
                    if p > best_prob {
                        best_prob = p;
                        best_lang = Some(norm);
                    }
                }
            }
        }
        if let Some(lang) = best_lang {
            if best_prob >= 0.15 {
                return Some(lang.to_string());
            }
        }
    }

    None
}
