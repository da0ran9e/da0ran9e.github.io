# Trại Gà — Báo cáo cân bằng tuần đầu (mô phỏng)

> Đội Cân bằng / QA · 2026-11-10 · đo trên `rules.js` + `field.js` bản cuối ngày 10/11 (có luật **1 con ngoài đồng** `field_busy`, gen **Tốc độ**, `tradeForEgg`, trứng **ngoài sân** + `collectEgg`).
> Không sửa luật. Mọi đề xuất CONFIG được thử bằng cách ghi đè `CONFIG` trong tiến trình mô phỏng; các "vá thiết kế" chưa có trong luật được **giả lập ở tầng mô phỏng** và ghi rõ.

## 1. Tóm tắt

1. **Hiện tại 100% trại đi vào ngõ cụt, ở mọi kiểu chơi.** Người chơi chỉ có **một** quả trứng, nên không bao giờ có cặp trống + mái. Trại chết hết sau 29–60 giờ. `tradeForEgg` **không cứu được** trường hợp này: nó đổi 1 gà lấy 1 trứng, nên tổng "gà + trứng có phôi" không bao giờ tăng từ 1 lên 2. Trong 160 ván, `tradeForEgg` được dùng **0 lần**.
2. **Bụng chỉ chứa đủ 2,2 giờ** (100 ÷ 45/giờ), trong khi người chơi ngủ 8 giờ. Đêm nào gà cũng nhịn đói ≥ 5,8 giờ và già nhanh gấp 3. Ngay cả người "Cày" cũng mất **30%** tuổi thọ; người "Ghé thăm" mất **58%**. Gà của người "Ghé thăm" chết trước khi kịp đẻ.
3. Vá **A — trứng khởi đầu là một cặp trống + mái** — cộng với **gói CONFIG** (bụng 200, đói 25/giờ, già khi đói 2×, đẻ thưa 6–2 giờ/trứng) đưa tỉ lệ ngõ cụt từ **100% xuống 3% / 0% / 0%** (Ghé thăm / Chăm / Cày). Trong một trại đã có cặp, `tradeForEgg` có ích thật: bỏ nó đi thì ngõ cụt tăng lại thành **33% / 8% / 13%**.
4. Với người chơi nhiều, **kho và chuồng đầy** mới là giới hạn, chứ không phải luật 1 con ngoài đồng. Kho hạt đầy ngay ngày 1. Người "Cày" bị từ chối khoảng **190.000 lần mổ** mỗi ván, và nở số gà ngang người "Chăm" (18 so với 18).

## 2. Cách làm

**Công cụ:** `tools/chicken-farm/balance-sim.mjs` (Node 24, ESM, không thư viện ngoài, chạy song song bằng `worker_threads`).

```
node tools/chicken-farm/balance-sim.mjs                     # 12 kịch bản × 4 kiểu chơi × 32 ván, ~86 giây trên 8 lõi
node tools/chicken-farm/balance-sim.mjs --runs 40           # số liệu trong báo cáo này (~2 phút 10 giây trên 8 lõi)
node tools/chicken-farm/balance-sim.mjs --list              # liệt kê kịch bản / kiểu chơi
node tools/chicken-farm/balance-sim.mjs --scenarios hien-tai --set laySatiety=40 --set sim.autoFeeder=true
node tools/chicken-farm/balance-sim.mjs --json out.json     # xuất số liệu đã tổng hợp
```

**Một ván:**

- Chơi 7 ngày, mở game lúc 7:00, thức 7:00–23:00.
- Seed giống nhau giữa các kịch bản, nên mỗi kịch bản được so theo cặp với mốc.
- **Một phiên** gồm các bước:
  1. `advance` tới đầu phiên.
  2. Việc nhà, theo thứ tự: nhặt trứng ngoài sân (`collectEgg`) → `tradeForEgg` nếu cần → ấp → đổi trứng thừa lấy túi → mở túi → cho ăn.
  3. Xem cánh đồng bằng chính `createField` / `tickField` (bước 100 ms). Mỗi sự kiện `found` gọi `rules.fieldFind` rồi `setReadyAt`, giống hệt `main.js`.
  4. Chỉ thả **1 con**. Chọn con đói nhất (`release`, có kiểm `field_busy`), và đổi con mỗi 5–10 phút. Tốc độ lấy từ `fieldTraits` (gen Tốc độ + chân) × (0,6 + 0,4 × độ lớn), giống `main.js`.
  5. Cuối phiên: `recallAll`, rồi làm việc nhà lần nữa.
- Giữa các phiên chỉ chạy `rules.advance`. Cứ 10 phút lại lấy mẫu trạng thái; luật tái lập theo phút nên việc lấy mẫu không làm đổi kết quả.

**Hành vi người chơi:**

- **Cho ăn:** chia vòng tròn mỗi con một hạt, cho tới khi đầy. Thứ tự ưu tiên: gà con → mái → trống. Gà đang lớn được chọn hạt bù chất đang thiếu; gà đã lớn ăn hạt thường trước.
- **Trứng:** ấp mọi trứng có phôi khi còn ổ và còn chỗ trong chuồng. Giữ tối đa 2 trứng có phôi; trứng không phôi và trứng có phôi dư đem đổi túi.
- **`tradeForEgg`:** chỉ dùng khi có ≥ 2 gà **cùng giới** và không còn trứng có phôi nào. Khi đó đổi con sắp hết tuổi nhất, rồi ấp ngay quả trứng nhận được. Trại chỉ có 1 con thì không đổi, vì đổi chỉ "quay lại giới tính" mà số gà vẫn là 1.

**Kiểu chơi:**

| Mã | Kiểu chơi | Lịch |
|---|---|---|
| `casual` | Ghé thăm | 3 phiên/ngày (8h, 13h, 20h ± 45 phút) × 10 phút |
| `engaged` | Chăm | Thức thì cứ 60–120 phút một phiên, mỗi phiên 10–15 phút |
| `hardcore` | Cày | Xem đồng liên tục 7:00–23:00, làm việc nhà và đổi gà mỗi 10 phút |
| `neglect` | Bỏ bê | 1 phiên/ngày (18–22h) × 10 phút |

**Ngõ cụt:** trại **chắc chắn không bao giờ có lứa mới**, dù người chơi làm gì, theo luật và bản vá đang dùng. Ví dụ: chỉ còn 1 gà và không có trứng có phôi; hoặc mọi gà cùng giới, không có trứng có phôi và không dùng `tradeForEgg`. Mốc tính là trạng thái cuối ngày 7. (Chạy mặc định 32 ván cho ra cùng kết luận, sai lệch ≤ 6 điểm %.)

**Cách đọc số:** viết `trung vị [p10–p90]` trên 40 ván. Phần trăm thời gian tính trên mẫu 10 phút.

## 3. Hiện trạng (kịch bản `hien-tai`: luật hiện tại, người chơi biết dùng `tradeForEgg`)

| | Ghé thăm | Chăm | Cày | Bỏ bê |
|---|---|---|---|---|
| Giờ tới lần nở đầu | 0,27 [0,20–0,36] | 0,27 | 0,27 | 0,27 |
| Giờ tới gà trưởng thành đầu | 24,8 [13,2–26,2] | 5,8 [4,0–6,9] | 1,4 [1,2–1,7] | không bao giờ (0%) |
| Chất lượng nuôi lúc trưởng thành (dev 0–1) | 0,42 | 0,43 | 0,72 | — |
| Gà nở trong 7 ngày (gồm trứng khởi đầu) | 1 | 1 | 1 | 1 |
| Trứng/ngày: có phôi / không phôi | 0 / 0,0 [0–0,3] | 0 / 0,9 [0–2,2] | 0 / 1,7 [0–3,7] | 0 / 0 |
| % thời gian gà bụng rỗng | 70% | 24% | 20% | 96% |
| % thời gian mái lớn có độ no < `laySatiety` | 87% | 58% | 26% | — |
| Tuổi thọ mất vì đói | 58% | 32% | 28% | 66% |
| Chết khi đang đói / tổng số chết | 80% | 28% | 25% | 100% |
| Trại chết hết lúc (giờ) | 35 [32–40] | 57 [48–66] | 60 [51–68] | 29 [26–32] |
| **Ngõ cụt cuối ngày 7** | **100%** | **100%** | **100%** | **100%** |
| `tradeForEgg` được dùng | 0% ván | 0% | 0% | 0% |
| Hạt trong kho, cuối ngày 1 / ngày 7 | 66 / 120 | 120 / 120 | 120 / 120 | 12 / 12 |

Kịch bản `goc` (không dùng `tradeForEgg`) cho kết quả **giống hệt từng số**.

Trứng khởi đầu (lựa chọn 0) là mái trong 55% seed. Dù mái hay trống, cả hai trường hợp đều là ngõ cụt.

## 4. Kinh tế khi đã có một cặp (kịch bản `cap-khoi-dau` = vá A, CONFIG hiện tại)

Ở hiện trạng, trại sống chưa đủ lâu để đo kho, túi hay đẻ. Vì vậy bảng dưới đây dùng **vá A** làm mốc để đo các hệ thống còn lại.

| | Ghé thăm | Chăm | Cày | Bỏ bê |
|---|---|---|---|---|
| Gà nở trong 7 ngày | 2 [2–3] | 18 [16–20] | 18 [18–21] | 2 |
| Giờ tới gà trưởng thành đầu | 25,1 [13,8–30,3] | 6,6 [4,3–8,0] | 1,2 [1,1–1,5] | không bao giờ |
| Thời gian lớn, mọi gà (giờ) | 24,2 [12,4–30,3]; 55% > 24 giờ | 2,0 [1,3–8,5] | 0,46 [0,36–1,4]; 95% < 2 giờ | — |
| Chất lượng nuôi (dev) | 0,40 | 0,86 | 0,96 | — |
| Gà trưởng thành, TB ngày 1 / 3 / 5 / 7 | 0 / 0 / 0 / 0 | 1,6 / 5,4 / 5,6 / 5,5 | 4,6 / 5,2 / 5,8 / 5,8 | 0 |
| Trứng có phôi / ngày | 0,0 [0–0,2] | 12,1 [8,0–19,2] | 24,9 [18,3–32,0] | 0 |
| Chết khi đang đói / chết già (trung vị) | 2 / 0 | 6 / 7 | 6 / 6 | 2 / 0 |
| Tuổi thọ mất vì đói | 58% | 33% | 30% | 66% |
| % thời gian mái lớn có độ no < 60 | 86% | 56% | 29% | — |
| Túi nhận / túi mở | 0 / 0 | 71 / 66 | 157 / 156 | 0 |
| Giờ có gà ngoài đồng / ngày | 0,12 | 2,0 | 16,0 | 0,02 |
| Hạt nhận từ đồng / giờ có gà ra đồng | 217 | 176 | **38** | 216 |
| Lần mổ bị từ chối vì kho đầy / ván | 261 | 6.071 | **190.033** | 0 |
| Ván có túi không mở được vì kho hạt đầy | 15% | 100% | 100% | 0% |
| Ván có trứng chờ ấp nhưng chuồng đầy (6) | 0% | 100% | 100% | 0% |
| **Ngõ cụt cuối ngày 7** | **100%** | **0%** | **0%** | **100%** |

**Tồn kho hạt theo loại** (thường / đạm / mẩy / khoáng / màu / quý / lạ, trung vị):

| | Cuối ngày 1 | Cuối ngày 4 | Cuối ngày 7 |
|---|---|---|---|
| Chăm | 116/0/0/0/0/0/0 | 50/15/13/13/13/2/9 | 34/3/2/22/29/3/17 |
| Cày | 91/4/5/5/3/3/2 | 0/12/0/32/39/9/19 | **0**/8/0/11/46/14/**34** |
| Ghé thăm | 54/0/… | 115/1/0/… | 115/1/0/0/1/0/0 |

## 5. Năm vấn đề lớn nhất

### P1. Ngõ cụt chắc chắn: 100% ở mọi kiểu chơi

- Nguồn gà duy nhất là trứng có phôi. Trứng có phôi chỉ đến từ (a) trứng khởi đầu, (b) một cặp trống + mái, hoặc (c) `tradeForEgg`, mà (c) lại tốn một con gà.
- Vì vậy khi chưa có cặp, đại lượng *gà + trứng có phôi* **không bao giờ tăng**. Trại bắt đầu ở 1, nên mãi mãi là 1.
- Mô phỏng khớp với lập luận này: **160/160 ván ngõ cụt từ giờ 0**, và trại chết hết sau 29–60 giờ.
- Trứng khởi đầu là trống hay mái đều như nhau: trống không đẻ; mái chỉ đẻ trứng không phôi.

### P2. Đói cả đêm: bụng chỉ chứa 2,2 giờ

- Bụng đầy (`satietyMax` 100) cạn sau 2,2 giờ (`satietyDrainPerHour` 45). Người chơi ngủ 8 giờ, nên đêm nào gà cũng nhịn ≥ 5,8 giờ. Lúc nhịn, gà vừa **ngừng lớn** vừa **già gấp 3**.
- Tuổi thọ mất vì đói: Ghé thăm 58%, Chăm 33%, **Cày 30%**, Bỏ bê 66%.
- 46–85% số gà chết trong lúc đang đói.
- Đây là vòng xoáy: đói làm gà ngừng lớn → gà trưởng thành muộn (Ghé thăm: 25 giờ) → chết sớm (35 giờ) → không kịp đẻ.

### P3. Đẻ quá khó với người không cày

- Mái chỉ đẻ khi độ no ≥ 60, tức trong khoảng **53 phút** sau khi được cho ăn no.
- Tỉ lệ thời gian mái lớn có độ no dưới 60: Ghé thăm **86%**, Chăm 56%.
- Kết quả là người Ghé thăm, **dù đã có cặp**, đẻ **0 trứng có phôi mỗi ngày (trung vị)**, và 100% ván ngõ cụt.
- Ngược lại, người Cày đẻ **25 trứng/ngày**. Chênh lệch giữa hai kiểu chơi quá xa.

### P4. Kho và chuồng đầy, nên cày không được thưởng

- **Kho hạt:** chạm trần 120 ngay **ngày 1** ở 100% ván Chăm và Cày.
  - Từ đó cánh đồng gần như vô dụng. Hạt nhận mỗi giờ của người Cày giảm từ 217 xuống **38**; số còn lại bị từ chối.
  - Gà no mà kho đầy thì cứ mổ là bị từ chối: `fieldFind` trả `seeds_full` nhưng không đặt lại thời gian chờ. Người Cày bị từ chối **190.000 lần mỗi ván**, khoảng 1.700 lần mỗi giờ xem, tức cứ ~2 giây một lần. Ở M3 đây là tải server thừa, và trên giao diện là chuỗi thông báo "Kho đầy" không dứt.
- **Chuồng 6 con:** chặn ấp ở 100% ván Chăm và Cày.
- Hệ quả: **Cày nở 18 gà, đúng bằng Chăm.** Phần thưởng thêm duy nhất của người Cày là chất lượng nuôi (dev 0,96 so với 0,86).

### P5. Lạm phát trứng → túi → hạt tốt; hạt thường cạn kiệt

- Chuồng chỉ cần khoảng 2 trứng/ngày, nhưng người Chăm đẻ 12 và người Cày đẻ 25. Hơn 90% số trứng thành túi (Cày: 157 túi/tuần), mà túi thì cho 60% hạt tốt.
- Kho của người Cày đến ngày 4 hết sạch hạt thường; ngày 7 còn **34 hạt lạ** và 46 hạt màu. "Hạt quý / hạt lạ rất hiếm" (Q7) không còn đúng với người chơi nhiều.
- Hạt ngoài đồng (92% hạt thường) bị đẩy ra khỏi kho.

### Phụ: luật 1 con ngoài đồng hạn chế thức ăn tới đâu?

Thử giả định bỏ luật 1 con (`nhieu-ga-dong`: mọi gà cùng ra đồng, vượt luật):

- **Với CONFIG hiện tại, luật 1 con gần như không làm thiếu thức ăn.**
  - Hạt tìm được mỗi ngày: Ghé thăm 26 → 27; Chăm 357 → 402 (+13%); Cày 599 → 800.
  - Số gà nở không đổi (18 → 18).
  - Ngược lại, mổ bị từ chối tăng mạnh: Chăm 6.071 → 90.886; Cày 190.033 → 871.523. Ở 98–100% ván Chăm/Cày, kho trứng và kho túi tắc, vì không mở được túi khi kho hạt đầy.
- **Với gói đề xuất ở §6, luật 1 con bắt đầu làm thiếu thức ăn — nhưng chỉ với người Ghé thăm.** Gà no lâu hơn nên ăn nhiều hơn, và thức ăn thành giới hạn thật:
  - Người Ghé thăm: cung (đồng + túi) chỉ bằng 0,50 nhu cầu, kho cạn về 0 vào ngày 7.
  - Bỏ luật 1 con thì hạt/giờ 219 → 430, thời gian bụng rỗng 47% → 22%, tuổi thọ mất 33% → 17%.
  - **Muốn giữ luật 1 con mà có cùng hiệu quả:** giảm `fieldEatCooldownMs`. Ở 7,5 giây: hạt/giờ 381, bụng rỗng 22%, tuổi thọ mất 17% — tương đương bỏ luật. Ở 10 giây: 311 hạt/giờ, bụng rỗng 31%, tuổi thọ mất 22%.

## 6. Đề xuất CONFIG (ghi đè trong mô phỏng, chưa sửa `rules.js`)

| Khoá | Hiện tại | Đề xuất | Lý do |
|---|---|---|---|
| `satietyMax` | 100 | **200** | Bụng chứa được một đêm. Đầy bụng = 16 hạt thường, nên kho hạt có ý nghĩa hơn |
| `satietyDrainPerHour` | 45 | **25** | Thời gian no: 2,2 giờ → **8 giờ**. Nhu cầu: 90 → 50 hạt thường / gà / ngày |
| `starveAging` | 3 | **2** | Đói vẫn bị phạt (Q2), nhưng không thành vòng xoáy chết |
| `layMeanHours` | [3, 1] | **[6, 2]** | Mái no lâu hơn thì đẻ nhiều hơn; nhịp đẻ thưa đi để bù, giảm lạm phát trứng/túi ở người chơi nhiều |
| `laySatiety` | 60 | 60 (giữ) | Khi `satietyMax` = 200, ngưỡng 60 chỉ còn bằng 30% bụng: đẻ được trong ~5,6 giờ sau khi ăn no |
| `fieldEatCooldownMs` (tuỳ chọn) | 15 s | 10 s | Bù cho luật 1 con khi người Ghé thăm thiếu ăn (xem phụ của §5). Đây là thông số chống gian lận — cần đội Server đồng ý |

### Trước / sau (đều có vá A; 40 ván; trung vị)

`cap-khoi-dau` = CONFIG hiện tại · `de-xuat-no` = chỉ đổi bụng (200 / 25) · `de-xuat-tong` = cả gói

| | Kiểu chơi | Hiện tại | Chỉ đổi bụng | Cả gói |
|---|---|---|---|---|
| **Ngõ cụt** | Ghé thăm | 100% | 3% | **3%** |
| | Chăm / Cày | 0% / 0% | 0% / 0% | 0% / 0% |
| | Bỏ bê | 100% | 100% | 98% |
| Gà nở trong 7 ngày | Ghé thăm | 2 | 18 | 15 [13–16] |
| | Chăm / Cày | 18 / 18 | 13 / 13 | 13 / 13 |
| Giờ tới gà trưởng thành đầu | Ghé thăm | 25,1 | 6,7 | **6,7** [6,1–7,3] |
| | Chăm / Cày | 6,6 / 1,2 | 2,6 / 0,8 | 2,6 / 0,8 |
| | Bỏ bê | không bao giờ | 61,5 | 38,0 |
| Thời gian lớn (giờ) | Ghé thăm | 24,2 [12,4–30,3] | 7,3 | 7,2 [5,1–16,7] |
| Chất lượng nuôi (dev) | Ghé thăm / Chăm / Cày | 0,40 / 0,86 / 0,96 | 0,71 / 0,88 / 0,96 | 0,71 / 0,88 / 0,96 |
| Gà trưởng thành TB, ngày 7 | Ghé thăm | 0 | 3,3 | 3,7 |
| Tuổi thọ mất vì đói | Ghé thăm | 58% | 47% | **33%** |
| | Chăm | 33% | 6% | **3%** |
| | Cày | 30% | 1% | **0%** |
| | Bỏ bê | 66% | 65% | 44% |
| Chết khi đang đói / tổng số chết | Chăm | 46% | 8% | 9% |
| % thời gian mái có độ no < ngưỡng đẻ | Ghé thăm / Chăm | 86% / 56% | 59% / 14% | 68% / 13% |
| Trứng có phôi / ngày | Ghé thăm | 0,0 | 6,4 | 2,9 |
| | Chăm | 12,1 | 23,8 | 14,5 |
| | Cày | 24,9 | 32,0 | **15,0** |
| Túi / tuần | Chăm | 71 | 148 | 86 |
| | Cày | 157 | 203 | **88** |
| Ván kho trứng đầy | Chăm | 8% | **88%** | 20% |
| Hạt trong kho cuối ngày 7 | Ghé thăm | 119 | 0 | 0 |

Đọc bảng:

- **Chỉ đổi bụng** đã gỡ được P2 và P3. Nhưng gà no lâu thì đẻ nhiều, nên trứng/túi tăng vọt (Chăm 148 túi, kho trứng đầy ở 88% ván). Vì thế cần thêm `layMeanHours` [6, 2].
- **Cả gói** giữ được lợi ích của việc đổi bụng và kéo lạm phát về **thấp hơn hiện tại**: người Cày từ 157 xuống 88 túi.
- Người Ghé thăm lần đầu tiên nuôi được một trại: 15 gà nở, gà trưởng thành sau 6,7 giờ.
- Đánh đổi: thức ăn trở thành giới hạn với người Ghé thăm (kho về 0 vào ngày 7). Điều này hợp với trụ cột 3 — "chăm thì được thưởng".
- `chi-config` = cả gói CONFIG nhưng **không** có vá A: vẫn **100% ngõ cụt**. Gà sống lâu hơn (Ghé thăm: tuổi thọ mất 16%, chết ở giờ 71), nhưng vẫn chỉ có một con.
- **Bỏ bê** (10 phút/ngày) vẫn hỏng: 98% ngõ cụt, kể cả khi thêm "máng ăn" tự cho ăn từ kho (`may-an`: 98%). Lý do: trứng nở lúc người chơi đã đi, gà con đói gần một ngày mới có người cho ăn. Đề xuất chấp nhận rằng 1 lần/ngày không đủ để gây giống. Nếu muốn cứu kiểu chơi này, cần một cơ chế khác: "gà con nở ra chờ trong ổ ấp, không đói, cho tới khi người chơi mở game". Cơ chế này chưa đo.

Các thử nghiệm bị loại (chạy được bằng `--scenarios thu-…`):

- `thu-de-de` (`laySatiety` 30): không cứu được người Ghé thăm, vẫn 100% ngõ cụt — vì gà chết đói trước khi trưởng thành.
- `thu-lon-nhanh` (`growMs.worst` 8 giờ, `nutrientDrain` 15): gà Ghé thăm trưởng thành nhanh hơn (25 → 7,4 giờ) nhưng vẫn **93% ngõ cụt**, vì vẫn đói 71% thời gian. Khi ghép với gói bụng 200, chất lượng nuôi còn **giảm** (0,71 → 0,56), vì gà lớn nhanh ngay cả lúc thiếu chất, đi ngược trụ cột 2.
- `thu-doi-cu` (đói 20/giờ, già khi đói 2×, bụng vẫn 100): ngõ cụt Ghé thăm 13%, tuổi thọ mất 28%, nhưng gà trưởng thành đầu vẫn mất 24,4 giờ. Kém gói đề xuất.
- `thu-cooldown-10s` (gói đề xuất + `fieldEatCooldownMs` 10 s): Ghé thăm 0% ngõ cụt, tuổi thọ mất 22%, chất lượng nuôi 0,78.

## 7. Ngõ cụt "không có trống": `tradeForEgg` và vá tối thiểu

### Tỉ lệ ngõ cụt cuối ngày 7 (40 ván / ô)

| Kịch bản | Ghé thăm | Chăm | Cày | Bỏ bê |
|---|---|---|---|---|
| Luật hiện tại, không dùng `tradeForEgg` (`goc`) | 100% | 100% | 100% | 100% |
| Luật hiện tại + `tradeForEgg` (`hien-tai`) | 100% | 100% | 100% | 100% |
| **Vá A** (trứng khởi đầu 1 trống + 1 mái), không `tradeForEgg` | 100% | 15% | 15% | 100% |
| **Vá A** + `tradeForEgg` | 100% | **0%** | **0%** | 100% |
| Vá B (mái khởi đầu + đổi 3 trứng không phôi lấy 1 trứng có phôi) + `tradeForEgg` | 100% | 83% | 50% | 100% |
| Vá C (mái khởi đầu + "trống rừng": không có trống thì 50% trứng có phôi) + `tradeForEgg` | 98% | 3% | 0% | 100% |
| Gói CONFIG, **không** vá A (`chi-config`) | 100% | 100% | 100% | 100% |
| Vá A + gói CONFIG, không `tradeForEgg` | 33% | 8% | 13% | 100% |
| **Vá A + gói CONFIG + `tradeForEgg`** | **3%** | **0%** | **0%** | 98% |

### Kết luận

1. **`tradeForEgg` một mình không gỡ được ngõ cụt khởi đầu.** Đó là một phép bảo toàn: đổi 1 gà lấy 1 trứng. Với 1 con, đổi chỉ là quay lại giới tính.
   - Mặt trái: nó cho phép **"quay lại" gen vô hạn**. Ấp một trứng 5–30 phút, nhìn gà con, đổi lấy trứng mới, lặp lại. Đây có thể là lỗ hổng cho sổ sưu tầm (M4). Đề xuất: chỉ cho đổi gà đã trưởng thành, hoặc giới hạn số lần mỗi ngày.
2. **Khi trại đã có cặp, `tradeForEgg` là lối thoát tốt.** Ngõ cụt xảy ra khi trống cuối cùng chết già. Có `tradeForEgg`, tỉ lệ này giảm: Chăm 15% → 0%, Cày 15% → 0%; với gói CONFIG, Ghé thăm 33% → 3%. Nó chỉ được dùng ở 5–28% số ván, không lạm dụng.
3. **Vá tối thiểu đề xuất: vá A.** `newGame` tạo **2 quả trứng có phôi, một trống, một mái**. Người chơi vẫn được chọn 1 trong 3 quả về ngoại hình; quả thứ hai là "bạn đời", khác giới với quả đã chọn. Chỉ có 1 ổ ấp nên ấp lần lượt; chuồng 6 chỗ là đủ.
   - Mô phỏng giả lập vá này bằng cách thêm quả thứ hai ngay sau `newGame`.
   - Vá A **đủ** cho Chăm/Cày, nhưng **chỉ đủ cho Ghé thăm khi đi cùng gói CONFIG** (100% → 3%), vì vấn đề của Ghé thăm là đói (P2/P3) chứ không phải thiếu trống.
4. Vá C (trống rừng) cũng hiệu quả với Chăm/Cày và không cần đổi màn chọn trứng. Nhưng nó tạo trứng có phôi "từ trên trời", làm loãng ý nghĩa của việc giữ trống tốt (vòng dài). Vá B quá chậm, vì một mái đơn độc hiếm khi đủ no để đẻ 3 trứng.

## 8. Việc cần làm (ngoài CONFIG — đề xuất, không tự sửa)

| # | Đề xuất | Chủ |
|---|---|---|
| 1 | Vá A trong `newGame` (2 trứng có phôi, khác giới) | Lõi |
| 2 | Áp gói CONFIG ở §6 | Thiết kế duyệt, Lõi sửa |
| 3 | Khi `fieldFind` trả `seeds_full`, vẫn đặt `lastFieldEat` (hoặc cho gà "nằm nghỉ") để hết vòng mổ bị từ chối liên tục; ở M3 tránh khoảng 1.700 lệnh/giờ/người xem | Lõi + Server |
| 4 | Giới hạn `tradeForEgg` để không thành máy quay gen (chỉ gà trưởng thành, hoặc N lần/ngày) | Thiết kế |
| 5 | Cần thêm "đầu ra" cho người Cày khi chuồng và kho đầy (nâng cấp chuồng/kho theo mốc sưu tầm — Q8), nếu không thì cày không hơn chăm | Thiết kế |
| 6 | Thêm test cân bằng tự động: chạy `--scenarios de-xuat-tong --runs 32` và kiểm "ngõ cụt Ghé thăm ≤ 5%, Chăm/Cày = 0%" | QA |

## 9. Giới hạn của mô phỏng

- Người chơi giả lập chơi "khá khôn" nhưng không tối ưu. Họ không đổi gà lấy túi để lấy chỗ (`cullForSpace` mặc định tắt) và không biết trước giới tính của trứng.
- Mỗi phiên dùng một cánh đồng mới, với một người chơi. Cánh đồng chung (M3) chưa mô phỏng.
- Các vá A, B, C, "máng ăn" và "bỏ luật 1 con" là **giả lập ở tầng mô phỏng**. Khi đưa vào `rules.js` thật, cần chạy lại.
- Ngõ cụt chỉ đo trong 7 ngày. Trại "còn cặp" ở ngày 7 vẫn có thể gặp ngõ cụt muộn hơn; chạy `--days 14` để xem dài hơn.


## Cập nhật 11/11 (sau quyết định của chủ dự án)

- Đã áp gói CONFIG (bụng 200, đói 25/giờ, già khi đói 2×, đẻ 6–2 giờ) vào `rules.js`.
- Sửa lỗi mổ liên tục khi bị từ chối (client + sim: nghỉ 2× thời gian chờ).
- Chủ dự án chọn **đổi 1 gà trưởng thành lấy 2 trứng có phôi** thay cho vá A/C. Sim đã đổi chiến thuật: đổi con trưởng thành của giới đang thừa khi chưa có cặp.
- Kết quả `hien-tai` (32 ván): ngõ cụt Ghé thăm/Chăm/Cày/Bỏ bê = **0 / 0 / 0 / 100%**; gà nở 7 ngày 15 / 14 / 15 / 1; tuổi thọ mất do đói 31 / 3 / 0 / 44%; chuồng đầy chặn ấp ở 94 / 100 / 100% ván.

## Cập nhật 11/11 (chiều) — CONFIG v4 (đội Thiết kế + Kinh tế)

Chi tiết và đề xuất Q13/Q14/sổ sưu tầm/trao đổi: `docs/chicken-farm/design-review.md`.

- **Đã chỉnh:** `satietyDrainPerHour` 25 → **22**, `fieldEatCooldownMs` 15 s → **12 s**, `CONFIG.version` 3 → **4** (bản lưu offline cũ bị bỏ khi đổi phiên bản).
- Kết quả `hien-tai` (32 ván, v3 → v4): tuổi thọ mất do đói Ghé thăm/Chăm/Cày/Bỏ bê **31/3/0/44% → 19/0/0/44%**; chết khi đang đói ở Ghé thăm 69% → 44%; gà nở 7 ngày 15/14/15/1 → 14/14/15/1; ngõ cụt 0/0/0/100% → 0/0/0/97%; mổ bị từ chối vì kho đầy ở Cày 11.583 → 14.690 (cần sửa ở luật: gà no + kho đầy thì ngồi nghỉ).
- Thử và loại: `hatch.satiety` 120 (độ no chặn nạp chất → Chăm lớn chậm 2,6 → 7,5 giờ, chất lượng 0,87 → 0,71), `trade.egg` 3, `storage.seeds` 200, `nutrientDrainPerHour` 25 (không tác dụng đáng kể).
- **Công cụ:** kịch bản mặc định đổi thành mốc + phương án Q13 (`chuong-8`, `chuong-10`, `chuong-12`, `chuong-6-loc`, `chuong-10-loc`) và Q14 (`v4-may-an`, `v4-cho-trong-o`, `v4-may-an-cho-o`), thử số `so-*`, hành vi `vua-suc-4` (`sim.maxFlock`). Mới: `sim.hatchOnOpen` (giả lập gà con chờ trong ổ), số đo "sổ sưu tầm thử" và độ hiếm cao nhất. Kịch bản trước 11/11 (vá A/B/C…) vẫn chạy được bằng `--scenarios`. Lưu ý: trên zsh, mỗi `--set` phải là một tham số riêng.
- **Test:** `tests/chicken-farm/balance.test.mjs` (~2 giây) chạy mô phỏng 8 ván/kiểu chơi và kiểm mốc v4 (đã thấy trượt với số v3). `rules.test.mjs` bỏ số 20 s cứng, dùng `CONFIG.fieldEatCooldownMs`.
- Điểm nghẽn còn lại: chuồng 6 chặn ấp 100% ván (Q13); sổ sưu tầm thử bão hoà ~17 mục ở mọi kiểu chơi (vòng dài thiếu đích); Bỏ bê 97% ngõ cụt (Q14 — "gà con chờ trong ổ" đưa về 0%).
