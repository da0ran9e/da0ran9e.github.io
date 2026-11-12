# Trại Gà server — Kiểm toán bảo mật trước khi mở công khai

**Ngày**: 2026-11-11 · **Phạm vi**: full (mạng, đầu vào, dữ liệu, gian lận, triển khai Windows)
**Môi trường đích**: `https://game.vuducan.qzz.io` → Cloudflare Tunnel → `http://127.0.0.1:8787` (PC Windows)
**Người thực hiện**: security-engineer + network-programmer (đọc mã; test tự động; thử trang thật trong trình duyệt)
**Mã đã đọc**: `server/src/*.mjs` (11 file), `server/deploy/windows/*.ps1|*.cmd`, `.env.example`, client
`public/apps/chicken-farm/{game.html,index.html,js/game/net.js,main.js}` (chỉ đọc).
**Test**: `node --disable-warning=ExperimentalWarning --test server/test/` → 34/34 (thêm 5 test trong `test/security.test.mjs`).

## Tóm tắt

| Mức | Số | Đã sửa | Còn mở |
|---|---|---|---|
| CRITICAL | 0 | – | – |
| HIGH | 2 | 2 | 0 |
| MEDIUM | 5 | 2 | 3 |
| LOW | 8 | 2 | 6 (đa số chấp nhận rủi ro) |

**Khuyến nghị phát hành: CLEAR TO SHIP, có điều kiện** — không còn HIGH/CRITICAL mở, với điều kiện:
(1) chạy lại `install-service.cmd` trên máy Windows (SEC-02); (2) bật một rule rate-limit + HSTS ở
Cloudflare (SEC-04, SEC-14); (3) chủ dự án quyết định SEC-04/SEC-05 trong tuần đầu chạy công khai.

---

## HIGH

### SEC-01 — Dọn rate limit làm reset giới hạn tạo khách · **ĐÃ SỬA**
`src/ratelimit.mjs` `sweep()` xoá mọi thùng rảnh > 10 phút, kể cả thùng chưa nạp lại đầy. Thùng
`ipGuestDay` (20/ngày) và `ipGuest` (5/giờ) vì vậy được làm mới sau 10 phút → một IP tạo được ~5 khách
mỗi 10 phút (~720/ngày) thay vì 20/ngày. **Sửa**: thùng nhớ `cap/perSec`; chỉ xoá thùng đã nạp đầy
(xoá = tạo lại đầy → không đổi hành vi). Test: `security.test.mjs` "sweep() không xoá thùng chưa nạp đầy".

### SEC-02 — Task Scheduler chạy server bằng SYSTEM · **ĐÃ SỬA (cần chạy lại trên Windows)**
`deploy/windows/install-service.ps1` đăng ký `TraiGa-Server` với `-UserId SYSTEM -RunLevel Highest`,
thực thi `node src\main.mjs` + `.env` trong thư mục người dùng ghi được. Hậu quả: (a) bất kỳ phần mềm
nào chạy quyền người dùng sửa được `src\*.mjs` → leo thang lên SYSTEM; (b) tiến trình mở ra Internet mà
bị khai thác thì kẻ tấn công có toàn quyền máy. **Sửa**: principal = tài khoản đang cài, `-LogonType S4U`
(chạy khi chưa đăng nhập, không lưu mật khẩu), `-RunLevel Limited`. Không chạy thử được (máy Mac không có
pwsh) — **chủ dự án chạy lại `install-service.cmd` (Run as administrator) và `check.cmd`** để xác nhận.

## MEDIUM

### SEC-03 — Đổi địa chỉ IPv6 lách được giới hạn theo IP · **ĐÃ SỬA**
Khách có IPv6 thường được cấp cả /64 → mỗi request một địa chỉ mới = thùng mới. **Sửa**:
`ipBucket()` gộp IPv6 theo /64, `::ffff:a.b.c.d` → IPv4 (`src/ratelimit.mjs`, dùng trong `src/app.mjs`).

### SEC-04 — Làm đầy ổ đĩa bằng hành động hợp lệ + log không xoay vòng · **MỞ một phần** (đã làm mục 1)
Mỗi hành động thành công lưu nguyên phản hồi (~1,4 KB với trại mới, lớn dần theo trại) trong
`actions.response` 7 ngày. `release`/`recall` luân phiên luôn hợp lệ; `tokenPost` cho 5/s/token →
~600 MB/ngày/token; `ipAll` 60/s/IP cho phép nhiều token song song (~7 GB/ngày/IP). Thêm vào đó
`logs\server.log` ghi một dòng JSON mỗi request (~150 B) và **không xoay vòng** khi chạy bằng
Task Scheduler/`start.ps1`. Đề nghị (chọn ≥ 2):
1. ~~`responseKeepMs` 7 ngày → 24 giờ~~ — **đã làm** (2026-11-11, `config.mjs`), giảm 7×, không đổi luật.
2. `tokenPost.perSec` 5 → 1–2 (nhịp tim 10 s + thao tác tay không cần 5/s); kiểm lại với `field.js`.
3. Hạn mức ghi/ngày/người chơi (vd. 5 000 hành động), vượt → 429.
4. Xoay log (kích thước) hoặc bỏ log 2xx của static/429 lặp; giám sát dung lượng `data\`.
5. Cloudflare → Security → WAF → Rate limiting rule (gói Free có 1 rule): vd. `/api/` > 30 req/10 s/IP → block 1 phút.

### SEC-05 — Tạo khách hàng loạt làm phình bảng `players` · **MỞ (cần quyết định)**
Sau SEC-01/03 mỗi IP(/64) còn 20 khách/ngày; botnet nhiều IP vẫn tạo được không giới hạn và khách
không bao giờ bị dọn. Mỗi dòng nhỏ (~150 B) nên rủi ro thấp hơn SEC-04. Đề nghị: dọn khách **không có
trại** và `last_seen` > 30 ngày (client đã xử lý 401 bằng cách tạo khách mới — `main.js` dòng ~1220);
cân nhắc trần toàn cục (đổi lại: kẻ tấn công có thể chặn người mới) hoặc Cloudflare Turnstile ở M5.

### SEC-06 — Trang game không có CSP / chống clickjacking · **ĐÃ SỬA**
`src/static.mjs` thêm cho mọi `.html`: `Content-Security-Policy` tính từ chính trang (script chỉ `'self'`
+ băm sha256 của `<script>` nội tuyến + origin mà importmap trỏ tới → `game.html` chỉ `'self'`,
`index.html` thêm băm importmap + `https://cdn.jsdelivr.net`), `object-src 'none'`, `base-uri 'none'`,
`frame-ancestors 'none'`, `X-Frame-Options: DENY`, `COOP: same-origin`, `Permissions-Policy`.
`style-src 'unsafe-inline'` là bắt buộc (mã vẽ SVG dùng `style=` trong innerHTML). `connect-src` để
`https:` + localhost vì client cho chọn máy chủ khác. Đã thử thật: game online + phòng gen (three.js từ
CDN) chạy, không có lỗi CSP trong console. Lưu ý cho đội client: thêm `<script>` nội tuyến thì CSP tự
cập nhật theo băm; thêm CDN khác ngoài importmap thì cần sửa `cspFor()`.

### SEC-07 — `?server=` trên URL đổi máy chủ lâu dài (client) · **MỞ (đội client)**
`js/game/main.js`: `?server=https://x` được lưu vào localStorage. Link độc → người chơi lặng lẽ chơi trên
máy chủ của kẻ tấn công (state giả, phishing). Token **không** lộ (khoá token theo từng base trong
`net.js`). Đề nghị: chỉ nhận `?server=` thuộc danh sách biết trước, hoặc hỏi xác nhận; khi đó có thể
siết `connect-src` về `'self'` + danh sách.

## LOW

| ID | Phát hiện | Trạng thái |
|---|---|---|
| SEC-08 | URL dị dạng (`GET http://[ …`) ném lỗi ngoài `try` → log `handler_crash` kèm stack, không qua rate limit, đóng kết nối. Sửa: 400 `bad_request` (`src/app.mjs`), có test. | ĐÃ SỬA |
| SEC-09 | `CF-Connecting-IP` từ loopback được nhận với chuỗi bất kỳ. Sửa: chỉ nhận khi `isIP()`. Mô hình tin cậy đúng: server nghe 127.0.0.1, chỉ cloudflared (cùng máy) đặt header, Cloudflare ghi đè header của client. Nếu đổi `HOST=0.0.0.0` thì request từ mạng không phải loopback → header bị bỏ qua (không giả mạo được) nhưng có đường vào bỏ qua Cloudflare → `main.mjs` cảnh báo khi khởi động. Cổng quản trị luôn bind 127.0.0.1. | ĐÃ SỬA |
| SEC-10 | Static đi theo symlink trong thư mục client (`stat`/`readFile`). Không có symlink hiện tại. | Chấp nhận — đừng đặt symlink trong `public/apps/chicken-farm/` |
| SEC-11 | Token khách không hết hạn, không có xoay/thu hồi qua API, nằm trong localStorage (XSS → mất token; CSP SEC-06 giảm rủi ro). Cột `status` cho phép khoá tay. | Chấp nhận cho mô hình khách; xem lại ở M5 (tài khoản) |
| SEC-12 | Token Cloudflare Tunnel: `cloudflared service install <token>` lộ trên dòng lệnh lúc cài và nằm trong ImagePath của service (người dùng cục bộ đọc được); `.env` lưu dạng rõ; `setup.ps1 -Token` vào lịch sử PowerShell. | Chấp nhận (cách chính thức của Cloudflare, PC một người dùng); lộ → Rotate token trong Zero Trust |
| SEC-13 | `DEFAULT_ORIGINS` có `http://localhost:*` khi chạy thật. Vô hại vì xác thực bằng Bearer (không cookie → không CSRF). | Đề nghị đặt `ALLOWED_ORIGINS` không có localhost ở máy thật |
| SEC-14 | Origin không gửi HSTS. | Mở — bật ở Cloudflare: SSL/TLS → Edge Certificates → Always Use HTTPS + HSTS |
| SEC-15 | Bot có thể giữ nhịp tim `/api/field/watch` mãi và `fieldFind` đúng nhịp hồi 15 s/gà của luật; "ngân sách ≤ 3 lần/phút/gà" trong thiết kế §5 chưa có ở server. three.js từ CDN không có SRI. | Mở (thiết kế/đội client); bảng `rejects` + `/metrics` để phát hiện |

## Đã kiểm, không có vấn đề

- **Thân request**: ≤ 4 KB (kiểm `Content-Length` trước + đếm khi đọc), 413 + `Connection: close`, chỉ
  `application/json`, phải là object. `requestTimeout`/`headersTimeout` 10 s, keep-alive 5 s (slowloris; sau
  cloudflared thì mọi kết nối đều từ cloudflared).
- **Path traversal** (`static.mjs`): `resolve` + kiểm tiền tố `root + sep`, chặn NUL/`\`, danh sách đuôi cho
  phép → `..`, `%2e%2e`, `%5c`, ADS `::$DATA`, dấu chấm/space cuối, tên 8.3 trên Windows đều rơi ra ngoài. Có test.
- **Token**: 256 bit `randomBytes`, DB chỉ lưu `sha256` (cột UNIQUE), không bao giờ ghi log; log chỉ có
  băm 8 ký tự của playerId. Mọi truy vấn SQL là prepared statement.
- **Lỗi**: 500 trả thông điệp chung; stack chỉ vào log.
- **Idempotency**: `aid` theo từng người chơi, `req_hash = sha256(type + args đã chuẩn hoá)` → dùng lại `aid`
  cho hành động khác → 422; trả bản cũ trước khi nạp/sửa trại.
- **Gian lận**: client chỉ gửi ý định; mọi route hành động sinh từ `Object.keys(V.ARGS)` nên không có hành
  động nào thiếu kiểm tra; `advance`/`newGame` không lộ ra; mảng bị giới hạn + bỏ trùng; `seed` kiểm bằng
  `Object.hasOwn`. Giờ do server cấp (`max(clock, updatedAt)`). Ngẫu nhiên = HMAC(secret, mục đích|người
  chơi|bộ đếm), bộ đếm tiêu cả khi bị từ chối → không "tung lại"; bản xem bỏ `seed`.
- **Replay**: mọi thay đổi state có một dòng `actions` (now + giá trị đã tung) trong cùng transaction với
  ảnh chụp; `tools/replay.mjs` so `state_hash`.

## Phụ thuộc

| Thành phần | Phiên bản | Nguồn | Ghi chú |
|---|---|---|---|
| Node.js (http, sqlite, crypto) | ≥ 24 | nodejs.org / winget | không có npm dependency |
| three.js (chỉ phòng gen `index.html`) | 0.160.0 | cdn.jsdelivr.net | ghim phiên bản, chưa có SRI (SEC-15) |
| cloudflared | mới nhất qua winget | Cloudflare | service chạy LocalSystem (chính thức) |

## Thứ tự xử lý phần còn mở
1. SEC-02 — chạy lại `install-service.cmd` trên Windows (5 phút).
2. SEC-04 — `responseKeepMs` 24 h + rule rate-limit Cloudflare + xoay log (thấp).
3. SEC-14 — bật HSTS/Always HTTPS ở Cloudflare (thấp).
4. SEC-05 — job dọn khách không có trại (thấp–vừa).
5. SEC-07, SEC-15 — đội client/thiết kế.

Kiểm toán lại khi: thêm WebSocket (M3), thêm tài khoản/đổi giữa người chơi (M5), đổi cách triển khai.
