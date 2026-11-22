// Trại Gà — luật chơi cốt lõi (thiết kế v0.3, theo quyết định của chủ dự án 2026-11-10).
// Thuần logic: không DOM, không đọc đồng hồ (luôn nhận `now` từ ngoài, tính bằng ms).
// Dùng chung cho bản offline (trình duyệt) và server (M2).
//
// Thời gian: mô phỏng theo bước 1 phút NEO VÀO PHÚT TRÒN, ngẫu nhiên theo (seed, id, phút)
// → xem game 1 lần hay 100 lần đều ra đúng một kết quả; server tái lập được để kiểm tra.
// Không tiền tệ: trứng / gà đổi lấy TÚI HẠT, mở ra ngẫu nhiên; không có số dư.
// Chỉ một loại thức ăn là HẠT, khác nhau ở dinh dưỡng.

import { express, breed, randomGenome, encodeGenome, decodeGenome, mulberry32, randomName, lerp, clamp } from "../genome.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const NUTRIENTS = ["protein", "energy", "mineral", "pigment"];
export const NUTRIENT_INFO = {
  protein: { name: "Đạm", grows: "Lông: đuôi, lông yên, độ bóng" },
  energy: { name: "Năng lượng", grows: "Vóc dáng: tầm vóc, độ tròn" },
  mineral: { name: "Khoáng", grows: "Chân, mỏ" },
  pigment: { name: "Sắc tố", grows: "Màu lông, mào, chân, mắt" },
};

// Các loại hạt (một loại thức ăn duy nhất, khác nhau ở dinh dưỡng).
// v11 — HẠT LÀ GIỐNG CÂY THẬT (chủ dự án duyệt 22/11): tên theo loài, không theo chất. Mỗi loài có đủ 4 chất với tỉ lệ riêng
// (thiên về một hoặc hai chất). `form` = dáng cây trong vườn (thiếu → suy từ chất trội); `staple` = hạt rẻ, hoà điểm thì
// dùng trước; `mutation` = tăng biến dị lứa sau (không trồng, không bỏ tháp). Thêm loài mới: thêm một dòng ở đây
// (và trọng số trong drops / garden.growMs nếu muốn nó rơi hay trồng được).
export const SEEDS = {
  rice: { name: "Lúa", satiety: 12, n: { protein: 4, energy: 6, mineral: 3, pigment: 3 }, form: "grass", staple: true },
  mung: { name: "Đậu xanh", satiety: 12, n: { protein: 24, energy: 5, mineral: 3, pigment: 1 }, form: "vine" },
  millet: { name: "Kê", satiety: 14, n: { protein: 3, energy: 24, mineral: 4, pigment: 2 }, form: "grass" },
  sesame: { name: "Vừng", satiety: 10, n: { protein: 4, energy: 5, mineral: 23, pigment: 1 }, form: "bush" },
  marigold: { name: "Vạn thọ", satiety: 10, n: { protein: 1, energy: 4, mineral: 2, pigment: 26 }, form: "flower" },
  sunflower: { name: "Hướng dương", satiety: 13, n: { protein: 14, energy: 14, mineral: 3, pigment: 2 }, form: "tall" },
  corn: { name: "Ngô", satiety: 14, n: { protein: 2, energy: 17, mineral: 1, pigment: 13 }, form: "stalk" },
  pumpkin: { name: "Bí đỏ", satiety: 11, n: { protein: 5, energy: 3, mineral: 13, pigment: 12 }, form: "creeper" },
  peanut: { name: "Đậu phộng", satiety: 12, n: { protein: 14, energy: 4, mineral: 13, pigment: 2 }, form: "low" },
  lotus: { name: "Sen", satiety: 12, n: { protein: 16, energy: 16, mineral: 16, pigment: 16 }, form: "pond" },
  // HẠT CÓ CHẤT KHÁNG (chủ dự án duyệt 22/11): rất giàu một chất nhưng KÉO một chất khác xuống (số âm, không dưới 0).
  // Dùng để nắn vóc dáng gà đang lớn cho hợp từng trò ở sân chơi. Chỉ cho ăn tay — không vào tháp, không được tự chọn.
  sorghum: { name: "Cao lương", satiety: 14, n: { protein: -8, energy: 26, mineral: 3, pigment: 4 }, form: "sorghum" }, // tanin: lông ngắn, mình to
  cotton: { name: "Hạt bông", satiety: 11, n: { protein: 26, energy: 6, mineral: 4, pigment: -10 }, form: "cotton" }, // gossypol: lông dài, màu nhạt
  wheat: { name: "Lúa mì", satiety: 13, n: { protein: 5, energy: 22, mineral: -8, pigment: 2 }, form: "wheat" }, // phytate: chân ngắn, mập
  rapeseed: { name: "Hạt cải", satiety: 11, n: { protein: 20, energy: -8, mineral: 6, pigment: 3 }, form: "canola" }, // mình nhỏ, gọn
  odd: { name: "Hạt lạ", satiety: 10, n: { protein: 6, energy: 6, mineral: 6, pigment: 6 }, mutation: 4 },
};
// Chất bị hạt kéo xuống (giá trị âm) — [] với hạt thường
export const seedLowers = (seed) => Object.entries(SEEDS[seedKey(seed)]?.n ?? {}).filter(([, v]) => v < 0).map(([k]) => k);
// Hạt chỉ cho ăn tay: hạt lạ và hạt có chất kháng
export const handOnly = (seed) => { const s = SEEDS[seedKey(seed)]; return !!s && (!!s.mutation || seedLowers(seed).length > 0); };
// Tên hạt trước v11 → loài tương ứng (đổi kho cũ, nhật ký server cũ, lời gọi cũ)
export const SEED_ALIAS = { common: "rice", protein: "mung", energy: "millet", mineral: "sesame", pigment: "marigold", premium: "lotus" };
export const seedKey = (k) => (typeof k === "string" && Object.hasOwn(SEED_ALIAS, k) ? SEED_ALIAS[k] : k);
// Dáng cây suy từ chất trội khi loài không ghi `form`
export function formOf(seed) {
  const s = SEEDS[seedKey(seed)];
  if (!s) return "grass";
  if (s.form) return s.form;
  const top = Object.entries(s.n).sort((a, b) => b[1] - a[1])[0][0];
  return { protein: "vine", energy: "grass", mineral: "bush", pigment: "flower" }[top];
}

export const CONFIG = {
  version: 11,
  stepMs: MIN,
  // Ấp 5–30 phút theo gen "thời gian ấp" của chính quả trứng (genome.express).
  // Lớn: chất lượng dinh dưỡng 1 → 20 phút, 0 → 24 giờ (thang lũy thừa), nhân gen "tốc độ lớn".
  growMs: { best: 20 * MIN, worst: 24 * HOUR },
  growthGene: [0.8, 1.25],
  lifespanDays: [2, 5], // theo gen "sức đề kháng"
  starveAging: 2, // Q2: lúc bụng rỗng, 1 giờ trôi = 2 giờ tuổi (báo cáo cân bằng 11/11: 3 → 2)
  satietyMax: 200, // no đầy giữ ~8 giờ, qua được một đêm ngủ (cân bằng 11/11: 100 → 200)
  satietyDrainPerHour: 22, // (45 → 25 → 22; design-review 11/11: bớt gà chết đói ở người chơi 3 phiên/ngày)
  nutrientMax: 100,
  nutrientDrainPerHour: 30,
  nutrientFull: 70,
  hatch: { satiety: 50, nutrient: 25 },
  devPrior: { level: 0.5, weight: 5 },
  // Q3: đẻ ngẫu nhiên, trung bình 1–3 giờ/trứng (gen "sai trứng"), CHỈ khi no bụng
  layMeanHours: [6, 2], // (cân bằng 11/11: [3, 1] → [6, 2], bớt lạm phát trứng/túi hạt)
  laySatiety: 60,
  mutationBoostCap: 6,
  stages: { juvenile: 30, adult: 100 },
  storage: { eggs: 12, seeds: 120, bags: 20 },
  // Q5: ngoài đồng chủ yếu là hạt thường; túi đổi ở cửa hàng có tỉ lệ hạt tốt cao hơn
  drops: {
    // v11: bốn loài thiên một chất (đậu xanh, kê, vừng, vạn thọ) · bốn loài hai chất (hướng dương, ngô, bí đỏ, đậu phộng) · sen giàu đủ chất
    field: { rice: 90, mung: 1.2, millet: 1.2, sesame: 1.2, marigold: 1.2, sunflower: 0.8, corn: 0.8, pumpkin: 0.8, peanut: 0.8, lotus: 0.8, odd: 1.2, sorghum: 0.5, cotton: 0.5, wheat: 0.5, rapeseed: 0.5 },
    shop: { rice: 40, mung: 9, millet: 9, sesame: 9, marigold: 9, sunflower: 4, corn: 4, pumpkin: 4, peanut: 4, lotus: 6, odd: 2, sorghum: 2.5, cotton: 2.5, wheat: 2.5, rapeseed: 2.5 },
    // v6 — đốm sáng ngoài đồng (người chơi chỉ cho gà) và túi quà nhiệm vụ: hạt tốt nhiều hơn
    lucky: { rice: 45, mung: 8, millet: 8, sesame: 8, marigold: 8, sunflower: 4, corn: 4, pumpkin: 4, peanut: 4, lotus: 5, odd: 2, sorghum: 2, cotton: 2, wheat: 2, rapeseed: 2 },
    gift: { rice: 20, mung: 11, millet: 11, sesame: 11, marigold: 11, sunflower: 6, corn: 6, pumpkin: 6, peanut: 6, lotus: 9, odd: 3, sorghum: 3, cotton: 3, wheat: 3, rapeseed: 3 },
  },
  fieldEatCooldownMs: 12 * 1000, // 1 con gà ăn tối đa 1 hạt / 12 giây (chống gian lận; design-review 11/11: 15 → 12 s)
  // Q6: giá trị cố định, không theo độ hiếm
  trade: { egg: 2, chicken: [4, 9], eggsPerChicken: 2 }, // túi hạt: trứng 2, gà 4 (mới nở) → 9 (trưởng thành); đổi gà lớn lấy 2 trứng có phôi
  // quickHatchMs: quả trứng đầu tiên (và trứng quà của bước mở đầu) nở sau 1 phút — phiên chơi đầu
  // không phải ngồi chờ 5–30 phút mới có con gà đầu tiên.
  start: { incubators: 1, coopCap: 6, starterChoices: 3, seeds: { rice: 12 }, quickHatchMs: MIN },
  // v6 — SƯỞI TRỨNG: chạm trứng đang ấp, mỗi lần bớt cutPct thời gian ấp của quả đó; tối đa `max` lần
  // (bớt tối đa 40%), cách nhau ≥ cooldownMs. Việc để làm trong lúc chờ, và có giới hạn nên không spam.
  warm: { cooldownMs: 2500, cutPct: 0.04, max: 10 },
  // v7 — THÁP HẠT: người chơi đổ hạt vào tháp; gà ở chuồng đói dưới eatBelow thì tự ăn 1 hạt mỗi phút,
  // NHƯNG chỉ ở những phút người chơi đang mở game (xem advance: watchFrom). Vắng mặt = gà bị nhốt, không ăn.
  tower: { cap: 40, eatBelow: 0.5 },
  // v7 — GÀ MÁI ẤP GIÚP: mái trưởng thành no bụng thỉnh thoảng tự vào ổ; trong lúc nó ấp, trứng chín nhanh gấp `speed`.
  brood: { satiety: 0.75, chancePerHour: 0.5, minutes: 20, speed: 2 },
  // v7 — GÕ TRỨNG: từ mốc này của tiến độ ấp, người chơi gõ được cho nở ngay; không gõ thì tự nở đúng giờ.
  knock: { fromPct: 0.85 },
  // v8 — RƯƠNG THEO GIỜ (chủ dự án chốt 17/11): `at` là mốc TÍCH LUỸ tính từ đầu vòng — rương 2 mở sau 15 phút kể cả 5 phút của
  // rương 1; rương cuối đúng 24 giờ. Nhận lần lượt (vắng lâu thì nhận liền mấy rương); nhận rương cuối thì bắt đầu vòng mới.
  timed: [{ at: 5 * MIN, bag: 2 }, { at: 15 * MIN, bag: 3 }, { at: HOUR, bag: 4 }, { at: 4 * HOUR, bag: 5, table: "gift" }, { at: 12 * HOUR, bag: 6, table: "gift" }, { at: 24 * HOUR, bag: 8, table: "gift", ticket: 1 }],
  // v8 — SỨC CHƠI của người chơi (chủ dự án chốt 17/11): trò ở sân chơi miễn phí, mỗi lượt tốn 1 điểm; tối đa 5, hồi 1 điểm / 30 phút.
  // Hết sức chơi thì vẫn chơi được bằng vé (thưởng gấp rưỡi, thắng hoàn vé).
  energy: { max: 5, regenMs: 30 * MIN },
  // v8 — TRỨNG BÍ ẨN của khách lạ (chủ dự án chốt 17/11): rất đắt; nở ra gà có tỉ lệ mang một KỲ VẬT — bộ phận độc nhất
  // không nằm trong bộ gen nên không lai giống ra được và không di truyền. Kết quả tung lúc mua, giấu tới khi nở.
  mystery: { price: 40, chance: 0.3, shell: "#5b4a7a" },  // v7 — VÉ: vật phẩm tiêu hao chung, CHỈ dùng trong game (không chuyển giữa người chơi). Đổi trứng có phôi / gà
  // trưởng thành lấy vé có trần mỗi ngày (không thì người chơi nhiều đổi vô hạn — design-hard-parts §H3).
  tickets: { cap: 99, start: 3, perEgg: 1, perChicken: 2, eggsPerDay: 3, chickensPerDay: 2 },
  // v7 — THỂ LỰC: tối đa theo gen sức đề kháng × tuổi × rèn luyện; hồi khi ở chuồng và không đói (đêm hồi gấp đôi);
  // kiếm ăn ngoài đồng và chơi làm tiêu. Hết thể lực chỉ là "phải nghỉ", không gây hại.
  stamina: { base: [60, 100], stage: { chick: 0.6, juvenile: 0.8, adult: 1 }, regenPerHour: 20, nightMul: 2, night: [22, 5], fieldPerHour: 30 }, // 22/11: bỏ "độ dẻo dai" (không luyện tập)
  // v7 — SÂN CHƠI: minigame chạy ở client, luật chỉ nhận điểm 0..1 và KẸP phần thưởng (không tin client).
  // Thắng chỉ hoàn lại vé đã bỏ ra → minigame không sinh vé ròng. Xem design-hard-parts §H2.
  play: { cost: 1, ticketMul: 1.5, minMs: 10 * 1000, maxMs: 120 * 1000, growth: 8, hunger: 60, eggCutPct: 0.15, eggMax: 2, adultLifeMs: 30 * MIN, winAt: 0.6, winTicketsPerDay: 6 },
  // v6 — ĐỐM SÁNG ngoài đồng: người chơi chạm đốm sáng, gà chạy tới bới được 1–3 hạt (bảng "lucky"),
  // đôi khi cả một túi hạt. Mỗi trại tối đa 1 lần / cooldownMs. count: [ngưỡng xác suất, số hạt].
  lucky: { cooldownMs: 20 * 1000, count: [[0.6, 1], [0.85, 2], [0.96, 3]], bagSize: 3 },
  // v6 — NHIỆM VỤ NGÀY: mỗi ngày (theo giờ Việt Nam) 3 việc, xong cả 3 mở rương; chuỗi ngày liên tiếp
  // làm rương to hơn, cứ `streakEgg` ngày tặng một quả trứng quà.
  daily: { tzOffsetMs: 7 * HOUR, tasks: 3, taskBag: 3, chestBag: 6, chestStreakMax: 4, streakEgg: 3 },
  // v6 — GIỐNG: một con gà trưởng thành mang đủ tổ hợp đặc điểm, nuôi đủ chất → ghi tên giống, tặng túi quà;
  // đủ `incubatorAt` giống tặng thêm 1 ổ ấp.
  breed: { bag: 8, incubatorAt: 3 },
  // v9 — MÙA THEO TUẦN (ideas 7, chủ dự án chọn 21/11): mỗi tuần thật (từ thứ Hai 0:00 giờ Việt Nam) là một mùa, bốn mùa xoay vòng,
  // CHUNG cho mọi trại. Chỉ nhân trọng số bảng rơi và tần suất đã có — không thêm vật phẩm.
  //   field / lucky: hệ số nhân trọng số từng loại hạt · luckyCooldown: hệ số thời gian chờ đốm sáng
  //   spawn: hệ số mật độ hạt trên cánh đồng (chỉ hình, phía client) · price: hệ số giá vé của khách qua đường
  season: {
    order: ["harvest", "rain", "bloom", "dry"],
    harvest: { field: { millet: 3, corn: 3, mung: 2, sunflower: 2, lotus: 1.5 } }, // mùa gặt: ngũ cốc, đậu
    rain: { field: { sesame: 3, pumpkin: 2, peanut: 2 }, luckyCooldown: 0.6 }, // mùa mưa: đốm sáng dày hơn
    bloom: { field: { marigold: 4, sunflower: 2 }, lucky: { marigold: 2, sunflower: 1.5 } }, // mùa hoa
    dry: { spawn: 0.7, price: 0.8 }, // mùa khô: ít hạt, khách bán rẻ hơn
  },
  // v9 — ĐÊM TRĂNG TRÒN (ideas 9): ±1 ngày quanh lúc trăng tròn thiên văn, từ 18:00 tới 6:00 giờ Việt Nam. Trứng có phôi đẻ lúc đó
  // có tỉ lệ biến dị ×mutationMul (nhân với phần tăng của hạt lạ). Tính từ chu kỳ trăng trung bình — lệch vài giờ so với lịch, đủ dùng.
  // v10 — VƯỜN RAU (chủ dự án duyệt 22/11): luống trồng bằng hạt trong kho; cây lớn cả khi người chơi vắng mặt;
  // tưới (chạm luống) bớt cutPct thời gian lớn mỗi lần, tối đa `water.max` lần; thu hoạch được `yield` hạt cùng loại
  // (bonusChance thêm 1). Luống: `plots` lúc đầu, mỗi mốc Sổ ★★ thêm 1 tới `plotsMax`. Hạt lạ không trồng được.
  // Mùa mưa lớn nhanh hơn, mùa khô chậm hơn (seasonMul, tính lúc gieo).
  garden: {
    plots: 3, plotsMax: 5, yield: 3, bonusChance: 0.25,
    growMs: { rice: HOUR, mung: 3 * HOUR, millet: 3 * HOUR, sesame: 3 * HOUR, marigold: 3 * HOUR, sunflower: 4 * HOUR, corn: 4 * HOUR, pumpkin: 4 * HOUR, peanut: 4 * HOUR, lotus: 8 * HOUR, sorghum: 3 * HOUR, cotton: 3 * HOUR, wheat: 3 * HOUR, rapeseed: 3 * HOUR },
    water: { cutPct: 0.05, max: 6, cooldownMs: 3000 },
    seasonMul: { rain: 0.8, dry: 1.25 },
  },
  // v9 — LÔNG KỶ NIỆM (ideas 5): gà đã trưởng thành, sống trọn đời và đói không quá maxStarvedPct đời mình thì để lại một chiếc lông
  // (album trong Kỷ niệm). Thuần kỷ niệm, không tác dụng lên luật. Album giữ tối đa `cap` chiếc gần nhất.
  feather: { maxStarvedPct: 0.1, cap: 200 },
  moon: { newRef: Date.UTC(2000, 0, 6, 18, 14), synodicMs: 29.530588853 * DAY, halfWidth: 0.034, night: [18, 6], mutationMul: 3 },
  // Q14 (chủ dự án chốt 12/11): trứng ấp xong lúc người chơi vắng thì CHỜ trong ổ, nở khi người chơi
  // quay lại. Vắng ≤ khoảng này (đang mở game, chỉ giữa hai lần đồng bộ) thì vẫn nở đúng giờ.
  hatchPresenceGraceMs: 2 * MIN,
  // Sổ sưu tầm: ★ = đã nở gà mang đặc điểm; ★★ = nuôi gà đó tới trưởng thành với độ phát triển
  // của nhóm chất tương ứng ≥ starDev (gen biểu hiện đầy đủ). Q13 (chốt 12/11): mỗi mốc ★★ mở thêm
  // chỗ chuồng (trần coopMax); mốc đầu tặng thêm 1 ổ ấp.
  dex: {
    starDev: 0.85,
    coopMax: 12,
    milestones: [
      // mô phỏng 12/11: tuần đầu thường đạt mốc 1; mốc 3 cần đa dạng gen (trao đổi / biến dị) → vòng dài
      { at: 7, coop: 2, incubators: 1 },
      { at: 11, coop: 2 },
      { at: 15, coop: 2 },
    ],
  },
};

/* ---------- ngẫu nhiên có thể tái lập ---------- */

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
// Số ngẫu nhiên gắn với (seed, khoá) — không phụ thuộc thứ tự gọi
const rngFor = (state, ...key) => mulberry32(hash32(`${state.seed}|${key.join("|")}`));
const nextId = (state, prefix) => `${prefix}${(++state.seq).toString(36)}`;
const err = (code, message) => ({ ok: false, code, message });
const seedCount = (state) => Object.values(state.inventory).reduce((a, b) => a + b, 0);
const storedEggs = (state) => state.eggs.filter((e) => e.hatchAt === null).length;

// now (tuỳ chọn): áp hệ số của mùa lúc đó lên bảng rơi
export function rollSeed(table, rng, now = null) {
  const mul = now == null ? null : CONFIG.season[seasonOf(now)][table];
  const entries = Object.entries(CONFIG.drops[table]).map(([k, w]) => [k, w * (mul?.[k] ?? 1)]);
  let r = rng() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries[0][0];
}

/* ---------- gen → đặc tính ---------- */

function traitsOf(code) {
  const ph = express(decodeGenome(code));
  return {
    sex: ph.sex,
    growthMul: lerp(CONFIG.growthGene[0], CONFIG.growthGene[1], ph.stats.growth),
    layMeanMs: lerp(CONFIG.layMeanHours[0], CONFIG.layMeanHours[1], ph.stats.eggRate) * HOUR,
    lifespanMs: lerp(CONFIG.lifespanDays[0], CONFIG.lifespanDays[1], ph.stats.hardiness) * DAY,
    speed: ph.stats.speed, // 0–1, gen "Tốc độ" (chạy ngoài đồng)
    shell: ph.egg.shell,
    shellName: ph.egg.name,
    stamBase: Math.round(lerp(CONFIG.stamina.base[0], CONFIG.stamina.base[1], clamp((ph.stats.hardiness - 0.2) / 0.6))),
  };
}

/* ---------- thể lực (v7) ---------- */

// Thể lực tối đa lúc này: gốc theo gen × hệ số tuổi × (1 + rèn luyện). Gà nở trước v7 chưa có gốc → 80.
export function staminaMaxOf(ch) {
  const S = CONFIG.stamina;
  return Math.round((ch.stamBase ?? 80) * S.stage[stageOf(ch)]);
}
export const staminaOf = (ch) => Math.min(staminaMaxOf(ch), ch.stamina ?? staminaMaxOf(ch));
const isNight = (t) => {
  const h = new Date(t + CONFIG.daily.tzOffsetMs).getUTCHours(), [a, b] = CONFIG.stamina.night;
  return h >= a || h < b;
};

/* ---------- mùa theo tuần, đêm trăng tròn (v9) ---------- */

// Tuần thứ mấy kể từ 1/1/1970 (thứ Năm), đổi tuần lúc thứ Hai 0:00 giờ Việt Nam.
export const weekIndex = (now) => Math.floor((dayIndex(now) + 3) / 7);
export const seasonOf = (now) => CONFIG.season.order[((weekIndex(now) % 4) + 4) % 4];
const seasonFx = (now) => CONFIG.season[seasonOf(now)];
export const luckyCooldownMs = (now) => Math.round(CONFIG.lucky.cooldownMs * (seasonFx(now).luckyCooldown ?? 1));
export const fieldSpawnMul = (now) => seasonFx(now).spawn ?? 1;
const seasonPrice = (now, price) => (seasonFx(now).price ? Math.max(1, Math.round(price * seasonFx(now).price)) : price);
// pha trăng 0..1 (0 = trăng non, 0,5 = trăng tròn)
export const moonPhase = (t) => {
  const M = CONFIG.moon, p = ((t - M.newRef) / M.synodicMs) % 1;
  return p < 0 ? p + 1 : p;
};
const hourVN = (t) => new Date(t + CONFIG.daily.tzOffsetMs).getUTCHours();
export const fullMoonAt = (t) => {
  const M = CONFIG.moon, h = hourVN(t);
  return Math.abs(moonPhase(t) - 0.5) <= M.halfWidth && (h >= M.night[0] || h < M.night[1]);
};
// Bản xem cho giao diện: mùa này (hết lúc nào, mùa sau), trăng (đang tròn? đêm trăng tròn kế tiếp bắt đầu lúc nào).
export function calendarView(now) {
  const M = CONFIG.moon, wk = weekIndex(now), order = CONFIG.season.order;
  const ends = (wk + 1) * 7 * DAY - 3 * DAY - CONFIG.daily.tzOffsetMs;
  // mốc 18:00 đầu tiên trong cửa sổ trăng tròn sắp tới (hoặc đang diễn ra)
  let k = Math.floor((now - M.newRef) / M.synodicMs - 0.5 + M.halfWidth);
  let nextFull = null;
  for (let tries = 0; tries < 3 && nextFull == null; tries++, k++) {
    const mid = M.newRef + (k + 0.5) * M.synodicMs, a = mid - M.halfWidth * M.synodicMs, b = mid + M.halfWidth * M.synodicMs;
    for (let t = Math.max(a, now - HOUR); t < b; t += HOUR) {
      const h0 = Math.floor((t + CONFIG.daily.tzOffsetMs) / HOUR) * HOUR - CONFIG.daily.tzOffsetMs; // đầu giờ
      if (h0 + HOUR > now && fullMoonAt(Math.max(h0, a))) { nextFull = Math.max(h0, a, Math.min(now, h0 + HOUR)); break; }
    }
  }
  return { season: seasonOf(now), ends, next: order[(((wk + 1) % 4) + 4) % 4], fullMoon: fullMoonAt(now), nextFull, phase: moonPhase(now) };
}

export const incubateMsOf = (code) => express(decodeGenome(code)).egg.incubateMin * MIN;

// Độ hiếm: KHÔNG ảnh hưởng giá đổi (Q6); dùng cho sổ sưu tầm.
export function rarityOf(code) {
  const ph = express(decodeGenome(code));
  const s = ph.shape;
  return [
    s.crest > 0, s.muff, s.silkie, s.frizzle > 0, s.toes > 4, s.feetFeather > 0,
    s.tailType !== "normal", ph.dilute > 0, ph.darkSkin, ph.pattern !== "solid", s.combType !== "single",
  ].filter(Boolean).length;
}

/* ---------- sổ sưu tầm (Q-Dex, phần ★/★★ — đủ cho mốc Q13) ---------- */

// Mỗi mục: đặc điểm nhìn thấy được + nhóm chất làm nó biểu hiện (NUTRIENT_INFO). Chỉ THÊM vào cuối.
export const DEX = [
  { key: "mottled", name: "Hoa văn đốm", group: "pigment", has: (ph) => ph.pattern === "mottled" },
  { key: "spangled", name: "Hoa văn vảy cá", group: "pigment", has: (ph) => ph.pattern === "spangled" },
  { key: "laced", name: "Hoa văn viền", group: "pigment", has: (ph) => ph.pattern === "laced" },
  { key: "barred", name: "Hoa văn sọc vằn", group: "pigment", has: (ph) => ph.pattern === "barred" },
  { key: "blue", name: "Màu lam (nhạt)", group: "pigment", has: (ph) => ph.dilute === 1 },
  { key: "splash", name: "Màu bắn tóe", group: "pigment", has: (ph) => ph.dilute === 2 },
  { key: "darkSkin", name: "Da đen", group: "pigment", has: (ph) => ph.darkSkin },
  { key: "frizzle", name: "Lông xoăn", group: "protein", has: (ph) => ph.shape.frizzle > 0 },
  { key: "silkie", name: "Lông tơ", group: "protein", has: (ph) => ph.shape.silkie },
  { key: "crest", name: "Chỏm lông", group: "protein", has: (ph) => ph.shape.crest > 0 },
  { key: "muff", name: "Râu & tóc mai", group: "protein", has: (ph) => ph.shape.muff },
  { key: "feetFeather", name: "Lông chân", group: "protein", has: (ph) => ph.shape.feetFeather > 0 },
  { key: "longTail", name: "Đuôi dài", group: "protein", has: (ph) => ph.shape.tailType === "long" },
  { key: "rumpless", name: "Cụt đuôi", group: "energy", has: (ph) => ph.shape.tailType === "rumpless" },
  { key: "rose", name: "Mào hoa hồng", group: "mineral", has: (ph) => ph.shape.combType === "rose" },
  { key: "pea", name: "Mào hạt đậu", group: "mineral", has: (ph) => ph.shape.combType === "pea" },
  { key: "walnut", name: "Mào quả óc chó", group: "mineral", has: (ph) => ph.shape.combType === "walnut" },
  { key: "fiveToes", name: "Năm ngón", group: "mineral", has: (ph) => ph.shape.toes > 4 },
];

export const dexKeysOf = (code) => {
  const ph = express(decodeGenome(code));
  return DEX.filter((d) => d.has(ph)).map((d) => d.key);
};
export const dexStars = (state, star = 2) => Object.values(state.dex ?? {}).filter((v) => v >= star).length;
const DEX_GROUP = Object.fromEntries(DEX.map((d) => [d.key, d.group]));

/* ---------- giống: tổ hợp đặc điểm trên MỘT con gà (v6) ---------- */

// tier 1 = thường gặp (2 đặc điểm), 2 = hiếm, 3 = huyền thoại. Chỉ THÊM vào cuối.
export const BREEDS = [
  { key: "chomRau", name: "Gà Chỏm Râu", tier: 1, traits: ["crest", "muff"] },
  { key: "xuBong", name: "Gà Xù Bông", tier: 1, traits: ["frizzle", "feetFeather"] },
  { key: "vayHong", name: "Gà Vảy Hồng", tier: 1, traits: ["spangled", "rose"] },
  { key: "cuVan", name: "Gà Cú Vằn", tier: 1, traits: ["barred", "pea"] },
  { key: "cutLam", name: "Gà Cụt Lam", tier: 1, traits: ["rumpless", "blue"] },
  { key: "duoiPhung", name: "Gà Đuôi Phượng", tier: 2, traits: ["longTail", "laced"] },
  { key: "acTo", name: "Gà Ác Tơ", tier: 2, traits: ["silkie", "darkSkin", "fiveToes"] },
  { key: "hoaMo", name: "Gà Hoa Mơ", tier: 3, traits: ["mottled", "crest", "feetFeather", "walnut"] },
];
// Giống mà bộ gen này mang đủ đặc điểm (tiềm năng — còn phải nuôi đủ chất tới trưởng thành).
export const breedsOf = (code) => {
  const keys = new Set(dexKeysOf(code));
  return BREEDS.filter((b) => b.traits.every((t) => keys.has(t))).map((b) => b.key);
};

/* ---------- nhiệm vụ (v6) ---------- */

// Chuỗi mở đầu: làm lần lượt, mỗi bước một phần thưởng. `count` = bộ đếm trong state.count.
// Phần thưởng: { bag: cỡ túi, table } | { seeds: {loại: n} } | { egg: { quick, pair } }. Chỉ THÊM vào cuối.
export const TUTORIAL = [
  { key: "warm", count: "warm", goal: 5, text: "Sưởi ấm quả trứng: chạm vào trứng trong ổ 5 lần", reward: { bag: 3 } },
  { key: "hatch", count: "hatch", goal: 1, text: "Đón gà con đầu tiên chào đời", reward: { seeds: { lotus: 4 } } },
  { key: "feed", count: "feed", goal: 3, text: "Cho gà ăn 3 hạt (kéo hạt thả lên gà)", reward: { bag: 4 } },
  { key: "forage", count: "forage", goal: 5, text: "Thả gà ra đồng và để gà kiếm 5 hạt", reward: { egg: { quick: true, pair: true } } },
  { key: "lucky", count: "lucky", goal: 2, text: "Ngoài đồng: chạm 2 đốm sáng để chỉ cho gà", reward: { bag: 4, table: "gift" } },
  { key: "hatch2", count: "hatch", goal: 2, text: "Ấp nở quả trứng thứ hai", reward: { seeds: { mung: 2, millet: 2, sesame: 2, marigold: 2 } } },
  { key: "juvenile", count: "juvenile", goal: 1, text: "Nuôi một con thành gà giò", reward: { bag: 5, table: "gift" } },
  { key: "adult", count: "adult", goal: 1, text: "Nuôi một con tới trưởng thành", reward: { bag: 6, table: "gift" } },
  { key: "collect", count: "collect", goal: 1, text: "Nhặt quả trứng đầu tiên gà mái đẻ ngoài sân", reward: { egg: {} } },
  { key: "dex2", count: "dex2", goal: 1, text: "Đạt mục ★★ đầu tiên trong Sổ sưu tầm", reward: { bag: 8, table: "gift" } },
];

const hasBrood = (s) => s.eggs.some((e) => e.fertile) || (s.chickens.some((c) => c.sex === "hen" && c.adultAt != null) && s.chickens.some((c) => c.sex === "rooster" && c.adultAt != null));
// Việc trong ngày: `needs` lọc việc làm được với trại lúc sang ngày (không giao việc bất khả thi).
export const DAILY_TASKS = {
  feed: { goal: 8, text: (n) => `Cho gà ăn ${n} hạt` },
  forage: { goal: 12, text: (n) => `Để gà kiếm ${n} hạt ngoài đồng` },
  lucky: { goal: 5, text: (n) => `Chạm ${n} đốm sáng ngoài đồng` },
  warm: { goal: 8, text: (n) => `Sưởi trứng ${n} lần`, needs: hasBrood },
  hatch: { goal: 1, text: (n) => `Ấp nở ${n} gà con`, needs: hasBrood },
  collect: { goal: 2, text: (n) => `Nhặt ${n} quả trứng ngoài sân`, needs: (s) => s.chickens.some((c) => c.sex === "hen" && c.adultAt != null) },
  open: { goal: 2, text: (n) => `Mở ${n} túi hạt`, needs: (s) => s.bags.length + s.eggs.filter((e) => e.hatchAt === null).length >= 2 },
  harvest: { goal: 2, text: (n) => `Thu hoạch ${n} luống rau`, needs: (s) => !!s.garden }, // v10
};
export const COUNTERS = ["warm", "hatch", "feed", "forage", "lucky", "juvenile", "adult", "collect", "dex2", "open", "trade", "play", "knock", "harvest"];
const bump = (state, key, n = 1) => { state.count[key] = (state.count[key] ?? 0) + n; };
export const dayIndex = (now) => Math.floor((now + CONFIG.daily.tzOffsetMs) / DAY);

// v11: đổi tên hạt cũ sang loài (kho, tháp, luống) và thêm ô 0 cho loài mới
function migrateSeeds(state) {
  const remap = (bag) => {
    if (!bag) return bag;
    const out = Object.fromEntries(Object.keys(SEEDS).map((k) => [k, 0]));
    for (const [k, n] of Object.entries(bag)) { const kk = seedKey(k); if (Object.hasOwn(out, kk)) out[kk] += n; }
    return out;
  };
  state.inventory = remap(state.inventory);
  if (state.tower) state.tower = remap(state.tower);
  for (const p of state.garden ?? []) if (p) p.seed = seedKey(p.seed);
}
// Thêm loài sau v11: bù ô 0 (không cần đổi phiên bản)
function padSeeds(state) {
  for (const k of Object.keys(SEEDS)) {
    if (!(k in state.inventory)) state.inventory[k] = 0;
    if (state.tower && !(k in state.tower)) state.tower[k] = 0;
  }
}

// Trại từ bản cũ: bổ sung phần còn thiếu từ đàn hiện có (không đổi gì khác).
function ensure(state) {
  if (state.inventory && !Object.hasOwn(state.inventory, "rice")) migrateSeeds(state); // v11
  if (!state.tower) state.tower = Object.fromEntries(Object.keys(SEEDS).map((k) => [k, 0])); // v7
  if (state.watchFrom == null) state.watchFrom = state.seenAt ?? state.updatedAt;
  if (state.tickets == null) { state.tickets = 0; state.play = null; } // v7
  if (state.timed?.start == null) state.timed = { start: state.updatedAt ?? 0, claimed: 0 }; // v8: bản v7 lưu {step, readyAt}
  if (!state.energy) state.energy = { n: CONFIG.energy.max, at: state.updatedAt ?? 0 };
  if (!state.feathers) { state.feathers = []; state.family = {}; } // v9
  padSeeds(state);
  for (const ch of state.chickens) delete ch.fitness; // 22/11: bỏ độ dẻo dai
  if (!state.garden) state.garden = []; // v10 (độ dài theo gardenSize, bù dần)
  while (state.garden.length < gardenSize(state)) state.garden.push(null);
  if (!state.count) {
    // v6: bộ đếm nhiệm vụ, chuỗi mở đầu, chuỗi ngày, giống
    state.count = Object.fromEntries(COUNTERS.map((k) => [k, 0]));
    state.count.hatch = state.stats?.hatched ?? 0;
    state.count.juvenile = state.chickens.filter((c) => c.growth >= CONFIG.stages.juvenile).length;
    state.count.adult = state.chickens.filter((c) => c.adultAt != null).length;
    if (state.dex) state.count.dex2 = dexStars(state, 2);
    state.quest = { step: 0 };
    state.streak = { days: 0, last: -1, best: 0 };
    state.breeds = {};
  }
  if (!state.dex) {
    state.dex = {};
    state.milestones = 0;
    for (const ch of state.chickens) {
      dexMark(state, ch, 1, ch.hatchedAt, null);
      if (ch.adultAt != null) dexMark(state, ch, 2, ch.adultAt, null);
    }
  }
}

// Sang ngày mới (giờ Việt Nam): giao 3 việc, chọn theo (seed, ngày) trong các việc làm được.
function rollDaily(state, now) {
  const day = dayIndex(now);
  if (state.daily?.day === day) return;
  const rng = rngFor(state, "daily", day);
  const pool = Object.keys(DAILY_TASKS).filter((k) => !DAILY_TASKS[k].needs || DAILY_TASKS[k].needs(state));
  const tasks = [];
  while (tasks.length < CONFIG.daily.tasks && pool.length) {
    const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    tasks.push({ key: k, goal: DAILY_TASKS[k].goal, base: state.count[k] ?? 0, claimed: false });
  }
  state.daily = { day, tasks, chest: false };
}

// ★ nở được gà mang đặc điểm · ★★ nuôi con đó tới trưởng thành, đủ nhóm chất của đặc điểm ·
// ★★★ THUẦN CHỦNG (v6): như ★★, và bố lẫn mẹ của nó (gà trong trại) đều mang đặc điểm này — tức là
// người chơi đã chọn giống được qua một đời (ch.line ghi lúc trứng được đẻ).
function dexMark(state, ch, star, at, events) {
  for (const key of dexKeysOf(ch.code)) {
    let s = star;
    if (s >= 2) {
      if (ch.dev[DEX_GROUP[key]] < CONFIG.dex.starDev) continue;
      if (ch.line?.includes(key)) s = 3;
    }
    const was = state.dex[key] ?? 0;
    if (was >= s) continue;
    state.dex[key] = s;
    if (was < 2 && s >= 2 && state.count) bump(state, "dex2");
    events?.push({ type: "dex", at, key, star: s, chickenId: ch.id });
  }
  const done = dexStars(state, 2);
  const ms = CONFIG.dex.milestones;
  while (state.milestones < ms.length && done >= ms[state.milestones].at) {
    const m = ms[state.milestones++];
    state.coopCap = Math.min(CONFIG.dex.coopMax, state.coopCap + (m.coop ?? 0));
    for (let i = 0; i < (m.incubators ?? 0); i++) state.incubators.push(null);
    events?.push({ type: "milestone", at, n: state.milestones, coopCap: state.coopCap, incubators: state.incubators.length });
  }
}

// Gà vừa trưởng thành: mang đủ tổ hợp của một giống VÀ từng đặc điểm đều được nuôi đủ chất → đạt giống.
// Thưởng: một túi quà; đủ CONFIG.breed.incubatorAt giống thì thêm 1 ổ ấp.
function breedMark(state, ch, at, events) {
  for (const key of breedsOf(ch.code)) {
    if (state.breeds[key] != null) continue;
    const b = BREEDS.find((x) => x.key === key);
    if (b.traits.some((t) => ch.dev[DEX_GROUP[t]] < CONFIG.dex.starDev)) continue;
    state.breeds[key] = at;
    const bag = { id: nextId(state, "b"), size: CONFIG.breed.bag, from: "gift", at, table: "gift" };
    state.bags.push(bag);
    const n = Object.keys(state.breeds).length;
    if (n === CONFIG.breed.incubatorAt) state.incubators.push(null);
    events.push({ type: "breed", at, key, chickenId: ch.id, n, bagId: bag.id, incubators: state.incubators.length });
  }
}

/* ---------- tạo game ---------- */

export function starterEggs(seed) {
  const rng = mulberry32(seed >>> 0);
  return Array.from({ length: CONFIG.start.starterChoices }, () => {
    const mother = randomGenome(rng, { sex: "hen" });
    const child = randomGenome(rng);
    const ph = express(mother);
    return { code: encodeGenome(child), shell: ph.egg.shell, shellName: ph.egg.name };
  });
}

export function newGame(seed, now, choice = 0) {
  const idx = Number.isInteger(choice) ? clamp(choice, 0, CONFIG.start.starterChoices - 1) : 0;
  const pick = starterEggs(seed)[idx];
  const state = {
    v: CONFIG.version,
    seed: seed >>> 0,
    seq: 0,
    createdAt: now,
    updatedAt: now,
    coopCap: CONFIG.start.coopCap,
    incubators: Array(CONFIG.start.incubators).fill(null),
    inventory: Object.fromEntries(Object.keys(SEEDS).map((k) => [k, CONFIG.start.seeds[k] ?? 0])),
    bags: [], // túi hạt chưa mở
    chickens: [],
    eggs: [],
    memorial: [],
    feathers: [], // v9: lông kỷ niệm
    garden: Array(CONFIG.garden.plots).fill(null), // v10: luống rau — null | { seed, at, readyAt, water }
    family: {}, // v9: gà đã rời trại còn trong gia phả
    stats: { hatched: 0, laid: 0, traded: 0, died: 0 },
    seenAt: now, // lần cuối người chơi có mặt (Q14)
    watchFrom: now, // đầu phiên có mặt hiện tại (v7: tháp hạt chỉ nuôi gà trong phiên)
    tower: Object.fromEntries(Object.keys(SEEDS).map((k) => [k, 0])), // hạt trong tháp
    tickets: CONFIG.tickets.start, // vé (v7): có sẵn vài vé để thử sân chơi ngay từ đầu
    play: null, // lượt minigame đang chơi: { id, kind, at }
    timed: { start: now, claimed: 0 }, // rương theo giờ: đầu vòng + số rương đã nhận trong vòng
    energy: { n: CONFIG.energy.max, at: now }, // sức chơi
    dex: {}, // key → 1 (★) | 2 (★★) | 3 (★★★ thuần chủng)
    milestones: 0, // số mốc sổ đã đạt (Q13)
    count: Object.fromEntries(COUNTERS.map((k) => [k, 0])), // bộ đếm cho nhiệm vụ (v6)
    quest: { step: 0 }, // bước hiện tại của chuỗi mở đầu
    streak: { days: 0, last: -1, best: 0 }, // chuỗi ngày có nhận thưởng việc trong ngày
    breeds: {}, // key giống → thời điểm đạt
  };
  state.eggs.push({ id: nextId(state, "e"), code: pick.code, shell: pick.shell, shellName: pick.shellName, fertile: true, motherId: null, fatherId: null, laidAt: now, mutations: 0, hatchAt: null, quick: true });
  rollDaily(state, now);
  return state;
}

/* ---------- mô phỏng tới hiện tại ---------- */

// present: người chơi đang mở game lúc `now` (mặc định). Server truyền false cho việc hệ thống tự làm
// (gọi gà về khi hết phiên xem) → trứng ấp xong vẫn nằm chờ trong ổ (Q14).
// watchFrom: server đưa mốc đầu phiên mở game của người chơi (nó theo dõi cả những lần chỉ XEM, vốn không ghi gì
// vào state) và ghi mốc đó vào nhật ký để phát lại được. Không đưa → luật tự suy: vắng quá hatchPresenceGraceMs
// thì phiên mới bắt đầu từ `now`. continuous: client offline đang tua nhanh thời gian (hai lần gọi sát nhau theo
// giờ thật nhưng xa nhau theo giờ game) → vẫn coi là một phiên. Xem docs/chicken-farm/design-hard-parts.md §H1.
export function advance(state, now, { present = true, watchFrom, continuous = false } = {}) {
  const events = [];
  ensure(state);
  rollDaily(state, now);
  let watchedFrom = Infinity; // bước mô phỏng bắt đầu từ mốc này trở đi mới là "người chơi có mặt"
  if (present) {
    const seen = state.seenAt ?? -Infinity;
    if (watchFrom !== undefined) state.watchFrom = Math.max(watchFrom, state.createdAt ?? -Infinity);
    else if (!continuous && now - seen > CONFIG.hatchPresenceGraceMs) state.watchFrom = now;
    watchedFrom = state.watchFrom;
    const away = now - seen > CONFIG.hatchPresenceGraceMs;
    for (const egg of state.eggs.filter((e) => e.hatchAt !== null && e.hatchAt <= now).sort((a, b) => a.hatchAt - b.hatchAt)) {
      // vắng mặt → gà con chờ trong ổ tới lúc người chơi quay lại; đang xem → nở đúng giờ
      hatch(state, egg, away ? now : Math.min(now, Math.max(egg.hatchAt, seen)), events);
    }
    if (!(seen >= now)) state.seenAt = now;
  }
  if (now <= state.updatedAt) {
    events.sort((a, b) => a.at - b.at);
    return events;
  }
  // gà trống đi trước để biết chính xác lúc nào trống trưởng thành / mất
  const order = [...state.chickens].sort((a, b) => (a.sex === b.sex ? 0 : a.sex === "rooster" ? -1 : 1));
  for (const ch of order) advanceChicken(state, ch, now, events, watchedFrom);
  const gone = state.chickens.filter((c) => c.diedAt != null);
  for (const ch of gone) {
    const feather = ch.adultAt != null && ch.starvedMs <= CONFIG.feather.maxStarvedPct * ch.lifespanMs;
    state.memorial.push({ id: ch.id, name: ch.name, code: ch.code, hatchedAt: ch.hatchedAt, diedAt: ch.diedAt, dev: ch.dev, starvedMs: ch.starvedMs,
      motherId: ch.motherId ?? null, fatherId: ch.fatherId ?? null, ...(ch.relic ? { relic: ch.relic } : {}), ...(feather ? { feather: true } : {}) });
    if (feather) {
      state.feathers.push({ id: ch.id, name: ch.name, code: ch.code, at: ch.diedAt, ...(ch.relic ? { relic: ch.relic } : {}) });
      if (state.feathers.length > CONFIG.feather.cap) state.feathers.shift();
      events.push({ type: "feather", at: ch.diedAt, chickenId: ch.id, name: ch.name });
    }
    state.stats.died++;
  }
  if (gone.length) leave(state, gone.map((c) => c.id));
  state.updatedAt = now;
  events.sort((a, b) => a.at - b.at);
  return events;
}

/* ---------- gia phả, tính cách (v9) ---------- */

// Gà rời trại (mất / đổi / giao đơn): bỏ khỏi đàn, nhớ tên + mã gen + bố mẹ vào `state.family` để vẽ gia phả 3 đời.
// Chỉ giữ những con còn là bố mẹ hoặc ông bà của gà / trứng đang có — bảng luôn nhỏ.
function leave(state, ids) {
  state.family ??= {};
  for (const ch of state.chickens.filter((c) => ids.includes(c.id))) state.family[ch.id] = [ch.name, ch.code, ch.motherId ?? null, ch.fatherId ?? null];
  state.chickens = state.chickens.filter((c) => !ids.includes(c.id));
  const keep = new Set();
  const up = (id, depth) => {
    if (!id || depth > 2) return;
    keep.add(id);
    const c = state.chickens.find((x) => x.id === id), f = state.family[id];
    up(c ? c.motherId : f?.[2], depth + 1);
    up(c ? c.fatherId : f?.[3], depth + 1);
  };
  for (const c of state.chickens) up(c.id, 0);
  for (const e of state.eggs) { up(e.motherId, 1); up(e.fatherId, 1); }
  for (const id of Object.keys(state.family)) if (!keep.has(id)) delete state.family[id];
}
// Một con trong gia phả: gà đang ở trại hoặc đã rời trại (còn nhớ). null = không rõ (gà khởi đầu, trứng quà, đã quên).
export function kinOf(state, id) {
  if (!id) return null;
  const c = state.chickens.find((x) => x.id === id);
  if (c) return { id, name: c.name, code: c.code, motherId: c.motherId ?? null, fatherId: c.fatherId ?? null, here: true };
  const f = state.family?.[id];
  return f ? { id, name: f[0], code: f[1], motherId: f[2], fatherId: f[3], here: false } : null;
}

// Tính cách suy từ gen sẵn có (ideas 4): tối đa 2 nhãn, nhãn rõ nhất trước. Chủ yếu là dáng đi đứng trên sân;
// không đổi luật. greedy: hay quanh máng · lively: đi lại nhiều · shy: nép gần chuồng · layer: hay quanh ổ (chỉ gà mái).
export const PERSONALITY = {
  greedy: { name: "Tham ăn", stat: "appetite", hi: true },
  lively: { name: "Hiếu động", stat: "speed", hi: true },
  shy: { name: "Nhút nhát", stat: "hardiness", hi: false },
  layer: { name: "Chăm đẻ", stat: "eggRate", hi: true, hen: true },
  calm: { name: "Điềm tĩnh" }, // không nổi bật điều gì
};
export function personalityOf(code) {
  const ph = express(decodeGenome(code));
  const out = Object.entries(PERSONALITY).filter(([, p]) => p.stat)
    .map(([k, p]) => [k, p.hi ? ph.stats[p.stat] - 0.6 : 0.4 - ph.stats[p.stat]])
    .filter(([k, d]) => d >= 0 && !(PERSONALITY[k].hen && ph.sex !== "hen"))
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  return out.length ? out : ["calm"];
}

function hatch(state, egg, at, events) {
  state.eggs = state.eggs.filter((e) => e.id !== egg.id);
  state.incubators = state.incubators.map((id) => (id === egg.id ? null : id));
  const t = traitsOf(egg.code);
  const p = CONFIG.devPrior;
  const ch = {
    id: nextId(state, "c"),
    name: randomName(rngFor(state, "name", egg.id)),
    code: egg.code,
    hatchedAt: at,
    updatedAt: at,
    lifeUsed: 0, // tuổi đã dùng (ms) — lúc đói tăng nhanh hơn
    starvedMs: 0,
    adultAt: null,
    diedAt: null,
    location: "coop",
    lastFieldEat: -1e15,
    growth: 0,
    satiety: CONFIG.hatch.satiety,
    n: Object.fromEntries(NUTRIENTS.map((k) => [k, CONFIG.hatch.nutrient])),
    dev: Object.fromEntries(NUTRIENTS.map((k) => [k, p.level])),
    devWeight: p.weight,
    mutationBoost: 0,
    motherId: egg.motherId,
    fatherId: egg.fatherId,
    ...(egg.line?.length ? { line: egg.line } : {}), // đặc điểm cả bố lẫn mẹ đều mang (cho ★★★)
    ...(egg.mystery ? { relic: egg.mystery } : {}), // kỳ vật từ trứng bí ẩn (không nằm trong gen)
    ...t,
  };
  state.chickens.push(ch);
  state.stats.hatched++;
  bump(state, "hatch");
  events.push({ type: "hatched", at, chickenId: ch.id, eggId: egg.id });
  if (ch.relic) {
    state.relics ??= {};
    const first = state.relics[ch.relic] == null;
    if (first) state.relics[ch.relic] = at;
    events.push({ type: "relic", at, chickenId: ch.id, key: ch.relic, first });
  }
  dexMark(state, ch, 1, at, events);
}

export function qualityOf(ch) {
  return NUTRIENTS.reduce((s, k) => s + Math.min(1, ch.n[k] / CONFIG.nutrientFull), 0) / NUTRIENTS.length;
}

const growMsAt = (ch) => CONFIG.growMs.worst * Math.pow(CONFIG.growMs.best / CONFIG.growMs.worst, qualityOf(ch)) / ch.growthMul;
export const msToAdult = (ch) => ((CONFIG.stages.adult - ch.growth) / CONFIG.stages.adult) * growMsAt(ch);

function eat(ch, seed) {
  const s = SEEDS[seed];
  ch.satiety = Math.min(CONFIG.satietyMax, ch.satiety + s.satiety);
  for (const k of NUTRIENTS) ch.n[k] = Math.max(0, Math.min(CONFIG.nutrientMax, ch.n[k] + s.n[k])); // hạt có chất kháng: không dưới 0
  if (s.mutation) ch.mutationBoost = Math.min(CONFIG.mutationBoostCap, ch.mutationBoost + s.mutation);
}

function advanceChicken(state, ch, now, events, watchedFrom = Infinity) {
  const step = CONFIG.stepMs;
  const end = Math.floor(now / step) * step;
  let t = ch.updatedAt;
  while (t < end && ch.diedAt == null) {
    const dt = Math.min((Math.floor(t / step) + 1) * step, end) - t;
    stepChicken(state, ch, t, dt, events, watchedFrom);
    t += dt;
  }
  ch.updatedAt = Math.max(ch.updatedAt, ch.diedAt ?? end);
}

// Gà mái ấp giúp. Đang ấp: mỗi phút kéo giờ nở của quả trứng sớm thêm (speed − 1) phút. Chưa ấp: mái lớn, no bụng,
// ở chuồng, có trứng đang ấp chưa ai ấp giúp → theo xác suất thì vào ổ. Rời chuồng / hết giờ / trứng nở thì thôi.
function brood(state, ch, t, dt, events) {
  const B = CONFIG.brood;
  if (ch.broodEgg) {
    const egg = state.eggs.find((e) => e.id === ch.broodEgg && e.hatchAt !== null);
    if (egg && t < ch.broodUntil && ch.location === "coop") {
      // kéo sớm lại nhưng không sớm hơn cuối bước này — và KHÔNG BAO GIỜ đẩy muộn đi (trứng sắp nở vẫn nở đúng giờ)
      egg.hatchAt = Math.min(egg.hatchAt, Math.max(t + dt, egg.hatchAt - (B.speed - 1) * dt));
      return;
    }
    if (egg) delete egg.broodBy;
    delete ch.broodEgg;
    delete ch.broodUntil;
  }
  if (ch.sex !== "hen" || ch.adultAt == null || ch.location !== "coop" || ch.satiety < B.satiety * CONFIG.satietyMax) return;
  const egg = state.eggs.find((e) => e.hatchAt !== null && e.hatchAt > t + dt && !e.broodBy);
  if (!egg || rngFor(state, "brood", ch.id, t)() >= (dt * B.chancePerHour) / HOUR) return;
  egg.broodBy = ch.id;
  ch.broodEgg = egg.id;
  ch.broodUntil = t + B.minutes * MIN;
  events.push({ type: "brood", at: t, chickenId: ch.id, eggId: egg.id });
}

// Hạt hợp nhất cho con gà trong số hạt đang có: bù nhiều nhất cho chất còn thiếu; hoà điểm thì hạt thường
// (tiết kiệm hạt tốt), rồi theo thứ tự trong SEEDS. Không bao giờ tự chọn hạt lạ. Hết hạt → null.
export function bestSeedFor(ch, counts) {
  let best = null, bestScore = -1;
  for (const k of Object.keys(SEEDS)) {
    if (handOnly(k) || !(counts[k] > 0)) continue;
    let v = SEEDS[k].staple ? 0.5 : 0;
    for (const n of NUTRIENTS) v += Math.min(Math.max(0, CONFIG.nutrientFull - ch.n[n]), SEEDS[k].n[n]);
    if (v > bestScore) { bestScore = v; best = k; }
  }
  return best;
}

function stepChicken(state, ch, t, dt, events, watchedFrom = Infinity) {
  // tháp hạt: chỉ ở bước người chơi có mặt, gà đang ở chuồng và đói dưới ngưỡng; mỗi bước tối đa 1 hạt
  if (t >= watchedFrom && ch.location === "coop" && ch.satiety < CONFIG.tower.eatBelow * CONFIG.satietyMax) {
    const k = bestSeedFor(ch, state.tower);
    if (k) {
      state.tower[k]--;
      eat(ch, k);
    }
  }
  brood(state, ch, t, dt, events);
  const h = dt / HOUR;
  const fed = ch.satiety > 0;
  // thể lực: ngoài đồng thì tiêu, ở chuồng và không đói thì hồi (đêm gấp đôi)
  const S = CONFIG.stamina, sMax = staminaMaxOf(ch), sNow = Math.min(sMax, ch.stamina ?? sMax);
  ch.stamina = ch.location === "field" ? Math.max(0, sNow - S.fieldPerHour * h)
    : fed ? Math.min(sMax, sNow + S.regenPerHour * h * (isNight(t) ? S.nightMul : 1)) : sNow;
  const layReady = ch.satiety >= CONFIG.laySatiety;
  ch.satiety = Math.max(0, ch.satiety - CONFIG.satietyDrainPerHour * h);

  // tuổi: lúc bụng rỗng già nhanh hơn (Q2)
  ch.lifeUsed += fed ? dt : dt * CONFIG.starveAging;
  if (!fed) ch.starvedMs += dt;
  if (ch.lifeUsed >= ch.lifespanMs) {
    ch.diedAt = t + dt;
    events.push({ type: "died", at: ch.diedAt, chickenId: ch.id, starved: !fed });
    return;
  }

  if (fed && ch.growth < CONFIG.stages.adult) {
    const before = ch.growth;
    ch.growth = Math.min(CONFIG.stages.adult, ch.growth + (CONFIG.stages.adult * dt) / growMsAt(ch));
    const used = ch.growth - before;
    // dinh dưỡng trong lúc lớn quyết định gen biểu hiện tới đâu
    for (const k of NUTRIENTS) {
      const lvl = Math.min(1, ch.n[k] / CONFIG.nutrientFull);
      ch.dev[k] = (ch.dev[k] * ch.devWeight + lvl * used) / (ch.devWeight + used);
    }
    ch.devWeight += used;
    if (before < CONFIG.stages.juvenile && ch.growth >= CONFIG.stages.juvenile) {
      bump(state, "juvenile");
      events.push({ type: "juvenile", at: t + dt, chickenId: ch.id });
    }
    if (ch.growth >= CONFIG.stages.adult) {
      ch.adultAt = t + dt;
      bump(state, "adult");
      events.push({ type: "adult", at: t + dt, chickenId: ch.id });
      dexMark(state, ch, 2, t + dt, events);
      breedMark(state, ch, t + dt, events);
    }
  } else if (layReady && !ch.broodEgg && ch.sex === "hen" && ch.growth >= CONFIG.stages.adult && storedEggs(state) < CONFIG.storage.eggs) {
    // Q3: đẻ ngẫu nhiên khi no bụng — xác suất mỗi bước = dt / thời gian trung bình
    if (rngFor(state, "lay", ch.id, t)() < dt / ch.layMeanMs) layEgg(state, ch, t + dt, events);
  }
  for (const k of NUTRIENTS) ch.n[k] = Math.max(0, ch.n[k] - CONFIG.nutrientDrainPerHour * h);
}

// Có ≥ 1 trống trưởng thành, còn sống trong trại → trứng có phôi; bố chọn ngẫu nhiên (Q1).
function layEgg(state, hen, at, events) {
  const rng = rngFor(state, "egg", hen.id, at);
  const roosters = state.chickens.filter((c) => c.sex === "rooster" && c.adultAt != null && c.adultAt <= at && (c.diedAt == null || c.diedAt > at));
  let code = hen.code, fertile = false, fatherId = null, mutations = 0, line = [], moon = false;
  if (roosters.length) {
    const father = roosters[Math.floor(rng() * roosters.length)];
    moon = fullMoonAt(at); // v9: đêm trăng tròn
    const r = breed(decodeGenome(father.code), decodeGenome(hen.code), rng, { mutationRate: (1 + hen.mutationBoost) * (moon ? CONFIG.moon.mutationMul : 1) });
    code = encodeGenome(r.genome);
    mutations = r.mutations.length;
    fertile = true;
    fatherId = father.id;
    hen.mutationBoost = Math.max(0, hen.mutationBoost - 1);
    const fk = new Set(dexKeysOf(father.code));
    line = dexKeysOf(hen.code).filter((k) => fk.has(k));
  }
  // id gắn với (mẹ, thời điểm) để không phụ thuộc thứ tự mô phỏng
  // trứng mới đẻ nằm ngoài SÂN; người chơi nhặt (collectEgg) mới vào kho
  const egg = { id: `e-${hen.id}-${at.toString(36)}`, code, shell: hen.shell, shellName: hen.shellName, fertile, motherId: hen.id, fatherId, laidAt: at, mutations, hatchAt: null, inYard: true, ...(line.length ? { line } : {}), ...(moon ? { moon: true } : {}) };
  state.eggs.push(egg);
  state.stats.laid++;
  events.push({ type: "laid", at, chickenId: hen.id, eggId: egg.id, fertile });
}

/* ---------- hành động ---------- */

function act(state, now, fn, opts) {
  const events = advance(state, now, opts);
  const r = fn();
  if (r && r.ok === false) return { ...r, events };
  return { ok: true, events, ...(r || {}) };
}

// Cho ăn trong chuồng bằng hạt trong kho.
export function feed(state, chickenId, seed, now) {
  seed = seedKey(seed);
  return act(state, now, () => {
    const s = SEEDS[seed];
    if (!s) return err("bad_seed", "Không có loại hạt này");
    if (!(state.inventory[seed] > 0)) return err("no_seed", `Hết ${s.name.toLowerCase()}`);
    const ch = state.chickens.find((c) => c.id === chickenId);
    if (!ch) return err("no_chicken", "Không tìm thấy gà");
    if (ch.location !== "coop") return err("in_field", `${ch.name} đang ngoài đồng`);
    if (ch.satiety + s.satiety * 0.5 > CONFIG.satietyMax) return err("full", `${ch.name} đang no`);
    state.inventory[seed]--;
    eat(ch, seed);
    bump(state, "feed");
    return { chickenId };
  });
}

// Q4: chỉ thả ra đồng khi người chơi đang quan sát; rời đi thì gọi recallAll().
// Mỗi người chơi chỉ được thả MỘT con ra cánh đồng mỗi lúc.
export function release(state, chickenId, now) {
  return act(state, now, () => {
    const ch = state.chickens.find((c) => c.id === chickenId);
    if (!ch) return err("no_chicken", "Không tìm thấy gà");
    const out = state.chickens.find((c) => c.location === "field" && c.id !== chickenId);
    if (out) return err("field_busy", `Mỗi lần chỉ thả được 1 con — ${out.name} đang ngoài đồng`);
    ch.location = "field";
    return { chickenId };
  });
}

// opts.present = false khi hệ thống tự gọi về (người chơi không có mặt) — xem advance().
export function recall(state, chickenId, now, opts) {
  return act(state, now, () => {
    const ch = state.chickens.find((c) => c.id === chickenId);
    if (!ch) return err("no_chicken", "Không tìm thấy gà");
    ch.location = "coop";
    return { chickenId };
  }, opts);
}

// Người chơi rời màn hình / mất kết nối → mọi gà tự về trại.
export function recallAll(state, now, opts) {
  return act(state, now, () => {
    const ids = state.chickens.filter((c) => c.location === "field").map((c) => c.id);
    for (const c of state.chickens) c.location = "coop";
    return { recalled: ids };
  }, opts);
}

// Gà ngoài đồng tìm được một hạt. Bộ mô phỏng cánh đồng (field.js — chạy ở client offline,
// ở server từ M3) quyết định loại hạt; hàm này kiểm tra hợp lệ rồi:
//   còn đói → gà ăn luôn; đã no → hạt mang về kho (Q7).
export function fieldFind(state, chickenId, seed, now) {
  seed = seedKey(seed);
  return act(state, now, () => {
    const ch = state.chickens.find((c) => c.id === chickenId);
    if (!ch) return err("no_chicken", "Không tìm thấy gà");
    if (ch.location !== "field") return err("not_in_field", `${ch.name} không ở ngoài đồng`);
    if (!SEEDS[seed]) return err("bad_seed", "Không có loại hạt này");
    if (now - ch.lastFieldEat < CONFIG.fieldEatCooldownMs) return err("too_fast", "Mổ nhanh quá");
    if (ch.satiety + SEEDS[seed].satiety * 0.5 <= CONFIG.satietyMax) {
      ch.lastFieldEat = now;
      eat(ch, seed);
      bump(state, "forage");
      return { chickenId, seed, action: "ate" };
    }
    if (seedCount(state) >= CONFIG.storage.seeds) return err("seeds_full", "Kho hạt đầy");
    ch.lastFieldEat = now;
    state.inventory[seed]++;
    bump(state, "forage");
    return { chickenId, seed, action: "stored" };
  });
}
export const canFieldPeck = (ch, now) => ch.location === "field" && now - ch.lastFieldEat >= CONFIG.fieldEatCooldownMs;

// Nhặt trứng ngoài sân cho vào kho. (Trứng ngoài sân vẫn ấp / đổi được trực tiếp.)
export function collectEgg(state, eggId, now) {
  return act(state, now, () => {
    const egg = state.eggs.find((e) => e.id === eggId);
    if (!egg) return err("no_egg", "Không tìm thấy trứng");
    if (!egg.inYard) return err("not_in_yard", "Trứng đã ở trong kho");
    egg.inYard = false;
    bump(state, "collect");
    return { eggId };
  });
}

export function incubate(state, eggId, now) {
  return act(state, now, () => {
    const egg = state.eggs.find((e) => e.id === eggId);
    if (!egg) return err("no_egg", "Không tìm thấy trứng");
    if (!egg.fertile) return err("infertile", "Trứng không có phôi — cần có gà trống trong trại. Trứng này chỉ để đổi hạt");
    if (egg.hatchAt !== null) return err("already", "Trứng đang được ấp");
    const slot = state.incubators.indexOf(null);
    if (slot < 0) return err("no_incubator", "Ổ ấp đã đầy");
    if (state.chickens.length + state.incubators.filter(Boolean).length >= state.coopCap) return err("coop_full", "Chuồng hết chỗ cho gà mới");
    state.incubators[slot] = egg.id;
    egg.inYard = false;
    egg.incubateMs = egg.quick ? CONFIG.start.quickHatchMs : incubateMsOf(egg.code);
    egg.hatchAt = now + egg.incubateMs;
    return { eggId, hatchAt: egg.hatchAt };
  });
}

// THÁP HẠT (v7): đổ hạt từ kho vào tháp / lấy lại. Gà tự ăn trong stepChicken khi người chơi có mặt.
const towerCount = (state) => Object.values(state.tower).reduce((a, b) => a + b, 0);
/* ---------- vườn rau (v10) ---------- */

export const gardenSize = (state) => Math.min(CONFIG.garden.plotsMax, CONFIG.garden.plots + (state.milestones ?? 0));
export const canPlant = (seed) => !!CONFIG.garden.growMs[seedKey(seed)];
// thời gian lớn của một hạt nếu gieo lúc `now` (theo mùa)
export const growMsOf = (seed, now) => Math.round(CONFIG.garden.growMs[seedKey(seed)] * (CONFIG.garden.seasonMul[seasonOf(now)] ?? 1));
// Bản xem một luống: { plot, seed, growth 0..1, ready, readyAt, water, waterLeft } | { plot, empty: true }
export function plotView(state, i, now) {
  const p = state.garden?.[i];
  if (!p) return { plot: i, empty: true };
  const total = p.total ?? (p.readyAt - p.at);
  return { plot: i, seed: p.seed, growth: clamp((now - p.at) / Math.max(1, p.readyAt - p.at), 0, 1), ready: now >= p.readyAt, readyAt: p.readyAt, water: p.water ?? 0, waterLeft: CONFIG.garden.water.max - (p.water ?? 0), total };
}
const plotOf = (state, plot) => (Number.isInteger(plot) && plot >= 0 && plot < gardenSize(state) ? plot : -1);

export function plant(state, plot, seed, now) {
  seed = seedKey(seed);
  return act(state, now, () => {
    const i = plotOf(state, plot);
    if (i < 0) return err("no_plot", "Không có luống này");
    if (state.garden[i]) return err("plot_busy", "Luống này đang có cây");
    if (!canPlant(seed)) return err("bad_seed", "Hạt này không trồng được");
    if (!(state.inventory[seed] >= 1)) return err("no_seed", "Hết loại hạt này");
    const total = growMsOf(seed, now);
    state.inventory[seed]--;
    state.garden[i] = { seed, at: now, readyAt: now + total, total, water: 0 };
    return { plot: i, seed, readyAt: now + total };
  });
}
// Tưới: kéo giờ chín sớm lại cutPct × tổng thời gian lớn (không sớm hơn bây giờ).
export function waterPlot(state, plot, now) {
  return act(state, now, () => {
    const i = plotOf(state, plot), W = CONFIG.garden.water, p = i < 0 ? null : state.garden[i];
    if (!p) return err("no_plant", "Luống này chưa có cây");
    if (now >= p.readyAt) return err("ready", "Cây đã chín — thu hoạch thôi");
    if ((p.water ?? 0) >= W.max) return err("watered", "Đã tưới đủ rồi");
    if (now - (state.waterAt ?? -1e15) < W.cooldownMs) return err("too_fast", "Tưới từ từ thôi");
    p.water = (p.water ?? 0) + 1;
    p.readyAt = Math.max(now, p.readyAt - Math.round(W.cutPct * p.total));
    state.waterAt = now;
    return { plot: i, readyAt: p.readyAt, water: p.water };
  });
}
// Thu hoạch: `yield` hạt cùng loại (đôi khi thêm 1). opts.rng: server truyền nguồn ngẫu nhiên riêng.
export function harvest(state, plot, now, opts = {}) {
  return act(state, now, () => {
    const i = plotOf(state, plot), G = CONFIG.garden, p = i < 0 ? null : state.garden[i];
    if (!p) return err("no_plant", "Luống này chưa có cây");
    if (now < p.readyAt) return err("not_ready", "Cây chưa chín");
    const rng = opts.rng ?? rngFor(state, "harvest", i, p.at);
    const n = G.yield + (rng() < G.bonusChance ? 1 : 0);
    if (seedCount(state) + n > CONFIG.storage.seeds) return err("seeds_full", "Kho hạt đầy — dùng bớt hạt rồi thu hoạch");
    state.inventory[p.seed] += n;
    state.garden[i] = null;
    bump(state, "harvest");
    return { plot: i, seed: p.seed, n };
  });
}

export function fillTower(state, seed, n, now) {
  seed = seedKey(seed);
  return act(state, now, () => {
    if (!SEEDS[seed]) return err("bad_seed", "Không có loại hạt này");
    if (SEEDS[seed].mutation) return err("bad_seed", "Hạt lạ phải cho ăn riêng từng con");
    if (handOnly(seed)) return err("bad_seed", "Hạt này kéo một chất xuống — chỉ cho ăn riêng từng con");
    if (!Number.isInteger(n) || n < 1) return err("bad_count", "Số hạt không hợp lệ");
    if (!(state.inventory[seed] >= n)) return err("no_seed", `Kho không đủ ${SEEDS[seed].name.toLowerCase()}`);
    if (towerCount(state) + n > CONFIG.tower.cap) return err("tower_full", "Tháp hạt không còn đủ chỗ");
    state.inventory[seed] -= n;
    state.tower[seed] += n;
    bump(state, "feed", n);
    return { seed, n, tower: towerCount(state) };
  });
}
export function takeFromTower(state, seed, n, now) {
  seed = seedKey(seed);
  return act(state, now, () => {
    if (!SEEDS[seed]) return err("bad_seed", "Không có loại hạt này");
    if (!Number.isInteger(n) || n < 1) return err("bad_count", "Số hạt không hợp lệ");
    if (!(state.tower[seed] >= n)) return err("no_seed", "Tháp không có đủ loại hạt này");
    if (seedCount(state) + n > CONFIG.storage.seeds) return err("seeds_full", "Kho hạt đầy");
    state.tower[seed] -= n;
    state.inventory[seed] += n;
    return { seed, n, tower: towerCount(state) };
  });
}

// SƯỞI TRỨNG (v6): chạm trứng đang ấp → bớt một phần thời gian ấp. Có giới hạn số lần và nhịp chạm.
export function warmEgg(state, eggId, now) {
  return act(state, now, () => {
    const egg = state.eggs.find((e) => e.id === eggId);
    if (!egg) return err("no_egg", "Không tìm thấy trứng");
    if (egg.hatchAt === null) return err("not_incubating", "Trứng chưa nằm trong ổ ấp");
    if ((egg.warmed ?? 0) >= CONFIG.warm.max) return err("warm_max", "Trứng đã đủ ấm — chờ gà con thôi");
    if (now - (egg.warmAt ?? -1e15) < CONFIG.warm.cooldownMs) return err("too_fast", "Từ từ thôi, trứng đang ấm dần");
    egg.warmed = (egg.warmed ?? 0) + 1;
    egg.warmAt = now;
    egg.hatchAt = Math.max(now, egg.hatchAt - CONFIG.warm.cutPct * (egg.incubateMs ?? incubateMsOf(egg.code)));
    bump(state, "warm");
    return { eggId, hatchAt: egg.hatchAt, warmed: egg.warmed };
  });
}

// GÕ TRỨNG (v7): trứng đã ấp tới mốc knock.fromPct thì gõ cho nở ngay (không gõ vẫn tự nở đúng giờ).
export function knockEgg(state, eggId, now) {
  const events = advance(state, now);
  const egg = state.eggs.find((e) => e.id === eggId);
  const fail = (code, message) => ({ ok: false, code, message, events });
  if (!egg) return fail("no_egg", "Không tìm thấy trứng");
  if (egg.hatchAt === null) return fail("not_incubating", "Trứng chưa nằm trong ổ ấp");
  const total = egg.incubateMs ?? incubateMsOf(egg.code);
  if (1 - (egg.hatchAt - now) / total < CONFIG.knock.fromPct) return fail("too_early", "Trứng chưa sẵn sàng — sưởi thêm hoặc chờ một lúc");
  egg.hatchAt = now;
  bump(state, "knock");
  events.push(...advance(state, now)); // nở qua đúng đường cũ (sự kiện hatched, chấm sổ)
  return { ok: true, events, eggId, chickenId: events.find((e) => e.type === "hatched" && e.eggId === eggId)?.chickenId };
}

// ĐỐM SÁNG (v6): người chơi chỉ cho gà ngoài đồng một đốm sáng → gà bới được 1–3 hạt tốt hơn thường,
// đôi khi cả một túi hạt. Hạt về thẳng kho. opts.rng: server truyền nguồn ngẫu nhiên riêng (HMAC).
export function fieldBonus(state, chickenId, now, opts = {}) {
  return act(state, now, () => {
    const ch = state.chickens.find((c) => c.id === chickenId);
    if (!ch) return err("no_chicken", "Không tìm thấy gà");
    if (ch.location !== "field") return err("not_in_field", `${ch.name} không ở ngoài đồng`);
    if (now - (state.luckyAt ?? -1e15) < luckyCooldownMs(now)) return err("too_fast", "Chưa có đốm sáng mới");
    const room = CONFIG.storage.seeds - seedCount(state);
    if (room <= 0) return err("seeds_full", "Kho hạt đầy");
    const rng = opts.rng ?? rngFor(state, "lucky", now);
    const r = rng();
    state.luckyAt = now;
    bump(state, "lucky");
    const table = CONFIG.lucky.count;
    if (r >= table[table.length - 1][0] && state.bags.length < CONFIG.storage.bags) {
      const bag = { id: nextId(state, "b"), size: CONFIG.lucky.bagSize, from: "field", at: now, table: "gift" };
      state.bags.push(bag);
      return { chickenId, bagId: bag.id, bagSize: bag.size };
    }
    const n = Math.min(room, table.find(([p]) => r < p)?.[1] ?? table[table.length - 1][1]);
    const got = {};
    for (let i = 0; i < n; i++) {
      const k = rollSeed("lucky", rng, now);
      got[k] = (got[k] ?? 0) + 1;
      state.inventory[k]++;
    }
    return { chickenId, got };
  });
}

/* ---------- nhiệm vụ: xem tiến độ, nhận thưởng (v6) ---------- */

// Trứng quà: gen ngẫu nhiên như trứng của cửa hàng. pair: trại chỉ có một giới thì quả này chắc chắn nở ra
// giới còn lại (để người mới sớm có cặp sinh sản). quick: nở nhanh như quả trứng đầu tiên.
function giftEgg(state, now, rng, { quick = false, pair = false } = {}) {
  const sexes = new Set(state.chickens.map((c) => c.sex));
  const sex = pair && sexes.size === 1 ? (sexes.has("hen") ? "rooster" : "hen") : undefined;
  const mother = randomGenome(rng, { sex: "hen" });
  const child = randomGenome(rng, sex ? { sex } : {});
  const ph = express(mother);
  return { id: nextId(state, "e"), code: encodeGenome(child), shell: ph.egg.shell, shellName: ph.egg.name, fertile: true, motherId: null, fatherId: null, laidAt: now, mutations: 0, hatchAt: null, gift: true, ...(quick ? { quick: true } : {}) };
}

// Kiểm tra chỗ chứa TRƯỚC, đủ chỗ mới trao (không trao một nửa).
function giveReward(state, reward, now, rng) {
  const seedsN = Object.values(reward.seeds ?? {}).reduce((a, b) => a + b, 0);
  if (reward.bag && state.bags.length >= CONFIG.storage.bags) return err("bags_full", "Kho hết chỗ để túi hạt — mở bớt túi rồi nhận thưởng");
  if (seedsN && seedCount(state) + seedsN > CONFIG.storage.seeds) return err("seeds_full", "Kho hạt đầy — dùng bớt hạt rồi nhận thưởng");
  if (reward.egg && storedEggs(state) >= CONFIG.storage.eggs) return err("eggs_full", "Kho trứng đầy — ấp hoặc đổi bớt trứng rồi nhận thưởng");
  const got = {};
  if (reward.bag) {
    const bag = { id: nextId(state, "b"), size: reward.bag, from: "gift", at: now, ...(reward.table ? { table: reward.table } : {}) };
    state.bags.push(bag);
    got.bagId = bag.id;
    got.bagSize = bag.size;
  }
  if (seedsN) {
    for (const [k, n] of Object.entries(reward.seeds)) state.inventory[k] += n;
    got.seeds = { ...reward.seeds };
  }
  if (reward.ticket) {
    got.tickets = Math.min(reward.ticket, CONFIG.tickets.cap - state.tickets);
    state.tickets += got.tickets;
  }
  if (reward.egg) {
    const egg = giftEgg(state, now, rng, reward.egg);
    state.eggs.push(egg);
    got.eggId = egg.id;
  }
  return { ok: true, got };
}

// Chuỗi ngày SẼ là bao nhiêu nếu hôm nay có nhận thưởng: hôm nay tính rồi thì giữ, hôm qua có thì +1, đứt thì về 1.
function streakToday(state) {
  const st = state.streak ?? {}, day = state.daily?.day;
  return st.last === day ? st.days : st.last === day - 1 ? st.days + 1 : 1;
}
// Rương ngày: to dần theo chuỗi ngày; cứ `streakEgg` ngày liên tiếp thêm một quả trứng quà.
function chestReward(state) {
  const d = CONFIG.daily, days = streakToday(state);
  return { bag: d.chestBag + Math.min(d.chestStreakMax, days - 1), table: "gift", ...(days % d.streakEgg === 0 ? { egg: {} } : {}) };
}

// Bản xem cho giao diện: bước mở đầu hiện tại, 3 việc trong ngày, rương, chuỗi ngày.
export function questView(state) {
  const cnt = state.count ?? {};
  const t = TUTORIAL[state.quest?.step ?? TUTORIAL.length];
  const tutorial = t ? { id: "tutorial", key: t.key, text: t.text, have: Math.min(t.goal, cnt[t.count] ?? 0), goal: t.goal, done: (cnt[t.count] ?? 0) >= t.goal, reward: t.reward, step: state.quest.step, total: TUTORIAL.length } : null;
  const daily = (state.daily?.tasks ?? []).map((d, i) => {
    const have = clamp((cnt[d.key] ?? 0) - d.base, 0, d.goal);
    return { id: `daily:${i}`, key: d.key, text: DAILY_TASKS[d.key].text(d.goal), have, goal: d.goal, done: have >= d.goal, claimed: d.claimed, reward: { bag: CONFIG.daily.taskBag } };
  });
  const chest = { id: "chest", done: daily.length > 0 && daily.every((d) => d.claimed), claimed: !!state.daily?.chest, reward: chestReward(state) };
  // chuỗi đang còn (hôm qua hoặc hôm nay có nhận thưởng); đứt rồi thì hiện 0
  const st = state.streak ?? {};
  const streak = st.last >= (state.daily?.day ?? Infinity) - 1 ? st.days : 0;
  const tm = state.timed, timed = tm ? { id: "timed", step: tm.claimed, readyAt: tm.start + CONFIG.timed[tm.claimed].at, reward: CONFIG.timed[tm.claimed] } : null;
  return { tutorial, daily, chest, timed, streak, best: st.best ?? 0 };
}

// Nhận thưởng: id = "tutorial" (bước mở đầu hiện tại) | "daily:0..2" | "chest".
export function claim(state, id, now, opts = {}) {
  return act(state, now, () => {
    const rng = opts.rng ?? rngFor(state, "claim", id, now);
    if (id === "tutorial") {
      const t = TUTORIAL[state.quest.step];
      if (!t) return err("no_quest", "Đã xong hết nhiệm vụ mở đầu");
      if ((state.count[t.count] ?? 0) < t.goal) return err("not_done", "Chưa xong nhiệm vụ này");
      const r = giveReward(state, t.reward, now, rng);
      if (!r.ok) return r;
      state.quest.step++;
      return { id, key: t.key, got: r.got };
    }
    if (id === "timed") {
      const tm = state.timed, cur = CONFIG.timed[tm.claimed];
      if (now < tm.start + cur.at) return err("not_done", "Rương chưa tới giờ mở");
      const r = giveReward(state, cur, now, rng);
      if (!r.ok) return r;
      tm.claimed++;
      if (tm.claimed >= CONFIG.timed.length) { tm.start = now; tm.claimed = 0; } // hết vòng: vòng mới tính từ lúc nhận rương cuối
      return { id, got: r.got, next: tm.start + CONFIG.timed[tm.claimed].at };
    }
    const tasks = state.daily?.tasks ?? [];
    if (id === "chest") {
      if (!tasks.length || !tasks.every((d) => d.claimed)) return err("not_done", "Làm xong cả 3 việc trong ngày đã");
      if (state.daily.chest) return err("claimed", "Đã mở rương hôm nay rồi");
      const r = giveReward(state, chestReward(state), now, rng);
      if (!r.ok) return r;
      state.daily.chest = true;
      return { id, got: r.got, streak: state.streak.days };
    }
    const d = /^daily:[0-9]$/.test(id) ? tasks[Number(id.slice(6))] : null;
    if (!d) return err("no_quest", "Không có nhiệm vụ này");
    if (d.claimed) return err("claimed", "Đã nhận thưởng rồi");
    if ((state.count[d.key] ?? 0) - d.base < d.goal) return err("not_done", "Chưa xong việc này");
    const r = giveReward(state, { bag: CONFIG.daily.taskBag }, now, rng);
    if (!r.ok) return r;
    d.claimed = true;
    // chuỗi ngày: tính khi nhận thưởng việc đầu tiên trong ngày
    const day = state.daily.day, st = state.streak;
    if (st.last !== day) {
      st.days = st.last === day - 1 ? st.days + 1 : 1;
      st.last = day;
      st.best = Math.max(st.best ?? 0, st.days);
    }
    return { id, key: d.key, got: r.got, streak: st.days };
  });
}

// Đồ trang trí sân trại: suy ra từ tiến độ (không lưu riêng) — phần thưởng nhìn thấy được.
export function decorOf(state) {
  return {
    bunting: (state.quest?.step ?? 0) >= 8, // nuôi được con gà trưởng thành đầu tiên
    flowers: (state.milestones ?? 0) >= 1,
    lantern: (state.milestones ?? 0) >= 2,
    scarecrow: (state.milestones ?? 0) >= 3,
    pinwheel: (state.streak?.best ?? 0) >= 7,
    ribbons: Object.keys(state.breeds ?? {}).length,
  };
}

/* ---------- đổi ở cửa hàng: trứng / gà → túi hạt (Q6) ---------- */

export const eggTradeValue = () => CONFIG.trade.egg;
export const chickenTradeValue = (ch) => Math.round(lerp(CONFIG.trade.chicken[0], CONFIG.trade.chicken[1], ch.growth / CONFIG.stages.adult));

// Mỗi trứng / gà đổi được một túi hạt (2 hạt cho trứng, 4–9 hạt cho gà), mở ra ngẫu nhiên.
// opts.want === "tickets": đổi lấy VÉ thay cho túi hạt — chỉ trứng có phôi (1 vé) và gà trưởng thành (2 vé), có trần mỗi ngày.
export function tradeToShop(state, give, now, opts = {}) {
  return act(state, now, () => {
    if (opts.want === "tickets") return tradeForTickets(state, give, now);
    const eggIds = [...new Set(give.eggs ?? [])], chickenIds = [...new Set(give.chickens ?? [])];
    const eggs = eggIds.map((id) => state.eggs.find((e) => e.id === id));
    const chickens = chickenIds.map((id) => state.chickens.find((c) => c.id === id));
    if (eggs.some((e) => !e)) return err("no_egg", "Có trứng không tồn tại");
    if (chickens.some((c) => !c)) return err("no_chicken", "Có gà không tồn tại");
    if (chickens.some((c) => c.location !== "coop")) return err("in_field", "Gọi gà về chuồng trước khi đổi");
    if (eggs.some((e) => e.hatchAt !== null)) return err("incubating", "Trứng đang ấp không đổi được");
    if (!eggs.length && !chickens.length) return err("nothing", "Chưa chọn gì để đổi");
    if (state.bags.length + eggs.length + chickens.length > CONFIG.storage.bags) return err("bags_full", "Kho hết chỗ để túi hạt");
    const bags = [
      ...eggs.map(() => ({ id: nextId(state, "b"), size: eggTradeValue(), from: "egg", at: now })),
      ...chickens.map((c) => ({ id: nextId(state, "b"), size: chickenTradeValue(c), from: "chicken", at: now })),
    ];
    state.eggs = state.eggs.filter((e) => !eggIds.includes(e.id));
    leave(state, chickenIds);
    state.bags.push(...bags);
    state.stats.traded += bags.length;
    bump(state, "trade", bags.length);
    return { bags: bags.map((b) => b.id) };
  });
}

function tradeForTickets(state, give, now) {
  const T = CONFIG.tickets, day = dayIndex(now);
  const eggIds = [...new Set(give.eggs ?? [])], chickenIds = [...new Set(give.chickens ?? [])];
  const eggs = eggIds.map((id) => state.eggs.find((e) => e.id === id));
  const chickens = chickenIds.map((id) => state.chickens.find((c) => c.id === id));
  if (eggs.some((e) => !e)) return err("no_egg", "Có trứng không tồn tại");
  if (chickens.some((c) => !c)) return err("no_chicken", "Có gà không tồn tại");
  if (!eggs.length && !chickens.length) return err("nothing", "Chưa chọn gì để đổi");
  if (eggs.some((e) => e.hatchAt !== null)) return err("incubating", "Trứng đang ấp không đổi được");
  if (eggs.some((e) => !e.fertile)) return err("infertile", "Chỉ trứng có phôi mới đổi được vé");
  if (chickens.some((c) => c.location !== "coop")) return err("in_field", "Gọi gà về chuồng trước khi đổi");
  if (chickens.some((c) => c.growth < CONFIG.stages.adult)) return err("not_adult", "Chỉ gà đã trưởng thành mới đổi được vé");
  if (chickens.some((c) => c.id === state.play?.id)) return err("playing", "Con gà này đang ở sân chơi");
  const d = state.ticketDay?.day === day ? state.ticketDay : { day, eggs: 0, chickens: 0 };
  if (d.eggs + eggs.length > T.eggsPerDay || d.chickens + chickens.length > T.chickensPerDay) return err("ticket_limit", "Hôm nay đổi đủ vé rồi — mai nhé (vẫn đổi được túi hạt)");
  const gain = eggs.length * T.perEgg + chickens.length * T.perChicken;
  if (state.tickets + gain > T.cap) return err("tickets_full", "Túi vé đã đầy");
  state.eggs = state.eggs.filter((e) => !eggIds.includes(e.id));
  leave(state, chickenIds);
  state.ticketDay = { day, eggs: d.eggs + eggs.length, chickens: d.chickens + chickens.length };
  state.tickets += gain;
  state.stats.traded += eggs.length + chickens.length;
  bump(state, "trade", eggs.length + chickens.length);
  return { tickets: gain };
}

/* ---------- sân chơi: minigame (v7) ---------- */

const playKind = (subject, isEgg) => (isEgg ? "roll" : subject.growth < CONFIG.stages.juvenile ? "hop" : subject.growth < CONFIG.stages.adult ? "dash" : "peck");

// Sức chơi hiện có (tính lười): mỗi regenMs kể từ `at` thêm 1 điểm, tối đa `max`.
export function energyOf(state, now) {
  const E = CONFIG.energy, e = state.energy ?? { n: E.max, at: now };
  if (e.n >= E.max) return E.max;
  return Math.min(E.max, e.n + Math.floor(Math.max(0, now - e.at) / E.regenMs));
}
// Thời điểm có thêm điểm kế tiếp (null nếu đang đầy).
export function energyNextAt(state, now) {
  const E = CONFIG.energy, e = state.energy;
  if (!e || energyOf(state, now) >= E.max) return null;
  return e.at + (Math.floor(Math.max(0, now - e.at) / E.regenMs) + 1) * E.regenMs;
}
function spendEnergy(state, now) {
  const E = CONFIG.energy, e = state.energy, cur = energyOf(state, now);
  if (cur >= E.max) state.energy = { n: E.max - 1, at: now }; // đang đầy: đồng hồ hồi bắt đầu từ lúc tiêu
  else {
    const gained = cur - e.n; // dời mốc theo đúng số điểm đã hồi, giữ phần thời gian lẻ
    state.energy = { n: cur - 1, at: e.at + gained * E.regenMs };
  }
}

// Bắt đầu một lượt: `id` là gà (ở chuồng) hoặc trứng ĐANG ẤP. opts.pay = "energy" (mặc định, miễn phí, tốn 1 sức chơi)
// | "ticket" (tốn vé; thưởng gấp rưỡi, thắng thì hoàn vé). Trả ngay lúc bắt đầu; bỏ dở không hoàn.
export function startPlay(state, id, now, opts = {}) {
  return act(state, now, () => {
    const P = CONFIG.play;
    const ch = state.chickens.find((c) => c.id === id);
    const egg = ch ? null : state.eggs.find((e) => e.id === id && e.hatchAt !== null);
    if (!ch && !egg) return err("no_subject", "Không tìm thấy gà hay trứng đang ấp này");
    if (state.play && now - state.play.at <= P.maxMs) return err("play_busy", "Đang có một lượt chơi dở");
    state.play = null; // lượt cũ quá hạn: coi như bỏ dở, không hoàn vé
    const pay = opts.pay === "ticket" ? "ticket" : "energy";
    if (pay === "ticket" && state.tickets < P.cost) return err("no_ticket", "Hết vé — thắng trò chơi, mở rương hoặc đổi trứng / gà để có vé");
    if (pay === "energy" && energyOf(state, now) < 1) return err("no_energy", "Hết sức chơi — chờ hồi (1 điểm mỗi 30 phút) hoặc chơi bằng vé");
    if (ch) {
      if (ch.location !== "coop") return err("in_field", `${ch.name} đang ngoài đồng`);
      if (ch.satiety < P.hunger) return err("too_hungry", `${ch.name} đang đói — cho ăn rồi hãy chơi`);
    } else if ((egg.played ?? 0) >= P.eggMax) return err("too_tired", "Quả trứng này đã chơi đủ rồi");
    else egg.played = (egg.played ?? 0) + 1;
    if (pay === "ticket") state.tickets -= P.cost;
    else spendEnergy(state, now);
    state.play = { id, kind: playKind(ch ?? egg, !ch), at: now, pay };
    return { id, kind: state.play.kind };
  });
}

// Kết thúc lượt: điểm do client báo, luật kẹp về 0..1 và chỉ nhận trong khoảng [minMs, maxMs] kể từ lúc bắt đầu.
export function endPlay(state, score, now) {
  return act(state, now, () => {
    const P = CONFIG.play, p = state.play;
    if (!p) return err("no_play", "Không có lượt chơi nào đang diễn ra");
    state.play = null; // xoá TRƯỚC khi tính: không bao giờ nhận thưởng hai lần cho một lượt
    const elapsed = now - p.at;
    let s = typeof score === "number" && Number.isFinite(score) ? clamp(score, 0, 1) : 0;
    if (elapsed < P.minMs || elapsed > P.maxMs) s = 0;
    const ch = state.chickens.find((c) => c.id === p.id);
    const egg = ch ? null : state.eggs.find((e) => e.id === p.id && e.hatchAt !== null);
    if (!ch && !egg) return { score: 0, win: false, ticket: false, gone: true };
    const mul = p.pay === "ticket" ? P.ticketMul : 1; // lượt bằng vé thưởng gấp rưỡi
    if (egg) egg.hatchAt = Math.max(now, egg.hatchAt - Math.min(0.5, P.eggCutPct * mul) * (egg.incubateMs ?? incubateMsOf(egg.code)) * s);
    else {
      ch.satiety = Math.max(0, ch.satiety - P.hunger);
      // chưa lớn: lớn thêm, nhưng dừng sát ngưỡng — bước mô phỏng kế tiếp mới là nơi phát "adult", chấm sổ, chấm giống
      if (ch.growth < CONFIG.stages.adult) ch.growth = Math.min(CONFIG.stages.adult - 0.001, ch.growth + P.growth * mul * s);
      else ch.lifeUsed = Math.max(0, ch.lifeUsed - P.adultLifeMs * mul * s);
    }
    const win = s >= P.winAt, day = dayIndex(now);
    let ticket = false;
    if (win) {
      bump(state, "play");
      const d = state.playDay?.day === day ? state.playDay : { day, tickets: 0 };
      if (p.pay === "ticket" && d.tickets < P.winTicketsPerDay && state.tickets < CONFIG.tickets.cap) { // chỉ lượt bằng vé mới hoàn vé
        state.tickets++;
        d.tickets++;
        ticket = true;
      }
      state.playDay = d;
    }
    return { score: s, win, ticket, kind: p.kind, pay: p.pay };
  });
}

// Đổi một con gà TRƯỞNG THÀNH lấy 2 quả TRỨNG NGẪU NHIÊN có phôi (gen ngẫu nhiên, trống/mái 50/50 mỗi quả)
// — lối thoát khi trại thiếu trống hoặc mái (Q11, chủ dự án 11/11): mỗi lần đổi trại thêm được 1 con,
// nên sớm muộn cũng có cặp. Chỉ gà trưởng thành (Q12) để không "quay gen" liên tục.
// opts.rng: server truyền nguồn ngẫu nhiên riêng (HMAC) để client không đoán trước được.
export function tradeForEgg(state, chickenId, now, opts = {}) {
  return act(state, now, () => {
    const ch = state.chickens.find((c) => c.id === chickenId);
    if (!ch) return err("no_chicken", "Không tìm thấy gà");
    if (ch.location !== "coop") return err("in_field", "Gọi gà về chuồng trước khi đổi");
    if (ch.growth < CONFIG.stages.adult) return err("not_adult", "Chỉ gà đã trưởng thành mới đổi lấy trứng được");
    const n = CONFIG.trade.eggsPerChicken;
    if (storedEggs(state) + n > CONFIG.storage.eggs) return err("eggs_full", `Kho trứng không đủ chỗ cho ${n} quả`);
    const rng = opts.rng ?? rngFor(state, "shopEgg", ch.id, now);
    const eggs = [];
    for (let i = 0; i < n; i++) {
      const mother = randomGenome(rng, { sex: "hen" });
      const child = randomGenome(rng);
      const ph = express(mother);
      eggs.push({ id: nextId(state, "e"), code: encodeGenome(child), shell: ph.egg.shell, shellName: ph.egg.name, fertile: true, motherId: null, fatherId: null, laidAt: now, mutations: 0, hatchAt: null, fromShop: true });
    }
    leave(state, [chickenId]);
    state.eggs.push(...eggs);
    state.stats.traded++;
    bump(state, "trade");
    return { eggIds: eggs.map((e) => e.id), eggId: eggs[0].id };
  });
}

export function openBag(state, bagId, now, opts = {}) {
  return act(state, now, () => {
    const bag = state.bags.find((b) => b.id === bagId);
    if (!bag) return err("no_bag", "Không tìm thấy túi hạt");
    if (seedCount(state) + bag.size > CONFIG.storage.seeds) return err("seeds_full", "Kho hạt đầy");
    const rng = opts.rng ?? rngFor(state, "bag", bag.id);
    const got = {};
    for (let i = 0; i < bag.size; i++) {
      const k = rollSeed(bag.table ?? "shop", rng);
      got[k] = (got[k] ?? 0) + 1;
      state.inventory[k]++;
    }
    state.bags = state.bags.filter((b) => b.id !== bagId);
    bump(state, "open");
    return { got };
  });
}

/* ---------- khách qua đường (v7): mỗi lúc một người ở gian hàng trước cổng ---------- */
// Thiết kế: docs/chicken-farm/ideas.md mục 15. Ai ghé, lúc nào, mang gì đều tính từ (seed, ngày) — không lưu lịch.
// Thứ duy nhất lưu là việc đã làm với khách đang ghé: state.visit = { from, bought, tries, price, floor, gone }.

export const VISITORS = {
  seller: { name: "Bà hàng hạt", perDay: 2, chance: 1 }, // bán hạt, giá rẻ, cố định
  trader: { name: "Người đổi chác", chance: 0.5 }, // vật đổi vật, không dùng vé
  collector: { name: "Người sưu tầm", chance: 0.4 }, // MUA gà theo yêu cầu, trả vé
  reader: { name: "Thầy soi trứng", chance: 0.3 }, // bán thông tin về quả trứng
  haggler: { name: "Lái buôn", chance: 0.2 }, // một món khá hiếm, mặc cả được
  artisan: { name: "Nghệ nhân", weekly: true }, // đồ trang trí, mỗi tuần một lần
  stranger: { name: "Khách lạ đêm khuya", chance: 0.35, night: true, minutes: 15 }, // ba giỏ đậy kín
};
const VISIT = {
  slotMs: 30 * MIN, firstHour: 7, slots: 32, nightSlot: 24, // khung 30 phút từ 7:00 tới 23:00 (giờ Việt Nam); đêm từ 19:00
  seller: [{ seeds: { mung: 3 }, price: 2 }, { seeds: { millet: 3 }, price: 2 }, { seeds: { sesame: 3 }, price: 2 }, { seeds: { marigold: 3 }, price: 2 }, { seeds: { sunflower: 2 }, price: 2 }, { seeds: { corn: 2 }, price: 2 }, { seeds: { pumpkin: 2 }, price: 2 }, { seeds: { peanut: 2 }, price: 2 }, { seeds: { lotus: 2 }, price: 3 }, { seeds: { sorghum: 3 }, price: 2 }, { seeds: { cotton: 3 }, price: 2 }, { seeds: { wheat: 3 }, price: 2 }, { seeds: { rapeseed: 3 }, price: 2 }, { bag: 5, price: 3 }],
  trader: [{ give: { seed: "rice", n: 6 }, get: { seeds: { lotus: 1 } } }, { give: { seed: "marigold", n: 4 }, get: { seeds: { lotus: 1 } } }, { give: { seed: "mung", n: 4 }, get: { seeds: { lotus: 1 } } }, { give: { seed: "millet", n: 4 }, get: { seeds: { sunflower: 2 } } }, { give: { seed: "sesame", n: 4 }, get: { seeds: { peanut: 2 } } }, { give: { seed: "lotus", n: 3 }, get: { seeds: { odd: 1 } } }, { give: { eggs: 2 }, get: { bag: 4, table: "gift" } }],
  order: { pay: [2, 5, 9] }, // 1 đặc điểm · 2 đặc điểm · 2 đặc điểm + nuôi đủ chất
  reader: { sex: 1, trait: 2 },
  haggler: [{ seeds: { odd: 2 }, price: 8 }, { bag: 8, table: "gift", price: 7 }, { egg: "common", price: 18 }],
  haggle: { floor: [0.6, 0.85], walk: 0.75, step: 0.08, tries: 3 }, // sàn bí mật; trả dưới 75% sàn → bỏ đi; mỗi lần hạ 8%
  artisan: [{ decor: "bench", price: 12 }, { decor: "well", price: 18 }, { decor: "birdhouse", price: 10 }, { decor: "windchime", price: 14 }],
  stranger: { mystery: true },
  eggPrice: { common: 15, rare: 25 },
};
export const VISIT_CONFIG = VISIT;
// Đặc điểm → alen phải ép vào bộ gen để gà nở ra CHẮC CHẮN mang nó (lặn thì ép cả hai bản).
const TRAIT_GENES = {
  mottled: { pattern: ["m", "m"] }, spangled: { pattern: ["S", "S"] }, laced: { pattern: ["L", "L"] }, barred: { pattern: ["B", "B"] },
  blue: { dilute: ["D", "d"] }, splash: { dilute: ["D", "D"] }, darkSkin: { fm: ["Fm", "fm"] }, frizzle: { frizzle: ["Fz", "fz"] },
  silkie: { silkie: ["h", "h"] }, crest: { crest: ["Cr", "cr"] }, muff: { muff: ["Mb", "mb"] }, feetFeather: { feetFeather: ["Pti", "pti"] },
  longTail: { tailType: ["Gt", "t"] }, rumpless: { tailType: ["Rp", "t"] }, rose: { combR: ["R", "r"], combP: ["p", "p"] },
  pea: { combR: ["r", "r"], combP: ["P", "p"] }, walnut: { combR: ["R", "r"], combP: ["P", "p"] }, fiveToes: { poly: ["Po", "po"] },
};
export const RARE_TRAITS = ["silkie", "splash", "fiveToes", "rumpless", "frizzle", "longTail"];
const COMMON_TRAITS = DEX.map((d) => d.key).filter((k) => !RARE_TRAITS.includes(k));

// Lịch khách của một ngày: [{ who, from, until }], không trùng khung giờ, xếp theo giờ.
export function visitorsOfDay(seed, day) {
  const rng = mulberry32(hash32(`${seed >>> 0}|visit|${day}`));
  const dayStart = day * DAY - CONFIG.daily.tzOffsetMs + VISIT.firstHour * HOUR;
  const free = Array.from({ length: VISIT.slots }, (_, i) => i);
  const out = [];
  const place = (who) => {
    const v = VISITORS[who];
    const pool = free.filter((i) => (v.night ? i >= VISIT.nightSlot : true));
    if (!pool.length) return;
    const slot = pool[Math.floor(rng() * pool.length)];
    free.splice(free.indexOf(slot), 1);
    const from = dayStart + slot * VISIT.slotMs;
    out.push({ who, from, until: from + (v.minutes ? v.minutes * MIN : VISIT.slotMs) });
  };
  for (const [who, v] of Object.entries(VISITORS)) {
    if (v.weekly) { if (((day % 7) + 7) % 7 === (seed >>> 0) % 7) place(who); continue; }
    for (let i = 0; i < (v.perDay ?? 1); i++) if (rng() < v.chance) place(who);
  }
  return out.sort((a, b) => a.from - b.from);
}
const visitNow = (state, now) => visitorsOfDay(state.seed, dayIndex(now)).find((v) => now >= v.from && now < v.until) ?? null;

// Hàng của một lượt ghé — tất định theo (seed, lúc tới) và, với người sưu tầm, theo sổ của trại lúc đó.
function stockOf(state, v) {
  const items = stockRaw(state, v);
  return items.map((it) => (it.price ? { ...it, price: seasonPrice(v.from, it.price) } : it)); // v9: mùa khô bán rẻ
}
function stockRaw(state, v) {
  const rng = rngFor(state, "stock", v.who, v.from);
  const pickN = (list, n) => { const a = [...list], o = []; while (o.length < n && a.length) o.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return o; };
  if (v.who === "seller") return pickN(VISIT.seller, 3);
  if (v.who === "trader") return pickN(VISIT.trader, 2);
  if (v.who === "artisan") return pickN(VISIT.artisan, 2);
  if (v.who === "haggler") {
    const item = pickN(VISIT.haggler, 1)[0];
    return [item.egg ? { ...item, egg: pickN(COMMON_TRAITS, 1)[0] } : item];
  }
  if (v.who === "stranger") return [{ mystery: true, price: CONFIG.mystery.price }];
  if (v.who === "reader") return [{ what: "sex", price: VISIT.reader.sex }, { what: "trait", price: VISIT.reader.trait }];
  // người sưu tầm: chỉ đòi đặc điểm trại ĐÃ từng nở (có ★); trại chưa có gì thì đòi "một gà trưởng thành nuôi đủ chất"
  const known = DEX.map((d) => d.key).filter((k) => (state.dex[k] ?? 0) >= 1);
  const tier = known.length >= 2 ? Math.floor(rng() * 3) : known.length ? 0 : -1;
  if (tier < 0) return [{ traits: [], quality: true, pay: VISIT.order.pay[0] }];
  const traits = pickN(known, tier === 0 ? 1 : 2).filter((k, i, a) => !(a.length === 2 && conflict(a[0], a[1]) && i === 1));
  return [{ traits, quality: tier === 2, pay: VISIT.order.pay[traits.length === 1 && tier > 0 ? 0 : tier] }];
}
// hai đặc điểm không thể cùng có trên một con (cùng một gen: hoa văn, kiểu mào, kiểu đuôi, mức pha loãng)
const conflict = (a, b) => Object.keys(TRAIT_GENES[a]).some((g) => g in TRAIT_GENES[b]) && a !== b && !(["rose", "pea", "walnut"].includes(a) && false);

// Khách đang ghé + hàng + việc đã làm; `next` = lượt ghé kế tiếp trong hôm nay. Giá sàn mặc cả KHÔNG bao giờ có ở đây.
export function visitorView(state, now) {
  if (state.seed == null) return state.visitor ?? null; // client online: server gửi sẵn trong farm.visitor
  const today = visitorsOfDay(state.seed, dayIndex(now));
  const next = today.find((v) => v.from > now);
  const v = today.find((x) => now >= x.from && now < x.until);
  const base = { next: next ? { who: next.who, from: next.from } : null };
  if (!v) return { ...base, who: null };
  const mine = state.visit?.from === v.from ? state.visit : {};
  return { ...base, who: v.who, name: VISITORS[v.who].name, from: v.from, until: v.until, stock: stockOf(state, v), bought: mine.bought ?? [], price: mine.price ?? null, tries: mine.tries ?? 0, gone: !!mine.gone };
}

// Khách phải đang ở đó và đúng loại; trả về { v, stock, mine } hoặc lỗi. `mine` là sổ ghi của lượt ghé này.
function visiting(state, now, who) {
  const v = visitNow(state, now);
  if (!v || (who && v.who !== who)) return err("no_visitor", "Người này không có ở gian hàng lúc này");
  if (state.visit?.from !== v.from) state.visit = { from: v.from, bought: [] };
  if (state.visit.gone) return err("visitor_gone", "Ông ấy bỏ đi rồi");
  return { v, stock: stockOf(state, v), mine: state.visit };
}
const pay = (state, price) => (state.tickets < price ? err("no_ticket", `Cần ${price} vé`) : null);

// Bộ gen minh hoạ cho Sổ sưu tầm: gà mang đặc điểm `key` và càng ít đặc điểm khác càng tốt (dò vài seed, chọn con "sạch" nhất).
export function traitGenome(key, sex = "rooster") {
  let best = null, bestN = Infinity;
  for (let seed = 1; seed <= 120 && bestN > 1; seed++) {
    const g = randomGenome(mulberry32(seed * 7919), { sex });
    for (const [gene, alleles] of Object.entries(TRAIT_GENES[key])) g.g[gene] = [...alleles];
    const keys = dexKeysOf(encodeGenome(g));
    if (keys.includes(key) && keys.length < bestN) { best = g; bestN = keys.length; }
  }
  return best;
}
// Trứng chắc chắn nở ra gà mang đặc điểm `key`.
function traitEgg(state, key, now, rng) {
  const g = randomGenome(rng);
  for (const [gene, alleles] of Object.entries(TRAIT_GENES[key])) g.g[gene] = [...alleles];
  // mào: gen R/P phải khớp đúng kiểu; hoa văn trội theo bậc nên đã ép cả hai bản
  const ph = express(randomGenome(rng, { sex: "hen" }));
  return { id: nextId(state, "e"), code: encodeGenome(g), shell: ph.egg.shell, shellName: ph.egg.name, fertile: true, motherId: null, fatherId: null, laidAt: now, mutations: 0, hatchAt: null, gift: true, known: { traits: [key] } };
}
function giveItem(state, item, now, rng) {
  if (item.decor) {
    state.decorOwned ??= [];
    if (state.decorOwned.includes(item.decor)) return err("owned", "Trại đã có món này");
    state.decorOwned.push(item.decor);
    return { ok: true, got: { decor: item.decor } };
  }
  if (item.egg) {
    if (storedEggs(state) >= CONFIG.storage.eggs) return err("eggs_full", "Kho trứng đầy");
    const egg = traitEgg(state, item.egg, now, rng);
    state.eggs.push(egg);
    return { ok: true, got: { eggId: egg.id, trait: item.egg } };
  }
  return giveReward(state, item, now, rng);
}

// Kỳ vật: bộ phận độc nhất của gà nở từ trứng bí ẩn. Chỉ THÊM vào cuối.
export const MYSTERY = [
  { key: "peacockTail", name: "Đuôi công", slot: "tail", weight: 3 },
  { key: "butterflyWings", name: "Cánh bướm", slot: "wings", weight: 3 },
  { key: "goldenClaws", name: "Móng vàng", slot: "feet", weight: 3 },
  { key: "dogHead", name: "Đầu cún", slot: "head", weight: 1 },
];
function rollRelic(rng) {
  if (rng() >= CONFIG.mystery.chance) return null;
  let r = rng() * MYSTERY.reduce((a, m) => a + m.weight, 0);
  for (const m of MYSTERY) if ((r -= m.weight) < 0) return m.key;
  return MYSTERY[0].key;
}

// Mua thẳng: bà hàng hạt, nghệ nhân (slot = thứ tự món), khách lạ (một quả trứng bí ẩn mỗi lượt ghé).
export function buy(state, slot, now, opts = {}) {
  return act(state, now, () => {
    const ctx = visiting(state, now);
    if (ctx.ok === false) return ctx;
    const { v, stock, mine } = ctx;
    if (!["seller", "artisan", "stranger"].includes(v.who)) return err("bad_deal", "Người này không bán kiểu đó");
    const item = stock[slot];
    if (!item) return err("no_item", "Không có món này");
    if (mine.bought.includes(slot)) return err("sold", "Món này bạn mua rồi");
    const short = pay(state, item.price);
    if (short) return short;
    const rng = opts.rng ?? rngFor(state, "buy", v.from, slot);
    if (item.mystery) {
      if (storedEggs(state) >= CONFIG.storage.eggs) return err("eggs_full", "Kho trứng đầy");
      const egg = { ...giftEgg(state, now, rng), shell: CONFIG.mystery.shell, shellName: "Trứng bí ẩn", mysteryEgg: true, mystery: rollRelic(rng) };
      state.eggs.push(egg);
      state.tickets -= item.price;
      mine.bought.push(slot);
      return { slot, got: { eggId: egg.id } }; // KHÔNG trả về có kỳ vật hay không: chỉ biết khi trứng nở
    }
    const r = giveItem(state, item, now, rng);
    if (!r.ok) return r;
    state.tickets -= item.price;
    mine.bought.push(slot);
    return { slot, got: r.got };
  });
}

// Người đổi chác: đưa đúng thứ ông ấy cần (hạt theo loại, hoặc `eggs` = id các trứng KHÔNG phôi trong kho), nhận món kia.
export function barter(state, slot, now, opts = {}) {
  return act(state, now, () => {
    const ctx = visiting(state, now, "trader");
    if (ctx.ok === false) return ctx;
    const offer = ctx.stock[slot];
    if (!offer) return err("no_item", "Không có lời đổi này");
    if (ctx.mine.bought.includes(slot)) return err("sold", "Lời đổi này bạn dùng rồi");
    const g = offer.give;
    let eggIds = [];
    if (g.seed) { if (!(state.inventory[g.seed] >= g.n)) return err("no_seed", `Cần ${g.n} ${SEEDS[g.seed].name.toLowerCase()}`); }
    else {
      eggIds = [...new Set(opts.eggs ?? [])];
      const eggs = eggIds.map((id) => state.eggs.find((e) => e.id === id && e.hatchAt === null && !e.fertile));
      if (eggIds.length !== g.eggs || eggs.some((e) => !e)) return err("bad_give", `Cần đúng ${g.eggs} quả trứng không phôi`);
    }
    // thử trao trước trên phần chỗ chứa SAU khi đã lấy đi thứ đem đổi (đổi 6 hạt lấy 1 hạt không thể bị "kho đầy")
    if (g.seed) state.inventory[g.seed] -= g.n;
    const r = giveReward(state, offer.get, now, opts.rng ?? rngFor(state, "barter", ctx.v.from, slot));
    if (!r.ok) { if (g.seed) state.inventory[g.seed] += g.n; return r; }
    if (eggIds.length) state.eggs = state.eggs.filter((e) => !eggIds.includes(e.id));
    ctx.mine.bought.push(slot);
    return { slot, got: r.got };
  });
}

// Con gà có khớp đơn không: trưởng thành, mang đủ đặc điểm, và (nếu đơn đòi) nuôi đủ chất cho từng đặc điểm / cả bốn chất.
export function matchesOrder(ch, order) {
  if (ch.growth < CONFIG.stages.adult) return false;
  const keys = new Set(dexKeysOf(ch.code));
  if (!order.traits.every((t) => keys.has(t))) return false;
  if (!order.quality) return true;
  const groups = order.traits.length ? order.traits.map((t) => DEX_GROUP[t]) : NUTRIENTS;
  return groups.every((g) => ch.dev[g] >= CONFIG.dex.starDev);
}
// Người sưu tầm: giao con gà đúng đơn (gà rời trại), nhận vé.
export function deliver(state, chickenId, now) {
  return act(state, now, () => {
    const ctx = visiting(state, now, "collector");
    if (ctx.ok === false) return ctx;
    if (ctx.mine.bought.length) return err("sold", "Đơn này bạn giao rồi");
    const ch = state.chickens.find((c) => c.id === chickenId);
    if (!ch) return err("no_chicken", "Không tìm thấy gà");
    if (ch.location !== "coop") return err("in_field", "Gọi gà về chuồng trước đã");
    if (ch.id === state.play?.id) return err("playing", "Con gà này đang ở sân chơi");
    const order = ctx.stock[0];
    if (!matchesOrder(ch, order)) return err("no_match", "Con gà này chưa đúng yêu cầu");
    const gain = Math.min(order.pay, CONFIG.tickets.cap - state.tickets);
    leave(state, [chickenId]);
    state.tickets += gain;
    state.stats.traded++;
    bump(state, "trade");
    ctx.mine.bought.push(0);
    return { chickenId, tickets: gain };
  });
}

// Thầy soi trứng: what = "sex" (trống hay mái) | "trait" (một đặc điểm quả trứng mang, hoặc "không có gì đặc biệt").
export function candle(state, eggId, what, now, opts = {}) {
  return act(state, now, () => {
    const ctx = visiting(state, now, "reader");
    if (ctx.ok === false) return ctx;
    const price = VISIT.reader[what] && seasonPrice(ctx.v.from, VISIT.reader[what]);
    if (!price) return err("bad_deal", "Thầy không soi được điều đó");
    const egg = state.eggs.find((e) => e.id === eggId);
    if (!egg) return err("no_egg", "Không tìm thấy trứng");
    if (!egg.fertile) return err("infertile", "Trứng không có phôi thì không có gì để soi");
    egg.known ??= {};
    const ph = express(decodeGenome(egg.code));
    if (what === "sex") {
      if (egg.known.sex) return err("known", "Điều này bạn biết rồi");
      const short = pay(state, price);
      if (short) return short;
      egg.known.sex = ph.sex;
    } else {
      const left = dexKeysOf(egg.code).filter((k) => !(egg.known.traits ?? []).includes(k));
      if (egg.known.all) return err("known", "Quả trứng này không còn gì để soi");
      const short = pay(state, price);
      if (short) return short;
      const rng = opts.rng ?? rngFor(state, "candle", egg.id, (egg.known.traits ?? []).length);
      if (left.length) egg.known.traits = [...(egg.known.traits ?? []), left[Math.floor(rng() * left.length)]];
      if (left.length <= 1) egg.known.all = true;
    }
    state.tickets -= price;
    return { eggId, known: egg.known };
  });
}

// Lái buôn: trả giá `offer` (số vé). Sàn bí mật tung MỘT lần cho mỗi lượt ghé (server: nguồn ngẫu nhiên riêng).
// Kết quả: { sold, price } | { counter: giá mới, left: số lần còn lại } | { gone: true }. Trả đúng giá đang niêm yết thì luôn mua được.
export function haggle(state, offer, now, opts = {}) {
  return act(state, now, () => {
    const ctx = visiting(state, now, "haggler");
    if (ctx.ok === false) return ctx;
    const { stock, mine, v } = ctx, H = VISIT.haggle, item = stock[0];
    if (mine.bought.length) return err("sold", "Món này bạn mua rồi");
    if (!Number.isInteger(offer) || offer < 1) return err("bad_offer", "Giá trả phải là số vé nguyên dương");
    const rng = opts.rng ?? rngFor(state, "haggle", v.from, mine.tries ?? 0);
    mine.price ??= item.price;
    mine.floor ??= Math.ceil(item.price * lerp(H.floor[0], H.floor[1], rng()));
    if (offer >= mine.floor || offer >= mine.price) {
      const price = Math.min(offer, mine.price);
      const short = pay(state, price);
      if (short) return short;
      const r = giveItem(state, item, now, rng);
      if (!r.ok) return r;
      state.tickets -= price;
      mine.bought.push(0);
      return { sold: true, price, got: r.got };
    }
    if (offer < mine.floor * H.walk) { mine.gone = true; return { gone: true }; }
    mine.tries = (mine.tries ?? 0) + 1;
    if (mine.tries >= H.tries) return { counter: mine.price, left: 0 }; // hết lượt trả giá: mua giá này hoặc thôi
    mine.price = Math.max(mine.floor, Math.round(mine.price * (1 - H.step)));
    return { counter: mine.price, left: H.tries - mine.tries };
  });
}

/* ---------- xem trạng thái (cho giao diện) ---------- */

export function stageOf(ch) {
  return ch.growth >= CONFIG.stages.adult ? "adult" : ch.growth >= CONFIG.stages.juvenile ? "juvenile" : "chick";
}

export function chickenView(ch, now) {
  const avgDev = NUTRIENTS.reduce((s, k) => s + ch.dev[k], 0) / NUTRIENTS.length;
  return {
    stage: stageOf(ch),
    growth01: ch.growth / CONFIG.stages.adult,
    hungry: ch.satiety <= 0,
    satiety01: ch.satiety / CONFIG.satietyMax,
    canLay: ch.satiety >= CONFIG.laySatiety,
    quality: qualityOf(ch),
    nutrients01: Object.fromEntries(NUTRIENTS.map((k) => [k, ch.n[k] / CONFIG.nutrientMax])),
    ageMs: now - ch.hatchedAt,
    lifeLeftMs: ch.lifespanMs - ch.lifeUsed, // nếu được ăn no đều
    speed01: ch.speed ?? express(decodeGenome(ch.code)).stats.speed,
    care: { dev: { ...ch.dev }, nutrition: avgDev, gloss: lerp(0.1, 0.7, ch.dev.protein) },
  };
}

export const TIME = { MIN, HOUR, DAY };
