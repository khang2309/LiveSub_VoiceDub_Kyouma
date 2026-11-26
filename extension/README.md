# 🎬 LiveSub Studio - Chrome Extension (Manifest V3)

> **AI Thuyết Minh & Lồng Tiếng Video Realtime Universal cho mọi website**  
> Tương thích hoàn hảo với: **YouTube**, **AnimeVietsub**, **AnimeHay**, **Netflix**, **Bilibili**, **Facebook Video**, **TikTok** và mọi trình phát video HTML5 trên web.

---

## ✨ Tính Năng Nổi Bật

1. **Lồng tiếng thời gian thực (Zero-Latency Realtime Dubbing)**:
   - Tự động bắt phụ đề mềm (CC, TextTrack, Cue) hoặc phụ đề cứng (OCR Frame) trên video.
   - Đồng bộ hoàn hảo theo từng giây: Dừng video là dừng tiếng, tua video là hủy âm cũ lập tức, tiếp tục phát là lồng tiếng tiếp tục.
2. **Tự động giảm âm lượng video gốc (Smart Audio Ducking)**:
   - Tự động hạ âm thanh phim xuống 10% (hoặc mức tùy chọn 0% - 35%) khi giọng thuyết minh cất lên, chống lẫn giọng và rè tiếng.
3. **Thích ứng tốc độ video (Adaptive Video Pacing)**:
   - Tự động điều chỉnh tốc độ nói khi bạn tua nhanh video (1.25x, 1.5x, 2.0x).
4. **Hỗ trợ 2 chế độ giọng đọc**:
   - **Local Engine (Khuyên dùng)**: Kết nối trực tiếp với backend Rust `http://localhost:3000` sử dụng mô hình neural **VieNeu-TTS** (Trúc Ly, Nam Minh, Bảo Ngọc) 100% offline với chất giọng cực kỳ tự nhiên và cảm xúc.
   - **Standalone Online**: Tự động fallback sang Microsoft Edge-TTS hoặc Google Voice khi không chạy ứng dụng máy tính.
5. **Phụ đề nổi trên video (In-Video Subtitle Overlay)**:
   - Hiển thị phụ đề tiếng Việt với viền đen tương phản cao, hỗ trợ 4 chế độ: *Chỉ Tiếng Việt*, *Song ngữ*, *Chỉ Tiếng Gốc*, hoặc *Tắt phụ đề*.

---

## 🚀 Hướng Dẫn Cài Đặt Vào Google Chrome / Microsoft Edge / Brave / Cốc Cốc

1. Mở trình duyệt Chrome và truy cập: `chrome://extensions/`  
   *(Đối với Edge: `edge://extensions/`)*
2. Bật công tắc **Chế độ dành cho nhà phát triển** (**Developer mode**) ở góc trên bên phải.
3. Bấm vào nút **Tải tiện ích đã giải nén** (**Load unpacked**) ở góc trên bên trái.
4. Điều hướng và chọn thư mục:  
   `C:\dich\extension`
5. Tiện ích **LiveSub Studio** sẽ xuất hiện ngay trên thanh công cụ của trình duyệt!

---

## ⌨️ Phím Tắt Tiện Dụng

- **`Alt + D`**: Bật / Tắt nhanh chế độ lồng tiếng bất kỳ lúc nào khi đang xem phim.
