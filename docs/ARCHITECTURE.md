# Kiến trúc Fix Myself

[SRS.md](../SRS.md) mô tả yêu cầu sản phẩm. Tài liệu này giúp xác định đường đi qua code hiện tại và trạng thái của các quyết định kỹ thuật.

## Bản nền đang chạy

| Phần | Điểm vào và trách nhiệm |
|---|---|
| Giao diện | [index.html](../index.html), [app/main.js](../app/main.js) và [app/styles.css](../app/styles.css). Vite build chung giao diện Today, Tasks và Settings cho desktop, Android và bản xem trước trên trình duyệt. |
| Logic và dữ liệu cục bộ | [app/model.js](../app/model.js) xử lý nhiệm vụ, ưu tiên, kế hoạch trong ngày và phiên focus. Trạng thái lưu theo thiết bị trong `localStorage` với khóa `fix-myself:v1`. Bản nền dùng ngày theo giờ cục bộ của thiết bị. |
| Desktop | [desktop/main.cjs](../desktop/main.cjs) quản lý cửa sổ Electron và tùy chọn khởi chạy sau khi đăng nhập Windows. [desktop/preload.cjs](../desktop/preload.cjs) cung cấp API IPC giới hạn cho giao diện. |
| Kết nối với Chrome | [desktop/focus-bridge.cjs](../desktop/focus-bridge.cjs) cung cấp `GET /v1/focus` trên `127.0.0.1:42631`. Extension dùng mã ghép nối để đọc phiên hiện tại. |
| Chrome | [extension/worker.js](../extension/worker.js) đọc và lưu phiên, áp dụng rule Manifest V3 và dọn rule khi hết hạn. [extension/blocked.js](../extension/blocked.js) hiển thị việc tiếp theo và thời gian còn lại. |
| Android | [android/](../android/) chứa dự án Capacitor. [capacitor.config.json](../capacitor.config.json) trỏ tới thư mục build `dist/`. APK hiện có trình lập kế hoạch và bộ hẹn giờ cục bộ. |
| Kiểm thử | [tests/model.test.js](../tests/model.test.js) kiểm tra quy tắc lập kế hoạch và focus. [tests/bridge.test.js](../tests/bridge.test.js) kiểm tra API cục bộ. [tests/browser.e2e.js](../tests/browser.e2e.js) chạy planner và extension trong Chromium. |

### Luồng Windows đến Chrome

1. Windows gọi app với `--login-launch` khi tùy chọn khởi chạy đã bật. Model dùng `lastLoginDay` để quyết định có tạo phiên tự động trong ngày hay không.
2. UI tải kế hoạch cục bộ, tìm việc tiếp theo và gửi dữ liệu phiên qua IPC cho Electron.
3. Chrome kiểm tra định kỳ hoặc khi người dùng bấm **Check connection**. Payload hiện tại gồm `endAt` tính theo mili giây Unix, `domains` và `nextAction`, hoặc `focus: null` khi không có phiên.
4. Extension lưu phiên trên Chrome, chuyển các tab bị chặn tới màn hình focus và gỡ rule khi hết hạn. Nó tiếp tục dùng phiên đã nhận khi desktop mất kết nối.

Mã ghép nối và thông tin nhạy cảm ở trong môi trường chạy cục bộ. Extension chỉ cần hạn kết thúc, danh sách tên miền và tiêu đề việc tiếp theo để áp dụng luồng này.

## Hướng kỹ thuật cho các giai đoạn tiếp theo

| Phần | Hướng đã đề xuất |
|---|---|
| Windows | C# với **.NET 10 LTS**, WPF, CommunityToolkit.Mvvm và SQLite. Chuyển luồng Today → focus → Chrome trước. Khi thiết kế lưu trữ mới, đánh giá cách mang dữ liệu planner từ bản Electron sang. |
| Chrome | Giữ Manifest V3 và các bài kiểm thử hành vi. Xem xét chuyển từ loopback sang Chrome Native Messaging sau khi WPF chạy được luồng chính. |
| Android | Giữ Capacitor dùng được trong lúc thử nghiệm quyền và hành vi trên máy POCO. Kotlin, Jetpack Compose và Room là hướng native được đề xuất. |
| Đồng bộ và tích hợp | ASP.NET Core và PostgreSQL là phương án khi bắt đầu đồng bộ nhiều thiết bị. GitHub Issues, Google Calendar và AI vẫn thuộc các giai đoạn triển khai trong SRS. |
| iPhone | SwiftUI và Screen Time API là hướng đánh giá sau. |

Mốc Windows đầu tiên cần chứng minh người dùng đăng nhập, thấy Today, mở trang đã chọn và thấy việc tiếp theo trong Chrome. Kiểm tra cả trường hợp Chrome đã mở sẵn, desktop mất kết nối, và phiên hết hạn. Đối chiếu A-01 và A-02 trong [SRS.md](../SRS.md).

Ở commit nền `f706f9e`, bài kiểm tra Node và Chromium đã chạy đạt, cùng kiểm tra nhanh Electron, build Windows portable ZIP và Android debug APK. Nghiệm thu sau khi đăng nhập trên Windows 11 và kiểm tra Android app blocking trên máy POCO vẫn là các mốc xác minh thiết bị thật theo A-01 đến A-03.
