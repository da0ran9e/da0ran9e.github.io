// Trại Gà — bộ vẽ gà bằng SVG sinh từ kiểu hình.
// Không có hình vẽ sẵn: mỗi bộ phận (thân, đuôi, mào, mỏ, chân, …) là một hàm
// hình học nhận số đo từ express(). Đổi gen → đổi số đo → đổi nét vẽ.
// Kết quả là chuỗi SVG nên chạy được cả trong trình duyệt lẫn trên server.

import { clamp, lerp, mix, shade, tint, luminance, mulberry32 } from "./genome.js";

const RAD = Math.PI / 180;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const f = (n) => Math.round(n * 10) / 10;
const pt = (p) => `${f(p[0])},${f(p[1])}`;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const polar = (c, r, deg) => [c[0] + r * Math.cos(deg * RAD), c[1] + r * Math.sin(deg * RAD)];
let uid = 0;

/* ---------- hình học ---------- */

// Catmull-Rom khép kín → đường cong Bézier mượt đi qua mọi điểm.
function smoothClosed(pts) {
  const n = pts.length;
  let d = `M${pt(pts[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d + "Z";
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const k = (i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  return [k(0), k(1)];
}

function sampleClosed(pts, per) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < per; k++) out.push(catmull(pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n], k / per));
  }
  return out;
}

// Viền có kết cấu: lông tơ (gợn tròn) hoặc lông xoăn (răng cưa hất ra ngoài).
function texturedClosed(pts, { fluff = 0, frizz = 0, per = 6 } = {}) {
  if (fluff < 0.2 && frizz < 0.2) return smoothClosed(pts);
  const s = sampleClosed(pts, per);
  const c = s.reduce((acc, p) => [acc[0] + p[0] / s.length, acc[1] + p[1] / s.length], [0, 0]);
  let d = `M${pt(s[0])}`;
  for (let i = 0; i < s.length; i++) {
    const a = s[i], b = s[(i + 1) % s.length];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    if (nx * (m[0] - c[0]) + ny * (m[1] - c[1]) < 0) { nx = -nx; ny = -ny; }
    if (frizz >= fluff) {
      const tip = [m[0] + nx * frizz + (a[0] - b[0]) / len * frizz * 0.5, m[1] + ny * frizz + (a[1] - b[1]) / len * frizz * 0.5];
      d += `L${pt(tip)}L${pt(b)}`;
    } else {
      d += `Q${pt([m[0] + nx * fluff * 2, m[1] + ny * fluff * 2])} ${pt(b)}`;
    }
  }
  return d + "Z";
}

// Một chiếc lông (hình lá): gốc (x,y), hướng, dài, rộng, độ cong.
function leaf(p, deg, len, w, curl = 0) {
  const dx = Math.cos(deg * RAD), dy = Math.sin(deg * RAD), nx = -dy, ny = dx;
  const tip = [p[0] + dx * len + nx * curl * len, p[1] + dy * len + ny * curl * len];
  const m = [p[0] + dx * len * 0.45 + nx * curl * len * 0.3, p[1] + dy * len * 0.45 + ny * curl * len * 0.3];
  return `M${pt(p)}Q${pt([m[0] + nx * w, m[1] + ny * w])} ${pt(tip)}Q${pt([m[0] - nx * w, m[1] - ny * w])} ${pt(p)}Z`;
}

function cubicPoints(p0, p1, p2, p3, n = 20) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

// Dải thuôn dọc một đường cong (lông đuôi cong của gà trống).
function ribbon(center, w0, w1) {
  const L = [], R = [];
  center.forEach((p, i) => {
    const a = center[Math.max(0, i - 1)], b = center[Math.min(center.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const w = lerp(w0, w1, i / (center.length - 1));
    L.push([p[0] + nx * w, p[1] + ny * w]);
    R.push([p[0] - nx * w, p[1] - ny * w]);
  });
  const all = [...L, ...R.reverse()];
  return `M${all.map(pt).join("L")}Z`;
}

/* ---------- hoa văn lông ---------- */

function markColor(fill, accent, kind) {
  if (kind === "mottled") return tint(fill, 0.85);
  if (Math.abs(luminance(fill) - luminance(accent)) > 0.18) return accent;
  return luminance(fill) > 0.45 ? shade(fill, 0.75) : tint(fill, 0.7);
}

function patternDef(pid, kind, fill, mark, o) {
  const op = f(o);
  switch (kind) {
    case "barred":
      return `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="8" height="6" patternTransform="rotate(-16)"><rect width="8" height="6" fill="${fill}"/><rect width="8" height="2.6" fill="${mark}" opacity="${op}"/></pattern>`;
    case "laced":
      return `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="10" height="9"><rect width="10" height="9" fill="${fill}"/><path d="M0,9A5,5 0 0 1 10,9M-5,4.5A5,5 0 0 1 5,4.5M5,4.5A5,5 0 0 1 15,4.5" fill="none" stroke="${mark}" stroke-width="1.5" opacity="${op}"/></pattern>`;
    case "spangled":
      return `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="10" height="10" fill="${fill}"/><g fill="${mark}" opacity="${op}"><path d="M5,3.2Q7.4,7.5 5,8.2Q2.6,7.5 5,3.2Z"/><path d="M0,-1.8Q2.4,2.5 0,3.2Q-2.4,2.5 0,-1.8ZM10,-1.8Q12.4,2.5 10,3.2Q7.6,2.5 10,-1.8Z"/></g></pattern>`;
    case "mottled":
      return `<pattern id="${pid}" patternUnits="userSpaceOnUse" width="12" height="11"><rect width="12" height="11" fill="${fill}"/><g fill="${mark}" opacity="${op}"><circle cx="2.5" cy="2.5" r="1.2"/><circle cx="8.5" cy="4.2" r="1"/><circle cx="5" cy="8.4" r="1.1"/><circle cx="11" cy="9.6" r=".8"/></g></pattern>`;
    default:
      return "";
  }
}

/* ---------- lông vũ ---------- */

// Một chiếc lông có cuống. P(u, v): u dọc theo lông (0 = gốc, l = ngọn), v ngang.
function featherGeom(p, deg, l, w, tip = "round", curl = 0) {
  const dx = Math.cos(deg * RAD), dy = Math.sin(deg * RAD), nx = -dy, ny = dx;
  const P = (u, v) => {
    const bend = curl * l * (u / l) ** 2;
    return [p[0] + dx * u + nx * (v + bend), p[1] + dy * u + ny * (v + bend)];
  };
  const d = tip === "round"
    ? `M${pt(P(0, -w * 0.55))}C${pt(P(l * 0.55, -w * 1.08))} ${pt(P(l * 0.98, -w * 0.85))} ${pt(P(l, 0))}C${pt(P(l * 0.98, w * 0.85))} ${pt(P(l * 0.55, w * 1.08))} ${pt(P(0, w * 0.55))}Z`
    : `M${pt(P(0, -w * 0.5))}Q${pt(P(l * 0.5, -w * 1.05))} ${pt(P(l, 0))}Q${pt(P(l * 0.5, w * 1.05))} ${pt(P(0, w * 0.5))}Z`;
  const shaft = `M${pt(P(l * 0.04, 0))}Q${pt(P(l * 0.5, 0))} ${pt(P(l * 0.88, 0))}`;
  return { d, shaft, P, l, w, deg, tip };
}

// Hoa văn trên TỪNG chiếc lông: viền, chấm giọt, sọc ngang, đốm trắng, sọc giữa.
function featherHtml(F, fill, o) {
  const { P, l, w } = F;
  const op = f(o.op ?? 1);
  const laced = o.kind === "laced";
  let s = `<path d="${F.d}" fill="${fill}" stroke="${laced ? o.mark : shade(fill, 0.4)}" stroke-width="${f(laced ? w * 0.34 : o.edge ?? 0.55)}"${laced ? ` stroke-opacity="${op}"` : ""}/>`;
  const hw = (u) => w * 0.8 * Math.sqrt(Math.max(0, 1 - (u / l) ** 2.4));
  if (o.kind === "barred") {
    let d = "";
    for (const k of F.tip === "round" ? [0.38, 0.66, 0.9] : [0.3, 0.52, 0.74]) {
      const u = k * l, h = hw(u);
      d += `M${pt(P(u, -h))}Q${pt(P(u + w * 0.45, 0))} ${pt(P(u, h))}`;
    }
    s += `<path d="${d}" fill="none" stroke="${o.mark}" stroke-width="${f(Math.min(l * 0.1, w * 0.5))}" opacity="${op}"/>`;
  } else if (o.kind === "spangled") {
    const c = P(l * 0.8, 0);
    s += `<ellipse cx="${f(c[0])}" cy="${f(c[1])}" rx="${f(l * 0.15)}" ry="${f(w * 0.48)}" transform="rotate(${f(F.deg)} ${f(c[0])} ${f(c[1])})" fill="${o.mark}" opacity="${op}"/>`;
  } else if (o.kind === "mottled") {
    const c = P(l * 0.88, 0);
    s += `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(w * 0.34)}" fill="${o.mark}" opacity="${op}"/>`;
  }
  if (o.stripe > 0.05) {
    s += `<path d="M${pt(P(0, -w * 0.16))}Q${pt(P(l * 0.55, -w * 0.3))} ${pt(P(l * 0.93, 0))}Q${pt(P(l * 0.55, w * 0.3))} ${pt(P(0, w * 0.16))}Z" fill="${o.stripeColor}" opacity="${f(o.stripe)}"/>`;
  }
  if (o.shaft) s += `<path d="${F.shaft}" fill="none" stroke="${o.shaft}" stroke-width="${f(Math.max(0.35, w * 0.12))}" stroke-linecap="round" opacity=".6"/>`;
  return s;
}

/* ---------- con gà ---------- */

// growth: 0 = vừa nở, 1 = trưởng thành. Một bộ khung duy nhất, chỉ đổi tỉ lệ theo tuổi.
// detail: "high" vẽ từng chiếc lông (sân khấu), "low" dùng mảng màu (ảnh nhỏ trong chuồng).
export function renderChicken(ph, opts = {}) {
  const g = clamp(opts.growth ?? 1);
  const hi = (opts.detail ?? "high") === "high";
  const id = `ck${(++uid).toString(36)}`;
  const S = ph.shape, K = ph.colors;
  const rooster = ph.sex === "rooster";
  const adult = smooth(0.12, 0.95, g);
  const mature = smooth(0.5, 1, g);
  const featherIn = smooth(0.3, 0.9, g);
  const rng = mulberry32((ph.seed ?? 1) + 101);
  const jitter = (c, k = 0.07) => mix(c, rng() < 0.5 ? "#000000" : "#ffffff", rng() * k);

  const L = lerp(0.8, S.bodyLength, adult);
  const H = lerp(1, S.plump, adult) * (rooster ? lerp(1, 0.95, mature) : 1);
  const tilt = -lerp(6, S.posture, adult) * RAD;
  const tiltDeg = tilt / RAD;
  const C = [100, 110];
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

  // màu từng vùng: lúc nhỏ là lông tơ, lớn dần thì ra màu và hoa văn thật
  const region = (c) => mix(K.down, c, featherIn);
  const fills = { body: region(K.base), wing: region(K.wing), tail: region(K.tail), hackle: region(K.hackle) };
  const kind = ph.pattern;
  const markOf = Object.fromEntries(Object.entries(fills).map(([k, c]) => [k, markColor(c, K.accent, kind)]));
  const defs = [];
  const fillOf = {};
  for (const [name, color] of Object.entries(fills)) {
    const pid = `${id}-p${name}`;
    const def = kind === "solid" ? "" : patternDef(pid, kind, color, markOf[name], featherIn * (name === "hackle" ? 0.7 : 1));
    defs.push(def);
    fillOf[name] = def ? `url(#${pid})` : color;
  }
  const line = (c) => shade(c, 0.5);
  const sheen = luminance(K.base) < 0.3 ? "#5fe0b4" : "#ffffff";
  defs.push(
    `<radialGradient id="${id}-shade" cx="38%" cy="28%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".24"/></radialGradient>`,
    `<linearGradient id="${id}-gloss" x1="0" y1="0" x2="1" y2="1"><stop offset=".25" stop-color="${sheen}" stop-opacity="0"/><stop offset=".45" stop-color="${sheen}" stop-opacity="${f(ph.care.gloss * 0.5 * featherIn)}"/><stop offset=".62" stop-color="${sheen}" stop-opacity="0"/></linearGradient>`,
    `<radialGradient id="${id}-comb" cx="45%" cy="65%" r="75%"><stop offset="0" stop-color="${tint(K.comb, 0.22)}"/><stop offset="1" stop-color="${shade(K.comb, 0.14)}"/></radialGradient>`,
    `<radialGradient id="${id}-iris" cx="50%" cy="50%" r="50%"><stop offset=".35" stop-color="${tint(mix("#2b211c", K.eye, adult), 0.25)}"/><stop offset="1" stop-color="${shade(mix("#2b211c", K.eye, adult), 0.2)}"/></radialGradient>`,
  );
  const part = (name, body) => (body ? `<g data-part="${name}">${body}</g>` : "");
  const path = (d, fill, stroke, extra = "") => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"${extra}/>`;
  const fopt = (name, extra = {}) => ({ kind, mark: markOf[name], op: featherIn, shaft: hi ? shade(fills[name], 0.45) : null, ...extra });
  const stripeColor = shade(mix(K.accent, K.hackle, 0.2), 0.1);

  const fluff = 1.6 * (1 - adult) + (S.silkie ? 2.4 : 0);
  const frizz = S.frizzle * 2.4 * adult;
  const featherSize = lerp(4.8, 8.6, S.featherSize ?? 0.5);

  /* thân */
  const bodyPts = [
    [38, -14], [44, 4], [30, 26], [0, 32], [-30, 24], [-44, 4], [-38, -14], [-10, -24], [20, -26],
  ].map(([x, y]) => rot(x * L, y * H));
  track(...bodyPts);
  const bodyD = texturedClosed(bodyPts, { fluff, frizz, per: S.silkie ? 4 : 6 });
  defs.push(`<clipPath id="${id}-cb"><path d="${bodyD}"/></clipPath>`);

  let bodyDetail = "";
  if (hi && featherIn > 0.04 && !S.silkie) {
    // lông vảy xếp như ngói: lông phía trước-trên đè lên lông phía sau-dưới
    const fs = featherSize;
    const items = [];
    const rowStep = fs * 0.66;
    for (let y = -28 * H, row = 0; y <= 33 * H; y += rowStep, row++) {
      for (let x = -47 * L + (row % 2) * fs * 0.42; x <= 46 * L; x += fs * 0.84) {
        if ((x / (47 * L)) ** 2 + (y / (32 * H)) ** 2 > 1.1) continue;
        items.push([x + (rng() - 0.5) * fs * 0.2, y + (rng() - 0.5) * fs * 0.15]);
      }
    }
    items.sort((a, b) => a[0] - a[1] * 0.5 - (b[0] - b[1] * 0.5));
    for (const [x, y] of items) {
      let a = 180 - 44 * clamp((y + 6 * H) / (34 * H)) - 22 * clamp((x - 16 * L) / (28 * L));
      let curl = (rng() - 0.5) * 0.12;
      if (S.frizzle) {
        a -= 150 + rng() * 30;
        curl = 0.22 * S.frizzle;
      }
      const l = fs * (1.15 + 0.3 * rng()) * (S.frizzle ? 1.15 + 0.15 * S.frizzle : 1);
      bodyDetail += featherHtml(featherGeom(rot(x, y), a + tiltDeg, l * 1.05, fs * 0.6, "round", curl), jitter(fills.body), fopt("body", { shaft: null, edge: 0.5 }));
    }
    bodyDetail = `<g clip-path="url(#${id}-cb)" opacity="${f(featherIn)}">${bodyDetail}</g>`;
  }
  if (hi && (S.silkie || featherIn < 0.98)) {
    // lông tơ: các nét ngắn lởm chởm (gà con, gà lông tơ)
    const amt = S.silkie ? Math.max(featherIn, 1 - featherIn) : 1 - featherIn;
    const base = S.silkie ? fills.body : K.down;
    let fuzz = "";
    for (let i = 0; i < (S.silkie ? 90 : 55); i++) {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng());
      const p = rot(Math.cos(a) * rr * 42 * L, Math.sin(a) * rr * 28 * H);
      const d = polar(p, 2.5 + rng() * 3, 150 + rng() * 60 + tiltDeg);
      const c = polar(p, 2, 120 + rng() * 100);
      fuzz += `<path d="M${pt(p)}Q${pt(c)} ${pt(d)}" stroke="${rng() < 0.5 ? tint(base, 0.35) : shade(base, 0.22)}"/>`;
    }
    bodyDetail += `<g clip-path="url(#${id}-cb)" fill="none" stroke-width=".8" stroke-linecap="round" opacity="${f(0.8 * amt)}">${fuzz}</g>`;
  }

  // lông tơ dưới bụng, sau đùi (nằm sau thân, chỉ lộ phần dưới)
  const ventFluff = adult > 0.3 && !S.silkie
    ? path(texturedClosed(sampleCircle(rot(-28 * L, 21 * H), 9 * Math.min(L, H), 8), { fluff: 1.5, per: 3 }), tint(fills.body, 0.14), line(fills.body), ` stroke-width="1"`)
    : "";

  /* đuôi */
  let tail = "";
  const tailG = smooth(0.25, 1, g);
  if (S.tailType !== "rumpless" && tailG > 0.02) {
    const anchor = rot(-34 * L, -12 * H);
    const longF = 1 + 0.35 * S.longTail;
    const baseAng = lerp(196, 252, S.tailAngle) + tiltDeg * 0.7;
    const len = 30 * S.tailLen * tailG * longF * (S.silkie ? 0.7 : 1);
    const curl = (S.tailCurl - 0.5) * 0.35;
    const n = S.tailCount;
    // lông đuôi cong phụ (gà trống) nằm sau cùng
    let sickles = "";
    if (rooster && mature > 0.02) {
      const nS = n > 6 ? 3 : 2;
      const Ls = len * mature;
      const sickle = (k, a0, w0, col) => {
        const p0 = add(anchor, [2, -2]);
        const p1 = polar(p0, Ls * k * 0.55, a0);
        const droop = S.longTail ? Ls * k * 0.45 * S.longTail : -Ls * k * 0.05 + (S.tailCurl - 0.5) * Ls * 0.4;
        const p3 = add(p0, [-Ls * k * 0.9, droop]);
        const p2 = add(p3, [Ls * k * 0.12, -Ls * k * (0.42 + S.tailCurl * 0.2)]);
        const pts = cubicPoints(p0, p1, p2, p3, 24);
        track(...pts.filter((_, i) => i % 4 === 0));
        let s = path(ribbon(pts, w0, 0.45), col, line(col), ` stroke-width="1"`);
        if (hi) {
          s += `<path d="M${pts.slice(0, 21).map(pt).join("L")}" fill="none" stroke="${tint(col, 0.35)}" stroke-width=".55" opacity=".7"/>`;
          s += `<path d="M${pts.slice(2, 16).map((q) => pt(add(q, [0.6, -0.9]))).join("L")}" fill="none" stroke="${sheen}" stroke-width=".9" stroke-linecap="round" opacity="${f(0.15 + ph.care.gloss * 0.45)}"/>`;
        }
        return s;
      };
      // lông cong phụ ngắn hơn, xoè rộng hơn
      for (let j = 0; j < 3; j++) sickles += sickle(0.62 + 0.1 * j, baseAng + 22 - j * 14, 2.6, shade(jitter(fills.tail), 0.06));
      for (let j = nS - 1; j >= 0; j--) sickles += sickle((1.12 + 0.2 * j) * (1 + 0.8 * S.longTail), baseAng + 10 - j * 6, 3.6, jitter(fills.tail, 0.05));
    }
    let fan = "";
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const a = baseAng + (t - 0.5) * 44;
      const l = len * (0.72 + 0.28 * Math.sin(Math.PI * t));
      const w = (S.silkie ? 7.5 : 5.6) * lerp(0.6, 1, tailG);
      const F = featherGeom(anchor, a, l, w * 0.62, "round", curl);
      fan += hi ? featherHtml(F, jitter(fills.tail), fopt("tail")) : path(leaf(anchor, a, l, w, curl), fillOf.tail, line(fills.tail));
      track(polar(anchor, l, a));
    }
    // lông bao đuôi: ngắn, phủ lên gốc đuôi
    let coverts = "";
    if (hi && adult > 0.3) {
      const cAnchor = add(anchor, polar([0, 0], 4, baseAng + 70));
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const F = featherGeom(add(cAnchor, [t * 3, t * 2]), baseAng + 18 - t * 40, len * (0.42 + 0.08 * Math.sin(Math.PI * t)), 3.4, "round", curl * 0.6);
        coverts += featherHtml(F, jitter(mix(fills.tail, fills.body, 0.5)), fopt("tail"));
      }
    }
    tail = sickles + fan + coverts;
  }

  /* chân */
  const belly = rot(2 * L, 30 * H);
  const legLen = lerp(11, 24 * S.legLen, adult);
  const footY = belly[1] + legLen;
  const legW = lerp(2.4, 3.4, adult);
  const toeL = lerp(5, 9, adult);
  const clawCol = luminance(K.leg) < 0.35 ? shade(K.leg, 0.3) : mix(K.leg, "#efe6d2", 0.55);
  const legHtml = (x, back) => {
    const col = back ? shade(K.leg, 0.18) : K.leg;
    const edge = shade(col, 0.42);
    const foot = [x, footY];
    const top = belly[1] - 6;
    let s = "";
    const toes = [[toeL, 1.6], [toeL * 0.78, 3], [-toeL * 0.48, 1.4]];
    if (S.toes > 4) toes.push([-toeL * 0.58, -0.6]);
    if (hi) {
      // ống chân thuôn có vảy, ngón có khớp và móng
      const w0 = legW * 0.62, w1 = legW * 0.48;
      s += `<path d="M${f(x - w0)},${f(top)}L${f(x - w1)},${f(footY)}L${f(x + w1)},${f(footY)}L${f(x + w0)},${f(top)}Z" fill="${col}" stroke="${edge}" stroke-width=".7" stroke-linejoin="round"/>`;
      const nScale = Math.max(3, Math.round(legLen / 2.6));
      let scales = "";
      for (let i = 1; i < nScale; i++) {
        const y = lerp(belly[1] + 1, footY - 1.2, i / nScale);
        const w = lerp(w0, w1, (y - top) / (footY - top));
        scales += `M${f(x - w)},${f(y)}Q${f(x + w * 0.2)},${f(y + 1.1)} ${f(x + w)},${f(y - 0.2)}`;
      }
      s += `<path d="${scales}" fill="none" stroke="${edge}" stroke-width=".45" opacity=".75"/>`;
      for (const [dx, dy] of toes) {
        const end = [x + dx, footY + dy];
        s += `<path d="M${pt(foot)}L${pt(end)}" stroke="${col}" stroke-width="${f(legW * 0.62)}" stroke-linecap="round" fill="none"/>`;
        const j = [x + dx * 0.5, footY + dy * 0.5];
        s += `<path d="M${f(j[0] - 0.2)},${f(j[1] - legW * 0.3)}l.4,${f(legW * 0.6)}" stroke="${edge}" stroke-width=".4" opacity=".7"/>`;
        const dir = Math.sign(dx) || 1;
        s += `<path d="M${pt(end)}q${f(dir * 1.6)},${f(0.1)} ${f(dir * 2)},${f(1.3)}" stroke="${clawCol}" stroke-width="${f(legW * 0.38)}" stroke-linecap="round" fill="none"/>`;
      }
    } else {
      s += `<path d="M${f(x)},${f(top)}L${pt(foot)}" stroke="${col}" stroke-width="${f(legW)}" stroke-linecap="round" fill="none"/>`;
      s += `<path d="${toes.map(([dx, dy]) => `M${pt(foot)}l${f(dx)},${f(dy)}`).join("")}" stroke="${col}" stroke-width="${f(legW * 0.62)}" stroke-linecap="round" fill="none"/>`;
    }
    if (rooster && mature > 0.3) {
      const y = footY - legLen * 0.35;
      const sl = 5 * mature;
      s += `<path d="M${f(x - legW * 0.4)},${f(y - 1.6)}Q${f(x - sl * 0.8)},${f(y - 0.6)} ${f(x - sl)},${f(y - 2.6)}Q${f(x - sl * 0.5)},${f(y + 1.6)} ${f(x - legW * 0.4)},${f(y + 1.6)}Z" fill="${shade(col, 0.1)}" stroke="${edge}" stroke-width=".5"/>`;
    }
    if (S.feetFeather) {
      const n = S.feetFeather === 2 ? (hi ? 9 : 6) : hi ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const y = lerp(belly[1] - 2, footY - 1, i / (n - 1 || 1));
        const F = featherGeom([x - 0.5, y], 112 - i * 5, lerp(4, 8, adult) * (S.feetFeather === 2 ? 1.2 : 1), 1.4, "pointed", 0.1);
        s += hi ? featherHtml(F, jitter(fills.body), fopt("body", { edge: 0.5 })) : path(leaf([x - 0.5, y], 112 - i * 6, lerp(4, 8, adult), 2.2), fillOf.body, line(fills.body), ` stroke-width="1"`);
      }
      if (S.feetFeather === 2) {
        for (let i = 0; i < (hi ? 3 : 1); i++) {
          const F = featherGeom([foot[0] + 1 + i * 2, foot[1] - 1.5 + i * 0.4], 8 - i * 6, toeL * (0.9 - i * 0.12), 1.5, "pointed", -0.1);
          s += featherHtml(F, jitter(fills.body), fopt("body", { edge: 0.5 }));
        }
      }
    }
    return s;
  };
  const thigh = (x, back) => {
    const c = back ? shade(fills.body, 0.12) : fills.body;
    const cx = x, cy = belly[1] - 3, rx = lerp(5, 8, adult) * L, ry = lerp(5, 9, adult);
    let s = `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${back || hi ? c : fillOf.body}" stroke="${line(c)}" stroke-width="1.2"/>`;
    if (hi && adult > 0.3) {
      for (let i = 0; i < 4; i++) {
        const F = featherGeom([cx - rx * 0.3 + i * rx * 0.25, cy + ry * 0.1], 118 - i * 6, ry * 0.95, rx * 0.32, "round");
        s += featherHtml(F, jitter(c), fopt("body", { shaft: null, edge: 0.45 }));
      }
    }
    return s;
  };
  const legs = ventFluff + legHtml(belly[0] - 6 * L, true) + thigh(belly[0] - 5 * L, true) + legHtml(belly[0] + 5 * L, false) + thigh(belly[0] + 4 * L, false);
  const ground = footY + 2.6;
  track([belly[0] + 5 * L + toeL + 2, ground]);

  /* cổ + lông bờm */
  const shoulder = rot(24 * L, -20 * H);
  const r = lerp(16, 12, adult) * (rooster ? lerp(1, 1.04, mature) : 1);
  const head = [shoulder[0] + lerp(6, 10 + 4 * S.neck, adult), shoulder[1] - lerp(16, 14 + 22 * S.neck, adult)];
  const neckBack = rot(-4 * L, -25 * H), neckFront = rot(36 * L, -4 * H);
  const headBack = add(head, [-r * 0.78, r * 0.15]);
  const throat = add(head, [r * 0.5, r * 0.62]);
  const neckPts = [
    headBack,
    add([(headBack[0] + neckBack[0]) / 2, (headBack[1] + neckBack[1]) / 2], [-3 * adult, 0]),
    neckBack,
    rot(16 * L, -12 * H),
    neckFront,
    add([(throat[0] + neckFront[0]) / 2, (throat[1] + neckFront[1]) / 2], [3 * adult, 0]),
    throat,
    add(head, [0, -r * 0.4]),
  ];
  const hackleStripe = (S.hackleStripe ?? 0) * featherIn;
  let hackle;
  if (adult < 0.2 || S.silkie) {
    hackle = path(texturedClosed(neckPts, { fluff, frizz: frizz * 0.8, per: 5 }), hi ? fills.hackle : fillOf.hackle, line(fills.hackle));
  } else {
    // áo choàng lông bờm: viền dưới là các mũi lông nhọn rủ xuống vai
    const backStart = rot(-10 * L, -21 * H), frontEnd = rot(37 * L, -1 * H);
    const nT = rooster ? 8 : 7;
    const tl = lerp(2, 7 + (rooster ? 6 * mature : 0), adult);
    const edge = (t) => add([lerp(backStart[0], frontEnd[0], t), lerp(backStart[1], frontEnd[1], t)], [0, Math.sin(Math.PI * t) * 9 * H * adult]);
    const ang = S.frizzle ? -55 : 108 + tiltDeg * 0.4;
    let d = `M${pt(headBack)}Q${pt(add(neckPts[1], [-2 * adult, 0]))} ${pt(backStart)}`;
    for (let i = 0; i < nT; i++) {
      const t0 = i / nT, t1 = (i + 1) / nT, tm = (t0 + t1) / 2;
      const tip = polar(edge(tm), tl * (0.75 + 0.25 * Math.sin(Math.PI * tm)) * (S.frizzle ? 1.2 : 1), ang - tm * 18);
      const ctrl = add(edge(tm), [0, -tl * 0.1]);
      d += `Q${pt(ctrl)} ${pt(tip)}Q${pt(add(edge(t1), [-1, -1]))} ${pt(add(edge(t1), [0, -tl * 0.15]))}`;
    }
    d += `Q${pt(neckPts[5])} ${pt(throat)}Q${pt(add(head, [r * 0.2, r * 0.2]))} ${pt(headBack)}Z`;
    hackle = path(d, hi ? fills.hackle : fillOf.hackle, line(fills.hackle));
    if (hi) {
      // lông bờm mọc trên mặt cổ, chảy xuôi xuống vai; hàng trên đè hàng dưới
      const n = rooster ? 12 : 10;
      const top = (t) => add([lerp(headBack[0], throat[0], t), lerp(headBack[1], throat[1], t)], [0, r * 0.1]);
      for (const v of [0.78, 0.6, 0.42]) {
        for (let i = 0; i < n; i++) {
          const t = clamp((i + (v === 0.6 ? 0.5 : 0) + (rng() - 0.5) * 0.3) / n);
          const e = edge(t);
          const base = add([lerp(top(t)[0], e[0], v), lerp(top(t)[1], e[1], v)], [0, 0]);
          const tipAt = polar(e, tl * (0.55 + 0.25 * Math.sin(Math.PI * t)) * (S.frizzle ? 1.3 : 1), (S.frizzle ? -40 : 122 - t * 30) + tiltDeg * 0.4);
          const l = Math.hypot(tipAt[0] - base[0], tipAt[1] - base[1]) * (0.95 + rng() * 0.1);
          const a = Math.atan2(tipAt[1] - base[1], tipAt[0] - base[0]) / RAD;
          const F = featherGeom(base, a, l, lerp(1.5, 2.3, adult) * (1.1 - v * 0.3), "pointed", S.frizzle ? 0.25 : (rng() - 0.5) * 0.08);
          hackle += featherHtml(F, jitter(fills.hackle, 0.08), fopt("hackle", { stripe: hackleStripe, stripeColor, edge: 0.45, op: featherIn * 0.85 }));
        }
      }
    }
    hackle += `<path d="${d}" fill="url(#${id}-shade)" opacity=".45"/>`;
  }

  /* lông yên (gà trống): lông dài nhọn rủ từ lưng xuống gốc đuôi */
  let saddle = "";
  if (rooster && mature > 0.05) {
    const sl = (S.saddle ?? 0.5);
    const n = hi ? 11 : 6;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const base = rot(lerp(-2, -30, t) * L, lerp(-24, -15, t) * H - 1);
      const a = lerp(132, 162, t) + tiltDeg * 0.6 + (S.frizzle ? -150 : 0);
      const l = lerp(9, 16, Math.sin(Math.PI * (0.3 + t * 0.6))) * mature * lerp(0.7, 1.5, sl);
      const F = featherGeom(base, a, l, 2.1, "pointed", S.frizzle ? 0.3 : 0.08);
      saddle += hi ? featherHtml(F, jitter(fills.hackle, 0.08), fopt("hackle", { stripe: hackleStripe, stripeColor, edge: 0.45 })) : path(F.d, fillOf.hackle, line(fills.hackle), ` stroke-width="1"`);
      track(F.P(l, 0));
    }
  }

  /* cánh */
  const ws = lerp(0.42, 0.88, adult);
  const wa = [16 * L, -12 * H];
  const wp = (x, y) => rot(wa[0] + (x * L - wa[0]) * ws, wa[1] + (y * H - wa[1]) * ws);
  const dr = S.wingDroop * 7 * adult;
  const drDeg = S.wingDroop * 10 * adult;
  const wingPts = [
    wp(18, -10), wp(-2, -14), wp(-26, -7), wp(-46, 5 + dr / H),
    wp(-32, 10 + dr / H * 0.7), wp(-18, 12 + dr / H * 0.5), wp(-4, 11 + dr / H * 0.3), wp(8, 6),
  ];
  let wing = `<path d="${smoothClosed(wingPts)}" fill="#000" opacity=".13" transform="translate(1.2 2)"/>`;
  if (hi && adult > 0.25 && !S.silkie) {
    const wl = ws * L;
    const prim = region(shade(mix(K.wing, K.accent, 0.45), 0.08));
    // lông sơ cấp: dài, nhọn, ở mút cánh
    for (let i = 4; i >= 0; i--) {
      const F = featherGeom(wp(-14 - i * 3, 2 + i * 1.7 + dr / H * 0.6), 184 - i * 6 + tiltDeg + drDeg, (25 - i * 1.6) * wl, 2.6 * ws, "pointed", 0.04);
      wing += featherHtml(F, jitter(prim), fopt("wing", { mark: markColor(prim, K.accent, kind) }));
      track(F.P(F.l, 0));
    }
    // lông thứ cấp: tròn đầu, xếp thành mép dưới cánh
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const F = featherGeom(wp(lerp(-16, 10, t), lerp(3, 1, t) + dr / H * 0.5), lerp(172, 148, t) + tiltDeg + drDeg, lerp(14, 10, t) * wl, 4 * ws, "round", 0.05);
      wing += featherHtml(F, jitter(fills.wing), fopt("wing"));
    }
    // mảng lông bao cánh phía trên + hàng lông bao lớn (vạch cánh)
    const covPts = [wp(18, -10), wp(-2, -14), wp(-24, -7), wp(-29, 1), wp(-12, 5), wp(6, 4), wp(13, 0)];
    const covD = smoothClosed(covPts);
    defs.push(`<clipPath id="${id}-cw"><path d="${covD}"/></clipPath>`);
    wing += path(covD, fills.wing, line(fills.wing), ` stroke-width="1.1"`);
    let small = "";
    const fs = featherSize * 0.72;
    for (let y = -15, row = 0; y <= 6; y += fs * 0.62, row++) {
      for (let x = -30 + (row % 2) * fs * 0.4; x <= 18; x += fs * 0.8) {
        small += featherHtml(featherGeom(wp(x, y), 172 - (y + 15) * 1.2 + tiltDeg, fs * 1.2, fs * 0.55, "round"), jitter(fills.wing), fopt("wing", { shaft: null, edge: 0.45 }));
      }
    }
    wing += `<g clip-path="url(#${id}-cw)">${small}</g>`;
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const F = featherGeom(wp(lerp(-24, 10, t), lerp(-2, -1, t)), lerp(168, 150, t) + tiltDeg + drDeg * 0.5, lerp(9, 7.5, t) * wl, 3.3 * ws, "round");
      wing += featherHtml(F, jitter(shade(fills.wing, 0.04)), fopt("wing"));
    }
    wing += `<path d="${covD}" fill="url(#${id}-shade)" opacity=".55"/>`;
  } else {
    wing += path(texturedClosed(wingPts, { fluff: fluff * 0.8, frizz: frizz * 0.6, per: 4 }), fillOf.wing, line(fills.wing));
    wing += `<path d="${smoothClosed(wingPts)}" fill="url(#${id}-shade)" opacity=".7"/>`;
    if (adult > 0.3) {
      const fl = line(fills.wing);
      wing += `<path d="M${pt(wp(10, -2))}Q${pt(wp(-8, 2))} ${pt(wp(-26, 0))}M${pt(wp(-30, 10 + dr / H * 0.7))}L${pt(wp(-22, 4))}M${pt(wp(-18, 12 + dr / H * 0.5))}L${pt(wp(-13, 6))}M${pt(wp(-6, 12 + dr / H * 0.3))}L${pt(wp(-3, 7))}" fill="none" stroke="${fl}" stroke-width="1" stroke-linecap="round" opacity="${f(0.55 * adult)}"/>`;
    }
  }

  /* đầu */
  const combG = smooth(0.35, 1, g);
  const faceCol = K.comb;
  const combScale = S.combSize * (rooster ? lerp(0.75, 1.3, mature) : 0.7) * (S.crest ? 0.5 : 1) * combG;
  const ch = combScale * 12;
  const comb = combPath(S.combType, head, r, ch, rooster);
  if (comb.top) track(comb.top);
  let combHtml = "";
  if (combScale > 0.03) {
    combHtml = path(comb.d, hi ? `url(#${id}-comb)` : faceCol, shade(faceCol, 0.4)) + (comb.extra ? `<path d="${comb.extra}" fill="none" stroke="${shade(faceCol, 0.4)}" stroke-width="1"/>` : "");
    if (hi) {
      // vân sần trên mào
      const [a0, a1, hgt] = { single: [-36, -150, 0.9], rose: [-44, -134, 0.38], pea: [-58, -118, 0.4], walnut: [-58, -118, 0.55] }[S.combType];
      let dots = "";
      for (let i = 0; i < Math.round(8 + ch); i++) {
        const p = polar(head, r + ch * (0.12 + rng() * hgt * 0.55), lerp(a0, a1, rng()));
        dots += `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(0.25 + rng() * 0.3)}"/>`;
      }
      combHtml += `<g fill="${shade(faceCol, 0.3)}" opacity=".45">${dots}</g>`;
    }
  }

  const wl = (rooster ? 13 : 7) * S.wattle * combG * (S.muff ? 0.35 : 1);
  let wattleHtml = "";
  if (wl > 0.6) {
    const wf = hi ? `url(#${id}-comb)` : faceCol;
    wattleHtml = path(leaf(add(head, [r * 0.5, r * 0.55]), 98, wl, wl * 0.4, 0.06), shade(faceCol, 0.12), shade(faceCol, 0.45)) +
      path(leaf(add(head, [r * 0.62, r * 0.55]), 92, wl * 0.95, wl * 0.4, -0.04), wf, shade(faceCol, 0.45));
    if (hi) {
      const c0 = add(head, [r * 0.66, r * 0.7]);
      wattleHtml += `<path d="M${pt(c0)}q${f(wl * 0.12)},${f(wl * 0.35)} 0,${f(wl * 0.6)}" fill="none" stroke="${shade(faceCol, 0.4)}" stroke-width=".5" opacity=".6"/>`;
    }
  }

  const fluffyHead = S.silkie || fluff > 1;
  // đầu liền với cổ: chỉ viền nửa trên + phía trước, không viền chỗ nối cổ
  let headHtml = `<path d="${fluffyHead ? texturedClosed(sampleCircle(head, r, 10), { fluff: fluff * 0.7, per: 3 }) : circlePath(head, r)}" fill="${fills.hackle}"${fluffyHead ? ` stroke="${line(fills.hackle)}" stroke-width="1.4"` : ""}/>`;
  if (!fluffyHead) {
    const h0 = polar(head, r, 138), h1 = polar(head, r, 52);
    headHtml += `<path d="M${pt(h0)}A${f(r)},${f(r)} 0 1 1 ${pt(h1)}" fill="none" stroke="${line(fills.hackle)}" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  if (hi && featherIn > 0.2) {
    // lông nhỏ trên đỉnh và gáy
    let crown = "";
    for (let i = 0; i < 9; i++) {
      const p = polar(head, r * (0.45 + rng() * 0.4), -150 + rng() * 120);
      crown += `M${pt(p)}q${f(-1.6)},${f(0.6)} ${f(-2.8)},${f(1.8)}`;
    }
    headHtml += `<path d="${crown}" fill="none" stroke="${shade(fills.hackle, 0.32)}" stroke-width=".55" stroke-linecap="round" opacity="${f(0.5 * featherIn)}"/>`;
  }
  headHtml += `<circle cx="${f(head[0])}" cy="${f(head[1])}" r="${f(r)}" fill="url(#${id}-shade)" opacity=".6"/>`;
  if (kind !== "solid" && adult < 0.95) {
    headHtml += `<path d="M${pt(add(head, [-r * 0.7, -r * 0.35]))}Q${pt(add(head, [-r * 0.1, -r * 0.95]))} ${pt(add(head, [r * 0.45, -r * 0.55]))}" fill="none" stroke="${shade(K.down, 0.35)}" stroke-width="${f(r * 0.22)}" stroke-linecap="round" opacity="${f(0.7 * (1 - adult))}"/>`;
  }
  let faceHtml = "";
  if (combG > 0.05) {
    faceHtml = `<ellipse cx="${f(head[0] + r * 0.34)}" cy="${f(head[1] + r * 0.12)}" rx="${f(r * 0.5)}" ry="${f(r * 0.46)}" fill="${faceCol}" opacity="${f(combG * 0.95)}"/>`;
    if (hi && mature > 0.3) {
      // nếp da dưới mắt
      const e = add(head, [r * 0.3, r * 0.22]);
      faceHtml += `<path d="M${pt(add(e, [-r * 0.22, 0]))}q${f(r * 0.2)},${f(r * 0.12)} ${f(r * 0.42)},0M${pt(add(e, [-r * 0.16, r * 0.14]))}q${f(r * 0.16)},${f(r * 0.09)} ${f(r * 0.32)},0" fill="none" stroke="${shade(faceCol, 0.35)}" stroke-width=".45" opacity="${f(0.55 * mature)}"/>`;
    }
  }
  let earHtml = "";
  if (combG > 0.1) {
    earHtml = `<ellipse cx="${f(head[0] - r * 0.08)}" cy="${f(head[1] + r * 0.46)}" rx="${f(2.3 * combG)}" ry="${f(3.1 * combG)}" fill="${K.earlobe}" stroke="${shade(K.earlobe, 0.3)}" stroke-width=".8"/>`;
    if (hi) {
      // chùm lông tai che lỗ tai, nằm ngay trên dái tai
      const e = add(head, [-r * 0.12, r * 0.18]);
      let tuft = "";
      for (let i = 0; i < 5; i++) tuft += `M${pt(add(e, [i * 0.7, -i * 0.3]))}q${f(-1.6)},${f(1)} ${f(-2.6 - i * 0.2)},${f(2.4)}`;
      earHtml += `<path d="${tuft}" fill="none" stroke="${shade(fills.hackle, 0.35)}" stroke-width=".55" stroke-linecap="round" opacity="${f(0.8 * combG)}"/>`;
    }
  }

  const eyeR = lerp(4.4, 2.2, adult) * S.eyeSize;
  const eyeC = add(head, [r * 0.34, -r * 0.14]);
  const iris = mix("#2b211c", K.eye, adult);
  let eyeHtml = "";
  if (hi && combG > 0.1) {
    eyeHtml += `<circle cx="${f(eyeC[0])}" cy="${f(eyeC[1])}" r="${f(eyeR * 1.38)}" fill="${shade(faceCol, 0.08)}" opacity="${f(combG)}"/>`;
  }
  eyeHtml += `<g class="ck-eye"><circle cx="${f(eyeC[0])}" cy="${f(eyeC[1])}" r="${f(eyeR)}" fill="${hi ? `url(#${id}-iris)` : iris}" stroke="${shade(iris, 0.5)}" stroke-width=".7"/><circle cx="${f(eyeC[0] + eyeR * 0.1)}" cy="${f(eyeC[1])}" r="${f(eyeR * (adult > 0.5 ? 0.5 : 0.62))}" fill="#120c08"/><circle cx="${f(eyeC[0] + eyeR * 0.35)}" cy="${f(eyeC[1] - eyeR * 0.38)}" r="${f(eyeR * 0.3)}" fill="#fff"/>`;
  if (hi) {
    eyeHtml += `<circle cx="${f(eyeC[0] - eyeR * 0.3)}" cy="${f(eyeC[1] + eyeR * 0.35)}" r="${f(eyeR * 0.12)}" fill="#fff" opacity=".7"/>`;
    eyeHtml += `<path d="M${f(eyeC[0] - eyeR * 1.05)},${f(eyeC[1] - eyeR * 0.15)}Q${f(eyeC[0])},${f(eyeC[1] - eyeR * 1.55)} ${f(eyeC[0] + eyeR * 1.05)},${f(eyeC[1] - eyeR * 0.2)}" fill="none" stroke="${shade(combG > 0.1 ? faceCol : fills.hackle, 0.45)}" stroke-width="${f(Math.max(0.5, eyeR * 0.22))}" stroke-linecap="round"/>`;
  }
  eyeHtml += `</g>`;

  const bl = lerp(5.5, 4 + 6 * S.beakLen, adult);
  const bh = r * 0.3;
  const bx = head[0] + r * 0.8, by = head[1] + r * 0.12;
  const cv = S.beakCurve * bl * 0.35;
  const tipB = [bx + bl, by + cv * 0.6];
  let beakHtml =
    path(`M${f(bx - 1)},${f(by + bh * 0.25)}L${f(bx + bl * 0.66)},${f(by + bh * 0.3 + cv * 0.35)}Q${f(bx + bl * 0.25)},${f(by + bh * 0.95)} ${f(bx - 2)},${f(by + bh * 0.9)}Z`, shade(K.beak, 0.12), shade(K.beak, 0.45), ` stroke-width="1"`) +
    path(`M${f(bx - 2)},${f(by - bh)}Q${f(bx + bl * 0.6)},${f(by - bh * 0.9 + cv * 0.2)} ${pt(tipB)}L${f(bx - 1)},${f(by + bh * 0.2)}Z`, K.beak, shade(K.beak, 0.45), ` stroke-width="1"`);
  if (hi) {
    // sống mỏ, lỗ mũi, khoé mỏ, chóp mỏ sẫm
    beakHtml += `<path d="M${f(bx - 0.5)},${f(by - bh * 0.78)}Q${f(bx + bl * 0.55)},${f(by - bh * 0.68 + cv * 0.2)} ${f(bx + bl * 0.9)},${f(tipB[1] - bh * 0.12)}" fill="none" stroke="${tint(K.beak, 0.5)}" stroke-width=".6" stroke-linecap="round" opacity=".8"/>`;
    beakHtml += `<ellipse cx="${f(bx + bl * 0.16)}" cy="${f(by - bh * 0.5)}" rx="${f(Math.max(0.6, bl * 0.09))}" ry="${f(Math.max(0.35, bh * 0.14))}" fill="${shade(K.beak, 0.6)}" transform="rotate(-12 ${f(bx + bl * 0.16)} ${f(by - bh * 0.5)})"/>`;
    beakHtml += `<path d="M${f(bx - 1.5)},${f(by + bh * 0.22)}L${f(bx + bl * 0.64)},${f(by + bh * 0.28 + cv * 0.35)}" stroke="${shade(K.beak, 0.6)}" stroke-width=".6" stroke-linecap="round"/>`;
    beakHtml += `<path d="M${f(bx + bl * 0.72)},${f(by - bh * 0.55 + cv * 0.3)}Q${f(bx + bl * 0.85)},${f(by - bh * 0.2 + cv * 0.4)} ${pt(tipB)}L${f(bx + bl * 0.66)},${f(by + bh * 0.25 + cv * 0.35)}Z" fill="${shade(K.beak, 0.25)}" opacity=".55"/>`;
  }
  track(tipB, [head[0], head[1] - r]);

  let crestHtml = "";
  if (S.crest) {
    const n = S.crest === 2 ? (hi ? 22 : 15) : hi ? 14 : 10;
    const cl = r * (S.crest === 2 ? 1.05 : 0.72) * lerp(0.5, 1, adult);
    const cc = add(head, [-r * 0.08, -r * 0.62]);
    const col = region(tint(K.hackle, 0.08));
    const order = [...Array(n).keys()].sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
    for (const i of order) {
      const t = i / (n - 1);
      const a = lerp(-178, 8, t);
      const l = cl * (0.8 + 0.2 * Math.sin(Math.PI * t)) * (0.9 + rng() * 0.2);
      if (hi) crestHtml += featherHtml(featherGeom(cc, a, l, 1.9, "pointed", i % 2 ? 0.16 : -0.12), jitter(col), fopt("hackle", { kind: "solid", edge: 0.5, shaft: shade(col, 0.35) }));
      else crestHtml += path(leaf(cc, a, l, 3.4, i % 2 ? 0.14 : -0.1), col, line(col), ` stroke-width="1"`);
      track(polar(cc, cl, a));
    }
  }
  let muffHtml = "";
  if (S.muff) {
    const mc = add(head, [r * 0.5, r * 0.62]);
    const col = region(K.hackle);
    const n = hi ? 11 : 7;
    for (let i = 0; i < n; i++) {
      const a = lerp(25, 165, i / (n - 1));
      const l = r * lerp(0.35, 0.58, adult) * (0.85 + rng() * 0.3);
      muffHtml += hi
        ? featherHtml(featherGeom(mc, a, l, 1.6, "pointed", i % 2 ? 0.14 : -0.14), jitter(col), fopt("hackle", { kind: "solid", edge: 0.45, shaft: null }))
        : path(leaf(mc, a, l, 2.8, i % 2 ? 0.12 : -0.12), col, line(col), ` stroke-width="1"`);
    }
  }

  /* sọc lưng gà con */
  let stripes = "";
  if (kind !== "solid" && adult < 0.95) {
    const sc = shade(K.down, 0.42);
    stripes = `<path d="M${pt(rot(-30 * L, -14 * H))}Q${pt(rot(-6 * L, -26 * H))} ${pt(rot(16 * L, -22 * H))}M${pt(rot(-28 * L, -4 * H))}Q${pt(rot(-6 * L, -14 * H))} ${pt(rot(12 * L, -12 * H))}" fill="none" stroke="${sc}" stroke-width="4.2" stroke-linecap="round" opacity="${f(0.8 * (1 - adult))}"/>`;
  }

  /* ghép lớp và canh vừa khung */
  const GY = 186;
  const want = S.size * lerp(0.95, 1.3, smooth(0, 1, g));
  const width = box.x1 - box.x0 + 6;
  const height = ground - box.y0 + 4;
  const s = Math.min(want, 188 / width, (GY - 6) / height);
  const tx = 100 - s * (box.x0 + box.x1) / 2;
  const ty = GY - s * ground;
  const neckPivot = rot(22 * L, -18 * H);

  const svg = [
    `<svg class="chicken" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.label ?? "Gà"}">`,
    `<defs>${defs.join("")}</defs>`,
    `<g transform="translate(${f(tx)} ${f(ty)}) scale(${s.toFixed(3)})" stroke-linejoin="round">`,
    `<ellipse cx="${f(belly[0])}" cy="${f(ground)}" rx="${f(38 * L)}" ry="5" fill="#000" opacity=".12"/>`,
    `<g class="ck-bob">`,
    part("tail", tail),
    part("legs", legs),
    part("body", path(bodyD, hi ? fills.body : fillOf.body, line(fills.body)) + bodyDetail + `<path d="${smoothClosed(bodyPts)}" fill="url(#${id}-shade)"/><path d="${smoothClosed(bodyPts)}" fill="url(#${id}-gloss)"/>` + stripes),
    `<g class="ck-head" style="transform-origin:${f(neckPivot[0])}px ${f(neckPivot[1])}px">`,
    part("hackle", hackle),
    part("comb", combHtml),
    part("wattle", wattleHtml),
    part("head", headHtml),
    part("face", faceHtml),
    part("earlobe", earHtml),
    part("eye", eyeHtml),
    part("beak", beakHtml),
    part("crest", crestHtml),
    part("muff", muffHtml),
    `</g>`,
    part("wing", wing),
    part("saddle", saddle),
    `</g></g></svg>`,
  ];
  return svg.join("");
}

function circlePath(c, r) {
  return `M${f(c[0] - r)},${f(c[1])}a${f(r)},${f(r)} 0 1 0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1 0 ${f(-2 * r)},0Z`;
}
function sampleCircle(c, r, n) {
  return [...Array(n).keys()].map((i) => polar(c, r, (i / n) * 360));
}

// Mào: 4 kiểu theo 2 gen R và P (giống di truyền thật ở gà).
function combPath(type, hc, r, ch, rooster) {
  const P = (deg, rad) => polar(hc, rad, deg);
  if (ch <= 0.3) return { d: "", top: null };
  if (type === "single") {
    const a0 = -32, a1 = rooster ? -158 : -142;
    const n = Math.max(4, Math.min(6, Math.round(3 + ch / 4)));
    const val = (t) => P(lerp(a0, a1, t), r + ch * 0.26);
    let d = `M${pt(P(a0, r * 0.5))}L${pt(val(0))}`;
    let top = null;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const prof = 0.68 + 0.32 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      const tip = P(lerp(a0, a1, t) - 7, r + ch * prof * 1.5);
      d += `Q${pt(tip)} ${pt(val((i + 1) / n))}`;
      if (!top || tip[1] < top[1]) top = tip;
    }
    return { d: d + `L${pt(P(a1, r * 0.5))}Z`, top };
  }
  if (type === "rose") {
    const a0 = -40, a1 = -138, n = 7;
    const val = (t) => P(lerp(a0, a1, t), r + ch * 0.14);
    let d = `M${pt(P(a0, r * 0.55))}L${pt(val(0))}`;
    for (let i = 0; i < n; i++) d += `Q${pt(P(lerp(a0, a1, (i + 0.5) / n), r + ch * 0.48))} ${pt(val((i + 1) / n))}`;
    const leader = add(P(-165, r + ch * 0.22), [-ch * 0.75, 0]);
    d += `L${pt(P(-150, r + ch * 0.3))}L${pt(leader)}L${pt(P(-160, r * 0.75))}Z`;
    return { d, top: P(-90, r + ch * 0.45) };
  }
  if (type === "pea") {
    const a0 = -55, a1 = -122, n = 3;
    const val = (t) => P(lerp(a0, a1, t), r + ch * 0.1);
    let d = `M${pt(P(a0, r * 0.6))}L${pt(val(0))}`;
    for (let i = 0; i < n; i++) d += `Q${pt(P(lerp(a0, a1, (i + 0.5) / n), r + ch * 0.62))} ${pt(val((i + 1) / n))}`;
    return { d: d + `L${pt(P(a1, r * 0.6))}Z`, top: P(-90, r + ch * 0.4) };
  }
  const d = `M${pt(P(-52, r * 0.65))}L${pt(P(-52, r + ch * 0.08))}C${pt(P(-58, r + ch * 0.8))} ${pt(P(-118, r + ch * 0.8))} ${pt(P(-124, r + ch * 0.08))}L${pt(P(-124, r * 0.65))}Z`;
  const extra = `M${pt(P(-70, r + ch * 0.32))}Q${pt(P(-88, r + ch * 0.55))} ${pt(P(-106, r + ch * 0.32))}`;
  return { d, extra, top: P(-88, r + ch * 0.6) };
}

/* ---------- quả trứng ---------- */

export function renderEgg(ph, opts = {}) {
  const crack = clamp(opts.crack ?? 0);
  const shell = ph.egg.shell;
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    const sy = Math.sin(t);
    pts.push([100 + 33 * Math.cos(t) * (1 + 0.1 * sy), 128 + 42 * sy]);
  }
  const d = smoothClosed(pts);
  const rng = mulberry32(ph.egg.seed + 7);
  let dots = "";
  const nDots = Math.round(ph.egg.speckle * 40);
  for (let i = 0; i < nDots; i++) {
    const a = rng() * Math.PI * 2, rr = Math.sqrt(rng());
    dots += `<ellipse cx="${f(100 + Math.cos(a) * rr * 26)}" cy="${f(124 + Math.sin(a) * rr * 34)}" rx="${f(0.8 + rng() * 1.8)}" ry="${f(0.7 + rng() * 1.4)}" fill="${shade(shell, 0.55)}" opacity="${f(0.5 + rng() * 0.4)}"/>`;
  }
  let cracks = "";
  if (crack > 0) {
    const n = Math.round(3 + crack * 7);
    let x = 70, s = `M70,118`;
    for (let i = 0; i < n; i++) {
      x += 60 / 10;
      s += `L${f(x)},${f(118 + (i % 2 ? -5 : 5) * Math.min(1, crack * 1.5))}`;
    }
    cracks = `<path d="${s}" fill="none" stroke="${shade(shell, 0.6)}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  const label = opts.label ?? "Trứng";
  return `<svg class="egg${opts.wobble ? " is-wobble" : ""}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}"><ellipse cx="100" cy="171" rx="30" ry="5" fill="#000" opacity=".12"/><g class="egg-shell" data-part="egg"><path d="${d}" fill="${shell}" stroke="${shade(shell, 0.35)}" stroke-width="1.6"/>${dots}<ellipse cx="88" cy="106" rx="8" ry="13" fill="#fff" opacity=".35" transform="rotate(18 88 106)"/>${cracks}</g></svg>`;
}

export { smoothClosed, texturedClosed, sampleCircle, cubicPoints, ribbon, markColor };
