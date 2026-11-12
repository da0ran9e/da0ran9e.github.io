# Trại Gà — Đánh giá thiết kế v4 & đề xuất cho chủ dự án

> 2026-11-11 · đội Thiết kế game + Kinh tế + Hệ thống · đo bằng `tools/chicken-farm/balance-sim.mjs` (luật thật `rules.js` + `field.js`, 32 ván × 4 kiểu chơi × 7 ngày, trung vị).
> Không đi ngược D1–D12, Q1–Q6, Q11–Q12. Mọi "phương án" dưới đây là **đề xuất** — chủ dự án chọn.
> Tái lập: `node tools/chicken-farm/balance-sim.mjs` (mặc định chạy mốc + các phương án Q13/Q14 ở đây); `--list` để xem kịch bản.

## 1. Tóm tắt

1. **Vòng ngắn và vòng ngõ cụt đã ổn** (Q11/Q12): chơi ≥ 3 phiên/ngày thì 0% ngõ cụt, trại tự duy trì 5–6 gà.
2. **Vòng dài chưa có đích.** Sau ngày 2–3 người chơi chăm chạm trần chuồng 6 chỗ (100% ván), và "sổ sưu tầm" thử nghiệm bão hoà ở **~17 mục ở MỌI kiểu chơi** — ghé thăm, chăm hay cày đều ra gần như một số. Cày không mở thêm được gì: đó là điểm chán lớn nhất.
3. **Người "Bỏ bê" mất trại 97%** vì gà con nở lúc người chơi vắng và đói gần một ngày. Cách rẻ nhất, đúng tinh thần Q4 ("phải quan sát"): **gà con chờ trong ổ tới khi người chơi mở game** → ngõ cụt **97% → 0%**.
4. **Đã chỉnh CONFIG v3 → v4** (2 con số, xem §3): người "Ghé thăm" bớt cảnh gà chết đói (tuổi thọ mất 31% → 19%, chết khi đang đói 69% → 44%), các kiểu chơi khác không xấu đi.
5. Phát hiện hệ thống: **độ no chặn việc nạp chất** — `feed` từ chối khi bụng gần đầy, nên mọi thứ làm bụng no lâu hơn (gà con nở ra no hơn, đói chậm hơn) đều làm gà con **nhận ít chất hơn → lớn chậm, chất lượng nuôi thấp hơn**. Thử `hatch.satiety` 50 → 120: người Chăm lớn chậm 2,6 → 7,5 giờ, chất lượng 0,87 → 0,71. Đã loại.

## 2. Đánh giá vòng chơi (theo design-review / game-designer)

| Lớp | Hiện trạng v4 | Đánh giá |
|---|---|---|
| **Vòng lõi (30 s)** | Kéo gà ra cổng → xem gà tự mổ hạt; kéo hạt lên gà; kéo trứng vào ổ | Tốt: xúc giác, đúng D3/D12. Rủi ro: "xem" là thụ động — cần khoảnh khắc nhỏ (hạt quý lấp lánh, gà đổi dáng khi lớn qua mốc) để giữ mắt |
| **Vòng phiên (5–15 phút)** | Nhặt trứng → ấp → đổi trứng thừa lấy túi → mở túi → cho ăn đúng chất → thả đồng | Tốt cho 2 ngày đầu. Từ ngày 3: chuồng đầy, kho hạt đầy (Chăm/Cày 100% ván), trứng thừa chỉ còn một lối ra là túi hạt → **việc nhà lặp lại không có quyết định** |
| **Vòng dài (ngày/tuần)** | Giữ trống tốt, nuôi đúng chất, sổ kỷ niệm | **Thiếu đích đo được.** Chưa có sổ sưu tầm, chưa có nâng cấp, chưa có trao đổi. Thứ duy nhất tăng theo thời gian là sổ kỷ niệm (một danh sách người đã mất) |

**Động lực người chơi (MDA):** *Nurture* (nhìn gà lớn) — mạnh. *Collection* — có nguyên liệu (gen, 11 đặc điểm hiếm, biểu hiện theo dinh dưỡng) nhưng chưa có giao diện/đích. *Mastery* — "chọn đúng hạt" có thật (chất lượng nuôi 0,76 ghé thăm → 0,96 cày) nhưng người chơi không thấy hệ quả ngoài hình gà. *Social* — chưa có (M5).

**Chỗ kẹt / chán (đo được):**

| # | Ở đâu | Số đo v4 | Ai gặp |
|---|---|---|---|
| K1 | Chuồng 6 chỗ chặn ấp | 100% ván; Cày bị chặn ~1.550 lần/ván | Chăm, Cày (và Ghé thăm 100% ván, nhẹ hơn: ~19 lần) |
| K2 | Sổ sưu tầm bão hoà | ~17 mục ngày 7, **không phụ thuộc kiểu chơi** (Ghé thăm 17, Chăm 17, Cày 17); độ hiếm cao nhất 5/11 ở mọi kiểu | Mọi người |
| K3 | Kho hạt đầy, cánh đồng vô ích | Chăm/Cày đầy 120 từ ngày 1; Cày bị từ chối ~14.700 lần mổ/ván | Chăm, Cày |
| K4 | Bỏ bê mất trại | Ngõ cụt 97%, trại trống ở giờ ~48 | 1 phiên/ngày |
| K5 | Ghé thăm nuôi quá sức | 30% thời gian gà bụng rỗng; giới hạn 4 con thì còn 19% và chết đói 44% → 18% | 3 phiên/ngày |

K5 là lỗi **thông tin**, không phải lỗi số: người chơi không biết kho hạt nuôi được bao nhiêu con. Đề xuất cho đội Client: hiện "đủ ăn cho ~N giờ" ở kho, và cảnh báo khi kéo trứng vào ổ mà kho không đủ.

## 3. Thay đổi CONFIG đã làm (v3 → v4)

| Khoá | v3 | v4 | Lý do |
|---|---|---|---|
| `satietyDrainPerHour` | 25 | **22** | No đầy giữ ~9 giờ (v3: 8 giờ) |
| `fieldEatCooldownMs` | 15 s | **12 s** | Xem đồng được thưởng hơn: 10 phút xem cho ~25% hạt nhiều hơn. Test server (`too_fast` sau 10 s, được ăn sau 15 s) vẫn đúng |
| `version` | 3 | **4** | Client/server so phiên bản. **Lưu ý:** `main.js` bỏ bản lưu offline có `v` khác → người chơi offline bắt đầu lại |

Thử riêng từng số (32 ván): chỉ cooldown 12 s → Ghé thăm mất 23% tuổi thọ; chỉ đói 22 → 27%; cả hai → **19%**. Bị loại: `hatch.satiety` 120 (§1 mục 5), `trade.egg` 3 (gần như không đổi gì), `storage.seeds` 200 (chỉ dời điểm đầy), `nutrientDrainPerHour` 25 (không đổi gì).

| (trung vị, 32 ván) | Ghé thăm v3 → v4 | Chăm v3 → v4 | Cày v3 → v4 | Bỏ bê v3 → v4 |
|---|---|---|---|---|
| Tuổi thọ mất vì đói | 31% → **19%** | 3% → **0%** | 0% → 0% | 44% → 44% |
| Chết khi đang đói / tổng chết | 69% → **44%** | 9% → 0% | 1% → 0% | 82% → 76% |
| % thời gian bụng rỗng | 46% → 30% | 4% → 1% | 0% → 0% | 81% → 78% |
| Chất lượng nuôi (dev) | 0,72 → 0,76 | 0,87 → 0,87 | 0,96 → 0,96 | — |
| Giờ tới gà trưởng thành đầu | 6,6 → 6,5 | 2,6 → 2,7 | 0,8 → 0,7 | 38 → 38 |
| Trứng có phôi / ngày | 2,9 → 4,9 | 12,4 → 11,8 | 15,4 → 16,0 | 0 → 0 |
| Túi hạt / tuần | 13 → 30 | 73 → 76 | 93 → 95 | 0 → 0 |
| Ngõ cụt ngày 7 | 0% → 0% | 0% → 0% | 0% → 0% | 100% → 97% |
| Lần mổ bị từ chối vì kho đầy | 0 → 2 | 643 → 1.115 | 11.583 → 14.690 | 0 → 0 |

Cái giá: lần mổ bị từ chối ở người Cày tăng 27% (kho đầy — K3, cần sửa ở **luật**, xem §6), kho trứng đầy ở Chăm 13% → 31% ván. Trụ cột 3 vẫn giữ: Ghé thăm vẫn đói 30% thời gian, Chăm 1%.

Chốt chặn mới: `tests/chicken-farm/balance.test.mjs` chạy mô phỏng 8 ván/kiểu chơi (~2 giây) và kiểm các mốc trên; đã xác nhận test **trượt với số v3** (Ghé thăm mất 31%) và qua với v4.

## 4. Q13 — Nâng cấp chuồng khi không có tiền tệ

> **Đã chốt 12/11 (D13) và cài trong luật v5** — xem production-plan.md §13.

**Số đo** (luật v4, chỉ đổi `start.coopCap`; "lọc" = người chơi đổi con sắp già lấy túi để lấy chỗ — luật đã có):

| | Gà nở 7 ngày (Ghé/Chăm/Cày) | Chặn ấp (% ván Chăm) | Sổ sưu tầm ngày 7 | Ghé thăm: tuổi thọ mất vì đói |
|---|---|---|---|---|
| Chuồng 6 (hiện tại) | 14 / 14 / 15 | 100% | 17 / 17 / 17 | 19% |
| Chuồng 8 | 18 / 18 / 19 | 100% | 18 / 16 / 17 | **28%** |
| Chuồng 10 | 19 / 22 / 22 | 100% | 17 / 17 / 18 | **30%** |
| Chuồng 6 + lọc gà già | 19 / **36 / 57** | 100% | 18 / 18 / 17 | 19% |

Đọc: (1) Chuồng to hơn **hại** người Ghé thăm (nhiều miệng ăn hơn sức kho) — nên nâng cấp phải **tự mở và tự chọn**, không tặng sẵn. (2) Chuồng chưa bao giờ hết chặn người Chăm/Cày: họ đẻ 12–25 trứng/ngày, chuồng nào cũng đầy. (3) Nở nhiều hơn **không** làm sổ sưu tầm dày hơn (17 mục ở mọi mức) → nút thắt thật của vòng dài là **độ đa dạng gen**, không phải số chỗ.

| Phương án | Cách làm | Ưu | Nhược |
|---|---|---|---|
| **A. Mốc sổ sưu tầm** | Mỗi mốc (ví dụ 10 / 20 / 35 mục) mở +2 chỗ chuồng hoặc +1 ổ ấp | Gắn chặt với mục tiêu "sưu tầm"; không cần tiền; mốc đo được | Sổ hiện bão hoà ~17 mục — cần thiết kế sổ có tầng (Q-Dex) thì mốc mới có ý nghĩa |
| **B. Đổi vật liệu ở cửa hàng** | Thêm "vật liệu" (rơm, gỗ) rơi trong túi hạt; đủ N vật liệu thì đổi lấy chỗ chuồng | Cho túi hạt thêm lý do mở; dùng đúng kênh đổi chác (D5, Q6) | Thêm một loại tài nguyên — gần thành "tiền tệ"; tăng phạm vi (đồ hoạ, kho) |
| **C. Thành tựu nuôi** | Mở chỗ khi nuôi được N gà trưởng thành có chất lượng ≥ 0,85 (hoặc N thế hệ liên tiếp) | Thưởng "nuôi đúng chất" (trụ cột 2, 3); không thêm tài nguyên | Người Cày mở hết trong 1–2 ngày (họ có 0,96 chất lượng ở ~100% gà) |

**Khuyến nghị: A, kết hợp tiêu chí của C** — mốc tính bằng *mục sổ đã "hoàn thiện"* (xem Q-Dex: biểu hiện đầy đủ nhờ nuôi đúng chất), mỗi mốc +2 chỗ, trần 12. Tách **ổ ấp thứ 2** làm phần thưởng mốc đầu tiên vì 1 ổ là điều người Chăm cảm thấy rõ nhất. Đồng thời: hiện nút "đổi gà già lấy chỗ" ngay khi chuồng chặn ấp — luật đã có, và đây là van xả tốt nhất đo được (Chăm 14 → 36 gà nở, 0% chết đói).

## 5. Q14 — Bỏ bê (1 lần/ngày) và máng ăn

> **Đã chốt 12/11 (D14, phương án B) và cài trong luật v5** — xem production-plan.md §13.

| (Bỏ bê, luật v4) | Ngõ cụt | Gà sống ngày 7 | Tuổi thọ mất vì đói | Ghé thăm: chất lượng nuôi |
|---|---|---|---|---|
| Hiện tại | 97% | 0 | 44% | 0,76 |
| **A. Máng ăn** tự lấy hạt trong kho khi gà bụng rỗng (giả lập) | 84% | 0 | 35% | **0,64** (tụt — máng cho ăn hạt thường) |
| **B. Gà con chờ trong ổ** tới khi người chơi mở game (giả lập) | **0%** | 2 | 36% | **0,92** |
| A + B | 0% | 2 | 18% | 0,92 |

| Phương án | Ưu | Nhược |
|---|---|---|
| A. Máng ăn | Dễ hiểu | Không cứu được bỏ bê; giảm chất lượng nuôi ở Ghé thăm (trái trụ cột 2); làm "bỏ bê" gần bằng "chăm" |
| **B. Gà con chờ trong ổ** | Rẻ (một điều kiện khi nở); đúng tinh thần Q4: nở là khoảnh khắc **phải quan sát**; cứu bỏ bê 97% → 0% và giúp cả Ghé thăm (gà con không bị đói ngay sau khi nở) | Ổ ấp bị chiếm lâu hơn; cần quy tắc online rõ (server: "nở khi có nhịp tim xem trại", không chỉ khi xem đồng) |
| C. Chấp nhận mất trại | Không tốn gì; nhấn mạnh D2 | Người chơi 1 lần/ngày rời game; sổ kỷ niệm thành nơi buồn |

**Khuyến nghị: B.** Máng ăn (A) để sau làm phần thưởng nâng cấp có giới hạn (ví dụ máng chỉ chứa 10 hạt do người chơi tự đổ vào — vẫn phải chọn hạt).

## 6. Q-Dex — Sổ sưu tầm cho di truyền (M4)

Sổ thử trong mô phỏng (11 cờ hiếm của `rarityOf` + hoa văn / mào / đuôi / vỏ trứng, ~27 mục) đạt **~17 mục sau 7 ngày ở mọi kiểu chơi**; Ghé thăm đã có 10 mục ngay ngày 1. Phẳng như vậy thì sổ không phân biệt được người chơi giỏi.

| Phương án | Mục sổ | Ưu | Nhược |
|---|---|---|---|
| A. Sổ đặc điểm phẳng | Mỗi đặc điểm nhìn thấy (mào hoa hồng, chân lông, sọc vằn…) = 1 ô | Dễ làm (đã có `rarityOf`); dễ hiểu | Bão hoà sau tuần đầu (đo được); không thưởng chăm sóc |
| **B. Sổ có tầng "tiềm năng → hiện thực"** | Mỗi ô có 3 sao: ★ đã nở mang gen; ★★ đã nuôi tới trưởng thành với chất của nhóm đó ≥ 0,85 (gen biểu hiện đầy đủ); ★★★ có gen đồng hợp (thuần chủng — đời con chắc chắn mang) | Đúng trụ cột 1 + 2 ("gen là tiềm năng, dinh dưỡng là hiện thực"); ★★★ cần **lai chọn lọc qua nhiều thế hệ** → vòng dài tuần/tháng; mốc Q13 bám theo sao | Cần UI giải thích sao; ★★★ cần đọc kiểu gen (đã có trong `genome.js`) |
| C. Sổ tổ hợp / "giống" | Đặt tên giống cho tổ hợp (ví dụ "Gà Ác" = da đen + lông lụa + chân lông) | Mục tiêu cụ thể, có chuyện kể; hợp trao đổi M5 ("tôi cần trống da đen") | Phải thiết kế danh sách giống bằng tay; tổ hợp hiếm có thể bất khả thi với vốn gen của một trại |

**Khuyến nghị: B làm khung, thêm 5–8 "giống" của C làm mốc cuối.** Nguồn đa dạng gen hiện chỉ có trứng ngẫu nhiên từ `tradeForEgg` và biến dị (hạt lạ) — nên M5 (trao đổi) chính là thứ mở rộng vốn gen; sổ ★★★ tạo nhu cầu trao đổi thật.

## 7. Q9/M5 — Trao đổi giữa người chơi, tự đặt giá (không tiền tệ)

| Phương án | Cách làm | Ưu | Nhược |
|---|---|---|---|
| **A. Chợ đăng tin, giá bằng hạt theo loại** | Đăng gà/trứng, giá là một giỏ hạt (ví dụ 3 hạt màu + 1 hạt quý); người mua bấm là xong (giao dịch nguyên tử M5) | Đơn giản; hạt đã là "đơn vị" sẵn; dễ chống nhân bản | Hạt thành tiền tệ ngầm; người Cày (kho đầy hạt tốt) mua hết; hạt lạ/quý tích trữ |
| B. Đổi hàng (gà ↔ gà/trứng) | Đăng "cần: mái chân lông, đổi: trống da đen" và ghép đôi | Đúng tinh thần không tiền tệ; tạo giao tiếp | Khó khớp cầu (cần cả hai bên cùng muốn); chậm |
| C. Lai giống thuê | Cho mượn trống: trứng của người khác được thụ tinh bởi trống của mình, trả bằng hạt | Đúng chất di truyền; không mất gà | Phức tạp nhất (phải thiết kế lại D4 cho trại khác) |

**Khuyến nghị: A + B trong cùng một màn** (giá có thể là giỏ hạt **hoặc** một con/quả cụ thể), với **chốt kinh tế**: kho hạt vẫn trần 120 (người bán không tích được vô hạn), mỗi người tối đa 3 tin đăng, tin hết hạn 24 giờ. Để sau: C.

## 8. Câu hỏi khác & rủi ro hệ thống

| # | Việc | Loại | Đề xuất |
|---|---|---|---|
| H1 | Gà no + kho đầy vẫn đi mổ → ~15.000 lần bị từ chối/ván Cày (tải M3) | Luật (đội Lõi) | Gà ngoài đồng khi no và kho đầy thì **ngồi nghỉ** tới khi đói (đã có dáng `sit`) — người chơi thấy rõ "kho đầy" mà không có chuỗi thông báo |
| H2 | Độ no chặn nạp chất (§1 mục 5) | Luật | Cân nhắc: `feed` chỉ từ chối khi bụng **đầy hẳn**, hoặc hạt giàu chất ít no hơn. Cần chủ dự án duyệt vì đổi cảm giác "cho ăn" |
| H3 | Trứng thừa (Chăm 12/ngày, Cày 16/ngày) chỉ có lối ra là túi hạt | Kinh tế | Ổn cho tới M5; khi có chợ, trứng thừa sẽ có giá trị thật |
| H4 | Q7 hạt lạ "rất hiếm" — kho người Cày ngày 7 có ~30 hạt lạ (báo cáo cũ) | Kinh tế | Theo dõi sau Q-Dex; nếu sổ ★★★ thưởng biến dị thì hạt lạ thành tài nguyên chiến lược |

## 9. Phạm vi (scope-check)

Phạm vi M4 trong kế hoạch: "Sổ sưu tầm, độ hiếm, nâng cấp ổ ấp". Đề xuất ở đây **thêm**: gà con chờ trong ổ (nhỏ, luật + server), nút đổi gà lấy chỗ (UI, luật có sẵn), sao ★–★★★ (vừa), giống (vừa, nội dung). Không thêm tài nguyên mới (đã loại Q13-B). Nếu cần cắt: bỏ "giống" (C của Q-Dex), giữ sao.

## 10. Cần chủ dự án chốt

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| Q13 | Mở thêm chuồng / ổ ấp bằng gì? | Mốc sổ sưu tầm (sao ★★), +2 chỗ/mốc tới 12; mốc đầu = ổ ấp thứ 2; thêm nút "đổi gà già lấy chỗ" |
| Q14 | Cứu người chơi 1 lần/ngày? | Gà con chờ trong ổ tới khi người chơi mở game (đo: ngõ cụt 97% → 0%); không làm máng ăn tự động |
| Q-Dex | Sổ sưu tầm dạng gì? | Sổ có tầng ★ có gen / ★★ biểu hiện đầy đủ nhờ nuôi đúng chất / ★★★ thuần chủng, + vài "giống" làm mốc cuối |
| Q9/M5 | Đặt giá bằng gì? | Giỏ hạt hoặc một gà/trứng cụ thể; tối đa 3 tin, hết hạn 24 giờ, kho hạt vẫn trần 120 |
| H2 | Cho phép nạp chất khi bụng gần đầy? | Có (chỉ từ chối khi đầy hẳn) — đo lại trước khi áp |
| v4 | Giữ `satietyDrainPerHour` 22 và `fieldEatCooldownMs` 12 s? | Giữ; đội Server xác nhận tải cánh đồng M3 (+25% lần mổ tối đa) |
