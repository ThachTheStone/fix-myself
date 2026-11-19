# Hướng dẫn cho agent

Áp dụng cho toàn bộ repo Fix Myself. Đây là ứng dụng cá nhân giúp người dùng nhớ mục tiêu và kế hoạch trong ngày, rồi quay lại việc tiếp theo khi bị phân tâm.

## Bắt đầu

1. Đọc [SRS.md](SRS.md) để nắm phạm vi, mã yêu cầu và tiêu chí nghiệm thu.
2. Đọc [kiến trúc](docs/ARCHITECTURE.md) để xác định phần đang chạy, điểm vào của code và hướng chuyển Windows sang .NET.
3. Đọc [quy trình làm việc](docs/WORKFLOW.md) trước khi sửa, kiểm tra hoặc bàn giao.
4. Xem trạng thái Git và commit gần nhất. Giữ các thay đổi có sẵn của người dùng và chọn phạm vi phù hợp với yêu cầu đang làm.

[README.md](README.md) có lệnh chạy và hướng dẫn cài Chrome, Windows, Android.

## Những hành vi cần giữ khi sửa code

- Today mở sau khi người dùng đăng nhập Windows. Nếu đã bật focus tự động, lần đăng nhập đầu tiên trong ngày có thể bắt đầu một phiên. Khởi động lại cùng ngày giữ thời điểm kết thúc đã lưu.
- Chrome chặn các trang đã chọn trong phiên focus và hiển thị việc tiếp theo. Chrome dùng phiên đã lưu khi mất kết nối với ứng dụng và gỡ chặn khi phiên hết hạn. Thay đổi thời lượng hoặc tên miền áp dụng cho phiên sau.
- Lịch làm việc, hạn chót và trạng thái hoàn thành là các dữ liệu riêng. Khi nhập GitHub ở giai đoạn sau, trạng thái issue và trạng thái task cá nhân cũng độc lập.
- AI chỉ thực thi thao tác đã được người dùng duyệt qua các API mà ứng dụng cho phép. Quy tắc chặn được người dùng thiết lập và chạy độc lập với AI.

## Khi kết thúc

Nêu mã yêu cầu đã xử lý, file thay đổi, lệnh hoặc thiết bị đã dùng để kiểm tra, kết quả và phần còn chờ xác minh. Cập nhật tài liệu liên quan nếu thay đổi ảnh hưởng đến hành vi, thao tác thiết lập hoặc trạng thái triển khai.
