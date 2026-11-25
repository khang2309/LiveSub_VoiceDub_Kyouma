# 🎬 LiveSub & VoiceDub AI Studio

**Hệ Thống Phụ Đề & Thuyết Minh / Lồng Tiếng AI Thời Gian Thực Đa Nguồn (100% Pure Rust)**  
*(NVIDIA RTX CUDA / DirectML | Faster-Whisper + VinAI Translate + VieNeu-TTS Turbo)*

---

## 🚀 Tải Về & Cài Đặt (Zero-Setup)

Bạn không cần cài đặt Python, Node.js hay Rust/Cargo để sử dụng ứng dụng. Toàn bộ hệ thống đã được biên dịch thành binary độc lập sẵn sàng chạy ngay:

### 📦 Cách 1: Cài Đặt Bằng Bộ Cài Windows (Khuyên Dùng)
1. Tải trực tiếp file cài đặt: **[Tải LiveSub-Studio-Setup.exe (Direct Download)](https://github.com/khang2309/LiveSub_VoiceDub_Kyouma/raw/main/LiveSub-Studio-Setup.exe)** hoặc **[Tải setup.exe](https://github.com/khang2309/LiveSub_VoiceDub_Kyouma/raw/main/setup.exe)**.
2. Nhấp đúp vào file `.exe` vừa tải để cài đặt. Ứng dụng sẽ tự động tạo lối tắt **LiveSub Studio** ngoài màn hình Desktop.
3. Mở ứng dụng từ Desktop và bắt đầu xem phim, anime hoặc video YouTube.

### ⚡ Cách 2: Chạy Trực Tiếp Binary Độc Lập
1. Tải file **[livesub.exe](https://github.com/khang2309/LiveSub_VoiceDub_Kyouma/raw/main/livesub.exe)** về máy.
2. Nhấp đúp vào file `livesub.exe` để khởi chạy máy chủ backend và mở trình duyệt tại `http://localhost:3000`.

---

## 📖 Hướng Dẫn Sử Dụng Trong 3 Bước

### Bước 1: Chọn Nguồn Phát Video
* 🌐 **Link YouTube:** Dán link video YouTube (hỗ trợ dịch phụ đề gốc, tự động lồng tiếng giọng Việt).
* 💻 **Màn Hình / Tab Phim:** Xem phim trên **Netflix, Bilibili, AnimeHay, WeTV, VLC Player, PotPlayer**... Bấm *"Bắt Đầu Đọc & Lồng Tiếng"* và chia sẻ Tab hoặc Cửa sổ phim (nhớ tích chọn *"Chia sẻ âm thanh / Share system audio"*).

### Bước 2: Chọn Giọng Lồng Tiếng
* Chọn 1 trong 11 giọng đọc AI truyền cảm, tự nhiên:
  * 🎙️ **Hải Đăng (Nam Trầm Ấm)**
  * 🎙️ **Trúc Ly (Nữ Dịu Dàng)**
  * 🎙️ **Thiện Minh (Nam Kể Chuyện)**
  * 🎙️ **Mai Anh (Nữ Trẻ Trung)**
  * 🎙️ **Thùy Dung (Nữ Truyền Cảm)**
  * 🎙️ **Thái Sơn (Nam Hùng Hồn)**
  * 🎙️ **Ngọc Huyền (Nữ Miền Nam Ngọt Ngào)**
  * 🎙️ **Quỳnh Anh (Nữ Trong Trẻo)**
  * 🎙️ **Đức Trí (Nam Tri Thức)**
  * 🎙️ **Minh Đức (Nam Tự Nhiên)**
  * 🎙️ **Kim Thanh (Nữ Chuẩn Mực)**
* Bấm nút **"Nghe Thử"** để kiểm tra chất giọng.

### Bước 3: Xem Phim & Tận Hưởng
* ⚡ **Nút "Thích ứng video":** 
  * Tích chọn để AI tự động tăng tốc giọng đọc để đuổi kịp và khớp hoàn hảo với thời lượng phụ đề, video phát mượt mà liên tục không bao giờ bị gián đoạn hay dừng hình (áp dụng đồng bộ cho cả 2 chế độ: Tab Phim và Link YouTube).
  * Bỏ tích để giữ cố định tốc độ đọc theo thanh trượt.
* ✨ **Cửa sổ nổi (Always-on-Top PiP):** Bấm nút *"Ghim PiP"* để mở thanh phụ đề trong suốt đè lên bất kỳ phần mềm xem phim nào.

---

## ⚡ Các Tính Năng Nổi Bật

### 1. 100% Pure Rust Native Engine (Zero GIL, Siêu Nhẹ & Ổn Định)
* Backend hoàn toàn không dùng Python hay runtime cồng kềnh, loại bỏ 100% hiện tượng tắc nghẽn GIL (Global Interpreter Lock).
* Tiêu thụ RAM cực thấp, khởi động tức thì chỉ trong 0.2 giây.

### 2. VieNeu-TTS v3 Turbo Offline Native
* Tích hợp trực tiếp kiến trúc Transformer & ONNX Runtime CUDA/CPU trong Rust.
* Phát âm thanh theo khối PCM thời gian thực với độ trễ cực thấp (~200ms), tự động phân tách câu dài mượt mà không lo bị trễ.

### 3. RapidOCR Nhận Diện Phụ Đề Video Thời Gian Thực (~20ms)
* Quét và nhận diện chính xác từng ký tự phụ đề Vietsub hoặc phụ đề gốc (Anh, Nhật, Hàn, Trung) trực tiếp trên khung hình.
* Tự động lọc sạch watermark quảng cáo web phim và nút bấm giao diện người chơi.

---

## 🛠️ Cấu Trúc Thư Mục Dự Án

```
LiveSub_VoiceDub_Kyouma/
├── LiveSub-Studio-Setup.exe   # Bộ cài đặt Windows Setup (NSIS Installer)
├── setup.exe                  # Bản sao bộ cài đặt tiện dụng
├── livesub.exe                # File thực thi Standalone Backend Engine (Pure Rust)
├── start.bat                  # Script khởi động LiveSub Studio 1-click
├── public/                    # Giao diện người dùng Web & Desktop Studio
│   ├── index.html             # Dashboard Studio chính
│   ├── loader.html            # Màn hình Splash tải hệ thống
│   ├── overlay.html           # Cửa sổ phụ đề nổi trong suốt PiP
│   └── app.js                 # Bộ xử lý Web Audio, Streaming TTS & Đồng bộ
├── rust/                      # Mã nguồn Pure Rust Workspace
│   ├── livesub-app/           # Axum HTTP/WS Server binary (`livesub.exe`)
│   ├── vieneu-tts-rs/         # Native VieNeu Neural TTS Inference Engine
│   ├── ocr-engine-rs/         # Engine OCR nhận diện phụ đề thời gian thực
│   └── translation-router-rs/ # Bộ định tuyến dịch thuật offline & online
├── scripts/                   # Các script bảo trì, đóng gói và shortcut
└── README.md
```

---

## 📜 Giấy Phép & Bản Quyền

Dự án phát triển bởi **khang2309**.  
Mọi đóng góp (Pull Request), phản hồi lỗi (Issue) đều được hoan nghênh!
