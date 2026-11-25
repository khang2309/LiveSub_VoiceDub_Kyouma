pub mod fusion;
pub mod lexicon;

use fusion::fuse_dual_engine_words;
use lexicon::Lexicon;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Language {
    Auto,
    Vi,
    Ja,
    Zh,
    Ko,
    Th,
    En,
}

impl Language {
    pub fn from_str(s: &str) -> Self {
        let norm = s.trim().to_lowercase().replace('_', "-");
        let prefix = norm.split('-').next().unwrap_or("vi");
        match prefix {
            "vi" | "viet" | "vietnamese" => Language::Vi,
            "ja" | "jp" | "japanese" => Language::Ja,
            "zh" | "ch" | "chinese" | "cmn" => Language::Zh,
            "ko" | "kor" | "korean" => Language::Ko,
            "th" | "thai" => Language::Th,
            "en" | "eng" | "english" => Language::En,
            "auto" => Language::Auto,
            _ => Language::Vi,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Language::Auto => "auto",
            Language::Vi => "vi",
            Language::Ja => "ja",
            Language::Zh => "zh",
            Language::Ko => "ko",
            Language::Th => "th",
            Language::En => "en",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrResult {
    pub text: String,
    pub confidence: f32,
    pub latency_ms: f64,
    pub language: String,
}

pub struct OcrEngine {
    lexicon: &'static Lexicon,
}

impl Default for OcrEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl OcrEngine {
    pub fn new() -> Self {
        Self {
            lexicon: Lexicon::global(),
        }
    }

    pub fn fuse_lines(&self, rapid_line: &str, secondary_line: &str) -> String {
        fuse_dual_engine_words(rapid_line, secondary_line, self.lexicon)
    }

    pub fn normalize_language(&self, lang: &str) -> &'static str {
        Language::from_str(lang).code()
    }

    pub fn restore_vietnamese(&self, text: &str) -> String {
        self.lexicon.restore_vietnamese_text(text)
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_restore_vietnamese() {
        let engine = OcrEngine::new();
        let samples = [
            (
                "Không có thit, Nhưng vn ăn được",
                "Không có thịt, Nhưng vẫn ăn được",
            ),
            ("Im lng mà ǎn di!", "Im lặng mà ăn đi!"),
            (
                "Hay đê em ăn ht giúp các ch?",
                "Hay để em ăn hết giúp các chị?",
            ),
            (
                "Cho em mt bnh trung thu là được",
                "Cho em một bánh trung thu là được",
            ),
            (
                "Trưc khi nu châu chu, phải loi bo ni tng",
                "Trước khi nấu châu chấu, phải loại bỏ nội tạng",
            ),
            (
                "Nên đương nhiên là sê rồng rut. Nhưng",
                "Nên đương nhiên là sẽ rỗng ruột. Nhưng",
            ),
            ("Ta nhó ra rồi", "Ta nhớ ra rồi"),
            ("Ra ch mua it nhang nhé", "Ra chợ mua ít nhang nhé"),
            ("Đuac. Tra công thế nào a?", "Được. Trả công thế nào ạ?"),
            (
                "Mt lut tm sáng và mt ba sáng hai người",
                "Một lượt tắm sáng và một bữa sáng hai người",
            ),
            ("Th còn chưa đú à?", "Thế còn chưa đủ à?"),
            ("Đồ bun xin", "Đồ bủn xỉn"),
            ("Con va nói gì đó?", "Con vừa nói gì đó?"),
            ("Tri đt i", "Trời đất ơi"),
            ("Khong co thit nhung van an duoc", "Không có thịt nhưng vẫn ăn được"),
            ("sau sáu ngày", "sau sáu ngày"),
            ("bắt đầu sau sáu giây", "bắt đầu sau sáu giây"),
        ];

        for (input, expected) in samples {
            let output = engine.restore_vietnamese(input);
            println!(
                "Input:    {}\nRestored: {}\nExpected: {}\n",
                input, output, expected
            );
            assert_eq!(output, expected);
        }
    }

    #[test]
    fn test_anime_subtitles_restoration() {
        let engine = OcrEngine::new();
        let samples = [
            ("Tôi biết nauoi này", "Tôi biết người này"),
            ("Ạ phải, chi Bách Linh chác sáp tan làm rối", "À phải, chị Bách Linh chắc sắp tan làm rồi"),
            ("Thế ạ? Được rồi chác ta xong việc rồi! Tam biết!", "Thế ạ? Được rồi chắc ta xong việc rồi! Tạm biệt!"),
            ("Anh cung không can giam sát đau, Hưu Khiêu", "Anh cũng không cần giám sát đâu, Hưu Khiêu"),
            ("Anh đau thế bỏ em lại", "Anh đâu thể bỏ em lại"),
            ("Nêu em xảy ra chuyên gì", "Nếu em xảy ra chuyện gì"),
            ("Hồ Ly dai nhan và Mát Ngồi dai nhan sẽ nói doa với anh", "Hồ Ly đại nhân và Mắt Ngôi đại nhân sẽ nổi đóa với anh"),
            ("Không có vẫn dễ gì cha? Anh sẽ im lặng đúng đây thôi", "Không có vấn đề gì chứ? Anh sẽ im lặng đứng đây thôi"),
            ("Anh không nghe lén đau", "Anh không nghe lén đâu"),
            ("Hưu Khiêu dạ ơ đây từ trước ca khi minh-ra-doi", "Hưu Khiêu đã ở đây từ trước cả khi mình ra đời"),
            ("Anh ay có thế hoan thanh mới việc ca Lao bà ba cung ngam tin tưởng anh ay", "Anh ấy có thể hoàn thành mọi việc cả Lão bà bà cũng ngầm tin tưởng anh ấy"),
            ("Nhưng chác anh ay sẽ mách léo mình", "Nhưng chắc anh ấy sẽ mách lẻo mình"),
            ("Thôi, kẻ cả Lão bà bà cô biết cũng chẳng sao", "Thôi, kể cả Lão bà bà có biết cũng chẳng sao"),
            ("Anh biệt thự này, đúng chú?", "Anh biết thứ này, đúng chứ?"),
            ("Các cuốn còn lại đau?", "Các cuốn còn lại đâu?"),
            ("Vi quan võ vừa rồi dạ giúp phúc kích thành trì", "Vị quan võ vừa rồi đã giúp phục kích thành trì"),
            ("Tôi kẻ chợ ngai ấy chuyện anh cũng ? đó nhé", "Tôi kể cho ngài ấy chuyện anh cũng ? đó nhé"),
            ("Tôi bán hai cuốn nua & thì trân khác", "Tôi bán hai cuốn nữa ở thị trấn khác"),
            ("nhưng tôi con giũ bụi cuốn", "nhưng tôi còn giữ một cuốn"),
            ("Sợ còn lại tôi không lay", "Số còn lại tôi không lấy"),
            ("Nhưng cuốn con trong thành trì có thể van lạy về được", "Những cuốn còn trong thành trì có thể vẫn lấy về được"),
            ("Hai cuốn anh tà da bản thi lại gay go", "Hai cuốn anh ta đã bán thì lại gay go"),
            ("Đến giờ mình mọi chỉ có cuốn chim vợ cả", "Đến giờ mình mới chỉ có cuốn chim và cá"),
            ("Anh cỏ ban cuốn côn trùng không?", "Anh có bán cuốn côn trùng không?"),
            ("Anh mang cuốn đó đến ngày bay gid được không?", "Anh mang cuốn đó đến ngay bây giờ được không?"),
            ("Có hua không tố giác tôi được không?", "Có hứa không tố giác tôi được không?"),
            ("Con tuy vào thái đô của anh", "Còn tùy vào thái độ của anh"),
            ("Đúng đóa anh ta", "Đừng dọa anh ta"),
            ("Này, anh bán. Doi không?", "Này, anh bạn. Đói không?"),
            ("Chắc chắn anh có lý do riêng, nen cuchaoday nhé", "Chắc chắn anh có lý do riêng, nên cứ ở đây nhé"),
            ("Anh cho tôi ăn cai này sao?", "Anh cho tôi ăn cái này sao?"),
            ("Ừ, nhưng đã là đồ thừa của bon tôi", "Ừ, nhưng đã là đồ thừa của bọn tôi"),
            ("Ngon qua!", "Ngon quá!"),
            ("Cô ve anh dạ rất chật vật trước khi đèn đuốc kinh thành", "Có vẻ anh đã rất chật vật trước khi đến được kinh thành"),
            ("Nhưng cuốn sách vấn còn nguyên trạng", "Những cuốn sách vẫn còn nguyên trạng"),
            ("Anh hết cách mới phải bán sách nhi?", "Anh hết cách mới phải bán sách nhỉ?"),
            ("Anh không nghi anh tá lả ngudi xấu", "Anh không nghĩ anh ta là người xấu"),
            ("Du thế cũng không được", "Dù thế cũng không được"),
            ("Kinh qua", "Kinh quá"),
            ("Không ùa châu chấu ạ?", "Không ưa châu chấu ạ?"),
            ("Đây đau phải châu chấu. Là cào cào ma", "Đây đâu phải châu chấu. Là cào cào mà"),
            ("Con này là châu chấu, con mỡ nây là cào cào", "Con này là châu chấu, còn con này là cào cào"),
            ("Nông dân sẽ phân biệt dược", "Nông dân sẽ phân biệt được"),
            ("Châu chấu thì ăn được con caocao không có thịt vai ăn rất kinh", "Châu chấu thì ăn được còn cào cào không có thịt và ăn rất kinh"),
            ("Gom qua! có cao cao lan vào đây", "Gớm quá! có cào cào lẫn vào đây"),
            ("Từ Thuý tung nói tướng ty", "Tử Thúy từng nói tương tự"),
            ("Nhưng thế tục là", "Nhưng thực tế là"),
            ("Năm nay có thể cỏ năn doi", "Năm nay có thể có nạn đói"),
            ("Anh cũng nghi thế ạ?", "Anh cũng nghĩ thế ạ?"),
            ("sổ lương cào cào nhiều hơn châu chấu là điểm báo tai ương cho năm tới", "Số lượng cào cào nhiều hơn châu chấu là điềm báo tai ương cho năm tới"),
            ("Lu con truna này sẽ aay ra tai hoạ", "Lũ côn trùng này sẽ gây ra tai họa"),
        ];

        for (input, expected) in samples {
            let output = engine.restore_vietnamese(input);
            println!("\n[TEST INPUT]    {}\n[TEST OUTPUT]   {}\n[EXPECTED]      {}", input, output, expected);
            assert_eq!(output, expected);
        }
    }

    #[test]
    fn test_anime_kusuriya_40_samples() {
        let engine = OcrEngine::new();
        let samples = [
            ("cau ta con chàng thèm trả giá", "cậu ta còn chẳng thèm trả giá"),
            ("cau ta cot layduong đất fien ngao mây con này dễ bảo quản. 09:15/23:58 Tip2> Ráp chifu Em& ring ， + Lenkeobonglan Không Hobet Gioihan Giàu Sang Santuithantai 88 Choi ：", "cậu ta có lấy đường đắt tiền ngào mấy con này dễ bảo quản."),
            ("Sao phải mất công thế? vứt đi là được mả. 5 09:20 / 23:50", "Sao phải mất công thế? vứt đi là được mà."),
            ("Em không ngài ạ, Triêu Vu?", "Em không ngại à, Triêu Vu?"),
            ("im lặng mà ăn đi! Dù 0 09:23 / 23:59", "im lặng mà ăn đi!"),
            ("Hay để em ăn hết giúp các chị? 23:56", "Hay để em ăn hết giúp các chị?"),
            ("09:35 /23:56 Ý Dĩ", "Ý Dĩ"),
            ("Cho em motbanh trung thu là được Dù 09:36/ 23:50 9", "Cho em một bánh trung thu là được"),
            ("Ôi. Đau qua, Tàn Nhang!", "Ôi. Đau quá, Tàn Nhang!"),
            ("qua 09:41/23:59 Tip2> Ráp chidu Mà rong Xa Lenkeobonglan Dugc Bảo Chứng Bdi Không Hobet Thuonghieusunwin Giàu Sang Gioihan Thuở 88", ""),
            ("Tapi> Ráp chicu Mở rộng Xa Napdau Nhanngay Un Hobet 150% +2otrieu Ra Sui", ""),
            ("Ra chợ mua ít nhang nhé. 3 09:54/ 23:5", "Ra chợ mua ít nhang nhé."),
            ("Được. Trả công thế nào ạ? a Vao 3 09.56 /23:5", "Được. Trả công thế nào ạ?"),
            ("Một lượt tắm sáng và một bữa sáng hai người", "Một lượt tắm sáng và một bữa sáng hai người"),
            ("Thế còn chưa đủ à?", "Thế còn chưa đủ à?"),
            ("Con vừa nói gì đó?", "Con vừa nói gì đó?"),
            ("Nào, Tàn Nhang!", "Nào, Tàn Nhang!"),
            ("Mua cái kìa cho em！ Không", "Mua cái kia cho em! Không"),
            ("Nhìn mình bay gia dĩ", "Nhìn mình bây giờ đi"),
            ("Chuyển mình tung làm việc 8 duy cảm giác nhu một giấc mơ vay", "Chuyện mình từng làm việc ở đây cảm giác như một giấc mơ vậy"),
            ("Tháng nhóc này!", "Thằng nhóc này!"),
            ("Máy nói gì có, tháng nhai?", "Mày nói gì cơ, thằng nhãi?"),
            ("Mon gớm ghiếc này không có thịt", "Món gớm ghiếc này không có thịt"),
            ("Triêu Vu! Này, làm cái gì vay?", "Triêu Vu! Này, làm cái gì vậy?"),
            ("Xin lỗi chứ", "Xin lỗi chứ"),
            ("Sao? Em nói sự thật mà!", "Sao? Em nói sự thật mà!"),
            ("Im miếng đi", "Im miệng đi"),
            ("Mondo gom thát mà", "Món đó gớm thật mà"),
            ("Chắc thé nghĩa là năm nay mùa màng thất bát làm", "Chắc thế nghĩa là năm nay mùa màng thất bát lắm"),
            ("Em vừa nói gì?", "Em vừa nói gì?"),
            ("Em bào mòn kìa gom", "Em bảo món kia gớm"),
            ("Không, sau đó nữa", "Không, sau đó nữa"),
            ("Doan mùa màng thất bát ạ?", "Đoán mùa màng thất bát ạ?"),
            ("Đúng rồi. Sao em biết?", "Đúng rồi. Sao em biết?"),
            ("Chang biết nữa, em nghe nói thế", "Chẳng biết nữa, em nghe nói thế"),
            ("Côn trùng mà không có thịt tức là mùa vụ kem", "Côn trùng mà không có thịt tức là mùa vụ kém"),
            ("Triêu Vu tung chét đi sông lại một lần", "Triêu Vu từng chết đi sống lại một lần"),
            ("khiên một phan có thể thằng bé tê liệt", "khiến một phần cơ thể thằng bé tê liệt"),
            ("Nội cung mát đi rất nhiều ký ức", "Nó cũng mất đi rất nhiều ký ức"),
            ("Nào, nho lại đi. Dúng tay!", "Nào, nhớ lại đi. Dùng tay!"),
        ];

        for (input, expected) in samples {
            let output = engine.restore_vietnamese(input);
            println!("\n[40 TEST INPUT]    {}\n[40 TEST OUTPUT]   {}\n[EXPECTED]         {}", input, output, expected);
            assert_eq!(output, expected);
        }
    }

    #[test]
    fn test_user_reported_issues() {
        let engine = OcrEngine::new();
        let samples = [
            (
                "Mỗi năm 1.000 lượng bạc, năm nay tôi trả được một nửa rồi.",
                "Mỗi năm 1.000 lượng bạc, năm nay tôi trả được một nửa rồi.",
            ),
            (
                "Môi năm 1.000 lượng bạc, năm nay tôi tra được môt nữa rồi.",
                "Mỗi năm 1.000 lượng bạc, năm nay tôi trả được một nửa rồi.",
            ),
            (
                "11:24 / 23:59 Mỗi năm 1.000 lượng bạc, năm nay tôi trả được một nửa rồi.",
                "Mỗi năm 1.000 lượng bạc, năm nay tôi trả được một nửa rồi.",
            ),
            (
                "cô có muốn uống thì không",
                "cô có muốn uống thì không",
            ),
            (
                "có có muôn uông thì không",
                "cô có muốn uống thì không",
            ),
            (
                "Nó mạnh hơn các loại rượu thông thường nên sẽ khiến người bình thường bất tỉnh.",
                "Nó mạnh hơn các loại rượu thông thường nên sẽ khiến người bình thường bất tỉnh.",
            ),
        ];

        for (input, expected) in samples {
            let output = engine.restore_vietnamese(input);
            println!("\n[USER TEST INPUT]    {}\n[USER TEST OUTPUT]   {}\n[EXPECTED]           {}", input, output, expected);
            assert_eq!(output, expected);
        }
    }
}
