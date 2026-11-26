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
4. **Authentication → Emails → Magic Link** (mẫu email đăng nhập): thay nội dung bằng một dòng có mã, ví dụ
   `Mã đăng nhập Fix Myself: {{ .Token }}`. Như vậy email gửi mã 6 số thay vì đường link, vì app desktop và Android
   không mở link đăng nhập.
5. **Project Settings → API**: chép **Project URL** và khóa **anon public** gửi cho agent (hoặc dán vào Settings của
   app khi tính năng có). Khóa anon được thiết kế để nằm trong app; quyền truy cập dữ liệu do Row Level Security giới hạn
   ở tài khoản của bạn. **Không** gửi khóa `service_role`.

## Giới hạn cần biết

- Gói Free tạm dừng project sau khoảng một tuần không có truy cập. Khi đó app vẫn chạy và báo đồng bộ không khả dụng;
  mở lại project trong trang quản trị Supabase.
- Gói Free giới hạn số email đăng nhập mỗi giờ. Mỗi thiết bị chỉ cần đăng nhập một lần.
- Xóa dữ liệu trong Settings của app (SYS-05) sẽ xóa cả bản trên server.
