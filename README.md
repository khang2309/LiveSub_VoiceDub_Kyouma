# 🎬 LiveSub & VoiceDub AI Studio

**Hệ Thống Phụ Đề & Thuyết Minh / Lồng Tiếng AI Thời Gian Thực Đa Nguồn (100% Pure Rust & Universal Chrome Extension)**  
*(NVIDIA RTX CUDA / DirectML | Faster-Whisper + VinAI Translate + VieNeu-TTS Turbo + RapidOCR Diacritics)*

---

## 🚀 Tải Về & Cài Đặt (Zero-Setup)

Bạn không cần cài đặt Python, Node.js hay Rust/Cargo để sử dụng ứng dụng. Toàn bộ hệ thống đã được đóng gói thành một file cài đặt Windows duy nhất sẵn sàng sử dụng:

### 📦 1. Ứng Dụng Windows Desktop (NSIS Installer)
1. Tải trực tiếp file cài đặt duy nhất: **[Tải setup.exe (Direct Download)](https://github.com/khang2309/LiveSub_VoiceDub_Kyouma/raw/main/setup.exe)** *(~21 MB)*.
2. Nhấp đúp vào `setup.exe` để cài đặt. Trình cài đặt sẽ tự động tạo lối tắt **LiveSub Studio** ngoài màn hình Desktop.
3. Mở ứng dụng từ Desktop và bắt đầu xem phim, anime hoặc video YouTube.

---

### 🌐 2. Tiện Ích Trình Duyệt Chrome Extension (Manifest V3)
Tiện ích mở rộng chạy trực tiếp trên Google Chrome, Microsoft Edge, Brave, Cốc Cốc:
1. Mở trình duyệt và truy cập `chrome://extensions/`
2. Bật công tắc **Chế độ dành cho nhà phát triển** (**Developer mode**).
3. Bấm **Tải tiện ích đã giải nén** (**Load unpacked**) và chọn thư mục:
   ```
   C:\dich\extension
   ```
4. Xem video trên bất kỳ trang web nào (YouTube, AnimeVietsub, AnimeHay, Netflix, Bilibili...) — tiện ích sẽ tự động đồng bộ và thuyết minh! Bấm **`Alt + D`** để bật/tắt nhanh.

---

## 📖 Hướng Dẫn Sử Dụng Trong 3 Bước

### Bước 1: Chọn Nguồn Phát Video
* 🌐 **Link YouTube:** Dán link video YouTube (hỗ trợ dịch phụ đề gốc, tự động lồng tiếng giọng Việt).
* 💻 **Màn Hình / Tab Phim:** Xem phim trên **Netflix, Bilibili, AnimeHay, AnimeVietsub, WeTV, VLC Player, PotPlayer**... Bấm *"Bắt Đầu Đọc & Lồng Tiếng"* và chia sẻ Tab hoặc Cửa sổ phim (nhớ tích chọn *"Chia sẻ âm thanh / Share system audio"*).

### Bước 2: Chọn Giọng Lồng Tiếng
* Chọn 1 trong các giọng đọc AI truyền cảm, tự nhiên:
  * 🎙️ **Trúc Ly (Nữ Hà Nội - Truyền Cảm, Dịu Dàng)** *(Mặc định khuyên dùng)*
  * 🎙️ **Nam Minh (Nam Hà Nội - Trầm Ấm, Chững Chạc)**
  * 🎙️ **Bảo Ngọc (Nữ Sài Gòn - Ngọt Ngào, Trong Trẻo)**
  * 🎙️ **Khánh Nam (Nam Sài Gòn - Rõ Ràng, Tự Tin)**
  * 🎙️ **Hải Đăng, Thiện Minh, Mai Anh, Thùy Dung, Thái Sơn, Ngọc Huyền...**
* Bấm nút **"Nghe Thử"** để kiểm tra chất giọng.

### Bước 3: Xem Phim & Tận Hưởng
* ⚡ **Nút "Thích ứng video":** 
  * Tích chọn để AI tự động tăng tốc giọng đọc để đuổi kịp và khớp hoàn hảo với thời lượng phụ đề, video phát mượt mà liên tục không bao giờ bị gián đoạn hay dừng hình.
  * Bỏ tích để giữ cố định tốc độ đọc theo thanh trượt.
* ✨ **Cửa sổ nổi (Always-on-Top PiP):** Bấm nút *"Ghim PiP"* để mở thanh phụ đề trong suốt đè lên bất kỳ phần mềm xem phim nào (phím tắt `P` để dừng/chạy quét, `M` bật/tắt tiếng, `T` đổi độ trong suốt).

---

## ⚡ Các Tính Năng Nổi Bật

### 1. 100% Pure Rust Native Engine (Zero GIL, Siêu Nhẹ & Ổn Định)
* Backend hoàn toàn không dùng Python hay runtime cồng kềnh, loại bỏ 100% hiện tượng tắc nghẽn GIL (Global Interpreter Lock).
* Tiêu thụ RAM cực thấp, khởi động tức thì chỉ trong 0.2 giây.

### 2. VieNeu-TTS v3 Turbo Offline Native
* Tích hợp trực tiếp kiến trúc Transformer & ONNX Runtime CUDA/CPU trong Rust.
* Phát âm thanh theo luồng PCM thời gian thực với độ trễ cực thấp (~200ms), tự động phân tách câu dài mượt mà không lo bị trễ.

### 3. Tối Ưu Nhận Diện Dấu Phụ Đề Anime & Tiếng Việt (OCR Engine)
* Thuật toán giải mã Viterbi kết hợp từ điển ngữ cảnh chuyên sâu:
  - Phân biệt chính xác nguyên âm có dấu mũ (`ô`, `ê`, `â`) với nguyên âm dấu sắc (`ó`, `é`, `á`).
  - Tự động sửa lỗi quang học trong anime: `rễ ô đầu` (thay vì nhầm thành `rê ở đâu`), `phơi khô` (thay vì `phơi khó`), `mỗi năm` (thay vì `môi năm`), `một nửa` (thay vì `môt nữa`), `trả được` (thay vì `tra được`).
  - Tự động lọc sạch rác nút tua `Dù 10`, `10`, `:59` của trình phát video web.
  - Cửa sổ PiP thông minh: Tự động ẩn dòng nguồn khi xem phim Vietsub, không bao giờ hiển thị 2 dòng chữ Tiếng Việt đè lên nhau.

---

## 🛠️ Cấu Trúc Thư Mục Dự Án

```
LiveSub_VoiceDub_Kyouma/
├── setup.exe                    # Bộ cài đặt Windows Setup duy nhất (NSIS Installer)
├── extension/                   # Tiện ích mở rộng Chrome Extension (Manifest V3)
│   ├── manifest.json            # Cấu hình tiện ích
│   ├── popup.html / popup.js    # Giao diện điều khiển lồng tiếng
│   ├── content.js / style.css   # Script đồng bộ video, audio ducking & phụ đề
│   └── background.js            # Service worker kết nối TTS engine
├── public/                      # Giao diện người dùng Web & Desktop Studio
│   ├── index.html               # Dashboard Studio chính (v1.0.5)
│   ├── loader.html              # Màn hình Splash tải hệ thống
│   ├── overlay.html             # Cửa sổ phụ đề nổi Always-on-Top PiP
│   └── app.js                   # Bộ xử lý Web Audio, Streaming TTS & Đồng bộ
├── rust/                        # Mã nguồn Pure Rust Workspace
│   ├── livesub-app/             # Axum HTTP/WS Server binary
│   ├── vieneu-tts-rs/           # Native VieNeu Neural TTS Inference Engine
│   ├── ocr-engine-rs/           # Engine OCR nhận diện phụ đề thời gian thực
│   └── translation-router-rs/   # Bộ định tuyến dịch thuật offline & online
├── src-tauri/                   # Mã nguồn ứng dụng Desktop & NSIS Installer
├── scripts/                     # Các script bảo trì, đóng gói và shortcut
├── PRIVACY_POLICY.md            # Chính sách quyền riêng tư
└── README.md                    # Tài liệu hướng dẫn sử dụng
```

---

## 📜 Giấy Phép & Bản Quyền

Dự án phát triển bởi **khang2309**.  
Mọi đóng góp (Pull Request), phản hồi lỗi (Issue) đều được hoan nghênh!
