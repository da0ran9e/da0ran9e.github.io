# Trại Gà — Kế hoạch sản xuất

> Bản 0.3 (2026-11-10) · producer: Claude · chủ dự án / người duyệt nội dung: bạn
> Mục đích kép: (1) một game nuôi & sưu tầm gà nhẹ nhàng, (2) nơi học vận hành và tối ưu một server tương tác trực tiếp.
> Thay đổi so với 0.2: chốt Q1–Q6 — chỉ có **hạt**, đổi trứng/gà lấy **túi hạt**, đẻ ngẫu nhiên, đói giảm tuổi thọ, phải **quan sát** khi thả đồng.

## 1. Tầm nhìn

Mỗi người chơi bắt đầu với **một quả trứng**. Ấp nở, rồi **ngồi xem gà kiếm ăn ngoài cánh đồng** hoặc cho ăn hạt trong chuồng, nhìn nó lớn lên. Gà sống **2–5 ngày**, bỏ đói thì chóng già. Gà mái no bụng thì thỉnh thoảng đẻ trứng; trại có gà trống thì trứng có phôi, mang **gen của cả bố lẫn mẹ**. **Không có tiền**: trứng và gà được đổi lấy **túi hạt** mở ra ngẫu nhiên, và (sau này) người chơi tự đặt giá để đổi với nhau. Mục tiêu dài hạn: **nuôi và sưu tầm**.

### Trụ cột thiết kế

1. **Mỗi con gà là duy nhất** — hình vẽ sinh từ gen; gắn bó vì thấy nó lớn lên.
2. **Gen là tiềm năng, dinh dưỡng là hiện thực** — mỗi chất trong hạt nuôi một nhóm kiểu hình.
3. **Chăm thì được thưởng** — ngồi xem gà ngoài đồng, chọn đúng hạt; bỏ bê thì gà chậm lớn, chóng già.
4. **Thế giới chung nhẹ nhàng** — gà của mọi người cùng kiếm ăn trên một cánh đồng; đổi chác, không tiền tệ.

## 2. Vòng chơi

**Vòng ngắn (vài phút / lần vào game)**
vào trại → xem gà (đói? thiếu chất gì?) → **thả ra đồng và ngồi xem** gà tự mổ hạt (rời màn hình thì gà tự về trại) hoặc **cho ăn hạt** trong kho → gà lớn / đẻ trứng → **ấp** trứng có phôi, **đổi** trứng thừa / gà lấy túi hạt → **mở túi** → lặp lại.

**Vòng dài (ngày / tuần)**
giữ trống tốt để trứng có phôi → nuôi đúng chất để đặc điểm hiện rõ → hoàn thiện **sổ sưu tầm** → gà già đi vào **sổ kỷ niệm**, dòng gen sống tiếp qua con cháu → đổi chác với người chơi khác.

## 3. Các hệ thống (số liệu trong `CONFIG` của `game/rules.js`)

| # | Hệ thống | Luật cốt lõi | Bài học server |
|---|---|---|---|
| S1 | Trứng & ấp | Ban đầu **1 ổ ấp** (nâng cấp sau). Ấp **5–30 phút tuỳ giống** (gen *thời gian ấp* của chính quả trứng). | Mốc `hatchAt`, tính lười |
| S2 | Hạt (thức ăn duy nhất) | Hạt thường; hạt giàu một chất: **đạm, mẩy (năng lượng), khoáng, màu (sắc tố)**; **hạt quý** (đủ cả 4); **hạt lạ** (tăng biến dị lứa sau). Hạt chưa dùng nằm trong **kho** (120). | — |
| S3 | Dinh dưỡng & lớn | 4 chất 0–100 tụt 30/giờ, độ no tụt 45/giờ. Chỉ lớn khi còn no; **20 phút** (đủ 4 chất) **→ 24 giờ** (thiếu hết). Dinh dưỡng **trong lúc lớn** quyết định gen biểu hiện: Đạm → lông; Năng lượng → vóc dáng; Khoáng → chân, mỏ; Sắc tố → màu. | Mô phỏng bước 1 phút **neo vào phút tròn** |
| S4 | Tuổi thọ | **2–5 ngày** (gen *sức đề kháng*); **lúc bụng rỗng 1 giờ = 3 giờ tuổi**. Mất thì vào **sổ kỷ niệm**. | Dọn dữ liệu, lưu lịch sử |
| S5 | Cánh đồng | Không điều khiển nhân vật: **thả gà ra đồng, gà tự đi tìm hạt** — 92% hạt thường, còn lại hạt tốt. **Chỉ khi người chơi đang quan sát**; rời màn hình / tắt máy → **gà tự về trại**. Mỗi gà mổ tối đa 1 hạt / 15 giây. | **Realtime, nhiều tác tử**, chỉ mô phỏng khi có người xem, server kiểm tra từng lần mổ |
| S6 | Đẻ & thụ tinh | Mái trưởng thành **no bụng (≥ 60)** → **đẻ ngẫu nhiên**, trung bình 1–3 giờ/trứng (gen *sai trứng*). Trại có **≥ 1 trống trưởng thành** → trứng có phôi, **bố chọn ngẫu nhiên** trong các trống. Không có trống → trứng không phôi, chỉ để đổi. Kho trứng 12. | Ngẫu nhiên theo (seed, gà, phút) → tái lập được |
| S7 | Biến dị | Mỗi gen một độ dễ biến dị (màu lông 1,4–1,6×; đặc điểm hiếm 0,25–0,3×). Hạt lạ tăng biến dị các lứa sau. | — |
| S8 | Đổi ở cửa hàng | **Trứng → túi 2 hạt; gà → túi 4–9 hạt** theo độ trưởng thành; **không theo độ hiếm**. Túi mở ra ngẫu nhiên, **tỉ lệ hạt tốt cao** (60%). Không có tiền, không có số dư. | Giao dịch kiểm tra chặt |
| S9 | Đổi giữa người chơi (M5) | Người chơi **tự đặt giá** cho trứng / gà của mình (tính bằng hạt hoặc trứng/gà khác). | **Giao dịch nguyên tử**, chống nhân bản |
| S10 | Sổ sưu tầm | Ghi nhận kiểu hình đã từng có; mốc thưởng. | Truy vấn, bảng xếp hạng |

### Ảnh chụp cân bằng (gen trung bình, trung vị 40 lần chạy, đo bằng chính `rules.js`)

| Cách nuôi | Thời gian tới trưởng thành |
|---|---|
| Hạt giàu đủ 4 chất / hạt quý, cho ăn mỗi 10–15 phút | ~1 giờ (giới hạn lý thuyết 20 phút) |
| **Ngồi xem gà ngoài đồng liên tục** | **~1,5 giờ** (0,8–2 giờ tuỳ may) |
| Hạt thường, cho ăn mỗi 10 phút | ~5,8 giờ |
| Hạt giàu đủ chất nhưng mỗi giờ mới cho ăn | ~6 giờ |
| Thả đồng 10 phút mỗi giờ | ~6,6 giờ (1,6–9,5 giờ) |
| Bỏ đói | không lớn, chóng già |

Hai cách được thưởng: **chăm quan sát** và **chịu đổi trứng lấy túi hạt tốt**.

## 4. Kiến trúc kỹ thuật

```
public/apps/chicken-farm/js/
  genome.js        gen, lai, biến dị theo từng gen, biểu hiện theo dinh dưỡng   (client + server)
  game/rules.js    luật chơi thuần logic                                        (client + server)
  game/field.js    (Sprint 2) AI gà kiếm ăn trên cánh đồng                      (client + server)
  chicken-flat.js  bộ vẽ "Phẳng 1" (hướng đã chốt)
server/ (M2)       Node 24 · WebSocket · node:sqlite (có sẵn trong Node)
tests/chicken-farm kiểm thử: node --test tests/chicken-farm/*.test.mjs
```

- **Luật viết một lần, chạy hai nơi**; hàm luật không đọc đồng hồ (nhận `now`).
- **Ngẫu nhiên tái lập được**: mọi lần tung xúc xắc gắn với (seed, id, thời điểm), không phụ thuộc thứ tự gọi → xem 1 hay 100 lần đều ra một kết quả, server chạy lại để kiểm tra.
- **Cánh đồng**: bộ mô phỏng quyết định gà mổ hạt gì (`rollSeed("field")`), luật chỉ kiểm tra hợp lệ (`fieldEat`: đúng chỗ, không quá nhanh, chưa no). Từ M3 bộ mô phỏng chạy trên server, client chỉ xem.
- Hạ tầng: client trên GitHub Pages; server trên máy Windows qua Cloudflare Tunnel (`game.vuducan.qzz.io`).

## 5. Các mốc

| Mốc | Tên | Phạm vi | Điều kiện hoàn thành |
|---|---|---|---|
| M0 ✅ | Nguyên mẫu gen & hình | Bộ gen, lai/biến dị, các kiểu vẽ, phòng gen | Đã chốt kiểu "Phẳng 1" |
| **M1** | **Vertical slice offline** | Trang game: chọn trứng, trại, ổ ấp, kho (hạt, trứng, túi), cửa hàng đổi túi hạt, **cánh đồng xem gà tự kiếm ăn**, sổ kỷ niệm. Bảng dev tua nhanh. | Chơi trọn: trứng → gà lớn → đẻ (có/không phôi) → ấp lứa mới → gà già đi |
| M2 | Server có thẩm quyền | Node server, tài khoản khách, SQLite, API hành động; triển khai; trang chỉ số | Dữ liệu trên server, gian lận phía client vô tác dụng |
| M3 | Cánh đồng chung realtime | AI gà phía server, WebSocket, tick 10 Hz, chỉ gửi vùng nhìn thấy, gà tự về khi mất kết nối, bot | 1.000 gà / 200 người xem một cánh đồng, p99 tick < 10 ms |
| M4 | Sưu tầm | Sổ sưu tầm, độ hiếm, nâng cấp ổ ấp | Có mục tiêu sưu tầm cho tuần đầu |
| M5 | Đổi giữa người chơi | Đăng bán với giá tự đặt, xác nhận, nguyên tử | Test "dupe" thất bại 100% |
| M6 | Tối ưu & vận hành | Giao thức nhị phân, gửi phần thay đổi, đo đạc, sao lưu | Báo cáo trước/sau từng tối ưu |

## 6. Các đội và tiến độ

| Đội | Sprint 1 (xong) | Sprint 2 (kế tiếp) |
|---|---|---|
| Thiết kế | `CONFIG` v0.3 theo Q1–Q6; ảnh chụp cân bằng | Bảng cân bằng kho / túi / tuổi thọ qua 1 tuần chơi |
| Lõi luật chơi | `rules.js` v0.3: hạt, đói giảm tuổi thọ, đẻ ngẫu nhiên khi no, thả đồng khi quan sát, cửa hàng túi hạt | `game/field.js`: AI gà kiếm ăn (dùng lại ở M3) |
| Gen | Gen *thời gian ấp*; độ dễ biến dị từng gen; biểu hiện theo dinh dưỡng | — |
| QA | 19 test, đã kiểm tra bằng cách cố ý làm hỏng luật (test bắt đúng lỗi) | Test cân bằng tự động |
| Đồ hoạ | — | Tư thế đi, mổ (Phẳng 1); cánh đồng, hạt các loại, túi hạt, ổ ấp, biểu tượng 4 chất |
| Client | — | Trang game M1 |
| Server | — | Thiết kế API + lược đồ dữ liệu |

## 7. Rủi ro

| Rủi ro | Ảnh hưởng | Cách giảm |
|---|---|---|
| Gà sống 2–5 ngày, bỏ đói chóng già: vắng 1 ngày quay lại gà đã mất | Cao | Sổ kỷ niệm; trứng trong kho không hỏng; thông báo "khi bạn vắng mặt…" |
| May mắn ngoài đồng chênh nhiều (0,8–2 giờ) | Thấp | Chủ đích: tạo bất ngờ; chỉnh tỉ lệ rơi nếu thấy bất công |
| Lạm phát trứng / túi hạt | Trung bình | Kho có hạn, gà có tuổi thọ, túi tối đa 9 hạt |
| Gian lận cánh đồng khi online | Cao | Server quyết định hạt, giới hạn 1 hạt / 15 giây / gà |
| Mô phỏng cánh đồng nặng khi đông | Cao (chủ đích học) | Chỉ mô phỏng khi có người xem, lưới không gian, tick cố định |

## 8. Quyết định của chủ dự án (2026-11-10)

| # | Câu hỏi | Quyết định |
|---|---|---|
| D1 | Nhịp thời gian | Ấp 5–30 phút tuỳ giống; lớn 20 phút → 24 giờ tuỳ dinh dưỡng; tuổi thọ 2–5 ngày |
| D2 | Gà có chết? | Có, vì tuổi già |
| D3 | Kiếm ăn | Thả gà ra đồng để gà tự tìm thức ăn, không điều khiển nhân vật |
| D4 | Thụ tinh | Chỉ nở được khi trại có ≥ 1 trống; gen của cả bố và mẹ; không trống → chỉ để đổi |
| D5 | Tiền tệ | Không có tiền tệ |
| D6 | Dinh dưỡng | Mỗi chất phát triển một nhóm kiểu hình |
| D7 | Biến dị | Mỗi gen một tỉ lệ biến dị |
| Q1 | Nhiều trống → ai làm bố? | Ngẫu nhiên |
| Q2 | Đói có giảm tuổi thọ? | Có |
| Q3 | Nhịp đẻ | Ngẫu nhiên, chỉ đẻ khi no bụng |
| Q4 | Khi người chơi vắng mặt | Phải quan sát; rời màn hình / tắt máy → gà tự về trại |
| Q5 | Thức ăn | Chỉ có hạt; ngoài đồng chủ yếu hạt thường; đổi ở cửa hàng có tỉ lệ hạt tốt cao |
| Q6 | Đổi chác | Trứng / gà → túi hạt mở ngẫu nhiên; trứng 2, gà 4–9 tuỳ độ trưởng thành, không theo độ hiếm; trứng và hạt chưa dùng nằm trong kho; người chơi tự đặt giá đổi với nhau; ổ ấp ban đầu 1, nâng cấp sau |

### Câu hỏi còn mở (đội đang dùng đề xuất)

| # | Câu hỏi | Đề xuất đang dùng |
|---|---|---|
| Q7 | Giữ **hạt lạ** (tăng biến dị)? | Giữ, rất hiếm (1,2% ngoài đồng, 3% trong túi) |
| Q8 | Nâng cấp ổ ấp / chỗ chuồng bằng gì? | Chưa làm; đề xuất: mở theo mốc sổ sưu tầm (M4) |
| Q9 | Người chơi đặt giá bằng gì? | Bằng hạt (theo loại) hoặc trứng / gà khác |
| Q10 | Sức chứa | Kho trứng 12, kho hạt 120, túi chưa mở 20, chuồng 6 gà |

## 9. Sprint 2 — kết quả (2026-11-10)

| Đội | Giao | Ghi chú |
|---|---|---|
| Lõi | Q7 `fieldFind` (no rồi → hạt về kho), `game/field.js` (AI gà kiếm ăn, bước 100 ms, dùng lại ở M3) | 25 test qua |
| Client | `game.html` + `js/game/main.js`: chọn trứng, Trại, Cánh đồng (chỉ chạy khi đang xem), Kho & cửa hàng, Kỷ niệm, bảng dev tua thời gian | Đã chơi thử trọn vòng trên trình duyệt |
| Đồ hoạ | Dáng đi (4 khung) và mổ cho Phẳng 1; `js/art/icons.js`: 7 loại hạt, 4 chất, túi hạt, ổ ấp, nền cánh đồng, hạt lấp lánh | Dáng đứng giữ nguyên từng byte |
| Server | `docs/chicken-farm/server-design.md`: API M2, SQLite, nhật ký hành động, chống gian lận, giao thức cánh đồng M3, kế hoạch thử tải | Câu hỏi SV1–SV9 chờ chủ dự án |

Việc dời sang M2 theo phát hiện của đội Server: mô phỏng gà lần lượt từng phút cho mọi gà (sát giới hạn kho trứng); server tung ngẫu nhiên bằng khoá bí mật (túi hạt, hạt ngoài đồng); số hạt mọc theo kích thước cánh đồng (M3).

## 10. Sprint 3 — quyết định mới của chủ dự án (2026-11-10)

| # | Quyết định | Đã làm |
|---|---|---|
| D8 | Trại là một **sân** cùng phong cách cánh đồng, gà đi lại trong sân | Sân trại trong tab Trại (mô phỏng chỉ để ngắm, không ảnh hưởng luật); bấm gà → tới thẻ của nó |
| D9 | **Mỗi người chơi chỉ thả 1 con** ra cánh đồng | `release` trả `field_busy`; client tự đổi chỗ khi chọn con khác |
| D10 | Thêm **chỉ số tốc độ** | Gen *Tốc độ* (thêm cuối danh sách, mã gen cũ vẫn đọc được); quyết định 80% tốc độ ngoài đồng (20% còn lại theo chân dài); hiện trên thẻ gà |
| D11 | **Đổi gà lấy trứng ngẫu nhiên** (có phôi, trống/mái 50/50) để không bị kẹt khi thiếu gà trống | `tradeForEgg`; nút "Đổi lấy trứng" trên thẻ gà |
| D12 | **Sân trại là màn hình chính**, kéo thả bằng chuột / cảm ứng: kéo gà ra cổng (ra đồng, 1 con), nhặt trứng, kéo trứng vào ổ để ấp; các tương tác khác do đội tự thiết kế | Trứng mới đẻ nằm ngoài sân (`collectEgg`); điểm thả: cổng, chợ (đổi túi hạt / trứng ngẫu nhiên), chuồng (chạm → kho, thả trứng → nhặt), máng ăn (tự chọn hạt bù chất thiếu), ổ ấp; kéo hạt từ khay lên gà để cho ăn; chạm gà → bảng thông tin; gà con chui ra ở ổ ấp; gà đói ngồi nghỉ |

### Sprint 3 — kết quả

| Đội | Giao |
|---|---|
| Lõi + client | Luật D9–D12; giao diện sân trại kéo thả (Pointer Events, chuột + cảm ứng); 29 test luật |
| Đồ hoạ | `yardBackdrop` + `YARD_SPOTS` (chuồng, máng, nước, ổ rơm, cổng, chợ), dáng ngồi `sit` + mí mắt, `statIcon`, `nestEggSvg` |
| Server | `server/` — M2 chạy được: khách, API theo từng hành động, SQLite (WAL), nhật ký hành động + replay, HMAC cho hạt ngoài đồng, nhịp "đang xem" 10 s / hết hạn 20 s, chỉ số trên cổng quản trị; 26 test |
| Cân bằng | (đang chạy) mô phỏng 7 ngày, 3 kiểu người chơi |

Việc tồn: rules nhận `rng` từ ngoài cho `openBag` / `tradeForEgg` / đẻ trứng (server hiện tráo tạm `state.seed`); client chưa nối server (M2 client); WebSocket cánh đồng (M3).

## 11. Sau báo cáo cân bằng (2026-11-11)

Chi tiết: `docs/chicken-farm/balance-report.md`, công cụ `tools/chicken-farm/balance-sim.mjs`.

**Đã áp dụng (thuộc quyền đội — chỉnh số, sửa lỗi):**

| Thay đổi | Trước → sau | Lý do |
|---|---|---|
| `satietyMax` / `satietyDrainPerHour` | 100 / 45 → 200 / 25 | No đầy giữ ~8 giờ, qua được đêm ngủ |
| `starveAging` | 3 → 2 | Đói vẫn giảm tuổi thọ (Q2) nhưng bớt khắc nghiệt |
| `layMeanHours` | [3, 1] → [6, 2] | Bớt lạm phát trứng / túi hạt |
| Gà bị luật từ chối khi mổ (kho đầy…) | mổ lại ngay → nghỉ 2× thời gian chờ | Người "Cày" bị từ chối ~190 nghìn lần/ván |
| `openBag` / `tradeForEgg` nhận `{ rng }` | server tráo seed tạm → server truyền nguồn ngẫu nhiên HMAC | Hook đội Server yêu cầu |

Kết quả (luật hiện tại + gói trên, 24 ván): tuổi thọ mất vì đói Ghé thăm/Chăm/Cày **58/33/30% → 16/3/0%**; nhưng **ngõ cụt vẫn 100%** vì chỉ có 1 trứng khởi đầu.

**Cần chủ dự án chốt:**

| # | Câu hỏi | Phương án (đã đo) |
|---|---|---|
| Q11 | Sửa ngõ cụt "1 trứng khởi đầu" | **A**: khởi đầu 2 trứng (1 trống + 1 mái) → ngõ cụt 0/0/0%. **C**: giữ 1 trứng; khi trại có mái mà không có trống trưởng thành, trứng có 50% có phôi nhờ "trống rừng ghé qua" → ngõ cụt 0/0/0%, giữ đúng tầm nhìn "bắt đầu với một quả trứng" |
| Q12 | Chặn vòng lặp đổi gà ↔ trứng để "quay gen" | Chỉ cho đổi gà đã trưởng thành, hoặc giới hạn N lần/ngày |
| Q13 | Chuồng 6 chỗ chặn ấp ở 100% ván Chăm/Cày | Cần cơ chế nâng cấp chuồng (đã hoãn) — đề xuất mở theo sổ sưu tầm |

**Chủ dự án đã chốt (11/11):**

| # | Quyết định | Đã làm | Đo lại (32 ván/kiểu chơi) |
|---|---|---|---|
| Q11 | Giữ **1 trứng khởi đầu**; **đổi 1 gà lấy 2 trứng** ngẫu nhiên có phôi | `tradeForEgg` trả 2 trứng (`CONFIG.trade.eggsPerChicken`) | Ngõ cụt Ghé thăm/Chăm/Cày **100% → 0/0/0%**; gà nở 7 ngày **1 → 15/14/15**; còn sống ngày 7 **0 → 5/6/5**; mỗi ván chỉ đổi ~2 lần |
| Q12 | **Chỉ gà trưởng thành** mới đổi lấy trứng | `not_adult` | — |

Điểm nghẽn kế tiếp: chuồng 6 chỗ chặn ấp ở 94–100% ván (Q13, nâng cấp chuồng — đang hoãn). "Bỏ bê" (1 lần/ngày) vẫn mất trại: chấp nhận được hay cần máng ăn tự động? (Q14)

## 12. M2 client — trang game nối server (2026-11-11)

- `js/game/net.js`: tài khoản khách (token trong localStorage theo từng máy chủ), `aid` cho mỗi hành động, gọi API M2.
- `main.js`: mọi thao tác đi qua `act(tên, tham số)` — offline gọi thẳng `rules.js`, online gửi server rồi thay trại bằng bản server trả về (không có `seed`). Online: giờ theo server, đồng bộ `GET /api/farm` mỗi 4 giây, lọc sự kiện trùng, nhịp tim cánh đồng mỗi 8 giây, rời trang → `recallAll` kiểu keepalive; hạt ngoài đồng trông như nhau, loại hạt do server tung và hiện khi gà mổ trúng. Dev: tua thời gian tắt khi online.
- Bật: `game.html?server=http://127.0.0.1:8787` (hoặc ô "Máy chủ" trong bảng Dev); `?server=` (rỗng) quay về offline.
- Đã chạy thử đầu-cuối với server thật trên máy: tạo khách → chọn trứng → ấp → cho ăn → ra đồng (server tung hạt, nhịp tim giữ gà ngoài đồng > 20 giây) → về trại (`recallAll`). Số đo server: 26 request, 0 từ chối, 0 lần server phải tự gọi gà về.
- Còn lại cho M2: triển khai server lên máy Windows + Cloudflare Tunnel (`game.vuducan.qzz.io`) — việc của chủ dự án, hướng dẫn ở `server/README.md`.

## 13. Quyết định Q13 / Q14 (2026-11-12) — luật v5

Chủ dự án chốt theo khuyến nghị trong [`design-review.md`](design-review.md) §4–5.

| # | Quyết định | Cài đặt |
|---|---|---|
| D13 (Q13) | **Mở chuồng theo Sổ sưu tầm**: mỗi mốc ★★ +2 chỗ chuồng (trần 12), mốc đầu tặng **ổ ấp thứ 2**; chuồng đầy thì gợi ý **đổi con gà sắp hết tuổi lấy túi hạt** để có chỗ | `CONFIG.dex` (mốc 7 / 11 / 15 mục ★★), `DEX` (18 đặc điểm, mỗi mục gắn một nhóm chất), `state.dex` / `state.milestones`, sự kiện `dex` / `milestone`; nút **Sổ** + hộp thoại "Chuồng hết chỗ" ở client |
| D14 (Q14) | **Gà con chờ trong ổ**: trứng ấp xong lúc người chơi vắng thì nở khi người chơi quay lại (không có máng ăn tự động) | `advance(state, now, { present })`, `state.seenAt`, `CONFIG.hatchPresenceGraceMs` (2 phút); server: hành động nguồn `system` = vắng mặt, GET /api/farm ghi `advance` (nguồn `view`) khi có trứng chờ; replay dùng cột `source` |

Sổ v5 mới làm phần ★/★★ (đủ cho mốc chuồng). ★★★ thuần chủng và "giống" đặt tên (Q-Dex B+C) vẫn chờ chủ dự án chốt.

Mô phỏng 32 ván × 7 ngày (luật v5, `node tools/chicken-farm/balance-sim.mjs --scenarios hien-tai`):

| | Ghé thăm | Chăm | Cày | Bỏ bê |
|---|---|---|---|---|
| Gà nở / 7 ngày (v4 → v5) | 14 → 17 | 14 → 18 | 15 → 19 | 1 → 5 |
| Tuổi thọ mất vì đói (v4 → v5) | 19% → 26% | 0% → 0% | 0% → 0% | 44% → 36% |
| Ngõ cụt (v4 → v5) | 0% → 0% | 0% → 0% | 0% → 0% | **97% → 0%** |
| Mốc sổ đạt sau 7 ngày | 1 | 1 | 1 | 1 |

Ghé thăm đói nhiều hơn vì chuồng lớn hơn = nhiều miệng ăn hơn (design-review đã đo trước); vẫn dưới mốc 28% của `balance.test.mjs`. Mốc 3 (15/18 mục) cần thêm đa dạng gen (trao đổi M5, biến dị) → đích dài hạn.
