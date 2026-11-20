# Quy trình phát triển và bàn giao

## Nhận việc

- Đọc [AGENTS.md](../AGENTS.md) và đối chiếu yêu cầu với [SRS.md](../SRS.md). Dùng mã yêu cầu và mã nghiệm thu gần nhất trong SRS để ghi phạm vi.
- Chạy `git status --short --branch` và xem code ở đường dẫn liên quan trong [kiến trúc](ARCHITECTURE.md). Xác định phần đang chạy trong repo trước khi dựa vào mục tiêu dài hạn.
- Với công việc Windows .NET, bắt đầu từ luồng Today và focus trên Chrome. Giữ lệnh chạy hiện tại của Electron và Capacitor trong giai đoạn chuyển đổi, trừ khi công việc yêu cầu thay đổi điểm vào.

## Chạy và kiểm tra

Xem [README.md](../README.md) để cài môi trường. Chọn kiểm tra theo đường đi mà thay đổi thực sự tác động.

| Phạm vi | Kiểm tra |
|---|---|
| Logic planner hoặc API cục bộ | `npm test` |
| Giao diện và bản build dùng chung | `npm run build`. Dùng `npm run dev` để xem luồng giao diện. |
| Desktop | Trong terminal của VS Code, xóa biến `ELECTRON_RUN_AS_NODE` trước khi chạy `npm run desktop` hoặc kiểm thử Electron, nếu không Electron chạy như Node và không mở cửa sổ. |
| Chrome và focus | `npm run build` rồi `npm run test:browser`. Cài Playwright Chromium theo README và đóng app desktop trước khi chạy vì test dùng cùng cổng ghép nối. |
| Windows sau khi đăng nhập | Trên Windows 11, bật hai tùy chọn khởi chạy và focus tự động. Kiểm tra lần đăng nhập đầu ngày, lần đăng nhập lại cùng ngày, và mốc hết hạn trong Chrome. Tham chiếu A-01 và A-02. |
| Android | `npm run android:sync`, rồi chạy `./gradlew assembleDebug` trong `android/`. Dùng `gradlew.bat assembleDebug` trên Windows. Ghi model, phiên bản hệ điều hành và kết quả nếu có kiểm tra trên POCO. Tham chiếu A-03 cho quyền, Battery Saver và khởi động lại. |
| Tài liệu | `git diff --check` và kiểm tra các liên kết nội bộ được thêm hoặc thay đổi. |

Ghi rõ kết quả kiểm tra tự động, build, và nghiệm thu thiết bị thật. Ví dụ, “APK build thành công” xác nhận việc đóng gói. Trạng thái A-03 cần kết quả trên thiết bị pilot.

## Bàn giao cho agent tiếp theo

Đặt thông tin gắn với thay đổi vào mô tả PR hoặc ghi chú bàn giao hiện có. Dùng mẫu ngắn này khi cần tiếp tục ở lượt khác.

```md
- Mục tiêu và mã SRS
- Thay đổi đã hoàn tất và file chính
- Lệnh đã chạy, môi trường và kết quả
- Phần còn mở và bước tiếp theo có thể thực hiện
- Commit hoặc nhánh chứa thay đổi
```

Khi yêu cầu sản phẩm thay đổi, cập nhật SRS. Khi cấu trúc code hoặc trạng thái triển khai thay đổi, cập nhật tài liệu kiến trúc. Khi lệnh cài và chạy thay đổi, cập nhật README. Giữ các chi tiết theo từng lượt kiểm tra trong phần bàn giao.
