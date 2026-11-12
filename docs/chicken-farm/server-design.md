# Trại Gà — Thiết kế server (M2 → M3 → M6)

> Bản 0.1 (2026-11-10) · đội Server · dựa trên `production-plan.md` v0.3, `game/rules.js` (có `fieldFind`, `canFieldPeck`) và bản nháp `game/field.js`.
> Phạm vi: M2 (server có thẩm quyền, HTTP), M3 (cánh đồng chung realtime, WebSocket), kế hoạch đo & tối ưu M6. M2 đã có mã trong `server/` — chỗ khác thiết kế ghi ở §10.

## 0. Nguyên tắc

1. **Client chỉ gửi ý định**, server cấp `now = Date.now()` và gọi đúng hàm trong `rules.js` / `field.js` (import nguyên vẹn, không sửa).
2. **Trạng thái trại chỉ đổi qua hành động có trong nhật ký.** Mọi lời gọi hàm luật làm đổi state đều có một dòng `actions` cùng `now` → chạy lại nhật ký ra đúng state (audit).
3. **Sao chép rồi thay (copy-on-write):** mỗi hành động chạy trên `structuredClone(state)`; chỉ khi `ok` mới thay bản trong bộ nhớ. Lý do: `act()` của luật gọi `advance()` *trước* khi kiểm tra, nên hành động bị từ chối vẫn làm state trôi; ngoài ra một ngoại lệ giữa chừng không để lại state hỏng.
4. **Một tiến trình, đồng bộ hoá bằng event loop:** `node:sqlite` là API đồng bộ (`DatabaseSync`) → "đọc → áp luật → ghi" không có `await` ở giữa, không thể mất cập nhật trong một tiến trình.
5. **Chỉ mô phỏng khi có người xem** (cánh đồng không có người xem thì dừng tick).

## 1. Kiến trúc

```
 Trình duyệt — client tĩnh trên GitHub Pages (https://vuducan.qzz.io)
   │  HTTPS fetch JSON + "Authorization: Bearer <token>"        WSS /v1/field (M3)
   ▼
 Cloudflare edge (TLS, chống DDoS cơ bản)  ── game.vuducan.qzz.io (công khai, KHÔNG Access)
   │  Cloudflare Tunnel (cloudflared chạy dạng dịch vụ, chỉ kết nối ra ngoài)
   ▼
 PC Windows ── cloudflared ──► http://127.0.0.1:8787   (không mở cổng inbound)
 ┌──────────────────── node server/src/main.mjs (1 tiến trình, Node 24) ────────────────────┐
 │ http.createServer ─► router /v1/* ─► CORS ─► auth (token) ─► rate limit ─► validate      │
 │        │                                                     │                           │
 │        ▼                                                     ▼                           │
 │  FarmService ── cache trại đang online (Map playerId → state) ◄── FieldManager           │
 │     └─ rules.js (nguyên vẹn)                                   ├─ Field#1..k (field.js)  │
 │        │                                                       ├─ lưới quan tâm (grid)   │
 │        ▼                                                       └─ ws.WebSocketServer     │
 │  Store ── node:sqlite (WAL) ── C:\srv\trai-ga\data\farm.db                               │
 │  Metrics (perf_hooks) ── cổng quản trị 127.0.0.1:8788: /metrics, /stats (không qua tunnel)│
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Bố cục mã (đề xuất):** `server/package.json` (`"type": "module"`, phụ thuộc duy nhất `ws`), `server/src/{main,http,auth,ratelimit,validate,farm-service,store,field-manager,interest,protocol,metrics}.mjs`, `server/schema.sql`, `server/tools/{audit,backup,bots}.mjs`. Import luật bằng đường dẫn tương đối `../../public/apps/chicken-farm/js/game/rules.js` → client và server luôn cùng một phiên bản luật trong cùng commit.

**Tách tiến trình sau này** (chỉ khi số đo cho thấy cần):

| Thứ tách | Khi nào | Cách |
|---|---|---|
| Mô phỏng cánh đồng | tick p99 > 10 ms hoặc event loop delay ảnh hưởng HTTP | `worker_threads`, 1 worker / cánh đồng, gửi sự kiện `found` về luồng chính qua `postMessage` |
| Ghi SQLite | thời gian flush > 5 ms/lần | worker ghi riêng, hàng đợi lệnh |
| HTTP và realtime | khi cần khởi động lại một bên mà không làm rớt bên kia | 2 tiến trình, chung DB (WAL cho phép 1 ghi + nhiều đọc); cột `version` chống ghi chồng |
| Nhiều máy | ngoài phạm vi (không có dịch vụ trả phí) | — |

## 2. Danh tính

- **Tài khoản khách:** `POST /v1/guest` → server tạo `token = base64url(crypto.randomBytes(32))` (43 ký tự) và `playerId = "p_" + 12 ký tự ngẫu nhiên` (công khai). Client lưu token vào `localStorage`. DB chỉ lưu `sha256(token)` → lộ DB không lộ token.
- **Gửi token:** HTTP: header `Authorization: Bearer …` (không dùng cookie → không có CSRF, CORS đơn giản). WebSocket: trình duyệt không đặt được header → token gửi trong **tin nhắn đầu tiên** `hello` (không đặt trên URL để không lọt vào log); quá 5 s chưa `hello` hợp lệ → đóng 4401.
- **Nâng cấp sau (không làm ở M2):** "mã khôi phục" hiển thị một lần (nhập lại trên máy khác để lấy token mới), sau đó passkey. Nâng cấp = gắn thông tin đăng nhập vào cùng hàng `players`, không đổi `playerId`.
- **Rate limit** (token bucket trong bộ nhớ; IP lấy từ `CF-Connecting-IP`, tin được vì server chỉ nghe 127.0.0.1 và chỉ cloudflared gọi tới; IP không ghi vào DB):

| Khoá | Giới hạn | Vượt |
|---|---|---|
| IP · `POST /v1/guest` | 5/giờ, 20/ngày | 429 `rate_limited` + `Retry-After` |
| IP · mọi HTTP | 60 req/s | 429 |
| token · `POST /v1/farm/*` | bucket 10, nạp 5/s | 429 |
| token · `GET /v1/farm` | 2/s | 429 |
| WS · kết nối | 1/token (kết nối mới đá kết nối cũ: `bye{reason:"replaced"}`), 10/IP | đóng 4429 |
| WS · tin client→server | 20/s, ≤ 1 KB/tin (`maxPayload: 1024`) | đóng 1008 |
| Thân HTTP | ≤ 4 KB, chỉ `application/json` | 413 / 415 |

- **CORS:** danh sách cho phép `https://vuducan.qzz.io`, `https://da0ran9e.github.io`, `http://localhost:3000` (dev). Trả `Access-Control-Allow-Origin` = origin khớp (không `*`), `Allow-Headers: authorization, content-type`, `Max-Age: 86400` cho preflight. WebSocket: kiểm tra header `Origin` trong sự kiện `upgrade`, sai → 403 trước khi bắt tay.

## 3. API HTTP/JSON cho trại (M2)

**Khung chung.** Mọi `POST` có `aid` (id hành động do client sinh, ULID/UUID, ≤ 40 ký tự). Thành công:

```json
{ "ok": true, "aid": "01JC…", "now": 1762761600000, "version": 42,
  "result": { "chickenId": "c3", "seed": "protein", "action": "ate" },
  "events": [ { "type": "laid", "at": 1762761540000, "chickenId": "c2", "eggId": "e-c2-…", "fertile": true } ],
  "farm": { "…": "state đã bỏ seed, memorial chỉ 20 mục cuối" } }
```

Lỗi: `{ "ok": false, "aid", "code", "message", "now", "version" }`. `farm` gửi nguyên (≈ 3–6 KB, gzip qua Cloudflare) — đơn giản hơn gửi phần thay đổi, đủ cho M2.

| Phương thức · đường dẫn | Thân | Hàm luật | Ghi chú |
|---|---|---|---|
| `GET /v1/hello` | — | — | không cần token: `{now, rulesVersion: CONFIG.version, sha, proto}` để client đồng bộ đồng hồ và phát hiện lệch phiên bản |
| `POST /v1/guest` | `{}` | — | `{token, playerId}` |
| `GET /v1/starters` | — | `starterEggs(seed)` | chỉ khi chưa có trại; trả `shell`, `shellName`, `code` |
| `POST /v1/farm/new` | `{aid, choice: 0..2}` | `newGame(seed, now, choice)` | `seed` do server sinh lúc tạo khách; `farm_exists` nếu đã có |
| `GET /v1/farm?since=ts` | — | `advance` trên bản sao | trả `farm` + sự kiện từ `since` ("khi bạn vắng mặt…"); nếu lần ghi cuối > 1 giờ trước → ghi một hành động hệ thống `advance` (giữ chi phí tính lười có giới hạn) |
| `POST /v1/farm/feed` | `{aid, chickenId, seed}` | `feed` | |
| `POST /v1/farm/release` | `{aid, chickenId}` | `release` | M2: cần phiên xem còn hạn; M3: chỉ qua WS (HTTP trả `use_ws`) |
| `POST /v1/farm/recall` | `{aid, chickenId}` | `recall` | |
| `POST /v1/farm/recall-all` | `{aid}` | `recallAll` | client gọi `fetch(…, {keepalive:true})` khi ẩn tab; không trông cậy vào nó (xem phiên xem) |
| `POST /v1/farm/watch` | `{}` | — | M2: nhịp tim mỗi 10 s, gia hạn "đang xem" tới `now+30 s` |
| `POST /v1/farm/field-find` | `{aid, chickenId}` | `fieldFind(state, id, kind, now)` | **chỉ M2**; `kind` do server tung (§5); bỏ ở M3 |
| `POST /v1/farm/incubate` | `{aid, eggId}` | `incubate` | |
| `POST /v1/farm/trade` | `{aid, eggs: [≤12], chickens: [≤6]}` | `tradeToShop` | |
| `POST /v1/farm/open-bag` | `{aid, bagId}` | `openBag` | kết quả ngẫu nhiên chỉ có từ server |
| `GET /v1/farm/memorial?before=ts` | — | — | phân trang 50 |

**Mã lỗi.** Dùng lại nguyên mã của `rules.js` → **HTTP 409**: `no_seed, no_chicken, in_field, full, not_in_field, too_fast, seeds_full, no_egg, infertile, already, no_incubator, coop_full, incubating, nothing, bags_full, no_bag` (`bad_seed` bị chặn sớm ở bước kiểm tra kiểu → 400). Mã của server:

| Mã | HTTP | Nghĩa |
|---|---|---|
| `bad_request` | 400 | sai kiểu / thiếu trường / id sai dạng |
| `unauthorized` | 401 | thiếu hoặc sai token |
| `no_farm` / `farm_exists` | 404 / 409 | chưa tạo / đã có trại |
| `not_watching` | 409 | thả đồng / tìm hạt khi phiên xem đã hết |
| `use_ws` | 409 | từ M3, thả đồng phải qua WebSocket |
| `idempotency_mismatch` | 422 | dùng lại `aid` với thân khác |
| `rate_limited` | 429 | kèm `Retry-After` |
| `server_busy` / `internal` | 503 / 500 | quá tải / lỗi (đã ghi log, state không đổi nhờ copy-on-write) |

**Idempotency.** `(player_id, aid)` là khoá duy nhất trong `actions`. Gửi lại cùng `aid` → trả lại đúng `response` đã lưu (HTTP 200, thêm `"replayed": true`), không áp luật lần hai. Băm thân yêu cầu khác → 422. Hành động bị luật từ chối không giữ `aid` (không đổi gì nên chạy lại vô hại). Client thử lại khi mất mạng với *cùng* `aid` (lùi 1 s, 2 s, 4 s).

**Hướng dẫn UI lạc quan (cho đội Client).**
- Đồng hồ: `offset = serverNow − (tGửi + tNhận)/2`, lấy trung vị 5 lần đo; mọi tính toán cục bộ dùng `Date.now() + offset`.
- Hành động tất định (feed, release, recall, incubate, trade): chạy `rules.js` trên **bản sao** cục bộ, hiện kết quả ngay, đánh dấu "đang gửi"; khi có phản hồi **thay toàn bộ** bằng `farm` của server (không trộn). Lỗi → quay về state server + hiện `message` của server.
- Không đoán trước kết quả ngẫu nhiên (mở túi, đẻ, nở ra gà gì): client không có `seed` (§5) → hiện hoạt ảnh chờ tới khi có phản hồi.
- Thanh no/dinh dưỡng giữa hai lần gọi: nội suy cục bộ bằng `advance` trên bản sao, rồi `GET /v1/farm` mỗi 60 s (M3: server đẩy `farm` qua WS).
- Gửi tuần tự theo hàng đợi (một hành động đang bay mỗi lúc) → thứ tự trên server = thứ tự người chơi bấm.

## 4. Lưu trữ (node:sqlite)

```sql
PRAGMA journal_mode = WAL;  PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;   PRAGMA busy_timeout = 5000;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;   -- schema_version

CREATE TABLE players (
  id TEXT PRIMARY KEY,                 -- 'p_…' công khai
  token_hash BLOB NOT NULL UNIQUE,     -- sha256(token)
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- active | banned | deleted
  upgraded TEXT                        -- NULL = khách
) STRICT;

CREATE TABLE farms (                   -- ẢNH CHỤP; nguồn sự thật là actions
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  seed INTEGER NOT NULL,               -- = state.seed, bí mật (không gửi client)
  rules_v INTEGER NOT NULL,            -- CONFIG.version lúc ghi
  state TEXT NOT NULL,                 -- JSON đầy đủ
  version INTEGER NOT NULL,            -- seq của hành động cuối đã áp
  updated_at INTEGER NOT NULL,
  state_hash TEXT NOT NULL             -- sha256(state), so khi audit
) STRICT;

CREATE TABLE actions (                 -- chỉ thêm, không sửa
  player_id TEXT NOT NULL REFERENCES players(id),
  seq INTEGER NOT NULL,                -- 1,2,3… theo người chơi
  aid TEXT,                            -- NULL với field / system
  type TEXT NOT NULL,                  -- newGame|advance|feed|release|recall|recallAll|fieldFind|incubate|tradeToShop|openBag
  args TEXT NOT NULL,                  -- JSON đã chuẩn hoá, gồm cả kind do server/field quyết định
  now INTEGER NOT NULL, source TEXT NOT NULL,   -- http|ws|field|system
  response TEXT,                       -- cho idempotency; xoá sau 7 ngày
  PRIMARY KEY (player_id, seq)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX actions_aid ON actions(player_id, aid) WHERE aid IS NOT NULL;

CREATE TABLE rejects (player_id TEXT NOT NULL, at INTEGER NOT NULL, type TEXT NOT NULL,
  code TEXT NOT NULL, source TEXT NOT NULL) STRICT;            -- tín hiệu gian lận, giữ 30 ngày

CREATE TABLE checkpoints (player_id TEXT NOT NULL, seq INTEGER NOT NULL, rules_v INTEGER NOT NULL,
  state TEXT NOT NULL, state_hash TEXT NOT NULL, PRIMARY KEY (player_id, seq)) STRICT;

CREATE TABLE memorial (                -- chỉ mục từ sự kiện "died"; state.memorial vẫn là bản gốc
  player_id TEXT NOT NULL REFERENCES players(id), chicken_id TEXT NOT NULL,
  name TEXT NOT NULL, code TEXT NOT NULL, hatched_at INTEGER NOT NULL, died_at INTEGER NOT NULL,
  starved_ms INTEGER NOT NULL, dev TEXT NOT NULL, PRIMARY KEY (player_id, chicken_id)) STRICT;
```

**Chiến lược ghi**

| Loại | Khi nào ghi | Bền vững |
|---|---|---|
| Hành động HTTP (feed, trade, open-bag…) | ngay, trong `BEGIN IMMEDIATE … COMMIT`: thêm `actions` + cập nhật `farms` (`WHERE version = ?`, lệch → 409 `version_conflict`, chỉ xảy ra khi đã tách tiến trình) **trước khi trả lời** | commit xong mới báo `ok` |
| `fieldFind` từ cánh đồng (M3, tới ~70/s) | gom: dòng `actions` flush mỗi 500 ms trong một transaction; ảnh chụp `farms` của người chơi đó ghi mỗi 30 s, khi `recallAll`, khi ngắt kết nối, hoặc khi có hành động HTTP | mất điện mất tối đa ~0,5 s lượt mổ, state và nhật ký mất **cùng nhau** |
| Khôi phục khi nạp | `state = farms.state`, áp tiếp các `actions` có `seq > farms.version` (tất định vì có `now` và `kind`) | — |
| Checkpoint | mỗi 500 hành động và mỗi khi `rules_v` đổi | để audit không phải chạy từ đầu và qua được đổi phiên bản luật |
| Dọn dẹp (hằng đêm) | xoá `response` > 7 ngày, `rejects` > 30 ngày; nén `actions` cũ hơn checkpoint > 30 ngày | — |

- WAL + `synchronous=NORMAL`: không hỏng khi tiến trình chết; khi mất điện có thể mất vài transaction cuối. Ở M5 (đổi giữa người chơi) cân nhắc `FULL` cho giao dịch.
- Ước lượng: một người chơi chăm (6 gà, 2 giờ xem/ngày) ≈ 3.000 dòng/ngày × ~150 B ≈ 0,45 MB/ngày → vì vậy cần nén ở trên.
- Chạy với `--disable-warning=ExperimentalWarning` (Node 24.4 vẫn đánh dấu `node:sqlite` là thử nghiệm).

**Sao lưu trên Windows**
- Mỗi giờ server tự chạy `VACUUM INTO 'D:\trai-ga-backup\farm-YYYYMMDD-HH.db'` (ảnh chụp nhất quán khi đang chạy; hoặc `sqlite.backup()` có sẵn trong Node 24). Giữ 48 bản theo giờ + 30 bản theo ngày.
- Bản ngày chép sang ổ thứ hai / thư mục OneDrive (miễn phí). DB chỉ chứa băm token, không có IP.
- Mỗi tháng diễn tập khôi phục: mở bản sao lưu, chạy `tools/audit.mjs --all`, ghi kết quả.

## 5. Chống gian lận

| Mối đe doạ | Biện pháp |
|---|---|
| Sửa state / gửi kết quả | Client chỉ gửi ý định; state chỉ nằm trên server |
| Dữ liệu vào lạ (luật tin kiểu dữ liệu) | Kiểm tra trước khi gọi luật: id khớp `^[a-z0-9-]{1,48}$`; `seed` là `Object.hasOwn(SEEDS, x)`; `choice` là số nguyên 0..2 (`newGame` với 1.5 sẽ hỏng); mảng ≤ 12 phần tử, chuỗi ≤ 48 ký tự |
| Gian lận thời gian | `now = max(Date.now(), farm.updatedAt)` — chỉ đồng hồ server; chống đồng hồ Windows lùi (NTP) bằng `max` và cảnh báo khi lùi > 1 s |
| Tự chọn hạt ngoài đồng (M2) | Client chỉ báo "gà X tìm được hạt"; **server tung `kind`** bằng `HMAC-SHA256(SERVER_SECRET, playerId|chickenId|⌊now/15 s⌋)` → `rollSeed("field", mulberry32(…))`; giới hạn 1 hạt / 15 s / gà của luật + phải còn phiên xem + ngân sách ≤ 3 lần/phút/gà (hiệu chỉnh theo số đo từ `field.js`) |
| Tìm hạt ngoài đồng (M3) | Client **không** gửi gì về việc mổ; chỉ `field.js` trên server sinh sự kiện `found`; `fieldFind` kiểm tra lại cooldown/vị trí |
| Thả gà khi không xem | M2: `release`/`field-find` cần phiên `watch` còn hạn; hết hạn → server tự `recallAll` (nguồn `system`, `now` = lúc hết hạn). M3: gà chỉ ở ngoài đồng khi có kết nối WS đang hiển thị |
| Đoán trước ngẫu nhiên | Không gửi `state.seed` cho client. Lưu ý: seed chỉ 32 bit và `hash32` là FNV-32 nên **không thể coi là bí mật mật mã** (vét cạn 2³² từ mã gen trứng khởi đầu là khả thi) → không dựa vào bí mật của seed; mọi ngẫu nhiên mà người chơi có thể "căn giờ" (ngoài đồng) dùng HMAC với bí mật server |
| Nhiều tài khoản khách cày túi hạt | M2 chấp nhận (không có gì để rút ra); M5 đổi chác: chỉ cho tài khoản đã nâng cấp / đủ tuổi (câu hỏi mở) |
| Spam / DoS | rate limit §2; Cloudflare chặn lớp mạng; `rejects` tăng đột biến → cảnh báo |

**Vì sao ngẫu nhiên gắn khoá giúp audit.** Mọi lần tung xúc xắc của luật là `rngFor(seed, khoá…)` không phụ thuộc thứ tự gọi, và mọi giá trị ngoài luật (thời điểm `now`, `kind` của field) đã nằm trong `args`. Vì vậy `tools/audit.mjs <playerId>` làm: lấy checkpoint (hoặc `newGame(seed, createdAt, choice)`) → áp lần lượt `actions` bằng đúng `rules.js` → so `sha256` với `farms.state_hash`. Lệch nghĩa là: lỗi server (quên ghi nhật ký, sửa state ngoài luật), DB bị sửa tay, hoặc luật không tất định giữa hai phiên bản Node/V8. Chạy hằng đêm cho 1% người chơi ngẫu nhiên + toàn bộ sau mỗi lần nâng cấp Node hoặc đổi `rules.js`. Cánh đồng (M3) không tái lập được (phụ thuộc mọi người chơi), nhưng `kind` đã ghi nên phần trại vẫn audit đầy đủ.

**Đề nghị gửi đội Lõi luật** (không sửa `rules.js` từ phía server):
1. `advance()` chưa hoàn toàn "chia nhỏ bất biến": gà được mô phỏng lần lượt từng con, nên khi kho trứng gần đầy (12) thì gọi `advance(t2)` một lần khác với `advance(t1)` rồi `advance(t2)`. Server đã né bằng nguyên tắc 2 (state chỉ đổi qua hành động có ghi), nhưng nên mô phỏng tất cả gà theo từng phút để luật bất biến.
2. Túi hạt dùng `rngFor("bag", bag.id)` mà `bag.id` lấy từ `seq` → người biết seed có thể đổi thứ tự hành động để chọn túi tốt. Đề xuất khoá theo id món được đổi (trứng/gà).
3. Thêm `public/apps/chicken-farm/package.json` `{"type":"module"}` để Node khỏi cảnh báo `MODULE_TYPELESS_PACKAGE_JSON` và khỏi phân tích lại mỗi lần nạp.
4. `state.memorial` lớn dần vô hạn trong JSON; cân nhắc giới hạn (server đã có bảng `memorial`).

## 6. M3 — Cánh đồng chung realtime

**Ghép `field.js` với server**
- Id gà trong luật chỉ duy nhất **trong một trại** (`c1`, `c2`… ở mọi người chơi) → server cấp **eid** số nguyên u16 duy nhất trong cánh đồng, `addChicken(field, {id: eid, speed, sight, x, y})`; bảng `eid → {playerId, chickenId}`. `speed/sight` từ `fieldTraits(express(decodeGenome(code)))`, lưu đệm theo gà.
- Khi thả: `release` (ghi nhật ký) → `addChicken` gần camera của chủ → `setReadyAt(f, eid, f.t + max(0, ch.lastFieldEat + 15 s − now))` để cooldown nối liền thời gian thực.
- Sự kiện `found` → `fieldFind(stateCủaChủ, chickenId, kind, now)` trên bản sao; từ chối (`too_fast`, `seeds_full`) → `rejects` + `setReadyAt` theo luật; hạt đã mất khỏi đồng (chấp nhận).
- **Đối soát sau mỗi hành động của người chơi**: gà không còn tồn tại hoặc `location !== "field"` (chết, bị đổi ở cửa hàng — `tradeToShop` không kiểm tra vị trí) → `removeChicken`.
- `field.js` có giờ riêng `f.t`; luật dùng `Date.now()`. Server gọi `tickField(f, 100)` đúng bước cố định.

**Phòng / shard.** Một **cánh đồng** = một instance `field.js` + tối đa **200 người xem / ~1.200 gà** (200 × chuồng 6). Người mới vào cánh đồng **đông nhất còn chỗ** (cho cánh đồng có không khí), hết chỗ thì tạo mới. Seed của cánh đồng lấy từ `crypto.randomInt`. Cánh đồng không có người xem → **dừng tick** ngay (không có gà nào vì chủ đều đã đi), huỷ sau 5 phút.
Kích thước: một màn hình là 800×480 (`FIELD`); cánh đồng chung đề xuất **4000×2400** (5×5 màn hình) để quản lý vùng nhìn có ý nghĩa. Cần đội Lõi luật cho `createField` nhận `spawnPerSec`/`maxSeeds` **theo diện tích hoặc theo số gà** (hiện là hằng số cho cả cánh đồng: 0,7 hạt/s chia cho 1.000 gà là quá ít, lệch hẳn bảng cân bằng "~1,5 giờ"). Phương án dự phòng không cần sửa `field.js`: mỗi "ô" 800×480 là một instance riêng, cánh đồng = 25 ô.

**Nhịp.** Mô phỏng **10 Hz** (bước 100 ms), gửi **5 Hz** (mỗi 2 tick). Bộ hẹn giờ tự bù trôi: `next = t0 + k·100 ms`, `setTimeout(next − performance.now())` (bộ hẹn giờ Windows mặc định ~15,6 ms nên `setInterval` trôi); chậm thì chạy bù tối đa 3 bước, hơn nữa thì bỏ và đếm `tick_overrun`. Client nội suy, hiển thị trễ ~250 ms.

**Giao thức** (JSON ở M3, nhị phân ở M6; mọi tin có `t`; số toạ độ làm tròn về số nguyên px):

| Chiều | Tin | Nội dung |
|---|---|---|
| C→S | `hello` | `{t, token, proto:1, view:{x,y,w,h}}` — bắt buộc trong 5 s đầu |
| C→S | `view` | `{t, x,y,w,h}` khi kéo/thu phóng, ≤ 5/s |
| C→S | `release` / `recall` | `{t, aid, chickenId}` → ghi nhật ký nguồn `ws` |
| C→S | `away` / `back` | tab ẩn / hiện lại (`visibilitychange`) — `away` = `recallAll` |
| C→S | `ping` | `{t, c}` đo RTT tầng ứng dụng (ngoài ping/pong của `ws`) |
| S→C | `welcome` | `{t, fieldId, tick, now, w, h, rulesVersion, farm}` |
| S→C | `snap` | `{t, tick, ch:[[eid,x,y,dir,mode]], sd:[[sid,x,y,kind]], meta:[[eid,owner,code]]}` — khi vào, khi nhảy camera, khi đồng bộ lại |
| S→C | `d` (delta) | `{t, tick, add:[…], upd:[[eid,x,y,dir,mode]], rem:[eid], sAdd:[…], sRem:[sid]}` |
| S→C | `found` | chỉ gửi chủ gà: `{t, chickenId, kind, action:"ate"|"stored"}`; người khác chỉ thấy hạt biến mất + gà ở mode `peck` |
| S→C | `farm` | trại của chính mình sau mỗi `fieldFind`/hành động, tối đa 1 lần/giây (gộp) |
| S→C | `err` | `{t, aid, code, message}` — mã như §3 |
| S→C | `bye` | `{t, reason: "restart"|"replaced"|"idle"|"slow", retryMs}` rồi đóng |

- `mode` mã hoá số: `rest 0, wander 1, seek 2, peck 3`. `meta` (tên chủ + mã gen ~135 ký tự để vẽ) gửi **một lần** khi gà vào vùng nhìn; client lưu đệm theo eid.
- Mất kết nối / `away` / không trả `pong` trong 30 s (server ping mỗi 15 s; cũng giữ kết nối qua giới hạn rảnh ~100 s của Cloudflare) → `recallAll` (nguồn `system`) → `removeChicken` mọi gà của người đó → flush nhật ký + ảnh chụp. Không có thời gian ân hạn ở bản đầu (theo Q4); client nhớ gà nào đang ngoài đồng (`sessionStorage`) và tự gửi lại `release` sau khi kết nối lại (lùi 1–30 s có jitter).
- Server tắt/khởi động lại: gửi `bye{reason:"restart"}`, `recallAll` tất cả, flush, đóng DB.

**Quản lý vùng nhìn (interest management).** Lưới đều ô 400×240 (nửa màn hình) → 10×10 ô. Mỗi tick gửi: cập nhật chỉ số ô của gà đã di chuyển. Mỗi client đăng ký các ô giao với viewport + viền 1 ô; giữ `known: Map<eid, lastSent>`. Gửi: thực thể mới trong ô đăng ký → `add`; đổi (dịch ≥ 1 px, đổi `dir`/`mode`) → `upd`; ra khỏi vùng / bị xoá → `rem`. Hạt chỉ có `sAdd`/`sRem` (không di chuyển).

**Ngân sách kích thước** (giả định ~40 gà trong vùng nhìn mỗi người, 200 người xem):

| Cách gửi | B/người/s | Tổng ra (200 người) |
|---|---|---|
| Ngây thơ: snapshot cả cánh đồng JSON, 5 Hz | 1.200 gà × ~40 B × 5 ≈ 240 KB/s | ~48 MB/s ≈ 380 Mbit/s — **không chạy nổi** |
| Vùng nhìn + delta JSON | 40 × ~18 B × 5 ≈ 3,6 KB/s | ~0,7 MB/s ≈ 6 Mbit/s |
| Vùng nhìn + delta nhị phân (8 B/gà) | ≈ 1,6 KB/s | ~2,6 Mbit/s |
| Gửi quỹ đạo (chỉ khi gà đổi hướng/mode) | ≈ 0,3–0,6 KB/s | < 1 Mbit/s |

Mục tiêu M3: trung bình ≤ 4 KB/s/người, tin `d` ≤ 2 KB, `snap` ≤ 16 KB. Băng thông **tải lên** của mạng nhà là giới hạn thật (câu hỏi mở).

**Back-pressure.** Trước mỗi lần gửi kiểm `ws.bufferedAmount`: > 64 KB → bỏ qua delta lần này, đánh dấu `needResync`; khi xuống < 16 KB → gửi `snap` vùng nhìn (delta bị bỏ không được dồn lại). > 1 MB hoặc `needResync` kéo dài > 10 s → `bye{reason:"slow"}` và đóng. Không bao giờ xếp hàng vô hạn. Tắt `perMessageDeflate` lúc đầu (tốn CPU mỗi kết nối; đo ở M6).

## 7. Kiểm thử tải

**Bot** (`server/tools/bots.mjs`, chạy trên **máy khác** hoặc ít nhất tiến trình khác để không nhiễu số đo): tạo khách qua HTTP → tạo trại sẵn gà trưởng thành qua `POST /v1/dev/seed-farm` (chỉ bật khi `LOADTEST=1` và chỉ từ 127.0.0.1) → mở WS, `hello`, thả 5–6 gà, kéo camera ngẫu nhiên mỗi 5–20 s, đo byte nhận, độ trễ tin (`tick` server so với giờ nhận), RTT.

| Kịch bản | Mô tả | Đạt khi |
|---|---|---|
| S1 tăng dần | 0 → 200 người xem trong 10 phút | không lỗi, bộ nhớ tăng tuyến tính |
| S2 ổn định (chuẩn) | 200 người xem / 1.000+ gà, 30 phút | **tick p99 < 10 ms**, ≤ 4 KB/s/người, event loop delay p99 < 20 ms |
| S3 xáo trộn | 20 vào/ra mỗi giây | không rò gà ma (đếm gà trong đồng = gà `location:"field"`) |
| S4 khách chậm | 10% bot đọc chậm | bị `bye slow`, người khác không bị ảnh hưởng |
| S5 bão HTTP | 100 hành động/s song song với S2 | tick p99 vẫn < 10 ms; HTTP p99 < 50 ms |

**Số đo** (thu bằng `perf_hooks.createHistogram`, `monitorEventLoopDelay`, `PerformanceObserver('gc')`, `process.cpuUsage/memoryUsage`):
tick tách thành `sim_ms` (tickField) / `rules_ms` (fieldFind) / `encode_ms` / `send_ms` — p50, p99, max; `tick_overrun`; byte ra/s mỗi client (trung bình, p99) và tổng; tin/s; `bufferedAmount` lớn nhất; CPU %; RSS, heap used; số lần và tổng thời gian GC (minor/major); event loop delay p99; `db_flush_ms` và số dòng/lần; HTTP p50/p99 theo route; số `found`/s và `rejects`/s.
Mỗi lần chạy lưu báo cáo `docs/chicken-farm/perf/YYYY-MM-DD-<tên>.md` (commit, cấu hình máy, kịch bản, bảng số).

**Lộ trình tối ưu M6** — mỗi bước: chạy S2 3 lần × 10 phút trước và sau, báo trung vị; chỉ giữ bước nào cải thiện được số đo đã nêu.

| # | Tối ưu | Số đo chính trước/sau |
|---|---|---|
| 0 | Bản cơ sở cố ý ngây thơ: snapshot cả cánh đồng JSON cho mọi người | tất cả (làm mốc) |
| 1 | Vùng nhìn theo lưới | B/s/người, `encode_ms` |
| 2 | Delta thay snapshot | B/s/người |
| 3 | Lưới không gian trong `nearestSeed` (hiện quét mọi hạt: O(gà × hạt)) — đề nghị đội Lõi luật | `sim_ms` p99 |
| 4 | Giảm cấp phát trong `field.js` (bỏ `[...map.values()]`, mảng kiểu SoA) | số lần GC, tick max |
| 5 | Giao thức nhị phân (`DataView`, toạ độ u16) | B/s, `encode_ms` |
| 6 | Mã hoá một lần mỗi ô, dùng chung buffer cho mọi client xem ô đó | `encode_ms` khi đông |
| 7 | Gửi quỹ đạo thay vị trí | B/s/người |
| 8 | `perMessageDeflate` bật/tắt | B/s so với CPU |
| 9 | Mô phỏng trong `worker_threads` | event loop delay, HTTP p99 khi S5 |
| 10 | Tinh chỉnh gom ghi SQLite / worker ghi | `db_flush_ms`, tick max khi S5 |

## 8. Vận hành

- **Thư mục:** mã ở bản clone repo (vd. `C:\srv\da0ran9e.github.io`), dữ liệu ngoài repo: `C:\srv\trai-ga\{data,logs}`, sao lưu ở ổ D:. Chạy bằng tài khoản Windows riêng quyền thấp (`traiga`), chỉ có quyền ghi thư mục dữ liệu/log.
- **`.env`:** `PORT=8787`, `ADMIN_PORT=8788`, `DB_PATH`, `BACKUP_DIR`, `ALLOWED_ORIGINS`, `SERVER_SECRET` (32 byte hex, HMAC + seed cánh đồng), `LOADTEST=0`.
- **Dịch vụ Windows (NSSM;** WinSW là lựa chọn thay thế còn được bảo trì):

```powershell
nssm install TraiGa "C:\Program Files\nodejs\node.exe"
nssm set TraiGa AppParameters "--env-file=.env --disable-warning=ExperimentalWarning src\main.mjs"
nssm set TraiGa AppDirectory "C:\srv\da0ran9e.github.io\server"
nssm set TraiGa AppStdout "C:\srv\trai-ga\logs\server.log"
nssm set TraiGa AppStderr "C:\srv\trai-ga\logs\server.log"
nssm set TraiGa AppRotateFiles 1
nssm set TraiGa AppRotateOnline 1
nssm set TraiGa AppRotateBytes 10485760
nssm set TraiGa AppStopMethodConsole 15000      # Ctrl+C → server tự dọn trong ≤ 10 s
nssm set TraiGa AppExit Default Restart
nssm set TraiGa AppRestartDelay 5000
nssm set TraiGa Start SERVICE_DELAYED_AUTO_START
nssm set TraiGa ObjectName .\traiga <mật-khẩu-do-chủ-nhập>
```

  Server bắt `SIGINT` (và `SIGBREAK` trên Windows): ngừng nhận kết nối → `bye` → `recallAll` mọi người → flush → `wal_checkpoint(TRUNCATE)` → đóng DB → thoát. Tắt chế độ ngủ của PC; Windows Update khởi động lại → dịch vụ tự chạy lại.
- **Log:** JSON mỗi dòng ra stdout: `ts, level, route, player` (8 ký tự đầu của sha256(playerId)), `ms, status, code`. Không bao giờ ghi token, thân yêu cầu, IP đầy đủ. Giữ 14 ngày.
- **Sức khoẻ & chỉ số:** `GET /healthz` (công khai): `{ok, uptime, db:"ok", fields, viewers, rulesVersion, sha}`. Cổng quản trị `127.0.0.1:8788` (không có trong ingress của tunnel): `/metrics` (định dạng Prometheus text), `/stats` (trang HTML tự làm mới, đọc `/metrics.json`), `/admin/audit?player=`. Muốn xem từ xa: thêm hostname riêng `ops.vuducan.qzz.io` **sau Cloudflare Access** (miễn phí ≤ 50 người).
- **Cloudflare Tunnel** (`C:\Users\traiga\.cloudflared\config.yml`; WebSocket được chuyển tiếp sẵn, nhớ bật WebSockets trong mục Network của zone):

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

- **Triển khai / cập nhật:**
  1. `git pull` (client trên Pages và server dùng chung commit → chung `rules.js`).
  2. `cd server && npm ci` (chỉ `ws`).
  3. `node --test tests/chicken-farm/*.test.mjs` và test server.
  4. `node server/tools/backup.mjs` (sao lưu ngay trước khi đổi).
  5. `nssm restart TraiGa` — migration chạy khi khởi động theo `meta.schema_version`, chỉ tiến; nếu `CONFIG.version` đổi thì ghi checkpoint mới cho người chơi khi nạp lần đầu.
  6. Kiểm `https://game.vuducan.qzz.io/healthz` và `/stats`.
  7. Lùi bản: checkout tag trước + khôi phục bản sao lưu bước 4 nếu migration đã chạy.
  - Lệch phiên bản client/server: client so `rulesVersion` trong `welcome`/`hello`; khác thì yêu cầu tải lại trang. Đẩy client (Pages) và khởi động lại server gần nhau.

## 9. Câu hỏi mở cho producer

| # | Câu hỏi | Đề xuất đang dùng |
|---|---|---|
| SV1 | Mất `localStorage` = mất trại. Chấp nhận ở M2? | Chấp nhận; thêm "mã khôi phục" ngay sau M2 |
| SV2 | "Đang quan sát" nghĩa là gì: kết nối + tab hiện, hay gà của mình phải nằm trong khung nhìn? Có thời gian ân hạn khi rớt mạng ngắn? | Kết nối + tab hiện; không ân hạn, client tự thả lại |
| SV3 | M2 (trước khi có cánh đồng server): cho thả đồng online với "client báo, server tung hạt", hay tắt cánh đồng online tới M3? | Cho phép, có giới hạn tốc độ (§5) |
| SV4 | Mật độ gà / nguồn hạt trên cánh đồng chung: mỗi màn hình bao nhiêu gà, hạt mọc theo diện tích hay theo số gà? (ảnh hưởng thẳng bảng cân bằng) | ~40 gà/màn hình, hạt mọc theo số gà — cần đội Thiết kế chốt |
| SV5 | Tốc độ tải lên của mạng nhà, PC có chạy 24/7, chấp nhận bảo trì lúc nào? | Cần số thật để chốt mục tiêu băng thông |
| SV6 | Người chơi tự chọn cánh đồng (chơi cùng bạn) hay tự động ghép? | Tự động ở M3, mã mời ở sau |
| SV7 | Trại "kẹt" (không còn gà, không trứng có phôi): cho chơi lại từ đầu? Giữ sổ kỷ niệm? | Cho `newGame` lại, giữ `memorial` |
| SV8 | Giữ dữ liệu khách không hoạt động bao lâu? | Xoá trại sau 90 ngày không vào, giữ sổ kỷ niệm |
| SV9 | M5 đổi giữa người chơi: có bắt buộc tài khoản đã nâng cấp / đủ tuổi để chống cày bằng nhiều tài khoản khách? | Có: đã nâng cấp + tài khoản ≥ 3 ngày |

## 10. Triển khai M2 — chỗ khác với thiết kế (2026-11-10)

Mã: `server/` (xem `server/README.md`). Những điểm dưới đây thay cho các mục tương ứng ở trên.

| Mục | Thiết kế | Đã làm | Lý do |
|---|---|---|---|
| Tiền tố đường dẫn | `/v1/*`, kebab-case (`recall-all`, `field-find`, `trade`, `open-bag`) | `/api/*`, tên trùng hàm luật: `/api/farm/{collectEgg, incubate, feed, release, recall, recallAll, fieldFind, tradeToShop, tradeForEgg, openBag}` | theo yêu cầu sprint; ánh xạ 1-1 với `rules.js` |
| Nhịp tim | `POST /v1/farm/watch`, hạn 30 s | `POST /api/field/watch` mỗi ≤ 10 s, hạn **20 s**; `release` cũng tính là một nhịp tim (không cần gọi watch trước) | theo yêu cầu sprint |
| Phụ thuộc | `ws` | không có phụ thuộc npm nào (M3 sẽ cần quyết định: `ws` hay tự viết bắt tay WebSocket) | M2 chỉ HTTP |
| Ngẫu nhiên ngoài đồng | HMAC(playerId, chickenId, ⌊now/15 s⌋) | HMAC(`SERVER_SECRET`, mục đích · playerId · bộ đếm), bộ đếm `farms.rolls` tăng sau **mỗi** lần tung (kể cả khi luật từ chối) | mỗi giá trị chỉ dùng một lần, không căn giờ được |
| Túi hạt / trứng cửa hàng | ghi nhận là lỗ hổng | server tung seed HMAC và tạm thay `state.seed` đúng lúc gọi `openBag` / `tradeForEgg` (sau khi đã `advance`) | chạy được ngay; vẫn cần hook `{rng}` từ đội Lõi luật (README) |
| Lược đồ | `seed` trong `farms`; `actions.response` | `seed` trong `players` (cần trước khi có trại, cho `/starters`); `actions` thêm `rolled`, `code`, `req_hash`; `farms` thêm `rolls`; chưa có `checkpoints`, `memorial` | M2 tối giản; replay đọc `rolled`, không cần bí mật |
| Hành động hệ thống | `advance` khi vắng > 1 giờ | như thiết kế + `recallAll` nguồn `system` khi phiên xem hết hạn (lúc có request kế tiếp, vòng quét 2 s, hoặc lúc khởi động) | |
| `/healthz` | công khai | công khai **và** trên cổng quản trị; số đo ở `127.0.0.1:ADMIN_PORT/metrics` dạng JSON (chưa có Prometheus, `/stats`) | |
| Rate limit GET | 2/s | sức chứa 4, nạp 2/s | cho phép vài lần đọc dồn khi mở trang |
| Kiểm tra mảng `tradeToShop` | `eggs ≤ 12, chickens ≤ 6` | `eggs ≤ 12, chickens ≤ 12` (luật tự chặn theo chuồng) | |
