# Trại Gà — thiết kế chi tiết bốn phần khó (2026-11-16)

> Bổ sung cho [next-rounds.md](next-rounds.md). Bốn phần này dễ làm sai nếu chỉ đọc mô tả ngắn, nên ở đây ghi tới mức
> giả mã, tình huống biên và tên test. **Khi tài liệu này và `next-rounds.md` khác nhau, tài liệu này đúng.**
> Người cài đặt: làm đúng thứ tự H1 → H2 → H3 → H4; mỗi phần xong phải qua toàn bộ test cũ
> (`node --test tests/chicken-farm/*.test.mjs`, `node --test server/test/`) và phát lại nhật ký (`server/tools/replay.mjs`) không lệch.

Kiến thức nền bắt buộc đọc trước trong mã: `advance()`, `advanceChicken()`, `stepChicken()`, `act()` trong `rules.js`;
`perform()`, `getFarm()`, `#commit()` trong `server/src/farm-service.mjs`; `applyAction()` trong `server/src/actions.mjs`.

---

## H1. Tháp hạt: gà chỉ ăn khi người chơi đang mở game

### Vì sao khó

1. Game **không chạy liên tục**. `advance(state, now)` mô phỏng dồn các bước 1 phút từ lần trước tới `now`. "Lúc đó người chơi có mặt không" phải suy ra cho từng bước trong quá khứ.
2. `state.seenAt` được ghi đè ở **mỗi** lần gọi có mặt, nên nó luôn mới hơn điểm bắt đầu của bước đang mô phỏng (bước bắt đầu từ phút tròn trước đó). So `t ≥ seenAt` sẽ **luôn sai** → gà không bao giờ ăn. Cần một mốc riêng: **phiên có mặt bắt đầu từ lúc nào**.
3. Online: client chỉ **xem** (`GET /api/farm` mỗi 4 giây) thì server không ghi gì, `seenAt` trong DB cũ dần. Người chơi ngồi xem 10 phút rồi mới bấm sẽ bị coi là vắng 10 phút. Server phải tự theo dõi phiên và **ghi mốc phiên vào nhật ký** để phát lại được.
4. `advance` mô phỏng **từng con gà hết các bước của nó** rồi mới tới con sau (không đan xen theo thời gian). Tháp là tài nguyên chung → con đứng trước ăn trước. Chấp nhận, vì bước "có mặt" mỗi lần gọi chỉ dài ≤ vài phút; **không** viết lại vòng lặp thành đan xen (đổi kết quả của mọi trại đang có).

### Trạng thái và cấu hình

```
CONFIG.tower = { cap: 40, eatBelow: 0.5 }        // gà ăn khi độ no < 50% tối đa
state.tower     = { common: 0, protein: 0, … }   // cùng khoá với state.inventory
state.watchFrom = <ms>                           // đầu phiên có mặt hiện tại
```

`ensure()`: thiếu `tower` → tạo toàn 0; thiếu `watchFrom` → gán `state.seenAt ?? state.updatedAt`.
`newGame()`: `watchFrom = now`.

### Luật (giả mã — chèn vào `advance`, giữ nguyên phần nở trứng Q14 đang có)

```
advance(state, now, { present = true, watchFrom = undefined, continuous = false } = {}):
  ensure(state); rollDaily(state, now)
  let watchedFrom = Infinity                       // mặc định: không bước nào "có mặt"
  if present:
    seenPrev = state.seenAt ?? -Infinity
    if watchFrom !== undefined:                    // (A) server đưa mốc phiên — xem "Server" bên dưới
      state.watchFrom = max(watchFrom, state.createdAt)
    else if !continuous && now - seenPrev > CONFIG.hatchPresenceGraceMs:
      state.watchFrom = now                        // (B) vắng quá lâu → phiên mới bắt đầu từ bây giờ
    // (C) còn lại: giữ nguyên state.watchFrom (phiên đang tiếp diễn)
    watchedFrom = state.watchFrom
    … phần nở trứng Q14 hiện có, KHÔNG đổi …
    if !(seenPrev >= now): state.seenAt = now
  if now <= state.updatedAt: return events
  for ch in order: advanceChicken(state, ch, now, events, watchedFrom)
  …

stepChicken(state, ch, t, dt, events, watchedFrom):
  // ĐẦU hàm, trước khi trừ độ no:
  if t >= watchedFrom && ch.location === "coop" && ch.satiety < CONFIG.tower.eatBelow * CONFIG.satietyMax:
    k = bestSeedFor(ch, state.tower)               // null nếu tháp rỗng
    if k: state.tower[k]--; eat(ch, k)
  … phần còn lại giữ nguyên …
```

- `bestSeedFor(ch, counts)`: chuyển nguyên công thức `score` của `autoFeed` (`main.js`) vào `rules.js`. Bỏ qua loại có `counts[k] <= 0` và **bỏ qua `odd`**. Hoà điểm → loại đứng trước trong `Object.keys(SEEDS)` (tất định). Không còn gì → `null`.
- Mỗi con **tối đa 1 hạt mỗi bước** (1 phút). Không vòng lặp "ăn tới no".
- `continuous: true` chỉ dành cho client offline khi tua nhanh thời gian (bảng Dev, tốc độ > 1): lúc đó hai lần gọi cách nhau 0,5 giây thật nhưng vài phút trong game, luật sẽ tưởng là vắng. Server **không bao giờ** truyền cờ này.
- `fillTower(state, seed, n, now)`: `n` nguyên 1..cap; lỗi `bad_seed`, `no_seed` (kho không đủ `n`), `tower_full` (tổng tháp + n > cap), `bad_seed` cho `odd` ("Hạt lạ phải cho ăn riêng"). Thành công: chuyển hạt, `bump(state, "feed", n)` (việc "cho ăn N hạt" tính theo hạt đổ vào tháp + hạt cho ăn tay).
- `takeFromTower(state, seed, n, now)`: lấy lại hạt về kho (kho đầy → `seeds_full`). Cần để người chơi sửa nhầm.
- **Không** đếm `feed` lúc gà tự ăn (nếu đếm, nhiệm vụ tự xong khi treo máy).

### Server (phần hay bị bỏ sót)

1. `presence.mjs`: thêm theo dõi phiên **mở game** (khác với "đang xem cánh đồng" đã có):
   `seen(pid, now) → sessionFrom`. Giữ trong bộ nhớ `{ last, from }` mỗi người chơi; nếu `now - last > CONFIG.hatchPresenceGraceMs` → `from = now`; luôn `last = now`; trả `from`. Gọi ở **mọi** request có xác thực của người chơi (`GET /api/farm`, mọi `POST /api/farm/*`, `POST /api/field/watch`).
2. `perform()` và nhánh ghi của `getFarm()`: truyền `watchFrom: sessionFrom` vào `applyAction(…, { present: true, watchFrom })`, và **ghi `w: sessionFrom` vào cột `rolled`** của hành động (gộp với giá trị tung sẵn có: `{ ...rolled, w }`; hành động không có gì để tung thì `rolled = { w }`).
3. Nhánh **chỉ xem** của `getFarm()` (mô phỏng trên bản sao): cũng truyền cùng `watchFrom` → màn hình người chơi khớp với thứ sẽ được ghi sau này.
4. `tools/replay.mjs`: `present = row.source !== "system"`; nếu `rolled?.w !== undefined` → truyền `watchFrom: rolled.w`. Hành động cũ (trước bản này) không có `w` → luật tự suy theo nhánh (B)/(C) như trước, nên nhật ký cũ vẫn phát lại đúng.
5. Hành động nguồn `system` (gọi gà về khi mất nhịp tim): `present: false` như hiện nay → `watchedFrom = Infinity` → không con nào ăn. Các bước đó **đã được mô phỏng xong** (`ch.updatedAt` tiến lên) nên lần gọi sau không cho ăn bù được. Đây là tính chất mong muốn; đừng "sửa".
6. Khởi động lại server: bộ nhớ phiên mất → request đầu tiên mở phiên mới. Chấp nhận (người chơi mất tối đa vài phút gà không ăn).
7. `validate.mjs`: `fillTower` / `takeFromTower`: `{ seed: seedKind(b), n: số nguyên 1..CONFIG.tower.cap }`.

### Tình huống biên (mỗi dòng là một test; tên test ghi nguyên văn)

| # | Tình huống | Kết quả phải có |
|---|---|---|
| T1 | Đổ 10 hạt, gọi `advance` mỗi 30 giây suốt 30 phút, gà đói | Gà ăn dần, độ no không về 0, tháp vơi |
| T2 | Đổ 10 hạt, **không gọi gì 3 giờ**, rồi `advance` một lần | Tháp còn nguyên 10, `starvedMs` tăng như chưa có tháp |
| T3 | Như T2 rồi gọi tiếp mỗi 30 giây | Từ lần gọi thứ hai trở đi gà mới ăn (phiên mới bắt đầu ở lần đầu) |
| T4 | Hai lần gọi cách nhau đúng `hatchPresenceGraceMs` / cách thêm 1 ms | Liên tục / phiên mới |
| T5 | `advance(..., { present: false })` giữa phiên | Không ăn trong lần gọi đó; lần gọi có mặt kế tiếp (gap ≤ grace) ăn tiếp |
| T6 | Gà đang ở ngoài đồng | Không ăn từ tháp |
| T7 | Tháp chỉ có hạt đạm và hạt thường, gà thiếu đạm | Ăn hạt đạm; khi đủ đạm thì ăn hạt thường |
| T8 | Hai con cùng đói, tháp còn 1 hạt | Đúng 1 con ăn; chạy lại cùng seed ra cùng con |
| T9 | `watchFrom` truyền từ ngoài sớm hơn `seenAt` 10 phút (server: người chơi ngồi xem không bấm) | Các bước trong 10 phút đó được ăn |
| T10 | `watchFrom` truyền từ ngoài **sớm hơn `ch.updatedAt`** | Không ăn bù cho bước đã mô phỏng (không có bước nào lặp lại) |
| T11 | `continuous: true`, hai lần gọi cách nhau 30 phút game | Coi như có mặt suốt |
| T12 | Bản lưu v6 chưa có `tower` / `watchFrom` | `ensure` bổ sung, không lỗi, không đổi phần khác |
| T13 (server) | Người chơi `GET /api/farm` mỗi 4 giây trong 5 phút rồi mới `fillTower`… rồi 5 phút GET nữa rồi `collectEgg` | Sau hành động thứ hai, gà đã ăn trong 5 phút ở giữa; `replayFarm` khớp |
| T14 (server) | Mất nhịp tim → `sweep()` ghi `recallAll` nguồn `system` | Tháp không đổi trong hành động đó; `replayFarm` khớp |
| T15 (server) | Nhật ký của một trại tạo trước bản này (không có `w`) | `replayFarm` vẫn khớp |
| T16 | Cùng seed + cùng chuỗi hành động + cùng `watchFrom` | Cùng `JSON.stringify(state)` |

Kiểm tra đỏ bắt buộc: tạm đổi điều kiện thành `t >= state.seenAt` → T1 phải đỏ; tạm bỏ điều kiện `present` → T2 và T14 phải đỏ.

### Giao diện (việc đơn giản, ghi để khỏi quên)

Bỏ khay hạt kéo-thả và vùng thả "Máng ăn" nhận gà. Tháp vẽ tại `SPOTS.feeder`, cột hạt cao theo `tổng / cap`; chạm → hộp chọn loại hạt + số lượng (thanh trượt). Cho ăn riêng: Kho → chạm loại hạt → lưới ảnh gà → `feed()`. Sửa `TUTORIAL` bước `feed` thành "Đổ 3 hạt vào tháp hạt".

---

## H2. Minigame: server không tin điểm số

### Mô hình đe doạ

Kẻ gian lận điều khiển hoàn toàn client: gửi `endPlay` với điểm tuỳ ý, vào lúc tuỳ ý, bao nhiêu lần tuỳ ý, từ nhiều tab. Server **không thể** biết họ có chơi thật không. Vậy thiết kế theo nguyên tắc: **người gian lận hoàn hảo chỉ nhận đúng bằng người chơi giỏi nhất chơi thật** — và mức đó phải chấp nhận được về cân bằng.

### Trạng thái và cấu hình

```
CONFIG.play = {
  cost: 1,                        // vé mỗi lượt
  minMs: 10_000, maxMs: 120_000,  // endPlay hợp lệ trong khoảng này kể từ startPlay
  growth: 8,                      // điểm lớn tối đa mỗi lượt (thang 0–100)
  hunger: 60,                     // độ no mất mỗi lượt (trừ đủ, không theo điểm)
  eggCutPct: 0.15,                // trứng: bớt tối đa 15% thời gian ấp
  adultLifeMs: 30 * MIN,          // gà trưởng thành: trẻ lại tối đa 30 phút
  perSubjectPerHour: 2,           // mỗi con / mỗi quả: 2 lượt mỗi giờ
  winAt: 0.6,                     // điểm ≥ 0,6 là thắng
  winTicketsPerDay: 6,            // vé thưởng tối đa mỗi ngày
}
state.play    = null | { id, kind, at }     // lượt đang chơi (tối đa 1)
state.playLog = { [id]: [at, at] }          // 2 mốc gần nhất của từng con/quả (để giới hạn theo giờ)
state.playDay = { day, tickets }            // vé đã thắng trong ngày
```

### Luật

```
startPlay(state, id, now):
  subject = gà có id, hoặc trứng ĐANG ẤP có id            → không có: no_subject
  gà phải ở chuồng (in_field), không đang ấp giúp (brooding)
  state.play != null:
      nếu now - state.play.at <= maxMs → play_busy          // đang có lượt (tab khác)
      ngược lại coi lượt cũ đã bỏ dở: xoá, KHÔNG hoàn vé    // xem "bỏ dở" bên dưới
  state.tickets < cost → no_ticket
  gà: satiety < hunger → too_hungry ("Gà đang đói, cho ăn rồi hãy chơi")
  đếm mốc trong playLog[id] có now - at < 1 giờ; ≥ perSubjectPerHour → play_tired
  → tickets -= cost; play = { id, kind: kindOf(subject), at: now }; playLog[id] đẩy now (giữ 2 mốc cuối)
  kindOf: trứng → "roll"; growth < 30 → "hop"; < 100 → "dash"; còn lại → "peck"
  trả { id, kind }

endPlay(state, score, now):
  state.play == null → no_play
  p = state.play; state.play = null                        // xoá TRƯỚC khi tính (không nhận hai lần)
  elapsed = now - p.at
  s = (score là số hữu hạn) ? clamp(score, 0, 1) : 0
  nếu elapsed < minMs hoặc elapsed > maxMs → s = 0         // vẫn kết thúc lượt, không thưởng
  subject mất (gà chết / bị đổi / trứng đã nở) → trả { score: 0, gone: true }
  trứng:  hatchAt = max(now, hatchAt - eggCutPct * incubateMs * s)
  gà chưa lớn: growth = min(100, growth + growth_cfg * s); satiety = max(0, satiety - hunger)
               (nếu vừa chạm 100: để bước advance kế tiếp phát sự kiện adult như thường — KHÔNG tự phát ở đây)
  gà lớn:  lifeUsed = max(0, lifeUsed - adultLifeMs * s); satiety = max(0, satiety - hunger)
  thắng = s >= winAt
  nếu thắng: playDay.day != dayIndex(now) → đặt lại { day, tickets: 0 };
             nếu playDay.tickets < winTicketsPerDay và tickets < cap → tickets++, playDay.tickets++, bump("play")
  trả { score: s, win, ticket: có cộng vé hay không }
```

Lưu ý cài đặt:
- Dòng "gà chưa lớn … chạm 100": hiện sự kiện `adult` phát trong `stepChicken` khi `growth` vượt ngưỡng **trong bước đó**. Nếu `endPlay` đẩy `growth` tới đúng 100 thì `stepChicken` sẽ không vào nhánh lớn nữa (`ch.growth < adult` sai) và `adultAt` mãi `null`. Vì vậy trong `endPlay` kẹp `growth` ở `99.999` thay vì 100; bước kế tiếp sẽ hoàn tất và phát `adult`, `dexMark`, `breedMark` đúng đường cũ. **Có test riêng cho việc này (P9).**
- Độ phát triển `dev` không cộng trong `endPlay` (chơi không thay dinh dưỡng). Hệ quả: lớn bằng minigame làm `devWeight` nhỏ hơn → `dev` cuối phụ thuộc nhiều hơn vào các bước ăn thật. Chấp nhận; không bù.

### Vì sao gian lận không lợi

| Chiêu | Chặn bằng |
|---|---|
| Gửi `score: 1` không chơi | Trần = người chơi giỏi nhất. Mỗi lượt vẫn tốn 1 vé và 60 độ no, chờ ≥ 10 giây |
| Gọi liên tục | `perSubjectPerHour` (2 lượt/giờ/con) + vé |
| Lấy vé vô hạn | `winTicketsPerDay` = 6; mỗi lượt tốn 1 vé → lãi ròng tối đa 0 vé/lượt thắng, tức minigame **không sinh vé ròng** (thắng thì hoà vốn). Vé ròng chỉ đến từ rương và đổi gà/trứng (xem H3) |
| Hai tab cùng `startPlay` | `play_busy`; trạng thái nằm trên server |
| `endPlay` hai lần | `state.play = null` trước khi tính; lần hai → `no_play` |
| `endPlay` ngay lập tức / treo cả ngày | `minMs` / `maxMs` → điểm 0 |
| `score` là `NaN`, `"1"`, `1e9`, âm | `validate.mjs`: `typeof === "number" && Number.isFinite`; luật kẹp lần nữa |
| Dùng minigame nuôi lớn tức thì | 8 điểm lớn/lượt × 2 lượt/giờ = 16%/giờ, so với ăn đủ chất lớn 100% trong 20 phút → minigame là **phụ**, không thay việc cho ăn |
| Chơi để né đói | `too_hungry` + trừ đủ `hunger` dù điểm thấp |

Bỏ dở (đóng tab, mất mạng): vé đã trừ **không hoàn** — nếu hoàn thì "start rồi bỏ" thành cách dò đề miễn phí. `startPlay` kế tiếp sau `maxMs` tự dọn lượt cũ.

Server: `startPlay`, `endPlay` không cần giá trị ngẫu nhiên (không thêm vào `SEEDED`). Kiểu trò (`kind`) do server quyết theo tuổi, client không gửi.

### Phía client (hợp đồng cho người viết 4 trò)

`js/game/play/<kind>.js` xuất `run(host, { art, lang }) → Promise<number 0..1>`; tự dọn DOM/timer khi xong; dài 30–45 giây; một nút chạm (hoặc phím cách); có nút "Thoát" trả về điểm hiện tại. `main.js`: `startPlay` → `view = "play"` → `run()` → `endPlay(score)` → màn `REVEAL.play` (điểm, phần thưởng). Nếu `endPlay` lỗi mạng: thử lại tối đa 3 lần trong `maxMs`, sau đó báo "lượt chơi không được ghi".

### Test (tên nguyên văn)

P1 không vé → `no_ticket`, không trừ gì · P2 `endPlay` trước 10 giây → điểm 0, vẫn mất vé, vẫn mất độ no · P3 sau 120 giây → điểm 0 · P4 `score` 5 / −1 / `NaN` → kẹp về 1 / 0 / 0 · P5 `endPlay` hai lần → lần hai `no_play`, không cộng thêm · P6 `startPlay` khi đang có lượt < 120 giây → `play_busy`; sau 120 giây → lượt mới, lượt cũ không hoàn vé · P7 lượt thứ 3 trong một giờ cùng một con → `play_tired`; con khác vẫn chơi được · P8 thắng 7 lần trong ngày → chỉ 6 vé thưởng; sang ngày đếm lại · P9 gà `growth` 95 thắng điểm 1 → sau `advance` kế tiếp có sự kiện `adult` và `adultAt != null` · P10 trứng: `hatchAt` giảm đúng `0.15 × incubateMs × s`, không sớm hơn `now` · P11 gà bị đổi ở chợ giữa lượt → `endPlay` trả `gone`, không lỗi · P12 gà đói (`satiety < 60`) → `too_hungry` · P13 kiểu trò theo tuổi (trứng / 0–29 / 30–99 / 100) · P14 (server) `score` kiểu chuỗi → 400 · P15 (server) chuỗi start/end phát lại khớp.

Kiểm tra đỏ: bỏ kẹp điểm → P4 đỏ; đổi `state.play = null` xuống cuối hàm rồi ném lỗi giả giữa chừng → P5 đỏ.

---

## H3. Kinh tế vé và giá thương nhân

### Nguyên tắc

- Vé chỉ dùng trong game (chủ dự án chốt), `CONFIG.tickets.cap = 99`.
- Vé là **thứ khan hiếm duy nhất** người chơi cảm nhận được; hạt vẫn là nền.
- Phải có **bồn chứa** (sink) lớn hơn hoặc bằng **vòi** (faucet) với người chơi nhiều nhất, nếu không vé chạm trần và mất nghĩa.

### Vòi và bồn (mỗi ngày, ba kiểu người chơi của `balance-sim`)

| Nguồn / chỗ tiêu | Ghé thăm (3 phiên ngắn) | Chăm (6 phiên) | Cày (mở cả ngày) |
|---|---|---|---|
| Rương 24 giờ (+1, cần nhận đủ 6 bậc trong ngày) | 0 | 1 | 1 |
| Rương ngày khi chuỗi ≥ 3 (+1) | 0–1 | 1 | 1 |
| Đổi trứng có phôi (1 vé/quả, **tối đa 3 quả/ngày**) | 1 | 3 | 3 |
| Đổi gà trưởng thành (2 vé/con, **tối đa 2 con/ngày**) | 0–2 | 2–4 | 4 |
| Minigame (thắng hoàn 1 vé, thua mất 1) | −1…0 | −2…0 | −4…0 |
| **Ròng trước khi mua** | **~1–3** | **~5–8** | **~6–9** |
| Thương nhân (bảng dưới) | tiêu hết | tiêu hết | tiêu hết |

Trần đổi mỗi ngày là **bắt buộc**: không có nó người Cày (20 trứng có phôi/ngày theo mô phỏng) đổi được 20 vé/ngày và mua sạch hàng hiếm trong tuần đầu. Cài: `state.ticketDay = { day, eggs, chickens }`, `CONFIG.tickets = { cap: 99, perEgg: 1, perChicken: 2, eggsPerDay: 3, chickensPerDay: 2 }`; vượt trần → `ticket_limit` ("Hôm nay đổi đủ vé rồi — mai nhé"), túi hạt vẫn đổi được như cũ.

### Giá thương nhân (`CONFIG.merchant.prices`)

| Món | Giá | Lý do |
|---|---|---|
| 3 hạt quý | 4 vé | ≈ 2 trứng thường đổi túi; tiện, không rẻ |
| 2 hạt lạ | 6 vé | tăng biến dị = đường tắt tới đặc điểm mới |
| Túi quà 8 hạt | 5 vé | |
| Trứng mang 1 đặc điểm **thường gặp** (hoa văn, lam, da đen, chỏm, râu, lông chân, mào) | 15 vé | Chăm: ~2–3 ngày; Ghé thăm: ~1 tuần |
| Trứng mang 1 đặc điểm **hiếm** (lông tơ, bắn tóe, năm ngón, cụt đuôi, lông xoăn, đuôi dài) | 25 vé | Chăm: ~4–5 ngày; Ghé thăm: ~2 tuần |

Mục tiêu đo được: **người Chăm mua một trứng hiếm mỗi 5–7 ngày; người Ghé thăm mỗi 2 tuần; người Cày không nhanh hơn người Chăm quá 1,5 lần** (nhờ các trần theo ngày). Người mới (ngày 1–2, ròng 1–3 vé/ngày) thấy thương nhân nhưng không mua nổi trứng — đúng ý chủ dự án.

Lông tơ là gen lặn: trứng "mang lông tơ" phải là **đồng hợp `hh`** thì mới hiện ra; ghi rõ trên thẻ hàng "nở ra chắc chắn có lông tơ". Các đặc điểm trội: một bản alen là đủ (ép `g[key][0]`).

### Việc phải làm với công cụ mô phỏng (không có thì không được chốt số)

Trong `tools/chicken-farm/balance-sim.mjs`:
1. Bot biết: nhận rương theo giờ / rương ngày khi đủ điều kiện; đổi trứng thừa lấy vé tới trần ngày rồi mới đổi túi; chơi minigame với xác suất thắng theo kiểu chơi (Ghé thăm 50%, Chăm 70%, Cày 85%); mua ở thương nhân món đắt nhất đủ vé khi thương nhân đang ghé trong phiên của bot.
2. Thêm dòng báo cáo: vé nhận/ngày theo nguồn, vé tiêu/ngày, **ngày mua được trứng hiếm đầu tiên**, số trứng hiếm mua trong 14 ngày, % thời gian vé chạm trần 99.
3. Thêm vào `tests/chicken-farm/balance.test.mjs` (chạy 14 ngày, 16 ván): `Chăm` mua trứng hiếm đầu tiên trong khoảng ngày 4–8; `Ghé thăm` không trước ngày 9; `Cày` không trước ngày 3; không kiểu chơi nào chạm trần vé quá 5% thời gian. Sai thì chỉnh **giá và trần ngày**, không chỉnh luật.

---

## H4. Bạn bè và tin nhắn

### Ràng buộc

- Hiện chỉ có **tài khoản khách** (token ngẫu nhiên trong trình duyệt; mất là mất). Không có email, không có mật khẩu → không khôi phục được, không xác minh được ai là ai.
- Người chơi có thể là trẻ em → **không có chữ tự do** ở bản này.
- SEC-05: tài khoản khách bỏ hoang sẽ bị dọn → danh sách bạn có thể trỏ tới tài khoản không còn.

### Mã bạn bè

- 8 ký tự, bảng chữ `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (bỏ 0/O, 1/I/L), hiển thị `XXXX-XXXX`.
- Sinh: `HMAC-SHA256(SERVER_SECRET, "friend|" + playerId)` → lấy 40 bit đầu → mã hoá 5 bit/ký tự. **Không** lưu ngược được ra `playerId`; tra cứu qua cột có chỉ mục.
- Trùng mã (xác suất ~1/10¹² mỗi cặp): khi tạo, nếu đã tồn tại thì băm lại với hậu tố `|1`, `|2`…
- Không có API liệt kê hay tìm theo tên. Chỉ kết bạn được khi **có mã** do người kia đưa ngoài game.

### Lược đồ (SQLite, thêm vào `store.mjs`)

```sql
ALTER TABLE players ADD COLUMN friend_code TEXT;          -- NULL tới lần đầu mở hòm thư
CREATE UNIQUE INDEX players_friend_code ON players(friend_code) WHERE friend_code IS NOT NULL;

CREATE TABLE friends (
  a INTEGER NOT NULL, b INTEGER NOT NULL,                  -- a < b luôn luôn (một dòng cho một cặp)
  state TEXT NOT NULL CHECK (state IN ('pending','ok','blocked')),
  by INTEGER NOT NULL,                                     -- ai gửi lời mời / ai chặn
  at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
) WITHOUT ROWID;
CREATE INDEX friends_b ON friends(b);

CREATE TABLE mail (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
  template TEXT NOT NULL,                                  -- khoá câu mẫu, vd "hello", "nice_chicken"
  arg TEXT,                                                -- tuỳ chọn: tên gà của NGƯỜI GỬI (server tự lấy, không nhận chữ từ client)
  at INTEGER NOT NULL, read_at INTEGER
);
CREATE INDEX mail_to ON mail(to_id, at);
```

(Kiểu của `player_id` phải khớp bảng `players` hiện có — xem `store.mjs` trước khi viết.)

### API (mọi đường đều cần token; qua `ratelimit.mjs`)

| Đường | Thân | Luật |
|---|---|---|
| `GET /api/social` | — | `{ code, friends: [{ code, name, state, mine }], mail: [… 50 thư mới nhất], unread }` — `name` là tên trại (xem dưới), không có id |
| `POST /api/social/invite` | `{ code }` | Mã sai định dạng → 400. Không tồn tại / chính mình / đã chặn mình → **cùng một câu trả lời** `not_found` (không lộ ai tồn tại). Đã là bạn → `ok`. Tạo `pending`. Giới hạn: 10 lời mời/ngày, 30 bạn tối đa |
| `POST /api/social/accept` | `{ code }` | Chỉ người **nhận** lời mời chấp nhận được (`by != mình`) |
| `POST /api/social/remove` | `{ code }` | Xoá dòng (cả hai phía) |
| `POST /api/social/block` | `{ code }` | `state = 'blocked', by = mình`; xoá thư chưa đọc từ người đó; người bị chặn không biết |
| `POST /api/social/send` | `{ code, template }` | Chỉ tới bạn `ok`. `template` phải nằm trong danh sách cố định của server. 20 thư/ngày/người gửi, 5 thư/ngày/cặp |
| `POST /api/social/read` | `{ upTo }` | Đánh dấu đã đọc |
| `GET /api/social/farm/<code>` | — | Chỉ bạn `ok`. Trả bản xem **chỉ đọc, rút gọn**: tên trại, gà (tên, mã gen, tuổi, giai đoạn), đồ trang trí, sao của sổ. **Không** có kho, vé, nhiệm vụ, trứng |

- Tên trại: thêm `state.farmName`, chọn từ **hai danh sách có sẵn** (tính từ + danh từ, vd "Trại Nắng Sớm"); không nhập chữ tự do. Hành động luật `nameFarm(state, a, b)` với hai chỉ số.
- Câu mẫu: ~20 khoá (`hello`, `thanks`, `nice_chicken`, `come_visit`, `good_night`, …), chữ nằm trong `i18n.js` → người nhận đọc bằng ngôn ngữ của mình.
- Bạn bè và thư **không nằm trong `state` của trại** và không qua nhật ký `actions` (không ảnh hưởng luật chơi, không cần phát lại).

### Bảo mật — danh sách kiểm (mỗi dòng một test trong `server/test/social.test.mjs`)

S1 mã của A không suy ra được id của A (không có id trong bất kỳ câu trả lời nào) · S2 mời mã không tồn tại, mã của chính mình, mã của người đã chặn mình → ba câu trả lời **giống hệt nhau** (thân và mã HTTP) · S3 A mời B, A tự `accept` → từ chối · S4 gửi thư khi chưa là bạn / đang `pending` / đã bị chặn → từ chối, không tạo dòng · S5 `template` ngoài danh sách, hoặc có trường `text` → 400 · S6 thư thứ 21 trong ngày → 429; thư thứ 6 cho cùng một người → 429 · S7 xem trại của người không phải bạn → `not_found` · S8 bản xem trại bạn không chứa `inventory`, `tickets`, `bags`, `eggs`, `quest`, `daily`, `seed` · S9 chặn rồi: lời mời mới từ người bị chặn trả `not_found`, thư cũ chưa đọc biến mất · S10 người thứ 31 → `friends_full` · S11 tài khoản bị dọn (SEC-05): `ON DELETE` thủ công — khi xoá `players` phải xoá `friends` và `mail` liên quan trong **cùng transaction**; bạn của họ thấy danh sách ngắn đi, không lỗi · S12 mọi đường `/api/social/*` không có token → 401 · S13 hai request `invite` chéo nhau đồng thời (A→B và B→A) → kết quả là bạn `ok`, đúng một dòng (nhờ khoá chính `(a, b)` với `a < b`).

### Ba điểm còn ngỏ — producer chốt thay (chủ dự án giao 16/11; đổi được, đều là số trong cấu hình)

**1. Dọn tài khoản khách (đóng luôn SEC-05)** — `DEFAULTS.guestKeep` trong `server/src/config.mjs`:

| Loại tài khoản | Dọn sau | Lý do |
|---|---|---|
| Khách **chưa tạo trại** | 7 ngày kể từ lúc tạo | Rác do bot / người mở thử rồi bỏ; không ai mất gì |
| Khách có trại, **không có bạn** | 90 ngày không có request nào | Gà sống 2–5 ngày nên trại bỏ 3 tháng đã trống từ lâu |
| Khách có trại, **có ít nhất một bạn `ok`** | 180 ngày | Người khác nhìn thấy họ; cho thêm thời gian quay lại |

- Cần cột `players.last_seen` (cập nhật tối đa 1 lần/giờ mỗi người để không ghi DB ở mọi request).
- Chạy trong `sweep()` hiện có, **mỗi lần tối đa 50 tài khoản** (không khoá DB lâu), mỗi tài khoản một transaction: xoá `mail` → `friends` → `actions` → `rejects` → `farms` → `players`.
- **Không để lại dấu vết cho bạn bè**: danh sách bạn ngắn đi, không hiện "đã rời". Lý do: bản ghi "đã rời" là dữ liệu về một người đã xoá, và không có nó thì không ai dò được tài khoản nào vừa bị dọn.
- Trước khi dọn 14 ngày: nếu người đó quay lại thì chỉ cần một request là `last_seen` mới → tự thoát. Không gửi cảnh báo (không có kênh nào ngoài game).
- Test thêm: S14 khách không trại 8 ngày bị dọn, 6 ngày thì chưa · S15 trại không bạn 91 ngày bị dọn; cùng trại nhưng có bạn `ok` thì chưa · S16 sau khi dọn, `replayAll` không báo lỗi vì trại mồ côi, bảng `friends` / `mail` không còn dòng nào trỏ tới id đã xoá · S17 một lần `sweep()` dọn không quá 50.

**2. Quà giữa bạn bè: có, nhưng là quà do GAME phát, không lấy từ kho người gửi**

Tặng hạt/trứng/vé của chính mình = chuyển vật phẩm giữa người chơi → **không làm** (trái quyết định "vé chỉ dùng trong game", và là thứ Nghị định 147 cấm). Thay bằng "gửi lời chúc":

- `POST /api/social/cheer { code }`: mỗi ngày gửi cho **mỗi bạn 1 lần**, tối đa **5 bạn/ngày**. Người gửi không mất gì.
- Người nhận có một "giỏ quà" trong hòm thư: mỗi lời chúc = 1 túi 2 hạt (bảng `shop`), **nhận tối đa 5 túi/ngày**; quá số đó lời chúc vẫn tới nhưng không kèm túi.
- Nhận quà là hành động **của trại người nhận**: `claim(state, "cheer", now, { n })` — server kiểm tra `n` với bảng `mail` rồi mới gọi luật; túi vào `state.bags` như mọi phần thưởng khác (qua nhật ký, phát lại được; `n` nằm trong `args`).
- Người gửi được **+1 tiến độ** việc trong ngày mới `cheer` ("Gửi lời chúc cho 1 người bạn"), chỉ giao khi có ít nhất một bạn.
- Vì sao an toàn về cân bằng: tối đa 10 hạt thường-khá/ngày, ít hơn một rương ngày; hai tài khoản phụ tự chúc nhau cũng chỉ được chừng đó, và mỗi tài khoản phụ phải có mã mời (không có tìm kiếm).
- Test: S18 chúc cùng một bạn hai lần trong ngày → lần hai từ chối · S19 bạn thứ 6 trong ngày → từ chối · S20 người nhận đã nhận 5 túi → lời chúc thứ 6 không kèm túi · S21 `claim("cheer")` với `n` lớn hơn số lời chúc chưa nhận → từ chối · S22 kho túi đầy → `bags_full`, lời chúc vẫn giữ để nhận sau.

**3. Tin nhắn: không chữ tự do; thêm "bưu thiếp gà" để vẫn có cái riêng để khoe**

- Giữ ~20 câu mẫu + 8 biểu cảm (đều là khoá trong `i18n.js`).
- **Bưu thiếp**: `POST /api/social/send { code, template: "postcard", chickenId }` — server tự lấy **tên, mã gen, tuổi, giống** của con gà đó từ trại người gửi và lưu vào `mail.arg` (JSON, ≤ 200 ký tự). Người nhận thấy đúng hình con gà (vẽ lại từ mã gen bằng `renderChickenFlat`) kèm câu mẫu. Không có chữ nào do người gửi gõ: tên gà cũng lấy từ danh sách có sẵn của game.
- Bưu thiếp là ảnh chụp tại thời điểm gửi: gà sau đó chết hay bị đổi thì thư vẫn còn.
- Giới hạn chung 20 thư/ngày đã có; bưu thiếp tính vào đó.
- Chữ tự do: **không làm** cho tới khi có đủ cả ba: tài khoản thật (email), nút báo cáo + chặn có người xử lý, lọc từ. Ghi vào `production-plan.md` như một mốc riêng, không phải việc "làm thêm sau".
- Test: S23 `chickenId` không thuộc trại người gửi → từ chối · S24 thân request có trường `name` / `text` tự đặt → bị bỏ qua, thư chứa tên thật của gà · S25 gà bị đổi sau khi gửi → người nhận vẫn mở được bưu thiếp.
