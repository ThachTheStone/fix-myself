# Kiến trúc Fix Myself

[SRS.md](../SRS.md) mô tả yêu cầu sản phẩm. Tài liệu này giúp xác định đường đi qua code hiện tại và trạng thái của các quyết định kỹ thuật.

## Bản nền đang chạy

| Phần | Điểm vào và trách nhiệm |
|---|---|
| Giao diện | [index.html](../index.html), [app/main.js](../app/main.js) và [app/styles.css](../app/styles.css). Vite build chung các màn Today, Tasks, chi tiết task (`#task/<id>`), Review và Settings cho desktop, Android và bản xem trước trên trình duyệt. |
| Ngôn ngữ | [app/i18n.js](../app/i18n.js) chứa từ điển tiếng Anh và tiếng Việt, hàm `t()` (có dạng số ít/số nhiều) và `translateError()` dịch thông báo lỗi tiếng Anh của model theo nội dung, nên [app/model.js](../app/model.js) không phụ thuộc ngôn ngữ. Văn bản tĩnh trong [index.html](../index.html) gắn `data-i18n`, `data-i18n-placeholder`, `data-i18n-aria-label`. Lựa chọn lưu ở khóa riêng `fix-myself:language` trên từng thiết bị, không đi vào file đồng bộ. Lần đầu chạy theo ngôn ngữ hệ thống. |
| Logic và dữ liệu cục bộ | [app/model.js](../app/model.js) là các hàm thuần cho task (trạng thái, cam kết, subtask, work block, hạn gốc và hạn sửa, timeline), Today (việc tiếp theo, carryover, hạn sắp tới, inbox), focus, nhắc nhở, đồng bộ, review tuần và workout. Trạng thái lưu trong `localStorage` khóa `fix-myself:v1` với `version: 2`; bản v1 được chuyển đổi khi đọc. Ngày kế hoạch theo `settings.timeZone`. Định danh thiết bị nằm ở khóa riêng `fix-myself:device`. |
| Lịch | [app/calendar.js](../app/calendar.js) là các hàm thuần cho trang Calendar (PLAN-01, PLAN-02): `calendarDays` xếp block và hạn chót theo ngày trong `settings.timeZone` (block qua nửa đêm tách thành hai phần, block chồng nhau chia cột), `snap`, `movedBlock`, `resizedBlock` và `rangeToBlock` làm tròn 15 phút. [app/main.js](../app/main.js) vẽ lưới, xử lý kéo bằng pointer và lưu qua `saveTask`, nên luật strict và `pendingBlockChanges` giữ nguyên. Android chỉ xem. Giới hạn đã biết: ngày đổi giờ (23 hoặc 25 giờ) vẫn vẽ đủ 24 nhãn giờ nên vị trí lệch một giờ sau thời điểm đổi. |
| Nhắc nhở | Model dựng lại `reminders` từ task sau mỗi thay đổi: giữ trạng thái snooze khi mốc không đổi, thay mới khi mốc đổi, bỏ khi task hoàn thành, hủy hoặc bị xóa. [app/notify.js](../app/notify.js) dùng Web Notification trên Electron và trình duyệt khi app đang chạy, và `@capacitor/local-notifications` để Android hẹn giờ với hệ điều hành. |
| Đồng bộ | Mỗi trường đồng bộ có dấu `thời điểm ISO|id thiết bị`. `mergeSync` lấy giá trị mới hơn, ghi xung đột khi cả hai thiết bị sửa cùng trường sau lần gộp trước, và giữ tombstone trong `deleted` để task đã xóa không quay lại. Phương tiện hiện tại là file hoặc dữ liệu dán trong Settings. Focus, nhắc nhở, xung đột và `peers` là dữ liệu riêng từng thiết bị. |
| Ảnh workout | [app/photos.js](../app/photos.js) lưu ảnh đã thu nhỏ trong IndexedDB của thiết bị. File đồng bộ chỉ mang cờ `hasPhoto`. |
| Desktop | [desktop/main.cjs](../desktop/main.cjs) quản lý cửa sổ Electron, biểu tượng ở vùng thông báo, tùy chọn chạy nền khi đóng cửa sổ và tùy chọn khởi chạy sau khi đăng nhập Windows. [desktop/preload.cjs](../desktop/preload.cjs) cung cấp API IPC giới hạn cho giao diện. [desktop/workspaces.cjs](../desktop/workspaces.cjs) giữ danh sách mục cục bộ của workspace và mở chúng (WS-01, WS-02). [desktop/mini-timer.cjs](../desktop/mini-timer.cjs) tạo cửa sổ đồng hồ nổi (FOC-12) từ `mini-timer.html`, `mini-timer.js` và `mini-preload.cjs`; renderer gửi `{ show, endAt, label, status, clickThrough }` qua `desktop:mini-timer` mỗi khi phiên đổi, cửa sổ tự đếm ngược. |
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
| TASK-03 đến TASK-06 | Đã làm: `parentId` tạo cây task tối đa 5 cấp, 50 con mỗi task; cha chỉ đóng khi cả cây con đã xong, mở lại con thì mở lại các cha đã đóng; không xóa task còn con; giữ phiên strict thì không gỡ việc con chưa xong. Trang Tasks hiện cây, trang task hiện đường dẫn cha, danh sách con, tiến độ và thời gian tập trung gộp. Kiểm tra bằng `tests/model.test.js` và `tests/browser.e2e.js`; chưa thử trên thiết bị thật. |
| REM-01, REM-02 | Đã làm: lead time, snooze, thiết bị nhận mặc định, thay khi mốc đổi, hủy khi hoàn thành, gom nhắc nhở quá hạn và hiển thị trạng thái quyền. Trên Android cần kiểm tra trên máy POCO. |
| SYS-01, SYS-02 | ID ổn định, múi giờ kế hoạch, gộp theo trường, xung đột và tombstone đã có. Chưa có dịch vụ đồng bộ qua mạng, nên chưa đạt mục tiêu 30 giây của SYS-06. |
| SYS-05 | Xuất và xóa dữ liệu người dùng tạo đã có. |
| SYS-08 | Đã làm cho giao diện planner (Today, Tasks, chi tiết, Review, Settings, nhắc nhở). Chưa dịch: tiện ích Chrome, menu khay Windows và nút chọn file do trình duyệt vẽ. |
| REV-01, REV-04 | Đã làm review giao hàng theo tuần và nhật ký workout có ảnh lưu cục bộ. |
| REV-02 | Người dùng tự xác nhận kết quả. Phần AI đề xuất chờ AI-01 đến AI-04. |
| FOC-05 | Settings hiển thị từng profile Chrome là đang được phủ hoặc không khả dụng dựa trên lần báo cáo gần nhất (quá 2 phút là không khả dụng). Báo cáo kèm phiên bản tiện ích; profile chạy bản cũ hơn bản đi kèm ứng dụng được cảnh báo cần Reload trong Settings và Today. |
| REV-03 | Phần Windows đã làm: số lần bị chặn theo trang, ngày thiếu dữ liệu, so sánh tuần trước khi cả hai tuần đủ dữ liệu. Phần Android usage và ngưỡng hằng ngày chưa làm. |
| REM-02 trên Windows | Đóng cửa sổ thì app chạy tiếp ở vùng thông báo để nhắc nhở và phiên Chrome tiếp tục. |
| BLK-01 đến BLK-10 | Đã làm cho Chrome trên Windows và bản xem trước trên trình duyệt: trang **Block rules** trong Settings tạo, sửa, bật/tắt và xóa quy tắc với lịch Always hoặc Scheduled theo ngày và giờ, mức Block hoặc Pause kèm đếm ngược và thời gian pass. Thay đổi làm yếu chờ theo `settings.changeDelay`, hiện trong danh sách chờ và hủy được; hạ thời gian chờ cũng phải chờ. Extension đánh giá lịch mỗi phút nên quy tắc vẫn hiệu lực khi app đóng, và quy tắc là trường đồng bộ gốc nên giữ nguyên `effectiveAt` khi gộp. Extension báo cáo thêm số lần chặn, tạm dừng và pass theo từng giờ mỗi ngày, cùng lý do nhập khi dùng pass; **Review** hiển thị các số này tách khỏi số lần bị chặn trong phiên tập trung. Còn lại: BLK-11 (giới hạn thời gian mỗi ngày, ứng dụng Android) và nghiệm thu trên máy Windows thật. |
| APP-01, APP-02, APP-08 | Đã làm trên Windows: Settings tạo, sửa, xóa preset với danh sách app lấy từ cửa sổ đang mở, mức Block hoặc Pause kèm đếm ngược và thời gian pass, tối đa 10 preset và 30 app mỗi preset. Today cho chọn preset hoặc **No app limit** với lựa chọn gần nhất, và chọn preset cho phiên tự động lúc đăng nhập. Phiên sao chép preset khi bắt đầu nên sửa preset chỉ áp dụng cho phiên sau. Preset nằm trong tệp đồng bộ và gộp theo trường. |
| APP-03 đến APP-07, APP-09 | Đã làm trên Windows. `desktop/app-watcher.cjs` chạy một helper C# qua Windows PowerShell (`Add-Type`, không cần module native): báo cửa sổ phía trước 4 lần mỗi giây kèm đường dẫn exe, và nhận lệnh thu nhỏ hoặc khôi phục. `desktop/app-guard.cjs` quyết định cho phép, Block hay Pause theo bản sao preset của phiên do renderer gửi qua `desktop:app-limit`, giữ pass trong bộ nhớ đến hết phiên, và báo độ phủ (không đọc được đường dẫn hoặc thu nhỏ thất bại là phủ một phần; helper lỗi quá 3 lần là không khả dụng). Renderer hiện hộp thoại can thiệp, ghi `appActivity` cục bộ (không đồng bộ) và Review hiện số lần chặn, tạm dừng, cho qua theo app kèm lý do. Đã thử thật trên máy phát triển với Notepad. Còn lại: APP-10 và nghiệm thu A-12, gồm app chạy quyền quản trị và app toàn màn hình. |
| FOC-06 đến FOC-08, CAL, GH, AI | Chưa làm. Cần đăng ký OAuth hoặc GitHub App, nhà cung cấp AI, dịch vụ đồng bộ, hoặc thiết bị Android thật. |
| FOC-09 đến FOC-11 | Đã làm: trạng thái v3 có `focusSegments`; Today chọn một task hoặc không chọn (wandering) trước khi bắt đầu, có Pause/Resume và End session; End session dừng ghi thời gian và giới hạn app nhưng giữ chặn trang đến `blockUntil`; thời gian tập trung hiện ở chi tiết task và ở mục Focus time của Review; các đoạn thời gian đồng bộ qua file sync (trường `focusSegments` tùy chọn). Kiểm tra bằng `tests/model.test.js` và `tests/browser.e2e.js`; chưa thử trên thiết bị thật. |
| WB-01 đến WB-04 | Đã làm: block có `strict`; `tickStrict` bắt đầu phiên gắn task khi block bắt đầu, giữ phiên (không Pause, End hay đổi task), kéo dài từng 15 phút đến tối đa gấp đôi độ dài block và ghi `strictLog`; thoát khẩn cấp có đếm ngược 2 phút và lý do; nới lỏng block (bỏ strict, rút ngắn, dời muộn, xóa) chờ `changeDelay` qua `pendingBlockChanges`; Review có mục Strict blocks. Kiểm tra bằng `tests/model.test.js` và `tests/browser.e2e.js`; chưa thử trên thiết bị thật. |
| FOC-12 | Đã làm trên Windows: cửa sổ nhỏ luôn nằm trên cùng, hiện thời gian còn lại và tên task (hoặc Wandering), kéo được, nhớ vị trí, có thể cho nhấp xuyên qua, mở từ Today hoặc biểu tượng ở vùng thông báo, đóng khi phiên kết thúc. Kiểm tra bằng `tests/model.test.js` và `tests/minitimer.test.js`; chưa thử trên máy thật. |
| WS-01 đến WS-05 | Đã làm: task có `links` (http, https, đồng bộ) và mục cục bộ (tệp, thư mục, app) do tiến trình chính giữ trong `workspace-items.json`; chi tiết task có mục Workspace và nút **Open workspace**, Today có nút này cạnh "Working on". Trang bị focus hoặc quy tắc chặn (`linkBlock`) chỉ được báo, không mở. `startFocus` sao chép app của workspace vào `focus.workspaceApps` và `appLimitSnapshot` gộp chúng với preset. Không có đường mở tự động. Bản trình duyệt chỉ có trang web (`window.open`). Kiểm tra bằng `tests/model.test.js`, `tests/workspaces.test.js`, `tests/appguard.test.js` và `tests/browser.e2e.js`; chưa thử trên máy thật. |
| PLAN-01, PLAN-02 | Đã làm trên Windows và bản xem trước trình duyệt: trang Calendar xem tuần hoặc ngày, kéo để dời, đổi độ dài và tạo block; hạn chót và block strict được đánh dấu; Android chỉ xem. Kiểm tra bằng `tests/calendar.test.js` và `tests/browser.e2e.js`; chưa thử trên thiết bị thật. Chưa có busy time từ Google Calendar (CAL-01). |

## Hướng kỹ thuật cho các giai đoạn tiếp theo

| Phần | Hướng đã đề xuất |
|---|---|
| Windows | C# với **.NET 10 LTS**, WPF, CommunityToolkit.Mvvm và SQLite. Chuyển luồng Today → focus → Chrome trước. Khi thiết kế lưu trữ mới, đánh giá cách mang dữ liệu planner từ bản Electron sang. |
| Chrome | Giữ Manifest V3 và các bài kiểm thử hành vi. Xem xét chuyển từ loopback sang Chrome Native Messaging sau khi WPF chạy được luồng chính. |
| Android | Giữ Capacitor dùng được trong lúc thử nghiệm quyền và hành vi trên máy POCO. Kotlin, Jetpack Compose và Room là hướng native được đề xuất. Vai trò, trạng thái và kế hoạch: [Android](ANDROID.md). |
| Đồng bộ | **Supabase** (PostgreSQL có sẵn Auth, Row Level Security và Realtime) thay cho tự viết ASP.NET Core. Xem [đồng bộ qua Supabase](#đồng-bộ-qua-supabase). |
| Tích hợp | GitHub Issues, Google Calendar và AI vẫn thuộc các giai đoạn triển khai trong SRS. Phần nào cần giữ bí mật phía server (khóa AI, token GitHub App) chạy trong Supabase Edge Functions, không nằm trong app. |
| iPhone | SwiftUI và Screen Time API là hướng đánh giá sau. |

Mốc Windows đầu tiên cần chứng minh người dùng đăng nhập, thấy Today, mở trang đã chọn và thấy việc tiếp theo trong Chrome. Kiểm tra cả trường hợp Chrome đã mở sẵn, desktop mất kết nối, và phiên hết hạn. Đối chiếu A-01 và A-02 trong [SRS.md](../SRS.md) và ghi kết quả vào [bảng nghiệm thu](ACCEPTANCE.md).

Ở commit nền `f706f9e`, bài kiểm tra Node và Chromium đã chạy đạt, cùng kiểm tra nhanh Electron, build Windows bằng `npm run desktop:package` (trình cài NSIS) và Android debug APK. Nghiệm thu sau khi đăng nhập trên Windows 11 và kiểm tra Android app blocking trên máy POCO vẫn là các mốc xác minh thiết bị thật theo A-01 đến A-03.

## Đồng bộ qua Supabase

Quyết định ngày 2026-11-25: dùng Supabase làm server dữ liệu chung cho Windows và Android, thay cho file đồng bộ chép tay. Mục tiêu là SYS-06 (đồng bộ trong 30 giây) và SYS-02 (offline, không trùng, không hồi sinh dữ liệu đã xóa).

**Nguyên tắc**

- App vẫn **local-first**: dữ liệu chính nằm trên máy và app chạy đầy đủ khi mất mạng. Supabase chỉ thay phương tiện chuyển payload, không thay logic gộp.
- Logic gộp giữ nguyên ở client: `mergeSync` trong [app/model.js](../app/model.js) đã có test cho xung đột và tombstone (A-10). Server không tự gộp.
- Dữ liệu riêng từng thiết bị không lên server: `focus`, `reminders`, `conflicts`, `peers`, `appActivity`, `state.chrome`, ảnh workout, file, thư mục và app trong không gian làm việc (WS-01), vị trí đồng hồ nổi.
- Mã ghép nối Chrome và khóa Supabase của phiên đăng nhập lưu bằng bộ lưu trữ bảo vệ của hệ điều hành (SYS-03), không nằm trong `localStorage`.

**Bước 1: một tài liệu mỗi tài khoản**

```sql
create table sync_docs (
  user_id    uuid primary key references auth.users,
  payload    jsonb not null,      -- đúng định dạng fix-myself-sync
  rev        bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table sync_docs enable row level security;
create policy own_doc on sync_docs
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Luồng đồng bộ của mỗi thiết bị ([app/cloud-sync.js](../app/cloud-sync.js)). `mergeSync` vẫn là nơi duy nhất quyết định giá trị; engine chỉ quyết định khi nào đọc, gộp và ghi.

1. **Đăng nhập và gắn tài khoản.** Engine nhớ id tài khoản đã gắn (`cloud.account`) trong bộ nhớ riêng của thiết bị.
   - Cùng tài khoản: đồng bộ bình thường.
   - Chưa gắn, dòng server chưa có: gắn và đẩy kế hoạch của máy với `expected_rev: 0`.
   - Chưa gắn, dòng server đã có: trạng thái `link-needed`, đồng bộ tạm dừng cho tới khi người dùng chọn. Mặc định là **thay thế** (`replace`): lưu bản sao lưu của máy (`saveBackup`; nếu lưu lỗi thì hủy, trạng thái `error` mã `backup`), xóa dữ liệu đồng bộ cục bộ bằng `clearSyncedData` rồi gộp bản server với `allowOwn` và `preferRemoteRoot` để bản server thắng mọi trường gốc. Dữ liệu riêng của thiết bị (phiên focus đang chạy, strict hold, Chrome) giữ nguyên. Máy chưa có dữ liệu thì thay thế không cần hỏi. Dòng là dấu xóa (erase marker) được coi như tài khoản trống: gắn không hỏi và đẩy kế hoạch của máy.
   - Đã gắn tài khoản khác: trạng thái `account-changed`; không đọc hay ghi gì cho tới khi người dùng chọn `replace` hoặc `cancel`. Gắn lại đặt lại `peers`, `lastSeenRev`, `dirty`, `eraseSeen`, `mergePushes`.
2. **Mỗi lượt đồng bộ** (khởi động, sau thay đổi cục bộ với debounce 3 giây, có mạng lại, app hiện lại, mỗi 5 phút, và mọi sự kiện Realtime INSERT hoặc UPDATE của dòng mình). Mỗi lúc chỉ một lượt chạy; lời gọi thêm được gộp thành một lượt chạy lại.
   1. Đọc nhẹ chỉ cột `rev`. Nếu `rev` bằng `lastSeenRev` và `dirty` là false thì dừng. `dirty` được lưu nên sửa lúc offline rồi khởi động lại vẫn được đẩy lên.
   2. Đọc đầy đủ `payload` và `rev`.
   3. Dấu xóa: `erasedAt` khác rỗng và khác `eraseSeen` thì báo `erased` và không đẩy gì cho tới khi người dùng chọn xóa máy này hoặc tải lại kế hoạch của máy. Mọi lần đẩy sau đó đều mang `erasedAt`, nên thiết bị offline lâu vẫn nhận được dấu xóa.
   4. `schema` của payload lớn hơn `SYNC_SCHEMA` (hiện là 2): báo lỗi `update-app`, không đẩy.
   5. Luôn gộp bằng `mergeSync` kể cả payload do chính máy này ghi (`allowOwn`), nên sau sự cố hay khi state bị thay từ ngoài, dữ liệu cũ không bao giờ đè dữ liệu mới. Payload không hợp lệ: lỗi `bad-remote`, không đẩy.
   6. **Chỉ đẩy khi khác**: so `canonical(data)` (sắp theo `id` các danh sách gốc và `events` của task, sắp khóa đối tượng, bỏ `devices[*].lastSeenAt`, không đảo mảng trong trường như `subtasks`) và `erasedAt`. Bằng nhau thì ghi `lastSeenRev`, xóa `dirty`. Khác thì gọi `push_sync_doc(expected_rev, new_payload)`; kết quả `null` nghĩa là thiết bị khác ghi trước, đọc lại và gộp lại, tối đa 3 lần rồi lỗi `busy`. `dirty` chỉ được xóa khi không có sửa đổi nào xảy ra từ lúc lấy bản export (`cloud.changeGen`). Vòng bảo vệ: quá 3 lần đẩy chỉ-để-gộp liên tiếp thì lỗi `loop` và dừng đẩy cho tới thay đổi cục bộ kế tiếp.
   7. Dòng bị xóa trong khi đã gắn: đẩy lại với `expected_rev: 0`.
3. **Xóa ở mọi nơi** (`eraseEverywhere`): dừng engine, đẩy dấu xóa (payload rỗng kèm `erasedAt`) qua cùng cơ chế CAS, và chỉ khi thành công mới xóa dữ liệu đồng bộ cục bộ, ghi `eraseSeen` và `lastSeenRev`, rồi chạy lại engine; kế hoạch cũ không thể đẩy lại lên trên dấu xóa. Thất bại thì báo lỗi và không đổi gì ở máy. Bị từ chối khi phiên focus hoặc strict hold đang chạy, giống xóa dữ liệu cục bộ.
4. **Trạng thái** gửi cho giao diện: `signed-out`, `link-needed`, `account-changed`, `syncing`, `synced`, `offline`, `erased`, `clock-skew` (lệch hơn 2 phút so với `server_now()`, kiểm tra một lần mỗi lần khởi động) và `error` với mã `bad-remote`, `update-app`, `busy`, `loop`, `backup`, `server`, `paused` (lỗi 5xx kéo dài hơn 1 giờ khi có mạng).
5. **Quy tắc quyết định giá trị của `mergeSync`** để mọi thiết bị đến cùng một dữ liệu: `completedAt` và `originalDeadline` lấy giá trị sớm nhất khác rỗng; workout trùng `updatedAt` lấy bản có JSON chuẩn tắc lớn hơn; xung đột cục bộ đã được thiết bị khác giải quyết (cả hai dấu nằm trong `supersedes`) bị bỏ.

Cách này dùng lại nguyên định dạng `fix-myself-sync`, nên file đồng bộ vẫn dùng được để sao lưu và chuyển dữ liệu.

**Bước 2: khi payload lớn dần**

Tách payload thành bảng theo loại bản ghi (`tasks`, `focus_segments`, `block_rules`, `app_presets`, `workouts`, `tombstones`), mỗi dòng giữ dấu sửa `thời điểm|id thiết bị` như hiện nay. Thiết bị chỉ gửi và nhận các dòng đổi sau lần đồng bộ trước. `focus_segments` chỉ thêm và xóa theo `id`, nên gộp bằng phép hợp.

**Cần lưu ý**

- Gói miễn phí tạm dừng project sau khoảng một tuần không có truy cập. Dùng hằng ngày thì không ảnh hưởng. Khi project bị tạm dừng, app vẫn chạy cục bộ và báo đồng bộ không khả dụng.
- Extension Chrome không nói chuyện với Supabase. Nó vẫn chỉ nhận dữ liệu từ app desktop qua bridge cục bộ (SYS-04).
- Xóa tài khoản phải xóa `sync_docs` và dữ liệu liên quan (SYS-05).

## Thay đổi dữ liệu cho SRS 0.6

State cục bộ chuyển từ `version: 2` sang `version: 3`, kèm hàm chuyển đổi khi đọc như v1 sang v2.

| Dữ liệu | Đồng bộ | Yêu cầu | Ghi chú |
|---|---|---|---|
| `task.parentId`: id của task cha hoặc `null` | Có, là trường của task | TASK-03, TASK-06 | Task cũ không có trường này, đọc như `null`. Cha thiếu hoặc đã xóa, và vòng lặp do hai thiết bị cùng dời, được sửa khi đọc bằng `effectiveParents` (vòng lặp cắt ở task có `stamps.parentId` mới nhất, bằng nhau thì id nhỏ hơn); không ghi lại vào dữ liệu và không tạo xung đột. |
| `task.links`: `[{ id, url, label }]` | Có, là trường của task | WS-01 | Chỉ http và https, tối đa 20 mục chung với dữ liệu cục bộ. |
| `workspace-items.json` trong thư mục dữ liệu của app: `{ [itemId]: { taskId, kind: 'file' \| 'folder' \| 'app', path, label } }` | Không | WS-01, WS-04 | Chỉ tiến trình chính đọc và ghi ([desktop/workspaces.cjs](../desktop/workspaces.cjs)); renderer chỉ gọi theo `itemId` nên không thể bắt tiến trình chính mở một đường dẫn tự chọn. Mục chỉ được tạo bằng hộp thoại hệ thống hoặc danh sách app đang mở. Đường dẫn chỉ đúng trên máy đã thêm. Mục của task đã xóa bị dọn khi mở app và sau khi gộp đồng bộ. |
| `secrets.json` trong thư mục dữ liệu của app (chỉ Windows): `{ [key]: base64 }`, khóa `sb-` | Không | SYS-03 | Phiên Supabase mã hóa bằng `safeStorage` (bảo vệ theo người dùng Windows), tối đa 50 khóa, không bao giờ ghi văn bản thường. Chỉ tiến trình chính đọc và ghi ([desktop/secrets.cjs](../desktop/secrets.cjs)); renderer gọi qua `secretGet`, `secretSet`, `secretRemove`. File hỏng hoặc mục không giải mã được đọc như thiếu. |
| `focus.sessionId`, `focus.taskId` (hoặc `null` là wandering), `focus.workspaceApps`, `focus.paused`, `focus.endedAt`, `focus.strict` | Không | FOC-09, FOC-10, WS-04, WB-02 | `focus.strict` là `{ blockId, taskId, blockStart, blockEnd, holdUntil, limit, exitRequestedAt }` (Unix ms) khi một block nghiêm ngặt đang giữ phiên, ngược lại `null`. `workspaceApps` được sao chép lúc bắt đầu phiên, giống preset. Sau **End session**, phiên vẫn được giữ đến `endAt` để Chrome tiếp tục chặn trang, nhưng không còn ghi thời gian và không còn giới hạn app. Phiên mới bắt đầu trong khoảng đó chặn hợp hai danh sách trang. |
| `focusSegments`: `[{ id, sessionId, taskId, start, end, deviceId }]` | Có, gộp theo `id` | FOC-10, FOC-11 | Xóa task thì xóa các đoạn của nó bằng tombstone. |
| `workBlock.strict` | Có, đi cùng trường `workBlocks` của task | WB-01 | Mọi thay đổi làm block strict không còn phủ khoảng thời gian cũ đều phải đi qua `pendingBlockChanges` với cùng `changeDelay`: bỏ `strict`, xóa block, bắt đầu muộn hơn, kết thúc sớm hơn (kể cả dời sớm mà giữ nguyên độ dài). Trong lúc giữ phiên, không xóa được việc con chưa xong. |
| `pendingBlockChanges`: `[{ id, taskId, blockId, block, effectiveAt, createdAt }]` | Có, là trường gốc (ghi bằng `setRoot`) | WB-01 | `block` là block mới hoặc `null` khi xóa. `applyPendingBlockChanges` áp dụng khi đến hạn và bỏ mục hỏng. Một lần sửa mới vào cùng block thay thế mục đang chờ, nên mục chờ không ghi đè lần sửa sau. |
| `strictLog`: `[{ id, blockId, taskId, outcome, reason, at }]` | Có, gộp theo `id` | WB-04 | `outcome` thuộc `STRICT_OUTCOMES`: `on_time`, `extended`, `limit_reached`, `exited`, `canceled`, `missed`. |
| `preferences.miniTimer`: `{ enabled, clickThrough }` | Không | FOC-12 | Vị trí cửa sổ do tiến trình chính lưu ở `mini-timer.json` trong thư mục dữ liệu của app. |

**Giới hạn đã biết của WB.**

- Quy tắc chờ chỉ được kiểm tra trong model của bản này. Một file đồng bộ tự chế hoặc một bản app cũ mang dấu sửa mới hơn cho `workBlocks` có thể bỏ `strict` ngay khi gộp, vì gộp chỉ so dấu sửa.
- `pendingBlockChanges` gộp kiểu bản ghi sau thắng, nên hai thiết bị cùng xếp chờ có thể mất một mục. Khi đó block giữ nguyên, tức là lỗi nghiêng về phía an toàn.
- Khóa việc con chỉ có hiệu lực trong lúc giữ phiên. Trước khi block bắt đầu, người dùng có thể đặt tiêu chí hoàn thành rồi xóa các việc con chưa xong. Đến giờ block, họ chỉ cần bấm hoàn thành.
- Đã sửa ngày 2026-11-26: đổi múi giờ kế hoạch từng rút được độ trễ `next-day`. Giờ `updateSettings` đưa việc đổi múi giờ vào `pendingRuleChanges` (loại `timeZone`) khi có quy tắc chặn đang bật hoặc block strict chưa kết thúc. `effectiveRules` trả `zoneChanged` và `timeZone` để app và extension cùng đổi múi giờ đúng hạn, kể cả khi app đóng. Bridge kiểm tra tên múi giờ trước khi gửi cho Chrome. Một extension bản cũ không hiểu loại thay đổi này thì giữ múi giờ cũ cho đến khi app gửi bản kế hoạch mới.
- Cây task (TASK-03): task con đang mở làm task cha đủ điều kiện có block strict (`strictEligible`). Hoàn thành task con luôn được phép, nên người dùng có thể thêm một task con làm cho có, đặt strict rồi hoàn thành nó ngay; block strict khi đó không còn gì để giữ. Đây là lựa chọn có chủ ý: chặn lại thì sẽ khóa luôn lối ra bình thường khi làm xong việc.
- Chuyển, hủy hoặc xóa task con đến từ máy khác qua đồng bộ không đi qua kiểm tra `checkAncestorsNeedIt`, nên task cha có thể còn block strict mà không đủ điều kiện. Không có phiên đang giữ nào bị phá; người dùng sửa lại trên máy.

Phần desktop cần thêm:

- **Không gian làm việc**: IPC `desktop:open-workspace` nhận `taskId`. Tiến trình chính đọc mục đã lưu và mở bằng `shell.openExternal` (web), `shell.openPath` (file, thư mục) hoặc chạy exe không tham số. Nó không nhận đường dẫn tùy ý từ renderer. Chọn file và thư mục bằng `dialog.showOpenDialog`, chọn app bằng danh sách sẵn có trong [desktop/apps.cjs](../desktop/apps.cjs).
- **App guard**: danh sách được phép của phiên là preset cộng `focus.workspaceApps` ([desktop/app-guard.cjs](../desktop/app-guard.cjs)).
- **Đồng hồ nổi**: một `BrowserWindow` riêng, không viền, `alwaysOnTop` mức `screen-saver`, tự tính thời gian còn lại từ `endAt`. Bật tắt qua IPC và menu khay. Bấm xuyên bằng `setIgnoreMouseEvents`.
- **Lịch** (PLAN-01, PLAN-02): màn mới trong renderer, dùng chung giữa desktop và Android. Android chỉ hiển thị. Kéo thả ghi lại trường `workBlocks` của task qua đường sửa task hiện có trong model. Đường này đã giữ nguyên hạn chót, ghi timeline và dựng lại nhắc nhở.
