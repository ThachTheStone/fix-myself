# Quy trình phát triển và bàn giao

## Nhận việc

- Đọc [AGENTS.md](../AGENTS.md) và đối chiếu yêu cầu với [SRS.md](../SRS.md). Dùng mã yêu cầu và mã nghiệm thu gần nhất trong SRS để ghi phạm vi.
- Chạy `git status --short --branch` và xem code ở đường dẫn liên quan trong [kiến trúc](ARCHITECTURE.md). Xác định phần đang chạy trong repo trước khi dựa vào mục tiêu dài hạn.
- Với công việc Windows .NET, bắt đầu từ luồng Today và focus trên Chrome. Giữ lệnh chạy hiện tại của Electron và Capacitor trong giai đoạn chuyển đổi, trừ khi công việc yêu cầu thay đổi điểm vào.

## Vòng làm việc giữa người dùng và agent

Đây là cách người dùng và agent điều phối đang làm việc với nhau, áp dụng cho mọi tính năng. Phân vai và quy tắc cho
worker nằm ở [làm việc nhiều agent](MULTI_AGENT.md); cách trao đổi nằm ở [SOUL.md](../SOUL.md).

| Bước | Ai làm | Việc | Kết quả để lại |
|---|---|---|---|
| 1. Ý tưởng | Người dùng | Nêu ý tưởng, góp ý của người khác, hoặc yêu cầu. | Tin nhắn |
| 2. Phân tích | Điều phối | Đối chiếu với SRS và code. Nói rõ chỗ mâu thuẫn và rủi ro, đưa một khuyến nghị kèm lý do, không liệt kê cho đủ. Chỉ hỏi những quyết định thật sự thuộc về người dùng, kèm phương án khuyến nghị. | Câu trả lời trong chat |
| 3. Chốt yêu cầu | Điều phối | Ghi quyết định vào [SRS.md](../SRS.md) (mã yêu cầu và bài nghiệm thu mới) và [ARCHITECTURE.md](ARCHITECTURE.md) (dữ liệu, trạng thái) **trước khi viết code**, vì critic và worker chỉ thấy những gì đã có trong repo. | Commit tài liệu |
| 4. Brief | Điều phối | Viết `docs/briefs/<task>.md` theo [TEMPLATE](briefs/TEMPLATE.md). Mọi lựa chọn thiết kế phải nằm trong "Decisions already made", để worker không phải đoán. | Brief |
| 5. Phản biện | Critic (Opus) | Bắt buộc với mọi brief và thay đổi SRS. Critic tìm mâu thuẫn, đường lách các cam kết lõi (chặn, thời gian chờ, block strict, phiên focus), rủi ro mất dữ liệu khi đồng bộ, và lựa chọn còn bỏ ngỏ. Điều phối áp mọi mục "Must change" vào brief; nếu worker đã chạy thì gửi bổ sung cho worker. | Brief đã sửa, commit |
| 6. Giao việc | Worker (Sonnet) | Mỗi việc một worktree tạo tay: `git worktree add -b agent/<task> ../fix-myselt-<task> <commit>`. Không dùng chế độ tự tạo worktree, vì nó từ chối khi ổ đĩa lệch chữ hoa thường (`d:` và `D:`). Nhiều việc chạy song song được khi chúng ít đụng cùng file. | Commit trên `agent/<task>` |
| 7. Review | Reviewer (Sonnet), hoặc điều phối với việc nhỏ | Chạy test, chạy code để thử các đường lách và tình huống mất dữ liệu, báo lỗi theo mức chặn, nên sửa, nhỏ. | Báo cáo review |
| 8. Sửa | Worker cũ, hoặc điều phối | Gửi vòng sửa cho chính worker cũ qua SendMessage, vì nó còn ngữ cảnh. Lỗi do brief, lỗi nhỏ, hoặc lỗi đụng logic dùng chung với extension thì điều phối tự sửa. Bản sửa đụng cam kết lõi phải được reviewer soát lại. | Commit sửa |
| 9. Merge | Điều phối | `git merge --no-ff` vào nhánh làm việc. Giải quyết xung đột, chạy lại `npm test`, build và browser test trên nhánh đã merge. Xóa worktree và nhánh `agent/*`. Ghi lượt chạy vào [agent-runs.md](agent-runs.md). **Push nhánh làm việc**; không push nhánh `agent/*`. | Commit merge trên `origin` |
| 10. Báo cáo | Điều phối | Nêu mã yêu cầu, commit, kết quả kiểm tra, phần chưa thử trên máy thật, và câu hỏi còn mở. Không khen, không giấu phần chưa kiểm chứng. | Tin nhắn |
| 11. Nghiệm thu | Người dùng và điều phối | Chạy bài A-xx trên Windows và POCO thật. Ghi kết quả vào [ACCEPTANCE.md](ACCEPTANCE.md). | Bảng nghiệm thu |

Khi người dùng đã ủy quyền ("có kết quả thì sửa rồi merge luôn"), điều phối đi hết các bước 5 đến 9 mà không hỏi
lại. Với câu hỏi critic dành cho người dùng, điều phối chọn phương án khuyến nghị, ghi vào SRS và báo trong bước 10
để người dùng đổi nếu muốn. Những việc luôn cần người dùng: tạo tài khoản và dịch vụ ngoài (Supabase, OAuth), nghiệm
thu trên thiết bị thật, tắt app desktop đang chạy để thử Electron, và merge vào `main`.

### Quy ước kỹ thuật rút ra từ các lượt trước

- Worker không chạy Electron và không chạy test extension Chrome, vì cổng `127.0.0.1:42631` và chế độ chỉ cho một bản
  của app có thể đang do app của người dùng giữ. Đặt `FIX_MYSELF_WORKER=1` khi chạy test.
- Sửa `extension/*` thì nâng `version` trong `extension/manifest.json`, để Settings nhắc người dùng bấm Reload.
- Trong PowerShell 5.1, viết commit message ra file rồi dùng `git commit -F <file>`, vì here-string truyền vào
  `-F -` không chạy. Ghi JSON bằng `Set-Content -Encoding utf8` sẽ thêm BOM; hãy kiểm tra và bỏ BOM, hoặc dùng
  `[IO.File]::WriteAllText`.
- CSP của app cấm thuộc tính `style=""`. Đặt vị trí bằng class hoặc `node.style`.
- Sau khi sửa `app/main.js`, rà các tên dùng mà chưa import. Đã có lỗi lọt qua review vì việc này.
- Mỗi lần ghi tài liệu, kiểm tra bảng Markdown không bị chèn đoạn văn ở giữa.

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
