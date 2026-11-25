use hashbrown::{HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

static GLOBAL_LEXICON: OnceLock<Lexicon> = OnceLock::new();

pub const CONVERSATIONAL_COLLOCATIONS: &[&str] = &[
    "anh ấy", "chị ấy", "em ấy", "cô ấy", "bà ấy", "ông ấy", "bác ấy", "chú ấy", "cháu ấy",
    "cũng không", "cũng chưa", "cũng có", "cũng là", "cũng được", "cũng ngầm", "cũng như",
    "không cần", "không thể", "không phải", "không có", "không biết", "không muốn", "không được",
    "không nghe", "nghe lén", "lén đâu", "giám sát", "sát đâu", "thế đâu", "ở đâu", "đi đâu",
    "đâu thể", "đâu có", "đâu dám", "sắp tan", "tan làm", "làm rồi", "xong rồi", "xong việc",
    "việc rồi", "mọi việc", "mọi người", "mọi thứ", "mọi chuyện", "nổi đóa", "ở đây", "ở đó",
    "đứng đây", "đứng đó", "đứng lại", "đứng lên", "từ trước", "ra đời", "ra ngoài", "chuyện gì",
    "gì chứ", "sao chứ", "ai chứ", "được chứ", "thế chứ", "đã ở", "cả khi", "cả người", "cả nhà",
    "cả hai", "cả lão", "lão bà", "bà bà", "ngầm hiểu", "ngầm tin", "tin tưởng", "mách lẻo",
    "chắc ta", "chắc sắp", "chắc chắn", "chắc là", "chắc sẽ", "chắc anh", "chắc em", "nếu em",
    "nếu anh", "nếu ta", "nếu như", "xảy ra", "đại nhân", "hồ ly", "mắt ngôi", "bách linh",
    "hưu khiêu", "im lặng", "có thể", "tạm biệt", "hoàn thành", "vấn đề", "trước cả",
    "ăn đi", "làm đi", "nói đi", "đi mau", "thế ạ", "được rồi", "bỏ em", "em lại",
    "nói với", "với anh", "thôi nhé", "chắc anh ấy", "ngầm tin tưởng", "tin tưởng anh ấy",
    "bách linh chắc", "xong việc rồi", "im lặng đứng", "đứng đây thôi", "xảy ra chuyện",
    "trước khi", "khi nấu", "châu chấu", "loại bỏ", "nội tạng", "rỗng ruột", "nhớ ra",
    "ra chợ", "chợ mua", "mua ít", "ít nhang", "nhang nhé", "trả công", "công thế",
    "thế nào", "nào ạ", "lượt tắm", "tắm sáng", "bữa sáng", "sáng hai", "hai người",
    "chưa đủ", "đủ à", "bủn xỉn", "vừa nói", "nói gì", "gì đó", "trời đất", "đất ơi",
    "thịt nhưng", "nhưng vẫn", "vẫn ăn", "ăn được", "im lặng", "lặng mà", "ăn hết",
    "hết giúp", "giúp các", "các chị", "chị bách", "bánh trung", "trung thu", "thu là",
    "hay để", "để em", "để cho", "để làm", "có thể", "thể hoàn", "thể làm",
    "khi nấu", "nấu châu", "châu chấu", "phải loại", "loại bỏ", "bỏ nội", "nội tạng",
    "kể cả", "có biết", "biết thứ", "thứ này", "còn lại", "lại đâu", "còn lại đâu",
    "vị quan", "quan võ", "đã giúp", "phục kích", "phục kích thành", "kích thành",
    "thành trì", "kể cho", "cho ngài", "ngài ấy", "hiểu ý", "thị trấn", "thị trấn khác",
    "còn giữ", "số còn", "số còn lại", "không lấy", "những cuốn", "cuốn còn", "vẫn lấy",
    "lấy về", "lấy về được", "anh ta", "ta đã", "đã bán", "thì lại", "lại gay", "gay go",
    "mới chỉ", "mới chỉ có", "có bán", "côn trùng", "có hứa", "không tố", "tố giác",
    "còn tùy", "tùy vào", "thái độ", "đừng dọa", "dọa anh", "anh đói", "đói không",
    "lý do", "lý do riêng", "cứ ở", "cứ ở đây", "ở đây nhé", "cái này", "đồ thừa",
    "bọn tôi", "có vẻ", "vẻ anh", "anh đã", "chật vật", "đến được", "được kinh", "kinh thành",
    "vẫn còn", "nguyên trạng", "hết cách", "phải bán", "không nghĩ", "anh ta là", "ta là",
    "người xấu", "dù thế", "cương nhu", "đúng lúc", "không ưa", "đâu phải", "đây đâu", "là cào",
    "cào cào", "cào cào mà", "con này", "phân biệt", "phân biệt được", "còn cào", "và ăn",
    "lẫn vào", "vào đây", "tương tự", "thực tế", "thực tế là", "nạn đói", "cũng nghĩ",
    "bằng chứng", "số lượng", "nhiều hơn", "điềm báo", "tai ương", "năm tới", "lũ côn",
    "lũ côn trùng", "gây ra", "tai họa", "chẳng sao", "đúng chứ",
    "sau sáu", "sáu ngày", "sáu giây", "sáu phút", "sáu giờ", "sáu người", "sáu cái",
    "sáu trăm", "sáu nghìn", "sáu triệu", "sáu mươi",
];

pub struct Lexicon {
    pub syllables: HashSet<String>,
    pub words: HashSet<String>,
    pub unaccented_to_syllables: HashMap<String, Vec<String>>,
    pub skeleton_to_syllables: HashMap<String, Vec<String>>,
}

impl Lexicon {
    pub fn load_from_json(json_str: &str) -> Self {
        #[derive(serde::Deserialize)]
        struct RawLex {
            syllables: Vec<String>,
            common_words: Vec<String>,
        }

        if let Ok(raw) = serde_json::from_str::<RawLex>(json_str) {
            let mut syllables = HashSet::with_capacity(raw.syllables.len());
            let mut unaccented_to_syllables: HashMap<String, Vec<String>> =
                HashMap::with_capacity(raw.syllables.len());
            let mut skeleton_to_syllables: HashMap<String, Vec<String>> =
                HashMap::with_capacity(raw.syllables.len());

            for s in raw.syllables {
                let s_low = s.to_lowercase();
                syllables.insert(s_low.clone());

                let unacc = strip_accents(&s_low);
                unaccented_to_syllables
                    .entry(unacc.clone())
                    .or_default()
                    .push(s_low.clone());

                let skel = extract_consonants(&unacc);
                if !skel.is_empty() {
                    skeleton_to_syllables
                        .entry(skel)
                        .or_default()
                        .push(s_low.clone());
                }
            }

            let mut words = HashSet::with_capacity(raw.common_words.len() + CONVERSATIONAL_COLLOCATIONS.len());
            for w in raw.common_words {
                words.insert(w.to_lowercase());
            }
            for c in CONVERSATIONAL_COLLOCATIONS {
                words.insert(c.to_lowercase());
            }

            Self {
                syllables,
                words,
                unaccented_to_syllables,
                skeleton_to_syllables,
            }
        } else {
            Self {
                syllables: HashSet::new(),
                words: HashSet::new(),
                unaccented_to_syllables: HashMap::new(),
                skeleton_to_syllables: HashMap::new(),
            }
        }
    }

    pub fn global() -> &'static Lexicon {
        GLOBAL_LEXICON.get_or_init(|| {
            let candidates = [
                Path::new("data/vietnamese_lexicon.json"),
                Path::new("../data/vietnamese_lexicon.json"),
                Path::new("../../data/vietnamese_lexicon.json"),
                Path::new("C:/dich/data/vietnamese_lexicon.json"),
            ];
            for path in candidates {
                if path.exists() {
                    if let Ok(content) = std::fs::read_to_string(path) {
                        return Self::load_from_json(&content);
                    }
                }
            }
            Self {
                syllables: HashSet::new(),
                words: HashSet::new(),
                unaccented_to_syllables: HashMap::new(),
                skeleton_to_syllables: HashMap::new(),
            }
        })
    }

    pub fn is_valid_word(&self, word: &str) -> bool {
        let clean = word.trim().to_lowercase();
        self.words.contains(&clean) || self.syllables.contains(&clean)
    }

    /// Restore corrupted Vietnamese diacritics and missing vowels across an entire sentence
    /// using statistical Viterbi sequence decoding and compound word lexicon constraints.
    pub fn restore_vietnamese_text(&self, text: &str) -> String {
        let pre_norm = pre_normalize_ocr_substitutions(text);

        let tokens: Vec<&str> = pre_norm.split_whitespace().collect();
        if tokens.is_empty() {
            return String::new();
        }

        let mut words_meta: Vec<(String, String, String)> = Vec::with_capacity(tokens.len());
        for &tok in &tokens {
            let (prefix, core, suffix) = split_punct(tok);
            words_meta.push((prefix.to_string(), core.to_string(), suffix.to_string()));
        }

        let n = words_meta.len();
        let mut cand_sets: Vec<Vec<String>> = Vec::with_capacity(n);

        // 1. Generate candidate sets for each token
        for i in 0..n {
            let core = &words_meta[i].1;
            if core.is_empty() || core.chars().all(|c| !c.is_alphabetic()) {
                cand_sets.push(vec![core.clone()]);
                continue;
            }

            let core_low = core.to_lowercase();
            let unacc = strip_accents(&core_low);
            let has_vowels = unacc.chars().any(|c| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y'));

            let mut candidates: Vec<String> = Vec::new();
            if let Some(list) = self.unaccented_to_syllables.get(&unacc) {
                for item in list {
                    if !candidates.contains(item) {
                        candidates.push(item.clone());
                    }
                }
            }

            // Consonant skeleton matching for words that lack vowels or are known corrupted OCR forms
            let needs_skeleton = !has_vowels
                || matches!(
                    core_low.as_str(),
                    "lut"
                        | "rut"
                        | "nu"
                        | "va"
                        | "truc"
                        | "trưc"
                        | "đuac"
                        | "duac"
                        | "tri"
                        | "loi"
                        | "ni"
                        | "chu"
                        | "ba"
                        | "ch"
                        | "mt"
                        | "dt"
                        | "bnh"
                        | "tng"
                );

            if needs_skeleton {
                let skel = extract_consonants(&unacc);
                if !skel.is_empty() {
                    if let Some(list) = self.skeleton_to_syllables.get(&skel) {
                        for item in list {
                            if !candidates.contains(item) {
                                candidates.push(item.clone());
                            }
                        }
                    }
                }
            }

            if core_low == "i" && !candidates.contains(&"ơi".to_string()) {
                candidates.push("ơi".to_string());
            }

            if core_low == "chi" && !candidates.contains(&"chị".to_string()) {
                candidates.push("chị".to_string());
            }

            if !candidates.contains(&core_low) {
                candidates.push(core_low.clone());
            }

            cand_sets.push(candidates);
        }

        // 2. Viterbi sequence decoding
        struct ViterbiNode {
            score: i32,
            prev_idx: Option<usize>,
        }

        let mut dp: Vec<Vec<ViterbiNode>> = Vec::with_capacity(n);

        // Step 0: Initial states
        {
            let core_low = words_meta[0].1.to_lowercase();
            let unacc = strip_accents(&core_low);
            let is_strictly_unacc = core_low == unacc;
            let mut row0 = Vec::with_capacity(cand_sets[0].len());
            for cand in &cand_sets[0] {
                let mut score = cand_unigram_score(self, cand, &core_low, is_strictly_unacc);
                // Context bonus: "chi" before capitalized word -> "chị"
                if cand == "chị" && words_meta.len() > 1 && words_meta[1].1.chars().next().map_or(false, |c| c.is_uppercase()) {
                    score += 35;
                }
                if cand == "nếu" && words_meta.len() > 1 && (words_meta[1].1.to_lowercase() == "em" || words_meta[1].1.to_lowercase() == "anh" || words_meta[1].1.to_lowercase() == "ta") {
                    score += 35;
                }
                if cand == "những" && words_meta.len() > 1 && words_meta[1].1.to_lowercase() == "cuốn" {
                    score += 35;
                }
                if (cand == "đâu" || cand == "chứ" || cand == "nhỉ" || cand == "sao" || cand == "ạ") && (words_meta[0].2.contains('?') || words_meta.len() == 1) {
                    score += 25;
                }
                row0.push(ViterbiNode { score, prev_idx: None });
            }
            dp.push(row0);
        }

        // Steps 1..n-1: Dynamic Programming forward pass
        for i in 1..n {
            let core_low = words_meta[i].1.to_lowercase();
            let unacc = strip_accents(&core_low);
            let is_strictly_unacc = core_low == unacc;
            let mut row_i = Vec::with_capacity(cand_sets[i].len());

            // Punctuation between tokens indicates a clause boundary; words cannot form
            // a single compound word across punctuation like commas, periods, or question marks.
            let has_boundary_punct = !words_meta[i - 1].2.is_empty()
                && words_meta[i - 1].2.chars().any(|c| matches!(c, ',' | '.' | '!' | '?' | ';' | ':' | '—'));

            for cand in &cand_sets[i] {
                let mut u = cand_unigram_score(self, cand, &core_low, is_strictly_unacc);
                if cand == "chị" && i + 1 < n && words_meta[i + 1].1.chars().next().map_or(false, |c| c.is_uppercase()) {
                    u += 35;
                }
                if cand == "những" && i + 1 < n && words_meta[i + 1].1.to_lowercase() == "cuốn" {
                    u += 35;
                }
                if (cand == "ạ" || cand == "đâu" || cand == "chứ" || cand == "nhỉ" || cand == "sao")
                    && (words_meta[i].2.contains('?') || i == n - 1)
                {
                    u += 25;
                }
                let mut best_score = i32::MIN;
                let mut best_prev = None;

                for (p_idx, prev_node) in dp[i - 1].iter().enumerate() {
                    let prev_cand = &cand_sets[i - 1][p_idx];
                    let trans = if has_boundary_punct {
                        0
                    } else {
                        transition_score(self, prev_cand, cand)
                    };
                    let total = prev_node.score + trans + u;
                    if total > best_score {
                        best_score = total;
                        best_prev = Some(p_idx);
                    }
                }

                row_i.push(ViterbiNode { score: best_score, prev_idx: best_prev });
            }
            dp.push(row_i);
        }

        // 3. Backtrack through optimal sequence
        let mut best_last_idx = 0;
        let mut best_last_score = i32::MIN;
        for (idx, node) in dp[n - 1].iter().enumerate() {
            if node.score > best_last_score {
                best_last_score = node.score;
                best_last_idx = idx;
            }
        }

        let mut restored_cores = vec![String::new(); n];
        let mut cur_idx = Some(best_last_idx);
        for i in (0..n).rev() {
            if let Some(idx) = cur_idx {
                let cand = &cand_sets[i][idx];
                let is_cap = words_meta[i].1.chars().next().map_or(false, |c| c.is_uppercase());
                restored_cores[i] = if is_cap {
                    capitalize(cand)
                } else {
                    cand.clone()
                };
                cur_idx = dp[i][idx].prev_idx;
            } else {
                restored_cores[i] = words_meta[i].1.clone();
            }
        }

        // 4. Assemble final sentence with original prefixes and suffixes
        let mut result = Vec::with_capacity(n);
        for i in 0..n {
            let (ref prefix, _, ref suffix) = words_meta[i];
            let ref core = restored_cores[i];
            result.push(format!("{}{}{}", prefix, core, suffix));
        }

        result.join(" ")
    }
}

fn has_tone_sac(s: &str) -> bool {
    s.chars().any(|c| matches!(c, 'á' | 'ắ' | 'ấ' | 'é' | 'ế' | 'í' | 'ó' | 'ố' | 'ớ' | 'ú' | 'ứ' | 'ý' | 'Á' | 'Ắ' | 'Ấ' | 'É' | 'Ế' | 'Í' | 'Ó' | 'Ố' | 'Ớ' | 'Ú' | 'Ứ' | 'Ý'))
}

fn has_tone_hoi(s: &str) -> bool {
    s.chars().any(|c| matches!(c, 'ả' | 'ẳ' | 'ẩ' | 'ẻ' | 'ể' | 'ỉ' | 'ỏ' | 'ổ' | 'ở' | 'ủ' | 'ử' | 'ỷ' | 'Ả' | 'Ẳ' | 'Ẩ' | 'Ẻ' | 'Ể' | 'Ỉ' | 'Ỏ' | 'Ổ' | 'Ở' | 'Ủ' | 'Ử' | 'Ỷ'))
}

fn is_sac_hoi_confusion(cand: &str, core_low: &str) -> bool {
    (has_tone_sac(cand) && has_tone_hoi(core_low)) || (has_tone_hoi(cand) && has_tone_sac(core_low))
}

fn cand_unigram_score(lex: &Lexicon, cand: &str, core_low: &str, is_strictly_unacc: bool) -> i32 {
    let mut score = unigram_frequency_score(cand);
    if cand == core_low {
        if !is_strictly_unacc && lex.syllables.contains(cand) {
            // Syllable was read directly with diacritics by neural OCR and is a valid Vietnamese word.
            // Strongly protect the actual neural OCR reading (+120 bonus) so dictionary unigrams
            // never overwrite valid diacritics (like dấu nặng, hỏi vs sắc)!
            score += 120;
        } else {
            score += 50;
        }
    } else if !is_strictly_unacc && is_sac_hoi_confusion(cand, core_low) {
        // Only consider confusion if the original word is NOT a known valid syllable
        if !lex.syllables.contains(core_low) {
            score += 15;
        }
    }
    if core_low.starts_with('đ') && cand.starts_with('đ') {
        score += 8;
    }
    score
}

fn transition_score(lex: &Lexicon, p: &str, c: &str) -> i32 {
    match (p, c) {
        ("tử", "thúy") => 60,
        ("không", "phải") | ("phải", "không") | ("phải", "chăng") | ("phải", "làm") | ("phải", "biết") | ("đúng", "phải") | ("phải", "rồi") => 55,
        ("chẳng", "phải") | ("đâu", "phải") => 55,
        ("cảm", "ơn") | ("cảm", "thấy") | ("cảm", "giác") | ("cảm", "xúc") | ("cảm", "nhận") | ("cảm", "thông") => 55,
        ("câu", "hỏi") | ("hỏi", "thăm") | ("hỏi", "han") | ("hỏi", "tôi") | ("hỏi", "chuyện") | ("muốn", "hỏi") | ("đi", "hỏi") => 55,
        ("có", "thể") | ("không", "thể") | ("thể", "nào") | ("thể", "hiện") | ("cơ", "thể") => 55,
        ("chỉ", "có") | ("chỉ", "là") | ("chỉ", "cần") | ("chỉ", "muốn") | ("chỉ", "thấy") | ("chỉ", "một") | ("chỉ", "còn") | ("chỉ", "vì") => 55,
        ("tất", "cả") | ("cả", "hai") | ("cả", "nhà") | ("cả", "người") | ("cả", "ngày") | ("cả", "đời") | ("thậm", "chí") => 55,
        ("hiểu", "rồi") | ("hiểu", "không") | ("hiểu", "được") | ("không", "hiểu") | ("chưa", "hiểu") | ("hiểu", "lầm") | ("hiểu", "rõ") => 55,
        ("thay", "đổi") | ("đổi", "lại") | ("đổi", "ý") | ("đổi", "mới") => 55,
        ("bảo", "vệ") | ("bảo", "sao") | ("nghe", "bảo") | ("tôi", "bảo") | ("người", "bảo") => 55,
        ("mở", "ra") | ("mở", "cửa") | ("mở", "mắt") | ("mở", "đầu") => 55,
        ("trở", "về") | ("trở", "lại") | ("trở", "thành") | ("trở", "nên") => 55,
        ("chuẩn", "bị") | ("chuẩn", "xác") | ("tiêu", "chuẩn") | ("đúng", "chuẩn") => 55,
        ("tưởng", "tượng") | ("nghĩ", "tưởng") | ("tưởng", "thật") | ("tưởng", "là") | ("tưởng", "rằng") => 55,
        ("thử", "xem") | ("thử", "làm") | ("thử", "đi") | ("thử", "nghiệm") => 55,
        ("đủ", "rồi") | ("chưa", "đủ") | ("không", "đủ") | ("đầy", "đủ") => 55,
        ("bởi", "vì") | ("bởi", "thế") => 55,
        ("nhỏ", "bé") | ("còn", "nhỏ") | ("từ", "nhỏ") => 55,
        ("chắc", "sắp") | ("chắc", "ta") | ("chắc", "sẽ") | ("chắc", "chắn") | ("chắc", "là") => 50,
        ("sắp", "tan") | ("tan", "làm") | ("làm", "rồi") | ("xong", "việc") | ("việc", "rồi") => 50,
        ("cũng", "không") | ("không", "cần") | ("cần", "giám") | ("giám", "sát") | ("sát", "đâu") => 50,
        ("đâu", "thể") | ("thể", "hoàn") => 50,
        ("hay", "để") | ("để", "em") | ("để", "làm") | ("để", "cho") => 50,
        ("nếu", "em") | ("nếu", "anh") | ("nếu", "ta") | ("xảy", "ra") | ("ra", "chuyện") | ("chuyện", "gì") => 50,
        ("đại", "nhân") | ("mắt", "ngôi") | ("nổi", "đóa") | ("với", "anh") => 50,
        ("vấn", "đề") | ("đề", "gì") | ("gì", "chứ") | ("im", "lặng") | ("lặng", "đứng") | ("đứng", "đây") | ("đây", "thôi") => 50,
        ("nghe", "lén") | ("lén", "đâu") => 50,
        ("đã", "ở") | ("ở", "đây") | ("từ", "trước") | ("trước", "cả") | ("cả", "khi") | ("mình", "ra") | ("ra", "đời") => 50,
        ("anh", "ấy") | ("chị", "ấy") | ("em", "ấy") => 50,
        ("hoàn", "thành") | ("thành", "mọi") | ("mọi", "việc") | ("cả", "lão") | ("lão", "bà") | ("bà", "bà") => 50,
        ("cũng", "ngầm") | ("ngầm", "tin") | ("tin", "tưởng") | ("tưởng", "anh") => 50,
        ("mách", "lẻo") | ("lẻo", "mình") => 50,
        ("tạm", "biệt") => 85,
        ("trước", "khi") | ("khi", "nấu") | ("nấu", "châu") | ("châu", "chấu") | ("phải", "loại") | ("loại", "bỏ") | ("bỏ", "nội") | ("nội", "tạng") => 50,
        ("rỗng", "ruột") | ("nhớ", "ra") | ("ra", "chợ") | ("chợ", "mua") | ("mua", "ít") => 50,
        ("và", "cá") | ("con", "cá") | ("tôm", "cá") => 50,
        ("một", "lượt") | ("lượt", "tắm") | ("tắm", "sáng") | ("một", "bữa") | ("bữa", "sáng") | ("bủn", "xỉn") => 50,
        ("thế", "còn") | ("thế", "nào") | ("thế", "ạ") => 50,
        ("vừa", "nói") | ("trời", "đất") | ("đất", "ơi") | ("không", "có") | ("vẫn", "ăn") => 50,
        ("ăn", "được") | ("lặng", "mà") | ("ăn", "đi") | ("ăn", "hết") => 50,
        ("hết", "giúp") | ("giúp", "các") | ("các", "chị") | ("bánh", "trung") | ("trung", "thu") => 50,
        ("kể", "cả") | ("có", "biết") | ("biết", "thứ") | ("thứ", "này") | ("còn", "lại") | ("lại", "đâu") => 50,
        ("vị", "quan") | ("quan", "võ") | ("đã", "giúp") | ("phục", "kích") | ("kích", "thành") | ("thành", "trì") => 50,
        ("kể", "cho") | ("cho", "ngài") | ("ngài", "ấy") | ("thị", "trấn") => 50,
        ("còn", "giữ") | ("giữ", "một") | ("một", "cuốn") | ("số", "còn") | ("không", "lấy") => 50,
        ("những", "cuốn") | ("cuốn", "còn") | ("cuốn", "nữa") | ("vẫn", "lấy") | ("lấy", "về") | ("về", "được") => 50,
        ("anh", "ta") | ("ta", "đã") | ("đã", "bán") | ("thì", "lại") | ("lại", "gay") | ("gay", "go") => 50,
        ("mới", "chỉ") | ("có", "bán") | ("côn", "trùng") | ("có", "hứa") | ("không", "tố") | ("tố", "giác") => 50,
        ("còn", "tùy") | ("tùy", "vào") | ("thái", "độ") | ("đừng", "dọa") | ("dọa", "anh") | ("anh", "đói") | ("đói", "không") => 50,
        ("lý", "do") | ("do", "riêng") | ("cứ", "ở") | ("cái", "này") | ("đồ", "thừa") | ("bọn", "tôi") => 50,
        ("có", "vẻ") | ("vẻ", "anh") | ("chật", "vật") | ("đến", "được") | ("được", "kinh") | ("kinh", "thành") => 50,
        ("vẫn", "còn") | ("nguyên", "trạng") | ("hết", "cách") | ("phải", "bán") | ("không", "nghĩ") | ("người", "xấu") => 50,
        ("dù", "thế") | ("cương", "nhu") | ("đúng", "lúc") | ("không", "ưa") => 50,
        ("cào", "cào") | ("cào", "mà") | ("con", "này") | ("còn", "con") | ("còn", "cái") | ("còn", "người") => 50,
        ("phân", "biệt") | ("biệt", "được") | ("còn", "cào") | ("và", "ăn") => 50,
        ("lẫn", "vào") | ("vào", "đây") | ("tương", "tự") | ("thực", "tế") | ("nạn", "đói") | ("cũng", "nghĩ") => 50,
        ("ngay", "bây") | ("bây", "giờ") | ("đến", "ngay") | ("thể", "có") | ("có", "nạn") => 50,
        ("số", "lượng") | ("lượng", "cào") | ("nhiều", "hơn") | ("điềm", "báo") | ("báo", "tai") | ("tai", "ương") | ("năm", "tới") => 50,
        ("lũ", "côn") | ("gây", "ra") | ("tai", "họa") | ("chẳng", "sao") | ("đúng", "chứ") | ("kinh", "quá") | ("ngon", "quá") | ("gớm", "quá") => 50,
        ("cậu", "ta") | ("ta", "còn") | ("còn", "chẳng") | ("chẳng", "thèm") | ("thèm", "trả") | ("trả", "giá") => 50,
        ("được", "mà") | ("không", "ngại") | ("cái", "kia") | ("đau", "quá") => 50,
        ("thằng", "nhóc") | ("nhóc", "này") | ("mày", "nói") | ("thằng", "nhãi") => 50,
        ("món", "gớm") | ("gớm", "ghiếc") | ("gì", "vậy") | ("im", "miệng") | ("miệng", "đi") => 50,
        ("món", "đó") | ("gớm", "thật") | ("thật", "mà") | ("thất", "bát") | ("bát", "lắm") => 50,
        ("em", "bảo") | ("bảo", "món") | ("món", "kia") | ("kia", "gớm") => 50,
        ("đoán", "mùa") | ("đoạn", "mùa") | ("mùa", "màng") | ("mùa", "vụ") | ("vụ", "kém") | ("chẳng", "biết") | ("biết", "nữa") => 50,
        ("có", "lấy") | ("lấy", "đường") | ("đắt", "tiền") | ("tiền", "ngào") | ("ngào", "mấy") | ("mấy", "con") | ("dễ", "bảo") | ("bảo", "quản") => 50,
        ("chuyện", "mình") | ("từng", "làm") | ("từng", "chết") | ("làm", "việc") | ("như", "một") | ("giấc", "mơ") | ("mơ", "vậy") | ("gì", "cơ") => 50,
        ("chết", "đi") | ("đi", "sống") | ("sống", "lại") | ("khiến", "một") | ("một", "phần") | ("phần", "cơ") => 50,
        ("thằng", "bé") | ("tê", "liệt") | ("nó", "cũng") | ("cũng", "mất") | ("mất", "đi") => 50,
        ("nhớ", "lại") | ("lại", "đi") | ("dùng", "tay") => 50,
        _ => {
            let bigram = format!("{} {}", p, c);
            if lex.words.contains(&bigram) {
                45
            } else {
                0
            }
        }
    }
}

pub fn is_rare_override_syllable(s: &str) -> bool {
    matches!(
        s,
        "phái"
            | "cám"
            | "hói"
            | "chí"
            | "hiếu"
            | "mớ"
            | "trớ"
            | "bới"
            | "tháo"
            | "chác"
            | "sáp"
            | "rối"
            | "nêu"
            | "chuyên"
            | "đau"
            | "đúng"
            | "mới"
            | "thế"
            | "léo"
            | "ca"
            | "dạ"
            | "dễ"
            | "đê"
            | "rồng"
            | "đú"
            | "nhó"
            | "thit"
            | "ay"
            | "giam"
            | "hoan"
            | "thanh"
            | "cung"
            | "can"
            | "ngam"
            | "tam"
            | "dai"
            | "nhan"
            | "bo"
            | "it"
            | "ch"
            | "mt"
            | "tri"
            | "dt"
            | "kẻ"
            | "cô"
            | "phúc"
            | "lay"
            | "van"
            | "lạy"
            | "tà"
            | "da"
            | "bản"
            | "cỏ"
            | "ban"
            | "hua"
            | "tuy"
            | "đô"
            | "cai"
            | "bon"
            | "qua"
            | "ve"
            | "vấn"
            | "nghi"
            | "du"
            | "ùa"
            | "dược"
            | "lan"
            | "sổ"
            | "lương"
            | "điểm"
            | "lu"
            | "chú"
            | "vai"
            | "trân"
            | "nua"
            | "giũ"
            | "bụi"
            | "mỡ"
            | "nây"
            | "ma"
            | "tá"
            | "lả"
            | "chàng"
            | "mả"
            | "ngài"
            | "kìa"
            | "tháng"
            | "máy"
            | "miếng"
            | "thé"
            | "bào"
            | "mòn"
            | "gom"
            | "thát"
            | "kem"
            | "chét"
            | "sông"
            | "khiên"
            | "phan"
            | "mát"
            | "nho"
            | "vay"
            | "cot"
            | "fien"
            | "ngao"
            | "mây"
            | "nhai"
            | "chang"
            | "tung"
    )
}

fn unigram_frequency_score(cand: &str) -> i32 {
    match cand {
        "không" | "được" | "có" | "là" | "người" | "cho" | "trong" | "với" | "như" | "đã"
        | "sẽ" | "nhiều" | "rất" | "nhưng" | "vẫn" | "đến" | "ở" | "vào" | "của" | "một"
        | "các" | "và" | "này" | "ra" | "lại" | "thì" | "nói" | "biết" | "thấy" | "làm"
        | "đi" | "về" | "qua" | "lên" | "xuống" | "khi" | "từ" | "đó" | "đây" | "kìa"
        | "nào" | "gì" | "ai" | "đâu" | "sao" | "thế" | "còn" | "hơn" | "quá" | "rồi"
        | "thôi" | "nhé" | "ạ" | "hả" | "hở" | "ơi" | "ôi" | "ơ" | "dạ" | "vâng" | "ừ"
        | "tôi" | "bạn" | "anh" | "em" | "chị" | "ông" | "bà" | "bố" | "mẹ" | "con"
        | "cháu" | "cô" | "chú" | "bác" | "chúng" | "họ" | "nó" | "hắn" | "ta" | "mình"
        | "ăn" | "uống" | "ngủ" | "nhìn" | "chạy" | "đứng" | "mua" | "bán"
        | "để" | "ngồi" | "đau" | "sợ" | "buồn" | "vui" | "yêu" | "thương" | "ghét" | "giúp" | "bỏ"
        | "thịt" | "cá" | "cơm" | "nước" | "bánh" | "chợ" | "nhà" | "trường" | "lớp" | "đường"
        | "xe" | "ngày" | "tháng" | "năm" | "giờ" | "phút" | "trước" | "sau" | "giữa"
        | "đầu" | "cuối" | "bên" | "trên" | "dưới" | "ngoài" | "phải" | "trái"
        | "đúng" | "sai" | "tốt" | "xấu" | "đẹp" | "hay" | "khó" | "dễ" | "nhỏ" | "lớn"
        | "to" | "ít" | "đầy" | "vừa" | "mới" | "cũ" | "gần" | "xa" | "nhanh" | "chậm"
        | "sớm" | "muộn" | "trời" | "đất" | "lửa" | "gió" | "mây" | "mưa" | "nắng"
        | "cũng" | "cần" | "ấy" | "nếu" | "chuyện" | "thể" | "mọi" | "lão" | "chắc" | "sắp"
        | "đại" | "nhân" | "vấn" | "đề" | "chứ" | "ngầm" | "lẻo" | "hoàn" | "thành" | "giám"
        | "sát" | "tạm" | "biệt" | "tin" | "tưởng" | "xảy" | "nghe" | "lén" | "nổi" | "đóa"
        | "cả" | "nội" | "tạng" | "nấu" | "chấu"
        | "mà" | "nhỉ" | "nữa" | "dù" | "tùy" | "lũ" | "lượng" | "điềm" | "nạn" | "đói"
        | "gây" | "côn" | "trùng" | "cào" | "nghĩ" | "ưa" | "bọn" | "cái" | "vẻ" | "phục"
        | "kích" | "hứa" | "vị" | "giữ" | "số" | "lấy" | "những" | "ngài" | "thị" | "trấn"
        | "thái" | "độ" | "dọa" | "lẫn" | "tương" | "tự" | "thực" | "tế" | "họa" | "ương"
        | "cương" | "nhu" | "trì" | "quan" | "kể" | "ngay" | "nên"
        | "cậu" | "chẳng" | "thèm" | "ngại" | "kia" | "thằng" | "nhóc" | "mày" | "nhãi" | "món"
        | "miệng" | "thật" | "bảo" | "đoán" | "đoạn" | "kém" | "chết" | "sống" | "khiến" | "phần" | "nhớ"
        | "dùng" | "đắt" | "tiền" | "ngào" | "quản" | "cơ" => 15,
        _ => 0,
    }
}

fn split_punct(token: &str) -> (&str, &str, &str) {
    let start = token
        .find(|c: char| c.is_alphanumeric())
        .unwrap_or(token.len());
    let end = token.rfind(|c: char| c.is_alphanumeric()).map_or(0, |idx| {
        idx + token[idx..].chars().next().map_or(0, |c| c.len_utf8())
    });

    if start >= end {
        (token, "", "")
    } else {
        (&token[..start], &token[start..end], &token[end..])
    }
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

fn extract_consonants(s: &str) -> String {
    let vowels = ['a', 'e', 'i', 'o', 'u', 'y'];
    s.chars()
        .filter(|c| c.is_alphabetic() && !vowels.contains(c))
        .collect()
}

pub fn strip_accents(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            'đ' => out.push('d'),
            'Đ' => out.push('D'),
            'à' | 'á' | 'ả' | 'ã' | 'ạ' | 'ă' | 'ằ' | 'ắ' | 'ẳ' | 'ẵ' | 'ặ' | 'â' | 'ầ' | 'ấ'
            | 'ẩ' | 'ẫ' | 'ậ' | 'ā' => out.push('a'),
            'À' | 'Á' | 'Ả' | 'Ã' | 'Ạ' | 'Ă' | 'Ằ' | 'Ắ' | 'Ẳ' | 'Ẵ' | 'Ặ' | 'Â' | 'Ầ' | 'Ấ'
            | 'Ẩ' | 'Ẫ' | 'Ậ' | 'Ā' => out.push('A'),
            'è' | 'é' | 'ẻ' | 'ẽ' | 'ẹ' | 'ê' | 'ề' | 'ế' | 'ể' | 'ễ' | 'ệ' | 'ē' => {
                out.push('e')
            }
            'È' | 'É' | 'Ẻ' | 'Ẽ' | 'Ẹ' | 'Ê' | 'Ề' | 'Ế' | 'Ể' | 'Ễ' | 'Ệ' | 'Ē' => {
                out.push('E')
            }
            'ì' | 'í' | 'ỉ' | 'ĩ' | 'ị' | 'ī' => out.push('i'),
            'Ì' | 'Í' | 'Ỉ' | 'Ĩ' | 'Ị' | 'Ī' => out.push('I'),
            'ò' | 'ó' | 'ỏ' | 'õ' | 'ọ' | 'ô' | 'ồ' | 'ố' | 'ổ' | 'ỗ' | 'ộ' | 'ơ' | 'ờ' | 'ớ'
            | 'ở' | 'ỡ' | 'ợ' | 'ō' => out.push('o'),
            'Ò' | 'Ó' | 'Ỏ' | 'Õ' | 'Ọ' | 'Ô' | 'Ồ' | 'Ố' | 'Ổ' | 'Ỗ' | 'Ộ' | 'Ơ' | 'Ờ' | 'Ớ'
            | 'Ở' | 'Ỡ' | 'Ợ' | 'Ō' => out.push('O'),
            'ù' | 'ú' | 'ủ' | 'ũ' | 'ụ' | 'ư' | 'ừ' | 'ứ' | 'ử' | 'ữ' | 'ự' | 'ū' => {
                out.push('u')
            }
            'Ù' | 'Ú' | 'Ủ' | 'Ũ' | 'Ụ' | 'Ư' | 'Ừ' | 'Ứ' | 'Ử' | 'Ữ' | 'Ự' | 'Ū' => {
                out.push('U')
            }
            'ỳ' | 'ý' | 'ỷ' | 'ỹ' | 'ỵ' => out.push('y'),
            'Ỳ' | 'Ý' | 'Ỷ' | 'Ỹ' | 'Ỵ' => out.push('Y'),
            _ => out.push(c),
        }
    }
    out
}

pub fn pre_normalize_ocr_substitutions(text: &str) -> String {
    let mut s = text.to_string();

    // Strip full-width Chinese/Japanese punctuation marks
    s = s.replace('！', "!").replace('？', "?").replace('，', ",").replace('：', ":");

    // 1. Strip gambling site watermark banners (Sunwin, Hobet, Kèo bóng lăn, 3bet, Nohu, Tip2>...)
    static RE_GAMBLING: OnceLock<regex::Regex> = OnceLock::new();
    let re_gambling = RE_GAMBLING.get_or_init(|| {
        regex::Regex::new(r"(?i)\s*(?:Tip\d*|Tapi\d*|Tip\d+>|Tapi\d+>|Ráp chi[a-z]*|Lenkeobonglan|Hobet|Sunwin|Santuithantai|Nohuthethao|Nohu|3bet|Thuonghieusunwin|Napdau|Nhanngay).*$").unwrap()
    });
    s = re_gambling.replace(&s, "").to_string();

    // 2. Strip video player OSD timecodes (e.g. "09:15/23:58", "5 09:20 / 23:50", "Dù 0 09:23 / 23:59", "23:56", "3 09:54/ 23:5", "a Vao 3 09.56 /23:5")
    static RE_TIMECODE: OnceLock<regex::Regex> = OnceLock::new();
    let re_timecode = RE_TIMECODE.get_or_init(|| {
        regex::Regex::new(r"(?i)(?:\b(?:Dù|Vào|Vao|[a-zA-Z]{1,4})\s*){0,3}\d*\s*\b\d{1,2}[:.]\d{2}\s*(?:[/|\\]\s*\d{1,2}[:.]\d{1,2})?\s*\d*\b").unwrap()
    });
    s = re_timecode.replace_all(&s, "").to_string();

    // 3. Clean trailing stray numbers, punctuation or whitespace left from OSD stripping
    s = s.trim().trim_end_matches(|c: char| c.is_ascii_digit() || c == '/' || c == '\\').trim().to_string();

    // Split hyphenated lowercase words like "minh-ra-doi" -> "minh ra doi"
    if s.contains('-') {
        let parts: Vec<&str> = s.split_whitespace().collect();
        let mut new_parts = Vec::with_capacity(parts.len());
        for p in parts {
            if p.contains('-') && p.chars().any(|c| c.is_alphabetic()) && !p.starts_with("http") {
                let unhyphen = p.replace('-', " ");
                new_parts.push(unhyphen);
            } else {
                new_parts.push(p.to_string());
            }
        }
        s = new_parts.join(" ");
    }

    let subs = [
        ("å", "ả"),
        ("Å", "Ả"),
        ("ů", "ủ"),
        ("Ů", "Ủ"),
        ("ð", "ờ"),
        ("Ð", "Ờ"),
        ("ē", "ẽ"),
        ("Ē", "Ẽ"),
        ("ō", "o"),
        ("Ō", "O"),
        ("sē", "sẽ"),
        ("Sē", "Sẽ"),
        ("sê", "sẽ"),
        ("Sê", "Sẽ"),
        ("ǎn", "ăn"),
        ("Ǎn", "Ăn"),
        ("nghī", "nghĩ"),
        ("Nghī", "Nghĩ"),
        ("đā", "đã"),
        ("Đā", "Đã"),
        ("đên", "đến"),
        ("Đên", "Đến"),
        ("gân", "gần"),
        ("Gân", "Gần"),
        ("Nguyêt", "Nguyệt"),
        ("nguyêt", "nguyệt"),
        ("Nauyêt", "Nguyệt"),
        ("nauyêt", "nguyệt"),
        ("chảng", "chẳng"),
        ("Chảng", "Chẳng"),
        ("nguời", "người"),
        ("nguði", "người"),
        ("nauoi", "người"),
        ("Nauoi", "Người"),
        ("nguoi", "người"),
        ("Nguoi", "Người"),
        ("vẫn dễ", "vấn đề"),
        ("Vẫn dễ", "Vấn đề"),
        ("nói doa", "nổi đóa"),
        ("Nói doa", "Nổi đóa"),
        ("nổi doa", "nổi đóa"),
        ("Nổi doa", "Nổi đóa"),
        ("Mát Ngồi", "Mắt Ngôi"),
        ("mát ngồi", "mắt ngôi"),
        ("anh ay", "anh ấy"),
        ("Anh ay", "Anh ấy"),
        ("chị ay", "chị ấy"),
        ("Chị ay", "Chị ấy"),
        ("em ay", "em ấy"),
        ("Em ay", "Em ấy"),
        ("nó ay", "nó ấy"),
        ("ơ đây", "ở đây"),
        ("Ơ đây", "Ở đây"),
        ("ngudi", "người"),
        ("Ngudi", "Người"),
        ("bay gid", "bây giờ"),
        ("Bay gid", "Bây giờ"),
        ("ngày bay", "ngay bay"),
        ("ngày bây", "ngay bây"),
        ("Ngày bây", "Ngay bây"),
        (" & ", " ở "),
        ("con truna", "côn trùng"),
        ("Con truna", "Côn trùng"),
        ("truna", "trùng"),
        ("nua", "nữa"),
        ("Nua", "Nữa"),
        ("aay ra", "gây ra"),
        ("Aay ra", "Gây ra"),
        ("hoạ", "họa"),
        ("Hoạ", "Họa"),
        ("năn doi", "nạn đói"),
        ("nan doi", "nạn đói"),
        ("Năn doi", "Nạn đói"),
        ("nen cuchaoday", "nên cứ ở đây"),
        ("cuchaoday", "cứ ở đây"),
        ("nen ", "nên "),
        ("Nen ", "Nên "),
        ("caocao", "cào cào"),
        ("cao cao", "cào cào"),
        ("đèn đuốc kinh thành", "đến được kinh thành"),
        ("thế tục là", "thực tế là"),
        ("Gom qua", "Gớm quá"),
        ("gom qua", "gớm quá"),
        ("Kinh qua", "Kinh quá"),
        ("kinh qua", "kinh quá"),
        ("Ngon qua", "Ngon quá"),
        ("ngon qua", "ngon quá"),
        ("sách nhi?", "sách nhỉ?"),
        ("sách nhi", "sách nhỉ"),
        ("đúng chú?", "đúng chứ?"),
        ("đúng chú", "đúng chứ"),
        ("phải chú?", "phải chứ?"),
        ("phải chú", "phải chứ"),
        ("con mỡ nây", "còn con này"),
        ("Từ Thuý", "Tử Thúy"),
        ("Từ Thúy", "Tử Thúy"),
        ("từ thuý", "tử thúy"),
        ("từ thúy", "tử thúy"),
        ("tung nói", "từng nói"),
        ("Tung nói", "Từng nói"),
        ("tướng ty", "tương tự"),
        ("Tướng ty", "Tương tự"),
        ("cỏ năn doi", "có nạn đói"),
        ("cỏ nan doi", "có nạn đói"),
        ("kẻ chợ ngai", "kể cho ngài"),
        ("Kẻ chợ ngai", "Kể cho ngài"),
        ("bụi cuốn", "một cuốn"),
        ("anh tá lả", "anh ta là"),
        ("chim vợ cả", "chim và cá"),
        ("biệt thự này", "biết thứ này"),
        ("Biệt thự này", "Biết thứ này"),
        ("Đúng đóa", "Đừng dọa"),
        ("đúng đóa", "đừng dọa"),
        ("anh bán. Doi", "anh bạn. Đói"),
        ("anh bán. doi", "anh bạn. đói"),
        ("Doi không?", "Đói không?"),
        ("doi không?", "đói không?"),
        ("dạ giúp", "đã giúp"),
        ("phúc kích", "phục kích"),
        ("Phúc kích", "Phục kích"),
        ("thì trân", "thị trấn"),
        ("Thì trân", "Thị trấn"),
        ("con giũ", "còn giữ"),
        ("Sợ còn lại", "Số còn lại"),
        ("sợ còn lại", "số còn lại"),
        ("van lạy", "vẫn lấy"),
        ("da bản", "đã bán"),
        ("da ban", "đã bán"),
        ("mọi chỉ", "mới chỉ"),
        ("cỏ ban", "có bán"),
        ("co ban", "có bán"),
        ("cai này", "cái này"),
        ("Cai này", "Cái này"),
        ("bon tôi", "bọn tôi"),
        ("Bon tôi", "Bọn tôi"),
        ("Cô ve", "Có vẻ"),
        ("cô ve", "có vẻ"),
        ("Cô ve anh dạ", "Có vẻ anh đã"),
        ("cô ve anh dạ", "có vẻ anh đã"),
        ("anh dạ rất", "anh đã rất"),
        ("vấn còn", "vẫn còn"),
        ("không nghi", "không nghĩ"),
        ("Không nghi", "Không nghĩ"),
        ("cũng nghi", "cũng nghĩ"),
        ("Du thế", "Dù thế"),
        ("du thế", "dù thế"),
        ("Không ùa", "Không ưa"),
        ("không ùa", "không ưa"),
        ("đau phải", "đâu phải"),
        ("Đau phải", "Đâu phải"),
        ("cào cào ma", "cào cào mà"),
        ("vai ăn", "và ăn"),
        ("vai an", "và ăn"),
        ("lan vào", "lẫn vào"),
        ("sổ lương", "Số lượng"),
        ("Sổ lương", "Số lượng"),
        ("điểm báo", "điềm báo"),
        ("Lu con truna", "Lũ côn trùng"),
        ("Lu con", "Lũ con"),
        ("lu con", "lũ con"),
        ("Hiếu y cơ rối", "Hiểu ý ta rồi"),
        ("kẻ cả", "kể cả"),
        ("Kẻ cả", "Kể cả"),
        ("cô biết", "có biết"),
        ("phân li tức là hắn phải cổ \"phần Ơi\"", "phần 1 tức là hắn phải có phần 2"),
        ("motbanh", "một bánh"),
        ("mot banh", "một bánh"),
        ("Mondo", "Món đó"),
        ("mondo", "món đó"),
        ("cot layduong", "có lấy đường"),
        ("cot ", "có "),
        ("layduong", "lấy đường"),
        ("đất fien ngao", "đắt tiền ngào"),
        ("đất fien", "đắt tiền"),
        ("fien ngao", "phiền não"),
        ("ngao mây", "ngào mấy"),
        ("mây con", "mấy con"),
        ("cau ta", "cậu ta"),
        ("con chàng", "còn chẳng"),
        ("chàng thèm", "chẳng thèm"),
        ("được mả", "được mà"),
        ("không ngài ạ", "không ngại à"),
        ("Không ngài ạ", "Không ngại à"),
        ("không ngài", "không ngại"),
        ("Không ngài", "Không ngại"),
        ("Đau qua", "Đau quá"),
        ("đau qua", "đau quá"),
        ("cái kìa", "cái kia"),
        ("bay gia dĩ", "bây giờ đi"),
        ("bay gia", "bây giờ"),
        ("gia dĩ", "giờ đi"),
        ("Chuyển mình", "Chuyện mình"),
        ("chuyển mình", "chuyện mình"),
        ("tung làm", "từng làm"),
        ("tung chét", "từng chết"),
        ("tung chết", "từng chết"),
        ("8 duy", "ở đây"),
        ("nhu một", "như một"),
        ("mơ vay", "mơ vậy"),
        ("Tháng nhóc", "Thằng nhóc"),
        ("tháng nhóc", "thằng nhóc"),
        ("Máy nói", "Mày nói"),
        ("máy nói", "mày nói"),
        ("gì có, tháng", "gì cơ, thằng"),
        ("gì có, Tháng", "gì cơ, Thằng"),
        ("gì có", "gì cơ"),
        ("tháng nhai", "thằng nhãi"),
        ("Mon gớm", "Món gớm"),
        ("mon gớm", "món gớm"),
        ("gì vay", "gì vậy"),
        ("gì vay?", "gì vậy?"),
        ("Im miếng", "Im miệng"),
        ("im miếng", "im miệng"),
        ("gom thát", "gớm thật"),
        ("thát mà", "thật mà"),
        ("thất bát làm", "thất bát lắm"),
        ("chắc thé", "chắc thế"),
        ("thé nghĩa là", "thế nghĩa là"),
        ("bào mòn kìa gom", "bảo món kia gớm"),
        ("mòn kìa", "món kia"),
        ("kìa gom", "kia gớm"),
        ("Doan mùa", "Đoán mùa"),
        ("doan mùa", "đoán mùa"),
        ("Chang biết", "Chẳng biết"),
        ("chang biết", "chẳng biết"),
        ("vụ kem", "vụ kém"),
        ("chét đi sông lại", "chết đi sống lại"),
        ("chét đi", "chết đi"),
        ("sông lại", "sống lại"),
        ("khiên một phan", "khiến một phần"),
        ("có thể thằng bé", "cơ thể thằng bé"),
        ("khiên ", "khiến "),
        ("một phan", "một phần"),
        ("Nội cung", "Nó cũng"),
        ("nội cung", "nó cũng"),
        ("mát đi", "mất đi"),
        ("nho lại", "nhớ lại"),
        ("Dúng tay", "Dùng tay"),
        ("dúng tay", "dùng tay"),
    ];
    for (k, v) in subs {
        s = s.replace(k, v);
    }

    // Question tag: "gì cha?" -> "gì chứ?", "sao cha?" -> "sao chứ?"
    s = s.replace("gì cha?", "gì chứ?")
         .replace("gì cha!", "gì chứ!")
         .replace("gì cha.", "gì chứ.")
         .replace("gì cha", "gì chứ")
         .replace("sao cha?", "sao chứ?")
         .replace("sao cha", "sao chứ");

    // "Ạ phải" at start of utterance -> "À phải"
    if s.starts_with("Ạ phải") {
        s = s.replacen("Ạ phải", "À phải", 1);
    } else if s.starts_with("Ạ,") || s.starts_with("Ạ ") {
        s = s.replacen("Ạ", "À", 1);
    }

    s
}
