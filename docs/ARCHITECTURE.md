# Kiến trúc Fix Myself

[SRS.md](../SRS.md) mô tả yêu cầu sản phẩm. Tài liệu này giúp xác định đường đi qua code hiện tại và trạng thái của các quyết định kỹ thuật.

## Bản nền đang chạy

| Phần | Điểm vào và trách nhiệm |
|---|---|
| Giao diện | [index.html](../index.html), [app/main.js](../app/main.js) và [app/styles.css](../app/styles.css). Vite build chung các màn Today, Tasks, chi tiết task (`#task/<id>`), Review và Settings cho desktop, Android và bản xem trước trên trình duyệt. |
| Ngôn ngữ | [app/i18n.js](../app/i18n.js) chứa từ điển tiếng Anh và tiếng Việt, hàm `t()` (có dạng số ít/số nhiều) và `translateError()` dịch thông báo lỗi tiếng Anh của model theo nội dung, nên [app/model.js](../app/model.js) không phụ thuộc ngôn ngữ. Văn bản tĩnh trong [index.html](../index.html) gắn `data-i18n`, `data-i18n-placeholder`, `data-i18n-aria-label`. Lựa chọn lưu ở khóa riêng `fix-myself:language` trên từng thiết bị, không đi vào file đồng bộ. Lần đầu chạy theo ngôn ngữ hệ thống. |
| Logic và dữ liệu cục bộ | [app/model.js](../app/model.js) là các hàm thuần cho task (trạng thái, cam kết, subtask, work block, hạn gốc và hạn sửa, timeline), Today (việc tiếp theo, carryover, hạn sắp tới, inbox), focus, nhắc nhở, đồng bộ, review tuần và workout. Trạng thái lưu trong `localStorage` khóa `fix-myself:v1` với `version: 2`; bản v1 được chuyển đổi khi đọc. Ngày kế hoạch theo `settings.timeZone`. Định danh thiết bị nằm ở khóa riêng `fix-myself:device`. |
| Nhắc nhở | Model dựng lại `reminders` từ task sau mỗi thay đổi: giữ trạng thái snooze khi mốc không đổi, thay mới khi mốc đổi, bỏ khi task hoàn thành, hủy hoặc bị xóa. [app/notify.js](../app/notify.js) dùng Web Notification trên Electron và trình duyệt khi app đang chạy, và `@capacitor/local-notifications` để Android hẹn giờ với hệ điều hành. |
| Đồng bộ | Mỗi trường đồng bộ có dấu `thời điểm ISO|id thiết bị`. `mergeSync` lấy giá trị mới hơn, ghi xung đột khi cả hai thiết bị sửa cùng trường sau lần gộp trước, và giữ tombstone trong `deleted` để task đã xóa không quay lại. Phương tiện hiện tại là file hoặc dữ liệu dán trong Settings. Focus, nhắc nhở, xung đột và `peers` là dữ liệu riêng từng thiết bị. |
| Ảnh workout | [app/photos.js](../app/photos.js) lưu ảnh đã thu nhỏ trong IndexedDB của thiết bị. File đồng bộ chỉ mang cờ `hasPhoto`. |
| Desktop | [desktop/main.cjs](../desktop/main.cjs) quản lý cửa sổ Electron, biểu tượng ở vùng thông báo, tùy chọn chạy nền khi đóng cửa sổ và tùy chọn khởi chạy sau khi đăng nhập Windows. [desktop/preload.cjs](../desktop/preload.cjs) cung cấp API IPC giới hạn cho giao diện. |
| Kết nối với Chrome | [desktop/focus-bridge.cjs](../desktop/focus-bridge.cjs) cung cấp `GET /v1/focus` và `POST /v1/report` trên `127.0.0.1:42631`. Extension dùng mã ghép nối để đọc phiên hiện tại và gửi báo cáo gồm id profile, tên profile, các ngày Chrome chạy và tổng số lần bị chặn theo tên miền mỗi ngày. Bridge từ chối URL, payload quá 16 KB và dữ liệu sai dạng. Renderer lấy báo cáo qua IPC và lưu trong `state.chrome`, không đưa vào file đồng bộ. |
| Chrome | [extension/worker.js](../extension/worker.js) đọc và lưu phiên, áp dụng rule Manifest V3 và dọn rule khi hết hạn. [extension/blocked.js](../extension/blocked.js) hiển thị việc tiếp theo và thời gian còn lại. |
| Lịch chặn và quy tắc | [extension/block-schedule.js](../extension/block-schedule.js) chứa hàm thuần dùng chung cho cả app lẫn extension: `scheduleIntervals` đổi lịch thành khoảng phút trong tuần, `activeRules` chọn quy tắc đang trong khung giờ theo `settings.timeZone`, `effectiveRules` áp các thay đổi đã tới hạn. [app/model.js](../app/model.js) kiểm tra quy tắc và phân loại thay đổi: mạnh lên áp dụng ngay, yếu đi chờ `settings.changeDelay` trong `pendingRuleChanges`. [extension/worker.js](../extension/worker.js) đánh giá lại lịch mỗi 30 giây bằng `chrome.alarms` nên lịch vẫn chạy khi app desktop đóng, và [extension/blocked.js](../extension/blocked.js) xử lý đếm ngược cùng thời gian pass. |
| Android | [android/](../android/) chứa dự án Capacitor. [capacitor.config.json](../capacitor.config.json) trỏ tới thư mục build `dist/`. APK hiện có trình lập kế hoạch và bộ hẹn giờ cục bộ. |
| Kiểm thử | [tests/model.test.js](../tests/model.test.js) kiểm tra lập kế hoạch, focus, chuyển đổi v1, timeline, nhắc nhở (A-07), xung đột và xóa khi đồng bộ (A-10) và REV-01. [tests/i18n.test.js](../tests/i18n.test.js) kiểm tra hai từ điển có cùng khóa và tham số, mọi khóa dùng trong giao diện đều tồn tại. [tests/bridge.test.js](../tests/bridge.test.js) kiểm tra API cục bộ. [tests/blockrules.test.js](../tests/blockrules.test.js) kiểm tra lịch, múi giờ, thay đổi mạnh/yếu và giới hạn quy tắc (BLK-01 đến BLK-07). [tests/browser.e2e.js](../tests/browser.e2e.js) chạy planner, luồng inbox → cam kết → dời work block, quy tắc chặn theo lịch (tạo, chờ áp dụng, tải lại), đồng bộ file giữa hai profile và extension trong Chromium. |

### Luồng Windows đến Chrome

1. Windows gọi app với `--login-launch` khi tùy chọn khởi chạy đã bật. Model dùng `lastLoginDay` để quyết định có tạo phiên tự động trong ngày hay không.
2. UI tải kế hoạch cục bộ, tìm việc tiếp theo và gửi dữ liệu phiên qua IPC cho Electron.
3. Chrome kiểm tra định kỳ hoặc khi người dùng bấm **Check connection**. Payload hiện tại gồm `focus` (`endAt` tính theo mili giây Unix, `domains`, `nextAction`) và `plan` (`rules`, `pendingChanges`, `timeZone`, `mission`, `nextAction`); `focus` là `null` khi không có phiên.
4. Extension lưu phiên và quy tắc trên Chrome, chuyển các tab bị chặn tới màn hình focus, tự đánh giá lịch chặn mỗi phút và gỡ rule khi hết hạn. Nó tiếp tục dùng dữ liệu đã nhận khi desktop mất kết nối.

Mã ghép nối và thông tin nhạy cảm ở trong môi trường chạy cục bộ. Extension chỉ cần hạn kết thúc, danh sách tên miền, tiêu đề việc tiếp theo, quy tắc chặn, các thay đổi đang chờ và múi giờ kế hoạch để áp dụng luồng này.

## Trạng thái theo SRS

| Phạm vi | Trạng thái |
|---|---|
| DAY-01, FOC-01 đến FOC-05 | Có trong bản nền. Chờ nghiệm thu A-01, A-02 trên Windows 11 thật. |
| DAY-02, TASK-01, TASK-02 | Đã làm: mission, tối đa ba ưu tiên, chọn việc tiếp theo, carryover giữ hạn, quick capture vào inbox, bốn trạng thái, cam kết, subtask, ước lượng, tiêu chí hoàn thành, work block và timeline. |
| REM-01, REM-02 | Đã làm: lead time, snooze, thiết bị nhận mặc định, thay khi mốc đổi, hủy khi hoàn thành, gom nhắc nhở quá hạn và hiển thị trạng thái quyền. Trên Android cần kiểm tra trên máy POCO. |
| SYS-01, SYS-02 | ID ổn định, múi giờ kế hoạch, gộp theo trường, xung đột và tombstone đã có. Chưa có dịch vụ đồng bộ qua mạng, nên chưa đạt mục tiêu 30 giây của SYS-06. |
| SYS-05 | Xuất và xóa dữ liệu người dùng tạo đã có. |
| SYS-08 | Đã làm cho giao diện planner (Today, Tasks, chi tiết, Review, Settings, nhắc nhở). Chưa dịch: tiện ích Chrome, menu khay Windows và nút chọn file do trình duyệt vẽ. |
| REV-01, REV-04 | Đã làm review giao hàng theo tuần và nhật ký workout có ảnh lưu cục bộ. |
| REV-02 | Người dùng tự xác nhận kết quả. Phần AI đề xuất chờ AI-01 đến AI-04. |
| FOC-05 | Settings hiển thị từng profile Chrome là đang được phủ hoặc không khả dụng dựa trên lần báo cáo gần nhất (quá 2 phút là không khả dụng). |
| REV-03 | Phần Windows đã làm: số lần bị chặn theo trang, ngày thiếu dữ liệu, so sánh tuần trước khi cả hai tuần đủ dữ liệu. Phần Android usage và ngưỡng hằng ngày chưa làm. |
| REM-02 trên Windows | Đóng cửa sổ thì app chạy tiếp ở vùng thông báo để nhắc nhở và phiên Chrome tiếp tục. |
| BLK-01 đến BLK-10 | Đã làm cho Chrome trên Windows và bản xem trước trên trình duyệt: trang **Block rules** trong Settings tạo, sửa, bật/tắt và xóa quy tắc với lịch Always hoặc Scheduled theo ngày và giờ, mức Block hoặc Pause kèm đếm ngược và thời gian pass. Thay đổi làm yếu chờ theo `settings.changeDelay`, hiện trong danh sách chờ và hủy được; hạ thời gian chờ cũng phải chờ. Extension đánh giá lịch mỗi phút nên quy tắc vẫn hiệu lực khi app đóng, và quy tắc là trường đồng bộ gốc nên giữ nguyên `effectiveAt` khi gộp. Extension báo cáo thêm số lần chặn, tạm dừng và pass theo từng giờ mỗi ngày, cùng lý do nhập khi dùng pass; **Review** hiển thị các số này tách khỏi số lần bị chặn trong phiên tập trung. Còn lại: BLK-11 (giới hạn thời gian mỗi ngày, ứng dụng Android) và nghiệm thu trên máy Windows thật. |
| APP-01, APP-02, APP-08 | Đã làm trên Windows: Settings tạo, sửa, xóa preset với danh sách app lấy từ cửa sổ đang mở, mức Block hoặc Pause kèm đếm ngược và thời gian pass, tối đa 10 preset và 30 app mỗi preset. Today cho chọn preset hoặc **No app limit** với lựa chọn gần nhất, và chọn preset cho phiên tự động lúc đăng nhập. Phiên sao chép preset khi bắt đầu nên sửa preset chỉ áp dụng cho phiên sau. Preset nằm trong tệp đồng bộ và gộp theo trường. Chưa làm APP-03 đến APP-07, APP-09 và APP-10: cần helper native theo dõi cửa sổ phía trước, thu nhỏ app không được phép và màn hình can thiệp. |
| FOC-06 đến FOC-08, CAL, GH, AI | Chưa làm. Cần đăng ký OAuth hoặc GitHub App, nhà cung cấp AI, dịch vụ đồng bộ, hoặc thiết bị Android thật. |

## Hướng kỹ thuật cho các giai đoạn tiếp theo

| Phần | Hướng đã đề xuất |
|---|---|
| Windows | C# với **.NET 10 LTS**, WPF, CommunityToolkit.Mvvm và SQLite. Chuyển luồng Today → focus → Chrome trước. Khi thiết kế lưu trữ mới, đánh giá cách mang dữ liệu planner từ bản Electron sang. |
| Chrome | Giữ Manifest V3 và các bài kiểm thử hành vi. Xem xét chuyển từ loopback sang Chrome Native Messaging sau khi WPF chạy được luồng chính. |
| Android | Giữ Capacitor dùng được trong lúc thử nghiệm quyền và hành vi trên máy POCO. Kotlin, Jetpack Compose và Room là hướng native được đề xuất. |
| Đồng bộ và tích hợp | ASP.NET Core và PostgreSQL là phương án khi bắt đầu đồng bộ nhiều thiết bị. Dịch vụ nên nhận và trả đúng payload `fix-myself-sync` hiện tại để dùng lại `mergeSync`. GitHub Issues, Google Calendar và AI vẫn thuộc các giai đoạn triển khai trong SRS. |
| iPhone | SwiftUI và Screen Time API là hướng đánh giá sau. |

Mốc Windows đầu tiên cần chứng minh người dùng đăng nhập, thấy Today, mở trang đã chọn và thấy việc tiếp theo trong Chrome. Kiểm tra cả trường hợp Chrome đã mở sẵn, desktop mất kết nối, và phiên hết hạn. Đối chiếu A-01 và A-02 trong [SRS.md](../SRS.md) và ghi kết quả vào [bảng nghiệm thu](ACCEPTANCE.md).

Ở commit nền `f706f9e`, bài kiểm tra Node và Chromium đã chạy đạt, cùng kiểm tra nhanh Electron, build Windows bằng `npm run desktop:package` (trình cài NSIS) và Android debug APK. Nghiệm thu sau khi đăng nhập trên Windows 11 và kiểm tra Android app blocking trên máy POCO vẫn là các mốc xác minh thiết bị thật theo A-01 đến A-03.
