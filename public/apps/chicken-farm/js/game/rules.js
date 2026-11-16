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
export const SEEDS = {
  common: { name: "Hạt thường", satiety: 12, n: { protein: 4, energy: 6, mineral: 3, pigment: 3 } },
  protein: { name: "Hạt đạm", satiety: 12, n: { protein: 26, energy: 4, mineral: 2, pigment: 1 } },
  energy: { name: "Hạt mẩy", satiety: 14, n: { protein: 3, energy: 26, mineral: 2, pigment: 1 } },
  mineral: { name: "Hạt khoáng", satiety: 10, n: { protein: 3, energy: 3, mineral: 26, pigment: 1 } },
  pigment: { name: "Hạt màu", satiety: 10, n: { protein: 1, energy: 4, mineral: 1, pigment: 26 } },
  premium: { name: "Hạt quý", satiety: 12, n: { protein: 16, energy: 16, mineral: 16, pigment: 16 } },
  odd: { name: "Hạt lạ", satiety: 10, n: { protein: 6, energy: 6, mineral: 6, pigment: 6 }, mutation: 4 },
};

export const CONFIG = {
  version: 7,
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
    field: { common: 92, protein: 1.5, energy: 1.5, mineral: 1.5, pigment: 1.5, premium: 0.8, odd: 1.2 },
    shop: { common: 40, protein: 12, energy: 12, mineral: 12, pigment: 12, premium: 9, odd: 3 },
    // v6 — đốm sáng ngoài đồng (người chơi chỉ cho gà) và túi quà nhiệm vụ: hạt tốt nhiều hơn
    lucky: { common: 50, protein: 10, energy: 10, mineral: 10, pigment: 10, premium: 7, odd: 3 },
    gift: { common: 25, protein: 15, energy: 15, mineral: 15, pigment: 15, premium: 12, odd: 3 },
  },
  fieldEatCooldownMs: 12 * 1000, // 1 con gà ăn tối đa 1 hạt / 12 giây (chống gian lận; design-review 11/11: 15 → 12 s)
  // Q6: giá trị cố định, không theo độ hiếm
  trade: { egg: 2, chicken: [4, 9], eggsPerChicken: 2 }, // túi hạt: trứng 2, gà 4 (mới nở) → 9 (trưởng thành); đổi gà lớn lấy 2 trứng có phôi
  // quickHatchMs: quả trứng đầu tiên (và trứng quà của bước mở đầu) nở sau 1 phút — phiên chơi đầu
  // không phải ngồi chờ 5–30 phút mới có con gà đầu tiên.
  start: { incubators: 1, coopCap: 6, starterChoices: 3, seeds: { common: 12 }, quickHatchMs: MIN },
  // v6 — SƯỞI TRỨNG: chạm trứng đang ấp, mỗi lần bớt cutPct thời gian ấp của quả đó; tối đa `max` lần
  // (bớt tối đa 40%), cách nhau ≥ cooldownMs. Việc để làm trong lúc chờ, và có giới hạn nên không spam.
  warm: { cooldownMs: 2500, cutPct: 0.04, max: 10 },
  // v7 — THÁP HẠT: người chơi đổ hạt vào tháp; gà ở chuồng đói dưới eatBelow thì tự ăn 1 hạt mỗi phút,
  // NHƯNG chỉ ở những phút người chơi đang mở game (xem advance: watchFrom). Vắng mặt = gà bị nhốt, không ăn.
  tower: { cap: 40, eatBelow: 0.5 },
  // v7 — VÉ: vật phẩm tiêu hao chung, CHỈ dùng trong game (không chuyển giữa người chơi). Đổi trứng có phôi / gà
  // trưởng thành lấy vé có trần mỗi ngày (không thì người chơi nhiều đổi vô hạn — design-hard-parts §H3).
  tickets: { cap: 99, perEgg: 1, perChicken: 2, eggsPerDay: 3, chickensPerDay: 2 },
  // v7 — THỂ LỰC: tối đa theo gen sức đề kháng × tuổi × rèn luyện; hồi khi ở chuồng và không đói (đêm hồi gấp đôi);
  // kiếm ăn ngoài đồng và chơi làm tiêu. Hết thể lực chỉ là "phải nghỉ", không gây hại.
  stamina: { base: [60, 100], stage: { chick: 0.6, juvenile: 0.8, adult: 1 }, regenPerHour: 20, nightMul: 2, night: [22, 5], fieldPerHour: 30, fitnessStep: 0.04, fitnessMax: 0.3 },
  // v7 — SÂN CHƠI: minigame chạy ở client, luật chỉ nhận điểm 0..1 và KẸP phần thưởng (không tin client).
  // Thắng chỉ hoàn lại vé đã bỏ ra → minigame không sinh vé ròng. Xem design-hard-parts §H2.
  play: { cost: 1, stamina: 35, minMs: 10 * 1000, maxMs: 120 * 1000, growth: 8, hunger: 60, eggCutPct: 0.15, eggMax: 2, adultLifeMs: 30 * MIN, winAt: 0.6, winTicketsPerDay: 6, fitnessAt: 0.3 },
  // v6 — ĐỐM SÁNG ngoài đồng: người chơi chạm đốm sáng, gà chạy tới bới được 1–3 hạt (bảng "lucky"),
  // đôi khi cả một túi hạt. Mỗi trại tối đa 1 lần / cooldownMs. count: [ngưỡng xác suất, số hạt].
  lucky: { cooldownMs: 20 * 1000, count: [[0.6, 1], [0.85, 2], [0.96, 3]], bagSize: 3 },
  // v6 — NHIỆM VỤ NGÀY: mỗi ngày (theo giờ Việt Nam) 3 việc, xong cả 3 mở rương; chuỗi ngày liên tiếp
  // làm rương to hơn, cứ `streakEgg` ngày tặng một quả trứng quà.
  daily: { tzOffsetMs: 7 * HOUR, tasks: 3, taskBag: 3, chestBag: 6, chestStreakMax: 4, streakEgg: 3 },
  // v6 — GIỐNG: một con gà trưởng thành mang đủ tổ hợp đặc điểm, nuôi đủ chất → ghi tên giống, tặng túi quà;
  // đủ `incubatorAt` giống tặng thêm 1 ổ ấp.
  breed: { bag: 8, incubatorAt: 3 },
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

export function rollSeed(table, rng) {
  const entries = Object.entries(CONFIG.drops[table]);
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
  return Math.round((ch.stamBase ?? 80) * S.stage[stageOf(ch)] * (1 + (ch.fitness ?? 0)));
}
export const staminaOf = (ch) => Math.min(staminaMaxOf(ch), ch.stamina ?? staminaMaxOf(ch));
const isNight = (t) => {
  const h = new Date(t + CONFIG.daily.tzOffsetMs).getUTCHours(), [a, b] = CONFIG.stamina.night;
  return h >= a || h < b;
};

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
  { key: "hatch", count: "hatch", goal: 1, text: "Đón gà con đầu tiên chào đời", reward: { seeds: { premium: 4 } } },
  { key: "feed", count: "feed", goal: 3, text: "Cho gà ăn 3 hạt (kéo hạt thả lên gà)", reward: { bag: 4 } },
  { key: "forage", count: "forage", goal: 5, text: "Thả gà ra đồng và để gà kiếm 5 hạt", reward: { egg: { quick: true, pair: true } } },
  { key: "lucky", count: "lucky", goal: 2, text: "Ngoài đồng: chạm 2 đốm sáng để chỉ cho gà", reward: { bag: 4, table: "gift" } },
  { key: "hatch2", count: "hatch", goal: 2, text: "Ấp nở quả trứng thứ hai", reward: { seeds: { protein: 2, energy: 2, mineral: 2, pigment: 2 } } },
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
};
export const COUNTERS = ["warm", "hatch", "feed", "forage", "lucky", "juvenile", "adult", "collect", "dex2", "open", "trade", "play"];
const bump = (state, key, n = 1) => { state.count[key] = (state.count[key] ?? 0) + n; };
export const dayIndex = (now) => Math.floor((now + CONFIG.daily.tzOffsetMs) / DAY);

// Trại từ bản cũ: bổ sung phần còn thiếu từ đàn hiện có (không đổi gì khác).
function ensure(state) {
  if (!state.tower) state.tower = Object.fromEntries(Object.keys(SEEDS).map((k) => [k, 0])); // v7
  if (state.watchFrom == null) state.watchFrom = state.seenAt ?? state.updatedAt;
  if (state.tickets == null) { state.tickets = 0; state.play = null; } // v7
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
    stats: { hatched: 0, laid: 0, traded: 0, died: 0 },
    seenAt: now, // lần cuối người chơi có mặt (Q14)
    watchFrom: now, // đầu phiên có mặt hiện tại (v7: tháp hạt chỉ nuôi gà trong phiên)
    tower: Object.fromEntries(Object.keys(SEEDS).map((k) => [k, 0])), // hạt trong tháp
    tickets: 0, // vé (v7)
    play: null, // lượt minigame đang chơi: { id, kind, at }
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
  for (const ch of state.chickens.filter((c) => c.diedAt != null)) {
    state.memorial.push({ id: ch.id, name: ch.name, code: ch.code, hatchedAt: ch.hatchedAt, diedAt: ch.diedAt, dev: ch.dev, starvedMs: ch.starvedMs });
    state.stats.died++;
  }
  state.chickens = state.chickens.filter((c) => c.diedAt == null);
  state.updatedAt = now;
  events.sort((a, b) => a.at - b.at);
  return events;
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
    ...t,
  };
  state.chickens.push(ch);
  state.stats.hatched++;
  bump(state, "hatch");
  events.push({ type: "hatched", at, chickenId: ch.id, eggId: egg.id });
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
  for (const k of NUTRIENTS) ch.n[k] = Math.min(CONFIG.nutrientMax, ch.n[k] + s.n[k]);
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

// Hạt hợp nhất cho con gà trong số hạt đang có: bù nhiều nhất cho chất còn thiếu; hoà điểm thì hạt thường
// (tiết kiệm hạt tốt), rồi theo thứ tự trong SEEDS. Không bao giờ tự chọn hạt lạ. Hết hạt → null.
export function bestSeedFor(ch, counts) {
  let best = null, bestScore = -1;
  for (const k of Object.keys(SEEDS)) {
    if (k === "odd" || !(counts[k] > 0)) continue;
    let v = k === "common" ? 0.5 : 0;
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
  } else if (layReady && ch.sex === "hen" && ch.growth >= CONFIG.stages.adult && storedEggs(state) < CONFIG.storage.eggs) {
    // Q3: đẻ ngẫu nhiên khi no bụng — xác suất mỗi bước = dt / thời gian trung bình
    if (rngFor(state, "lay", ch.id, t)() < dt / ch.layMeanMs) layEgg(state, ch, t + dt, events);
  }
  for (const k of NUTRIENTS) ch.n[k] = Math.max(0, ch.n[k] - CONFIG.nutrientDrainPerHour * h);
}

// Có ≥ 1 trống trưởng thành, còn sống trong trại → trứng có phôi; bố chọn ngẫu nhiên (Q1).
function layEgg(state, hen, at, events) {
  const rng = rngFor(state, "egg", hen.id, at);
  const roosters = state.chickens.filter((c) => c.sex === "rooster" && c.adultAt != null && c.adultAt <= at && (c.diedAt == null || c.diedAt > at));
  let code = hen.code, fertile = false, fatherId = null, mutations = 0, line = [];
  if (roosters.length) {
    const father = roosters[Math.floor(rng() * roosters.length)];
    const r = breed(decodeGenome(father.code), decodeGenome(hen.code), rng, { mutationRate: 1 + hen.mutationBoost });
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
  const egg = { id: `e-${hen.id}-${at.toString(36)}`, code, shell: hen.shell, shellName: hen.shellName, fertile, motherId: hen.id, fatherId, laidAt: at, mutations, hatchAt: null, inYard: true, ...(line.length ? { line } : {}) };
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
export function fillTower(state, seed, n, now) {
  return act(state, now, () => {
    if (!SEEDS[seed]) return err("bad_seed", "Không có loại hạt này");
    if (seed === "odd") return err("bad_seed", "Hạt lạ phải cho ăn riêng từng con");
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

// ĐỐM SÁNG (v6): người chơi chỉ cho gà ngoài đồng một đốm sáng → gà bới được 1–3 hạt tốt hơn thường,
// đôi khi cả một túi hạt. Hạt về thẳng kho. opts.rng: server truyền nguồn ngẫu nhiên riêng (HMAC).
export function fieldBonus(state, chickenId, now, opts = {}) {
  return act(state, now, () => {
    const ch = state.chickens.find((c) => c.id === chickenId);
    if (!ch) return err("no_chicken", "Không tìm thấy gà");
    if (ch.location !== "field") return err("not_in_field", `${ch.name} không ở ngoài đồng`);
    if (now - (state.luckyAt ?? -1e15) < CONFIG.lucky.cooldownMs) return err("too_fast", "Chưa có đốm sáng mới");
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
      const k = rollSeed("lucky", rng);
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
  return { tutorial, daily, chest, streak, best: st.best ?? 0 };
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
    state.chickens = state.chickens.filter((c) => !chickenIds.includes(c.id));
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
  state.chickens = state.chickens.filter((c) => !chickenIds.includes(c.id));
  state.ticketDay = { day, eggs: d.eggs + eggs.length, chickens: d.chickens + chickens.length };
  state.tickets += gain;
  state.stats.traded += eggs.length + chickens.length;
  bump(state, "trade", eggs.length + chickens.length);
  return { tickets: gain };
}

/* ---------- sân chơi: minigame (v7) ---------- */

const playKind = (subject, isEgg) => (isEgg ? "roll" : subject.growth < CONFIG.stages.juvenile ? "hop" : subject.growth < CONFIG.stages.adult ? "dash" : "peck");

// Bắt đầu một lượt: `id` là gà (ở chuồng) hoặc trứng ĐANG ẤP. Trừ vé ngay; bỏ dở không hoàn.
export function startPlay(state, id, now) {
  return act(state, now, () => {
    const P = CONFIG.play;
    const ch = state.chickens.find((c) => c.id === id);
    const egg = ch ? null : state.eggs.find((e) => e.id === id && e.hatchAt !== null);
    if (!ch && !egg) return err("no_subject", "Không tìm thấy gà hay trứng đang ấp này");
    if (state.play && now - state.play.at <= P.maxMs) return err("play_busy", "Đang có một lượt chơi dở");
    state.play = null; // lượt cũ quá hạn: coi như bỏ dở, không hoàn vé
    if (state.tickets < P.cost) return err("no_ticket", "Hết vé — thắng trò chơi, mở rương hoặc đổi trứng / gà để có vé");
    if (ch) {
      if (ch.location !== "coop") return err("in_field", `${ch.name} đang ngoài đồng`);
      if (ch.satiety < P.hunger) return err("too_hungry", `${ch.name} đang đói — cho ăn rồi hãy chơi`);
      if (staminaOf(ch) < P.stamina) return err("too_tired", `${ch.name} đang mệt — để nó nghỉ một lúc`);
      ch.stamina = staminaOf(ch) - P.stamina;
    } else if ((egg.played ?? 0) >= P.eggMax) return err("too_tired", "Quả trứng này đã chơi đủ rồi");
    else egg.played = (egg.played ?? 0) + 1;
    state.tickets -= P.cost;
    state.play = { id, kind: playKind(ch ?? egg, !ch), at: now };
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
    if (egg) egg.hatchAt = Math.max(now, egg.hatchAt - P.eggCutPct * (egg.incubateMs ?? incubateMsOf(egg.code)) * s);
    else {
      ch.satiety = Math.max(0, ch.satiety - P.hunger);
      // chưa lớn: lớn thêm, nhưng dừng sát ngưỡng — bước mô phỏng kế tiếp mới là nơi phát "adult", chấm sổ, chấm giống
      if (ch.growth < CONFIG.stages.adult) ch.growth = Math.min(CONFIG.stages.adult - 0.001, ch.growth + P.growth * s);
      else ch.lifeUsed = Math.max(0, ch.lifeUsed - P.adultLifeMs * s);
      if (s >= P.fitnessAt) ch.fitness = Math.min(CONFIG.stamina.fitnessMax, (ch.fitness ?? 0) + CONFIG.stamina.fitnessStep);
    }
    const win = s >= P.winAt, day = dayIndex(now);
    let ticket = false;
    if (win) {
      bump(state, "play");
      const d = state.playDay?.day === day ? state.playDay : { day, tickets: 0 };
      if (d.tickets < P.winTicketsPerDay && state.tickets < CONFIG.tickets.cap) {
        state.tickets++;
        d.tickets++;
        ticket = true;
      }
      state.playDay = d;
    }
    return { score: s, win, ticket, kind: p.kind };
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
    state.chickens = state.chickens.filter((c) => c.id !== chickenId);
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
