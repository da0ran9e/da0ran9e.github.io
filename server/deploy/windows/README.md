# Trại Gà — chạy server trên Windows + Cloudflare Tunnel

Mục tiêu: máy Windows ở nhà chạy server, người chơi vào **https://game.vuducan.qzz.io/** là chơi online.
Server phục vụ luôn trang game và API trên **cùng một địa chỉ**, nên chỉ cần **một** đường tunnel.
Không mở cổng router, không cần IP tĩnh.

```
người chơi ──https──▶ Cloudflare ──tunnel──▶ cloudflared (máy Windows) ──▶ http://localhost:8787 (node)
```

## 1. Trên Cloudflare (làm một lần, trên web)

1. https://one.dash.cloudflare.com → **Networks → Tunnels → Create a tunnel** → chọn **Cloudflared** → đặt tên (vd `trai-ga`).
2. Màn hình *Install connector* hiện lệnh có `--token eyJ...` → **copy chuỗi token** (đừng chạy lệnh đó, script lo).
3. Sang tab **Public Hostname → Add a public hostname**:
   - Subdomain: `game` · Domain: `vuducan.qzz.io`
   - Service: **HTTP** · URL: `localhost:8787`
4. Lưu. (Tên miền khác? Sửa `DEFAULT_SERVER` trong `public/apps/chicken-farm/js/game/main.js`.)

## 2. Trên máy Windows

Cần: Git, Windows 10/11 (có `winget`). Node.js 24+ và cloudflared — `setup` sẽ đề nghị cài nếu thiếu.

```bat
git clone <repo> && cd <repo>\server\deploy\windows
setup.cmd            :: kiểm tra Node/cloudflared, tạo server\.env, sinh SERVER_SECRET, hỏi token, chạy test
start.cmd            :: chạy server + tunnel trong cửa sổ này (Ctrl+C để dừng)
check.cmd            :: kiểm tra: server trong máy, số đo, tunnel, địa chỉ công khai
```

Token chỉ nằm trong `server\.env` (đã bị `.gitignore` chặn, **không commit**). Muốn đổi token: sửa dòng
`CLOUDFLARE_TUNNEL_TOKEN=` trong file đó.

### Chạy nền khi bật máy (tuỳ chọn)

Chuột phải **install-service.cmd → Run as administrator**:

- Server → Task Scheduler `TraiGa-Server` (chạy lúc khởi động bằng **tài khoản đã chạy cài đặt**, kiểu S4U không lưu mật khẩu, quyền thường — không dùng SYSTEM; tự khởi động lại nếu chết; log ở `server\logs\`, chưa xoay vòng — xem `server/SECURITY-AUDIT.md`). Nếu đã cài bản cũ chạy bằng SYSTEM: chạy lại `install-service.cmd` để đăng ký lại.
- Tunnel → Windows service `cloudflared` (cách chính thức của Cloudflare).

Gỡ: `powershell -ExecutionPolicy Bypass -File install-service.ps1 -Uninstall`.
Khi đã cài nền thì **không** chạy `start.cmd` nữa (trùng cổng).

## 3. Vận hành

| Việc | Cách |
|---|---|
| Xem số đo (p50/p99, request, người đang xem) | `http://127.0.0.1:8788/metrics` (chỉ mở trong máy) |
| Sao lưu DB khi đang chạy | `cd server` → `npm run backup` (ra `server\backup\`) |
| Kiểm tra nhật ký khớp ảnh chụp | `npm run replay` |
| Cập nhật code | `git pull` → `Stop-ScheduledTask TraiGa-Server; Start-ScheduledTask TraiGa-Server` (hoặc Ctrl+C rồi `start.cmd`) |
| Log | `server\logs\server.log`, `server.err.log`, `tunnel.err.log` |

**Đừng xoá/đổi `SERVER_SECRET`** khi đã có người chơi, và sao lưu `server\.env` cùng `server\data\`.

## Client tự tìm server

`game.html` tự chọn theo thứ tự: `?server=…` (được nhớ lại; `?server=` rỗng = chơi offline) →
trang do chính server phục vụ (vd mở `http://localhost:8787/` hay `https://game.vuducan.qzz.io/`) →
trang tĩnh trên vuducan.qzz.io / github.io **chưa có bản lưu offline** thì thử `https://game.vuducan.qzz.io` →
không có thì chơi offline. Chỉ nhận server trả `game: "trai-ga"` và cùng phiên bản luật.

## Gặp lỗi

- *Server không lên*: xem `server\logs\server.err.log`. Hay gặp: Node < 24, cổng 8787 đang bận (`netstat -ano | findstr 8787`).
- *check báo công khai lỗi nhưng trong máy OK*: Public Hostname chưa trỏ `http://localhost:8787`, hoặc tunnel chưa *HEALTHY* trong dashboard (xem `tunnel.err.log`).
- *PowerShell chặn script*: các file `.cmd` đã dùng `-ExecutionPolicy Bypass`; nếu vẫn bị chặn do tải từ mạng, chuột phải file → Properties → Unblock.
