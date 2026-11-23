# Làm việc nhiều agent

Tài liệu này mô tả cách chia việc giữa agent điều phối (Claude Opus) và các worker rẻ hơn (Claude Haiku, Claude Sonnet,
Cline với DeepSeek). Mục tiêu là giảm chi phí cho mỗi việc hoàn thành mà vẫn giữ chất lượng.

## Vai trò

| Vai trò | Ai đảm nhận | Việc làm |
|---|---|---|
| Điều phối | Claude Opus (phiên chính) | Chia việc, quyết định thiết kế, viết brief, nghiệm thu, merge. Giữ phần khó: đồng bộ, múi giờ, bảo mật bridge, gỡ lỗi nhiều module. |
| Worker Claude | Subagent `implementer` ([.claude/agents/implementer.md](../.claude/agents/implementer.md), Haiku) | Làm một brief trong worktree riêng, chạy test, commit. |
| Worker Cline | Cline CLI với DeepSeek qua [scripts/dispatch-cline.sh](../scripts/dispatch-cline.sh) | Như worker Claude, chạy ngoài phiên Claude Code. Mã nguồn được gửi tới DeepSeek. |
| Review | Subagent `reviewer` ([.claude/agents/reviewer.md](../.claude/agents/reviewer.md), Sonnet) | Chỉ đọc. So nhánh của worker với brief và SRS, chạy test, báo lỗi theo mức độ. |
| Người dùng | Chủ sản phẩm | Duyệt yêu cầu mới, quyết định merge vào `main`, cho phép gửi mã ra dịch vụ ngoài. |

## Khi nào giao cho worker

Giao khi việc thỏa cả bốn điều:
- Thiết kế đã chốt trong brief, không cần worker tự quyết.
- Chạm khoảng 1–3 file, một mục tiêu.
- Có lệnh test xác định "xong".
- Sai sót được phát hiện bằng test hoặc review trước khi merge.

Giữ ở điều phối: thiết kế, logic đồng bộ và lịch chặn, bảo mật bridge và extension, gỡ lỗi xuyên module, review cuối.
Worker thất bại hai vòng liên tiếp trên cùng một brief thì điều phối nhận lại hoặc chuyển sang Sonnet.

## Luồng làm việc

1. **Brief.** Điều phối viết brief theo [docs/briefs/TEMPLATE.md](briefs/TEMPLATE.md), lưu ở `docs/briefs/<task>.md`.
   Brief chỉ chứa phần riêng của việc; quy tắc chung nằm ở `AGENTS.md` và tài liệu này để tận dụng prompt cache.
2. **Giao việc.**
   - Worker Claude: điều phối gọi subagent `implementer` với `isolation: worktree` và đường dẫn brief.
   - Worker Cline: `scripts/dispatch-cline.sh <task> docs/briefs/<task>.md [base-ref]`. Script tạo worktree
     `../fix-myselt-<task>` trên nhánh `agent/<task>`, chạy Cline, rồi chạy kiểm tra và ghi báo cáo vào
     `.agent-runs/<task>/`. Chạy lại cùng `<task>` sẽ dùng lại worktree cho vòng sửa tiếp theo.
3. **Kiểm tra tự động.** Unit test, build, `git diff --check` và browser test (trừ test extension Chrome, vì cổng
   `127.0.0.1:42631` có thể đang do app desktop giữ).
4. **Review.** Subagent `reviewer` cho việc trung bình trở lên; điều phối luôn đọc phần rủi ro.
5. **Sửa.** Gửi lại worker với brief hẹp `docs/briefs/<task>-fix-N.md`, hoặc điều phối tự sửa nếu nhỏ và khó.
6. **Ghi kết quả** vào [docs/agent-runs.md](agent-runs.md): worker, số vòng, kết quả test, lỗi review, chi phí ước tính.
7. **Merge** vào nhánh làm việc sau khi người dùng đồng ý. Không push nhánh `agent/*` trừ khi người dùng yêu cầu.

## Quy tắc bắt buộc cho worker

Áp dụng cho mọi worker, kể cả Cline. Brief nhắc lại các quy tắc này.
- Không dừng, kill hay khởi động lại tiến trình mà mình không tự tạo (`Stop-Process`, `taskkill`, `kill`, kể cả
  `node`, `electron`, Chrome). Cổng bận thì báo lại và bỏ qua test đó.
  Script giao việc đặt `FIX_MYSELF_WORKER=1` nên test extension Chrome tự bỏ qua, và báo cáo đánh **Fail** ở mục
  "Process rule" khi log có lệnh dừng tiến trình hoặc một tiến trình Electron, Fix Myself, Chrome hay VS Code biến mất.
- Chỉ sửa file trong worktree được giao. Không đổi cấu hình git, không push, không rebase, reset hay viết lại commit đã có.
- Không sửa `SRS.md` hay thêm yêu cầu mới. Câu hỏi về yêu cầu thì dừng và báo lại.
- Không làm test xanh bằng cách tăng timeout, bỏ assertion hay skip test. Chỉ đổi test khi test sai so với SRS và nêu lý do.
- Không để lại file log hay báo cáo tạm trong repo.
- Chuỗi hiển thị mới đi qua `t()` trong `app/i18n.js`, có cả tiếng Anh và tiếng Việt.
- Commit kèm trailer mà brief chỉ định.

## Chi phí

- Tính chi phí trên mỗi việc hoàn thành, gồm cả phần của điều phối: viết brief, review, các vòng sửa.
- Worker chỉ rẻ hơn khi phần đọc file nặng chuyển sang model rẻ và vòng đầu đã dùng được.
- Prompt cache: giữ `AGENTS.md`, tài liệu này và template ổn định; brief ngắn, chỉ chứa phần thay đổi.
- Giá tham khảo mỗi triệu token (vào/ra): Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50
  (prompt trên 100K token: $0.50/$2.50). Giá DeepSeek xem trên trang của nhà cung cấp.
- Gửi mã tới DeepSeek là gửi ra dịch vụ bên thứ ba; chỉ dùng khi người dùng đã đồng ý.
