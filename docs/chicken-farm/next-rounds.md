# Trại Gà — đặc tả các đợt tiếp theo (viết 2026-11-16)

> Mục đích: phần **thiết kế** đã chốt ở đây, để một phiên làm việc sau (kể cả model nhỏ hơn) chỉ còn việc cài đặt.
> Mỗi mục ghi: luật (hàm, trường trong `state`, số trong `CONFIG`), việc phía server, giao diện, và test phải có.
> **Bốn phần khó (tháp hạt theo sự có mặt, minigame chống gian lận, kinh tế vé, bạn bè) có thiết kế chi tiết ở [design-hard-parts.md](design-hard-parts.md) — khi hai tài liệu khác nhau, tài liệu đó đúng.**
> Quy ước bắt buộc của dự án:
> - Luật viết trong `public/apps/chicken-farm/js/game/rules.js`, thuần logic, nhận `now`, ngẫu nhiên qua `rngFor(state, …)` hoặc `opts.rng` (server truyền).
> - Hành động mới phải thêm ở 4 chỗ: `rules.js` (hàm) · `main.js` (`OFFLINE`) · `server/src/actions.mjs` (`ACTIONS`, và `SEEDED` nếu có ngẫu nhiên) · `server/src/validate.mjs` (`ARGS`).
> - Trường mới trong `state` phải được bổ sung cho bản lưu cũ trong `ensure()`; tăng `CONFIG.version`.
> - Mỗi lần phát hành tăng cùng một số `v=` trong `game.html` (css, importmap, main.js).
> - Test: `node --test tests/chicken-farm/*.test.mjs` và `node --test server/test/`. Test mới phải thấy đỏ một lần (phá luật tạm) rồi mới tin.

## Trạng thái luật v7 (2026-11-16) — ĐỌC TRƯỚC

> **Cập nhật 16/11 (tối): giao diện v7 đã có bản đầu** trong `main.js` (các khối "v7: …"): ô vé, tháp hạt (hộp đổ hạt, nhãn mức hạt, cho ăn riêng qua Kho), thanh thể lực, nút "Gõ!" ở ổ ấp, rương theo giờ, thẻ "lấy vé" ở chợ, gian hàng + hộp thoại cho cả 7 loại khách, sân chơi với **một** trò "đúng nhịp" dùng chung cho mọi tuổi.
> Đã xem trên trình duyệt (offline): tháp hạt, rương theo giờ, gian hàng lúc vắng khách, một lượt sân chơi trọn vẹn. **Chưa xem:** hộp thoại khi có khách thật (7 kiểu), gõ trứng, gà mái ấp giúp, bản online, màn hình dọc.
> Còn thiếu so với cột "Còn lại" bên dưới: bốn trò chơi riêng theo tuổi (hiện một trò đổi tốc độ), trứng vào sân chơi (chưa có cách kéo trứng đang ấp), hình 4 món trang trí của nghệ nhân, con đường trước cổng, gà hết sức đi chậm ngoài đồng, chữ v7 chưa qua `i18n.js`.

Phần **luật và server** của ba cơ chế khó đã cài và có test cốt lõi; phần **giao diện chưa có** (người chơi chưa thấy gì mới):

| Cơ chế | Luật (`rules.js`) | Server | Test | Còn lại (việc giao diện, dễ) |
|---|---|---|---|---|
| Tháp hạt theo sự có mặt (H1) | `fillTower`, `takeFromTower`, `bestSeedFor`, `advance(…, { watchFrom, continuous })` | `FarmService.seen()`, `rolled.w` | `tests/chicken-farm/v7-tower.test.mjs`, T13 trong `server/test/v6.test.mjs` | Vẽ tháp tại `SPOTS.feeder`, hộp đổ hạt, bỏ khay kéo-thả, cho ăn riêng qua Kho; test T4, T6, T10, T12, T14, T15 |
| Vé (H3, phần luật) | `state.tickets`, `tradeToShop(…, { want: "tickets" })` có trần ngày | `tradeToShop` nhận `want` | `v7-play.test.mjs` | Ô vé trên thanh tài nguyên; thẻ "lấy vé" trong hộp chợ; `giveReward({ ticket })` cho rương; mô phỏng cân bằng (H3) |
| Thể lực (ideas 12) | `staminaOf`, `staminaMaxOf`, hồi/tiêu trong `stepChicken`, `ch.fitness` | — | `v7-play.test.mjs` | Thanh thể lực trong bảng gà; gà hết sức đi chậm ngoài đồng (chưa cài: hiện chỉ trừ thể lực) |
| Sân chơi (H2) | `startPlay`, `endPlay` (kẹp điểm, cửa sổ thời gian, trần vé ngày) | `startPlay`, `endPlay` + kiểm tra kiểu `score` | `v7-play.test.mjs` | Điểm thả "Sân chơi", `view = "play"`, bốn module trò chơi, màn kết quả; test P6, P11, P13, P14, P15 |

| Khách qua đường (ideas 15) | `visitorsOfDay`, `visitorView`, `buy`, `barter`, `deliver`, `candle`, `haggle`, `matchesOrder`; bảng hàng và giá trong `VISIT_CONFIG` | 5 hành động + `clientView` kèm `visitor`; **mã gen trứng chưa nở không còn gửi về client** (thay bằng `incubateMin`, `known`); giá sàn mặc cả không bao giờ gửi | `tests/chicken-farm/v7-visitors.test.mjs` | Con đường + gian hàng + 7 hình nhân vật; bảng hàng cho từng kiểu tương tác (mua, đổi, giao gà, soi trứng, mặc cả, ba giỏ); hình 4 món trang trí của nghệ nhân (`state.decorOwned`: bench, well, birdhouse, windchime) — chưa vẽ; test còn thiếu ghi ở đầu tệp test; **chưa kiểm tra trên trình duyệt rằng client online vẫn chạy khi trứng không còn `code`** |

| Gà mái ấp giúp, gõ trứng, rương theo giờ (đợt B2–B4) | `brood()` trong `stepChicken`, `knockEgg`, `claim("timed")`, `questView().timed`, `giveReward({ ticket })` | `knockEgg`, `claim` nhận `timed` | `tests/chicken-farm/v7-brood-knock-timed.test.mjs` | Vẽ gà mái ngồi trong ổ (sự kiện `brood`, `ch.broodEgg`); ổ ấp qua mốc 85% hiện "Gõ!" và gọi `knockEgg` thay `warmEgg`; đồng hồ rương trên thẻ nhiệm vụ; việc trong ngày "Gõ nở 1 quả" (bộ đếm `knock` đã có) |

Khác với thiết kế H2 ban đầu: giới hạn "2 lượt mỗi giờ" đã được **thay bằng thể lực** (35 mỗi lượt) cho gà, và "tối đa 2 lượt mỗi quả" cho trứng.
Chưa làm gì: mô phỏng cân bằng cho kinh tế vé (H3), bạn bè (chủ dự án: làm chơi đơn trước).

## Đã xong ở đợt A (2026-11-16)

Toàn màn hình không cuộn (`.view` co theo khung, `.hud` nổi trên cảnh); gà to hơn; nhãn điểm thả chỉ hiện khi rê chuột/kéo; đàn gà thành hàng ảnh nhỏ bên trái; bảng thông tin gà nổi góc phải; nhật ký và cách chơi thành hộp thoại; gà lần lượt đi ra từ chuồng khi vào game; chợ dạng thẻ hình; lớp đa ngôn ngữ `js/game/i18n.js` + nút đổi ngôn ngữ.

## i18n — việc còn lại (việc lặp, không cần thiết kế thêm)

Hiện mới có khoá cho menu, tên hạt, lời nhiệm vụ. `READY = ["vi"]` nên mặc định vẫn là tiếng Việt; `?lang=en` để xem thử.

1. Trong `main.js`, thay từng chuỗi tiếng Việt bằng `t("nhóm.khoá", { biến })`; thêm khoá vào `DICT.vi` (giữ nguyên câu gốc) và `DICT.en`.
   Nhóm khoá: `menu.* hint.* toast.* info.* store.* dex.* reveal.* field.* trade.* quest.* time.*`.
2. Tên dữ liệu của luật lấy theo id, không sửa `rules.js`: `tname("dex", key, d.name)`, `tname("breed", key, b.name)`, `tname("nutrient", key, …)`.
3. Lỗi của luật: thay `toast(result.message)` bằng `toast(errText(result))`, thêm `err.<code>` cho mọi mã trong `rules.js` (tìm `err("`).
4. `game.html`: thêm `data-i18n` / `data-i18n-title` / `data-i18n-aria` cho chữ tĩnh.
5. `fmtDur` / `fmtEta`: chuyển sang khoá `time.*` (tiếng Anh: "5 min", "2 h 10 min", "3 days").
6. Khi `grep -nP "[À-ỹ]" js/game/main.js` chỉ còn chú thích: đổi `READY = ["en", "vi"]` → tiếng Anh thành mặc định.

Test: một test node đọc `i18n.js`, khẳng định `DICT.en` và `DICT.vi` có **cùng bộ khoá** và cùng tập biến `{…}` trong từng khoá.

---

## Đợt B — cho ăn tự động, gà ấp giúp, gõ trứng, rương theo giờ

### B1. Tháp hạt (thay việc kéo gà vào máng)

- `state.tower = { common: 0, protein: 0, … }` (cùng khoá với `inventory`), `CONFIG.tower = { cap: 40, eatBelow: 0.5 }`.
- `fillTower(state, seed, n, now)`: chuyển `n` hạt từ kho vào tháp, không vượt `cap` (tính tổng). Lỗi: `no_seed`, `tower_full`.
- Trong `stepChicken` (đầu bước, trước khi trừ độ no): gà ở **chuồng**, `satiety < eatBelow × satietyMax`, tháp còn hạt → ăn **một** hạt.
  Chọn hạt: loại bù nhiều nhất cho chất đang thiếu (cùng công thức `score` của `autoFeed` trong `main.js` — chuyển hàm đó vào `rules.js` thành `bestSeedFor(ch, counts)`), hoà điểm thì hạt thường; không bao giờ tự ăn hạt lạ.
  Thứ tự gà ăn theo `id` để tái lập được. Đếm vào `count.feed`.
- **Chỉ ăn khi người chơi đang mở game** (chủ dự án chốt 16/11): tháp nuôi gà lúc người chơi ở màn khác (cánh đồng, sân chơi, kho…); người chơi **vắng mặt thì gà coi như bị nhốt trong chuồng, không ăn được** — bỏ bê vẫn bị phạt như cũ, cân bằng hiện tại không đổi.
  Cách cài (tính lười nên phải suy ra "có mặt" theo từng bước): `advance(state, now, { present })` đã có `state.seenAt` và `CONFIG.hatchPresenceGraceMs` (2 phút). Truyền xuống `stepChicken` một cờ `watched` = bước mô phỏng `t` nằm trong khoảng `[seenTrước, now]` **và** `present` **và** `now − seenTrước ≤ hatchPresenceGraceMs` (tức hai lần gọi liên tiếp của một người đang mở game; client offline gọi mỗi 0,5 giây, client online đồng bộ mỗi 4 giây). Vắng lâu rồi quay lại thì cả khoảng vắng đó `watched = false`.
  Lưu ý: `seenTrước` phải lấy **trước** khi `advance` gán `state.seenAt = now`. Hành động nguồn `system` của server (`present: false`) không bao giờ cho ăn.
- Trần 40 hạt là chốt chặn phụ. Vì không ăn lúc vắng mặt nên không cần chỉnh `satietyDrainPerHour`; vẫn chạy lại `balance-sim` (bot phải đổ tháp ở mỗi phiên) để xác nhận.
- Giao diện: điểm "Máng ăn" trong sân thành tháp, vẽ mức hạt; chạm → hộp thoại chọn loại và số lượng. Bỏ `ZONES.feeder.accepts = ["chicken"]`.
- Cho ăn riêng: trong Kho, chạm một loại hạt → chọn gà (lưới ảnh gà) → gọi `feed()` có sẵn. Bỏ khay hạt kéo-thả ở `.hud` (thay bằng ô hiện mức tháp).
- Test: **vắng mặt 3 giờ rồi quay lại → tháp còn nguyên, gà đói như cũ**; mở game liên tục (gọi `advance` mỗi 30 giây) → gà ăn; hành động `present: false` không cho ăn; gà đói tự ăn đúng một hạt mỗi bước; không ăn khi ngoài đồng; chọn đúng hạt bù chất thiếu; tháp rỗng thì không ăn; cùng seed → cùng kết quả; không ăn hạt lạ.

### B2. Gà mái no vào ổ ấp giúp

- `CONFIG.brood = { satiety: 0.75, chancePerHour: 0.5, minutes: 20, speed: 2 }`.
- Trong `stepChicken`: gà **mái trưởng thành**, ở chuồng, `satiety ≥ 0.75 × max`, có trứng đang ấp chưa có gà ấp (`egg.broodBy == null`) → với xác suất `dt / (1 giờ / chancePerHour)` theo `rngFor(state, "brood", ch.id, t)`: đặt `egg.broodBy = ch.id`, `egg.broodUntil = t + 20 phút`, `ch.broodUntil` tương tự.
- Trong lúc được ấp, mỗi phút trôi kéo `hatchAt` sớm thêm `(speed − 1)` phút (không sớm hơn `now`). Hết giờ hoặc gà đói/ra đồng/bị đổi thì thôi.
- Gà đang ấp không đẻ trứng. Sự kiện `brood` (bắt đầu) để client vẽ gà ngồi trong ổ (`pose: "sit"` tại vị trí ổ).
- Test: chỉ mái lớn no bụng; mỗi quả một gà; rút ngắn đúng `(speed−1) × phút`; thả gà ra đồng thì dừng.

### B3. Gõ cho trứng nở sớm

- `CONFIG.knock = { fromPct: 0.85, autoAfterMs: 0 }`. Thay vì nở đúng `hatchAt`: từ mốc 85% tiến độ, người chơi được `knockEgg(state, eggId, now)` → nở ngay (`hatch()` tại `now`). Không gõ thì tự nở ở `hatchAt` như hiện nay.
- Lỗi: `too_early` trước mốc 85%. Đếm `count.knock` (thêm vào `COUNTERS`, việc trong ngày "Gõ nở 1 quả").
- Client: ổ ấp qua mốc 85% thì rung mạnh và hiện nhãn "Gõ!"; chạm ổ lúc này gọi `knockEgg` thay cho `warmEgg`. Màn nở trứng (`REVEAL.hatch`) giữ nguyên.
- Giữ `warmEgg`: sưởi trước mốc 85%, gõ sau mốc đó.

### B4. Rương theo giờ

- `CONFIG.timed = [{ after: 5 * MIN, bag: 2 }, { after: 15 * MIN, bag: 3 }, { after: 1 * HOUR, bag: 4 }, { after: 4 * HOUR, bag: 5, table: "gift" }, { after: 12 * HOUR, bag: 6, table: "gift" }, { after: 24 * HOUR, bag: 8, table: "gift", ticket: 1 }]`.
- `state.timed = { step: 0, readyAt: now + 5 phút }`. `claim(state, "timed", now)`: nếu `now ≥ readyAt` → `giveReward`, `step = min(step + 1, cuối)`, `readyAt = now + CONFIG.timed[step].after`. Mỗi ngày mới (`rollDaily`) đưa `step` về 0.
- Đồng hồ **chỉ chạy tiếp sau khi nhận** (không tích nhiều rương khi vắng) → khuyến khích quay lại chứ không phạt.
- `questView` trả thêm `timed: { readyAt, reward, step }`; thẻ nhiệm vụ ở `.hud` hiện đồng hồ đếm ngược.
- Server: `validate.mjs` cho `id` thêm giá trị `timed`. Test: chưa tới giờ → `not_done`; thứ tự phần thưởng; sang ngày về bậc đầu.

---

## Đợt C — vé, thương nhân, khu vui chơi

### C1. Vé (vật phẩm tiêu hao chung)

- **Chủ dự án chốt 16/11: vé chỉ dùng trong game, không trao đổi giữa người chơi.** `state.tickets` (số nguyên ≥ 0), trần `CONFIG.tickets.cap = 99`.
- Nguồn vé: thắng minigame (+1, tối đa `CONFIG.tickets.winPerDay = 6` vé/ngày), rương 24 giờ (+1), rương ngày khi chuỗi ≥ 3 (+1), đổi ở chợ: **gà trưởng thành → 2 vé**, **trứng có phôi → 1 vé** (lựa chọn thứ ba trên thẻ chợ: `tradeToShop(state, give, now, { want: "tickets" })`).
- Nơi tiêu: vào minigame (1 vé), mua ở thương nhân.
- `giveReward` nhận thêm `{ ticket: n }`. Thanh tài nguyên thêm ô vé.
- Lưu ý pháp lý đã nêu với chủ dự án: không bao giờ bán vé bằng tiền thật, không cho chuyển vé giữa tài khoản.

### C2. Con đường và gian hàng trước cổng

- Chỉ là hình: thêm dải đường đất chạy ngang phía ngoài hàng rào phải trong `yardBackdrop` (hoặc lớp `#yard-road` vẽ đè), dời quầy chợ (`SPOTS.market`) ra cạnh đường, gần cổng: `{ x: 700, y: 400, r: 58 }`; hòm thư (đợt E) đặt ở trụ cổng.
- Kiểm tra lại vùng thả không chồng nhau (`zoneAt`): cổng `(762, 208)`, chợ mới, ổ ấp `(700, 104)`.

### C3. Thương nhân bí ẩn

- Tới theo lịch **tất định theo ngày**, không lưu riêng: `merchantVisit(seed, day)` → `{ from, until, stock }` với `rngFor`: mỗi ngày 2 lượt ghé, mỗi lượt 30 phút, giờ ghé rơi trong 8:00–22:00 giờ Việt Nam. **Ghé cả với trại mới** (chủ dự án chốt 16/11): không khoá theo ngày tuổi của trại; thứ giữ đồ hiếm khỏi tay người mới là **giá**.
- Hàng (3 món mỗi lượt, mỗi món mua một lần), **giá cao so với thu nhập vé** — người mới kiếm khoảng 1–3 vé/ngày (trần thắng minigame 6 vé/ngày, mỗi lượt chơi tốn 1 vé), nên món hiếm phải dành dụm nhiều ngày:
  hạt quý ×3 (4 vé) · hạt lạ ×2 (6 vé) · túi quà 8 hạt (5 vé) · **trứng mang một đặc điểm hiếm định sẵn** (15 vé với đặc điểm thường gặp; 25 vé với lông tơ, bắn tóe, năm ngón, cụt đuôi; đặc điểm lấy từ `DEX`, ưu tiên mục người chơi chưa có ★) · vé (đổi 1 gà trưởng thành lấy 3 vé).
  Giá nằm trong `CONFIG.merchant.prices` để chỉnh sau khi đo: mục tiêu là người chơi đều đặn mua được **một món hiếm mỗi 5–7 ngày**.
- `buyFromMerchant(state, slot, now, opts)`: kiểm tra đang trong giờ ghé, món chưa mua (`state.merchant = { day, visit, bought: [] }`), đủ vé, đủ chỗ chứa. Trứng: `randomGenome` rồi ép alen của đặc điểm (dùng `opts.rng`).
- Client: thương nhân đứng ở gian hàng bên đường khi đang ghé; chạm → bảng 3 thẻ hàng. Ngoài giờ: gian hàng trống, rê chuột hiện "lượt ghé tiếp theo sau …".
- Server: `SEEDED` thêm `buyFromMerchant`. Test: lịch tái lập theo (seed, ngày); trại mới vẫn thấy thương nhân nhưng không đủ vé thì `no_ticket`; hết giờ không mua được; không mua hai lần; trứng mang đúng đặc điểm.

### C4. Khu vui chơi (minigame theo tuổi)

Nguyên tắc: minigame **chạy ở client**, luật chỉ nhận kết quả và giới hạn phần thưởng — không tin điểm số do client gửi quá một trần cố định.

- `startPlay(state, id, now)` (`id` là gà hoặc trứng đang ấp): trừ 1 vé, đặt `state.play = { id, kind, at: now }`. `kind` theo tuổi: trứng đang ấp → `"roll"`; gà con → `"hop"`; gà giò → `"dash"`; trưởng thành → `"peck"`.
- `endPlay(state, score01, now)`: `score01` bị kẹp về `[0, 1]`; phải gọi trong `[10 s, 120 s]` sau `startPlay` (ngoài khoảng → coi như 0). Hiệu ứng:
  - gà: `growth += CONFIG.play.growth × score01` (đề xuất 8 điểm lớn, tức 8% đường tới trưởng thành), `satiety −= CONFIG.play.hunger` (đề xuất 60); gà trưởng thành thì thay bằng `lifeUsed −= 30 phút × score01` (khoẻ hơn);
  - trứng: `hatchAt −= 15% × incubateMs × score01`;
  - `score01 ≥ 0.6` là **thắng**: +1 vé (trong trần mỗi ngày), đếm `count.play`.
- Mỗi con tối đa `CONFIG.play.perChickenPerHour = 2` lượt/giờ (chống cày lớn nhanh).
- Bốn trò (mỗi trò một module nhỏ `js/game/play/<kind>.js`, xuất `run(host, chicken) → Promise<score01>`, 30–45 giây, điều khiển bằng một nút chạm):
  - `roll` (trứng): nghiêng giữ quả trứng lăn trên rãnh không rơi;
  - `hop` (gà con): chạm đúng nhịp để nhảy qua vũng nước;
  - `dash` (gà giò): chạy đua, chạm liên tục, tránh rào;
  - `peck` (trưởng thành): mổ đúng hạt tốt, tránh sỏi.
- Điểm thả mới trong sân: "Sân chơi" (`SPOTS.play`, đề xuất `{ x: 520, y: 400, r: 55 }`), nhận gà và trứng. Thả vào → chuyển `view = "play"`.
- Test luật: không vé thì `no_ticket`; kẹp điểm; quá giờ; trần lượt mỗi giờ; trần vé mỗi ngày; trứng rút đúng thời gian.

---

## Đợt D — cánh đồng làm hình nền treo máy

Chỉ phía client, không đụng luật.

- Vẽ lại `fieldBackdrop` thành cảnh nhiều lớp có chiều sâu: trời (gradient theo `data-sky`), núi xa, hàng cây, đồng cỏ gần; mây trôi chậm, cỏ đung đưa (CSS trên nhóm SVG), mặt trời/trăng theo giờ thật, thỉnh thoảng có chim bay qua.
- Thời tiết nhẹ theo `(sceneSeed, giờ)`: nắng / gió (lá bay) / mưa bụi; ban đêm đom đóm và sao.
- Chế độ treo máy: 20 giây không chạm thì ẩn `.field-head`, `.field-roster`; chạm lại thì hiện. Nút toàn màn hình (`requestFullscreen`).
- Giữ nhẹ: chỉ animation `transform`/`opacity`, không lọc `filter` trên lớp lớn; tôn trọng `prefers-reduced-motion`.
- Nhớ: mở nhiều gà cùng lúc trên đồng là việc của mốc M3 (cánh đồng chung), không làm ở đây.

---

## Đợt E — hòm thư, bạn bè, trò chuyện

Cần quyết định trước khi làm: hiện chỉ có **tài khoản khách** (token trong trình duyệt, mất là mất trại — SEC-11). Bạn bè và tin nhắn cần danh tính bền hơn.

- Bước 1 (đủ dùng, an toàn): **mã bạn bè** 8 ký tự sinh từ id người chơi; thêm bạn bằng mã, hai bên cùng chấp nhận. Bảng `friends(player_id, friend_id, state, at)`.
- Bước 2: **tin nhắn mẫu** (chọn trong ~20 câu có sẵn + biểu cảm), không nhập chữ tự do → không cần kiểm duyệt, hợp với trẻ em. Bảng `mail(id, from_id, to_id, template, at, read_at)`; mỗi người gửi ≤ 20 tin/ngày.
- Bước 3 (chỉ khi chủ dự án muốn): chữ tự do → phải có báo cáo vi phạm, chặn người dùng, lọc từ, giới hạn tuổi. Không làm trước khi có tài khoản thật.
- Thăm trại bạn: `GET /api/farm/of/<mã>` trả `clientView` chỉ đọc (không có kho, không có nhiệm vụ).
- Giao diện: hòm thư ở trụ cổng, có chấm đỏ khi có thư; bảng hai tab Bạn bè / Thư.
- Bảo mật: mọi API mới đi qua `ratelimit.mjs`; mã bạn bè không lộ id nội bộ; xem lại `SECURITY-AUDIT.md` SEC-05 (dọn khách) vì bạn bè trỏ tới tài khoản có thể bị dọn.

---

## Đợt F — âm thanh và đoạn mở đầu (ý tưởng của chủ dự án 16/11)

### F1. Nhạc nền

Hiện chỉ có hiệu ứng tổng hợp bằng WebAudio trong `js/game/fx.js` (không có tệp âm thanh). Hai hướng, **chọn một trước khi làm**:

- **(a) Nhạc tự sinh bằng WebAudio** — không cần tệp, không lo bản quyền, nhẹ. Thiết kế:
  - `js/game/music.js`, dùng chung `AudioContext` và nút tắt tiếng của `fx.js` (xuất thêm `audio()` và `master` từ `fx.js`; nhạc đi qua một `GainNode` riêng âm lượng ~0,12 để không át hiệu ứng).
  - Bộ lập lịch: `setInterval` 100 ms, xếp trước các nốt trong 300 ms tới theo `ctx.currentTime` (kiểu "lookahead scheduler") — không dùng `setTimeout` cho từng nốt vì trình duyệt bóp timer khi tab ẩn.
  - Chất nhạc: thang ngũ cung (đô–rê–mi–sol–la) cho hợp không khí đồng quê Việt; 3 lớp: đệm hợp âm rải chậm (sóng `triangle`), giai điệu sinh ngẫu nhiên có trọng số (ưu tiên bước liền bậc, câu 4 ô nhịp, lặp lại câu trước với biến tấu), trầm (`sine`) mỗi ô một nốt. Nhịp 72–84.
  - Ba "cảnh": sân trại (vui, có giai điệu), cánh đồng (thưa, chậm hơn — nhạc treo máy), đêm (bỏ giai điệu, thêm tiếng dế bằng nhiễu lọc thông dải). Chuyển cảnh bằng cách đổi tham số ở đầu câu kế tiếp, không cắt ngang.
  - Tắt khi `document.hidden`; tôn trọng nút loa; thêm nút riêng "nhạc" (tắt nhạc nhưng giữ hiệu ứng), lưu `trai-ga-music`.
- **(b) Tệp nhạc** (`.ogg` + `.mp3`, lặp vô tận): hay hơn nhưng cần nguồn nhạc có giấy phép rõ ràng (tự sáng tác, CC0, hoặc mua). Nếu chọn: 2 bản ~90 giây (trại, đồng), tải lười sau lần chạm đầu, tổng ≤ 1,5 MB; CSP của server cần thêm `media-src 'self'`.

Khuyến nghị: làm (a) trước — không phụ thuộc gì bên ngoài; thay bằng (b) khi chủ dự án có bản nhạc ưng ý.

### F2. Hiệu ứng âm thanh còn thiếu

Đã có (`SFX` trong `fx.js`): chạm, sưởi, nứt vỏ, chiếp, cục tác, mổ, bật hạt, hạt quý, nhận thưởng, nở, kèn mốc, lấp lánh, mở túi, lớn lên, buồn, lỗi.

Còn thiếu — thêm vào `SFX` theo đúng kiểu các mục đang có (mỗi mục vài dòng `tone` / `noise`), rồi gọi `sfx("tên")` ở chỗ ghi bên cạnh:

| Tên | Khi nào | Gợi ý tổng hợp |
|---|---|---|
| `open` / `close` | mở, đóng hộp thoại (`showModal`, sự kiện `close`) | hai nốt ngắn đi lên / đi xuống |
| `drop` | thả gà/trứng vào điểm thả thành công (`flashZone`) | tiếng "bụp" trầm 120→80 Hz |
| `crow` | gà trống trưởng thành, và lúc bình minh (`data-sky` chuyển sang `dawn`) | răng cưa 3 nốt lên rồi kéo dài tụt xuống |
| `step` | gà chạy tới đốm sáng (`setLure`) | nhiễu lọc thấp, 3 nhịp nhanh |
| `gate` | vào / rời cánh đồng (`showField`, `showYard`) | kẹt cửa: răng cưa trượt chậm 200→260 Hz |
| `night` | nền ban đêm: dế kêu (lặp, rất nhỏ) | nhiễu thông dải 4 kHz, bật tắt 8 lần/giây |
| `ticket` | nhận vé (đợt C) | chuông đôi cao hơn `coin` |
| `merchant` | thương nhân tới (đợt C) | chuông leng keng 4 nốt |

Việc đơn giản, model nhỏ làm được: chỉ cần giữ tổng âm lượng mỗi hiệu ứng ≤ 0,3 và độ dài ≤ 0,6 giây.

### F3. Đoạn kể chuyện mở đầu (lần đầu vào game)

Chủ dự án định có một đoạn hình ảnh ngắn kể chuyện. **Nội dung câu chuyện do chủ dự án viết**; dưới đây là khung kỹ thuật và một bản nháp để thay.

- Chiếu **trước** hộp chọn trứng (`showStarter`), chỉ khi chưa có trại; có nút "Bỏ qua" ngay từ khung đầu; xem lại được trong hộp Cách chơi. Không lưu gì lên server (cờ `trai-ga-intro` trong trình duyệt).
- Dùng lại màn toàn màn hình `#reveal` (`rvShow` / `rvWait` trong `main.js`): mỗi khung là một lần `rvShow` với hình SVG + 1–2 câu + nút "Tiếp". 4–5 khung, tổng dưới 30 giây.
- Hình: vẽ bằng các hàm sẵn có (`yardBackdrop`, `renderEggFlat`, `renderChickenFlat` với bộ gen cố định, `chestSvg`) ghép trong một `<svg>` — không cần hình mới ngoài một nhân vật "người để lại quả trứng" nếu câu chuyện cần.
- Chữ đi qua `t("intro.1")…` (đã có lớp đa ngôn ngữ), mỗi khung một tiếng `sfx` hợp cảnh; nhạc nền bắt đầu ở khung cuối.
- Bản nháp nội dung (thay tuỳ ý): (1) trại gà cũ bỏ hoang, cỏ mọc đầy sân → (2) trong ổ rơm còn sót ba quả trứng, mỗi quả một màu vỏ → (3) một lá thư: "Mỗi quả mang một dòng giống khác nhau. Hãy chọn một quả, sưởi ấm nó…" → (4) "…và dựng lại trại gà." → chuyển sang hộp chọn trứng.

### Thứ tự đề nghị cho các đợt còn lại

1. Hoàn tất đa ngôn ngữ (lặp, rẻ) → 2. F2 (rẻ) → 3. B (đổi cách cho ăn — ảnh hưởng mọi thứ sau) → 4. C → 5. F1, F3 → 6. D → 7. E.

