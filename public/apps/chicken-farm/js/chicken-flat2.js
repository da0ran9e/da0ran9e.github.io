// Trại Gà — kiểu vẽ "Phẳng 2": thân, cổ, đầu là MỘT bóng liền mạch.
// Bóng gà dựng từ 16 điểm mốc (đo theo ảnh mẫu): mông, bụng, ngực, cổ trước, cằm,
// trán, đỉnh đầu, gáy, chỗ trũng sau cổ, lưng... Gen dịch các điểm mốc (cổ dài, thân
// dài, độ tròn, dáng đứng); gà con có bộ mốc riêng và trôi dần sang bộ của gà lớn.
// Cánh, đuôi, mặt, mào dùng chung các khối hữu cơ với "Phẳng 1".

import { clamp, lerp, mix, shade, tint, luminance, mulberry32 } from "./genome.js";
import { smoothClosed, markColor } from "./chicken-svg.js";
import { vivid, blob, fuzzBlob, tongue, brushStroke, shaggy, paintFilter } from "./chicken-flat.js";

const RAD = Math.PI / 180;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const f = (n) => Math.round(n * 10) / 10;
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const lerp2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const polar = (c, r, deg) => [c[0] + r * Math.cos(deg * RAD), c[1] + r * Math.sin(deg * RAD)];
const pt = (p) => `${f(p[0])},${f(p[1])}`;
let uid = 0;

// Điểm mốc bóng gà (đơn vị: bán kính thân ≈ 32), theo chiều kim đồng hồ từ mông.
const ADULT = {
  rear: [-33, -4], lowRear: [-29, 15], belly: [-3, 33], frontBelly: [20, 26], breast: [34, 5],
  neckLow: [33, -16], throat: [38, -31], headLow: [49, -37], headFront: [55, -47], headTopF: [49, -57],
  headTopB: [39, -59], nape: [30, -53], neckUp: [22, -41], neckValley: [14, -28], backTop: [-4, -32], backTail: [-24, -24],
};
const CHICK = {
  rear: [-27, 4], lowRear: [-22, 20], belly: [-2, 33], frontBelly: [16, 28], breast: [26, 14],
  neckLow: [27, 1], throat: [28, -11], headLow: [32, -17], headFront: [35, -27], headTopF: [30, -38],
  headTopB: [19, -42], nape: [8, -38], neckUp: [3, -29], neckValley: [-1, -20], backTop: [-12, -20], backTail: [-22, -12],
};
const ORDER = Object.keys(ADULT);
const NECK = new Set(["neckLow", "throat", "headLow", "headFront", "headTopF", "headTopB", "nape", "neckUp", "neckValley"]);
const HEAD_ADULT = { c: [44, -47], r: 11 };
const HEAD_CHICK = { c: [20, -26], r: 15 };

export function renderChickenFlat2(ph, opts = {}) {
  const g = clamp(opts.growth ?? 1);
  const id = `cg${(++uid).toString(36)}`;
  const S = ph.shape, K = ph.colors;
  const rooster = ph.sex === "rooster";
  const adult = smooth(0.12, 0.95, g);
  const mature = smooth(0.5, 1, g);
  const featherIn = smooth(0.3, 0.9, g);
  const combG = smooth(0.35, 1, g);
  const seed = ph.seed ?? 1;
  const R = (k) => mulberry32(seed + k * 7919);

  /* bảng màu */
  const region = (c) => vivid(mix(K.down, c, featherIn));
  const bodyC = region(K.base);
  const neckC = mix(bodyC, region(K.hackle), 0.8);
  const wingC = mix(bodyC, luminance(bodyC) > 0.6 ? shade(mix(bodyC, region(K.wing), 0.4), 0.16) : tint(mix(bodyC, region(K.wing), 0.3), 0.32), lerp(0.35, 1, featherIn));
  const tailCols = [region(shade(K.tail, 0.2)), region(K.accent), region(shade(K.base, 0.08)), region(shade(K.accent, 0.25))];
  const pop = vivid(K.leg, 1.4);
  const face = vivid(mix(K.comb, "#f39a3c", 0.5));
  const mark = markColor(bodyC, K.accent, ph.pattern);

  /* điểm mốc: gen dịch mốc gà lớn, rồi trộn với mốc gà con theo tuổi */
  const Lb = lerp(1, S.bodyLength, 0.5), Hb = lerp(1, S.plump, 0.6);
  const neckK = lerp(0.82, 1.2, clamp((S.neck - 0.6) / 0.8));
  const adultPt = (name, [x, y]) => {
    if (!NECK.has(name)) return [x * Lb, y * Hb];
    const y2 = -20 + (y + 20) * neckK;
    return [x + (Lb - 1) * 30 - (y2 - y) * 0.2, y2];
  };
  const tilt = -lerp(2, S.posture * 0.4, adult) * RAD;
  const tiltDeg = tilt / RAD;
  const C = [96, 118];
  const place = ([x, y]) => [C[0] + x * Math.cos(tilt) - y * Math.sin(tilt), C[1] + x * Math.sin(tilt) + y * Math.cos(tilt)];
  const rj = R(1);
  const P = {};
  for (const k of ORDER) {
    const a = adultPt(k, ADULT[k]);
    P[k] = place(add(lerp2(CHICK[k], a, adult), [(rj() - 0.5) * 1.6, (rj() - 0.5) * 1.6]));
  }
  const headA = adultPt("headTopB", HEAD_ADULT.c);
  const hc = place(lerp2(HEAD_CHICK.c, headA, adult));
  const r = lerp(HEAD_CHICK.r, HEAD_ADULT.r, adult) * (rooster ? lerp(1, 1.05, mature) : 1);
  // vị trí theo khung thân (chưa có mốc) — dùng cho cánh, hoa văn, chân
  const rot = (x, y) => place([x * Lb, y * Hb]);

  const box = { x0: Infinity, x1: -Infinity, y0: Infinity };
  const track = (...ps) => ps.forEach((p) => {
    box.x0 = Math.min(box.x0, p[0]);
    box.x1 = Math.max(box.x1, p[0]);
    box.y0 = Math.min(box.y0, p[1]);
  });
  track(...Object.values(P));
  const part = (name, body) => (body ? `<g data-part="${name}">${body}</g>` : "");
  const fill = (d, c, extra = "") => `<path d="${d}" fill="${c}"${extra}/>`;

  /* bóng gà liền mạch */
  const pts = ORDER.map((k) => P[k]);
  const fluffAmp = 1.5 * (1 - adult) + (S.silkie ? 2.6 : 0);
  const silD = S.frizzle && adult > 0.3
    ? shaggy(R(2), pts, S.frizzle * 2.4 * adult, 2, 0.6)
    : fluffAmp > 0.5 ? shaggy(R(2), pts, fluffAmp, 3) : smoothClosed(pts);

  /* hoa văn (trong bóng, chủ yếu vùng thân) */
  let pattern = "";
  if (ph.pattern !== "solid" && featherIn > 0.05) {
    const rp = R(4);
    let m = "";
    if (ph.pattern === "barred") {
      for (let k = 0; k < 8; k++) {
        const y = -36 + k * 9.5 + (rp() - 0.5) * 3;
        const line = [-44, -26, -8, 10, 28, 46].map((x, i) => rot(x, y + Math.sin(i * 1.7 + k) * 2.2));
        m += fill(brushStroke(rp, line, 2.1), mark);
      }
    } else if (ph.pattern === "laced") {
      for (let y = -26, row = 0; y <= 30; y += 9, row++) {
        for (let x = -40 + (row % 2) * 6; x <= 40; x += 12) {
          const a = rot(x - 5, y), b = rot(x + 5, y), c = rot(x, y + 6);
          m += fill(brushStroke(rp, [a, lerp2(a, c, 0.6), c, lerp2(b, c, 0.6), b], 1.1), mark);
        }
      }
    } else {
      const spang = ph.pattern === "spangled";
      for (let y = -26, row = 0; y <= 30; y += spang ? 9 : 7, row++) {
        for (let x = -40 + (row % 2) * 6; x <= 40; x += spang ? 12 : 9) {
          const p = rot(x + (rp() - 0.5) * 5, y + (rp() - 0.5) * 4);
          m += fill(spang ? blob(rp, p, 2.2, 3, tiltDeg - 20 + (rp() - 0.5) * 30, 0.18, 8) : blob(rp, p, 0.9 + rp() * 0.8, 0.9 + rp() * 0.6, rp() * 180, 0.2, 7), mark);
        }
      }
    }
    pattern = `<g clip-path="url(#${id}-cs)" opacity="${f(featherIn * 0.9)}">${m}</g>`;
  }

  /* cổ khác màu (bờm): phủ vùng cổ + đầu, mép dưới là vài phiến rủ */
  let hackle = "";
  const capeShow = adult > 0.3 && !S.silkie && (rooster || Math.abs(luminance(neckC) - luminance(bodyC)) > 0.05);
  if (capeShow) {
    const rc = R(5);
    const A = add(P.neckValley, [-11, 5]), B = add(P.breast, [2, -13]);
    hackle += `<g clip-path="url(#${id}-cs)">${fill(smoothClosed([A, lerp2(A, B, 0.5), B, add(B, [26, 4]), add(B, [40, -90]), add(A, [-6, -70])]), neckC)}</g>`;
    const tl = lerp(4, 8 + (rooster ? 7 * mature : 0), adult) * (S.frizzle ? 1.2 : 1);
    const n = rooster ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = add(lerp2(A, B, t), [0, -4 + Math.sin(Math.PI * t) * 1.5]);
      const deg = (S.frizzle ? -70 + t * 30 : 114 - t * 36) + tiltDeg * 0.5 + (rc() - 0.5) * 10;
      hackle += fill(tongue(rc, p, deg, tl * (0.75 + 0.5 * Math.sin(Math.PI * t)) + 4, 3.6, { tip: "point", bend: (rc() - 0.5) * 0.3 }).d, neckC);
      if (S.hackleStripe > 0.05) {
        hackle += fill(tongue(rc, add(p, [0, 1]), deg, tl * 0.8 + 2, 0.9, { tip: "point" }).d, shade(K.accent, 0.1), ` opacity="${f(S.hackleStripe * featherIn)}"`);
      }
    }
  }

  /* lông yên (gà trống) */
  let saddle = "";
  if (rooster && mature > 0.1 && !S.silkie) {
    const rs = R(6);
    const sl = lerp(7, 17, S.saddle ?? 0.5) * mature;
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const base = add(lerp2(P.backTop, P.backTail, t), [0, 3]);
      const deg = lerp(120, 152, t) + tiltDeg + (S.frizzle ? -140 : 0) + (rs() - 0.5) * 10;
      const tg = tongue(rs, base, deg, sl * (0.7 + 0.5 * Math.sin(Math.PI * (0.2 + t * 0.7))), 3.4, { tip: "point", bend: -0.2 + (rs() - 0.5) * 0.2 });
      saddle += fill(tg.d, neckC);
      track(tg.end);
    }
  }

  /* cánh: phần lưng trên-sau, mép dưới là các lưỡi lông nghiêng về sau */
  const rw = R(7);
  const ws = lerp(0.5, 1, adult);
  const wp = (x, y) => rot(x * ws + (1 - ws) * -6, y * ws + (1 - ws) * -6);
  const lobes = adult < 0.3 ? 2 : 3 + Math.round((1 - (S.featherSize ?? 0.5)) * 2);
  const droop = S.wingDroop * 6 * adult;
  const x0 = -36, x1 = 13;
  let wing = fill(smoothClosed([wp(9, -48), wp(-46, -48), wp(-46, -5), wp(-12, -3 + droop * 0.5), wp(x1 + 3, -5), wp(x1 + 2, -20)]), wingC);
  if (S.silkie) {
    wing = fill(shaggy(rw, [wp(9, -40), wp(x0 - 6, -40), wp(x0, 8), wp(-14, 12), wp(4, 10), wp(x1 + 2, -12)], 1.8, 3), wingC);
  } else {
    for (let i = 0; i < lobes; i++) {
      const t = (i + 0.5) / lobes;
      const base = wp(lerp(x0 + 1, x1 - 3, t), -7 + (rw() - 0.5) * 2);
      const deg = 96 + lerp(22, 6, t) + tiltDeg + (rw() - 0.5) * 8;
      const len = (lerp(14, 21, Math.sin(Math.PI * (0.25 + t * 0.6))) + rw() * 5 + droop) * ws;
      const w = ((x1 - x0) / lobes) * 0.64 * ws * (0.85 + rw() * 0.3);
      wing += fill(tongue(rw, base, deg, len, w, { tip: S.frizzle ? "point" : "round", bend: (rw() - 0.5) * 0.18 - 0.06, base: 0.9 }).d, wingC);
    }
  }
  wing = `<g clip-path="url(#${id}-cs)">${wing}</g>`;

  /* đuôi: 3 lớp — phiến tối dài phía sau, phiến màu phụ, nét mảnh màu nhấn, phiến ngắn phía trước */
  let tail = "";
  const tailG = smooth(0.2, 1, g);
  if (S.tailType !== "rumpless" && tailG > 0.02) {
    const rt = R(8);
    const longF = 1 + 0.45 * S.longTail;
    const len = 46 * S.tailLen * tailG * longF * (S.silkie ? 0.55 : 1);
    const center = lerp(194, 230, S.tailAngle) + tiltDeg * 0.6;
    const curl = (S.tailCurl - 0.5) * 0.4;
    const top = add(P.backTail, [2, 3]), bottom = add(P.rear, [3, 2]);
    const blade = (t, k, col, opt = {}) => {
      const p = add(lerp2(top, bottom, t), [(rt() - 0.5) * 3, (rt() - 0.5) * 3]);
      const tg = tongue(rt, p, center + (0.5 - t) * 36 + (rt() - 0.5) * 8, len * k * (0.88 + rt() * 0.24), opt.w ?? lerp(4.4, 8, adult) * (0.85 + rt() * 0.3) * (S.silkie ? 1.2 : 1), {
        tip: opt.tip ?? (S.silkie || rt() < 0.75 ? "round" : "point"),
        bend: curl + (rt() - 0.5) * 0.25,
        base: opt.base ?? 0.75,
        irr: opt.irr ?? 0.14,
      });
      track(tg.end);
      return fill(tg.d, col);
    };
    if (rooster && mature > 0.05 && !S.silkie) {
      for (let j = 0; j < 2; j++) {
        const p = add(lerp2(top, bottom, 0.12 + j * 0.15), [2, 0]);
        const tg = tongue(rt, p, center + 26 - j * 10, len * mature * (1.35 + 0.15 * j) * (1 + 0.4 * S.longTail), 4.6, { tip: "point", bend: -0.5 - curl - 0.25 * S.longTail, irr: 0.1, base: 0.85 });
        tail += fill(tg.d, j ? tailCols[1] : tailCols[3]);
        track(tg.end, tg.P(len * 0.6, 0));
      }
    }
    const n = Math.max(3, S.tailCount);
    for (let i = 0; i < Math.ceil(n / 2); i++) tail += blade(rt() * 0.6, 1.1, tailCols[0]); // lớp sau: tối, dài
    for (let i = 0; i < Math.floor(n / 2) + 1; i++) tail += blade(0.2 + rt() * 0.7, 0.95, tailCols[1]); // lớp giữa: màu phụ
    if (adult > 0.4) for (let i = 0; i < 3; i++) tail += blade(0.15 + i * 0.3, 1, pop, { w: 1, tip: "point", base: 0.6, irr: 0.05 }); // nét nhấn
    for (let i = 0; i < 2; i++) tail += blade(0.6 + rt() * 0.4, 0.7, tailCols[2]); // lớp trước: ngắn
  }

  /* chân */
  const rl = R(9);
  const belly = add(P.belly, [3, -2]);
  const legLen = lerp(10, 22 * S.legLen, adult);
  const footY = belly[1] + legLen;
  const lw = lerp(1.7, 2.1, adult);
  let legs = "";
  for (const [dx, back] of [[-6, true], [5, false]]) {
    const col = back ? shade(K.leg, 0.15) : K.leg;
    const top = [belly[0] + dx, belly[1] - 6];
    const foot = [top[0] - 2.5, footY];
    const len = Math.hypot(foot[0] - top[0], foot[1] - top[1]);
    const deg = Math.atan2(foot[1] - top[1], foot[0] - top[0]) / RAD;
    let s = fill(tongue(rl, top, deg, len + lw * 0.6, lw, { tip: "round", base: 1, irr: 0.05 }).d, col);
    const tl = lerp(5, 12, adult);
    const toes = [[2, tl], [16, tl * 0.82], [178, tl * 0.5]];
    if (S.toes > 4) toes.push([196, tl * 0.45]);
    for (const [d, l] of toes) s += fill(tongue(rl, add(foot, [0, -lw * 0.4]), d + (rl() - 0.5) * 6, l, lw * 1.05, { tip: "round", base: 0.95, irr: 0.08 }).d, col);
    if (rooster && mature > 0.3) s += fill(tongue(rl, [foot[0] + lw * 0.2, footY - legLen * 0.38], 192, 5 * mature, lw * 0.75, { tip: "point", base: 1 }).d, col);
    if (S.feetFeather) {
      for (let i = 0; i < (S.feetFeather === 2 ? 4 : 2); i++) {
        const q = lerp2(top, foot, 0.25 + i * 0.2);
        s += fill(tongue(rl, add(q, [-1, -2]), 128 + (rl() - 0.5) * 16, S.feetFeather === 2 ? 8 : 6, 2.6, { tip: "round" }).d, bodyC);
      }
      if (S.feetFeather === 2) s += fill(tongue(rl, add(foot, [1, -2.5]), 6, tl * 0.9, 2.4, { tip: "round" }).d, bodyC);
    }
    legs += s;
  }
  const ground = footY + 2.6;
  track([belly[0] + 14, ground]);

  /* mặt, mắt, mỏ */
  const rf = R(10);
  const faceAlpha = smooth(0.3, 0.85, g);
  const faceC = add(hc, [r * 0.22, -r * 0.04]);
  const faceHtml = faceAlpha > 0.02 ? fill(fuzzBlob(rf, faceC, r * 1.32, { irr: 0.07, tuft: 0.05, n: 18, ry: 0.97 }), face, ` opacity="${f(faceAlpha)}"`) : "";
  const earHtml = combG > 0.1 && K.earlobe !== K.comb ? fill(blob(rf, [hc[0] - r * 0.6, hc[1] + r * 0.5], 2.6 * combG, 3.6 * combG, 10, 0.12, 8), K.earlobe) : "";
  const es = S.eyeSize, er = lerp(1, 1.65, adult);
  const eyeC = add(hc, [r * 0.24, -r * 0.06]);
  const pupil = mix("#2a1418", "#160b0d", adult);
  const re = R(11);
  let eyeHtml = `<g class="ck-eye">`;
  if (adult > 0.3) eyeHtml += fill(blob(re, eyeC, r * 0.57 * er * es, r * 0.55 * er * es, 0, 0.07, 10), tint(pop, 0.45), ` opacity="${f(faceAlpha)}"`);
  eyeHtml += fill(blob(re, eyeC, r * lerp(0.36, 0.46, adult) * er * es, r * lerp(0.36, 0.44, adult) * er * es, 0, 0.05, 10), "#fbf7ef");
  const irisC = add(eyeC, [r * 0.09, r * 0.01]);
  eyeHtml += fill(blob(re, irisC, r * lerp(0.28, 0.33, adult) * er * es, r * lerp(0.28, 0.34, adult) * er * es, 0, 0.04, 9), mix(pupil, K.eye, adult * 0.85));
  eyeHtml += fill(blob(re, add(irisC, [r * 0.02, 0]), r * 0.24 * er * es, r * 0.26 * er * es, 0, 0.05, 9), pupil);
  if (adult < 0.5) eyeHtml += `<circle cx="${f(eyeC[0] + r * 0.18)}" cy="${f(eyeC[1] - r * 0.1)}" r="${f(r * 0.07)}" fill="#fff"/>`;
  eyeHtml += `</g>`;

  const bl = lerp(6, 7 + 7 * S.beakLen, adult);
  const cv = S.beakCurve * bl * 0.5;
  const bA = add(hc, [r * 1.12, r * 0.26]), bB = add(hc, [r * 0.88, r * 0.86]);
  const tip = add(hc, [r * 1.12 + bl, r * 0.82 + cv]);
  const beakC = adult > 0.3 ? shade(K.beak, 0.55) : mix(K.beak, "#f2a640", 0.4);
  let beakHtml = fill(`M${pt(bA)}C${pt(add(bA, [bl * 0.55, -r * 0.04]))} ${pt(add(tip, [-bl * 0.12, -r * 0.4]))} ${pt(tip)}C${pt(add(tip, [-bl * 0.3, r * 0.04]))} ${pt(add(bB, [bl * 0.35, r * 0.12]))} ${pt(bB)}Q${pt(add(bA, [-r * 0.12, r * 0.3]))} ${pt(bA)}Z`, beakC);
  if (adult > 0.3) beakHtml += fill(brushStroke(re, [add(bA, [1.4, 1.5]), add(lerp2(bA, tip, 0.5), [0.5, -0.4]), add(tip, [-2.2, -1.2])], 0.55), tint(pop, 0.3), ` opacity=".85"`);
  track(tip);

  const wl = (rooster ? 5.4 : 3.4) * S.wattle * combG * (S.muff ? 0.4 : 1);
  const wattleHtml = wl > 0.4
    ? fill(tongue(re, add(hc, [r * 0.7, r * 1.02]), 98, wl * 2.1, wl * 0.8, { tip: "round", base: 0.8 }).d, shade(K.comb, 0.1))
      + fill(tongue(re, add(hc, [r * 1.0, r * 0.94]), 86, wl * 1.8, wl * 0.72, { tip: "round", base: 0.8 }).d, K.comb)
    : "";

  /* mào: phiến to, tròn, ngả về sau như cánh hoa */
  const rk = R(12);
  const combScale = S.combSize * (rooster ? lerp(0.75, 1.3, mature) : 0.75) * (S.crest ? 0.5 : 1) * combG;
  const ch = combScale * 13;
  let combHtml = "";
  if (ch > 0.6) {
    if (S.combType === "single") {
      const n = Math.min(5, 3 + Math.round(S.combSize) + (rooster ? 1 : 0));
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const a = lerp(-62, -146, t) + (rk() - 0.5) * 8;
        const h = ch * (0.72 + 0.38 * Math.sin(Math.PI * (0.2 + t * 0.8))) * (0.85 + rk() * 0.3);
        const tg = tongue(rk, polar(hc, r * 0.5, a), a - 10, h + r * 0.45, h * 0.46 * (0.85 + rk() * 0.3), { tip: "round", bend: -0.14 + (rk() - 0.5) * 0.1, base: 0.7 });
        combHtml += fill(tg.d, K.comb);
        track(tg.end);
      }
    } else if (S.combType === "rose") {
      combHtml += fill(blob(rk, polar(hc, r * 0.82, -100), r * 0.75, ch * 0.32 + 1, -8, 0.14, 10), K.comb);
      combHtml += fill(tongue(rk, polar(hc, r * 0.85, -140), 186, ch * 0.9 + r * 0.3, ch * 0.16 + 0.8, { tip: "point", bend: -0.15 }).d, K.comb);
    } else if (S.combType === "pea") {
      for (let i = 0; i < 3; i++) combHtml += fill(blob(rk, polar(hc, r * 0.9, lerp(-72, -118, i / 2)), ch * 0.24 + 0.6, ch * 0.3 + 0.6, lerp(-72, -118, i / 2) + 90, 0.15, 8), K.comb);
    } else {
      combHtml += fill(blob(rk, polar(hc, r * 0.88 + ch * 0.18, -96), ch * 0.55 + 0.5, ch * 0.42 + 0.5, -10, 0.16, 10), K.comb);
    }
  }

  let crestHtml = "";
  if (S.crest) {
    const rr = R(13);
    const n = S.crest === 2 ? 11 : 7;
    const cl = r * (S.crest === 2 ? 1.0 : 0.7) * lerp(0.55, 1, adult);
    for (let i = 0; i < n; i++) {
      const a = lerp(-172, -8, i / (n - 1)) + (rr() - 0.5) * 12;
      const tg = tongue(rr, polar(add(hc, [-r * 0.1, -r * 0.3]), r * 0.2, a), a, cl * (0.75 + 0.4 * Math.sin(Math.PI * i / (n - 1))) * (0.85 + rr() * 0.3), cl * 0.22, { tip: rr() < 0.5 ? "round" : "point", bend: (rr() - 0.5) * 0.3 });
      crestHtml += fill(tg.d, tint(neckC, 0.18));
      track(tg.end);
    }
  }
  const muffHtml = S.muff ? fill(fuzzBlob(R(14), add(hc, [r * 0.62, r * 0.95]), r * 0.46, { tuft: 0.2, n: 16, ry: 1.1 }), tint(neckC, 0.08)) : "";

  /* sọc lưng gà con */
  let stripes = "";
  if (ph.pattern !== "solid" && adult < 0.95) {
    const rs = R(15);
    const col = shade(K.down, 0.35), op = ` opacity="${f(0.75 * (1 - adult))}"`;
    stripes = fill(brushStroke(rs, [add(P.backTail, [2, 4]), add(P.backTop, [0, 4]), add(P.neckValley, [0, 3]), add(P.nape, [2, 3]), add(P.headTopB, [2, 4])], 2.2), col, op);
  }

  /* ghép lớp, canh khung */
  const GY = 186;
  const want = S.size * lerp(0.95, 1.3, smooth(0, 1, g));
  const width = box.x1 - box.x0 + 8;
  const height = ground - box.y0 + 6;
  const s = Math.min(want, 186 / width, (GY - 6) / height);
  const tx = 100 - s * (box.x0 + box.x1) / 2;
  const ty = GY - s * ground;
  const defs = [
    paintFilter(`${id}-r`, seed, false, 1.4),
    `<clipPath id="${id}-cs"><path d="${silD}"/></clipPath>`,
  ];
  // cả bóng gà là một khối nên nhịp mổ dùng chung cho đầu: chỉ các chi tiết trên đầu chuyển động
  const pivot = add(P.neckValley, [6, 4]);

  return [
    `<svg class="chicken is-flat" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.label ?? "Gà"}">`,
    `<defs>${defs.join("")}</defs>`,
    `<g transform="translate(${f(tx)} ${f(ty)}) scale(${s.toFixed(3)})">`,
    `<ellipse cx="${f(belly[0] - 2)}" cy="${f(ground)}" rx="${f(32 * Lb)}" ry="4.5" fill="#000" opacity=".08"/>`,
    `<g class="ck-bob" filter="url(#${id}-r)">`,
    part("tail", tail),
    part("legs", legs),
    part("comb", combHtml),
    part("body", fill(silD, bodyC) + pattern + stripes),
    part("hackle", hackle ? `<g clip-path="url(#${id}-cs)">${hackle}</g>` : ""),
    part("wing", wing),
    part("saddle", saddle),
    `<g class="ck-head-soft" style="transform-origin:${f(pivot[0])}px ${f(pivot[1])}px">`,
    part("crest", crestHtml),
    part("face", faceHtml),
    part("earlobe", earHtml),
    part("wattle", wattleHtml),
    part("muff", muffHtml),
    part("eye", eyeHtml),
    part("beak", beakHtml),
    `</g>`,
    `</g></g></svg>`,
  ].join("");
}
