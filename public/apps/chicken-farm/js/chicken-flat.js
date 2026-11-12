// Trại Gà — kiểu vẽ "Phẳng": mảng màu phẳng, không viền, dáng vẽ tay.
// Mọi bộ phận dựng từ 2 khối "hữu cơ": blob (mảng tròn méo) và tongue (phiến thuôn
// mép không đều, đầu tròn hoặc nhọn, có thể cong). Độ méo lấy từ seed của bộ gen nên
// mỗi con một dáng riêng nhưng vẽ lại vẫn y hệt. Gen vẫn điều khiển từng bộ phận.
//
// renderChickenFlat(ph, opts) — opts:
//   growth 0..1 (0 = gà con mới nở, 1 = trưởng thành), label, detail "high" | "low",
//   pose "stand" (mặc định) | "walk" | "peck" | "sit",
//   walkPhase 0..1 (chỉ cho "walk": vẽ lại ở vài pha, vd 0 / .25 / .5 / .75, là thành hoạt hình bước),
//   facing "right" (mặc định) | "left" (lật ngang toàn hình quanh x = 100),
//   eyeLid 0..1 (mí mắt khép: 0 mở, 1 nhắm; mặc định .5 khi "sit", 0 khi khác).
// Mọi tư thế giữ bàn chân trên cùng một đường đất; khung canh theo dáng đứng nên
// đổi tư thế (và đổi pha bước) không làm con gà nhảy cỡ, trừ khi dáng mới vượt khung.
// "sit": gà nằm ổ nghỉ — chân giấu dưới bụng (chỉ ló mũi ngón), thân hạ xuống, bụng
// bẹt chạm đường đất, đầu rụt vào; khung giữ y như dáng đứng.

import { clamp, lerp, mix, shade, tint, luminance, mulberry32 } from "./genome.js";
import { smoothClosed, cubicPoints, markColor } from "./chicken-svg.js";

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const f = (n) => Math.round(n * 10) / 10;
const pt = (p) => `${f(p[0])},${f(p[1])}`;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const lerp2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const polar = (c, r, deg) => [c[0] + r * Math.cos(deg * RAD), c[1] + r * Math.sin(deg * RAD)];
// xoay điểm p quanh tâm c (độ, chiều kim đồng hồ trên màn hình — như rotate() của SVG)
const turn = (p, c, deg) => {
  const a = deg * RAD, cs = Math.cos(a), sn = Math.sin(a), x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs];
};
let uid = 0;

// Kiểu phẳng dùng màu rực hơn: tăng độ bão hoà, giữ nguyên sắc và độ sáng.
function vivid(hex, k = 1.3) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return hex;
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  const s2 = Math.min(1, s * k + 0.04);
  const q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2, p = 2 * l - q;
  const ch = (t) => {
    t = ((t % 1) + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${ch(h / 360 + 1 / 3)}${ch(h / 360)}${ch(h / 360 - 1 / 3)}`;
}

/* ---------- khối hữu cơ ---------- */

// nhiễu mượt, khép vòng (dùng cho viền mảng tròn)
function loopNoise(rng) {
  const terms = [2, 3, 5].map((k) => ({ k, a: (0.5 + rng()) / k, p: rng() * TAU }));
  const norm = terms.reduce((s, q) => s + q.a, 0);
  return (t) => terms.reduce((s, q) => s + q.a * Math.sin(q.k * t + q.p), 0) / norm;
}

// mảng tròn méo
function blob(rng, c, rx, ry, deg = 0, irr = 0.08, n = 11) {
  const nz = loopNoise(rng);
  const cs = Math.cos(deg * RAD), sn = Math.sin(deg * RAD);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU, k = 1 + irr * nz(t);
    const x = Math.cos(t) * rx * k, y = Math.sin(t) * ry * k;
    pts.push([c[0] + x * cs - y * sn, c[1] + x * sn + y * cs]);
  }
  return smoothClosed(pts);
}

// mảng tròn có mép lông tơ (mảng da mặt, râu, lông tơ)
function fuzzBlob(rng, c, R, { irr = 0.05, tuft = 0.1, n = 26, ry = 1 } = {}) {
  const nz = loopNoise(rng);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const k = 1 + irr * nz(t) + (i % 2 ? tuft * (0.4 + rng() * 0.6) : -tuft * 0.25);
    pts.push([c[0] + Math.cos(t) * R * k, c[1] + Math.sin(t) * R * ry * k]);
  }
  return smoothClosed(pts);
}

// phiến thuôn: gốc p, hướng deg, dài len, nửa bề rộng w
function tongue(rng, p, deg, len, w, { tip = "round", bend = 0, irr = 0.14, base = 0.7 } = {}) {
  const dx = Math.cos(deg * RAD), dy = Math.sin(deg * RAD), nx = -dy, ny = dx;
  const P = (u, v) => {
    const b = bend * len * (u / len) ** 2;
    return [p[0] + dx * u + nx * (v + b), p[1] + dy * u + ny * (v + b)];
  };
  const kL = 1 + (rng() - 0.5) * irr * 2, kR = 1 + (rng() - 0.5) * irr * 2;
  const prof = tip === "round"
    ? (s) => (base + (1 - base) * Math.sin(Math.min(1, s * 1.8) * Math.PI / 2)) * Math.sqrt(Math.max(0, 1 - Math.max(0, (s - 0.5) / 0.5) ** 2))
    : (s) => (base + (1 - base) * Math.sin(Math.min(1, s * 2.2) * Math.PI / 2)) * (1 - s) ** 0.8;
  const N = 6, left = [], right = [];
  for (let i = 0; i < N; i++) {
    const s = i / N, hw = w * prof(s);
    left.push(P(s * len, -hw * kL * (1 + (rng() - 0.5) * irr * 0.6)));
    right.push(P(s * len, hw * kR * (1 + (rng() - 0.5) * irr * 0.6)));
  }
  const tipPt = P(len * (tip === "round" ? 1 : 1.04), (rng() - 0.5) * w * irr);
  return { d: smoothClosed([...left, tipPt, ...right.reverse()]), P, end: P(len, 0) };
}

// nét cọ: thuôn hai đầu, dọc theo các điểm
function brushStroke(rng, pts, w) {
  const L = [], R = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const s = i / (pts.length - 1);
    const hw = w * (0.15 + 0.85 * Math.sin(Math.PI * s)) * (0.85 + rng() * 0.3);
    L.push([p[0] + nx * hw, p[1] + ny * hw]);
    R.push([p[0] - nx * hw, p[1] - ny * hw]);
  });
  return smoothClosed([...L, ...R.reverse()]);
}

// viền có lông bông (gà con, gà lông tơ) hoặc lông xoăn (mép gợn nhọn)
function sampleLoop(pts, per) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const c = (j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([c(0), c(1)]);
    }
  }
  return out;
}
function shaggy(rng, pts, amp, per = 3, lean = 0) {
  const s = sampleLoop(pts, per);
  const c = s.reduce((a, p) => [a[0] + p[0] / s.length, a[1] + p[1] / s.length], [0, 0]);
  const out = s.map((p, i) => {
    const q = s[(i + 1) % s.length], o = s[(i - 1 + s.length) % s.length];
    const len = Math.hypot(q[0] - o[0], q[1] - o[1]) || 1;
    let nx = -(q[1] - o[1]) / len, ny = (q[0] - o[0]) / len;
    if (nx * (p[0] - c[0]) + ny * (p[1] - c[1]) < 0) { nx = -nx; ny = -ny; }
    const k = i % 2 ? amp * (0.6 + rng() * 0.6) : -amp * 0.2;
    return [p[0] + nx * k + (q[0] - o[0]) / len * k * lean, p[1] + ny * k + (q[1] - o[1]) / len * k * lean];
  });
  return smoothClosed(out);
}

// mép vẽ tay (xô lệch nhẹ) + vân giấy mịn phủ trên mảng màu
function paintFilter(id, seed, grain = true, scale = 2.4) {
  const s = seed % 997;
  return `<filter id="${id}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">`
    + `<feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="2" seed="${s}" result="w"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="w" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="shape"/>`
    + (grain
      ? `<feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="${s + 3}" result="n"/>`
        + `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .2 0 0 0 -.07" result="g"/>`
        + `<feComposite in="g" in2="shape" operator="in" result="gi"/>`
        + `<feMerge><feMergeNode in="shape"/><feMergeNode in="gi"/></feMerge>`
      : "")
    + `</filter>`;
}

/* ---------- con gà ---------- */

export function renderChickenFlat(ph, opts = {}) {
  const g = clamp(opts.growth ?? 1);
  const id = `cf${(++uid).toString(36)}`;
  const S = ph.shape, K = ph.colors;
  const rooster = ph.sex === "rooster";
  const adult = smooth(0.12, 0.95, g);
  const mature = smooth(0.5, 1, g);
  const featherIn = smooth(0.3, 0.9, g);
  const combG = smooth(0.35, 1, g);
  const seed = ph.seed ?? 1;
  // mỗi bộ phận một dòng ngẫu nhiên riêng: đổi gen này không làm xô lệch hình bộ phận khác
  const R = (k) => mulberry32(seed + k * 7919);

  /* tư thế */
  const pose = opts.pose === "walk" || opts.pose === "peck" || opts.pose === "sit" ? opts.pose : "stand";
  const sit = pose === "sit";
  const posed = pose !== "stand";
  const flip = opts.facing === "left";
  const wp0 = Number(opts.walkPhase);
  const phase = Number.isFinite(wp0) ? ((wp0 % 1) + 1) % 1 : 0;

  /* bảng màu */
  const region = (c) => vivid(mix(K.down, c, featherIn));
  const bodyC = region(K.base);
  const neckC = mix(bodyC, region(K.hackle), 0.75);
  const wingC = mix(bodyC, luminance(bodyC) > 0.6 ? shade(mix(bodyC, region(K.wing), 0.4), 0.16) : tint(mix(bodyC, region(K.wing), 0.3), 0.3), lerp(0.35, 1, featherIn));
  const tailCols = [region(shade(K.tail, 0.18)), region(K.accent), region(K.base), region(shade(K.accent, 0.25))];
  const pop = vivid(K.leg, 1.4); // màu nhấn: chân, nét mảnh trên đuôi, viền mắt
  const face = vivid(mix(K.comb, "#f39a3c", 0.5));
  const mark = markColor(bodyC, K.accent, ph.pattern);

  /* khung thân */
  const L = lerp(0.95, lerp(1, S.bodyLength, 0.45), adult);
  const H = lerp(1, lerp(1, S.plump, 0.6), adult);
  const tilt = -lerp(3, S.posture * 0.55, adult) * RAD;
  const tiltDeg = tilt / RAD;
  const C = [96, 118];
  const rot = (x, y) => {
    const c = Math.cos(tilt), s = Math.sin(tilt);
    return [C[0] + x * c - y * s, C[1] + x * s + y * c];
  };
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity };
  const track = (...ps) => ps.forEach((p) => {
    box.x0 = Math.min(box.x0, p[0]);
    box.x1 = Math.max(box.x1, p[0]);
    box.y0 = Math.min(box.y0, p[1]);
  });
  // tư thế: gom điểm cần canh khung theo dáng thật (b: thân, t: đuôi, h: đầu), biến đổi ở cuối
  const extra = [];
  const keep = posed ? (k, ...ps) => ps.forEach((p) => extra.push(k, p)) : () => {};
  const part = (name, body) => (body ? `<g data-part="${name}">${body}</g>` : "");
  const fill = (d, c, extra = "") => `<path d="${d}" fill="${c}"${extra}/>`;

  /* thân: quả trứng méo nhẹ */
  const rb = R(1);
  const bodyPts = [[33, -2], [30, 17], [16, 30], [-4, 33], [-24, 25], [-33, 7], [-31, -13], [-16, -28], [6, -32], [24, -22]]
    .map(([x, y]) => rot((x + (rb() - 0.5) * 2.6) * L, (y + (rb() - 0.5) * 2.6) * H));
  track(...bodyPts);
  keep("b", ...bodyPts);
  const fluffAmp = 1.6 * (1 - adult) + (S.silkie ? 2.6 : 0);

  /* khung tư thế: thân (cùng cổ, đầu, đuôi) xoay quanh hông; chân vẽ lại theo bước */
  const belly = rot(4 * L, 27 * H);
  const legLen = lerp(10, 22 * S.legLen, adult);
  const footY = belly[1] + legLen;
  const lw = lerp(1.7, 2.1, adult);
  const hip = [belly[0], belly[1] - 6];
  const ground = footY + 2.6;
  // nằm: phần bụng thấp nhất ép bẹt (cut = mức ép trong toạ độ thân), cả thân hạ xuống `drop`
  // để mặt bụng bẹt chạm đường đất
  let drop = 0, flatPts = bodyPts;
  if (sit) {
    const bottom = Math.max(...bodyPts.map((p) => p[1]));
    const cut = bottom - lerp(3, 5, adult) * H;
    flatPts = bodyPts.map(([x, y]) => [x, y > cut ? cut + (y - cut) * 0.12 : y]);
    drop = ground - cut - 1.2 - fluffAmp * 0.3;
  }
  const bodyD = S.frizzle && adult > 0.3
    ? shaggy(rb, flatPts, S.frizzle * 2.6 * adult, 2, 0.6)
    : fluffAmp > 0.5 ? shaggy(rb, flatPts, fluffAmp, 3) : smoothClosed(flatPts);
  const lean = pose === "walk" ? lerp(4, 7, adult) : pose === "peck" ? lerp(10, 12 + S.posture * 0.3, adult) : 0;
  const bob = pose === "walk" ? -lerp(0.8, 1.4, adult) * Math.abs(Math.sin(TAU * phase)) : sit ? drop : 0;
  const X = (p) => { const q = turn(p, hip, lean); return [q[0], q[1] + bob]; }; // toạ độ thân → toạ độ thật
  // bước đi: mỗi chân nửa chu kỳ trụ (trượt về sau), nửa chu kỳ nhấc (vung ra trước, co ngón)
  const strideA = legLen * 0.42;
  const stride = (back) => {
    if (pose === "peck") return { sx: legLen * (back ? -0.14 : 0.12), lift: 0, curl: 0 };
    if (pose !== "walk") return { sx: 0, lift: 0, curl: 0 };
    const u = (phase + (back ? 0.5 : 0)) % 1;
    if (u < 0.5) return { sx: lerp(strideA, -strideA, u * 2), lift: 0, curl: 0 };
    const t = (u - 0.5) * 2, k = Math.sin(Math.PI * t);
    return { sx: lerp(-strideA, strideA, t * t * (3 - 2 * t)), lift: k * legLen * 0.4, curl: k };
  };

  /* cổ + đầu: cổ vươn lên rồi gập ra trước */
  const rn = R(2);
  const neckBase = rot(lerp(16, 20, adult) * L, lerp(-20, -12, adult) * H);
  const r = lerp(16.5, 11.5, adult) * (rooster ? lerp(1, 1.05, mature) : 1);
  const bl = lerp(6, 7 + 7 * S.beakLen, adult);
  const cv = S.beakCurve * bl * 0.5;
  const head0 = [neckBase[0] + lerp(6, 19 + 6 * S.neck, adult), neckBase[1] - lerp(18, 19 + 13 * S.neck, adult)];
  let head = head0, hb = [0, 0], hrot = 0;
  if (pose === "walk") {
    // gật đầu: hai nhịp mỗi chu kỳ bước
    const w = TAU * 2 * phase;
    hb = [lerp(1, 2.4, adult) * Math.cos(w), lerp(0.4, 0.8, adult) * Math.sin(w)];
    head = add(head0, hb);
  } else if (pose === "peck") {
    // mổ: xoay đầu cho mỏ chúc xuống, đặt đầu sao cho chóp mỏ chạm đất trước mũi chân
    const v = [r * 1.1 + bl, r * 0.8 + cv];
    const phiW = lerp(68, 78, adult) - Math.atan2(v[1], v[0]) / RAD;
    const tv = turn(v, [0, 0], phiW);
    const toeEnd = X([belly[0] + 6 * L, belly[1] - 6])[0] - 2.5 + stride(false).sx + lerp(5, 12, adult);
    const chest = Math.max(...bodyPts.map((p) => X(p)[0]));
    const hw = [Math.max(toeEnd + lerp(2, 4, adult) - tv[0], chest + r * lerp(0.35, 0.95, adult)), footY + 0.8 - tv[1]];
    head = turn(hw, hip, -lean);
    hrot = phiW - lean;
  } else if (sit) {
    // rụt đầu: lùi về sau và hạ xuống gần vai
    hb = [-lerp(1, 4, adult), lerp(2, 5 + 7 * S.neck, adult)];
    head = add(head0, hb);
  }
  const n0 = add(neckBase, [-6, 12]);
  const n1 = pose === "peck"
    ? add(neckBase, [lerp(5, 12, adult), -lerp(3, 6 + 8 * S.neck, adult)])
    : add(neckBase, [lerp(0, -2, adult), -lerp(6, 26 * S.neck, adult) * (sit ? 0.55 : 1)]);
  const n2 = pose === "peck"
    ? add(head, turn([-lerp(5, 14, adult), -lerp(3, 5, adult)], [0, 0], hrot))
    : add(head, [-lerp(3, 14, adult), lerp(4, 1, adult)]);
  const neckLine = cubicPoints(n0, n1, n2, head, 24);
  const nw0 = lerp(13, 13.5, adult) * Math.sqrt(H), nw1 = r * 0.92;
  const nL = [], nR = [];
  neckLine.forEach((p, i) => {
    if (i % 3 && i !== neckLine.length - 1) return;
    const a = neckLine[Math.max(0, i - 1)], b = neckLine[Math.min(neckLine.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const t = i / (neckLine.length - 1);
    // phình nhẹ ở ngực phía trước, thắt nhẹ giữa cổ
    const w = lerp(nw0, nw1, t) * (1 - 0.1 * Math.sin(Math.PI * t)) * (1 + (rn() - 0.5) * 0.06);
    nL.push([p[0] + nx * w, p[1] + ny * w]);
    nR.push([p[0] - nx * w, p[1] - ny * w]);
  });
  const neckD = smoothClosed([...nL, ...nR.reverse()]);
  const rh = R(3);
  const headD = S.silkie || fluffAmp > 0.9
    ? fuzzBlob(rh, head, r, { tuft: 0.08 + fluffAmp * 0.02, n: 22 })
    : blob(rh, head, r * 1.04, r, -10, 0.05);
  // khung canh theo đầu ở dáng đứng; dáng thật của đầu gom riêng
  const refH = posed ? (p) => [p[0] - head[0] + head0[0], p[1] - head[1] + head0[1]] : (p) => p;
  const trackH = (...ps) => {
    track(...ps.map(refH));
    keep("h", ...ps);
  };
  trackH([head[0], head[1] - r]);

  /* hoa văn (trong thân + cổ) */
  let pattern = "";
  if (ph.pattern !== "solid" && featherIn > 0.05) {
    const rp = R(4);
    let m = "";
    if (ph.pattern === "barred") {
      for (let k = 0; k < 7; k++) {
        const y = -29 + k * 10 + (rp() - 0.5) * 3;
        const pts = [-44, -26, -8, 10, 28, 44].map((x, i) => rot(x * L, (y + Math.sin(i * 1.7 + k) * 2.4) * H));
        m += fill(brushStroke(rp, pts, 2.2 * H), mark);
      }
      for (let k = 0; k < 4; k++) {
        const a = add(n0, [-12, -k * 11 - 2]);
        m += fill(brushStroke(rp, [a, add(a, [13, 2]), add(a, [27, 4])], 1.8), mark);
      }
    } else if (ph.pattern === "laced") {
      for (let y = -26, row = 0; y <= 30; y += 9, row++) {
        for (let x = -40 + (row % 2) * 6; x <= 40; x += 12) {
          const a = rot((x - 5) * L, y * H), b = rot((x + 5) * L, y * H), c = rot(x * L, (y + 6) * H);
          m += fill(brushStroke(rp, [a, lerp2(a, c, 0.6), c, lerp2(b, c, 0.6), b], 1.1), mark);
        }
      }
    } else {
      const spang = ph.pattern === "spangled";
      for (let y = -26, row = 0; y <= 30; y += spang ? 9 : 7, row++) {
        for (let x = -40 + (row % 2) * 6; x <= 40; x += spang ? 12 : 9) {
          const p = rot((x + (rp() - 0.5) * 5) * L, (y + (rp() - 0.5) * 4) * H);
          m += fill(spang ? blob(rp, p, 2.2, 3, tiltDeg - 20 + (rp() - 0.5) * 30, 0.18, 8) : blob(rp, p, 0.9 + rp() * 0.8, 0.9 + rp() * 0.6, rp() * 180, 0.2, 7), mark);
        }
      }
    }
    pattern = `<g clip-path="url(#${id}-cb)" opacity="${f(featherIn * 0.9)}">${m}</g>`;
  }

  /* lông bờm: vài phiến nhọn rủ từ chân cổ xuống thân (chỉ khi khác màu thân hoặc gà trống) */
  let cape = "";
  const capeShow = adult > 0.3 && !S.silkie && (rooster || Math.abs(luminance(neckC) - luminance(bodyC)) > 0.05);
  if (capeShow) {
    const rc = R(5);
    const tl = lerp(4, 9 + (rooster ? 7 * mature : 0), adult) * (S.frizzle ? 1.2 : 1);
    const n = rooster ? 7 : 5;
    const a = add(neckBase, [-13, 0]), b = add(neckBase, [13, 9]);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = add(lerp2(a, b, t), [0, Math.sin(Math.PI * t) * 3 - 6]);
      const deg = (S.frizzle ? -70 + t * 30 : 112 - t * 34) + tiltDeg * 0.5 + (rc() - 0.5) * 10;
      cape += fill(tongue(rc, p, deg, tl * (0.75 + 0.5 * Math.sin(Math.PI * t)) + 4, 3.6, { tip: "point", bend: (rc() - 0.5) * 0.3 }).d, neckC);
    }
    if (S.hackleStripe > 0.05) {
      let st = "";
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, p = add(lerp2(a, b, t), [0, -3]);
        st += fill(tongue(rc, p, 112 - t * 34 + tiltDeg * 0.5, tl * 0.9 + 2, 0.9, { tip: "point" }).d, shade(K.accent, 0.1));
      }
      cape += `<g opacity="${f(S.hackleStripe * featherIn)}">${st}</g>`;
    }
  }

  /* lông yên (gà trống): phiến nhọn rủ từ lưng sau */
  let saddle = "";
  if (rooster && mature > 0.1 && !S.silkie) {
    const rs = R(6);
    const sl = lerp(7, 17, S.saddle ?? 0.5) * mature;
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const base = rot(lerp(-8, -28, t) * L, lerp(-28, -18, t) * H);
      const deg = lerp(118, 150, t) + tiltDeg + (S.frizzle ? -140 : 0) + (rs() - 0.5) * 10;
      const tg = tongue(rs, base, deg, sl * (0.7 + 0.5 * Math.sin(Math.PI * (0.2 + t * 0.7))), 3.4, { tip: "point", bend: -0.2 + (rs() - 0.5) * 0.2 });
      saddle += fill(tg.d, neckC);
      track(tg.end);
      keep("b", tg.end);
    }
  }

  /* cánh: phần lưng trên-sau của thân + các "lưỡi" lông rủ xuống, nghiêng về sau */
  const rw = R(7);
  const ws = lerp(0.5, 1, adult);
  const wp = (x, y) => rot(x * L * ws + (1 - ws) * -4, y * H * ws + (1 - ws) * -10);
  const lobes = adult < 0.3 ? 2 : 3 + Math.round((1 - (S.featherSize ?? 0.5)) * 2);
  const droop = S.wingDroop * 6 * adult;
  const x0 = -36, x1 = 14;
  let wing = fill(smoothClosed([wp(x1 + 4, -40), wp(x0 - 6, -40), wp(x0 - 4, -6), wp(-12, -3 + droop * 0.5), wp(x1 + 2, -5)]), wingC);
  if (S.silkie) {
    wing = fill(shaggy(rw, [wp(x1 + 2, -36), wp(x0 - 4, -36), wp(x0, 8), wp(-14, 12), wp(4, 10), wp(x1 + 2, -10)], 1.8, 3), wingC);
  } else {
    for (let i = 0; i < lobes; i++) {
      const t = (i + 0.5) / lobes;
      const base = wp(lerp(x0 + 1, x1 - 3, t), -7 + (rw() - 0.5) * 2);
      const deg = 96 + lerp(22, 6, t) + tiltDeg + (rw() - 0.5) * 8;
      const len = (lerp(14, 20, Math.sin(Math.PI * (0.25 + t * 0.6))) + rw() * 5 + droop) * ws * H;
      const w = ((x1 - x0) / lobes) * 0.62 * ws * L * (0.85 + rw() * 0.3);
      wing += fill(tongue(rw, base, deg, len, w, { tip: S.frizzle ? "point" : "round", bend: (rw() - 0.5) * 0.18 - 0.06, base: 0.9 }).d, wingC);
    }
  }
  wing = `<g clip-path="url(#${id}-cbody)">${wing}</g>`;

  /* đuôi: phiến dài mọc từ cả một khoảng lưng, dài ngắn, nhọn tròn lẫn lộn */
  let tail = "";
  const tailG = smooth(0.2, 1, g);
  if (S.tailType !== "rumpless" && tailG > 0.02) {
    const rt = R(8);
    const longF = 1 + 0.45 * S.longTail;
    const len = 44 * S.tailLen * tailG * longF * (S.silkie ? 0.55 : 1);
    const center = lerp(194, 228, S.tailAngle) + tiltDeg * 0.6;
    const curl = (S.tailCurl - 0.5) * 0.4;
    const top = rot(-24 * L, -22 * H), bottom = rot(-32 * L, -2 * H);
    if (rooster && mature > 0.05 && !S.silkie) {
      for (let j = 0; j < 2; j++) {
        const p = add(lerp2(top, bottom, 0.15 + j * 0.15), [2, 0]);
        const tg = tongue(rt, p, center + 26 - j * 10, len * mature * (1.3 + 0.15 * j) * (1 + 0.4 * S.longTail), 4.4, { tip: "point", bend: -0.5 - curl - 0.25 * S.longTail, irr: 0.1, base: 0.85 });
        tail += fill(tg.d, j ? tailCols[1] : tailCols[3]);
        track(tg.end, tg.P(len * 0.6, 0));
        keep("t", tg.end, tg.P(len * 0.6, 0));
      }
    }
    const n = S.tailCount + (rooster ? 2 : 1);
    const blades = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      blades.push({
        t,
        p: add(lerp2(top, bottom, t), [(rt() - 0.5) * 3, (rt() - 0.5) * 3]),
        deg: center + (0.5 - t) * 34 + (rt() - 0.5) * 8,
        len: len * (0.75 + 0.25 * Math.sin(Math.PI * (0.3 + t * 0.6))) * (0.85 + rt() * 0.3),
        w: lerp(4.4, 8.4, adult) * (0.85 + rt() * 0.3) * (S.silkie ? 1.2 : 1),
        tip: S.silkie || rt() < 0.78 ? "round" : "point",
        col: tailCols[Math.floor(rt() * 3)],
      });
    }
    // phiến tối vẽ trước, phiến sáng đè lên: tạo chiều sâu
    blades.sort((a, b) => luminance(a.col) - luminance(b.col) || a.t - b.t);
    let k = 0;
    for (const b of blades) {
      const tg = tongue(rt, b.p, b.deg, b.len, b.w, { tip: b.tip, bend: curl + (rt() - 0.5) * 0.25, base: 0.75 });
      tail += fill(tg.d, b.col);
      track(tg.end);
      keep("t", tg.end);
      // nét mảnh màu nhấn xen giữa các phiến
      if (adult > 0.4 && k++ % 2 === 0) {
        const s = tongue(rt, add(b.p, [1, 1]), b.deg + (rt() - 0.5) * 8, b.len * (0.85 + rt() * 0.3), 1, { tip: "point", bend: curl + (rt() - 0.5) * 0.2, base: 0.6, irr: 0.05 });
        tail += fill(s.d, pop);
      }
    }
  }

  /* chân: ống chân thuôn, bàn chân dẹt như mái chèo */
  const rl = R(9);
  let legs = "";
  if (sit) {
    // chân giấu dưới bụng: chỉ ló mũi ngón trước ở mép bụng (toạ độ thật: thân đã hạ `drop`)
    // mép trước của bụng ở độ cao mũi ngón (dò theo viền thân đã ép bẹt)
    const low = sampleLoop(flatPts, 4).filter((p) => p[1] + drop > ground - lw * 2.8);
    const frontX = low.length ? Math.max(...low.map((p) => p[0])) : belly[0] + 14 * L;
    const tl = lerp(5, 12, adult);
    for (const back of [true, false]) {
      const col = back ? shade(K.leg, 0.15) : K.leg;
      const foot = [frontX - tl * (back ? 0.75 : 0.45), ground - lw * 0.9];
      let s = "";
      for (const deg of [-3, 9]) s += fill(tongue(rl, foot, deg + (rl() - 0.5) * 6, tl * 0.95, lw * 1.05, { tip: "round", base: 0.95, irr: 0.08 }).d, col);
      if (S.feetFeather === 2) s += fill(tongue(rl, add(foot, [1, -2]), 4, tl * 0.75, 2.2, { tip: "round" }).d, bodyC);
      legs += s;
    }
  } else for (const [dx, back] of [[-5, true], [6, false]]) {
    const col = back ? shade(K.leg, 0.15) : K.leg;
    const st = stride(back);
    const top0 = [belly[0] + dx * L, belly[1] - 6];
    const top = posed ? X(top0) : top0;
    const foot = [top[0] - 2.5 + st.sx, footY - st.lift];
    const shankLen = Math.hypot(foot[0] - top[0], foot[1] - top[1]);
    const shankDeg = Math.atan2(foot[1] - top[1], foot[0] - top[0]) / RAD;
    let s = fill(tongue(rl, top, shankDeg, shankLen + lw * 0.6, lw, { tip: "round", base: 1, irr: 0.05 }).d, col);
    const tl = lerp(5, 12, adult);
    const toes = [[2, tl], [16, tl * 0.82], [178, tl * 0.5]];
    if (S.toes > 4) toes.push([196, tl * 0.45]);
    for (const [deg, l] of toes) {
      s += fill(tongue(rl, add(foot, [0, -lw * 0.4]), deg + (rl() - 0.5) * 6 + (deg < 90 ? 55 : -40) * st.curl, l * (1 - 0.3 * st.curl), lw * 1.05, { tip: "round", base: 0.95, irr: 0.08 }).d, col);
    }
    if (rooster && mature > 0.3) {
      s += fill(tongue(rl, [foot[0] + lw * 0.2, foot[1] - legLen * 0.38], 192, 5 * mature, lw * 0.75, { tip: "point", base: 1 }).d, col);
    }
    if (S.feetFeather) {
      for (let i = 0; i < (S.feetFeather === 2 ? 4 : 2); i++) {
        const q = lerp2(top, foot, 0.25 + i * 0.2);
        s += fill(tongue(rl, add(q, [-1, -2]), 128 + (rl() - 0.5) * 16, S.feetFeather === 2 ? 8 : 6, 2.6, { tip: "round" }).d, bodyC);
      }
      if (S.feetFeather === 2) s += fill(tongue(rl, add(foot, [1, -2.5]), 6 + 50 * st.curl, tl * 0.9, 2.4, { tip: "round" }).d, bodyC);
    }
    legs += s;
  }
  track([belly[0] + 14, ground]);

  /* mặt, mắt, mỏ */
  const rf = R(10);
  const faceAlpha = smooth(0.3, 0.85, g);
  const faceC = add(head, [r * 0.2, -r * 0.06]);
  const faceHtml = faceAlpha > 0.02 ? fill(fuzzBlob(rf, faceC, r * 1.3, { irr: 0.07, tuft: 0.05, n: 18, ry: 0.97 }), face, ` opacity="${f(faceAlpha)}"`) : "";
  const earHtml = combG > 0.1 && K.earlobe !== K.comb
    ? fill(blob(rf, [head[0] - r * 0.55, head[1] + r * 0.5], 2.6 * combG, 3.6 * combG, 10, 0.12, 8), K.earlobe)
    : "";
  const es = S.eyeSize;
  const er = lerp(1, 1.65, adult);
  const eyeC = add(head, [r * 0.22, -r * 0.08]);
  const pupil = mix("#2a1418", "#160b0d", adult);
  const re = R(11);
  let eyeHtml = `<g class="ck-eye">`;
  if (adult > 0.3) eyeHtml += fill(blob(re, eyeC, r * 0.56 * er * es, r * 0.54 * er * es, 0, 0.07, 10), tint(pop, 0.4), ` opacity="${f(faceAlpha)}"`);
  eyeHtml += fill(blob(re, eyeC, r * lerp(0.36, 0.46, adult) * er * es, r * lerp(0.36, 0.44, adult) * er * es, 0, 0.05, 10), "#fbf7ef");
  const irisC = add(eyeC, [r * 0.08, r * 0.01]);
  eyeHtml += fill(blob(re, irisC, r * lerp(0.28, 0.32, adult) * er * es, r * lerp(0.28, 0.33, adult) * er * es, 0, 0.04, 9), mix(pupil, K.eye, adult * 0.85));
  eyeHtml += fill(blob(re, add(irisC, [r * 0.02, 0]), r * 0.23 * er * es, r * 0.25 * er * es, 0, 0.05, 9), pupil);
  if (adult < 0.5) eyeHtml += `<circle cx="${f(eyeC[0] + r * 0.18)}" cy="${f(eyeC[1] - r * 0.1)}" r="${f(r * 0.07)}" fill="#fff"/>`;
  const lid0 = Number(opts.eyeLid ?? (sit ? 0.5 : 0));
  const lid = Number.isFinite(lid0) ? clamp(lid0) : 0;
  if (lid > 0.02) {
    // mí mắt: chỏm tròn màu da mặt phủ từ trên xuống, mép dưới cong võng + viền mi sẫm
    const Re = r * (adult > 0.3 ? 0.6 * er : lerp(0.4, 0.5, adult) * er) * es;
    const yL = eyeC[1] + Re * (2 * lid - 1) * 0.98;
    const hx = Math.sqrt(Math.max(0, Re * Re - (yL - eyeC[1]) ** 2)) || Re * 0.2;
    const a = [eyeC[0] - hx, yL], b = [eyeC[0] + hx, yL], sag = [eyeC[0], yL + Re * 0.32 * (1 - Math.abs(2 * lid - 1) * 0.6)];
    const lidC = mix(neckC, face, faceAlpha);
    eyeHtml += fill(`M${pt(a)}A${f(Re)} ${f(Re)} 0 ${yL > eyeC[1] ? 1 : 0} 1 ${pt(b)}Q${pt(sag)} ${pt(a)}Z`, lidC);
    eyeHtml += fill(brushStroke(R(16), [a, lerp2(a, sag, 0.5), [sag[0], (yL + sag[1]) / 2 + 0.1], lerp2(b, sag, 0.5), b], lerp(0.5, 0.75, adult)), shade(lidC, 0.55));
  }
  eyeHtml += `</g>`;

  const bA = add(head, [r * 1.1, r * 0.26]), bB = add(head, [r * 0.86, r * 0.84]);
  const tip = add(head, [r * 1.1 + bl, r * 0.8 + cv]);
  const beakC = adult > 0.3 ? shade(K.beak, 0.55) : mix(K.beak, "#f2a640", 0.4);
  // mỏ: nêm cong, sống mỏ phồng, chóp hơi khoằm
  let beakHtml = fill(`M${pt(bA)}C${pt(add(bA, [bl * 0.55, -r * 0.04]))} ${pt(add(tip, [-bl * 0.12, -r * 0.4]))} ${pt(tip)}C${pt(add(tip, [-bl * 0.3, r * 0.04]))} ${pt(add(bB, [bl * 0.35, r * 0.12]))} ${pt(bB)}Q${pt(add(bA, [-r * 0.12, r * 0.3]))} ${pt(bA)}Z`, beakC);
  if (adult > 0.3) beakHtml += fill(brushStroke(re, [add(bA, [1.4, 1.5]), add(lerp2(bA, tip, 0.5), [0.5, -0.4]), add(tip, [-2.2, -1.2])], 0.55), tint(pop, 0.3), ` opacity=".85"`);
  trackH(tip);

  const wl = (rooster ? 5.4 : 3.4) * S.wattle * combG * (S.muff ? 0.4 : 1);
  let wattleHtml = "";
  if (wl > 0.4) {
    wattleHtml = fill(tongue(re, add(head, [r * 0.68, r * 1.0]), 98, wl * 2.1, wl * 0.8, { tip: "round", base: 0.8 }).d, shade(K.comb, 0.1))
      + fill(tongue(re, add(head, [r * 0.98, r * 0.92]), 86, wl * 1.8, wl * 0.72, { tip: "round", base: 0.8 }).d, K.comb);
  }

  /* mào: các phiến tròn như cánh hoa, mọc từ đỉnh đầu, ngả về sau */
  const rk = R(12);
  const combScale = S.combSize * (rooster ? lerp(0.75, 1.3, mature) : 0.75) * (S.crest ? 0.5 : 1) * combG;
  const ch = combScale * 13;
  let combHtml = "";
  if (ch > 0.6) {
    let lobesHtml = "";
    if (S.combType === "single") {
      const n = Math.min(6, 3 + Math.round(S.combSize * 1.4) + (rooster ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const a = lerp(-58, -148, t) + (rk() - 0.5) * 8;
        const h = ch * (0.7 + 0.38 * Math.sin(Math.PI * (0.2 + t * 0.8))) * (0.85 + rk() * 0.3);
        const tg = tongue(rk, polar(head, r * 0.55, a), a - 8, h + r * 0.4, h * 0.34 * (0.85 + rk() * 0.3), { tip: "round", bend: -0.12 + (rk() - 0.5) * 0.1, base: 0.75 });
        lobesHtml += fill(tg.d, K.comb);
        trackH(tg.end);
      }
    } else if (S.combType === "rose") {
      lobesHtml += fill(blob(rk, polar(head, r * 0.82, -100), r * 0.75, ch * 0.32 + 1, -8, 0.14, 10), K.comb);
      const tg = tongue(rk, polar(head, r * 0.85, -140), 186, ch * 0.9 + r * 0.3, ch * 0.16 + 0.8, { tip: "point", bend: -0.15 });
      lobesHtml += fill(tg.d, K.comb);
    } else if (S.combType === "pea") {
      for (let i = 0; i < 3; i++) lobesHtml += fill(blob(rk, polar(head, r * 0.9, lerp(-72, -118, i / 2)), ch * 0.24 + 0.6, ch * 0.3 + 0.6, lerp(-72, -118, i / 2) + 90, 0.15, 8), K.comb);
    } else {
      lobesHtml += fill(blob(rk, polar(head, r * 0.88 + ch * 0.18, -96), ch * 0.55 + 0.5, ch * 0.42 + 0.5, -10, 0.16, 10), K.comb);
    }
    combHtml = lobesHtml;
  }

  let crestHtml = "";
  if (S.crest) {
    const rr = R(13);
    const n = S.crest === 2 ? 11 : 7;
    const cl = r * (S.crest === 2 ? 1.0 : 0.7) * lerp(0.55, 1, adult);
    const crestC = tint(neckC, 0.18);
    for (let i = 0; i < n; i++) {
      const a = lerp(-172, -8, i / (n - 1)) + (rr() - 0.5) * 12;
      const tg = tongue(rr, polar(add(head, [-r * 0.1, -r * 0.3]), r * 0.2, a), a, cl * (0.75 + 0.4 * Math.sin(Math.PI * i / (n - 1))) * (0.85 + rr() * 0.3), cl * 0.2, { tip: rr() < 0.5 ? "round" : "point", bend: (rr() - 0.5) * 0.3 });
      crestHtml += fill(tg.d, crestC);
      trackH(tg.end);
    }
  }
  const muffHtml = S.muff ? fill(fuzzBlob(R(14), add(head, [r * 0.62, r * 0.92]), r * 0.46, { tuft: 0.2, n: 16, ry: 1.1 }), tint(neckC, 0.08)) : "";

  /* sọc lưng gà con */
  let bodyStripe = "", headStripe = "";
  if (ph.pattern !== "solid" && adult < 0.95) {
    const rs = R(15);
    const col = shade(K.down, 0.35), op = ` opacity="${f(0.75 * (1 - adult))}"`;
    bodyStripe = fill(brushStroke(rs, [rot(-28 * L, -12 * H), rot(-12 * L, -25 * H), rot(4 * L, -27 * H), rot(14 * L, -22 * H)], 2.2), col, op);
    headStripe = fill(brushStroke(rs, [add(head, [-r * 0.8, -r * 0.1]), add(head, [-r * 0.35, -r * 0.75]), add(head, [r * 0.3, -r * 0.72])], 2), col, op);
  }

  /* tư thế: gộp dáng thật vào khung (đầu khi bước tính ở vị trí giữa nhịp gật, bỏ nhún) để
     các pha bước cùng một cỡ; đuôi vểnh thêm khi mổ */
  const tailRoot = rot(-28 * L, -12 * H);
  // đuôi giữ gần hướng cũ (bù phần thân chúi), chỉ vểnh thêm vài độ
  const tailLift = pose === "peck" ? lerp(5, 8, adult) - lean * 0.75 : 0;
  if (posed) {
    for (let i = 0; i < extra.length; i += 2) {
      const k = extra[i];
      let p = extra[i + 1];
      if (k === "t") p = turn(p, tailRoot, tailLift);
      else if (k === "h") p = hrot ? turn(p, head, hrot) : [p[0] - hb[0], p[1] - hb[1]];
      track(turn(p, hip, lean));
    }
    if (pose === "walk") track([belly[0] + 6 * L - 2.5 + strideA + lerp(5, 12, adult), ground]);
  }

  /* ghép lớp, canh khung */
  const GY = 186;
  const want = S.size * lerp(0.95, 1.3, smooth(0, 1, g));
  const width = box.x1 - box.x0 + 8;
  const height = ground - box.y0 + 6;
  const s = Math.min(want, 186 / width, (GY - 6) / height);
  const tx = 100 - s * (box.x0 + box.x1) / 2;
  const ty = GY - s * ground;
  const pivot = add(neckBase, [0, 6]);
  const leanOpen = sit ? `<g transform="translate(0 ${f(bob)})">`
    : posed ? `<g transform="${bob ? `translate(0 ${f(bob)}) ` : ""}rotate(${f(lean)} ${f(hip[0])} ${f(hip[1])})">` : "";
  const leanClose = posed ? `</g>` : "";
  const tailHtml = tail && tailLift ? `<g transform="rotate(${f(tailLift)} ${f(tailRoot[0])} ${f(tailRoot[1])})">${tail}</g>` : tail;
  const defs = [
    paintFilter(`${id}-r`, seed, (opts.detail ?? "high") === "high"),
    `<clipPath id="${id}-cb"><path d="${bodyD}"/><path d="${neckD}"/></clipPath>`,
    `<clipPath id="${id}-cbody"><path d="${bodyD}"/></clipPath>`,
  ];

  return [
    `<svg class="chicken is-flat${posed ? ` pose-${pose}` : ""}${flip ? " face-left" : ""}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.label ?? "Gà"}">`,
    `<defs>${defs.join("")}</defs>`,
    `<g transform="translate(${f(flip ? 200 - tx : tx)} ${f(ty)}) scale(${flip ? `${(-s).toFixed(3)} ${s.toFixed(3)}` : s.toFixed(3)})">`,
    `<ellipse cx="${f(belly[0] - 2)}" cy="${f(ground)}" rx="${f((sit ? 36 : 32) * L)}" ry="${sit ? 5 : 4.5}" fill="#000" opacity="${sit ? ".1" : ".08"}"/>`,
    `<g class="ck-bob" filter="url(#${id}-r)">`,
    leanOpen,
    part("tail", tailHtml),
    leanClose,
    part("legs", legs),
    leanOpen,
    `<g class="ck-head" style="transform-origin:${f(pivot[0])}px ${f(pivot[1])}px">`,
    part("hackle", fill(neckD, neckC)),
    `</g>`,
    part("body", fill(bodyD, bodyC) + pattern + bodyStripe),
    part("hackle", cape),
    part("wing", wing),
    part("saddle", saddle),
    `<g class="ck-head" style="transform-origin:${f(pivot[0])}px ${f(pivot[1])}px">`,
    hrot ? `<g transform="rotate(${f(hrot)} ${f(head[0])} ${f(head[1])})">` : "",
    part("comb", combHtml),
    part("head", fill(headD, neckC) + headStripe),
    part("crest", crestHtml),
    part("face", faceHtml),
    part("earlobe", earHtml),
    part("wattle", wattleHtml),
    part("muff", muffHtml),
    part("eye", eyeHtml),
    part("beak", beakHtml),
    hrot ? `</g>` : "",
    `</g>`,
    leanClose,
    `</g></g></svg>`,
  ].join("");
}

export function renderEggFlat(ph, opts = {}) {
  const id = `ef${(++uid).toString(36)}`;
  const shell = ph.egg.shell;
  const rng = mulberry32(ph.egg.seed + 7);
  const pts = [];
  for (let i = 0; i < 14; i++) {
    const t = (i / 14) * TAU, sy = Math.sin(t);
    pts.push([100 + 33 * Math.cos(t) * (1 + 0.1 * sy) * (1 + (rng() - 0.5) * 0.03), 128 + 42 * sy]);
  }
  let dots = "";
  for (let i = 0; i < Math.round(ph.egg.speckle * 30); i++) {
    const a = rng() * TAU, rr = Math.sqrt(rng());
    dots += fillDot(blob(rng, [100 + Math.cos(a) * rr * 25, 126 + Math.sin(a) * rr * 33], 0.9 + rng() * 1.8, 0.7 + rng() * 1.3, rng() * 180, 0.2, 7));
  }
  const crack = clamp(opts.crack ?? 0);
  const crackHtml = crack > 0
    ? `<path d="M70,118${[...Array(Math.round(3 + crack * 7)).keys()].map((i) => `L${70 + (i + 1) * 6},${118 + (i % 2 ? -5 : 5)}`).join("")}" fill="none" stroke="${shade(shell, 0.6)}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";
  return `<svg class="egg is-flat${opts.wobble ? " is-wobble" : ""}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.label ?? "Trứng"}"><defs>${paintFilter(`${id}-r`, ph.egg.seed, true, 2)}</defs><ellipse cx="100" cy="171" rx="28" ry="4.5" fill="#000" opacity=".08"/><g class="egg-shell" data-part="egg" filter="url(#${id}-r)"><path d="${smoothClosed(pts)}" fill="${shell}"/><path d="${brushStroke(rng, [[80, 104], [84, 94], [94, 86]], 1.8)}" fill="#fff" opacity=".45"/><g fill="${shade(shell, 0.5)}" opacity=".75">${dots}</g>${crackHtml}</g></svg>`;
}
const fillDot = (d) => `<path d="${d}"/>`;

// dùng lại cho kiểu "Phẳng 2"
export { vivid, blob, fuzzBlob, tongue, brushStroke, shaggy, paintFilter };
