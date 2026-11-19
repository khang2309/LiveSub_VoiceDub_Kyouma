# 🎬 LiveSub & VoiceDub AI Studio

**Hệ Thống Phụ Đề & Thuyết Minh / Lồng Tiếng AI Thời Gian Thực Đa Nguồn**  
*(Tăng tốc phần cứng GPU NVIDIA RTX 3050 CUDA float16 | Faster-Whisper + Neural TTS | Độ trễ $\le$ 0.5s)*

---

## 🌟 Giới Thiệu Tổng Quan

**LiveSub & VoiceDub AI Studio** là giải pháp phần mềm mã nguồn mở hoàn chỉnh giúp tạo phụ đề tự động và lồng tiếng / thuyết minh tiếng Việt thời gian thực (realtime) cho **mọi nguồn video và âm thanh trên máy tính Windows**:

* 💻 **Âm Thanh Hệ Thống / Mọi Ứng Dụng:** Xem phim, video qua **VLC Player, Windows Media Player, Netflix, Zoom, Google Meet, Facebook Video, TikTok, Livestream, Game**...
* 📁 **File Video Máy Tính (Local Media):** Mở trực tiếp các file `.mp4`, `.mkv`, `.webm`, `.avi` ngay trong trình phát video tích hợp. Phụ đề được hiển thị **100% trong suốt viền đen sắc nét đè trực tiếp lên đáy video**, không che diễn viên, đồng bộ tức thì khi Tua (Seek) hoặc Dừng (Pause).
* 🎤 **Microphone Trực Tiếp:** Lắng nghe và dịch tức thì giọng nói ngoài đời thật khi họp hành, hội thảo, học ngoại ngữ.
* 🌐 **Link Video Trực Tuyến:** Dán link xem và lồng tiếng trực tiếp trong ứng dụng.

---

## ⚡ Các Tính Năng Nổi Bật & Cải Tiến

### 1. Tăng Tốc Phần Cứng GPU NVIDIA RTX 3050 (CUDA 12 float16)
* Nhận diện giọng nói qua mô hình **Faster-Whisper (base)** chạy trực tiếp trên GPU rời qua thư viện NVIDIA cuBLAS 12 & cuDNN 9.
* Thời gian xử lý nhận diện giọng nói: **~0.34 giây** (nhanh hơn gấp 10 lần so với CPU thông thường).
* Tổng độ trễ toàn chu trình (Nghe $\rightarrow$ Dịch $\rightarrow$ Lồng tiếng): **$\le$ 0.5 giây**.

### 2. Thuật Toán Cắt Câu Thông Minh Theo Nhịp Nghỉ (VAD - Voice Activity Detection)
* **Khắc phục lỗi bịa thoại / lặp từ:** Loại bỏ hoàn toàn phương pháp cắt âm thanh theo thời gian cố định (vốn gây đứt đôi từ ngữ và lặp lại các từ vô nghĩa).
* Bộ lọc năng lượng âm thanh liên tục theo dõi nhịp nói của nhân vật và **chỉ cắt câu khi có khoảng lặng tự nhiên (200ms)** hoặc khi câu thoại đạt độ dài tiêu chuẩn (~2.5 giây). Nhờ đó, AI luôn nhận được trọn vẹn câu thoại có nghĩa, bản dịch tiếng Việt chuẩn xác và tự nhiên 100%.

### 3. Đa Dạng Giọng Đọc Thuyết Minh Thật & Nút Nghe Thử Trực Tiếp
* ⚡ **Google Voice Tiếng Việt (Khuyên dùng):** Giọng nữ tự nhiên, chuẩn phổ thông, độ trễ cực thấp **0.15s**, ăn khớp tuyệt đối theo từng khung hình.
* 🎙️ **Hoài My (Microsoft AI Neural):** Giọng nữ nhẹ nhàng, truyền cảm, phù hợp phim truyện điện ảnh, tài liệu.
* 🎙️ **Nam Minh (Microsoft AI Neural):** Giọng nam trầm ấm, chuẩn phát thanh viên tin tức.
* 🔒 **Piper Neural (Chạy Offline 100%):** Giọng đọc cục bộ chạy trên máy không cần kết nối mạng.
* Nút **"🔊 Nghe thử giọng"** tích hợp ngay cạnh dropdown giúp kiểm tra ngay chất giọng trước khi bắt đầu.

### 4. Phụ Đề Trong Suốt Chuẩn Điện Ảnh (Không Che Video)
* **Trong video:** Chữ vàng nghệ thuật `#facc15`, viền đen nổi bật `-webkit-text-stroke: 1.2px #000`, hiệu ứng đổ bóng `text-shadow: 0 2px 8px #000`, nền trong suốt 100%.
* **Cửa sổ nổi (Overlay Bar):** Mở qua nút `✨ Cửa Sổ Phụ Đề Nổi (Overlay)`, hiển thị một thanh ticker siêu mỏng (65px) nằm sát đáy màn hình (`/overlay`), hoàn toàn không bị khung trắng che khuất nội dung.

### 5. Tiện Ích Mở Rộng Dành Cho Trình Duyệt (Chrome / Brave Extension)
* Cài đặt tiện ích mở rộng tại thư mục `c:\dich\extension`.
* Tự động bắt phụ đề YouTube gốc qua DOM, gửi dịch tức thì và **tự động giảm âm lượng video gốc xuống 10%** khi giọng thuyết minh đọc, giúp âm thanh không bao giờ bị lẫn lộn 2 giọng nói.

---

## 🛠️ Cấu Trúc Dự Án

```
LiveSub_VoiceDub_Kyouma/
├── extension/                 # Tiện ích mở rộng Chrome / Brave (manifest v3)
│   ├── manifest.json
│   ├── content.js             # Bắt phụ đề DOM, điều khiển âm lượng, đồng bộ video
│   ├── style.css              # Giao diện phụ đề nổi trực tiếp đáy video
│   └── icon.png
├── models/                    # Thư mục chứa mô hình AI
│   └── piper/                 # Config & Onnx mô hình Piper offline tiếng Việt
├── public/                    # Giao diện Web Studio Frontend
│   ├── index.html             # Dashboard Studio 4 nguồn phát
│   ├── overlay.html           # Cửa sổ phụ đề nổi mỏng trong suốt
│   ├── app.js                 # Bộ xử lý Web Audio API, VAD, MediaStream, Sync
│   └── style.css              # Giao diện Studio Dark Cinema
├── server.py                  # Backend FastAPI + Faster-Whisper GPU + Edge-TTS + Piper
├── requirements.txt           # Danh sách thư viện Python cần thiết
├── setup.bat                  # File cài đặt tự động 1-click
├── start.bat                  # File khởi động ứng dụng nhanh
└── README.md
```

---

## 🚀 Hướng Dẫn Cài Đặt & Sử Dụng

### Yêu Cầu Hệ Thống:
* Hệ điều hành: Windows 10 / 11 (64-bit).
* Python 3.10 hoặc 3.11 (đã tích hợp vào PATH).
* GPU: Khuyên dùng NVIDIA GeForce (RTX 3050, 3060, 4060...) để đạt độ trễ $\le$ 0.5s (Hệ thống vẫn tự động chạy trên CPU nếu máy không có GPU).

### Bước 1: Cài Đặt Môi Trường
Chỉ cần nhấp đúp vào file:
```cmd
setup.bat
```
*(Script sẽ tự tạo môi trường ảo `.venv` và cài đặt đầy đủ các thư viện từ `requirements.txt`).*

### Bước 2: Khởi Động Ứng Dụng
Nhấp đúp vào file:
```cmd
start.bat
```
Trình duyệt sẽ tự động mở giao diện tại: **`http://localhost:3000`**

### Bước 3: Sử Dụng Các Tính Năng
1. **Lồng tiếng video từ VLC / Netflix / Zoom / Tab Trình duyệt:**
   - Chọn tab **💻 Âm Thanh Hệ Thống / Mọi Ứng Dụng**.
   - Bấm **"Bắt Đầu Thu Âm Hệ Thống / Tab"** $\rightarrow$ Chọn Màn hình hoặc Tab cần xem và **tích chọn ô "Chia sẻ âm thanh"**.
2. **Xem phim từ file trên máy tính:**
   - Chọn tab **📁 File Video / Phim Trên Máy Tính**.
   - Kéo thả file `.mp4` hoặc `.mkv` vào khung $\rightarrow$ Bấm **"Bắt Đầu Thuyết Minh"**.
3. **Mở cửa sổ phụ đề nổi:**
   - Bấm nút **"✨ Cửa Sổ Phụ Đề Nổi (Overlay)"** ở góc trên bên phải để hiển thị thanh phụ đề trong suốt đè lên bất kỳ cửa sổ nào.

---

## 📡 API Endpoints

| Phương thức | Đường dẫn | Chức năng |
| :--- | :--- | :--- |
| `POST` | `/api/transcribe` | Nhận file âm thanh `.webm`, xử lý qua Whisper GPU, dịch sang tiếng Việt và trả về audio thuyết minh Base64. |
| `POST` | `/api/dub-subtitle` | Nhận chuỗi phụ đề có sẵn, dịch và trả về audio giọng đọc trong $\le 0.15$s. |
| `POST` | `/api/tts` | Phát âm văn bản tiếng Việt theo giọng được chọn (`google-vi`, `vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`, `piper-vi`). |
| `POST` | `/api/translate` | Dịch văn bản nhanh sang tiếng Việt. |
| `GET` | `/overlay` | Trả về giao diện cửa sổ phụ đề nổi trong suốt. |

---

## 📜 Giấy Phép & Bản Quyền

Dự án phát triển bởi **khang2309** theo giấy phép mã nguồn mở MIT.
Mọi đóng góp (Pull Request), phản hồi lỗi (Issue) đều được hoan nghênh!
