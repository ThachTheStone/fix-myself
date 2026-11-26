# Thiết lập Supabase cho đồng bộ

Fix Myself đồng bộ kế hoạch giữa Windows và Android qua một project Supabase của riêng bạn. App vẫn chạy đầy đủ khi mất
mạng; Supabase chỉ thay việc chép file đồng bộ bằng tay. Thiết kế nằm trong [kiến trúc](ARCHITECTURE.md#đồng-bộ-qua-supabase).

## Dữ liệu lên server

Đúng nội dung của file đồng bộ hiện tại: task (kể cả cây task và link của workspace), work block, quy tắc chặn, preset
app, thời gian focus, kết quả block strict, workout không kèm ảnh, mission, cài đặt kế hoạch.

Không lên server: phiên focus đang chạy, nhắc nhở, đường dẫn file, thư mục và app trong workspace, ảnh workout, dữ liệu
Chrome và hoạt động app, vị trí đồng hồ nổi, mã ghép nối Chrome.

## Các bước bạn làm một lần

1. Tạo tài khoản và project ở [supabase.com](https://supabase.com), gói **Free**. Chọn vùng gần bạn (Singapore).
   Đặt mật khẩu database mạnh và giữ riêng; app không cần mật khẩu này.
2. **SQL Editor** → **New query** → dán toàn bộ [supabase/migrations/001_sync_docs.sql](../supabase/migrations/001_sync_docs.sql)
   → **Run**. Chạy lại không sao.
3. **Authentication → Sign In / Providers → Email**: bật **Email**, giữ nguyên các tùy chọn khác. Tên các mục trong
   trang quản trị Supabase có thể khác đôi chút theo phiên bản.
4. **SMTP riêng bằng Gmail (miễn phí).** Supabase chỉ cho sửa mẫu email khi project dùng SMTP riêng; máy chủ mặc định
   khóa mẫu và chỉ gửi tới email thành viên project, vài email mỗi giờ.
   - Tài khoản Google → **Bảo mật** → bật **Xác minh 2 bước** → **Mật khẩu ứng dụng** → tạo mật khẩu tên "Supabase"
     (16 ký tự).
   - Supabase → **Authentication → Emails → SMTP Settings** → bật **Enable custom SMTP**: Host `smtp.gmail.com`, Port
     `465`, Username và Sender email là địa chỉ Gmail của bạn, Password là mật khẩu ứng dụng (không phải mật khẩu Gmail),
     Sender name `Fix Myself`.
   - Không làm bước này cũng được: app nhận cả link trong email mặc định. **Chuột phải vào link → Sao chép địa chỉ liên
     kết** rồi dán vào ô Mã; không bấm mở link, vì mở là mã bị dùng mất.
5. **Authentication → Emails**: sửa **cả hai** mẫu **Magic Link** và **Confirm signup** để gửi mã. Dán nguyên nội dung
   [supabase/templates/magic-link.html](../supabase/templates/magic-link.html) và
   [supabase/templates/confirm-signup.html](../supabase/templates/confirm-signup.html) vào ô nội dung (Message body),
   và dùng dòng tiêu đề ghi ở đầu mỗi file. Bản tối thiểu cũng được: một dòng `Mã đăng nhập Fix Myself: {{ .Token }}`. Lần đăng nhập đầu tiên của một email mới dùng mẫu Confirm signup, các lần
   sau dùng Magic Link. App desktop và Android không mở link đăng nhập, nên email phải gửi mã. Độ dài mã (mặc định 6
   số) nằm trong cài đặt Email OTP; app nhận mã từ 6 đến 10 số.
6. **Project Settings → API Keys** (hoặc **API**): chép **Project URL** và một trong hai khóa công khai:
   - khóa **publishable** (bắt đầu bằng `sb_publishable_`), có ở các project tạo từ 2025; hoặc
   - khóa **anon public** (một chuỗi JWT dài), ở mục legacy.

   Gửi cho agent, hoặc dán vào Settings của app khi tính năng có. Khóa công khai được thiết kế để nằm trong app;
   quyền truy cập dữ liệu do Row Level Security giới hạn ở tài khoản của bạn. **Không bao giờ** gửi khóa **secret**
   (`sb_secret_…`) hay `service_role`; app cũng từ chối hai loại này.
7. **Sau khi mọi thiết bị đã đăng nhập**: **Authentication → Sign In / Providers** → tắt **Allow new users to sign up**.
   Khóa anon nằm trong file cài, nên nếu để mở, ai có file cài cũng tạo được tài khoản trong project của bạn. Họ không đọc
   được dữ liệu của bạn, nhưng dùng được hạn mức email và dung lượng. Khi thêm thiết bị mới bằng một email đã có, không
   cần mở lại.

## Giới hạn cần biết

- Gói Free tạm dừng project sau khoảng một tuần không có truy cập. Khi đó app vẫn chạy và báo đồng bộ không khả dụng;
  mở lại project trong trang quản trị Supabase.
- Gói Free giới hạn số email đăng nhập mỗi giờ. Mỗi thiết bị chỉ cần đăng nhập một lần.
- Xóa dữ liệu trong Settings của app (SYS-05) thay bản trên server bằng một dấu "đã xóa". Mỗi máy khác sẽ hỏi bạn: xóa
  luôn ở máy đó, hay đưa kế hoạch của máy đó lên lại.
- Một máy đã có kế hoạch riêng, lần đầu đăng nhập vào tài khoản đã có dữ liệu, sẽ được thay bằng bản trên tài khoản.
  Trước khi thay, app lưu một bản sao kế hoạch của máy đó trong mục "Đồng bộ tài khoản" (tối đa 5 bản, bản cũ nhất bị bỏ
  khi vượt). Mỗi bản có nút Khôi phục và Tải xuống. Khôi phục gộp bản đó vào kế hoạch hiện tại, không thay thế; kết quả
  được đồng bộ lên như mọi chỉnh sửa. Mọi cách xóa dữ liệu đều xóa các bản sao này.
- Khi đổi sang tài khoản hoặc project khác, nếu tài khoản mới chưa có kế hoạch, app hỏi có đưa kế hoạch của máy này lên
  không. Đưa lên không xóa gì trên máy; nếu lúc bạn xác nhận tài khoản đã có dữ liệu, app hỏi lại theo lựa chọn thay
  thế.
- Trên Android, phiên đăng nhập nằm trong bộ nhớ của app, chưa dùng kho bảo vệ của hệ điều hành (giới hạn đã biết).
