# 🛡️ Chính Sách Quyền Riêng Tư (Privacy Policy) - LiveSub Studio

**Cập nhật lần cuối**: 26/11/2026  
**Dự án**: LiveSub Studio (Chrome Extension & Desktop Application)  
**Nhà phát triển**: LiveSub Studio Team  

---

### 1. Cam Kết Quyền Riêng Tư Cốt Lõi
Tiện ích mở rộng **LiveSub Studio** được xây dựng với nguyên tắc **bảo mật tối đa và tôn trọng quyền riêng tư của người dùng**:
- **KHÔNG thu thập, lưu trữ hoặc bán thông tin cá nhân**: Chúng tôi không thu thập tên, email, lịch sử duyệt web, thông tin nhận dạng cá nhân hoặc dữ liệu hành vi của bạn.
- **KHÔNG chèn quảng cáo hoặc mã theo dõi (Analytics / Tracking)**: Không có bất kỳ đoạn mã theo dõi của bên thứ ba nào trong tiện ích.
- **Mọi dữ liệu xử lý cục bộ trên thiết bị của bạn**: Các cài đặt cấu hình (giọng đọc, cỡ chữ, chế độ âm lượng) được lưu hoàn toàn cục bộ trên trình duyệt của bạn qua `chrome.storage.local`.

---

### 2. Mục Đích Sử Dụng Các Quyền Hạn (Permissions Justification)
Để hoạt động được chức năng thuyết minh và lồng tiếng video, tiện ích yêu cầu một số quyền kỹ thuật tiêu chuẩn của Chrome:
- **`storage`**: Dùng để ghi nhớ các tùy chọn cá nhân của bạn (như giọng đọc yêu thích, cỡ chữ phụ đề, tỷ lệ giảm tiếng video gốc) để bạn không phải thiết lập lại mỗi lần mở trình duyệt.
- **`activeTab` & `scripting`**: Cho phép tiện ích phát hiện video và hiển thị thanh phụ đề nổi trong tab video đang xem khi bạn kích hoạt.
- **`host_permissions` (`<all_urls>`, `https://*/*`)**: Cho phép tiện ích đọc phụ đề (nếu có) trên các trang web video mà bạn chủ động truy cập (YouTube, AnimeVietsub, Netflix, Bilibili, các web xem phim) để chuyển hóa thành giọng đọc AI.
- **`http://localhost:3000/*`**: Kết nối với máy chủ AI cục bộ (LiveSub Engine chạy bằng Rust trên máy bạn) để tạo giọng đọc neural VieNeu-TTS tốc độ cao mà không cần gửi dữ liệu ra internet.

---

### 3. Xử Lý Âm Thanh & Phụ Đề
- Phụ đề video chỉ được trích xuất tạm thời trong bộ nhớ RAM để gửi yêu cầu phát âm và hiển thị lên màn hình.
- Chúng tôi không ghi âm, không lưu giữ tệp âm thanh hoặc kịch bản video của bạn lên bất kỳ máy chủ từ xa nào.

---

### 4. Liên Hệ & Hỗ Trợ
Nếu bạn có bất kỳ câu hỏi hoặc thắc mắc nào liên quan đến Chính Sách Quyền Riêng Tư, vui lòng liên hệ qua:
- **GitHub Repository**: [https://github.com/khang2309/LiveSub_VoiceDub_Kyouma](https://github.com/khang2309/LiveSub_VoiceDub_Kyouma)
- **Email Hỗ Trợ**: kyoumaepc2394@gmail.com
