// Trại Gà — bộ gen.
// Mỗi gen có 2 alen: một bản từ bố, một bản từ mẹ. Gen "alen" có trội/lặn,
// gen "định lượng" là số 0..1, biểu hiện = trung bình 2 bản. Hàm express()
// biến bộ gen thành kiểu hình (màu, kích thước, hình dạng) để bộ vẽ dùng.
// File này không đụng tới DOM nên server sau này dùng lại được nguyên vẹn.

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/* ---------- số ngẫu nhiên có seed ---------- */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;
export function gaussian(rng) {
  let u = 0;
  while (!u) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
const pickWeighted = (rng, list) => {
  const total = list.reduce((s, x) => s + x.p, 0);
  let r = rng() * total;
  for (const x of list) if ((r -= x.p) <= 0) return x;
  return list[list.length - 1];
};

/* ---------- màu ---------- */

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
}
export function hsl(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  s = clamp(s);
  l = clamp(l);
  if (!s) return rgbToHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex([f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]);
}
export function mix(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * clamp(t)));
}
export const shade = (hex, t) => mix(hex, "#1b120c", t);
export const tint = (hex, t) => mix(hex, "#ffffff", t);
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function paletteAt(colors, t) {
  const x = clamp(t) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(x));
  return mix(colors[i], colors[i + 1], x - i);
}

/* ---------- định nghĩa gen ----------
   THỨ TỰ trong GENES là định dạng mã gen: chỉ được thêm gen mới vào CUỐI. */

const A = (id, name, dom, p) => ({ id, name, dom, p });
const allele = (key, label, group, parts, alleles, extra = {}) => ({ key, label, group, parts, kind: "allele", alleles, ...extra });
const quant = (key, label, group, parts, init, extra = {}) => ({ key, label, group, parts, kind: "quant", init, ...extra });
const uni = (lo, hi) => (rng) => lo + rng() * (hi - lo);
const FEATHERS = ["body", "wing", "hackle", "tail", "feet", "crest", "muff"];
const pct = (v) => `${Math.round(v * 100)}%`;
const times = (v) => `${v.toFixed(2)}×`;

export const GENES = [
  allele("sex", "Giới tính", "Cơ bản", ["comb", "wattle", "tail", "hackle", "saddle"], [A("Z", "Z", 0, 1), A("W", "W", 0, 1)], {
    show: (ph) => (ph.sex === "rooster" ? "Trống (ZZ)" : "Mái (ZW)"),
    locked: true,
  }),

  quant("baseHue", "Sắc màu chính", "Màu lông", FEATHERS, (r) => (r() < 0.08 ? r() : 0.03 + r() * 0.1), {
    show: (ph) => ({ swatch: ph.colors.base, text: "Màu thân" }),
  }),
  quant("baseSat", "Độ đậm sắc", "Màu lông", FEATHERS, uni(0.3, 0.85), { show: (ph) => ({ swatch: ph.colors.base, text: "" }) }),
  quant("baseLight", "Sáng / tối", "Màu lông", FEATHERS, (r) => {
    const x = r();
    return x < 0.3 ? 0.06 + r() * 0.14 : x < 0.65 ? 0.3 + r() * 0.3 : 0.68 + r() * 0.26;
  }, { show: (ph) => ({ swatch: ph.colors.base, text: "" }) }),
  quant("accentHue", "Sắc màu phụ", "Màu lông", ["tail", "hackle", "wing", "body"], (r) => (r() < 0.12 ? r() : 0.02 + r() * 0.1), {
    show: (ph) => ({ swatch: ph.colors.accent, text: "Đuôi, cổ, hoa văn" }),
  }),
  quant("accentSat", "Độ đậm màu phụ", "Màu lông", ["tail", "hackle", "wing", "body"], uni(0.2, 0.8), {
    show: (ph) => ({ swatch: ph.colors.accent, text: "" }),
  }),
  quant("accentLight", "Sáng / tối màu phụ", "Màu lông", ["tail", "hackle", "wing", "body"], uni(0.04, 0.45), {
    show: (ph) => ({ swatch: ph.colors.accent, text: "" }),
  }),
  quant("accentSpread", "Độ lan màu phụ", "Màu lông", ["tail", "hackle", "wing"], uni(0, 1), {
    show: (ph, v) => ({ swatch: ph.colors.tail, text: pct(v) }),
  }),

  allele("pattern", "Hoa văn", "Hoa văn & kiểu lông", ["body", "wing", "hackle", "tail"], [
    A("n", "trơn", 0, 0.72),
    A("m", "lốm đốm", 1, 0.07),
    A("S", "chấm giọt", 2, 0.07),
    A("L", "viền vảy", 3, 0.07),
    A("B", "sọc vằn", 4, 0.07),
  ], { show: (ph) => PATTERN_NAMES[ph.pattern] }),
  allele("dilute", "Pha loãng màu", "Hoa văn & kiểu lông", FEATHERS, [A("D", "D", 1, 0.15), A("d", "d", 0, 0.85)], {
    show: (ph) => ["Màu gốc", "Nhạt (lam)", "Rất nhạt (bắn tóe)"][ph.dilute],
  }),
  allele("fm", "Da đen", "Hoa văn & kiểu lông", ["comb", "face", "legs", "wattle", "earlobe"], [A("Fm", "Fm", 1, 0.12), A("fm", "fm", 0, 0.88)], {
    show: (ph) => (ph.darkSkin ? "Da, mào, chân sẫm" : "Bình thường"),
  }),
  allele("frizzle", "Lông xoăn", "Hoa văn & kiểu lông", ["body", "hackle"], [A("Fz", "Fz", 1, 0.08), A("fz", "fz", 0, 0.92)], {
    show: (ph) => ["Lông thẳng", "Xoăn", "Xoăn tít"][ph.shape.frizzle],
  }),
  allele("silkie", "Lông tơ", "Hoa văn & kiểu lông", ["body", "tail", "wing", "crest"], [A("H", "H", 1, 0.85), A("h", "h", 0, 0.15)], {
    show: (ph) => (ph.shape.silkie ? "Lông tơ bông (hh)" : "Lông thường"),
  }),

  allele("combR", "Mào – gen R", "Đầu", ["comb"], [A("R", "R", 1, 0.3), A("r", "r", 0, 0.7)], { show: (ph) => COMB_NAMES[ph.shape.combType] }),
  allele("combP", "Mào – gen P", "Đầu", ["comb"], [A("P", "P", 1, 0.25), A("p", "p", 0, 0.75)], { show: (ph) => COMB_NAMES[ph.shape.combType] }),
  quant("combSize", "Cỡ mào", "Đầu", ["comb"], uni(0.15, 0.9), { show: (ph) => times(ph.shape.combSize) }),
  allele("crest", "Chỏm lông", "Đầu", ["crest", "comb"], [A("Cr", "Cr", 1, 0.12), A("cr", "cr", 0, 0.88)], {
    show: (ph) => ["Không", "Chỏm nhỏ", "Chỏm bông to"][ph.shape.crest],
  }),
  allele("muff", "Râu & tóc mai", "Đầu", ["muff", "wattle"], [A("Mb", "Mb", 1, 0.12), A("mb", "mb", 0, 0.88)], {
    show: (ph) => (ph.shape.muff ? "Có râu" : "Không"),
  }),
  quant("wattleSize", "Cỡ yếm thịt", "Đầu", ["wattle"], uni(0.15, 0.9), { show: (ph) => times(ph.shape.wattle) }),
  allele("earlobe", "Dái tai", "Đầu", ["earlobe"], [A("W", "W", 1, 0.35), A("w", "w", 0, 0.65)], {
    show: (ph) => ({ swatch: ph.colors.earlobe, text: ph.colors.earlobe === ph.colors.comb ? "Đỏ" : ph.darkSkin ? "Xanh ngọc" : "Trắng" }),
  }),
  quant("beakLength", "Độ dài mỏ", "Đầu", ["beak"], uni(0.1, 0.9), { show: (ph) => times(ph.shape.beakLen) }),
  quant("beakCurve", "Độ cong mỏ", "Đầu", ["beak"], uni(0.1, 0.9), { show: (ph, v) => pct(v) }),
  quant("eyeHue", "Màu mắt", "Đầu", ["eye"], uni(0.25, 0.65), { show: (ph) => ({ swatch: ph.colors.eye, text: "" }) }),
  quant("eyeSize", "Cỡ mắt", "Đầu", ["eye"], uni(0.2, 0.8), { show: (ph) => times(ph.shape.eyeSize) }),

  quant("size", "Tầm vóc", "Thân & đuôi", ["body", "tail", "legs", "head", "hackle", "wing"], uni(0.15, 0.85), {
    show: (ph) => (ph.shape.size < 0.9 ? "Gà tre " : ph.shape.size > 1.05 ? "Gà to " : "Vừa ") + times(ph.shape.size),
  }),
  quant("bodyLength", "Độ dài thân", "Thân & đuôi", ["body", "wing"], uni(0.15, 0.85), { show: (ph) => times(ph.shape.bodyLength) }),
  quant("plump", "Độ tròn mình", "Thân & đuôi", ["body"], uni(0.15, 0.85), { show: (ph) => times(ph.shape.plump) }),
  quant("posture", "Dáng đứng", "Thân & đuôi", ["body", "hackle", "tail", "wing"], uni(0.1, 0.7), {
    show: (ph) => `Ngẩng ${Math.round(ph.shape.posture)}°`,
  }),
  quant("neckLength", "Độ dài cổ", "Thân & đuôi", ["hackle"], uni(0.15, 0.8), { show: (ph) => times(ph.shape.neck) }),
  quant("wingDroop", "Cánh xệ", "Thân & đuôi", ["wing"], uni(0, 0.6), { show: (ph, v) => pct(v) }),
  allele("tailType", "Kiểu đuôi", "Thân & đuôi", ["tail"], [A("Rp", "Rp", 2, 0.06), A("Gt", "Gt", 1, 0.08), A("t", "t", 0, 0.86)], {
    show: (ph) => ({ normal: "Bình thường", long: ph.shape.longTail > 1 ? "Đuôi rất dài" : "Đuôi dài", rumpless: "Cụt đuôi" })[ph.shape.tailType],
  }),
  quant("tailLength", "Độ dài đuôi", "Thân & đuôi", ["tail"], uni(0.15, 0.85), { show: (ph) => times(ph.shape.tailLen) }),
  quant("tailCount", "Số lông đuôi", "Thân & đuôi", ["tail"], uni(0.1, 0.9), { show: (ph) => `${ph.shape.tailCount} lông` }),
  quant("tailAngle", "Góc dựng đuôi", "Thân & đuôi", ["tail"], uni(0.2, 0.8), { show: (ph, v) => pct(v) }),
  quant("tailCurl", "Độ cong đuôi", "Thân & đuôi", ["tail"], uni(0.2, 0.8), { show: (ph, v) => pct(v) }),

  quant("legLength", "Độ dài chân", "Chân", ["legs", "feet"], uni(0.15, 0.85), { show: (ph) => times(ph.shape.legLen) }),
  allele("legColor", "Màu chân", "Chân", ["legs", "beak"], [A("W", "trắng", 3, 0.25), A("s", "xám chì", 2, 0.15), A("g", "xanh lá", 1, 0.15), A("y", "vàng", 0, 0.45)], {
    show: (ph) => ({ swatch: ph.colors.leg, text: ph.legName }),
  }),
  allele("feetFeather", "Lông chân", "Chân", ["feet"], [A("Pti", "Pti", 1, 0.12), A("pti", "pti", 0, 0.88)], {
    show: (ph) => ["Chân trần", "Lông thưa", "Lông dày"][ph.shape.feetFeather],
  }),
  allele("poly", "Số ngón", "Chân", ["feet"], [A("Po", "Po", 1, 0.06), A("po", "po", 0, 0.94)], { show: (ph) => `${ph.shape.toes} ngón` }),

  allele("eggBlue", "Vỏ trứng xanh", "Trứng (gà mái đẻ)", ["egg"], [A("O", "O", 1, 0.15), A("o", "o", 0, 0.85)], {
    show: (ph) => ({ swatch: ph.egg.shell, text: ph.egg.name }),
  }),
  quant("eggBrown", "Sắc nâu vỏ", "Trứng (gà mái đẻ)", ["egg"], uni(0, 0.9), { show: (ph) => ({ swatch: ph.egg.shell, text: "" }) }),
  quant("eggSpeckle", "Đốm vỏ", "Trứng (gà mái đẻ)", ["egg"], uni(0, 0.8), { show: (ph) => (ph.egg.speckle ? pct(ph.egg.speckle) : "Không") }),

  quant("growthRate", "Tốc độ lớn", "Chỉ số ẩn", [], uni(0.2, 0.8), { stat: true }),
  quant("appetite", "Sức ăn", "Chỉ số ẩn", [], uni(0.2, 0.8), { stat: true }),
  quant("eggRate", "Sai trứng", "Chỉ số ẩn", [], uni(0.2, 0.8), { stat: true }),
  quant("hardiness", "Sức đề kháng", "Chỉ số ẩn", [], uni(0.2, 0.8), { stat: true }),

  // gen thêm ở bản 2 (luôn thêm vào cuối để mã gen cũ vẫn đọc được)
  quant("featherSize", "Cỡ lông vảy", "Hoa văn & kiểu lông", ["body", "wing"], uni(0.2, 0.8), { show: (ph) => times(lerp(0.75, 1.3, ph.shape.featherSize)) }),
  quant("hackleStripe", "Sọc lông bờm", "Hoa văn & kiểu lông", ["hackle", "saddle"], (r) => (r() < 0.35 ? 0.5 + r() * 0.5 : r() * 0.3), {
    show: (ph) => (ph.shape.hackleStripe > 0.05 ? pct(ph.shape.hackleStripe) : "Không"),
  }),
  quant("saddleLength", "Lông yên (gà trống)", "Thân & đuôi", ["saddle"], uni(0.2, 0.8), { show: (ph) => times(lerp(0.7, 1.5, ph.shape.saddle)) }),

  // gen thêm ở bản 3
  quant("incubation", "Thời gian ấp", "Trứng (gà mái đẻ)", ["egg"], uni(0.1, 0.9), { show: (ph) => `${Math.round(ph.egg.incubateMin)} phút` }),

  // gen thêm ở bản 4
  quant("speed", "Tốc độ", "Chân", ["legs"], uni(0.15, 0.85), { show: (ph) => speedLabel(ph.stats.speed) }),
];

export function speedLabel(v) {
  const n = Math.round(1 + v * 9);
  return `${n}/10 · ${v < 0.33 ? "chậm rãi" : v < 0.66 ? "nhanh nhẹn" : "rất nhanh"}`;
}

// Độ dễ biến dị của từng gen (1 = bình thường). Màu lông dễ biến; các đặc điểm hiếm
// (lông tơ, 5 ngón, cụt đuôi, da đen…) khó biến hơn nhiều.
const MUTABILITY = {
  baseHue: 1.6, baseSat: 1.4, baseLight: 1.4, accentHue: 1.6, accentSat: 1.4, accentLight: 1.4, accentSpread: 1.4,
  pattern: 0.6, dilute: 0.5, fm: 0.3, frizzle: 0.3, silkie: 0.25, combR: 0.4, combP: 0.4, crest: 0.4, muff: 0.5,
  earlobe: 0.7, legColor: 0.6, tailType: 0.3, feetFeather: 0.4, poly: 0.25, eggBlue: 0.4, incubation: 1.2,
};
for (const g of GENES) g.mut = g.locked ? 0 : MUTABILITY[g.key] ?? 1;

export const GENE_MAP = Object.fromEntries(GENES.map((g) => [g.key, g]));
export const PATTERN_NAMES = { solid: "Trơn", mottled: "Lốm đốm trắng", spangled: "Chấm giọt", laced: "Viền vảy", barred: "Sọc vằn" };
export const COMB_NAMES = { single: "Mào cờ", rose: "Mào hoa hồng", pea: "Mào hạt đậu", walnut: "Mào quả óc chó" };

/* ---------- tạo, lai, biến dị ---------- */

function initAllele(gene, rng) {
  return gene.kind === "quant" ? clamp(gene.init(rng)) : pickWeighted(rng, gene.alleles).id;
}

export function randomGenome(rng = mulberry32(randomSeed()), { sex } = {}) {
  const g = {};
  for (const gene of GENES) g[gene.key] = [initAllele(gene, rng), initAllele(gene, rng)];
  const hen = sex ? sex === "hen" : rng() < 0.5;
  g.sex = hen ? ["Z", "W"] : ["Z", "Z"];
  return { v: 1, g };
}

function mutateAllele(gene, value, rng, rate, log, side) {
  if (gene.locked) return value;
  rate *= gene.mut ?? 1;
  if (gene.kind === "quant") {
    if (rng() < 0.0015 * rate) {
      const next = rng();
      log.push({ key: gene.key, side, big: true, from: value, to: next });
      return next;
    }
    // trôi nhẹ: con cái hơi khác bố mẹ, không tính là biến dị
    if (rng() < 0.05 * rate) return clamp(value + gaussian(rng) * 0.05);
    return value;
  }
  if (rng() < 0.002 * rate) {
    const others = gene.alleles.filter((a) => a.id !== value);
    const next = others[Math.floor(rng() * others.length)].id;
    log.push({ key: gene.key, side, big: true, from: value, to: next });
    return next;
  }
  return value;
}

// Bố truyền 1 trong 2 bản của mình, mẹ cũng vậy; mỗi bản có thể biến dị.
export function breed(father, mother, rng = mulberry32(randomSeed()), { mutationRate = 1 } = {}) {
  const g = {};
  const mutations = [];
  for (const gene of GENES) {
    const a = father.g[gene.key][rng() < 0.5 ? 0 : 1];
    const b = mother.g[gene.key][rng() < 0.5 ? 0 : 1];
    g[gene.key] = [mutateAllele(gene, a, rng, mutationRate, mutations, 0), mutateAllele(gene, b, rng, mutationRate, mutations, 1)];
  }
  return { genome: { v: 1, g }, mutations };
}

export function mutate(genome, rng = mulberry32(randomSeed()), rate = 8) {
  const g = {};
  const mutations = [];
  for (const gene of GENES) g[gene.key] = genome.g[gene.key].map((v, i) => mutateAllele(gene, v, rng, rate, mutations, i));
  return { genome: { v: 1, g }, mutations };
}

/* ---------- mã gen (chuỗi ngắn để lưu, chia sẻ, gửi qua mạng) ---------- */

export function encodeGenome(genome) {
  const bytes = [genome.v || 1];
  for (const gene of GENES) {
    for (const v of genome.g[gene.key]) {
      bytes.push(gene.kind === "quant" ? Math.round(clamp(v) * 255) : Math.max(0, gene.alleles.findIndex((a) => a.id === v)));
    }
  }
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeGenome(code) {
  const bin = atob(code.trim().replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = [...bin].map((c) => c.charCodeAt(0));
  if (bytes[0] !== 1) throw new Error("Mã gen không đúng phiên bản");
  const g = {};
  let i = 1;
  for (const gene of GENES) {
    const pair = [];
    for (let k = 0; k < 2; k++) {
      let b = bytes[i++];
      // mã gen cũ chưa có các gen mới thêm ở cuối: dùng giá trị mặc định
      if (b === undefined) b = gene.kind === "quant" ? 128 : gene.alleles.length - 1;
      if (gene.kind === "quant") pair.push(b / 255);
      else {
        const a = gene.alleles[b];
        if (!a) throw new Error("Mã gen hỏng");
        pair.push(a.id);
      }
    }
    g[gene.key] = pair;
  }
  return { v: 1, g };
}

/* ---------- biểu hiện: bộ gen + chăm sóc → kiểu hình ---------- */

const LEG_NAMES = { W: "Trắng", s: "Xám chì", g: "Xanh lá", y: "Vàng" };

export function express(genome, care = {}) {
  const g = genome.g;
  // Dinh dưỡng lúc lớn quyết định gen được biểu hiện tới đâu (gen = tiềm năng, dinh dưỡng = hiện thực):
  //   đạm → lông (đuôi, lông yên, độ bóng) · năng lượng → vóc dáng · khoáng → chân, mỏ · sắc tố → màu.
  const nutrition = care.nutrition ?? 0.7;
  const dev = care.dev ?? { protein: nutrition, energy: nutrition, mineral: nutrition, pigment: nutrition };
  const grow = (k) => 0.82 + 0.3 * clamp(dev[k] ?? 0.6); // 0.6 → 1.0
  const gloss = care.gloss ?? 0.35;
  const pig = clamp(dev.pigment ?? 0.6);
  const q = (k) => (g[k][0] + g[k][1]) / 2;
  const count = (k, id) => (g[k][0] === id) + (g[k][1] === id);
  const dominant = (k) => {
    const gene = GENE_MAP[k];
    const [a, b] = g[k].map((id) => gene.alleles.find((x) => x.id === id));
    return (a.dom >= b.dom ? a : b).id;
  };

  const sex = count("sex", "W") ? "hen" : "rooster";
  const rooster = sex === "rooster";

  const satK = 0.55 + 0.75 * pig; // sắc tố: 0.6 → 1.0
  const base = { h: q("baseHue") * 360, s: clamp(q("baseSat") * satK), l: q("baseLight") };
  const accent = { h: q("accentHue") * 360, s: clamp(q("accentSat") * satK), l: q("accentLight") };
  const dilute = count("dilute", "D");
  if (dilute) {
    for (const c of [base, accent]) {
      c.l += (1 - c.l) * (dilute === 2 ? 0.72 : 0.36);
      c.s *= dilute === 2 ? 0.35 : 0.6;
    }
  }
  const baseHex = hsl(base.h, base.s, base.l);
  const accentHex = hsl(accent.h, accent.s, accent.l);
  const spread = q("accentSpread");
  let hackle = mix(baseHex, accentHex, spread * 0.5);
  if (rooster) hackle = mix(hackle, hsl(base.h + 8, base.s + 0.25, Math.min(0.8, base.l + 0.15)), 0.45);
  const tail = mix(baseHex, accentHex, clamp(spread * 1.5));
  const wing = shade(mix(baseHex, accentHex, spread * 0.3), 0.08);

  const darkSkin = count("fm", "Fm") > 0;
  const comb = darkSkin ? hsl(318, 0.32, 0.25) : hsl(356, 0.5 + 0.38 * pig, 0.4 + 0.08 * pig);
  const legId = dominant("legColor");
  let leg = { W: hsl(36, 0.25, 0.86), s: hsl(215, 0.12, 0.47), g: hsl(88, 0.32, 0.43), y: hsl(44, 0.4 + 0.45 * pig, 0.56) }[legId];
  if (darkSkin) leg = mix(leg, "#2b2630", 0.65);
  let beak = mix(leg, "#c9a46a", 0.35);
  if (base.l < 0.22) beak = mix(beak, "#2a2420", 0.45);
  const eye = paletteAt(["#3a2318", "#8c4a1f", "#d97a22", "#c4361d", "#e2c24f"], q("eyeHue"));
  const earlobe = count("earlobe", "W") ? (darkSkin ? "#78b4cc" : "#f2efe8") : comb;
  const down = base.l > 0.33 ? tint(mix(baseHex, "#ffd95a", 0.32), 0.22) : mix(baseHex, "#5a5048", 0.22);

  const R = dominant("combR") === "R";
  const P = dominant("combP") === "P";
  const combType = R && P ? "walnut" : R ? "rose" : P ? "pea" : "single";
  const tailId = dominant("tailType");
  const tailType = tailId === "Rp" ? "rumpless" : tailId === "Gt" ? "long" : "normal";

  const blue = count("eggBlue", "O") > 0;
  const brown = q("eggBrown");
  const shell = mix(blue ? "#b5dccd" : "#f6f0e4", "#8d5530", brown * brown * 0.92);
  const eggName = blue ? (brown > 0.45 ? "Xanh ô liu" : "Xanh ngọc") : brown > 0.6 ? "Nâu sẫm" : brown > 0.3 ? "Nâu nhạt" : "Trắng ngà";

  let seed = 2166136261;
  for (const gene of GENES) for (const v of g[gene.key]) seed = Math.imul(seed ^ (typeof v === "number" ? Math.round(v * 255) : v.charCodeAt(0)), 16777619);

  return {
    sex,
    seed: seed >>> 0,
    pattern: { n: "solid", m: "mottled", S: "spangled", L: "laced", B: "barred" }[dominant("pattern")],
    dilute,
    darkSkin,
    legName: LEG_NAMES[legId],
    colors: { base: baseHex, accent: accentHex, hackle, tail, wing, down, comb, leg, beak, eye, earlobe },
    shape: {
      size: (0.78 + q("size") * 0.38) * lerp(1, grow("energy"), 0.6),
      bodyLength: 0.82 + q("bodyLength") * 0.38,
      plump: (0.85 + q("plump") * 0.35) * grow("energy"),
      posture: 6 + q("posture") * 34,
      neck: 0.6 + q("neckLength") * 0.8,
      wingDroop: q("wingDroop"),
      legLen: (0.65 + q("legLength") * 0.7) * grow("mineral"),
      tailType,
      longTail: tailType === "long" ? count("tailType", "Gt") : 0,
      tailLen: (0.55 + q("tailLength") * 0.8) * grow("protein"),
      tailCount: 4 + Math.round(q("tailCount") * 5),
      tailAngle: q("tailAngle"),
      tailCurl: q("tailCurl"),
      combType,
      combSize: 0.5 + q("combSize") * 0.9,
      crest: count("crest", "Cr"),
      muff: count("muff", "Mb") > 0,
      wattle: 0.4 + q("wattleSize") * 0.9,
      beakLen: (0.75 + q("beakLength") * 0.55) * grow("mineral"),
      beakCurve: q("beakCurve"),
      eyeSize: 0.8 + q("eyeSize") * 0.45,
      feetFeather: count("feetFeather", "Pti"),
      toes: count("poly", "Po") ? 5 : 4,
      frizzle: count("frizzle", "Fz"),
      silkie: count("silkie", "h") === 2,
      featherSize: q("featherSize"),
      hackleStripe: clamp((q("hackleStripe") - 0.35) / 0.65) * 0.75,
      saddle: clamp(q("saddleLength") * grow("protein")),
    },
    egg: { shell, name: eggName, speckle: clamp((q("eggSpeckle") - 0.5) * 2.2), seed: Math.floor(q("eggSpeckle") * 9973 + brown * 997), incubateMin: lerp(5, 30, q("incubation")) },
    stats: { growth: q("growthRate"), appetite: q("appetite"), eggRate: q("eggRate"), hardiness: q("hardiness"), speed: q("speed") },
    care: { nutrition, gloss, dev },
  };
}

/* ---------- tên ---------- */

const NAMES = ["Bông", "Mơ", "Na", "Cốm", "Xôi", "Mít", "Đậu", "Mận", "Gạo", "Bơ", "Tí", "Sữa", "Kem", "Mây", "Nắng", "Khoai", "Bắp", "Hạt Dẻ", "Tiêu", "Quýt", "Ổi", "Me", "Bí", "Su", "Lạc", "Vừng", "Chè", "Than", "Tuyết", "Gừng", "Nghệ", "Sấm", "Chớp", "Lửa", "Tướng", "Mỡ", "Bánh Bao", "Kẹo", "Ớt", "Măng"];
export const randomName = (rng = Math.random) => NAMES[Math.floor(rng() * NAMES.length)];
