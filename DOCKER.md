## Build và chạy
 
```bash
# Build từ source và khởi động toàn bộ stack
docker compose -f docker-compose.dev-full.yaml up --build
```

## Truy cập các service
 
| Service       | URL                        | Ghi chú                     |
|---------------|----------------------------|-----------------------------|
| Postiz App    | http://localhost:4007      | Ứng dụng chính              |
| pgAdmin       | http://localhost:8081      | admin@admin.com / admin     |
| RedisInsight  | http://localhost:5540      | Quản lý Redis               |
| Temporal UI   | http://localhost:8080      | Xem workflow jobs           |
 
---

## Khi sửa code → rebuild
 
Sau khi chỉnh sửa source code, chạy lại:
 
```bash
# Rebuild chỉ service postiz (nhanh hơn rebuild toàn bộ)
docker compose -f docker-compose.dev-full.yaml up --build postiz
```
 
Hoặc nếu muốn rebuild hoàn toàn sạch:
 
```bash
docker compose -f docker-compose.dev-full.yaml down
docker compose -f docker-compose.dev-full.yaml up --build
```
 
---

## Xem logs
 
```bash
# Xem log của app
docker logs -f postiz
 
# Xem log của tất cả services
docker compose -f docker-compose.dev-full.yaml logs -f
```
 
---
 
## Dừng toàn bộ stack
 
```bash
docker compose -f docker-compose.dev-full.yaml down
```
 
Dừng và xóa cả volume (reset DB):
 
```bash
docker compose -f docker-compose.dev-full.yaml down -v
```