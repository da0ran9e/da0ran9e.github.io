# Trại Gà — cơ chế mới đáng cân nhắc (2026-11-16)

> Đây là **ý tưởng**, chưa được chủ dự án duyệt và chưa có trong kế hoạch. Mỗi ý ghi: nó giải quyết điều gì, luật cốt lõi,
> công sức, rủi ro. Xếp theo mức "đáng làm" theo đánh giá của producer. Ý nào được chọn thì mới viết đặc tả vào `next-rounds.md`.

Game hiện có vòng ngắn tốt (ấp, nuôi, kiếm hạt, nhận thưởng) nhưng thiếu ba thứ:
**(a) lý do để lai giống có chủ đích**, **(b) lý do để gắn bó với từng con gà**, **(c) thứ thay đổi theo tuần** để người chơi lâu không thấy lặp.

## Nhóm 1 — cho việc lai giống một mục đích

### 1. Bảng đơn đặt hàng ★ đáng làm nhất

- **Giải quyết:** hiện người chơi lai giống chỉ để điền sổ. Đơn hàng biến bộ gen thành lời giải cho một bài toán cụ thể.
- **Luật:** bảng gỗ cạnh con đường có 3 đơn, đổi mỗi ngày theo `(seed, ngày)`. Mỗi đơn là một yêu cầu về kiểu hình, ví dụ "một gà mái trưởng thành có chỏm lông, lông chân, nuôi đủ đạm". Giao đúng con gà (gà rời trại) → nhận vé + túi quà. Độ khó 3 bậc: 1 đặc điểm (2 vé) · 2 đặc điểm (5 vé) · 2 đặc điểm + chất lượng nuôi ≥ 0,85 (9 vé).
- Đơn chỉ đòi những đặc điểm **đã có ★ trong sổ của chính trại đó** (không giao việc bất khả thi), trừ đơn khó nhất mỗi tuần.
- **Hợp trụ cột** 1 và 2. Thay thế tốt cho "đổi gà lấy vé" đồng giá: gà đúng đơn có giá hơn hẳn gà thường.
- **Công sức:** vừa (luật `orderView`, `deliver`; so khớp kiểu hình đã có sẵn qua `dexKeysOf`). **Rủi ro:** phải tính lại kinh tế vé (H3) — đơn hàng là một vòi vé mới; đề nghị thay hẳn "đổi gà trưởng thành lấy 2 vé".

### 2. Gia phả

- **Giải quyết:** gà chết sau 2–5 ngày; dòng gen là thứ duy nhất còn lại nhưng người chơi không nhìn thấy nó.
- **Luật:** không có luật mới — `motherId` / `fatherId` đã lưu. Thêm vào sổ kỷ niệm đủ thông tin để vẽ (đã có `code`); cần giữ thêm `motherId`, `fatherId` trong mục kỷ niệm.
- **Giao diện:** từ bảng thông tin gà mở cây 3 đời, hình từng con vẽ lại từ mã gen; đặc điểm truyền từ ai sang ai được tô màu. Đây cũng là công cụ để người chơi **hiểu** di truyền trội/lặn.
- **Công sức:** nhỏ–vừa, chỉ phía client. **Rủi ro:** thấp. Làm sớm được.

### 3. Hội thi gà đẹp hằng tuần

- **Giải quyết:** thiếu sự kiện theo tuần và thiếu so sánh với người khác mà không cần trao đổi vật phẩm.
- **Luật:** mỗi tuần một chủ đề tất định ("đuôi dài nhất", "màu rực nhất", "gà con tròn nhất"). Người chơi đăng ký **một** con; điểm tính bằng công thức từ kiểu hình + độ phát triển (`express()` đã cho đủ số: `tailLen`, độ bão hoà màu, `plump`…). Server giữ bảng xếp hạng; cuối tuần trao nơ (trang trí) theo nhóm phần trăm, không trao vật phẩm mạnh.
- **Hợp trụ cột** 4 ("thế giới chung nhẹ nhàng"). Không có trao đổi nên không đụng vấn đề pháp lý.
- **Công sức:** vừa–lớn (cần bảng xếp hạng phía server, chống đăng ký gà giả: server tự tính điểm từ trại thật). **Rủi ro:** cần đủ người chơi mới vui; khi ít người thì hiện thứ hạng so với "kỷ lục của chính bạn".

## Nhóm 2 — gắn bó với từng con gà

### 4. Tính cách từ gen

- **Giải quyết:** hai con gà khác màu nhưng hành xử y hệt nhau.
- **Luật:** suy ra từ gen đã có, không thêm gen: *tham ăn* (`appetite` cao → tự ăn ở tháp sớm hơn), *hiếu động* (`speed` cao → đi lại nhiều, trò chạy đua dễ hơn), *nhút nhát* (`hardiness` thấp → hay nép gần chuồng, sống ngắn hơn như đã có), *chăm đẻ* (`eggRate`). Mỗi con mang 1–2 nhãn.
- Chủ yếu là **hành vi trên màn hình** (bộ mô phỏng sân trại) và một dòng chữ trong màn nở trứng; ảnh hưởng luật rất nhẹ để không phá cân bằng.
- **Công sức:** nhỏ. **Rủi ro:** thấp. Hiệu quả cảm xúc cao so với công.

### 5. Lông kỷ niệm

- **Giải quyết:** gà chết là khoảnh khắc buồn và chỉ mất, không được gì.
- **Luật:** gà sống trọn đời (chết vì tuổi già, không phải vì đói) để lại một **chiếc lông** mang màu và hoa văn của nó, lưu vào album. Gà bị bỏ đói không để lại lông → thưởng cho chăm sóc tốt mà không phạt thêm.
- Mốc album (10, 25, 50 lông) mở trang trí. Không có tác dụng lên luật.
- **Công sức:** nhỏ (một trường trong mục kỷ niệm + hình lông vẽ từ `colors`). **Rủi ro:** thấp.

### 6. Thân thiết

- **Luật:** vuốt ve (chạm gà) và cho ăn riêng làm tăng "thân thiết" của con đó, tối đa vài điểm mỗi ngày. Thân thiết cao: gà chạy lại khi mở game, kêu khi chạm, bưu thiếp có khung đẹp hơn. **Không** tăng chỉ số — chỉ là biểu hiện.
- **Rủi ro:** dễ thành việc vặt bắt buộc nếu gắn phần thưởng thật. Giữ thuần trang trí.

## Nhóm 3 — thứ thay đổi theo thời gian

### 7. Mùa theo tuần và thời tiết — ĐÃ CÀI (luật v9, 21/11)

- **Luật:** mỗi tuần thật là một "mùa" tất định theo lịch: mùa gặt (cánh đồng nhiều hạt mẩy), mùa mưa (đốm sáng xuất hiện dày hơn), mùa hoa (nhiều hạt màu), mùa khô (ít hạt, nhưng thương nhân giảm giá). Chỉ đổi **bảng rơi** và tần suất đã có trong `CONFIG`, không thêm vật phẩm.
- Kết hợp được với đợt D (cánh đồng treo máy): mỗi mùa một bảng màu.
- **Công sức:** nhỏ về luật, vừa về hình. **Rủi ro:** phải đo lại cân bằng cho từng mùa (ít nhất bảo đảm mùa khô không làm người ghé thăm chết đói).

### 8. Nhiều cánh đồng

- **Luật:** ngoài đồng cỏ còn bờ suối (nhiều hạt khoáng), ruộng lúa (hạt mẩy), đồi hoa (hạt màu); mở dần theo mốc sổ. Mỗi nơi một bảng rơi và một kiểu "đốm sáng". Người chơi chọn nơi thả theo chất đang thiếu → quyết định có nghĩa, đúng trụ cột 2.
- **Công sức:** vừa (3 nền mới là phần nặng). **Rủi ro:** thấp về luật.

### 9. Đêm trăng tròn — ĐÃ CÀI (luật v9, 21/11)

- **Luật:** mỗi tháng âm lịch vài đêm: trứng đẻ trong đêm đó có tỉ lệ biến dị cao hơn (nhân với `mutationRate` sẵn có). Một sự kiện hiếm, đoán trước được, tạo cớ hẹn giờ vào game.
- **Công sức:** rất nhỏ. **Rủi ro:** thấp.

## Nhóm 4 — tiến triển dài hạn

### 10. Nâng cấp trại bằng vé

- **Luật:** dùng vé (bồn chứa lớn, dài hạn) để nâng: tháp hạt 40 → 60 → 80, kho trứng 12 → 16, thêm một chỗ thả gà ra đồng (hiện chỉ 1 con). Giá tăng mạnh theo bậc.
- **Vì sao đáng:** H3 hiện chỉ có thương nhân làm chỗ tiêu vé; nâng cấp là bồn chứa ổn định, không phụ thuộc may rủi của hàng thương nhân.
- **Rủi ro:** "thêm chỗ thả gà ra đồng" đụng quyết định "mỗi lần 1 con" và tải server ở mốc M3 — để riêng, hỏi chủ dự án.

### 11. Danh hiệu

- Hoàn thành một nhóm trong sổ (đủ 4 hoa văn, đủ 3 kiểu mào…) → danh hiệu hiện cạnh tên trại và trên bưu thiếp. Thuần hiển thị, rất rẻ, cho người sưu tầm mục tiêu trung hạn giữa ★★ và giống.

## Đề nghị thứ tự

| Ưu tiên | Ý | Lý do |
|---|---|---|
| 1 | Gia phả (2) + Tính cách (4) + Lông kỷ niệm (5) | Rẻ, không đụng cân bằng, làm game "có hồn" ngay |
| 2 | Bảng đơn đặt hàng (1) | Cho việc lai giống một mục đích; làm cùng đợt C vì dùng vé |
| 3 | Mùa theo tuần (7) + Đêm trăng tròn (9) | Rẻ về luật, tạo nhịp theo tuần |
| 4 | Nâng cấp bằng vé (10), Danh hiệu (11) | Sau khi kinh tế vé đã đo xong |
| 5 | Hội thi (3), Nhiều cánh đồng (8) | Lớn; cần người chơi và hình mới |

Không đề nghị: thân thiết (6) ở dạng có phần thưởng thật; mọi cơ chế cho chuyển vật phẩm giữa người chơi; "hồi sinh" hay kéo dài tuổi thọ bằng vật phẩm (phá ý nghĩa vòng đời 2–5 ngày mà chủ dự án đã chốt).

---

## Bổ sung 16/11 — thể lực, thuộc tính ảnh hưởng minigame, thêm ý tưởng minigame

### 12. Thể lực

- **Giải quyết:** thiết kế minigame hiện giới hạn bằng luật khô "mỗi con 2 lượt mỗi giờ" (H2). Thể lực thay nó bằng thứ người chơi nhìn thấy và hiểu được, và cho việc chăm sóc thêm một chiều.
- **Luật:**
  - Mỗi con có `stamina` 0..`staminaMax`. `staminaMax` = 60–100 theo gen *sức đề kháng* và *tầm vóc*, nhân với độ phát triển nhóm **năng lượng** (`dev.energy`) — gà nuôi thiếu hạt mẩy thì yếu sức. Gà con có trần thấp hơn (× 0,6), gà giò × 0,8.
  - **Tiêu:** mỗi lượt minigame −35; mỗi lần chạy tới đốm sáng −3; kiếm ăn ngoài đồng −1 mỗi 2 phút.
  - **Hồi:** +20 mỗi giờ khi ở chuồng **và bụng không rỗng**; ban đêm (22:00–5:00 giờ Việt Nam) hồi gấp đôi — gà ngủ. Tính trong `stepChicken` từng phút như các chỉ số khác (không cần công thức lười riêng).
  - **Hết thể lực:** không vào được minigame (`too_tired`, thay cho `play_tired`); ngoài đồng thì gà tự đi chậm lại 50% và không chạy tới đốm sáng. Không bao giờ gây hại (không giảm tuổi thọ) — hết sức chỉ là "nghỉ đi".
- **Rèn luyện:** mỗi lượt minigame hoàn thành (điểm ≥ 0,3) cộng `fitness` +0,04, tối đa 0,3; `staminaMax` thực = gốc × (1 + fitness). Gà chỉ sống 2–5 ngày nên đầu tư này có hạn tự nhiên; con cái **không** thừa hưởng `fitness` (đó là luyện tập, không phải gen).
- **Hệ quả cho H2:** bỏ `perSubjectPerHour` và `playLog`; trần mới là thể lực (35/lượt, hồi 20/giờ ≈ 0,6 lượt/giờ lúc ổn định, nhưng dồn được 2 lượt liền khi đầy). Chặt hơn một chút so với 2 lượt/giờ → lợi cho cân bằng.
- **Công sức:** nhỏ–vừa. **Rủi ro:** thêm một thanh chỉ số nữa trên bảng thông tin gà (đã có 8 thanh) → gộp hiển thị: độ no + thể lực thành một cụm, 4 chất thành một cụm.

### 13. Thuộc tính và tính cách ảnh hưởng minigame

Nguyên tắc (ràng buộc bởi H2, không được phá): **thuộc tính đổi CÁCH trò chơi diễn ra, không đổi TRẦN phần thưởng.** Server vẫn chỉ nhận điểm 0–1 và kẹp như cũ. Gà giỏi làm trò dễ đạt điểm cao hơn; người gian lận vẫn không được hơn mức tối đa. Nhờ vậy thuộc tính có ý nghĩa với người chơi thật mà không mở lỗ hổng.

Năm thuộc tính hiển thị (thang 1–10), đều suy từ thứ đã có trong `express()` — không thêm gen:

| Thuộc tính | Lấy từ | Ảnh hưởng trong minigame |
|---|---|---|
| **Tốc độ** | gen tốc độ + độ dài chân | Chạy đua: tốc độ tối đa; Đuổi bướm: tầm với |
| **Thể lực** | sức đề kháng + tầm vóc + `dev.energy` + `fitness` | Thời lượng mỗi lượt (30 → 45 giây: thêm thời gian ghi điểm); số lần "gắng sức" trong trò |
| **Tinh mắt** | cỡ mắt | Mổ hạt: hạt tốt sáng lên sớm hơn; Ba cái nón: tráo chậm hơn |
| **Bật nhảy** | chân dài, mình ít tròn | Nhảy vũng: nhảy cao và xa hơn, cửa sổ bấm rộng hơn |
| **Khéo léo** | độ dài thân, dáng đứng, `dev.mineral` | Qua cầu, Giữ trứng: lắc lư chậm hơn |

Tính cách (ý 4) thêm màu sắc, mỗi nét **vừa lợi vừa hại**:

| Tính cách | Lợi | Hại |
|---|---|---|
| Tham ăn | Mổ hạt: mổ nhanh hơn | Chạy đua: thấy hạt ven đường thì khựng lại |
| Hiếu động | Nhanh hơn 10% | Khó điều khiển hơn (trượt đà) |
| Nhút nhát | Tinh mắt +1 (cảnh giác) | Giật mình khi có tiếng động: mất một nhịp |
| Điềm tĩnh | Khéo léo +1 | Khởi động chậm |

Hệ quả thiết kế đáng giá: người chơi có lý do **chọn con nào cho trò nào** — và lý do lai giống ngoài chuyện sưu tầm ("tôi cần một con chân dài tinh mắt"). Kết hợp tốt với bảng đơn đặt hàng (ý 1) và hội thi (ý 3).

Việc phải ghi vào H2 nếu ý này được duyệt: hợp đồng module đổi thành `run(host, { art, lang, stats, traits }) → Promise<score 0..1>`; `stats` do `main.js` tính từ kiểu hình, **không gửi lên server**.

### 14. Thêm ý tưởng minigame

Bốn trò đã có trong đặc tả: lăn trứng, nhảy vũng (gà con), chạy đua (gà giò), mổ hạt (trưởng thành). Dưới đây là các trò có thể thêm; mỗi tuổi nên có 2–3 trò xoay vòng theo ngày để không nhàm.

**Cho trứng**
- **Soi trứng:** soi đèn qua vỏ, thấy nhịp tim phôi; chạm đúng nhịp để "hát ru". Trò nhịp điệu chậm, 20 giây. Điểm cao → phôi khoẻ (rút thời gian ấp như đã thiết kế).
- **Giữ ấm:** thanh nhiệt độ trôi lên xuống; giữ trong vùng xanh bằng cách nhấn giữ / thả. Dùng lại đúng cảm giác "sưởi trứng" đang có.

**Cho gà con**
- **Theo mẹ:** gà mẹ đi một đường ngoằn ngoèo rồi biến mất; nhớ và vẽ lại đường đi (kiểu Simon). Càng về sau đường càng dài.
- **Đuổi bướm:** bướm bay lượn, chạm đúng lúc bướm vào tầm với của gà. Thuộc tính Tốc độ nới tầm với.

**Cho gà giò**
- **Qua cầu khỉ:** gà đi trên thân tre, nghiêng trái phải; chạm hai bên để giữ thăng bằng. Thuộc tính Khéo léo.
- **Ba cái nón:** hạt quý giấu dưới một trong ba nón lá, tráo nhanh dần; chọn đúng nón. Thuộc tính Tinh mắt làm tráo chậm lại.
- **Tắm bụi:** giữ rồi thả đúng nhịp để gà rũ bụi; trò thư giãn, điểm dễ, hồi thêm thể lực thay vì tiêu (lượt "nghỉ" — vẫn tốn vé).

**Cho gà trưởng thành**
- **Gáy thi** (chỉ gà trống): nhấn giữ để lấy hơi, thả đúng vạch để gáy tròn tiếng; ba hiệp, hơi dài dần. Dùng tiếng gáy tổng hợp trong `fx.js`. Vui, hợp văn hoá, rất "gà".
- **Bới tìm:** lưới 4×4 ô đất, vài ô có hạt, vài ô có sỏi; mỗi ô bới ra cho biết có bao nhiêu hạt ở ô kề (kiểu dò mìn thu nhỏ). Thuộc tính Tinh mắt mở sẵn một ô.
- **Ấp trứng** (chỉ gà mái): giữ mái ngồi yên trên ổ trong khi có thứ gây xao nhãng; nối thẳng với cơ chế "gà mái ấp giúp" (B2).

**Cả đàn / với bạn bè**
- **Tiếp sức:** chọn 3 con cho ba chặng (chạy – nhảy – thăng bằng); điểm là trung bình. Buộc người chơi nuôi đàn đa dạng. Tốn 2 vé.
- **Đua với bóng:** đua với "bóng" con gà của một người bạn — server gửi thuộc tính và điểm tốt nhất của con đó, client dựng lại đối thủ. Không trao đổi gì, chỉ so tài. Cần đợt E.

**Không làm:** chọi gà dưới mọi hình thức. Nó gắn với cờ bạc và bị cấm ở Việt Nam, và trái với tinh thần "thế giới chung nhẹ nhàng" của game.

### Thứ tự đề nghị (cập nhật)

Khi làm đợt C (vé, minigame): đưa **thể lực (12)** vào luôn thay cho giới hạn lượt theo giờ, và viết bốn trò đầu theo hợp đồng có `stats` (13) ngay từ đầu — thêm sau sẽ phải sửa cả bốn. Trò mới (14) thêm dần, mỗi lần một trò; ưu tiên **Gáy thi**, **Ba cái nón**, **Theo mẹ** vì khác hẳn bốn trò đầu về cách chơi.

---

## Bổ sung 16/11 (2) — nhiều loại thương nhân

### 15. Khách qua đường: mỗi người một kiểu hàng, một kiểu tương tác

Thay cho một "thương nhân bí ẩn" duy nhất (đợt C3): con đường trước cổng có **khách ghé theo lượt**, mỗi lúc chỉ một người đứng ở gian hàng. Ai ghé, lúc nào, mang gì đều tính tất định từ `(seed, ngày)` như C3 — không lưu lịch, server tái lập được.

| Khách | Tần suất | Bán / đổi gì | Cách tương tác | Trả bằng |
|---|---|---|---|---|
| **Bà hàng hạt** | Ngày nào cũng ghé, 2 lượt | Hạt giàu chất theo loại, túi hạt | Mua thẳng, giá cố định. Người quen: mua đủ 5 ngày liên tiếp thì thêm một món giảm giá | Vé (rẻ: 1–3) |
| **Người đổi chác** | 3–4 lần/tuần | Đổi vật lấy vật: "5 hạt màu lấy 1 hạt quý", "2 trứng không phôi lấy 1 túi quà" | Kéo đúng thứ ông ấy cần vào quầy; không dùng vé | Hạt, trứng |
| **Người sưu tầm** | 2–3 lần/tuần | Không bán gì — **mua** gà theo yêu cầu (chính là bảng đơn đặt hàng, ý 1, có thêm gương mặt) | Kéo con gà đúng yêu cầu vào; ông ấy xem xét rồi trả giá theo độ khớp và chất lượng nuôi | Nhận vé |
| **Thầy soi trứng** | 2 lần/tuần | **Thông tin**: soi một quả trứng cho biết trống hay mái (1 vé), hoặc một đặc điểm nó mang (2 vé) | Kéo trứng vào đèn soi; kết quả hiện dần như màn nở trứng | Vé |
| **Lái buôn mặc cả** | 1–2 lần/tuần | Một món khá hiếm (hạt lạ, túi quà lớn, trứng mang đặc điểm thường gặp) | **Mặc cả**: ông ra giá, mình trả giá tối đa 3 lần; trả thấp quá ông bỏ đi, không quay lại lượt đó | Vé |
| **Nghệ nhân** | 1 lần/tuần | Đồ **trang trí** sân trại (không tác dụng lên luật), mỗi tuần một bộ | Xem thử: chạm món nào thì món đó hiện tạm trong sân trước khi mua | Vé (đắt: 10–20) |
| **Khách lạ đêm khuya** | Chỉ ban đêm, 1–2 lần/tuần, ở lại 15 phút | Ba giỏ đậy kín; một giỏ có trứng mang đặc điểm **hiếm** | Chọn một trong ba giỏ. Bảng tỉ lệ ghi rõ ngay trên màn hình; giỏ nào cũng có thứ gì đó | Vé (đắt: 12) |

Độ hiếm tăng dần từ trên xuống: người mới gặp bà hàng hạt hằng ngày và mua nổi; khách lạ đêm khuya thì hiếm gặp, đắt, và phải vào game đúng lúc.

### Chi tiết thiết kế phải giữ

1. **Một hàm lịch chung**: `visitorAt(seed, now) → { who, from, until, stock } | null`. Mỗi ngày chia thành các khung 30 phút trong 7:00–23:00 (giờ Việt Nam); mỗi loại khách có trọng số theo ngày trong tuần. Hai khách không bao giờ trùng khung. Thay hẳn `merchantVisit` của C3.
2. **Thầy soi trứng chỉ có nghĩa nếu client không tự xem được gen của trứng.** Hiện `clientView` gửi nguyên `code` của mọi quả trứng → ai mở công cụ lập trình cũng đọc được. Trước khi làm khách này, server phải **bỏ `code` khỏi trứng chưa nở** trong bản gửi cho client (chỉ gửi `shell`, `fertile`, `quick`, và các thông tin đã soi). Việc này đụng: màn nở trứng (lấy gen từ con gà, không từ trứng — đã đúng), `incubateMsOf(egg.code)` ở client (đã có `egg.incubateMs` sau khi ấp; trước khi ấp phải gửi kèm `incubateMin`), và bản chơi offline (không giấu được — chấp nhận, ghi rõ). Đây là thay đổi bảo mật đáng làm kể cả khi không có thầy soi trứng.
3. **Mặc cả phải do server quyết.** `haggle(state, offer, now, { rng })`: giá sàn bí mật = giá niêm yết × (0,6–0,85) tung bằng nguồn ngẫu nhiên của server lúc khách tới (ghi vào `rolled`). Mỗi lần trả giá: `offer ≥ sàn` → bán với giá `offer`; thấp hơn sàn quá 25% → ông bỏ đi; còn lại → ông hạ giá niêm yết một nấc và đếm một lần. Hết 3 lần chưa xong thì phải mua giá hiện tại hoặc thôi. Client không bao giờ nhận được giá sàn.
4. **Ba giỏ đậy kín không được thành cờ bạc.** Vé không mua được bằng tiền thật (đã chốt); tỉ lệ hiện công khai; giỏ "trượt" vẫn có giá trị xấp xỉ 60% số vé bỏ ra (hạt quý, hạt lạ). Nội dung ba giỏ tung **sau** khi người chơi chọn (bằng nguồn ngẫu nhiên server) để không ai dò trước được.
5. **Người đổi chác là chỗ tiêu hạt thừa** (người Cày thường đầy kho 120 hạt). Tỉ giá luôn hơi thiệt (đổi 5 lấy 1 thứ đáng ~4) để không thành máy in đồ.
6. **Đồ trang trí của nghệ nhân** lưu trong `state.decorOwned` (danh sách khoá) — khác với trang trí suy ra từ tiến độ (`decorOf`). Chỉ là hình; cần thêm hình vẽ cho mỗi bộ.
7. Mỗi khách có **một hình nhân vật** và vài câu chào (qua `i18n.js`). Đây là phần tạo cá tính và cũng là phần tốn công vẽ nhất: 7 nhân vật.

### Kinh tế (phải cập nhật H3 nếu duyệt)

- Thêm bồn chứa vé: nghệ nhân (lớn, thuần trang trí), thầy soi trứng (nhỏ, đều), khách lạ (lớn, hiếm).
- Thêm vòi vé: người sưu tầm (thay cho "đổi gà trưởng thành lấy 2 vé").
- Người đổi chác không đụng tới vé.
- Mục tiêu H3 giữ nguyên: người chơi đều đặn có một trứng hiếm mỗi 5–7 ngày, tính gộp mọi khách.

### Đề nghị

Làm theo ba bước, mỗi bước chơi được ngay:
1. **Bà hàng hạt + người sưu tầm** — một người bán, một người mua: đủ để vé có vòng quay. Chỉ cần mua thẳng và kéo-thả đã có.
2. **Người đổi chác + thầy soi trứng** — kèm việc giấu gen trứng ở server (mục 2).
3. **Lái buôn mặc cả + khách lạ đêm khuya + nghệ nhân** — ba kiểu tương tác riêng, nhiều hình mới.
