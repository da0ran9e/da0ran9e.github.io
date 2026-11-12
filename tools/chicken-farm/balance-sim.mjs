#!/usr/bin/env node
// Trại Gà — mô phỏng cân bằng (đội Cân bằng / QA).
//
// Chơi game bằng CHÍNH luật thật (public/apps/chicken-farm/js/game/rules.js + field.js), với
// người chơi giả lập theo "kiểu chơi" (archetype), nhiều seed, rồi in bảng tổng hợp.
// Không sửa luật: các đề xuất CONFIG được áp bằng cách ghi đè (monkeypatch) CONFIG / FIELD / SEEDS
// ngay trong tiến trình mô phỏng. Các "bản vá thiết kế" chưa có trong luật (ví dụ trứng khởi đầu
// theo cặp) được GIẢ LẬP ở tầng mô phỏng và ghi rõ là giả lập.
//
// Chạy:  node tools/chicken-farm/balance-sim.mjs                       (kịch bản mặc định)
//        node tools/chicken-farm/balance-sim.mjs --scenarios goc,hien-tai --runs 40
//        node tools/chicken-farm/balance-sim.mjs --list                  (liệt kê kịch bản / kiểu chơi)
//        node tools/chicken-farm/balance-sim.mjs --set laySatiety=40 --set storage.seeds=200
//        node tools/chicken-farm/balance-sim.mjs --json out.json         (xuất số liệu thô đã tổng hợp)
// Tuỳ chọn: --runs N (mặc định 32; báo cáo dùng 40) · --days D (7) · --archetypes a,b · --workers N (số lõi)
//           --set key=value (ghi đè CONFIG cho MỌI kịch bản; field.x=… cho FIELD; sim.x=… cho hành vi)

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const SELF = fileURLToPath(import.meta.url);
const GAME = new URL("../../public/apps/chicken-farm/js/", import.meta.url);

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/* ============================== kiểu chơi ============================== */

// Mỗi kiểu chơi: lịch phiên (giờ trong ngày, theo giờ thức 7:00–23:00) + hành vi.
//   sessions(rng, day) → [{ at: phút-trong-ngày, dur: phút }]
//   rotateMin: bao lâu đổi gà ra đồng một lần trong phiên (chỉ 1 con được ra đồng)
//   choresOnRotate: mỗi lần đổi gà thì làm việc nhà (cho ăn, ấp, đổi…)
export const ARCHETYPES = {
  casual: {
    label: "Ghé thăm (3 phiên × 10 phút/ngày)",
    sessions: (rng, day) => [8 * 60, 13 * 60, 20 * 60].map((m, i) => ({ at: day === 0 && i === 0 ? 7 * 60 : m + Math.round((rng() - 0.5) * 90), dur: 10 })),
    rotateMin: 10,
  },
  engaged: {
    label: "Chăm (1–2 giờ/phiên, 10–15 phút)",
    sessions: (rng) => {
      const out = [];
      let m = 7 * 60;
      while (m < 23 * 60) {
        const dur = 10 + Math.round(rng() * 5);
        out.push({ at: m, dur });
        m += dur + 60 + Math.round(rng() * 60);
      }
      return out;
    },
    rotateMin: 5,
  },
  hardcore: {
    label: "Cày (xem đồng gần như cả ngày thức)",
    sessions: () => Array.from({ length: 32 }, (_, i) => ({ at: 7 * 60 + i * 30, dur: 30 })),
    rotateMin: 10,
    choresOnRotate: true,
  },
  neglect: {
    label: "Bỏ bê (1 phiên × 10 phút/ngày)",
    sessions: (rng, day) => [{ at: day === 0 ? 7 * 60 : 18 * 60 + Math.round(rng() * 240), dur: 10 }],
    rotateMin: 10,
  },
};

// Hành vi người chơi (ghi đè được qua kịch bản: scenario.sim, hoặc --set sim.x=…)
const SIM_DEFAULTS = {
  keepFertile: 2, // giữ tối đa N trứng có phôi trong kho (chờ ổ ấp), thừa thì đổi túi
  useTradeForEgg: true, // dùng rules.tradeForEgg khi trại thiếu trống / thiếu mái
  cullForSpace: false, // chuồng đầy mà có trứng phôi chờ ấp → đổi con già nhất lấy túi
  fieldMulti: false, // GIẢ ĐỊNH (vượt luật): thả mọi gà ra đồng cùng lúc, để đo luật 1 con
  // ---- bản vá thiết kế GIẢ LẬP (chưa có trong rules.js; hatchOnOpen đã thành luật v5 — để false) ----
  starterPair: false, // trứng khởi đầu: 1 trống + 1 mái (2 quả, đều có phôi)
  starterHen: false, // trứng khởi đầu luôn là mái
  eggSwap: 0, // >0: đổi N trứng KHÔNG phôi lấy 1 trứng có phôi ngẫu nhiên (khi trại không có trống)
  wildRooster: 0, // 0–1: trại không có trống trưởng thành → trứng mới đẻ có phôi với xác suất này
  autoFeeder: false, // "máng ăn": khi người chơi vắng, gà bụng rỗng tự lấy 1 hạt trong kho (kiểm tra mỗi 10 phút)
  hatchOnOpen: false, // "gà con chờ trong ổ": trứng ấp xong lúc người chơi vắng chỉ nở khi người chơi mở game (ổ vẫn bị chiếm)
  // ---- hành vi người chơi (không phải luật) ----
  maxFlock: 0, // >0: người chơi chỉ ấp khi (gà + trứng đang ấp) < N — "nuôi vừa sức kho hạt"
};

/* ============================== kịch bản ============================== */

// config: ghi đè rules.CONFIG · field: ghi đè field.FIELD · sim: ghi đè SIM_DEFAULTS
// Gói đề xuất CONFIG của đội Cân bằng (xem docs/chicken-farm/balance-report.md)
export const PROPOSAL = {
  satietyMax: 200, // bụng chứa gấp đôi …
  satietyDrainPerHour: 25, // … và đói chậm hơn → no được 8 giờ (đủ một đêm ngủ), trước đây 2,2 giờ
  starveAging: 2, // bụng rỗng: 1 giờ = 2 giờ tuổi (trước: 3)
  layMeanHours: [6, 2], // đẻ thưa hơn để bù việc mái no lâu hơn (trước: [3, 1])
};
export const SCENARIOS = {
  goc: { label: "Luật hiện tại, người chơi KHÔNG dùng tradeForEgg", sim: { useTradeForEgg: false } },
  "hien-tai": { label: "Luật hiện tại + người chơi dùng tradeForEgg hợp lý (MỐC SO SÁNH)" },
  // ---- vá ngõ cụt "không có trống" ----
  "cap-khoi-dau-khong-doi": { label: "Vá A: trứng khởi đầu 1 trống + 1 mái, KHÔNG dùng tradeForEgg", sim: { starterPair: true, useTradeForEgg: false } },
  "cap-khoi-dau": { label: "Vá A: trứng khởi đầu 1 trống + 1 mái (+ tradeForEgg)", sim: { starterPair: true } },
  "doi-trung-khong-phoi": { label: "Vá B: mái khởi đầu + đổi 3 trứng không phôi → 1 trứng có phôi (+ tradeForEgg)", sim: { starterHen: true, eggSwap: 3 } },
  "trong-rung": { label: "Vá C: mái khởi đầu + 'trống rừng' 50% khi không có trống (+ tradeForEgg)", sim: { starterHen: true, wildRooster: 0.5 } },
  // ---- luật 1 con ngoài đồng ----
  "nhieu-ga-dong": { label: "Vá A + GIẢ ĐỊNH bỏ luật 1 con ngoài đồng (mọi gà ra đồng)", sim: { starterPair: true, fieldMulti: true } },
  // ---- đề xuất CONFIG ----
  "chi-config": { label: "Chỉ gói CONFIG đề xuất, KHÔNG vá trứng khởi đầu", config: PROPOSAL },
  "de-xuat-no": { label: "Vá A + chỉ đổi bụng: satietyMax 200, satietyDrain 25/giờ", sim: { starterPair: true }, config: { satietyMax: 200, satietyDrainPerHour: 25 } },
  "de-xuat-tong": { label: "Vá A + gói CONFIG đề xuất (bụng 200, đói 25/giờ, già đói 2×, đẻ 6–2 giờ)", sim: { starterPair: true }, config: PROPOSAL },
  "de-xuat-tong-khong-doi": { label: "Vá A + gói CONFIG đề xuất, KHÔNG dùng tradeForEgg", sim: { starterPair: true, useTradeForEgg: false }, config: PROPOSAL },
  "may-an": { label: "Vá A + gói đề xuất + 'máng ăn' tự cho ăn từ kho khi vắng (giả lập)", sim: { starterPair: true, autoFeeder: true }, config: PROPOSAL },
  // ---- thử thêm (không chạy mặc định) ----
  "thu-de-de": { label: "Vá A + laySatiety 60→30", sim: { starterPair: true }, config: { laySatiety: 30 } },
  "thu-lon-nhanh": { label: "Vá A + growMs.worst 24h→8h, nutrientDrain 30→15", sim: { starterPair: true }, config: { growMs: { worst: 8 * HOUR }, nutrientDrainPerHour: 15 } },
  "thu-cooldown-10s": { label: "Vá A + gói đề xuất + fieldEatCooldownMs 15s→10s", sim: { starterPair: true }, config: { ...PROPOSAL, fieldEatCooldownMs: 10_000 } },
  "thu-cooldown-7s5": { label: "Vá A + gói đề xuất + fieldEatCooldownMs 15s→7,5s", sim: { starterPair: true }, config: { ...PROPOSAL, fieldEatCooldownMs: 7_500 } },
  "thu-nhieu-ga-dong-de-xuat": { label: "Vá A + gói đề xuất + GIẢ ĐỊNH bỏ luật 1 con ngoài đồng", sim: { starterPair: true, fieldMulti: true }, config: PROPOSAL },
  "thu-doi-cu": { label: "Vá A + đói chậm kiểu cũ: satietyDrain 20/giờ, starveAging 2 (bụng vẫn 100)", sim: { starterPair: true }, config: { satietyDrainPerHour: 20, starveAging: 2 } },
};
// ---- sau quyết định Q11/Q12 (11/11): đánh giá thiết kế v4 — docs/chicken-farm/design-review.md ----
// Q13 nâng cấp chuồng: đo trần chuồng 6 → 8 / 10 / 12 (mỗi mức = một bậc nâng cấp), và "đổi gà già lấy chỗ".
// Q14 bỏ bê: máng ăn, gà con chờ trong ổ, cả hai. Các vá ở tầng mô phỏng ghi rõ "giả lập".
Object.assign(SCENARIOS, {
  "chuong-8": { label: "Q13: chuồng 8 chỗ (một bậc nâng cấp)", config: { start: { coopCap: 8 } } },
  "chuong-10": { label: "Q13: chuồng 10 chỗ (hai bậc)", config: { start: { coopCap: 10 } } },
  "chuong-12": { label: "Q13: chuồng 12 chỗ (ba bậc)", config: { start: { coopCap: 12 } } },
  "chuong-6-loc": { label: "Chuồng 6 + người chơi đổi gà sắp già lấy túi để lấy chỗ ấp (luật hiện có)", sim: { cullForSpace: true } },
  "chuong-10-loc": { label: "Chuồng 10 + đổi gà sắp già lấy chỗ", sim: { cullForSpace: true }, config: { start: { coopCap: 10 } } },
  "vua-suc-4": { label: "Người chơi chỉ nuôi tối đa 4 con (gà + trứng đang ấp)", sim: { maxFlock: 4 } },
  "v4-may-an": { label: "Q14-A: máng ăn tự cho ăn từ kho khi vắng (giả lập)", sim: { autoFeeder: true } },
  "v4-cho-trong-o": { label: "Q14-B: gà con chờ trong ổ tới khi người chơi mở game (giả lập)", sim: { hatchOnOpen: true } },
  "v4-may-an-cho-o": { label: "Q14-A+B: máng ăn + gà con chờ trong ổ (giả lập)", sim: { autoFeeder: true, hatchOnOpen: true } },
  // ---- thử chỉnh số (chỉ CONFIG) ----
  "so-no-ga-con": { label: "hatch.satiety 50 → 120 (gà con mới nở no ~5 giờ)", config: { hatch: { satiety: 120 } } },
  "so-doi-20": { label: "satietyDrainPerHour 25 → 20 (no 10 giờ)", config: { satietyDrainPerHour: 20 } },
  "so-trung-3": { label: "trade.egg 2 → 3 (trứng đổi túi 3 hạt)", config: { trade: { egg: 3 } } },
  "so-kho-200": { label: "storage.seeds 120 → 200", config: { storage: { seeds: 200 } } },
  "so-cooldown-10s": { label: "fieldEatCooldownMs 15 s → 10 s", config: { fieldEatCooldownMs: 10_000 } },
  "so-goi-v4": { label: "Gói v4: hatch.satiety 120 + trade.egg 3", config: { hatch: { satiety: 120 }, trade: { egg: 3 } } },
});
// Mặc định: mốc hiện tại + các phương án Q13/Q14 (kịch bản trước 11/11 vẫn chạy được bằng --scenarios)
const DEFAULT_SCENARIOS = ["hien-tai", "chuong-8", "chuong-10", "chuong-6-loc", "v4-may-an", "v4-cho-trong-o", "v4-may-an-cho-o", "so-no-ga-con", "so-goi-v4"];

/* ============================== tiện ích ============================== */

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function resetTo(target, pristine) {
  for (const k of Object.keys(target)) if (!(k in pristine)) delete target[k];
  for (const [k, v] of Object.entries(pristine)) {
    if (isObj(v) && isObj(target[k])) resetTo(target[k], v);
    else target[k] = structuredClone(v);
  }
}
function deepApply(target, patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (isObj(v) && isObj(target[k])) deepApply(target[k], v);
    else target[k] = structuredClone(v);
  }
}
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
function quantile(arr, q) {
  const a = arr.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] === a[hi] ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
}
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);

/* ============================== WORKER: chạy 1 ván ============================== */

async function workerMain() {
  const R = await import(new URL("game/rules.js", GAME));
  const F = await import(new URL("game/field.js", GAME));
  const G = await import(new URL("genome.js", GAME));
  const pristine = { config: structuredClone(R.CONFIG), field: structuredClone(F.FIELD), seeds: structuredClone(R.SEEDS) };

  parentPort.on("message", (job) => {
    if (job === "exit") process.exit(0);
    resetTo(R.CONFIG, pristine.config);
    resetTo(F.FIELD, pristine.field);
    resetTo(R.SEEDS, pristine.seeds);
    deepApply(R.CONFIG, job.config);
    deepApply(F.FIELD, job.field);
    deepApply(R.SEEDS, job.seeds);
    let out;
    try {
      out = runGame({ R, F, G }, job);
    } catch (e) {
      out = { error: String(e.stack || e) };
    }
    parentPort.postMessage({ key: job.key, out });
  });
  parentPort.postMessage({ ready: true });
}

function runGame({ R, F, G }, job) {
  const arch = ARCHETYPES[job.archetype];
  const sim = { ...SIM_DEFAULTS, ...job.sim };
  const days = job.days;
  const T0 = Date.UTC(2026, 10, 9, 0, 0); // 0:00 ngày 0 (theo "giờ người chơi")
  const start = T0 + 7 * HOUR; // mở game lúc 7:00
  const endT = start + days * DAY;
  const SAMPLE = 10 * MIN;
  const rng = G.mulberry32(hash32(`plan|${job.archetype}|${job.run}`));
  const gameSeed = hash32(`game|${job.run}`); // cùng seed cho mọi kịch bản / kiểu chơi → so sánh theo cặp

  const st = R.newGame(gameSeed, start, 0);
  const sexOfCode = (code) => G.express(G.decodeGenome(code)).sex;
  const starterSex = sexOfCode(st.eggs[0].code);
  const makeEgg = (id, code, at) => {
    const ph = G.express(G.decodeGenome(code));
    return { id, code, shell: ph.egg.shell, shellName: ph.egg.name, fertile: true, motherId: null, fatherId: null, laidAt: at, mutations: 0, hatchAt: null, simPatch: true };
  };
  const genomeOfSex = (sex, key) => G.randomGenome(G.mulberry32(hash32(`${gameSeed}|${key}`)), { sex });
  if (sim.starterHen && starterSex === "rooster") {
    st.eggs[0].code = G.encodeGenome(genomeOfSex("hen", "starterHen"));
  }
  if (sim.starterPair) {
    const other = sexOfCode(st.eggs[0].code) === "hen" ? "rooster" : "hen";
    st.eggs.push(makeEgg("e-pair", G.encodeGenome(genomeOfSex(other, "starterPair")), start));
  }

  /* ---------- số đo ---------- */
  const M = {
    starterSex,
    firstHatch: null, firstAdult: null,
    hatched: 0, adults: 0,
    growthH: [], adultDev: [],
    laidF: Array(days).fill(0), laidI: Array(days).fill(0),
    deathsStarved: 0, deathsOld: 0, lifeShort: [], ageAtDeathH: [],
    aliveByDay: Array(days).fill(0), adultsByDay: Array(days).fill(0), samplesByDay: Array(days).fill(0),
    seedsByDay: [], bagsReceived: 0, bagsOpened: 0, seedsFromBags: 0,
    cap: { fieldSeedsLost: 0, bagOpenBlocked: 0, bagsFull: 0, eggStoreFullSamples: 0, coopFullBlocked: 0, eggsLostFull: 0 },
    henSamples: 0, henBelowLay: 0, chSamples: 0, chStarving: 0,
    watchMs: 0, fieldChickenMs: 0, found: 0, ate: 0, stored: 0,
    chickenMs: 0, // tổng thời gian sống của mọi gà (để tính nhu cầu ăn)
    tradeForEgg: 0, eggSwap: 0, autoFed: 0, collected: 0, wildFertile: 0, culled: 0,
    deadEndAt: null, extinctAt: null, deadEnd: false, extinct: false, aliveEnd: 0, adultsEnd: 0, hasPairEnd: false,
    sessions: 0,
    dex: new Set(), dexByDay: Array(days).fill(null), rareMax: 0, // "sổ sưu tầm" thử: các đặc điểm nhìn thấy được đã từng nở
  };
  // Mục sổ sưu tầm thử nghiệm (đề xuất ở design-review.md §5): 11 cờ hiếm của rarityOf + kiểu hoa văn / mào / đuôi / vỏ trứng
  const dexKeys = (code) => {
    const ph = G.express(G.decodeGenome(code));
    const s = ph.shape;
    const out = [`pattern:${ph.pattern}`, `comb:${s.combType}`, `tail:${s.tailType}`, `shell:${ph.egg.name}`];
    if (s.crest > 0) out.push("crest");
    if (s.muff) out.push("muff");
    if (s.silkie) out.push("silkie");
    if (s.frizzle > 0) out.push("frizzle");
    if (s.toes > 4) out.push("toes5");
    if (s.feetFeather > 0) out.push("feetFeather");
    if (ph.dilute > 0) out.push(`dilute${ph.dilute}`);
    if (ph.darkSkin) out.push("darkSkin");
    return out;
  };
  const info = new Map(); // id gà → { hatchedAt, lifespanMs, sex }
  const dayOf = (t) => Math.min(days - 1, Math.max(0, Math.floor((t - start) / DAY)));

  const onEvents = (evs) => {
    for (const e of evs ?? []) {
      if (e.type === "hatched") {
        const ch = st.chickens.find((c) => c.id === e.chickenId);
        if (ch) info.set(ch.id, { hatchedAt: ch.hatchedAt, lifespanMs: ch.lifespanMs, sex: ch.sex });
        if (ch) {
          const keys = dexKeys(ch.code);
          for (const k of keys) M.dex.add(k);
          M.rareMax = Math.max(M.rareMax, R.rarityOf(ch.code));
          M.dexByDay[dayOf(e.at)] = M.dex.size;
        }
        M.hatched++;
        if (M.firstHatch == null) M.firstHatch = (e.at - start) / HOUR;
      } else if (e.type === "adult") {
        const i = info.get(e.chickenId);
        M.adults++;
        if (i) M.growthH.push((e.at - i.hatchedAt) / HOUR);
        const ch = st.chickens.find((c) => c.id === e.chickenId);
        if (ch) M.adultDev.push(R.NUTRIENTS.reduce((s, k) => s + ch.dev[k], 0) / R.NUTRIENTS.length);
        if (M.firstAdult == null) M.firstAdult = (e.at - start) / HOUR;
      } else if (e.type === "laid") {
        const d = dayOf(e.at);
        let fertile = e.fertile;
        if (!fertile && sim.wildRooster > 0) {
          const egg = st.eggs.find((x) => x.id === e.eggId);
          const r = G.mulberry32(hash32(`${gameSeed}|wild|${e.eggId}`));
          if (egg && r() < sim.wildRooster) {
            const father = G.randomGenome(r, { sex: "rooster" });
            const res = G.breed(father, G.decodeGenome(egg.code), r);
            egg.code = G.encodeGenome(res.genome);
            egg.fertile = true;
            egg.fatherId = "wild";
            fertile = true;
            M.wildFertile++;
          }
        }
        if (fertile) M.laidF[d]++;
        else M.laidI[d]++;
      } else if (e.type === "died") {
        const i = info.get(e.chickenId);
        if (e.starved) M.deathsStarved++;
        else M.deathsOld++;
        if (i) {
          M.ageAtDeathH.push((e.at - i.hatchedAt) / HOUR);
          M.lifeShort.push(1 - (e.at - i.hatchedAt) / i.lifespanMs);
        }
      }
    }
  };
  const call = (r) => {
    onEvents(Array.isArray(r) ? r : r.events);
    return r;
  };

  const PREF_ADULT = ["common", "energy", "protein", "mineral", "pigment", "odd", "premium"];

  /* ---------- lấy mẫu trạng thái (mỗi 10 phút) ---------- */
  let nextSample = start;
  // Ngõ cụt = chắc chắn không bao giờ có lứa gà mới (dù chơi thế nào) với luật + bản vá đang dùng.
  const isDoomed = () => {
    const ch = st.chickens;
    const F = st.eggs.filter((e) => e.fertile).length;
    const hens = ch.filter((c) => c.sex === "hen").length, roosters = ch.length - hens;
    const henFix = sim.wildRooster > 0 || sim.eggSwap > 0; // một mái đơn độc vẫn tự có trứng phôi
    if (hens && roosters) return false;
    if (hens && henFix) return false;
    if (ch.length + F >= 2 && F >= 1) return false; // trứng phôi chưa nở có thể là giới còn thiếu
    // luật 11/11: gà trưởng thành đổi được 2 trứng có phôi → còn 1 con (sẽ lớn) là còn đường
    if (ch.length >= 1 && sim.useTradeForEgg) return false;
    if (ch.length === 0 && F === 1 && henFix) return false; // quả trứng cuối có thể nở ra mái
    return true;
  };
  const sample = (t) => {
    // lấy mẫu giữa các phiên: người chơi KHÔNG có mặt (Q14: trứng ấp xong chờ trong ổ)
    call(R.advance(st, t, { present: false }));
    if (sim.autoFeeder) {
      for (const c of st.chickens) {
        if (c.location !== "coop" || c.satiety > 0) continue;
        const k = PREF_ADULT.find((x) => st.inventory[x] > 0);
        if (k && call(R.feed(st, c.id, k, t)).ok) M.autoFed++;
      }
    }
    const d = dayOf(t);
    if (t < endT) {
      M.samplesByDay[d]++;
      M.aliveByDay[d] += st.chickens.length;
      M.adultsByDay[d] += st.chickens.filter((c) => c.growth >= R.CONFIG.stages.adult).length;
      for (const c of st.chickens) {
        M.chSamples++;
        if (c.satiety <= 0) M.chStarving++;
        if (c.sex === "hen" && c.growth >= R.CONFIG.stages.adult) {
          M.henSamples++;
          if (c.satiety < R.CONFIG.laySatiety) M.henBelowLay++;
        }
      }
      M.chickenMs += st.chickens.length * SAMPLE;
      if (st.eggs.filter((e) => e.hatchAt === null).length >= R.CONFIG.storage.eggs) M.cap.eggStoreFullSamples++;
      if (isDoomed()) M.deadEndAt ??= (t - start) / HOUR;
      else M.deadEndAt = null;
      if (M.extinctAt == null && !st.chickens.length && !st.eggs.some((e) => e.fertile)) M.extinctAt = (t - start) / HOUR;
    }
    // tồn kho hạt cuối mỗi ngày
    if ((t - start) % DAY === 0 && t > start) M.seedsByDay.push({ ...st.inventory });
  };
  const sampleUntil = (t) => {
    while (nextSample <= t) {
      sample(nextSample);
      nextSample += SAMPLE;
    }
  };

  /* ---------- việc nhà ---------- */
  const lifeLeft = (c) => c.lifespanMs - c.lifeUsed;
  const pickSeed = (c) => {
    const inv = st.inventory;
    const avail = Object.keys(R.SEEDS).filter((k) => inv[k] > 0);
    if (!avail.length) return null;
    if (c.growth >= R.CONFIG.stages.adult) return PREF_ADULT.find((k) => inv[k] > 0) ?? avail[0];
    let best = null, bs = -1;
    for (const k of avail) {
      let s = 0;
      for (const n of R.NUTRIENTS) s += Math.min(R.SEEDS[k].n[n], Math.max(0, R.CONFIG.nutrientFull - c.n[n]));
      if (k === "common") s += 0.5; // hoà điểm → dùng hạt rẻ
      if (s > bs) { bs = s; best = k; }
    }
    return best;
  };
  const feedAll = (t) => {
    const prio = (c) => (c.growth < R.CONFIG.stages.adult ? 0 : c.sex === "hen" ? 1 : 2);
    let open = st.chickens.filter((c) => c.location === "coop").sort((a, b) => prio(a) - prio(b));
    while (open.length) {
      const still = [];
      for (const c of open) {
        const k = pickSeed(c);
        if (!k) return;
        const r = call(R.feed(st, c.id, k, t));
        if (r.ok) still.push(c);
      }
      open = still.filter((c) => st.chickens.includes(c));
    }
  };
  const incubateAll = (t) => {
    for (const e of st.eggs.filter((x) => x.fertile && x.hatchAt === null)) {
      if (sim.maxFlock > 0 && st.chickens.length + st.incubators.filter(Boolean).length >= sim.maxFlock) break;
      const r = call(R.incubate(st, e.id, t));
      if (!r.ok) {
        if (r.code === "coop_full") M.cap.coopFullBlocked++;
        break;
      }
    }
  };
  const openBags = (t) => {
    for (const b of [...st.bags]) {
      const size = b.size;
      const r = call(R.openBag(st, b.id, t));
      if (r.ok) { M.bagsOpened++; M.seedsFromBags += size; }
      else { if (r.code === "seeds_full") M.cap.bagOpenBlocked++; break; }
    }
  };
  const tradeEggs = (t) => {
    const stored = st.eggs.filter((e) => e.hatchAt === null);
    const infertile = stored.filter((e) => !e.fertile);
    const fertile = stored.filter((e) => e.fertile);
    const give = [...infertile, ...fertile.slice(sim.keepFertile)].map((e) => e.id);
    if (!give.length) return;
    const room = R.CONFIG.storage.bags - st.bags.length;
    if (room < give.length) M.cap.bagsFull++;
    if (room <= 0) return;
    const r = call(R.tradeToShop(st, { eggs: give.slice(0, room) }, t));
    if (r.ok) M.bagsReceived += r.bags.length;
  };
  const antiDeadEnd = (t) => {
    // Vá B (giả lập): trại không có trống, đủ N trứng không phôi → đổi lấy 1 trứng có phôi
    if (sim.eggSwap > 0) {
      while (!st.chickens.some((c) => c.sex === "rooster")) {
        const inf = st.eggs.filter((e) => e.hatchAt === null && !e.fertile);
        if (inf.length < sim.eggSwap || st.eggs.some((e) => e.fertile)) break;
        const drop = new Set(inf.slice(0, sim.eggSwap).map((e) => e.id));
        st.eggs = st.eggs.filter((e) => !drop.has(e.id));
        const r = G.mulberry32(hash32(`${gameSeed}|swap|${t}|${M.eggSwap}`));
        st.eggs.push(makeEgg(`e-swap-${M.eggSwap}`, G.encodeGenome(G.randomGenome(r)), t));
        M.eggSwap++;
      }
    }
    if (!sim.useTradeForEgg || !R.tradeForEgg) return;
    // tradeForEgg (luật 11/11: gà TRƯỞNG THÀNH → 2 trứng có phôi): dùng khi trại chưa có cặp trống+mái
    // và không còn trứng phôi nào đang chờ. Đổi con trưởng thành sắp hết tuổi nhất của giới đang thừa.
    for (let guard = 0; guard < 6; guard++) {
      const ch = st.chickens.filter((c) => c.location === "coop");
      const hens = ch.filter((c) => c.sex === "hen"), roosters = ch.filter((c) => c.sex === "rooster");
      const pending = st.eggs.some((e) => e.fertile);
      if (pending || ch.length < 1 || (hens.length && roosters.length)) return;
      const pool = (hens.length ? hens : roosters).filter((c) => c.growth >= R.CONFIG.stages.adult);
      if (!pool.length) return;
      const victim = pool.sort((a, b) => lifeLeft(a) - lifeLeft(b))[0];
      const r = call(R.tradeForEgg(st, victim.id, t));
      if (!r.ok) return;
      M.tradeForEgg++;
      incubateAll(t);
    }
  };
  const cull = (t) => {
    if (!sim.cullForSpace) return;
    const waiting = st.eggs.some((e) => e.fertile && e.hatchAt === null);
    const busy = st.chickens.length + st.incubators.filter(Boolean).length >= st.coopCap;
    if (!waiting || !busy || !st.incubators.includes(null)) return;
    const hens = st.chickens.filter((c) => c.sex === "hen"), roosters = st.chickens.filter((c) => c.sex === "rooster");
    const cands = st.chickens.filter((c) => c.location === "coop" && !(c.sex === "hen" && hens.length < 2) && !(c.sex === "rooster" && roosters.length < 2));
    if (!cands.length || st.bags.length >= R.CONFIG.storage.bags) return;
    const v = cands.sort((a, b) => lifeLeft(a) - lifeLeft(b))[0];
    const r = call(R.tradeToShop(st, { chickens: [v.id] }, t));
    if (r.ok) { M.culled++; M.bagsReceived++; }
  };
  const collectYard = (t) => {
    if (!R.collectEgg) return;
    for (const e of st.eggs.filter((x) => x.inYard)) if (call(R.collectEgg(st, e.id, t)).ok) M.collected++;
  };
  const chores = (t) => {
    call(R.advance(st, t));
    collectYard(t); // trứng mới đẻ nằm ngoài sân → nhặt vào kho (sức chứa 12 tính cả sân)
    antiDeadEnd(t);
    incubateAll(t);
    cull(t);
    incubateAll(t);
    tradeEggs(t);
    openBags(t);
    feedAll(t);
  };

  /* ---------- cánh đồng ---------- */
  const fieldSpeed = (c, t) => {
    const v = R.chickenView(c, t);
    const tr = F.fieldTraits(G.express(G.decodeGenome(c.code), v.care));
    return { speed: tr.speed * (0.6 + 0.4 * v.growth01), sight: tr.sight }; // như main.js: gà con đi chậm hơn
  };
  const pickForField = () =>
    [...st.chickens].filter((c) => c.location === "coop").sort((a, b) => a.satiety - b.satiety || a.growth - b.growth)[0];

  const watch = (t0, durMs, sIdx) => {
    const f = F.createField({ seed: hash32(`${gameSeed}|field|${sIdx}`) });
    const tick = F.FIELD.tickMs;
    let t = t0;
    const end = t0 + durMs;
    let nextRotate = t0;
    const syncOut = () => {
      const out = new Set(st.chickens.filter((c) => c.location === "field").map((c) => c.id));
      for (const id of [...f.chickens.keys()]) if (!out.has(id)) F.removeChicken(f, id);
    };
    while (t < end) {
      if (t >= nextRotate) {
        call(R.recallAll(st, t));
        syncOut();
        if (arch.choresOnRotate && t > t0) chores(t);
        if (sim.fieldMulti) {
          for (const c of st.chickens) c.location = "field"; // GIẢ ĐỊNH vượt luật 1 con
        } else {
          const c = pickForField();
          if (c) {
            const r = call(R.release(st, c.id, t));
            if (!r.ok && r.code !== "field_busy") throw new Error(`release: ${r.code}`);
          }
        }
        for (const c of st.chickens.filter((x) => x.location === "field")) {
          const s = fieldSpeed(c, t);
          F.addChicken(f, { id: c.id, speed: s.speed, sight: s.sight });
        }
        nextRotate = t + arch.rotateMin * MIN;
      }
      if (!f.chickens.size) {
        // chưa có gà (trứng đang ấp): không cần chạy cánh đồng, chỉ trôi thời gian
        const nt = Math.min(end, nextRotate, t + MIN);
        sampleUntil(nt);
        t = nt;
        nextRotate = Math.min(nextRotate, t + MIN);
        continue;
      }
      t += tick;
      M.watchMs += tick;
      M.fieldChickenMs += tick * f.chickens.size;
      for (const e of F.tickField(f, tick)) {
        const at = t0 + f.t;
        const r = call(R.fieldFind(st, e.chickenId, e.seed, at));
        if (r.ok) {
          M.found++;
          if (r.action === "ate") M.ate++;
          else M.stored++;
        } else if (r.code === "seeds_full") M.cap.fieldSeedsLost++;
        const ch = st.chickens.find((c) => c.id === e.chickenId);
        // giống main.js: bị từ chối (trừ too_fast) → nghỉ gấp đôi thời gian chờ
        if (ch && !r.ok && r.code !== "too_fast") F.setReadyAt(f, ch.id, f.t + 2 * R.CONFIG.fieldEatCooldownMs);
        else if (ch) F.setReadyAt(f, ch.id, f.t + Math.max(0, R.CONFIG.fieldEatCooldownMs - (at - ch.lastFieldEat)));
        else F.removeChicken(f, e.chickenId);
      }
      if (t >= nextSample) {
        sampleUntil(t);
        syncOut();
        if (!f.chickens.size) nextRotate = t; // gà ngoài đồng vừa mất → thả con khác
      }
    }
    call(R.recallAll(st, end));
  };

  /* ---------- vòng chơi ---------- */
  let sIdx = 0;
  for (let d = 0; d < days; d++) {
    const plan = arch.sessions(rng, d).sort((a, b) => a.at - b.at);
    for (const s of plan) {
      const t0 = T0 + d * DAY + s.at * MIN;
      if (t0 < start || t0 >= endT) continue;
      sampleUntil(t0);
      M.sessions++;
      if (sim.hatchOnOpen) for (const e of st.eggs) if (e.heldHatchAt != null) { e.hatchAt = Math.max(t0, e.heldHatchAt); delete e.heldHatchAt; }
      chores(t0);
      watch(t0, s.dur * MIN, sIdx++);
      const tEnd = t0 + s.dur * MIN;
      chores(tEnd);
      // Q14-B (giả lập): trứng sẽ nở sau khi người chơi rời đi → giữ trong ổ, nở khi người chơi quay lại
      if (sim.hatchOnOpen) for (const e of st.eggs) if (e.hatchAt != null && e.hatchAt > tEnd) { e.heldHatchAt = e.hatchAt; e.hatchAt = endT + 365 * DAY; }
    }
  }
  sampleUntil(endT);
  call(R.advance(st, endT, { present: false }));

  M.aliveEnd = st.chickens.length;
  M.adultsEnd = st.chickens.filter((c) => c.growth >= R.CONFIG.stages.adult).length;
  M.hasPairEnd = st.chickens.some((c) => c.sex === "hen") && st.chickens.some((c) => c.sex === "rooster");
  M.extinct = st.chickens.length === 0 && !st.eggs.some((e) => e.fertile);
  M.deadEnd = M.deadEndAt != null;
  M.invEnd = { ...st.inventory };
  M.statsEnd = { ...st.stats };
  M.dexSize = M.dex.size;
  M.dex1 = R.dexStars(st, 1); // sổ sưu tầm thật (luật v5): số mục ★ / ★★, mốc Q13 đã đạt
  M.dex2 = R.dexStars(st, 2);
  M.milestones = st.milestones;
  M.coopEnd = st.coopCap;
  delete M.dex; // Set không gửi qua worker được
  return M;
}

/* ============================== MAIN: điều phối + tổng hợp ============================== */

function parseArgs(argv) {
  const a = { runs: 32, days: 7, scenarios: null, archetypes: Object.keys(ARCHETYPES), workers: availableParallelism(), json: null, set: [], list: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--runs") a.runs = +v();
    else if (k === "--days") a.days = +v();
    else if (k === "--scenarios") a.scenarios = v().split(",");
    else if (k === "--archetypes") a.archetypes = v().split(",");
    else if (k === "--workers") a.workers = +v();
    else if (k === "--json") a.json = v();
    else if (k === "--set") a.set.push(v());
    else if (k === "--list") a.list = true;
    else if (k === "--quiet") a.quiet = true;
    else if (k === "-h" || k === "--help") a.help = true;
    else throw new Error(`Tham số lạ: ${k}`);
  }
  return a;
}

function parseSets(sets) {
  const o = { config: {}, field: {}, sim: {} };
  for (const s of sets) {
    const [path, raw] = s.split("=");
    let val;
    try { val = JSON.parse(raw); } catch { val = raw; }
    const parts = path.split(".");
    let root = o.config;
    if (parts[0] === "field" || parts[0] === "sim") root = o[parts.shift()];
    let cur = root;
    for (const p of parts.slice(0, -1)) cur = cur[p] ??= {};
    cur[parts.at(-1)] = val;
  }
  return o;
}

function aggregate(runs, days) {
  const pick = (f) => runs.map(f);
  const q3 = (arr) => ({ p10: quantile(arr, 0.1), p50: quantile(arr, 0.5), p90: quantile(arr, 0.9) });
  const reached = (arr) => arr.filter((x) => x != null).length / arr.length;
  const inf = (x) => (x == null ? Infinity : x);
  const growth = runs.flatMap((r) => r.growthH);
  const seedKinds = Object.keys(runs[0].invEnd);
  const seedsByDay = Array.from({ length: days }, (_, d) =>
    Object.fromEntries(seedKinds.map((k) => [k, quantile(pick((r) => r.seedsByDay[d]?.[k] ?? 0), 0.5)])),
  );
  const seedTotalByDay = Array.from({ length: days }, (_, d) => q3(pick((r) => Object.values(r.seedsByDay[d] ?? {}).reduce((s, x) => s + x, 0))));
  const watchH = pick((r) => r.watchMs / HOUR);
  const fieldChH = pick((r) => r.fieldChickenMs / HOUR);
  const demandSeeds = pick((r) => (r.chickenMs / HOUR) * (globalThis.__drain ?? 45) / 12);
  return {
    n: runs.length,
    starterHenShare: runs.filter((r) => r.starterSex === "hen").length / runs.length,
    firstHatch: { ...q3(pick((r) => inf(r.firstHatch))), reached: reached(pick((r) => r.firstHatch)) },
    firstAdult: { ...q3(pick((r) => inf(r.firstAdult))), reached: reached(pick((r) => r.firstAdult)) },
    hatched: q3(pick((r) => r.hatched)),
    adultsByDay: Array.from({ length: days }, (_, d) => q3(pick((r) => r.adultsByDay[d] / Math.max(1, r.samplesByDay[d])))),
    aliveByDay: Array.from({ length: days }, (_, d) => q3(pick((r) => r.aliveByDay[d] / Math.max(1, r.samplesByDay[d])))),
    eggsPerDayFertile: q3(pick((r) => r.laidF.reduce((s, x) => s + x, 0) / days)),
    eggsPerDayInfertile: q3(pick((r) => r.laidI.reduce((s, x) => s + x, 0) / days)),
    deathsStarved: q3(pick((r) => r.deathsStarved)),
    deathsOld: q3(pick((r) => r.deathsOld)),
    deathsStarvedShare: (() => { const s = runs.reduce((a, r) => a + r.deathsStarved, 0), o = runs.reduce((a, r) => a + r.deathsOld, 0); return s + o ? s / (s + o) : null; })(),
    lifeShort: q3(runs.flatMap((r) => r.lifeShort)),
    ageAtDeathH: q3(runs.flatMap((r) => r.ageAtDeathH)),
    seedsByDay, seedTotalByDay,
    bagsOpened: q3(pick((r) => r.bagsOpened)),
    bagsReceived: q3(pick((r) => r.bagsReceived)),
    caps: Object.fromEntries(Object.keys(runs[0].cap).map((k) => [k, { mean: mean(pick((r) => r.cap[k])), runsHit: runs.filter((r) => r.cap[k] > 0).length / runs.length }])),
    deadEnd: runs.filter((r) => r.deadEnd).length / runs.length,
    deadEndAtH: q3(pick((r) => r.deadEndAt).filter((x) => x != null)),
    extinct: runs.filter((r) => r.extinct).length / runs.length,
    extinctAtH: q3(pick((r) => r.extinctAt).filter((x) => x != null)),
    hasPairEnd: runs.filter((r) => r.hasPairEnd).length / runs.length,
    aliveEnd: q3(pick((r) => r.aliveEnd)),
    henBelowLay: (() => { const s = runs.reduce((a, r) => a + r.henSamples, 0); return s ? runs.reduce((a, r) => a + r.henBelowLay, 0) / s : null; })(),
    starving: (() => { const s = runs.reduce((a, r) => a + r.chSamples, 0); return s ? runs.reduce((a, r) => a + r.chStarving, 0) / s : null; })(),
    adultDev: q3(runs.flatMap((r) => r.adultDev)),
    growthH: { ...q3(growth), n: growth.length, under2h: growth.filter((x) => x < 2).length / (growth.length || 1), over24h: growth.filter((x) => x > 24).length / (growth.length || 1) },
    watchHPerDay: q3(watchH.map((x) => x / days)),
    fieldChickenHPerDay: q3(fieldChH.map((x) => x / days)),
    foundPerWatchH: q3(pick((r) => (r.watchMs ? r.found / (r.watchMs / HOUR) : null))),
    foundPerDay: q3(pick((r) => r.found / days)),
    storedPerDay: q3(pick((r) => r.stored / days)),
    ateFieldPerDay: q3(pick((r) => r.ate / days)),
    demandSeedsPerDay: q3(demandSeeds.map((x) => x / days)),
    foodCoverage: q3(runs.map((r, i) => (demandSeeds[i] ? (r.found + r.seedsFromBags) / demandSeeds[i] : null))),
    tradeForEgg: q3(pick((r) => r.tradeForEgg)),
    tradeForEggRuns: runs.filter((r) => r.tradeForEgg > 0).length / runs.length,
    eggSwap: q3(pick((r) => r.eggSwap)),
    wildFertile: q3(pick((r) => r.wildFertile)),
    culled: q3(pick((r) => r.culled)),
    dexSize: q3(pick((r) => r.dexSize)),
    dex1: q3(pick((r) => r.dex1)),
    dex2: q3(pick((r) => r.dex2)),
    milestones: q3(pick((r) => r.milestones)),
    coopEnd: q3(pick((r) => r.coopEnd)),
    dexDay1: q3(pick((r) => r.dexByDay.slice(0, 1).reduce((m, x) => (x == null ? m : x), 0))),
    rareMax: q3(pick((r) => r.rareMax)),
    errors: runs.filter((r) => r.error).length,
  };
}

const f1 = (x, d = 1) => (x == null ? "—" : x === Infinity ? "∞" : Number.isInteger(x) && d === 1 ? String(x) : x.toFixed(d));
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const tri = (o, d = 1) => `${f1(o.p50, d)} [${f1(o.p10, d)}–${f1(o.p90, d)}]`;

function printTable(scName, label, byArch, days) {
  const rows = [
    ["Gà nở / 7 ngày (gồm trứng khởi đầu)", (a) => tri(a.hatched, 0)],
    ["Giờ tới lần nở đầu", (a) => `${tri(a.firstHatch, 2)} (${pct(a.firstHatch.reached)})`],
    ["Giờ tới gà trưởng thành đầu", (a) => `${tri(a.firstAdult)} (${pct(a.firstAdult.reached)})`],
    ["Thời gian lớn (giờ, mọi gà)", (a) => `${tri(a.growthH)} n=${a.growthH.n}`],
    ["Chất lượng nuôi lúc trưởng thành (dev 0–1)", (a) => tri(a.adultDev, 2)],
    ...[0, 2, Math.min(4, days - 1), days - 1].filter((v, i, s) => s.indexOf(v) === i).map((d) => [`Gà trưởng thành TB, ngày ${d + 1}`, (a) => tri(a.adultsByDay[d], 1)]),
    ["Gà sống cuối ngày 7", (a) => tri(a.aliveEnd, 0)],
    ["Trứng/ngày có phôi", (a) => tri(a.eggsPerDayFertile, 2)],
    ["Trứng/ngày không phôi", (a) => tri(a.eggsPerDayInfertile, 2)],
    ["Chết: đói / già (trung vị)", (a) => `${f1(a.deathsStarved.p50, 0)} / ${f1(a.deathsOld.p50, 0)} (đói ${pct(a.deathsStarvedShare)})`],
    ["Tuổi thọ bị mất do đói", (a) => tri({ p10: a.lifeShort.p10 * 100, p50: a.lifeShort.p50 * 100, p90: a.lifeShort.p90 * 100 }, 0) + "%"],
    ["% thời gian mái lớn < laySatiety", (a) => pct(a.henBelowLay)],
    ["% thời gian gà bụng rỗng", (a) => pct(a.starving)],
    ["Hạt trong kho cuối ngày 1 / 7", (a) => `${f1(a.seedTotalByDay[0].p50, 0)} / ${f1(a.seedTotalByDay[days - 1].p50, 0)}`],
    ["Túi nhận / mở", (a) => `${f1(a.bagsReceived.p50, 0)} / ${f1(a.bagsOpened.p50, 0)}`],
    ["Giờ có gà ngoài đồng / ngày", (a) => tri(a.watchHPerDay, 2)],
    ["Hạt nhận từ đồng / giờ có gà ra đồng", (a) => tri(a.foundPerWatchH, 0)],
    ["Nhu cầu ăn (hạt thường/ngày)", (a) => tri(a.demandSeedsPerDay, 0)],
    ["Cung (đồng + túi) / nhu cầu", (a) => tri(a.foodCoverage, 2)],
    ["Kho đầy: lần mổ bị từ chối (TB)", (a) => `${f1(a.caps.fieldSeedsLost.mean, 0)} (${pct(a.caps.fieldSeedsLost.runsHit)} ván)`],
    ["Kho trứng đầy (% mẫu, TB)", (a) => `${f1(a.caps.eggStoreFullSamples.mean, 0)} (${pct(a.caps.eggStoreFullSamples.runsHit)} ván)`],
    ["Sổ sưu tầm thử: mục đã gặp ngày 1 / ngày 7", (a) => `${f1(a.dexDay1.p50, 0)} / ${tri(a.dexSize, 0)}`],
    ["Độ hiếm cao nhất đã nở (rarityOf)", (a) => tri(a.rareMax, 0)],
    ["Gà đổi lấy chỗ (cullForSpace)", (a) => tri(a.culled, 0)],
    ["Sổ v5: mục ★ / ★★ (ngày cuối)", (a) => `${tri(a.dex1, 0)} / ${tri(a.dex2, 0)}`],
    ["Mốc sổ đạt (Q13) · chỗ chuồng cuối", (a) => `${tri(a.milestones, 0)} · ${tri(a.coopEnd, 0)}`],
    ["Chuồng đầy chặn ấp (lần TB)", (a) => `${f1(a.caps.coopFullBlocked.mean, 1)} (${pct(a.caps.coopFullBlocked.runsHit)} ván)`],
    ["tradeForEgg dùng (ván có dùng)", (a) => `${f1(a.tradeForEgg.p50, 0)} (${pct(a.tradeForEggRuns)})`],
    ["NGÕ CỤT trước hết ngày 7", (a) => pct(a.deadEnd)],
    ["  … từ lúc (giờ)", (a) => tri(a.deadEndAtH, 0)],
    ["Trại trống trơn cuối ngày 7 / lúc (giờ)", (a) => `${pct(a.extinct)} / ${tri(a.extinctAtH, 0)}`],
    ["Còn cặp trống+mái cuối ngày 7", (a) => pct(a.hasPairEnd)],
  ];
  const archs = Object.keys(byArch);
  console.log(`\n=== ${scName}: ${label} ===`);
  const w0 = 38;
  const ws = archs.map(() => 26);
  console.log("".padEnd(w0) + archs.map((a, i) => a.padEnd(ws[i])).join(""));
  for (const [name, fn] of rows) console.log(name.padEnd(w0) + archs.map((a, i) => fn(byArch[a]).padEnd(ws[i])).join(""));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.list) {
    console.log("Kiểu chơi:");
    for (const [k, v] of Object.entries(ARCHETYPES)) console.log(`  ${k.padEnd(10)} ${v.label}`);
    console.log("Kịch bản:");
    for (const [k, v] of Object.entries(SCENARIOS)) console.log(`  ${k.padEnd(22)} ${v.label}`);
    console.log("\nVí dụ: node tools/chicken-farm/balance-sim.mjs --scenarios hien-tai --runs 40 --set laySatiety=40");
    return;
  }
  const extra = parseSets(args.set);
  const scNames = args.scenarios ?? DEFAULT_SCENARIOS;
  const jobs = [];
  for (const sc of scNames) {
    const S = SCENARIOS[sc];
    if (!S) throw new Error(`Không có kịch bản ${sc}`);
    const config = structuredClone(S.config ?? {});
    deepApply(config, extra.config);
    for (const archetype of args.archetypes) {
      if (!ARCHETYPES[archetype]) throw new Error(`Không có kiểu chơi ${archetype}`);
      for (let run = 0; run < args.runs; run++) {
        jobs.push({ key: `${sc}|${archetype}|${run}`, sc, archetype, run, days: args.days, config, field: { ...(S.field ?? {}), ...extra.field }, sim: { ...(S.sim ?? {}), ...extra.sim } });
      }
    }
  }
  // việc nặng (cày) chạy trước để cân tải
  jobs.sort((a, b) => (b.archetype === "hardcore") - (a.archetype === "hardcore"));
  const t0 = performance.now();
  const results = new Map();
  let done = 0;
  await new Promise((resolve, reject) => {
    const n = Math.max(1, Math.min(args.workers, jobs.length));
    let next = 0, alive = n;
    for (let i = 0; i < n; i++) {
      const w = new Worker(SELF, { workerData: { worker: true } });
      const feedJob = () => {
        if (next < jobs.length) w.postMessage(jobs[next++]);
        else { w.postMessage("exit"); if (--alive === 0) resolve(); }
      };
      w.on("message", (m) => {
        if (m.ready) return feedJob();
        if (m.out.error) { reject(new Error(`${m.key}: ${m.out.error}`)); return; }
        results.set(m.key, m.out);
        done++;
        if (!args.quiet && done % 50 === 0) process.stderr.write(`\r${done}/${jobs.length} ván…`);
        feedJob();
      });
      w.on("error", reject);
    }
  });
  if (!args.quiet) process.stderr.write(`\r${jobs.length} ván xong trong ${((performance.now() - t0) / 1000).toFixed(1)} giây\n`);

  const out = {};
  for (const sc of scNames) {
    const S = SCENARIOS[sc];
    globalThis.__drain = (S.config?.satietyDrainPerHour ?? extra.config.satietyDrainPerHour) ?? 45;
    out[sc] = { label: S.label, config: S.config ?? {}, sim: S.sim ?? {}, archetypes: {} };
    for (const a of args.archetypes) {
      const runs = Array.from({ length: args.runs }, (_, i) => results.get(`${sc}|${a}|${i}`));
      out[sc].archetypes[a] = aggregate(runs, args.days);
    }
    printTable(sc, S.label, out[sc].archetypes, args.days);
  }
  if (args.json) writeFileSync(args.json, JSON.stringify({ args, results: out }, null, 1));
}

if (isMainThread) main().catch((e) => { console.error(e); process.exit(1); });
else if (workerData?.worker) workerMain();
