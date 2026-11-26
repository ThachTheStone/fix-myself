# Android: vai trò, trạng thái và kế hoạch

Tài liệu này ghi lại phần Android của Fix Myself để cập nhật dần. Yêu cầu sản phẩm nằm trong [SRS.md](../SRS.md), cấu trúc code trong [kiến trúc](ARCHITECTURE.md), lệnh build trong [README](../README.md#android-pilot).

## Vai trò của điện thoại

Quyết định ngày 2026-11-25: Windows là nơi lập kế hoạch và làm việc. Điện thoại dùng để **nắm tình hình** và **kiềm chế lướt điện thoại**.

| Điện thoại làm | Để lại cho Windows |
|---|---|
| Dashboard năng suất: thời gian focus theo task, thời gian wandering, review tuần (FOC-11, REV-01, REV-03) | Lập kế hoạch chi tiết: work block, tiêu chí hoàn thành, sửa lịch (PLAN-02) |
| Xem lịch work block, không sửa (PLAN-01) | Không gian làm việc của task (WS-01 đến WS-05) |
| Nhận nhắc nhở và thông báo (REM-01, REM-02) | Preset app, quy tắc chặn, đồng hồ nổi (APP, BLK, FOC-12) |
| Ghi nhanh việc vào inbox (TASK-01) | Work block nghiêm ngặt (WB-01 đến WB-04) |
| Chặn hoặc nhắc khi lướt app gây xao nhãng (FOC-07, FOC-08, BLK-11) | |
| Ghi workout kèm ảnh (REV-04) | |

## Trạng thái hiện tại

| Phần | Trạng thái |
|---|---|
| Nền tảng | Capacitor bọc giao diện web chung. Dự án nằm trong [android/](../android/). |
| Planner, timer | Có, dùng chung code với desktop. Dữ liệu lưu riêng trên máy. |
| Nhắc nhở | Có. Hẹn với hệ điều hành qua `@capacitor/local-notifications`, đến được cả khi app đóng. Chưa kiểm tra trên máy POCO. |
| Đồng bộ | Chỉ qua file hoặc dán dữ liệu trong Settings. Engine đồng bộ Supabase đã có, giao diện đăng nhập chưa làm ([đồng bộ qua Supabase](ARCHITECTURE.md#đồng-bộ-qua-supabase)). Phiên đăng nhập trên Android sẽ nằm trong `localStorage` (giới hạn đã biết của SYS-03). |
| Dashboard thời gian theo task | Chưa làm. Dữ liệu (FOC-11) đã có; chờ đồng bộ tài khoản chạy thật. |
| Lịch chỉ xem | Có trong giao diện chung (PLAN-01): Android không kéo thả được. Chưa thử trên máy thật. |
| Đo thời gian dùng app (usage) | Chưa làm (REV-03 phần Android). |
| Chặn app | Chưa làm. Cần plugin native và nghiệm thu A-03. |
| Máy thử | Xiaomi HyperOS `1.0.17.0.UNLMIXM`, có thể là POCO X6 Pro 5G Android 14. Cần xác nhận trong **Cài đặt → Thông tin điện thoại**. |

## Kế hoạch

1. **Chạy được bản hiện tại trên máy thật.** Cài Android Studio với Android 36 SDK, Platform-Tools và JDK 21. Bật Gỡ lỗi USB, kiểm tra `adb devices`, rồi chạy `npm run android:open` và bấm **Run**. Kiểm tra nhắc nhở khi app đóng và quyền **Allow exact timing**.
2. **Đồng bộ Supabase.** Sau khi có, điện thoại tự nhận task, work block và thời gian focus từ Windows.
3. **Dashboard và lịch chỉ xem.** Màn hình đầu trên điện thoại là dashboard: thời gian focus hôm nay và tuần này theo task, wandering, commitment sắp tới hạn. Lịch hiển thị cùng dữ liệu với Windows nhưng không cho kéo thả.
4. **Đo usage.** Plugin Kotlin đọc `UsageStatsManager` sau khi người dùng cấp quyền **Usage access**. Chỉ đồng bộ tổng theo ngày (SYS-04). Hiển thị chỗ thiếu dữ liệu khi quyền bị thu hồi (A-09).
5. **Chặn lướt điện thoại.** Thử trên máy POCO theo A-03. Phát hiện app phía trước bằng Usage access hoặc Accessibility service, rồi hiện màn can thiệp bằng một activity của app. Không chặn trình gọi điện, chức năng khẩn cấp và Cài đặt hệ thống (FOC-07). Nếu không đạt thì chuyển sang chế độ **Alerts only** (FOC-08).

## Quyền cần thiết

| Quyền | Dùng cho | Ghi chú |
|---|---|---|
| Thông báo (`POST_NOTIFICATIONS`) | Nhắc nhở | Android 13 trở lên phải hỏi người dùng. |
| Báo thức chính xác | Nhắc nhở đúng giờ | Nếu không có, nhắc nhở có thể trễ. App hiện trạng thái này. |
| Usage access | Đo thời gian dùng app, phát hiện app phía trước | Người dùng bật tay trong Cài đặt. |
| Accessibility service | Phát hiện app mở nhanh hơn để chặn | Android 13 trở lên đánh dấu "Restricted setting" với app cài ngoài Play, phải cho phép trong Thông tin ứng dụng trước. Vì cài APK riêng nên không vướng chính sách Google Play. |
| Hiển thị trên ứng dụng khác | Không dùng | Đồng hồ nổi chỉ có trên Windows (FOC-12). |

HyperOS hay dừng app chạy nền. Cần thử với **Tự khởi chạy** bật, **Tiết kiệm pin** đặt "Không hạn chế", và lặp lại sau khi khởi động lại máy (A-03).

## Hướng kỹ thuật

Giữ Capacitor trong giai đoạn thử nghiệm. Phần usage và chặn app cần plugin native viết bằng Kotlin trong `android/app/src/main/java/...`, gọi từ giao diện qua Capacitor. Nếu phần native lớn dần, cân nhắc chuyển sang Kotlin, Jetpack Compose và Room như trong [kiến trúc](ARCHITECTURE.md#hướng-kỹ-thuật-cho-các-giai-đoạn-tiếp-theo).

## Nhật ký

| Ngày | Ghi chú |
|---|---|
| 2026-11-25 | Chốt vai trò điện thoại. Máy phát triển chưa có Android SDK, `adb` và JDK 21 (đang dùng JDK 17), nên chưa build và chạy thử trên điện thoại. |
