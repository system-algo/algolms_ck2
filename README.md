# Algo LMS - Coding Knight (CK)

Hệ thống LMS mô phỏng cho khóa học **Coding Knight (CK)** của Algorithmics.

## 🚀 Hướng dẫn chạy

### Cài đặt dependencies:
```bash
npm install
```

### Chạy chế độ phát triển (Development):
```bash
npm run dev
```

### Build cho production:
```bash
npm run build
```

## 📦 Dữ liệu khóa học (Course Data)

- **Khóa học:** Coding Knight (`CK`)
- **Modules:** M3, M4, M5, M6, M7, M8
- **Tổng số trang/bài học:** 39 trang, 102 tasks, 1156 states

### Cập nhật dữ liệu từ file ZIP capture:
Đặt file ZIP vào thư mục `input/CK/<Module_Name>/` rồi chạy:
```bash
npm run import:clean -- ./input/CK
```
