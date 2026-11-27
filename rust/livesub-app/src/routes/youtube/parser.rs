use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubtitleSegment {
    pub index: usize,
    pub start: f64,
    pub end: f64,
    pub duration: f64,
    pub original: String,
    pub translated: String,
}

pub fn extract_video_id(url_or_id: &str) -> Option<String> {
    let trimmed = url_or_id.trim();
    if trimmed.len() == 11 && !trimmed.contains('/') && !trimmed.contains('?') {
        return Some(trimmed.to_string());
    }
    if let Some(pos) = trimmed.find("v=") {
        let rest = &trimmed[pos + 2..];
        let id: String = rest
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        if id.len() == 11 {
            return Some(id);
        }
    }
    for prefix in &["youtu.be/", "/shorts/", "/embed/"] {
        if let Some(pos) = trimmed.find(prefix) {
            let rest = &trimmed[pos + prefix.len()..];
            let id: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if id.len() == 11 {
                return Some(id);
            }
        }
    }
    None
}

pub fn clean_transcript_text(text: &str) -> String {
    let mut decoded = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");

    if let Ok(re_num) = regex::Regex::new(r"&#(\d+);") {
        decoded = re_num
            .replace_all(&decoded, |caps: &regex::Captures| {
                if let Ok(code) = caps[1].parse::<u32>() {
                    if let Some(ch) = char::from_u32(code) {
                        return ch.to_string();
                    }
                }
                caps[0].to_string()
            })
            .to_string();
    }

    if let Ok(re_hex) = regex::Regex::new(r"&#x([0-9a-fA-F]+);") {
        decoded = re_hex
            .replace_all(&decoded, |caps: &regex::Captures| {
                if let Ok(code) = u32::from_str_radix(&caps[1], 16) {
                    if let Some(ch) = char::from_u32(code) {
                        return ch.to_string();
                    }
                }
                caps[0].to_string()
            })
            .to_string();
    }

    decoded
        .replace('\u{200b}', "")
        .replace('\u{200c}', "")
        .replace('\u{200d}', "")
        .replace('\u{feff}', "")
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_non_speech_caption(text: &str) -> bool {
    let trimmed = text.trim();
    (trimmed.starts_with('[') && trimmed.ends_with(']'))
        || (trimmed.starts_with('(') && trimmed.ends_with(')'))
        || trimmed.starts_with("♪")
        || trimmed.starts_with(">>")
}

fn sentence_boundary_byte(text: &str) -> Option<usize> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    for (position, (byte_index, ch)) in chars.iter().enumerate() {
        if !matches!(ch, '.' | '!' | '?' | '…') {
            continue;
        }
        let mut end = byte_index + ch.len_utf8();
        let mut next = position + 1;
        while next < chars.len() && matches!(chars[next].1, '"' | '\'' | '”' | '’' | '»' | ')')
        {
            end = chars[next].0 + chars[next].1.len_utf8();
            next += 1;
        }
        if next == chars.len() || chars[next].1.is_whitespace() {
            return Some(end);
        }
    }
    None
}

fn join_without_repeated_words(left: &str, right: &str) -> String {
    let left_words: Vec<&str> = left.split_whitespace().collect();
    let right_words: Vec<&str> = right.split_whitespace().collect();
    let max_overlap = left_words.len().min(right_words.len()).min(12);
    let mut overlap = 0;
    for count in (1..=max_overlap).rev() {
        let suffix = &left_words[left_words.len() - count..];
        let prefix = &right_words[..count];
        if suffix.iter().zip(prefix.iter()).all(|(a, b)| {
            a.trim_matches(|c: char| c.is_ascii_punctuation())
                .eq_ignore_ascii_case(b.trim_matches(|c: char| c.is_ascii_punctuation()))
        }) {
            overlap = count;
            break;
        }
    }

    if overlap == right_words.len() {
        return left.to_string();
    }
    let remainder = right_words[overlap..].join(" ");
    if left.is_empty() {
        remainder
    } else if remainder.is_empty() {
        left.to_string()
    } else {
        format!("{} {}", left.trim_end(), remainder)
    }
}

/// YouTube frequently exposes each visual caption row as a separate cue. Rebuild
/// sentence-sized cues so TTS receives "... sát cánh bên nhau." once instead of
/// synthesizing the two screen rows independently.
fn merge_caption_fragments(segments: Vec<SubtitleSegment>) -> Vec<SubtitleSegment> {
    const MAX_SENTENCE_CHARS: usize = 180;
    const MAX_SILENCE_GAP_SECONDS: f64 = 1.35;

    let mut result = Vec::new();
    let mut pending: Option<SubtitleSegment> = None;

    let push_segment = |mut segment: SubtitleSegment, output: &mut Vec<SubtitleSegment>| {
        segment.index = output.len();
        segment.duration = ((segment.end - segment.start).max(0.0) * 1000.0).round() / 1000.0;
        segment.translated = segment.original.clone();
        output.push(segment);
    };

    for segment in segments {
        if is_non_speech_caption(&segment.original) {
            if let Some(previous) = pending.take() {
                push_segment(previous, &mut result);
            }
            push_segment(segment, &mut result);
            continue;
        }

        if let Some(previous) = pending.as_ref() {
            let gap = segment.start - previous.end;
            if gap > MAX_SILENCE_GAP_SECONDS {
                push_segment(pending.take().unwrap(), &mut result);
            }
        }

        let mut active = pending.take().unwrap_or_else(|| SubtitleSegment {
            index: 0,
            start: segment.start,
            end: segment.start,
            duration: 0.0,
            original: String::new(),
            translated: String::new(),
        });
        active.original = join_without_repeated_words(&active.original, &segment.original);
        active.end = active.end.max(segment.end);

        loop {
            if let Some(boundary) = sentence_boundary_byte(&active.original) {
                let completed_text = active.original[..boundary].trim().to_string();
                let remainder = active.original[boundary..].trim().to_string();
                if !completed_text.is_empty() {
                    let total_chars = active.original.chars().count().max(1) as f64;
                    let completed_chars = completed_text.chars().count() as f64;
                    let split_end = if remainder.is_empty() {
                        active.end
                    } else {
                        active.start + (active.end - active.start) * (completed_chars / total_chars)
                    };
                    push_segment(
                        SubtitleSegment {
                            index: 0,
                            start: active.start,
                            end: split_end,
                            duration: 0.0,
                            original: completed_text,
                            translated: String::new(),
                        },
                        &mut result,
                    );
                    if remainder.is_empty() {
                        active.original.clear();
                        break;
                    }
                    active.start = split_end;
                    active.original = remainder;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        if active.original.is_empty() {
            pending = None;
        } else if active.original.chars().count() >= MAX_SENTENCE_CHARS {
            push_segment(active, &mut result);
            pending = None;
        } else {
            pending = Some(active);
        }
    }

    if let Some(previous) = pending {
        push_segment(previous, &mut result);
    }
    result
}

pub fn parse_transcript_xml(xml: &str) -> Vec<SubtitleSegment> {
    let mut segments = Vec::new();

    if let Ok(re_p) = regex::Regex::new(r#"<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)</p>"#) {
        let re_s = regex::Regex::new(r#"<s[^>]*>([^<]*)</s>"#).unwrap();
        let re_tags = regex::Regex::new(r#"<[^>]+>"#).unwrap();

        for cap in re_p.captures_iter(xml) {
            let start_ms: u64 = cap.get(1).map_or(0, |m| m.as_str().parse().unwrap_or(0));
            let dur_ms: u64 = cap.get(2).map_or(0, |m| m.as_str().parse().unwrap_or(0));
            let inner = cap.get(3).map_or("", |m| m.as_str());

            let mut text = String::new();
            for s_cap in re_s.captures_iter(inner) {
                text.push_str(s_cap.get(1).map_or("", |m| m.as_str()));
            }
            if text.is_empty() {
                text = re_tags.replace_all(inner, "").to_string();
            }

            let cleaned = clean_transcript_text(&text);
            if !cleaned.is_empty() {
                let start = start_ms as f64 / 1000.0;
                let duration = dur_ms as f64 / 1000.0;
                segments.push(SubtitleSegment {
                    index: segments.len(),
                    start,
                    end: ((start + duration) * 1000.0).round() / 1000.0,
                    duration,
                    original: cleaned.clone(),
                    translated: cleaned,
                });
            }
        }
    }

    if segments.is_empty() {
        if let Ok(re_text) =
            regex::Regex::new(r#"<text\s+start="([\d\.]+)"\s+dur="([\d\.]+)"[^>]*>([^<]*)</text>"#)
        {
            for cap in re_text.captures_iter(xml) {
                let start: f64 = cap
                    .get(1)
                    .map_or(0.0, |m| m.as_str().parse().unwrap_or(0.0));
                let dur: f64 = cap
                    .get(2)
                    .map_or(0.0, |m| m.as_str().parse().unwrap_or(0.0));
                let raw = cap.get(3).map_or("", |m| m.as_str());
                let cleaned = clean_transcript_text(raw);
                if !cleaned.is_empty() {
                    segments.push(SubtitleSegment {
                        index: segments.len(),
                        start,
                        end: ((start + dur) * 1000.0).round() / 1000.0,
                        duration: dur,
                        original: cleaned.clone(),
                        translated: cleaned,
                    });
                }
            }
        }
    }

    let mut deduped: Vec<SubtitleSegment> = Vec::new();
    for seg in segments {
        if let Some(last) = deduped.last_mut() {
            if last.original == seg.original && (seg.start - last.start).abs() < 0.3 {
                last.end = last.end.max(seg.end);
                last.duration = ((last.end - last.start) * 1000.0).round() / 1000.0;
                continue;
            }
        }
        let mut s = seg;
        s.index = deduped.len();
        deduped.push(s);
    }

    merge_caption_fragments(deduped)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(start: f64, end: f64, text: &str) -> SubtitleSegment {
        SubtitleSegment {
            index: 0,
            start,
            end,
            duration: end - start,
            original: text.to_string(),
            translated: text.to_string(),
        }
    }

    #[test]
    fn joins_visual_rows_into_one_spoken_sentence() {
        let merged = merge_caption_fragments(vec![
            segment(0.0, 1.5, "đến lúc tất cả hợp sức sát cánh bên"),
            segment(1.4, 3.0, "nhau. Bài phát biểu này có lẽ bắt nguồn"),
            segment(2.9, 4.2, "từ một câu chuyện khác."),
        ]);
        assert_eq!(merged.len(), 2);
        assert_eq!(
            merged[0].original,
            "đến lúc tất cả hợp sức sát cánh bên nhau."
        );
        assert_eq!(
            merged[1].original,
            "Bài phát biểu này có lẽ bắt nguồn từ một câu chuyện khác."
        );
    }

    #[test]
    fn removes_rolling_caption_word_overlap() {
        let merged = merge_caption_fragments(vec![
            segment(0.0, 1.0, "hãy gạt bỏ hiềm khích"),
            segment(0.9, 2.0, "bỏ hiềm khích nhỏ nhặt sang một bên."),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(
            merged[0].original,
            "hãy gạt bỏ hiềm khích nhỏ nhặt sang một bên."
        );
    }
}

pub fn select_caption_track<'a>(
    caption_tracks: &'a [serde_json::Value],
    requested_lang: &str,
) -> Option<&'a serde_json::Value> {
    let mut chosen: Option<&serde_json::Value> = None;

    if requested_lang == "vi" {
        chosen = caption_tracks
            .iter()
            .find(|t| t.get("languageCode").and_then(|c| c.as_str()) == Some("vi"));
    } else if requested_lang != "auto" {
        chosen = caption_tracks.iter().find(|t| {
            t.get("languageCode")
                .and_then(|c| c.as_str())
                .map_or(false, |lc| lc.starts_with(requested_lang))
        });
    }

    if chosen.is_none() {
        chosen = caption_tracks
            .iter()
            .find(|t| t.get("languageCode").and_then(|c| c.as_str()) == Some("vi"));
    }
    if chosen.is_none() {
        chosen = caption_tracks.iter().find(|t| {
            t.get("languageCode").and_then(|c| c.as_str()) == Some("en") && t.get("kind").is_none()
        });
    }
    if chosen.is_none() {
        chosen = caption_tracks
            .iter()
            .find(|t| t.get("languageCode").and_then(|c| c.as_str()) == Some("en"));
    }
    chosen.or_else(|| caption_tracks.first())
}
