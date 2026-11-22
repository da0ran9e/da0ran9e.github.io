// Trại Gà — THỂ TRẠNG suy từ KIỂU HÌNH (chủ dự án chốt 22/11): không có gen thể chất riêng, không luyện tập.
// Gen quyết định dáng tiềm năng, dinh dưỡng lúc lớn quyết định dáng thật; thể trạng chỉ đọc dáng thật đó.
//
// Hai bước:
//   1. measures(ph): đổi kiểu hình (express() trong genome.js) thành các SỐ ĐO chuẩn hoá 0..1 nhìn thấy được trên gà.
//   2. STATS[k](m): mỗi thể trạng là MỘT HÀM riêng của các số đo — tỉ lệ thuận (+) hoặc nghịch (−) với từng số đo.
// Mọi hàm đều đơn điệu theo từng đầu vào (test: tests/chicken-farm/body.test.mjs) và kẹp về 0..1.
// Thể trạng chỉ đổi cách trò ở sân chơi diễn ra; luật (startPlay / endPlay) vẫn kẹp điểm và thưởng.

const clamp = (v) => Math.max(0, Math.min(1, v));

// Số đo 0..1. Khoảng chuẩn hoá lấy theo đàn gà thật: 2%–98% số gà nuôi đủ chất rơi vào ~0.1–0.9,
// nên gà bị nắn dáng bằng hạt có chất kháng (thiếu một chất lúc lớn) chạm được tới 0 hoặc 1.
export function measures(ph) {
  const s = ph.shape;
  return {
    legs: clamp((s.legLen - 0.78) / 0.58), // chân: khoáng + gen dài chân
    body: clamp((s.size * s.plump - 0.9) / 0.45), // thân hình (to × tròn): năng lượng + gen vóc
    feathers: clamp(((s.tailLen - 0.7) / 0.65) * 0.6 + (((s.saddle ?? 0) - 0.2) / 0.7) * 0.4), // lông đuôi, lông yên: đạm
    beak: clamp((s.beakLen - 0.85) / 0.5), // mỏ: khoáng
    eyes: clamp((s.eyeSize - 0.88) / 0.3), // mắt: gen
    neck: clamp((s.neck - 0.7) / 0.55), // cổ: gen
    toes: s.toes > 4 ? 1 : 0, // năm ngón: bám đất
  };
}

// Mỗi thể trạng một hàm. Hệ số dương = tỉ lệ thuận, âm = tỉ lệ nghịch.
export const STATS = {
  // Chạy: chân dài (+), thân hình to (−)
  speed: (m) => clamp(0.5 + 0.5 * m.legs - 0.5 * m.body),
  // Nhảy: chân dài (+), lông dài vỗ cánh (+), thân hình to (−)
  jump: (m) => clamp(0.35 + 0.4 * m.legs + 0.3 * m.feathers - 0.45 * m.body),
  // Vững: thân hình to (+), năm ngón (+), chân dài (−)
  steady: (m) => clamp(0.45 + 0.45 * m.body + 0.1 * m.toes - 0.4 * m.legs),
  // Mắt: mắt to (+), mỏ dài (+), cổ dài nhìn xa (+)
  eye: (m) => clamp(0.5 * m.eyes + 0.3 * m.beak + 0.2 * m.neck),
};

export function bodyStats(ph) {
  const m = measures(ph);
  return Object.fromEntries(Object.entries(STATS).map(([k, f]) => [k, f(m)]));
}
