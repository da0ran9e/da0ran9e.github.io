# Trại Gà — server (M2: server có thẩm quyền qua HTTP)

Node 24, **không có phụ thuộc npm** (`node:http`, `node:sqlite`, `node:crypto`, `node:test`).
Luật chơi import nguyên vẹn từ `public/apps/chicken-farm/js/game/rules.js` → client và server luôn
cùng một phiên bản luật trong cùng commit. Thư mục `server/` **không** nằm trong `public/` nên không
bao giờ bị đẩy lên GitHub Pages.

Thiết kế đầy đủ: [`docs/chicken-farm/server-design.md`](../docs/chicken-farm/server-design.md).

```
server/
  src/main.mjs          điểm khởi động (đọc env, nghe cổng, tắt êm)
  src/app.mjs           route HTTP, CORS, rate limit, cổng quản trị
  src/farm-service.mjs  áp hành động (copy-on-write), nhật ký, idempotency, phiên xem
  src/actions.mjs       cầu nối tới rules.js + ngẫu nhiên phía server (HMAC) — dùng chung với replay
  src/store.mjs         lược đồ SQLite (WAL) + câu lệnh
  src/validate.mjs      kiểm tra dữ liệu vào trước khi gọi luật
  src/ratelimit.mjs     token bucket trong bộ nhớ
  src/presence.mjs      "đang quan sát" (nhịp tim; M3 sẽ dùng cho WebSocket)
  src/metrics.mjs       số đo: request, p50/p99 theo route, event loop, ghi DB
  tools/replay.mjs      dựng lại trại từ nhật ký, so với ảnh chụp
  tools/backup.mjs      sao lưu SQLite khi đang chạy
  test/*.test.mjs       test (node:test)
```

## Chạy trên máy

```sh
cd server
npm start                # = node --env-file-if-exists=.env --disable-warning=ExperimentalWarning src/main.mjs
npm test                 # hoặc từ gốc repo: node --test server/test/
```

Mặc định API ở `http://127.0.0.1:8787`, cổng quản trị ở `http://127.0.0.1:8788`. Thử nhanh:

```sh
TOKEN=$(curl -s -X POST localhost:8787/api/guest | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s localhost:8787/api/starters -H "Authorization: Bearer $TOKEN"
curl -s -X POST localhost:8787/api/farm/new -H "Authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -d '{"aid":"a1","choice":0}'
curl -s localhost:8788/metrics
```

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `8787` | cổng API (nghe trên `HOST`) |
| `HOST` | `127.0.0.1` | chỉ cloudflared gọi tới → không mở ra mạng |
| `ADMIN_PORT` | `8788` | cổng quản trị, **luôn** chỉ nghe `127.0.0.1` |
| `DB_PATH` | `data/farm.db` | file SQLite (thư mục tự tạo) |
| `SERVER_SECRET` | ngẫu nhiên mỗi lần chạy | khoá HMAC cho ngẫu nhiên phía server. **Bắt buộc đặt khi chạy thật**: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ALLOWED_ORIGINS` | `https://vuducan.qzz.io,https://da0ran9e.github.io,http://localhost:*` | danh sách origin, phân cách bằng dấu phẩy; `:*` = mọi cổng |
| `BACKUP_DIR` | `backup` | thư mục đích của `tools/backup.mjs` |

## API

Mọi phản hồi là JSON. Token gửi qua header `Authorization: Bearer <token>`. Mọi `POST` hành động
phải có `aid` (id do client sinh, ≤ 40 ký tự `[A-Za-z0-9_-]`); gửi lại cùng `aid` → nhận lại đúng
phản hồi cũ kèm `"replayed": true`, không áp luật lần hai; cùng `aid` nhưng thân khác → 422.
Client **không bao giờ gửi giờ**: server dùng `Date.now()`.

| Phương thức · đường dẫn | Thân | Ghi chú |
|---|---|---|
| `GET /healthz` | — | `{ok, uptime, db, rulesVersion, watchers}` (có cả trên cổng quản trị) |
| `GET /api/hello` | — | `{now, rulesVersion, proto}` — đồng bộ đồng hồ, phát hiện lệch phiên bản luật |
| `POST /api/guest` | `{}` | `{token, playerId}`; giới hạn 5/giờ và 20/ngày mỗi IP |
| `GET /api/starters` | — | 3 trứng khởi đầu (`choice`, `code`, `shell`, `shellName`); 409 `farm_exists` nếu đã có trại |
| `POST /api/farm/new` | `{aid, choice: 0..2}` | `newGame` |
| `GET /api/farm` | — | mô phỏng tới hiện tại trên **bản sao** (không ghi); vắng > 1 giờ thì ghi một hành động hệ thống `advance` |
| `POST /api/field/watch` | `{}` | nhịp tim "đang xem cánh đồng", gửi mỗi ≤ 10 s; trả `watchUntil`, `inField` |
| `POST /api/farm/collectEgg` | `{aid, eggId}` | nhặt trứng ngoài sân vào kho |
| `POST /api/farm/incubate` | `{aid, eggId}` | |
| `POST /api/farm/feed` | `{aid, chickenId, seed}` | |
| `POST /api/farm/release` | `{aid, chickenId}` | mỗi lần 1 con (`field_busy`); thả = một nhịp tim |
| `POST /api/farm/recall` | `{aid, chickenId}` | |
| `POST /api/farm/recallAll` | `{aid}` | client gọi khi rời tab (`fetch(…, {keepalive:true})`), nhưng server không trông vào nó |
| `POST /api/farm/fieldFind` | `{aid, chickenId}` | "gà X tìm được hạt": **loại hạt do server tung**; cần phiên xem còn hạn + cooldown 15 s của luật |
| `POST /api/farm/tradeToShop` | `{aid, eggs?: [], chickens?: []}` | trứng/gà → túi hạt |
| `POST /api/farm/tradeForEgg` | `{aid, chickenId}` | gà → một trứng có phôi ngẫu nhiên (server tung) |
| `POST /api/farm/openBag` | `{aid, bagId}` | nội dung túi do server tung |

Thành công: `{ok:true, aid, now, version, result, events, farm}` — `farm` là state đã bỏ `seed`,
sổ kỷ niệm chỉ 20 mục cuối (`memorialTotal` là tổng). Lỗi: `{ok:false, aid?, code, message, now, version?}`.

| HTTP | Mã |
|---|---|
| 400 | `bad_request` (sai kiểu / thiếu trường / id sai dạng / loại hạt lạ) |
| 401 | `unauthorized` |
| 404 | `no_farm`, `not_found` · 405 `method_not_allowed` |
| 409 | mã của luật (`no_seed`, `full`, `in_field`, `field_busy`, `not_in_field`, `too_fast`, `seeds_full`, `no_egg`, `not_in_yard`, `eggs_full`, `infertile`, `already`, `no_incubator`, `coop_full`, `incubating`, `nothing`, `bags_full`, `no_bag`, `no_chicken`…), `farm_exists`, `not_watching`, `version_conflict` |
| 413 / 415 | thân > 4 KB / không phải `application/json` |
| 422 | `idempotency_mismatch` |
| 429 | `rate_limited` + header `Retry-After` |
| 500 | `internal` (state không đổi nhờ copy-on-write) |

**Cánh đồng ở M2.** Gà chỉ ở ngoài đồng khi chủ đang xem: không có nhịp tim 20 s (đóng tab, mất mạng)
→ server tự gọi `recallAll` (nguồn `system`, `now` = lúc phiên hết hạn) — khi người chơi gọi API tiếp
theo, hoặc do vòng quét mỗi 2 s. Khởi động lại server cũng gọi gà còn ngoài đồng về.

**Giới hạn tốc độ** (token bucket trong bộ nhớ): IP 60 req/s; IP `POST /api/guest` 5/giờ + 20/ngày;
token: POST sức chứa 10 nạp 5/s, GET sức chứa 4 nạp 2/s. IP lấy từ `CF-Connecting-IP` **chỉ khi**
request tới từ `127.0.0.1` (cloudflared cùng máy) và là IP hợp lệ; IPv6 gộp theo `/64`. IP không ghi vào DB hay log.
Trang HTML do server phục vụ có `Content-Security-Policy` (script chỉ `'self'` + băm `<script>` nội tuyến +
origin mà importmap trỏ tới), `frame-ancestors 'none'`, `X-Frame-Options: DENY`. Kiểm toán bảo mật: `SECURITY-AUDIT.md`.

## Cổng quản trị (127.0.0.1:8788, không có trong tunnel)

- `GET /healthz`
- `GET /metrics` — JSON: tổng request, `rejects`, `systemRecalls`, `activeWatchers`, `cachedFarms`,
  p50/p99/max (ms) theo route, thời gian ghi DB, độ trễ event loop, bộ nhớ.

Xem từ xa sau này: thêm hostname riêng sau Cloudflare Access (xem thiết kế §8), **không** đưa cổng này vào ingress công khai.

## Nhật ký hành động & replay

Bảng `actions` chỉ thêm: mỗi thay đổi state có một dòng (`type`, `args`, `rolled` = giá trị server tung,
`now`, `source`, `code`). Hành động bị luật từ chối không đổi state và nằm ở bảng `rejects`.

```sh
npm run replay -- --db data/farm.db            # mọi trại; mã thoát 1 nếu có trại lệch
npm run replay -- --db data/farm.db p_xxxxxxx  # một người chơi
```

Replay không cần `SERVER_SECRET`. Lệch = server đổi state ngoài nhật ký, DB bị sửa tay, hoặc luật
không tất định giữa hai phiên bản. Chạy sau mỗi lần đổi `rules.js` hoặc nâng cấp Node (trên bản sao lưu).
Lưu ý: replay dùng `rules.js` **hiện tại**; nếu luật đã đổi cách tính so với lúc ghi thì trại cũ sẽ lệch
(chưa có checkpoint theo `rules_v` — xem "Còn thiếu").

## Chạy trên Windows như một dịch vụ (NSSM)

1. Cài Node 24 LTS (`C:\Program Files\nodejs`), clone repo vào `C:\srv\da0ran9e.github.io`.
2. Tạo tài khoản Windows quyền thấp `traiga`; thư mục dữ liệu `C:\srv\trai-ga\{data,logs}` chỉ cho `traiga` quyền ghi.
3. Tạo `C:\srv\da0ran9e.github.io\server\.env`:

   ```ini
   PORT=8787
   ADMIN_PORT=8788
   DB_PATH=C:\srv\trai-ga\data\farm.db
   BACKUP_DIR=D:\trai-ga-backup
   SERVER_SECRET=<64 ký tự hex>
   ALLOWED_ORIGINS=https://vuducan.qzz.io,https://da0ran9e.github.io
   ```

4. Cài dịch vụ (PowerShell quản trị):

   ```powershell
   nssm install TraiGa "C:\Program Files\nodejs\node.exe"
   nssm set TraiGa AppParameters "--env-file=.env --disable-warning=ExperimentalWarning src\main.mjs"
   nssm set TraiGa AppDirectory "C:\srv\da0ran9e.github.io\server"
   nssm set TraiGa AppStdout "C:\srv\trai-ga\logs\server.log"
   nssm set TraiGa AppStderr "C:\srv\trai-ga\logs\server.log"
   nssm set TraiGa AppRotateFiles 1
   nssm set TraiGa AppRotateOnline 1
   nssm set TraiGa AppRotateBytes 10485760
   nssm set TraiGa AppStopMethodConsole 15000
   nssm set TraiGa AppExit Default Restart
   nssm set TraiGa AppRestartDelay 5000
   nssm set TraiGa Start SERVICE_DELAYED_AUTO_START
   nssm set TraiGa ObjectName .\traiga <mật-khẩu>
   nssm start TraiGa
   ```

   Server bắt `SIGINT`/`SIGBREAK` (NSSM gửi Ctrl+C): ngừng nhận request → gọi gà về → checkpoint WAL → đóng DB (≤ 10 s).
   Tắt chế độ ngủ của PC; Windows Update khởi động lại thì dịch vụ tự chạy lại.

5. Cập nhật: `git pull` → `node --test tests/chicken-farm/*.test.mjs` và `node --test server/test/` →
   `npm run backup` → `nssm restart TraiGa` → kiểm `https://game.vuducan.qzz.io/healthz`.

## Cloudflare Tunnel cho `game.vuducan.qzz.io`

```powershell
cloudflared tunnel login
cloudflared tunnel create trai-ga
cloudflared tunnel route dns trai-ga game.vuducan.qzz.io
cloudflared service install
```

`C:\Users\traiga\.cloudflared\config.yml` (hoặc thư mục cấu hình của dịch vụ cloudflared):

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: C:\Users\traiga\.cloudflared\<TUNNEL-UUID>.json
ingress:
  - hostname: game.vuducan.qzz.io
    service: http://127.0.0.1:8787
    originRequest:
      connectTimeout: 10s
  - service: http_status:404
```

Chỉ cổng 8787 đi qua tunnel; cổng quản trị 8788 không có trong ingress. Không mở cổng inbound nào trên
router. Bật WebSockets trong mục Network của zone (cần cho M3).

## Sao lưu SQLite

- `npm run backup -- --db C:\srv\trai-ga\data\farm.db --out D:\trai-ga-backup --keep 48` — dùng
  `backup()` của `node:sqlite`, an toàn khi server đang chạy (WAL). Đừng chép tay file `.db` khi đang chạy
  (thiếu phần trong `farm.db-wal`).
- Lập lịch mỗi giờ bằng Task Scheduler (chạy dưới tài khoản `traiga`):

  ```powershell
  schtasks /Create /TN TraiGaBackup /SC HOURLY /RU traiga /RP * /TR ^
    "\"C:\Program Files\nodejs\node.exe\" --disable-warning=ExperimentalWarning C:\srv\da0ran9e.github.io\server\tools\backup.mjs --db C:\srv\trai-ga\data\farm.db --out D:\trai-ga-backup --keep 48"
  ```

- Mỗi ngày chép bản mới nhất sang ổ thứ hai / OneDrive. DB chỉ có băm token, không có IP.
- Mỗi tháng diễn tập khôi phục: `npm run replay -- --db D:\trai-ga-backup\farm-….db`, ghi kết quả.
- Khôi phục: dừng dịch vụ → chép bản sao lưu thành `farm.db` (xoá `farm.db-wal`, `farm.db-shm` cũ) → chạy dịch vụ.

## Hook cần từ đội Lõi luật

`rules.js` không bị sửa từ phía server. Hiện server tự xoay sở như sau:

1. **Ngẫu nhiên tiêm từ ngoài cho `openBag` và `tradeForEgg`.** Hai hàm này tung bằng
   `rngFor(state.seed, …)`; seed trại chỉ 32 bit và vét cạn được từ mã gen trứng khởi đầu. Tạm thời
   `src/actions.mjs` gọi `advance()` trước rồi **thay `state.seed` bằng seed HMAC trong đúng lúc gọi hàm**
   và trả lại ngay sau đó (seed HMAC ghi vào `actions.rolled` để replay). Cách này phụ thuộc chi tiết bên
   trong luật. Đề nghị: `openBag(state, bagId, now, { rng })` và `tradeForEgg(state, chickenId, now, { rng })`
   (mặc định `rngFor(...)` như cũ).
2. **Ngẫu nhiên đẻ / tên gà / chọn bố** vẫn theo `state.seed` → người vét cạn được seed có thể biết trước
   lúc nào gà đẻ, trứng ra gen gì. Đề nghị: một "muối" bí mật tuỳ chọn trong `rngFor` (vd. `state.salt`
   do server giữ, không gửi client), hoặc `advance(state, now, { rngFor })`.
3. `fieldFind` đã nhận loại hạt từ ngoài → đủ dùng (server tung bằng HMAC). Không cần đổi.

## Còn thiếu (đã biết)

- `GET /api/farm` chỉ trả sự kiện kể từ lần ghi cuối (không có `?since=` / "khi bạn vắng mặt…" đầy đủ).
- Chưa có checkpoint theo `rules_v`, bảng `memorial` riêng, phân trang sổ kỷ niệm, mã khôi phục.
- Chưa có gom ghi (M3 cần cho `fieldFind` tần suất cao), chưa có `/stats` HTML, `/metrics` dạng Prometheus.
- Rate limit và phiên xem nằm trong bộ nhớ → mất khi khởi động lại (gà ngoài đồng được gọi về lúc khởi động).
- Dọn `response` > 7 ngày và `rejects` > 30 ngày chạy mỗi giờ trong tiến trình; chưa nén `actions` cũ.
