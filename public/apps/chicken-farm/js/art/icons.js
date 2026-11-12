// Trại Gà — biểu tượng kiểu "Phẳng 1": hạt, chất dinh dưỡng, chỉ số, túi hạt, ổ ấp,
// nền bãi cỏ, nền sân trại (+ toạ độ các điểm trong sân), trứng nằm ổ rơm.
// Mảng màu phẳng, không viền, dáng vẽ tay (dùng chung khối blob/tongue/brushStroke với
// bộ vẽ gà). Mọi hàm trả về chuỗi SVG có viewBox, role="img" và aria-label tiếng Việt.
// Hình cố định theo loại (seed riêng từng loại) nên vẽ lại vẫn y hệt.
//
// Ngôn ngữ màu dinh dưỡng: đạm = đỏ cam ấm, năng lượng = vàng óng, khoáng = xanh xám/ngọc,
// sắc tố = tím hồng. Hạt quý = vàng kim lấp lánh, hạt lạ = xanh ánh cầu vồng có xoáy,
// hạt thường = be/nâu nhạt.

import { blob, tongue, brushStroke } from "../chicken-flat.js";
import { clamp, lerp, mix, shade, tint, mulberry32 } from "../genome.js";

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const f = (n) => Math.round(n * 10) / 10;
const f2 = (n) => Math.round(n * 100) / 100;
let uid = 0;
const nid = (p) => `${p}${(++uid).toString(36)}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const path = (d, c, extra = "") => `<path d="${d}" fill="${c}"${extra}/>`;
const svg = (vb, size, label, body, cls = "") =>
  `<svg${cls ? ` class="${cls}"` : ""} viewBox="${vb}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label)}">${body}</svg>`;

/* ---------- màu ---------- */

export const NUTRIENT_COLORS = {
  protein: "#e4572e", // đỏ cam ấm
  energy: "#f2b318", // vàng óng
  mineral: "#4a8f9c", // xanh xám ngả ngọc
  pigment: "#b23a9b", // tím hồng
};

const NUTRIENT_NAMES = { protein: "Đạm", energy: "Năng lượng", mineral: "Khoáng", pigment: "Sắc tố" };
const SEED_NAMES = {
  common: "Hạt thường", protein: "Hạt đạm", energy: "Hạt mẩy", mineral: "Hạt khoáng",
  pigment: "Hạt màu", premium: "Hạt quý", odd: "Hạt lạ",
};
// màu chính / màu bóng / màu sẫm cho từng loại hạt
const SEED_COLORS = {
  common: { c: "#d8b98a", hi: "#f1dfbd", lo: "#b38f5c" },
  protein: { c: NUTRIENT_COLORS.protein, hi: "#f7a27e", lo: "#a83a1c" },
  energy: { c: NUTRIENT_COLORS.energy, hi: "#ffe28a", lo: "#c4860c" },
  mineral: { c: NUTRIENT_COLORS.mineral, hi: "#a9d3d6", lo: "#2f5f6b" },
  pigment: { c: NUTRIENT_COLORS.pigment, hi: "#ec93d7", lo: "#6f1f63" },
  premium: { c: "#e8b72c", hi: "#fff1a8", lo: "#a77712" },
  odd: { c: "#3fb07a", hi: "#9ff0c8", lo: "#25705a" },
};
export const SEED_KINDS = Object.keys(SEED_COLORS);
const kindOf = (k) => (SEED_COLORS[k] ? k : "common");

// ngôi sao lấp lánh 4 cánh (lõm vào giữa)
function sparkle(c, R, col, extra = "") {
  const k = R * 0.22;
  const [x, y] = c;
  const d = `M${f(x)},${f(y - R)}Q${f(x + k)},${f(y - k)} ${f(x + R)},${f(y)}Q${f(x + k)},${f(y + k)} ${f(x)},${f(y + R)}Q${f(x - k)},${f(y + k)} ${f(x - R)},${f(y)}Q${f(x - k)},${f(y - k)} ${f(x)},${f(y - R)}Z`;
  return path(d, col, extra);
}

// một hạt hình giọt (hạt hướng dương / hạt lúa): gốc tròn, đầu thuôn nhọn, mép hơi méo
function teardrop(rng, c, len, w, deg, sharp = 0.45) {
  const cs = Math.cos(deg * RAD), sn = Math.sin(deg * RAD);
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * TAU;
    const x = -Math.cos(t) * len * 0.5, y = Math.sin(t) * w * ((1 + Math.cos(t)) / 2) ** sharp * (1 + (rng() - 0.5) * 0.08);
    pts.push([c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]);
  }
  return smoothPts(pts);
}
// p = c + (dọc trục u, ngang v) theo hướng deg
const along = (c, deg, u, v) => [c[0] + Math.cos(deg * RAD) * u - Math.sin(deg * RAD) * v, c[1] + Math.sin(deg * RAD) * u + Math.cos(deg * RAD) * v];

function grain(rng, c, len, w, deg, col, { hi, lo, stripes = 0 } = {}) {
  let out = path(teardrop(rng, c, len, w, deg), col);
  if (lo) out += path(teardrop(rng, along(c, deg, 0.4, w * 0.32), len * 0.9, w * 0.62, deg), lo, ` opacity=".4"`);
  for (let i = 0; i < stripes; i++) {
    const v = (i - (stripes - 1) / 2) * w * 0.55;
    out += path(brushStroke(rng, [along(c, deg, -len * 0.36, v), along(c, deg, -len * 0.05, v * 0.85), along(c, deg, len * 0.3, v * 0.4)], w * 0.13), lo ?? shade(col, 0.4), ` opacity=".75"`);
  }
  if (hi) out += path(brushStroke(rng, [along(c, deg, -len * 0.3, -w * 0.42), along(c, deg, -len * 0.05, -w * 0.45), along(c, deg, len * 0.18, -w * 0.3)], w * 0.2), hi, ` opacity=".85"`);
  return out;
}

/* ---------- hạt (biểu tượng 24×24) ---------- */

function seedBody(kind, rng) {
  const P = SEED_COLORS[kind];
  switch (kind) {
    case "protein": {
      // hạt đậu: hình quả thận, có rốn hạt
      const pts = [[4, 13], [5.5, 7.5], [10, 5], [15, 5.5], [19.5, 8], [20.5, 12.5], [18.5, 17], [13.5, 18.5], [10.5, 15.5], [7, 18.5], [4.5, 17]];
      let o = path(smoothPts(pts.map(([x, y]) => [x + (rng() - 0.5) * 0.6, y + (rng() - 0.5) * 0.6])), P.c);
      o += path(blob(rng, [10.6, 15.4], 1.5, 0.9, -20, 0.1, 7), P.lo, ` opacity=".7"`);
      o += path(brushStroke(rng, [[7, 9.5], [10.5, 7.4], [15.5, 7.4]], 1.1), P.hi, ` opacity=".85"`);
      return o;
    }
    case "energy": {
      // hạt bắp mẩy: đầu tròn to, thuôn về chân
      const pts = [[12, 3.5], [16.8, 5], [19, 9.5], [17.5, 15], [14.5, 19.8], [12, 21], [9.5, 19.8], [6.5, 15], [5, 9.5], [7.2, 5]];
      let o = path(smoothPts(pts.map(([x, y]) => [x + (rng() - 0.5) * 0.6, y + (rng() - 0.5) * 0.6])), P.c);
      o += path(blob(rng, [12, 16.5], 2.6, 3.4, 0, 0.1, 8), P.lo, ` opacity=".45"`);
      o += path(blob(rng, [12, 8.5], 4.6, 3, 0, 0.08, 9), P.hi, ` opacity=".7"`);
      return o;
    }
    case "mineral":
      // hạt bí/hướng dương sọc: giọt dẹt, sọc dọc
      return grain(rng, [12, 12.5], 17, 5.6, -62, P.c, { hi: P.hi, lo: P.lo, stripes: 3 });
    case "pigment": {
      // hạt tròn bóng như quả mọng, hai tông
      let o = path(blob(rng, [12, 12.6], 7.6, 7.2, 0, 0.05, 10), P.c);
      o += path(blob(rng, [13.6, 15], 5.2, 4.2, 25, 0.08, 9), P.lo, ` opacity=".45"`);
      o += path(blob(rng, [9.4, 9.4], 2.4, 1.6, -35, 0.1, 8), P.hi, ` opacity=".9"`);
      o += path(blob(rng, [12, 4.8], 1.4, 1.1, 0, 0.1, 7), "#5b8a3a");
      return o;
    }
    case "premium": {
      // hạt vàng kim + ánh sao
      let o = grain(rng, [11, 13.5], 16, 5.8, -58, P.c, { hi: P.hi, lo: P.lo });
      o += sparkle([18.2, 6], 4.2, "#fff6c9");
      o += sparkle([5, 6.5], 2, "#fff6c9", ` opacity=".85"`);
      return o;
    }
    case "odd": {
      // hạt lạ: ánh cầu vồng (gradient) + vòng xoáy
      const g = nid("io");
      let o = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7ee0b0"/><stop offset=".45" stop-color="${P.c}"/><stop offset=".75" stop-color="#3a8fb0"/><stop offset="1" stop-color="#8c5ac8"/></linearGradient></defs>`;
      o += path(blob(rng, [12, 12.5], 8, 7, -30, 0.07, 10), `url(#${g})`);
      o += path(swirl([12.4, 12.4], 5.2, 1.15), "#eafff4", ` opacity=".9"`);
      o += path(blob(rng, [8.4, 8], 1.6, 1, -40, 0.1, 7), "#fff", ` opacity=".7"`);
      return o;
    }
    default: {
      // hạt thường: ba hạt kê/lúa màu be
      let o = grain(rng, [8.5, 13.5], 11, 3.6, -100, P.c, { hi: P.hi, lo: P.lo });
      o += grain(rng, [15.5, 12], 11.5, 3.7, -60, mix(P.c, P.lo, 0.25), { hi: P.hi, lo: P.lo });
      o += grain(rng, [12.5, 17.5], 10, 3.4, 10, tint(P.c, 0.1), { hi: P.hi, lo: P.lo });
      return o;
    }
  }
}

// đường cong khép kín qua các điểm (Catmull-Rom → Bézier)
function smoothPts(pts) {
  const n = pts.length;
  const p2s = (p) => `${f(p[0])},${f(p[1])}`;
  let d = `M${p2s(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${p2s([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${p2s([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${p2s(p2)}`;
  }
  return d + "Z";
}

// vòng xoáy (dải thuôn theo đường xoắn ốc)
function swirl(c, R, w) {
  const L = [], Rr = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = -90 * RAD + t * 1.6 * TAU, r = R * (0.12 + 0.88 * t);
    const p = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    const hw = w * Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.5 + 0.08;
    const nx = Math.cos(a), ny = Math.sin(a);
    L.push([p[0] + nx * hw, p[1] + ny * hw]);
    Rr.push([p[0] - nx * hw, p[1] - ny * hw]);
  }
  const all = [...L, ...Rr.reverse()];
  return `M${all.map((p) => `${f(p[0])},${f(p[1])}`).join("L")}Z`;
}

const SEED_RNG = { common: 11, protein: 23, energy: 37, mineral: 41, pigment: 53, premium: 67, odd: 79 };

export function seedIcon(kind, size = 24, label) {
  const k = kindOf(kind);
  const body = seedBody(k, mulberry32(SEED_RNG[k]));
  return svg("0 0 24 24", size, label ?? SEED_NAMES[k], body, `seed-icon seed-${k}`);
}

/* ---------- chất dinh dưỡng (20×20) ---------- */

export function nutrientIcon(key, size = 20, label) {
  const k = NUTRIENT_COLORS[key] ? key : "protein";
  const c = NUTRIENT_COLORS[k];
  const rng = mulberry32(101 + Object.keys(NUTRIENT_COLORS).indexOf(k) * 17);
  let o = "";
  if (k === "protein") {
    // lông vũ (đạm nuôi lông)
    o += path(tongue(rng, [4.5, 17], -58, 15, 3.6, { tip: "round", bend: 0.12, base: 0.55, irr: 0.08 }).d, c);
    o += path(tongue(rng, [9.5, 9.5], -150, 3.6, 1.3, { tip: "point", base: 1 }).d, "#fff", ` opacity=".35"`);
    o += path(tongue(rng, [12.2, 6.8], -150, 3, 1.1, { tip: "point", base: 1 }).d, "#fff", ` opacity=".35"`);
    o += path(brushStroke(rng, [[3.5, 18.5], [8, 11], [12.5, 5.5], [14.5, 3.4]], 0.9), shade(c, 0.4));
  } else if (k === "energy") {
    // tia chớp mập
    o += path("M11.6,1.8C9.4,5.6 7.2,8.6 4.6,11.2C4,11.8 4.3,12.5 5.2,12.5L9,12.4C8.4,14.6 7.6,16.4 6.6,18.4C6.2,19.2 7,19.6 7.7,19C10.8,16.2 13.4,12.9 15.6,9.3C16,8.6 15.6,8 14.8,8.1L11.4,8.3C12.3,6.4 13,4.6 13.4,2.6C13.6,1.6 12.2,1 11.6,1.8Z", c);
    o += path(brushStroke(rng, [[11.4, 3.6], [9.6, 6.6], [7.2, 9.8]], 0.9), "#fff6c4", ` opacity=".8"`);
  } else if (k === "mineral") {
    // viên đá khoáng nhiều mặt
    o += path("M10,2.2L16.6,6.4C17.2,6.8 17.4,7.4 17.2,8.1L15.4,15.4C15.2,16.1 14.7,16.6 14,16.8L7.4,18.2C6.7,18.3 6.1,18 5.8,17.4L2.9,11.3C2.6,10.7 2.7,10 3.2,9.5L8.6,2.4C9,2 9.5,1.9 10,2.2Z", c);
    o += path("M10,2.6L8.6,9.6L3.2,10.2L8.6,2.6Z", tint(c, 0.45), ` opacity=".85"`);
    o += path("M8.6,9.6L16.8,7.4L15.2,15.6L8.6,9.6Z", shade(c, 0.28), ` opacity=".7"`);
    o += path(blob(rng, [7.2, 6.2], 1.1, 0.7, -40, 0.1, 7), "#fff", ` opacity=".7"`);
  } else {
    // giọt màu
    o += path("M10,1.8C11.6,5.2 16.3,9.4 16.3,13C16.3,16.6 13.5,18.8 10,18.8C6.5,18.8 3.7,16.6 3.7,13C3.7,9.4 8.4,5.2 10,1.8Z", c);
    o += path(blob(rng, [12.6, 14.6], 3.2, 2.4, -30, 0.1, 8), shade(c, 0.3), ` opacity=".45"`);
    o += path(brushStroke(rng, [[6.4, 14.6], [6.8, 11.4], [8.6, 8.6]], 1), "#fff", ` opacity=".7"`);
  }
  return svg("0 0 20 20", size, label ?? NUTRIENT_NAMES[k], o, `nutrient-icon nutrient-${k}`);
}

/* ---------- túi hạt (40×40) ---------- */

export function bagIcon(size = 40, seedsCount) {
  const rng = mulberry32(211);
  const cloth = "#d4ac72", dark = "#a97f45", light = "#ecd2a2";
  let o = `<ellipse cx="20" cy="37" rx="12" ry="1.8" fill="#000" opacity=".1"/>`;
  // thân túi
  o += path(smoothPts([[13, 14.5], [8.5, 20], [7, 27.5], [9, 34], [15, 36.6], [25, 36.6], [31, 34], [33, 27.5], [31.5, 20], [27, 14.5], [20, 13.2]]), cloth);
  o += path(blob(rng, [24.5, 29], 6, 5, 10, 0.12, 9), dark, ` opacity=".28"`);
  o += path(brushStroke(rng, [[11.5, 22], [10.8, 27], [12, 32]], 1.3), light, ` opacity=".8"`);
  // miệng túi bung loe trên dây buộc
  for (const [x, deg, len] of [[14.6, -118, 7], [18.4, -98, 8.4], [21.8, -82, 8], [25.2, -64, 6.8]]) {
    o += path(tongue(rng, [x, 13.4], deg, len, 2.5, { tip: "round", base: 0.85, bend: (rng() - 0.5) * 0.3 }).d, x < 20 ? light : cloth);
  }
  // hạt ló ra miệng túi
  o += path(blob(rng, [18.6, 7.4], 1.6, 1.2, -20, 0.1, 7), SEED_COLORS.energy.c);
  o += path(blob(rng, [21.6, 6.8], 1.5, 1.1, 30, 0.1, 7), SEED_COLORS.common.lo);
  // dây buộc
  o += path(brushStroke(rng, [[13, 14.2], [20, 15.8], [27.2, 14.2]], 1.6), "#7d5a2e");
  o += path(tongue(rng, [21, 15.2], 70, 5.5, 1.1, { tip: "round", base: 1, bend: 0.2 }).d, "#7d5a2e");
  o += path(tongue(rng, [21, 15.2], 115, 4.6, 1.1, { tip: "round", base: 1, bend: -0.2 }).d, "#7d5a2e");
  let label = "Túi hạt";
  if (seedsCount != null && Number.isFinite(+seedsCount)) {
    const n = Math.max(0, Math.round(+seedsCount));
    const txt = n > 99 ? "99+" : String(n);
    const w = 5 + txt.length * 4.2;
    o += `<rect x="${f(38 - w)}" y="25" width="${f(w)}" height="11" rx="5.5" fill="#3d2a17"/>`;
    o += `<text x="${f(38 - w / 2)}" y="33.4" text-anchor="middle" font-size="8.4" font-weight="700" font-family="system-ui,sans-serif" fill="#fff">${txt}</text>`;
    label = `Túi hạt: ${n} hạt`;
  }
  return svg("0 0 40 40", size, label, o, "bag-icon");
}

/* ---------- ổ ấp (96×96) ---------- */

export function incubatorIcon({ egg = null, progress = 0 } = {}, size = 96) {
  const rng = mulberry32(307);
  const p = clamp(Number.isFinite(+progress) ? +progress : 0);
  const straw = "#d9ac57", strawD = "#a87a2e", strawL = "#f0d38c";
  const g = nid("ig");
  let o = `<defs><radialGradient id="${g}"><stop offset="0" stop-color="#ffb85c" stop-opacity="${f2(0.15 + 0.45 * p)}"/><stop offset="1" stop-color="#ffb85c" stop-opacity="0"/></radialGradient></defs>`;
  // quầng ấm (đậm dần theo tiến độ)
  if (egg) o += `<circle cx="48" cy="52" r="${f(30 + 8 * p)}" fill="url(#${g})"/>`;
  // vòng tiến độ: rãnh mờ + cung ấm, bắt đầu từ đỉnh, chạy theo chiều kim đồng hồ
  const R = 43, Cc = 2 * Math.PI * R;
  o += `<circle cx="48" cy="48" r="${R}" fill="none" stroke="#c9a15a" stroke-opacity=".18" stroke-width="3"/>`;
  if (egg && p > 0) o += `<circle cx="48" cy="48" r="${R}" fill="none" stroke="#f08a2c" stroke-width="3" stroke-linecap="round" stroke-dasharray="${f(Cc * p)} ${f(Cc)}" transform="rotate(-90 48 48)" opacity=".85"/>`;
  o += `<ellipse cx="48" cy="82" rx="30" ry="4" fill="#000" opacity=".1"/>`;
  // lòng ổ phía sau
  o += path(blob(rng, [48, 63], 30, 11, 0, 0.05, 11), strawD);
  // trứng
  if (egg) {
    const shell = /^#[0-9a-f]{6}$/i.test(egg) ? egg : "#f6f0e4";
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const t = (i / 14) * TAU, sy = Math.sin(t);
      pts.push([48 + 15 * Math.cos(t) * (1 + 0.1 * sy), 46 + 19 * sy]);
    }
    o += `<g class="incubator-egg${p >= 1 ? " is-ready" : ""}">`;
    o += path(smoothPts(pts), shell);
    o += path(blob(rng, [53, 52], 8, 10, 10, 0.06, 9), shade(shell, 0.25), ` opacity=".3"`);
    o += path(brushStroke(rng, [[39.5, 43], [41, 36], [45.5, 31.5]], 1.6), "#fff", ` opacity=".55"`);
    o += `</g>`;
  }
  // vành ổ rơm phía trước: nhiều nét cọ cong đan nhau
  o += path(blob(rng, [48, 70], 33, 10, 0, 0.06, 11), straw);
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const x0 = lerp(17, 66, t) + (rng() - 0.5) * 4, y0 = 66 + (rng() - 0.5) * 8 + Math.sin(t * Math.PI) * 4;
    const dir = i % 2 ? 1 : -1, len = 12 + rng() * 8;
    const pts = [[x0, y0], [x0 + dir * len * 0.5, y0 + 2 + rng() * 2], [x0 + dir * len, y0 + (rng() - 0.3) * 5]];
    o += path(brushStroke(rng, pts, 1 + rng() * 0.7), i % 3 ? strawL : strawD, i % 3 ? ` opacity=".9"` : ` opacity=".6"`);
  }
  for (const [x, deg] of [[16, 200], [80, -20], [24, 235], [73, -55]]) {
    o += path(tongue(rng, [x, 66], deg, 7 + rng() * 4, 1, { tip: "point", bend: (rng() - 0.5) * 0.4 }).d, strawL);
  }
  const label = egg ? `Ổ ấp: trứng đang ấp, ${Math.round(p * 100)}%` : "Ổ ấp trống";
  return svg("0 0 96 96", size, label, o, `incubator-icon${egg ? " has-egg" : ""}`);
}

/* ---------- nền bãi cỏ ---------- */

export function fieldBackdrop(width = 360, height = 240, seed = 1) {
  const W = Math.max(1, +width || 360), H = Math.max(1, +height || 240);
  const rng = mulberry32((seed >>> 0) + 9001);
  const ground = "#a6d36f", dark = "#7fb552", darker = "#5f9a3e", light = "#c3e38c";
  const k = Math.sqrt((W * H) / (360 * 240)); // số chi tiết theo diện tích
  const S = Math.min(W, H) / 240; // cỡ chi tiết
  let o = `<rect width="${f(W)}" height="${f(H)}" fill="${ground}"/>`;
  // mảng cỏ sáng/tối lớn
  for (let i = 0; i < Math.round(4 * k) + 2; i++) {
    const c = [rng() * W, rng() * H];
    o += path(blob(rng, c, (40 + rng() * 50) * S, (18 + rng() * 22) * S, (rng() - 0.5) * 30, 0.14, 10), i % 2 ? light : dark, ` opacity=".45"`);
  }
  // lối mòn mềm chạy ngang
  const y0 = H * (0.35 + rng() * 0.3), amp = H * 0.12;
  const pathPts = [];
  for (let i = 0; i <= 6; i++) pathPts.push([(i / 6) * (W + 40) - 20, y0 + Math.sin(i * 1.1 + rng() * 0.8) * amp]);
  o += path(brushStroke(rng, pathPts, 16 * S), "#e3d39b", ` opacity=".55"`);
  o += path(brushStroke(rng, pathPts.map(([x, y]) => [x, y + 2 * S]), 9 * S), "#ecdfad", ` opacity=".5"`);
  // bụi cỏ
  const tufts = Math.round(14 * k) + 4;
  for (let i = 0; i < tufts; i++) {
    const c = [rng() * W, rng() * H], s = (0.7 + rng() * 0.6) * S, col = rng() < 0.6 ? dark : darker;
    let blades = "";
    const n = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < n; j++) {
      const deg = -90 + (j - (n - 1) / 2) * 22 + (rng() - 0.5) * 10;
      blades += tongue(rng, [c[0] + (j - (n - 1) / 2) * 2 * s, c[1]], deg, (9 + rng() * 7) * s, 1.6 * s, { tip: "point", bend: (rng() - 0.5) * 0.5, base: 0.9 }).d;
    }
    o += path(blades, col);
  }
  // hoa nhỏ
  const flowers = Math.round(7 * k) + 2;
  const petals = ["#fff8ec", "#ffd7e6", "#fff1a6", "#e6dcff"];
  for (let i = 0; i < flowers; i++) {
    const c = [rng() * W, rng() * H], s = (0.8 + rng() * 0.5) * S, col = petals[Math.floor(rng() * petals.length)];
    let pd = "";
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * 360 + rng() * 10;
      pd += blob(rng, [c[0] + Math.cos(a * RAD) * 2.6 * s, c[1] + Math.sin(a * RAD) * 2.6 * s], 2.1 * s, 1.6 * s, a, 0.1, 7);
    }
    o += path(pd, col) + path(blob(rng, c, 1.4 * s, 1.4 * s, 0, 0.1, 7), "#f2b318");
  }
  return `<svg class="field-backdrop" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W)}" height="${f(H)}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bãi cỏ">${o}</svg>`;
}

/* ---------- hạt rải trên bãi (≈8px, khung 12×12, tâm hạt ở giữa) ---------- */

let glintN = 0;
export function fieldSeedSvg(kind) {
  const k = kindOf(kind);
  const P = SEED_COLORS[k];
  const rng = mulberry32(SEED_RNG[k] + 500);
  const rare = k !== "common";
  let o = `<ellipse cx="0" cy="3.2" rx="3.4" ry=".9" fill="#000" opacity=".15"/>`;
  if (k === "odd") {
    o += path(blob(rng, [0, 0], 3.5, 3, -30, 0.06, 8), P.c);
    o += path(blob(rng, [1, 0.8], 2.4, 1.8, 20, 0.08, 7), "#8c5ac8", ` opacity=".6"`);
    o += path(swirl([0.2, 0.1], 2.2, 0.6), "#eafff4");
  } else if (k === "pigment") {
    o += path(blob(rng, [0, 0], 3.3, 3.1, 0, 0.05, 8), P.c);
  } else if (k === "protein") {
    o += path(blob(rng, [0, 0], 3.8, 2.7, -12, 0.06, 8), P.c);
  } else {
    o += path(teardrop(rng, [0, 0], 7.6, 2.9, -25), P.c);
  }
  o += path(blob(rng, [-1.1, -0.9], 1.1, 0.6, -30, 0.1, 6), P.hi, ` opacity=".9"`);
  if (rare) {
    // ánh lấp lánh nhấp nháy (lệch nhịp giữa các hạt)
    const big = k === "premium" || k === "odd";
    const begin = f2(((glintN++ * 0.61) % 2.4));
    o += `<g opacity="0">${sparkle([2.6, -2.6], big ? 3 : 2.3, big ? "#fffbe0" : "#ffffff")}<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;.15;.35;1" dur="${big ? 1.8 : 2.6}s" begin="${begin}s" repeatCount="indefinite"/></g>`;
  }
  return svg("-6 -6 12 12", 12, SEED_NAMES[k], o, `field-seed seed-${k}${rare ? " is-rare" : ""}`);
}

/* ---------- chỉ số gà (20×20) ---------- */

export const STAT_COLORS = {
  speed: "#3f8fd2", // xanh trời
  life: "#8a63c9", // tím oải hương (đồng hồ cát)
  satiety: "#c98a3e", // nâu bát gỗ
  growth: "#4f9e3a", // xanh mầm
  lay: "#e9a23b", // vàng trứng
};
const STAT_NAMES = { speed: "Tốc độ", life: "Tuổi thọ", satiety: "Độ no", growth: "Tăng trưởng", lay: "Đẻ trứng" };
const STAT_RNG = { speed: 401, life: 419, satiety: 433, growth: 449, lay: 461 };

export function statIcon(key, size = 20, label) {
  const k = STAT_COLORS[key] ? key : "growth";
  const c = STAT_COLORS[k];
  const rng = mulberry32(STAT_RNG[k]);
  let o = "";
  if (k === "speed") {
    // bàn chân gà đang chạy + vệt gió phía sau
    // dấu chân gà ba ngón chúi về trước
    const heel = [11.8, 15];
    let toes = "";
    for (const [deg, len] of [[-100, 7], [-62, 8.6], [-24, 7]]) toes += tongue(rng, heel, deg, len, 1.45, { tip: "round", base: 0.95, irr: 0.06 }).d;
    toes += tongue(rng, heel, 120, 3.2, 1.3, { tip: "round", base: 0.95 }).d;
    o += path(toes, c);
    o += path(blob(rng, heel, 2.3, 2, 0, 0.08, 8), shade(c, 0.2));
    o += path(brushStroke(rng, [[1.6, 7.2], [4.2, 7], [6.8, 7.4]], 0.85), tint(c, 0.25));
    o += path(brushStroke(rng, [[0.8, 11], [3.8, 10.8], [6.6, 11.2]], 0.95), tint(c, 0.1));
    o += path(brushStroke(rng, [[2.2, 14.8], [4.6, 14.7], [7, 15]], 0.8), tint(c, 0.35));
  } else if (k === "life") {
    // đồng hồ cát: hai bầu kính, cát chảy xuống
    const glass = "#e9e2f6";
    o += path(smoothPts([[5.6, 3.6], [14.4, 3.6], [13.6, 7.2], [10.9, 9.6], [10.9, 10.4], [13.6, 12.8], [14.4, 16.4], [5.6, 16.4], [6.4, 12.8], [9.1, 10.4], [9.1, 9.6], [6.4, 7.2]]), glass);
    o += path(smoothPts([[7.4, 6.6], [12.6, 6.6], [11.2, 8.4], [10, 9.3], [8.8, 8.4]]), "#e8b65a");
    o += path(smoothPts([[6.6, 15.6], [7.6, 13.4], [10, 12.2], [12.4, 13.4], [13.4, 15.6]]), "#e8b65a");
    o += path(brushStroke(rng, [[10, 9.4], [10, 11], [10, 12.6]], 0.35), "#d49a3a");
    o += path(brushStroke(rng, [[6.9, 4.8], [7.4, 6.4], [8.4, 7.8]], 0.55), "#fff", ` opacity=".8"`);
    // hai nắp gỗ
    o += path(smoothPts([[3.6, 1.8], [16.4, 1.8], [16.8, 3.2], [16.2, 4.2], [3.8, 4.2], [3.2, 3.2]]), c);
    o += path(smoothPts([[3.6, 15.8], [16.4, 15.8], [16.8, 17.2], [16.2, 18.2], [3.8, 18.2], [3.2, 17.2]]), shade(c, 0.15));
  } else if (k === "satiety") {
    // bát gỗ đầy hạt
    o += path(blob(rng, [10, 10.4], 7.4, 3, 0, 0.06, 10), "#f0c64a");
    let grains = "";
    for (const [x, y, d] of [[6.4, 9.2, -30], [9, 8, 20], [11.8, 8.6, -50], [14, 9.8, 15], [8.6, 10.6, 70], [12, 10.8, -10]]) grains += teardrop(rng, [x, y], 3, 1.5, d);
    o += path(grains, "#d9a12a");
    o += path(smoothPts([[2, 10.6], [18, 10.6], [17, 13.4], [14.6, 16.2], [10, 17.4], [5.4, 16.2], [3, 13.4]]), c);
    o += path(brushStroke(rng, [[4.2, 12.6], [6.4, 15], [9.6, 16]], 0.7), tint(c, 0.35), ` opacity=".9"`);
    o += path(blob(rng, [10, 18.2], 4, 0.9, 0, 0.1, 8), shade(c, 0.3));
  } else if (k === "growth") {
    // mầm cây hai lá nhú khỏi mô đất
    o += path(blob(rng, [10, 16.4], 7.2, 2.6, 0, 0.08, 10), "#a77a4a");
    o += path(brushStroke(rng, [[10.2, 16], [9.8, 12], [10.4, 7.6]], 0.95), shade(c, 0.2));
    o += path(tongue(rng, [10.2, 9.4], -158, 6.6, 2.6, { tip: "point", bend: 0.25, base: 0.6 }).d, c);
    o += path(tongue(rng, [10.4, 8.2], -26, 7.4, 2.9, { tip: "point", bend: -0.25, base: 0.6 }).d, tint(c, 0.12));
    o += path(brushStroke(rng, [[11.6, 7], [14, 5.4], [16, 4.8]], 0.4), "#fff", ` opacity=".5"`);
  } else {
    // quả trứng
    o += path(smoothPts([[10, 2.4], [13.8, 5.2], [15.4, 10.6], [14, 15.6], [10, 17.8], [6, 15.6], [4.6, 10.6], [6.2, 5.2]]), "#f3dcae");
    o += path(blob(rng, [11.6, 13], 3.6, 3.8, 15, 0.08, 8), c, ` opacity=".35"`);
    o += path(brushStroke(rng, [[6.6, 10], [7, 7], [8.6, 4.8]], 0.9), "#fff", ` opacity=".8"`);
  }
  return svg("0 0 20 20", size, label ?? STAT_NAMES[k], o, `stat-icon stat-${k}`);
}

/* ---------- nền sân trại (thế giới 800×480) ---------- */

// Điểm trong sân (toạ độ thế giới 800×480, đúng với yardBackdrop(800, 480); kích thước
// khác thì nhân x với W/800, y với H/480). r = bán kính vùng thả khi kéo-thả / chạm.
export const YARD_SPOTS = Object.freeze({
  coop: Object.freeze({ x: 108, y: 82, r: 74 }), // cả ngôi chuồng (chạm → kho)
  coopDoor: Object.freeze({ x: 112, y: 146, r: 40 }), // trước chân cầu thang cửa chuồng
  feeder: Object.freeze({ x: 300, y: 138, r: 52 }), // trước máng thóc
  water: Object.freeze({ x: 452, y: 136, r: 40 }), // cạnh đĩa nước
  nest: Object.freeze({ x: 700, y: 104, r: 70 }), // giữa ổ rơm (trứng / ổ ấp đặt ở đây)
  gate: Object.freeze({ x: 762, y: 208, r: 50 }), // cổng ra đồng ở hàng rào phải
  market: Object.freeze({ x: 114, y: 414, r: 58 }), // quầy chợ góc dưới trái
});

// tấm gỗ: chữ nhật bo góc, mép hơi xô lệch
function plank(rng, x0, y0, x1, y1, j = 0.6) {
  const r = Math.min(x1 - x0, y1 - y0) * 0.22;
  const J = () => (rng() - 0.5) * j * 2;
  return smoothPts([[x0 + r, y0 + J()], [(x0 + x1) / 2, y0 + J()], [x1 - r, y0 + J()], [x1 + J(), y0 + r], [x1 + J(), y1 - r], [x1 - r, y1 + J()], [x0 + r, y1 + J()], [x0 + J(), y1 - r], [x0 + J(), y0 + r]]);
}

export function yardBackdrop(width = 800, height = 480, seed = 1) {
  const W = Math.max(1, +width || 800), H = Math.max(1, +height || 480);
  const rng = mulberry32((seed >>> 0) + 7777);
  const sx = W / 800, sy = H / 480, S = Math.min(sx, sy);
  const P = (x, y) => [x * sx, y * sy];
  const ground = "#a6d36f", dark = "#7fb552", darker = "#5f9a3e", light = "#c3e38c";
  const earth = "#e3d39b", earthD = "#cdb57a", earthL = "#ecdfad";
  const wood = "#b98652", woodD = "#8d5f33", woodL = "#d7a970", hole = "#3d2a17";
  const roof = "#c4643f", roofD = "#9a4630", roofL = "#de8a5c";
  const straw = "#d9ac57", strawD = "#a87a2e", strawL = "#f0d38c";
  // công trình vẽ trong khung 800×480: điểm neo (ax, ay) về đúng chỗ đã co giãn, hình co đều theo S
  const T = (body, ax, ay) => (sx === 1 && sy === 1 ? body
    : `<g transform="translate(${f2(ax * (sx - S))} ${f2(ay * (sy - S))}) scale(${f2(S)})">${body}</g>`);
  let o = `<rect width="${f(W)}" height="${f(H)}" fill="${ground}"/>`;

  // mảng cỏ sáng/tối dọc mép (giữa sân để yên)
  const edge = () => (rng() < 0.5 ? [rng() * 800, 150 + rng() * 330] : [rng() < 0.5 ? rng() * 90 : 710 + rng() * 90, 120 + rng() * 360]);
  for (let i = 0; i < 6; i++) {
    const c = i < 2 ? [rng() * 800, 430 + rng() * 60] : edge();
    o += path(blob(rng, P(...c), (50 + rng() * 60) * S, (18 + rng() * 20) * S, (rng() - 0.5) * 30, 0.14, 10), i % 2 ? light : dark, ` opacity=".45"`);
  }
  // nền đất nện giữa sân + vệt sáng, vệt sẫm
  o += path(blob(rng, P(400, 288), 350 * sx, 150 * sy, (rng() - 0.5) * 4, 0.1, 13), earth, ` opacity=".62"`);
  o += path(blob(rng, P(380 + rng() * 40, 300), 230 * sx, 92 * sy, (rng() - 0.5) * 8, 0.12, 12), earthL, ` opacity=".5"`);
  o += path(blob(rng, P(250 + rng() * 300, 380 + rng() * 20), 70 * sx, 18 * sy, (rng() - 0.5) * 10, 0.16, 9), earthD, ` opacity=".22"`);
  // đất mòn trước chuồng, máng, đĩa nước, ổ
  o += path(
    blob(rng, P(112, 150), 70 * S, 22 * S, -4, 0.14, 10) + blob(rng, P(300, 140), 74 * S, 20 * S, 3, 0.14, 10)
    + blob(rng, P(452, 138), 50 * S, 16 * S, 0, 0.14, 9) + blob(rng, P(700, 132), 86 * S, 20 * S, -3, 0.14, 10),
    earth, ` opacity=".75"`);

  // dải cây bụi sau hàng rào
  let hedge = "", hedgeD = "";
  for (let x = -20; x < 830; x += 46 + rng() * 18) {
    hedge += blob(rng, P(x, 14 + rng() * 10), (34 + rng() * 14) * S, (22 + rng() * 8) * S, 0, 0.12, 9);
    if (rng() < 0.6) hedgeD += blob(rng, P(x + 18, 4 + rng() * 6), (22 + rng() * 10) * S, (14 + rng() * 6) * S, 0, 0.12, 8);
  }
  o += path(hedgeD, darker) + path(hedge, dark);

  // hàng rào gỗ thấp dọc mép trên
  o += path(blob(rng, P(400, 86), 420 * sx, 7 * sy, 0, 0.05, 12), "#000", ` opacity=".08"`);
  let posts = "", postsL = "";
  for (let i = 0, x = 8 + rng() * 10; x < 800; i++, x += 62 + rng() * 10) {
    const w = 11 + rng() * 3, top = 26 + rng() * 6;
    posts += smoothPts([[x, 86], [x - w / 2, 84], [x - w / 2 - 0.4, top + 6], [x - w * 0.2, top + 0.5], [x + w * 0.2, top], [x + w / 2, top + 6], [x + w / 2 + 0.4, 84]].map((p) => P(...p)));
    postsL += brushStroke(rng, [P(x - w * 0.2, top + 8), P(x - w * 0.24, top + 26), P(x - w * 0.18, 78)], 1.2 * S);
  }
  for (const y of [42, 64]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push(P(i * 102 - 8, y + (rng() - 0.5) * 3));
    const up = pts.map(([x, yy]) => [x, yy - 4.4 * sy]), dn = pts.map(([x, yy]) => [x, yy + 4.4 * sy]).reverse();
    o += path(smoothPts([...up, ...dn]), y === 42 ? wood : shade(wood, 0.08));
    o += path(brushStroke(rng, pts.map(([x, yy]) => [x, yy - 2 * sy]), 1 * S), woodL, ` opacity=".7"`);
  }
  o += path(posts, woodD) + path(postsL, wood, ` opacity=".8"`);

  // chuồng gà (góc trên trái): tường ván, mái đỏ, cửa tối hình vòm, cầu thang ván
  let coop = "";
  coop += path(blob(rng, [108, 132], 84, 12, 0, 0.06, 10), "#000", ` opacity=".12"`);
  coop += path(plank(rng, 36, 52, 182, 132), wood);
  let seams = "";
  for (let x = 54; x < 176; x += 18) seams += brushStroke(rng, [[x + (rng() - 0.5) * 2, 60], [x, 96], [x + (rng() - 0.5) * 2, 128]], 0.9);
  coop += path(seams, woodD, ` opacity=".55"`);
  // đầu hồi (tam giác tường dưới mái)
  coop += path("M38,64L106,22Q109,20 112,22L180,62L180,72L38,72Z", shade(wood, 0.07));
  coop += path(smoothPts([[22, 66], [26, 56], [104, 11], [112, 10], [190, 54], [194, 64], [180, 68], [108, 24], [36, 70]]), roofD);
  coop += path(smoothPts([[24, 60], [104, 9], [112, 8], [192, 58], [186, 64], [108, 21], [30, 66]]), roof);
  let shingles = "";
  for (let i = 0; i < 4; i++) {
    const t = 0.22 + i * 0.2;
    shingles += brushStroke(rng, [[lerp(108, 34, t), lerp(14, 62, t)], [lerp(108, 60, t), lerp(14, 44, t) - 1]], 1.1);
    shingles += brushStroke(rng, [[lerp(108, 182, t), lerp(14, 56, t)], [lerp(108, 156, t), lerp(14, 40, t) - 1]], 1.1);
  }
  coop += path(shingles, roofL, ` opacity=".75"`);
  // cửa sổ tròn nhỏ dưới đầu hồi
  coop += path(blob(rng, [109, 43], 7, 6.6, 0, 0.06, 9), woodD) + path(blob(rng, [109, 43.5], 4.8, 4.5, 0, 0.06, 9), hole);
  // cửa: vòm tối + khung + tấm cửa mở ra
  coop += path(smoothPts([[90, 129], [89, 100], [94, 86], [109, 80], [124, 86], [129, 100], [128, 129]]), woodD);
  coop += path(smoothPts([[94, 128], [93.4, 101], [97.6, 90], [109, 85], [120.4, 90], [124.6, 101], [124, 128]]), hole);
  coop += path(smoothPts([[129.5, 128], [129, 102], [133, 92], [139, 89], [141, 128]]), woodL);
  coop += path(blob(rng, [100, 110], 4, 10, 0, 0.1, 8), "#000", ` opacity=".25"`);
  // cầu thang ván + nẹp
  coop += path("M94.5,126.5Q109,125.6 123.5,126.5L128.6,149Q109,151 91.4,149Z", shade(wood, 0.05));
  coop += path(brushStroke(rng, [[94, 134], [109, 134.6], [125.5, 134]], 1) + brushStroke(rng, [[93, 142], [109, 142.6], [126.6, 142]], 1), woodD, ` opacity=".8"`);
  o += T(coop, 112, 146);

  // máng thóc (gỗ, chân chữ A) — điểm ăn ở trước máng
  let fd = "";
  fd += path(blob(rng, [300, 128], 64, 8, 0, 0.06, 10), "#000", ` opacity=".12"`);
  fd += path(plank(rng, 252, 112, 260, 132, 0.3) + plank(rng, 340, 112, 348, 132, 0.3), woodD);
  // lòng máng (mép sau) + đống thóc vun cao hơn miệng máng
  fd += path(smoothPts([[248, 101], [300, 97], [352, 101], [352, 106], [248, 106]]), woodD);
  fd += path(blob(rng, [300, 100], 48, 9, 0, 0.12, 11), "#e7b84a");
  fd += path(blob(rng, [292, 96.5], 26, 4.5, -2, 0.14, 9), "#f4d27a", ` opacity=".85"`);
  let gr = "";
  for (let i = 0; i < 16; i++) gr += teardrop(rng, [260 + i * 5.2 + (rng() - 0.5) * 3, 97.5 + (rng() - 0.5) * 6], 3.4, 1.6, rng() * 180);
  fd += path(gr, SEED_COLORS.common.lo);
  // thành trước (hình thang) + hai tấm đầu máng cao hơn
  fd += path("M247,103.4Q300,105.2 353,103.4Q352.6,114 349.6,122.4Q300,124.4 250.4,122.4Q247.4,114 247,103.4Z", wood);
  fd += path(brushStroke(rng, [[252, 108], [300, 108.8], [348, 108]], 1.2), woodL, ` opacity=".8"`);
  fd += path(brushStroke(rng, [[254, 116], [300, 116.6], [346, 116]], 0.9), woodD, ` opacity=".5"`);
  fd += path(plank(rng, 238, 95, 249, 125, 0.4) + plank(rng, 351, 95, 362, 125, 0.4), shade(wood, 0.12));
  // thóc vương vãi
  let spill = "";
  for (let i = 0; i < 14; i++) spill += teardrop(rng, [266 + rng() * 76, 128 + rng() * 18], 3, 1.4, rng() * 180);
  fd += path(spill, SEED_COLORS.common.c);
  o += T(fd, 300, 138);

  // đĩa nước nông
  let wt = "";
  wt += path(blob(rng, [452, 126], 40, 8, 0, 0.06, 10), "#000", ` opacity=".12"`);
  wt += path(blob(rng, [452, 122], 36, 13, 0, 0.04, 12), "#7f9598");
  wt += path(blob(rng, [452, 118], 36, 12, 0, 0.04, 12), "#a9bcbe");
  wt += path(blob(rng, [452, 118.6], 30, 9, 0, 0.04, 12), "#6fbcd4");
  wt += path(blob(rng, [458, 121], 18, 4.5, 4, 0.1, 9), "#4f9fbe", ` opacity=".55"`);
  wt += path(brushStroke(rng, [[432, 116], [442, 113.6], [452, 113.4]], 1.4), "#e2f6fa", ` opacity=".85"`);
  wt += path(blob(rng, [416, 128], 8, 2.4, 0, 0.2, 7) + blob(rng, [490, 129], 6, 2, 0, 0.2, 7), "#4f9fbe", ` opacity=".25"`);
  o += T(wt, 452, 136);

  // góc ổ rơm (trên phải): vách ván + mái hiên, lớp rơm dày, cọng rơm vương
  let ns = "";
  // mái hiên trên hai cột, vách ván thấp phía sau
  ns += path("M640,52.5Q710,45.5 778,42L778,96Q709,97.5 640,96Z", shade(wood, 0.1));
  let nseam = "";
  for (let x = 658; x < 776; x += 20) nseam += brushStroke(rng, [[x, 50 - (x - 640) * 0.07], [x + (rng() - 0.5) * 2, 72], [x, 94]], 0.9);
  ns += path(nseam, woodD, ` opacity=".5"`);
  ns += path(plank(rng, 632, 30, 643, 104, 0.4) + plank(rng, 773, 22, 784, 100, 0.4), woodD);
  ns += path(smoothPts([[620, 40], [626, 30], [794, 16], [800, 26], [700, 36]]), roofD);
  ns += path(smoothPts([[621, 34], [627, 25], [796, 10], [799, 20], [700, 30]]), roof);
  ns += path(brushStroke(rng, [[640, 29], [710, 21.6], [784, 15]], 1.1), roofL, ` opacity=".75"`);
  ns += path(blob(rng, [708, 124], 92, 12, 0, 0.06, 10), "#000", ` opacity=".1"`);
  ns += path(blob(rng, [708, 104], 88, 26, -1, 0.07, 12), strawD);
  ns += path(blob(rng, [708, 100], 80, 22, 1, 0.08, 12), straw);
  ns += path(blob(rng, [710, 102], 50, 11, 0, 0.1, 10), strawD, ` opacity=".45"`);
  let sl = "", sd = "";
  for (let i = 0; i < 18; i++) {
    const t = i / 17, x0 = lerp(630, 784, t) + (rng() - 0.5) * 8;
    const y0 = 96 + Math.sin(t * Math.PI) * 18 + (rng() - 0.5) * 10;
    const dir = i % 2 ? 1 : -1, len = 12 + rng() * 12;
    const s = brushStroke(rng, [[x0, y0], [x0 + dir * len * 0.5, y0 + 2 + rng() * 2], [x0 + dir * len, y0 + (rng() - 0.3) * 6]], 1 + rng() * 0.7);
    if (i % 3) sl += s; else sd += s;
  }
  for (let i = 0; i < 9; i++) {
    const c = [620 + rng() * 170, 128 + rng() * 22], deg = rng() * 360, len = 8 + rng() * 10;
    sl += brushStroke(rng, [c, along(c, deg, len * 0.5, (rng() - 0.5) * 2), along(c, deg, len, 0)], 0.8);
  }
  ns += path(sd, strawD, ` opacity=".7"`) + path(sl, strawL, ` opacity=".9"`);
  o += T(ns, 708, 104);

  // bụi cỏ quanh mép và chân rào (giữa sân thưa)
  let tufts = "", tuftsD = "";
  const spots = [];
  for (let i = 0; i < 6; i++) spots.push([200 + rng() * 400, 92 + rng() * 6]); // chân rào giữa
  for (let i = 0; i < 10; i++) spots.push(i % 2 ? [rng() < 0.5 ? 10 + rng() * 60 : 740 + rng() * 50, 170 + rng() * 290] : [rng() * 800, 440 + rng() * 34]);
  for (let i = 0; i < 3; i++) spots.push([140 + rng() * 520, 200 + rng() * 210]); // vài bụi lẻ giữa sân
  for (const [x, y] of spots) {
    const c = P(x, y), s = (0.8 + rng() * 0.6) * S;
    let blades = "";
    const n = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < n; j++) {
      const deg = -90 + (j - (n - 1) / 2) * 22 + (rng() - 0.5) * 10;
      blades += tongue(rng, [c[0] + (j - (n - 1) / 2) * 2 * s, c[1]], deg, (9 + rng() * 7) * s, 1.6 * s, { tip: "point", bend: (rng() - 0.5) * 0.5, base: 0.9 }).d;
    }
    if (rng() < 0.6) tufts += blades; else tuftsD += blades;
  }
  o += path(tuftsD, darker) + path(tufts, dark);
  // sỏi nhỏ
  let peb = "";
  for (let i = 0; i < 7; i++) peb += blob(rng, P(60 + rng() * 680, 170 + rng() * 290), (1.6 + rng() * 2) * S, (1.2 + rng() * 1.2) * S, rng() * 180, 0.15, 7);
  o += path(peb, "#c9bfa6", ` opacity=".8"`);
  // hàng rào bên phải (từ góc ổ xuống đáy) + cổng ra đồng
  const fx = 782;
  // đồng cỏ xanh bên ngoài cổng + lối đất mòn dẫn ra
  let gt = path(blob(rng, [806, 206], 30, 70, 0, 0.1, 10), light) + path(blob(rng, [810, 200], 18, 46, 0, 0.12, 9), "#b8e07e");
  gt += path(brushStroke(rng, [[690, 214], [730, 210], [768, 207], [806, 204]], 15), earth, ` opacity=".75"`);
  gt += path(brushStroke(rng, [[704, 216], [744, 211], [804, 206]], 7), earthL, ` opacity=".6"`);
  const sidePosts = [118, 150, 262, 304, 348, 392, 436, 480];
  let rp = "", rl = "", rrail = "";
  for (const y of sidePosts) {
    const tall = y === 150 || y === 262;
    const h = tall ? 62 : 40, w = tall ? 13 : 11;
    rp += plank(rng, fx - w / 2, y - h, fx + w / 2, y + 2, 0.5);
    rl += brushStroke(rng, [[fx - w * 0.2, y - h + 6], [fx - w * 0.22, y - h / 2], [fx - w * 0.18, y - 4]], 1.2);
  }
  // thanh ngang dọc hàng rào (bỏ khoảng cổng)
  for (const [a, b] of [[96, 150], [262, 482]]) for (const dy of [28, 12]) {
    rrail += smoothPts([[fx - 3.4, a - dy], [fx + 3.4, a - dy], [fx + 3.4, b - dy], [fx - 3.4, b - dy]]);
  }
  gt += path(blob(rng, [fx + 2, 300], 8, 190, 0, 0.05, 10), "#000", ` opacity=".07"`);
  gt += path(rrail, shade(wood, 0.05)) + path(rp, woodD) + path(rl, wood, ` opacity=".8"`);
  // cánh cổng mở toang vào trong sân (bản lề ở cột dưới): nhìn chính diện, khung ván + thanh chéo
  gt += path(blob(rng, [758, 264], 26, 4, 0, 0.08, 8), "#000", ` opacity=".12"`);
  gt += path(plank(rng, 736, 226, 780, 233, 0.3) + plank(rng, 736, 247, 780, 254, 0.3), wood);
  gt += path(brushStroke(rng, [[741, 252], [758, 241], [776, 229]], 2), shade(wood, 0.1));
  gt += path(plank(rng, 734, 220, 742, 264, 0.3) + plank(rng, 773, 220, 781, 264, 0.3), woodD);
  // ngưỡng cổng sáng (đồng cỏ phía ngoài lộ qua khe)
  gt += path(blob(rng, [794, 206], 12, 46, 0, 0.08, 9), "#cdeb98");
  // biển gỗ đóng trên cánh cổng: mầm cỏ = "ra đồng"
  gt += path(plank(rng, 749, 206, 769, 224, 0.4), woodL);
  gt += path(plank(rng, 757, 222, 761, 228, 0.2), woodD);
  gt += path(tongue(rng, [759, 222], -122, 8, 2.6, { tip: "point", bend: 0.2, base: 0.6 }).d + tongue(rng, [759, 222], -62, 9, 2.8, { tip: "point", bend: -0.2, base: 0.6 }).d, "#4f9e3a");
  o += T(gt, 762, 208);

  // quầy chợ có mái bạt sọc (góc dưới trái)
  let mk = "";
  mk += path(blob(rng, [116, 452], 66, 9, 0, 0.06, 10), "#000", ` opacity=".14"`);
  mk += path(plank(rng, 62, 372, 70, 450, 0.3) + plank(rng, 160, 372, 168, 450, 0.3), woodD);
  // hàng trên quầy: giỏ trứng + bao hạt
  mk += path(blob(rng, [92, 404], 16, 6, 0, 0.08, 9), strawD);
  mk += path(blob(rng, [86, 398], 6, 7.4, -8, 0.05, 9) + blob(rng, [98, 397], 5.6, 7, 10, 0.05, 9), "#f6eedf");
  mk += path(blob(rng, [92, 400], 5.4, 6.8, 0, 0.05, 9), "#e9c7a0");
  mk += path(blob(rng, [92, 409], 17, 5, 0, 0.08, 9), straw);
  mk += path(smoothPts([[124, 410], [122, 396], [128, 386], [136, 384], [144, 386], [150, 396], [148, 410]]), "#d4ac72");
  mk += path(blob(rng, [136, 385], 7, 2.6, 0, 0.1, 8), SEED_COLORS.energy.c);
  mk += path(brushStroke(rng, [[127, 392], [126, 400], [128, 407]], 1), "#ecd2a2", ` opacity=".8"`);
  // mặt quầy + thân quầy
  mk += path(plank(rng, 56, 408, 174, 418, 0.4), woodL);
  mk += path(plank(rng, 62, 416, 168, 446, 0.6), wood);
  mk += path(brushStroke(rng, [[68, 426], [115, 427], [162, 426]], 1) + brushStroke(rng, [[68, 437], [115, 438], [162, 437]], 1), woodD, ` opacity=".55"`);
  // mái bạt sọc đỏ–kem, mép lượn sóng
  const aw0 = 50, aw1 = 180, ay = 360, n = 6, sw = (aw1 - aw0) / n;
  mk += path(`M${aw0 + 6},${ay - 14}L${aw1 - 6},${ay - 14}L${aw1 + 2},${ay + 8}L${aw0 - 2},${ay + 8}Z`, "#f4ead6");
  let red = "";
  for (let i = 0; i < n; i += 2) {
    const a = aw0 + i * sw, b = a + sw, ta = lerp(aw0 + 6, aw1 - 6, i / n), tb = lerp(aw0 + 6, aw1 - 6, (i + 1) / n);
    red += `M${f(ta)},${ay - 14}L${f(tb)},${ay - 14}L${f(b)},${ay + 8}L${f(a)},${ay + 8}Z`;
  }
  mk += path(red, "#d9503c");
  let sc = "", scR = "";
  for (let i = 0; i < n; i++) {
    const cx = aw0 + (i + 0.5) * sw;
    const d = `M${f(cx - sw / 2)},${ay + 7}Q${f(cx)},${ay + 19} ${f(cx + sw / 2)},${ay + 7}Z`;
    if (i % 2) sc += d; else scR += d;
  }
  mk += path(scR, "#d9503c") + path(sc, "#f4ead6");
  mk += path(brushStroke(rng, [[aw0 + 10, ay - 11], [115, ay - 12], [aw1 - 10, ay - 11]], 1.2), "#fff", ` opacity=".45"`);
  o += T(mk, 114, 414);

  // hoa nhỏ ven rào và hai góc dưới
  const petals = ["#fff8ec", "#ffd7e6", "#fff1a6", "#e6dcff"];
  const fl = [[210 + rng() * 30, 96], [540 + rng() * 40, 98], [600 + rng() * 20, 92], [24 + rng() * 30, 210 + rng() * 60], [742 + rng() * 20, 330 + rng() * 80], [200 + rng() * 60, 452], [650 + rng() * 60, 452]];
  for (const [x, y] of fl) {
    const c = P(x, y + (rng() - 0.5) * 6), s = (0.8 + rng() * 0.5) * S, col = petals[Math.floor(rng() * petals.length)];
    let pd = "";
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * 360 + rng() * 10;
      pd += blob(rng, [c[0] + Math.cos(a * RAD) * 2.6 * s, c[1] + Math.sin(a * RAD) * 2.6 * s], 2.1 * s, 1.6 * s, a, 0.1, 7);
    }
    o += path(pd, col) + path(blob(rng, c, 1.4 * s, 1.4 * s, 0, 0.1, 7), "#f2b318");
  }
  return `<svg class="yard-backdrop" viewBox="0 0 ${f(W)} ${f(H)}" width="${f(W)}" height="${f(H)}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sân trại gà">${o}</svg>`;
}

/* ---------- trứng nằm trên ổ rơm / bãi cỏ (khung 40×32, đáy ở y≈26) ---------- */

// size = bề rộng px (cao = 0.8 × size); bed "straw" (mặc định) | "grass"
export function nestEggSvg(shellHex, size = 40, bed = "straw") {
  const shell = /^#[0-9a-f]{6}$/i.test(shellHex ?? "") ? shellHex : "#f6f0e4";
  const rng = mulberry32(523 + (parseInt(shell.slice(1), 16) % 997));
  const grass = bed === "grass";
  const [straw, strawD, strawL] = grass ? ["#8cc45e", "#6aa646", "#b3dc84"] : ["#d9ac57", "#a87a2e", "#f0d38c"];
  let o = `<ellipse cx="20" cy="28.6" rx="15" ry="2.4" fill="#000" opacity=".1"/>`;
  o += path(blob(rng, [20, 22.4], 15, 5, 0, 0.08, 10), strawD);
  // trứng (hơi nghiêng)
  const pts = [];
  for (let i = 0; i < 14; i++) {
    const t = (i / 14) * TAU, sy = Math.sin(t);
    pts.push(along([20, 15.4], -12, 7.2 * Math.cos(t) * (1 + 0.1 * sy), 9 * sy));
  }
  o += path(smoothPts(pts), shell);
  o += path(blob(rng, [22.6, 18.6], 4.4, 4.6, 10, 0.06, 9), shade(shell, 0.25), ` opacity=".3"`);
  o += path(brushStroke(rng, [[15.6, 14.8], [16.2, 11], [18.6, 8.2]], 1), "#fff", ` opacity=".6"`);
  // vành rơm phía trước
  o += path(blob(rng, [20, 25.2], 16, 4.4, 0, 0.08, 10), straw);
  let sl = "";
  for (let i = 0; i < 7; i++) {
    const t = i / 6, x0 = lerp(6, 33, t) + (rng() - 0.5) * 3, y0 = 23.6 + (rng() - 0.5) * 3, dir = i % 2 ? 1 : -1, len = 6 + rng() * 4;
    sl += brushStroke(rng, [[x0, y0], [x0 + dir * len * 0.5, y0 + 1 + rng()], [x0 + dir * len, y0 + (rng() - 0.3) * 2.4]], 0.55 + rng() * 0.3);
  }
  o += path(sl, strawL, ` opacity=".9"`);
  o += path(tongue(rng, [5, 24], 200, 4.5, 0.6, { tip: "point" }).d + tongue(rng, [35, 24], -22, 4.5, 0.6, { tip: "point" }).d, strawL);
  const W = Math.max(1, +size || 40);
  return `<svg class="nest-egg${grass ? " on-grass" : ""}" viewBox="0 0 40 32" width="${f(W)}" height="${f(W * 0.8)}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${grass ? "Trứng trên bãi cỏ" : "Trứng trong ổ rơm"}">${o}</svg>`;
}
