# Nghiệm thu trên thiết bị thật

Bảng kiểm cho A-01, A-02 và A-03 trong [SRS.md](../SRS.md). Điền kết quả sau mỗi lượt kiểm tra. Kiểm thử tự động không thay cho các bước này.

Cách ghi: `Đạt`, `Không đạt` hoặc `Chưa thử`. Ghi lại điều quan sát được khi không đạt.

## Thông tin lượt kiểm tra

| Mục | Giá trị |
|---|---|
| Ngày | |
| Commit hoặc bản cài | |
| Windows (phiên bản, build) | |
| Chrome (phiên bản, profile) | |
| Điện thoại (model, Android, HyperOS) | |

## Chuẩn bị

1. Chạy `npm run desktop:package` và cài `release/Fix Myself Setup <version>.exe`. Kiểm tra khởi động sau đăng nhập trên bản đã cài, không dùng `npm run desktop`.
2. Trong app: thêm ít nhất một task vào Today. Mở **Settings**, chọn thời lượng ngắn để kiểm tra mốc hết hạn (ví dụ 10 phút) và chọn tên miền, ví dụ `youtube.com`.
3. Bật **Open Today when I sign in to Windows** và **Start focus on the first sign-in each day**.
4. Trong profile Chrome thường dùng: `chrome://extensions` → **Developer mode** → **Load unpacked** → chọn `extension/`. Dán mã từ **Settings → Pair Chrome**.

## A-01 · Đăng nhập Windows (DAY-01, FOC-01, FOC-02)

| # | Bước | Kết quả mong đợi | Kết quả | Ghi chú |
|---|---|---|---|---|
| 1.1 | Đăng xuất rồi đăng nhập lần đầu trong ngày | Today mở, phiên focus bắt đầu, có thời điểm kết thúc | | |
| 1.2 | Ngắt mạng, lặp lại 1.1 vào ngày mới | Today hiện kế hoạch đã lưu, focus vẫn bắt đầu | | |
| 1.3 | Khởi động lại máy trong cùng ngày khi phiên đang chạy | Thời điểm kết thúc giữ nguyên, không tạo phiên thứ hai | | |
| 1.4 | Đăng nhập lại cùng ngày sau khi phiên hết hạn | Không tự tạo phiên mới | | |
| 1.5 | Sleep rồi wake trong phiên | Thời điểm kết thúc giữ nguyên | | |
| 1.6 | Tắt **Open Today when I sign in to Windows**, đăng xuất và đăng nhập | App không tự mở | | |
| 1.7 | Đóng cửa sổ trong phiên | App ở vùng thông báo, Chrome vẫn chặn | | |

## A-02 · Chặn trên Chrome (FOC-03, FOC-04, FOC-05)

| # | Bước | Kết quả mong đợi | Kết quả | Ghi chú |
|---|---|---|---|---|
| 2.1 | Trong phiên, mở trang đã chọn ở tab mới | Màn focus hiện lý do, giờ kết thúc và việc tiếp theo | | |
| 2.2 | Mở bằng link trực tiếp từ trang khác hoặc ứng dụng khác | Bị chặn như 2.1 | | |
| 2.3 | Mở trang trước khi phiên bắt đầu, rồi bắt đầu phiên | Tab có sẵn bị chuyển sang màn focus | | |
| 2.4 | Mở tên miền con, ví dụ `m.youtube.com` | Bị chặn | | |
| 2.5 | Mở trang không có trong danh sách | Vào được bình thường | | |
| 2.6 | Màn focus có cách mở Today, không có nút kết thúc sớm | Đúng như mô tả | | |
| 2.7 | Đóng hẳn app desktop (**Quit Fix Myself**) trong phiên | Chrome vẫn chặn đến giờ kết thúc | | |
| 2.8 | Ngắt mạng trong phiên | Chrome vẫn chặn | | |
| 2.9 | Chờ phiên hết hạn, không khởi động lại Chrome | Reload hoặc **Open site** mở được trang | | |
| 2.10 | Đổi thời lượng hoặc tên miền trong phiên | Áp dụng cho phiên sau, phiên hiện tại giữ nguyên | | |
| 2.11 | Xem **Settings → Pair Chrome** và **Review** | Profile hiện là đang phủ, có số lần bị chặn theo trang | | |

## A-03 · Thử nghiệm trên POCO (FOC-06 đến FOC-08)

Chặn ứng dụng Android chưa được làm. Lượt đầu chỉ ghi thông tin máy và kiểm tra nhắc nhở. Các bước chặn ứng dụng chờ bản thử nghiệm native.

| # | Bước | Kết quả mong đợi | Kết quả | Ghi chú |
|---|---|---|---|---|
| 3.1 | Ghi model, phiên bản Android và HyperOS trong **Settings → About phone** | Đã ghi vào bảng thông tin | | |
| 3.2 | Cài APK debug, cho phép thông báo và **Allow exact timing** | Settings hiện quyền đã cấp | | |
| 3.3 | Đặt nhắc nhở 5 phút, đóng app | Nhắc nhở đến đúng giờ | | |
| 3.4 | Lặp lại 3.3 khi bật Battery Saver | Nhắc nhở vẫn đến | | |
| 3.5 | Lặp lại 3.3 sau khi khởi động lại máy | Nhắc nhở vẫn đến | | |
| 3.6 | Mở ứng dụng đã chọn từ launcher, Recents, thông báo và deep link | Hiện màn can thiệp | Chưa làm | Chờ FOC-07 |
| 3.7 | Thu hồi quyền usage hoặc quyền chặn | App hiện độ phủ giảm hoặc **Alerts only** | Chưa làm | Chờ FOC-08 |

## Sau khi kiểm tra

Cập nhật bảng trạng thái trong [kiến trúc](ARCHITECTURE.md) khi một mã nghiệm thu đạt. Ghi lỗi tìm được thành việc cần sửa trước khi làm tính năng mới.
