# Nhật ký chạy worker

Ghi mỗi vòng giao việc để so sánh chi phí và chất lượng giữa các loại worker. Xem quy trình ở
[MULTI_AGENT.md](MULTI_AGENT.md). Chi phí ghi theo dữ liệu có được (bảng điều khiển nhà cung cấp, `/cost` của Claude Code);
không có số đo thì ghi "chưa đo".

| Ngày | Việc (SRS) | Vòng | Worker | Kết quả | Lỗi phát hiện khi review | Chi phí | Ghi chú |
|---|---|---|---|---|---|---|---|
| 2026-11-23 | Block rules giai đoạn 1 (BLK-01–BLK-09) | 1 | Cline, DeepSeek `deepseek-v4-flash` | Dừng giữa chừng, không commit. Unit 31/31, build đạt, browser test mới treo. | 5 file báo cáo tạm, dòng trống thừa, thiếu cập nhật tài liệu. Thử dừng mọi tiến trình `node` (lệnh không chạy được). | chưa đo | Brief chi tiết nhưng worker tự thiết kế lại cách gộp quy tắc khi đồng bộ. |
| 2026-11-23 | Block rules giai đoạn 1 | 2 | Cline, DeepSeek `deepseek-v4-flash` | 5 commit, unit 31/31, build đạt, 4/4 browser test. | Lỗ hổng BLK-06: sửa trộn (mạnh hơn một mặt, yếu hơn mặt khác) bỏ qua thời gian chờ. Đổi độ trễ không gắn dấu đồng bộ. Hai lỗi nhỏ. | chưa đo | Tự viết lại lịch sử nhánh sau một rebase hỏng; điều phối kiểm tra lại toàn bộ. |
| 2026-11-23 | Block rules giai đoạn 1, sửa BLK-06 | 3 | Cline, DeepSeek `deepseek-v4-flash` | 1 commit (`1ecbb19`), unit 35/35, build đạt, 4/4 browser test. | Không có lỗi chặn. Bật lại rule đã tắt kèm bỏ một trang bị xếp là "yếu hơn" (thận trọng thừa, chấp nhận được). | chưa đo | Brief hẹp, có ví dụ cụ thể: làm đúng ngay vòng đầu. |
| 2026-11-23 | Chạy thử `scripts/dispatch-cline.sh` | — | Cline, DeepSeek (ngoài ý muốn) | Script đúng sau khi sửa. | Lần thử đầu gọi nhầm Cline thật hai lần với brief rỗng; một lần treo 10 phút vì Cline chờ bàn phím. Đã thêm `--timeout` và chặn stdin. | nhỏ, chưa đo | Worker xử lý brief rỗng đúng: không sửa gì. |

Bài học từ block rules: brief hẹp kèm ví dụ cụ thể và lệnh test làm worker đúng ngay vòng đầu; brief rộng (cả giai đoạn) cần ba vòng và điều phối phải tự tìm lỗ hổng.
