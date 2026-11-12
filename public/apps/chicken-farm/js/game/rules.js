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
  version: 5,
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
  },
  fieldEatCooldownMs: 12 * 1000, // 1 con gà ăn tối đa 1 hạt / 12 giây (chống gian lận; design-review 11/11: 15 → 12 s)
  // Q6: giá trị cố định, không theo độ hiếm
  trade: { egg: 2, chicken: [4, 9], eggsPerChicken: 2 }, // túi hạt: trứng 2, gà 4 (mới nở) → 9 (trưởng thành); đổi gà lớn lấy 2 trứng có phôi
  start: { incubators: 1, coopCap: 6, starterChoices: 3, seeds: { common: 12 } },
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
  };
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

// Trại từ bản cũ chưa có sổ: ghi lại từ đàn hiện có (không đổi gì khác).
function ensureDex(state) {
  if (state.dex) return;
  state.dex = {};
  state.milestones = 0;
  for (const ch of state.chickens) {
    dexMark(state, ch, 1, ch.hatchedAt, null);
    if (ch.adultAt != null) dexMark(state, ch, 2, ch.adultAt, null);
  }
}

function dexMark(state, ch, star, at, events) {
  for (const key of dexKeysOf(ch.code)) {
    if ((state.dex[key] ?? 0) >= star) continue;
    if (star === 2 && ch.dev[DEX.find((d) => d.key === key).group] < CONFIG.dex.starDev) continue;
    state.dex[key] = star;
    events?.push({ type: "dex", at, key, star, chickenId: ch.id });
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
    dex: {}, // key → 1 (★) | 2 (★★)
    milestones: 0, // số mốc sổ đã đạt (Q13)
  };
  state.eggs.push({ id: nextId(state, "e"), code: pick.code, shell: pick.shell, shellName: pick.shellName, fertile: true, motherId: null, fatherId: null, laidAt: now, mutations: 0, hatchAt: null });
  return state;
}

/* ---------- mô phỏng tới hiện tại ---------- */

// present: người chơi đang mở game lúc `now` (mặc định). Server truyền false cho việc hệ thống tự làm
// (gọi gà về khi hết phiên xem) → trứng ấp xong vẫn nằm chờ trong ổ (Q14).
export function advance(state, now, { present = true } = {}) {
  const events = [];
  ensureDex(state);
  if (present) {
    const seen = state.seenAt ?? -Infinity;
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
  for (const ch of order) advanceChicken(state, ch, now, events);
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
    ...t,
  };
  state.chickens.push(ch);
  state.stats.hatched++;
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

function advanceChicken(state, ch, now, events) {
  const step = CONFIG.stepMs;
  const end = Math.floor(now / step) * step;
  let t = ch.updatedAt;
  while (t < end && ch.diedAt == null) {
    const dt = Math.min((Math.floor(t / step) + 1) * step, end) - t;
    stepChicken(state, ch, t, dt, events);
    t += dt;
  }
  ch.updatedAt = Math.max(ch.updatedAt, ch.diedAt ?? end);
}

function stepChicken(state, ch, t, dt, events) {
  const h = dt / HOUR;
  const fed = ch.satiety > 0;
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
    if (before < CONFIG.stages.juvenile && ch.growth >= CONFIG.stages.juvenile) events.push({ type: "juvenile", at: t + dt, chickenId: ch.id });
    if (ch.growth >= CONFIG.stages.adult) {
      ch.adultAt = t + dt;
      events.push({ type: "adult", at: t + dt, chickenId: ch.id });
      dexMark(state, ch, 2, t + dt, events);
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
  let code = hen.code, fertile = false, fatherId = null, mutations = 0;
  if (roosters.length) {
    const father = roosters[Math.floor(rng() * roosters.length)];
    const r = breed(decodeGenome(father.code), decodeGenome(hen.code), rng, { mutationRate: 1 + hen.mutationBoost });
    code = encodeGenome(r.genome);
    mutations = r.mutations.length;
    fertile = true;
    fatherId = father.id;
    hen.mutationBoost = Math.max(0, hen.mutationBoost - 1);
  }
  // id gắn với (mẹ, thời điểm) để không phụ thuộc thứ tự mô phỏng
  // trứng mới đẻ nằm ngoài SÂN; người chơi nhặt (collectEgg) mới vào kho
  const egg = { id: `e-${hen.id}-${at.toString(36)}`, code, shell: hen.shell, shellName: hen.shellName, fertile, motherId: hen.id, fatherId, laidAt: at, mutations, hatchAt: null, inYard: true };
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
      return { chickenId, seed, action: "ate" };
    }
    if (seedCount(state) >= CONFIG.storage.seeds) return err("seeds_full", "Kho hạt đầy");
    ch.lastFieldEat = now;
    state.inventory[seed]++;
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
    egg.hatchAt = now + incubateMsOf(egg.code);
    return { eggId, hatchAt: egg.hatchAt };
  });
}

/* ---------- đổi ở cửa hàng: trứng / gà → túi hạt (Q6) ---------- */

export const eggTradeValue = () => CONFIG.trade.egg;
export const chickenTradeValue = (ch) => Math.round(lerp(CONFIG.trade.chicken[0], CONFIG.trade.chicken[1], ch.growth / CONFIG.stages.adult));

// Mỗi trứng / gà đổi được một túi hạt (2 hạt cho trứng, 4–9 hạt cho gà), mở ra ngẫu nhiên.
export function tradeToShop(state, give, now) {
  return act(state, now, () => {
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
    return { bags: bags.map((b) => b.id) };
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
      const k = rollSeed("shop", rng);
      got[k] = (got[k] ?? 0) + 1;
      state.inventory[k]++;
    }
    state.bags = state.bags.filter((b) => b.id !== bagId);
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
