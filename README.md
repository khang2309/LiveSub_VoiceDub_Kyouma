# 🎬 LiveSub & VoiceDub AI Studio

**Hệ Thống Phụ Đề & Thuyết Minh / Lồng Tiếng AI Thời Gian Thực Đa Nguồn**  
*(RTX 3050 CUDA | Faster-Whisper + VinAI Translate local + VieNeu streaming)*

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
* Thời gian nhận dạng phụ thuộc độ dài đoạn thoại; trạng thái runtime cho biết chính xác đang chạy CUDA hay CPU.
* Backend công khai số đo thực tế tại `/api/pipeline-status`; không dùng một con số độ trễ cố định cho mọi câu/mọi máy.

### Pipeline mặc định (miễn phí, ưu tiên local)

* **ASR cuối:** Faster-Whisper Base CUDA float16. Model Sherpa-ONNX streaming đa ngôn ngữ được đánh giá như phương án chữ tạm thời, chưa thay ASR cuối khi chưa có benchmark WER tiếng Việt phù hợp.
* **Dịch hybrid nhanh nhất:** mặc định thử API/network với timeout ngắn rồi tự lùi về VinAI EN→VI hoặc NLLB-200 INT8 local. Đặt `TRANSLATION_MODE=private` để đảo thứ tự và ưu tiên dữ liệu chỉ chạy trong máy. Có adapter chính thức cho Azure, Google Cloud Translation và DeepL qua `.env`.
* **Dịch Hàn/Nhật/Trung và đa ngôn ngữ:** NLLB-200 Distilled 600M INT8 là fallback local. NLLB có giấy phép CC-BY-NC-4.0, phù hợp sử dụng local phi thương mại; sản phẩm thương mại nên cấu hình API có điều khoản phù hợp.
* **Giọng Việt:** VieNeu-TTS v3 Turbo chạy PyTorch CUDA. `/api/tts-stream` gửi PCM ngay theo từng khối; `/api/tts-batch` sinh trước nhiều câu phụ đề bằng một batch GPU.
* Khi mở `http://localhost:3000`, server tự làm nóng cả model dịch và CUDA streaming graph; giao diện vẫn mở ngay, không chờ warm-up hoàn tất.
* Pipeline thu âm không phụ thuộc YouTube: cùng một đường xử lý được dùng cho tab Netflix/Bilibili/WeTV, âm thanh hệ thống từ VLC/PotPlayer, file local và microphone.
* **Phụ đề đóng cứng:** chế độ OCR dùng RapidOCR PP-OCRv6 ONNX trên CPU, quét vùng phụ đề của tab được chia sẻ, lọc chữ giao diện, chống lặp rồi dịch/lồng tiếng mà không cần Whisper.
* Silero VAD v5 chạy local trong trình duyệt thay cho bộ cắt chỉ dựa trên âm lượng. Audio đã sinh xong có thể phát tới 1.50×; riêng VieNeu PCM live nhận giới hạn động (tối đa 1.20×) từ RTF CUDA đo ở đầu phiên để trình phát không tiêu thụ nhanh hơn GPU và gây giật.
* **Giọng tự động:** khi mở localhost, backend làm nóng và đo VieNeu CUDA, Google TTS và Microsoft Edge TTS một lần rồi cố định đường nhanh nhất cho phiên. Không dò lại nhà cung cấp ở từng câu.
* Thanh **Cấu hình đang chạy** cập nhật lựa chọn tức thì; nút **Xác nhận cấu hình** gọi backend và chỉ báo đã áp dụng khi nhận được trạng thái Whisper/VieNeu/CUDA thật.

### Có nên chạy backend trên Kaggle?

Kaggle phù hợp để benchmark hoặc xử lý file theo lô, không phù hợp làm backend realtime thường trực: notebook có thời hạn phiên, dừng khi idle, URL public cần tunnel và mỗi câu phải chịu thêm RTT Internet. Với ứng dụng xem phim trên cùng máy, backend local cho đồng bộ ổn định hơn. Nếu triển khai từ xa lâu dài, dùng một GPU VM/API service cố định thay vì Kaggle Notebook.

### 2. Thuật Toán Cắt Câu Thông Minh Theo Nhịp Nghỉ (VAD - Voice Activity Detection)
* **Khắc phục lỗi bịa thoại / lặp từ:** Loại bỏ hoàn toàn phương pháp cắt âm thanh theo thời gian cố định (vốn gây đứt đôi từ ngữ và lặp lại các từ vô nghĩa).
* Silero VAD nhận biết vùng có tiếng nói; bộ đệm chỉ đóng câu khi gặp khoảng lặng, đồng thời có ngưỡng an toàn cho câu quá dài. Cách này giảm cắt giữa từ và giữ nguyên thứ tự câu, nhưng độ chính xác vẫn phụ thuộc tiếng nền và chất lượng nguồn thu.

### 3. Đa Dạng Giọng Đọc Thuyết Minh Thật & Nút Nghe Thử Trực Tiếp
* ⚡ **VieNeu-TTS v3 Turbo (Khuyên dùng):** chạy local trên CUDA, phát theo luồng và hỗ trợ nhiều giọng Bắc/Trung/Nam.
* **Google Voice Tiếng Việt:** đường mạng dự phòng nhanh khi local TTS không khả dụng.
* 🎙️ **Hoài My (Microsoft AI Neural):** Giọng nữ nhẹ nhàng, truyền cảm, phù hợp phim truyện điện ảnh, tài liệu.
* 🎙️ **Nam Minh (Microsoft AI Neural):** Giọng nam trầm ấm, chuẩn phát thanh viên tin tức.
* 🔒 **Piper Neural (Chạy Offline 100%):** Giọng đọc cục bộ chạy trên máy không cần kết nối mạng.
* Chọn giọng không tự phát âm thanh. Chỉ nút **"Nghe thử giọng"** mới phát câu mẫu.

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
| `POST` | `/api/dub-subtitle` | Nhận chuỗi phụ đề có sẵn, dịch và trả về trọn file audio tương thích. |
| `POST` | `/api/tts` | Sinh trọn file âm thanh (đường tương thích cũ). |
| `POST` | `/api/tts-stream` | Phát VieNeu PCM 48 kHz theo luồng, bắt đầu trước khi sinh xong cả câu. |
| `POST` | `/api/tts-batch` | Sinh trước tối đa 8 câu trong một batch GPU. |
| `POST` | `/api/translate` | Dịch văn bản nhanh sang tiếng Việt. |
| `POST` | `/api/ocr-subtitle` | Đọc phụ đề đóng cứng từ khung hình đã crop, dịch và trả số đo OCR. |
| `GET` | `/api/pipeline-status` | Trạng thái model local, CUDA và số đo TTS first-chunk gần nhất. |
| `GET` | `/overlay` | Trả về giao diện cửa sổ phụ đề nổi trong suốt. |

---

## 📜 Giấy Phép & Bản Quyền

Dự án phát triển bởi **khang2309**. Lưu ý model VinAI Translate được phát hành theo AGPL-3.0; VieNeu và các model tải kèm có giấy phép riêng tại repository/model card tương ứng.
Mọi đóng góp (Pull Request), phản hồi lỗi (Issue) đều được hoan nghênh!
