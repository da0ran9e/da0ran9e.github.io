// Trại Gà — cây trong vườn (v11). DÁNG theo loài (`form` trong SEEDS), CHI TIẾT theo thành phần dinh dưỡng của hạt:
//   khoáng → lá to, xanh đậm · đạm → nhiều quả / hạt hơn · năng lượng → bông, bắp mẩy hơn · sắc tố → hoa, quả đậm màu hơn
//   hạt giàu (tổng chất cao) → cây lớn hơn.
// Dáng: grass (lúa, kê) · vine (đậu leo) · bush (vừng) · flower (vạn thọ) · tall (hướng dương) · stalk (ngô)
//        creeper (bí bò đất) · low (đậu phộng, củ dưới đất) · pond (sen trong chậu nước). Dáng lạ → grass.
// growth 0..1 (mầm → lớn → ra hoa / quả), ready: chín. seed: số để mỗi cây hơi khác nhau. Khung 60×70, đất ở y=62.

const PI = Math.PI;
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const CX = 30, GY = 62;
const svg = (body, cls) => `<svg class="${cls}" viewBox="0 0 60 70" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

// lá nhọn hai đầu từ (x,y) dài L, rộng W, hướng deg (0 = sang phải, -90 = thẳng lên)
function leaf(x, y, L, W, deg, c, vein) {
  const r = (deg * PI) / 180, ux = Math.cos(r), uy = Math.sin(r), vx = -uy, vy = ux;
  const mx = x + ux * L * 0.5, my = y + uy * L * 0.5, tx = x + ux * L, ty = y + uy * L;
  let o = `<path d="M${f1(x)},${f1(y)} Q${f1(mx + vx * W)},${f1(my + vy * W)} ${f1(tx)},${f1(ty)} Q${f1(mx - vx * W)},${f1(my - vy * W)} ${f1(x)},${f1(y)}Z" fill="${c}"/>`;
  if (vein) o += `<path d="M${f1(x)},${f1(y)} L${f1(x + ux * L * 0.85)},${f1(y + uy * L * 0.85)}" stroke="${vein}" stroke-width=".6" opacity=".5"/>`;
  return o;
}
const line = (d, c, w = 1.4, extra = "") => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round"${extra}/>`;
const dot = (x, y, r, c, extra = "") => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${c}"${extra}/>`;
const oval = (x, y, rx, ry, c, deg = 0, extra = "") => `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="${c}"${deg ? ` transform="rotate(${f1(deg)} ${f1(x)} ${f1(y)})"` : ""}${extra}/>`;
// hoa nhiều cánh quanh (x,y)
function bloom(x, y, R, petals, c, core, ratio = 0.32) {
  let o = "";
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * PI * 2, px = x + Math.cos(a) * R * 0.85, py = y + Math.sin(a) * R * 0.85;
    o += oval(px, py, R * 0.55, R * ratio, c, (a * 180) / PI);
  }
  return o + dot(x, y, R * 0.45, core);
}

const FORMS = {
  // lúa / kê: khóm lá mảnh + bông. Nhiều năng lượng → bông kê đuôi chồn mập; còn lại → bông lúa rủ hạt.
  grass(P, kind = "") {
    let o = "";
    const N = 7 + Math.round(P.m * 4);
    for (let i = 0; i < N; i++) {
      const a = (-90 + (i - (N - 1) / 2) * 11 + (P.rnd() - 0.5) * 8) * PI / 180, L = 26 + P.rnd() * 12;
      o += line(`M${f1(CX + (i - N / 2) * 0.8)},${GY} q${f1(Math.cos(a) * L * 0.3)},${f1(Math.sin(a) * L * 0.6)} ${f1(Math.cos(a) * L * 0.6)},${f1(Math.sin(a) * L)}`, i % 2 ? P.leaf : P.leafL, 1.9);
    }
    const foxtail = P.e > 0.45 && !kind, heads = (kind ? 3 : 3) + Math.round(P.p * 4);
    for (let i = 0; i < heads; i++) {
      const sx = CX + (i - (heads - 1) / 2) * 5, tx = sx + (i - (heads - 1) / 2) * 3, ty = 14 + P.rnd() * 8;
      o += line(`M${f1(CX)},${GY} Q${f1(sx)},${f1(GY - 24)} ${f1(tx)},${f1(ty)}`, P.stem, 1.1);
      if (!P.fk) continue;
      const side = i < (heads - 1) / 2 ? -1 : 1;
      if (kind === "sorghum") { // bông cao lương dựng, hạt tròn nâu đỏ
        const c = P.ready ? "#a8492c" : "#b9a45a";
        for (let k = 0; k < 9; k++) o += dot(tx + ((k % 3) - 1) * 1.7 * (0.6 + P.fk * 0.5), ty - 2 - Math.floor(k / 3) * 2.2 * (0.6 + P.fk * 0.5), 1.2 + 0.5 * P.fk, k % 2 ? c : (P.ready ? "#8a3a20" : "#a8984a"));
      } else if (kind === "wheat") { // bông lúa mì dựng, có râu
        const c = P.ready ? "#d9a85a" : "#a9c25e", L = 4 + 5 * P.fk;
        for (let k = 0; k < 5; k++) { const y = ty - k * L * 0.22; o += oval(tx - 1.1, y, 1, 1.7, c, -20) + oval(tx + 1.1, y - 0.6, 1, 1.7, c, 20) + line(`M${f1(tx - 1.4)},${f1(y - 1)} l-2.2,-4 M${f1(tx + 1.4)},${f1(y - 1.6)} l2.2,-4`, P.ready ? "#c9a060" : "#9cb85a", 0.4); }
      } else if (foxtail) {
        const c = P.ready ? "#dfa63a" : "#c9cf6a";
        o += oval(tx + side * 2.5, ty + 5, 2 + 1.2 * P.fk, 3 + 5 * P.fk, c, side * 28);
        o += oval(tx + side * 1.6, ty + 3, 0.8, 2.2 * P.fk + 0.5, "#fff6c4", side * 28, ` opacity=".5"`);
      } else {
        const ex = tx + side * 8, ey = ty + 10;
        o += line(`M${f1(tx)},${f1(ty)} q${f1(side * 5)},-2 ${f1(ex - tx)},${f1(ey - ty)}`, P.ready ? "#b99a3c" : P.stem, 0.8);
        for (let k = 1; k <= 5; k++) { const t = k / 5.5; o += oval(tx + (ex - tx) * t + side * 1.2 * Math.sin(t * PI), ty + (ey - ty) * t * t - 1, 1.1, 1.9 * P.fk + 0.4, P.ready ? "#e8c35a" : "#b9cf6a", side * 30); }
      }
    }
    return o;
  },
  sorghum(P) { return FORMS.grass(P, "sorghum"); },
  wheat(P) { return FORMS.grass(P, "wheat"); },
  // bông vải: thân bụi, lá xẻ thuỳ, hoa vàng nhạt; chín thì quả nang nứt ra nắm bông trắng
  cotton(P) {
    let o = line(`M${CX},${GY} L${CX},18 M${CX},44 Q${CX - 9},36 ${CX - 12},26 M${CX},36 Q${CX + 9},28 ${CX + 12},20`, "#7a6a3a", 1.6);
    for (const [x, y, d] of [[CX - 5, 54, -1], [CX + 5, 48, 1], [CX - 7, 40, -1], [CX + 6, 33, 1], [CX - 3, 26, -1]]) {
      const r = 4.2 + P.m * 3;
      for (const a of [-50, 0, 50]) o += leaf(x, y, r, r * 0.45, (d > 0 ? -30 : -150) + a, P.leaf);
    }
    const spots = [[CX, 16], [CX - 12, 24], [CX + 12, 18], [CX - 5, 32], [CX + 7, 30]];
    for (const [x, y] of spots) {
      if (!P.fk) continue;
      if (P.fk < 0.6) { o += bloom(x, y, 1.6 + P.fk * 2, 5, "#f6e7a6", "#c9506a", 0.4); continue; }
      if (!P.ready) { o += oval(x, y, 2.2 + P.fk, 2.8 + P.fk, "#7f9f45"); continue; }
      o += path4(x, y) + [[-2, -1.4], [2, -1.4], [0, -3.2], [-1.4, 1], [1.4, 1]].map(([dx, dy]) => dot(x + dx, y + dy, 2.1, "#fbf8f0", ` stroke="#d8d0c0" stroke-width=".4"`)).join("");
    }
    return o;
  },
  // cải dầu: thân mảnh cao, lá ôm thân dưới gốc, chùm hoa vàng bốn cánh trên ngọn; chín thì quả cải dài mảnh
  canola(P) {
    let o = "";
    for (const d of [-1, 1]) for (let i = 0; i < 2; i++) o += leaf(CX, GY - 4 - i * 6, 9 + P.m * 6 - i * 2, 3 + P.m * 2, d > 0 ? -25 - i * 15 : -155 + i * 15, P.leaf, P.leafD);
    const stems = [[CX - 7, 12], [CX, 6], [CX + 7, 12]];
    for (const [x, y] of stems) {
      o += line(`M${CX},${GY - 6} Q${f1((CX + x) / 2)},${f1(GY - 30)} ${x},${y}`, P.stem, 1.1);
      if (!P.fk) continue;
      if (P.ready) for (let k = 0; k < 5; k++) o += line(`M${f1(x)},${f1(y + 3 + k * 3)} l${k % 2 ? 4 : -4},-3`, "#a99a5a", 0.9);
      else for (let k = 0; k < 6; k++) { const fx = x + ((k % 3) - 1) * 2.2, fy = y + Math.floor(k / 3) * 2.4; o += bloom(fx, fy, 0.9 + P.fk * 1.1, 4, "#f7d322", "#e0a020", 0.42); }
    }
    return o;
  },
  // đậu leo: hai cọc tre + giàn, dây leo, lá ba chét, quả đậu treo (đạm càng nhiều càng sai quả)
  vine(P) {
    let o = line(`M${CX - 10},${GY + 1} L${CX - 8},8 M${CX + 10},${GY + 1} L${CX + 8},8 M${CX - 9},12 L${CX + 9},12`, "#c9a66b", 1.8);
    for (const d of [-1, 1]) o += line(`M${CX},${GY - 2} C${CX + d * 12},${GY - 18} ${CX - d * 4},${GY - 32} ${CX + d * 9},12`, P.stem, 1.3);
    for (let i = 0; i < 6; i++) {
      const y = GY - 10 - i * 7.5, d = i % 2 ? 1 : -1, x = CX + d * (3 + (i % 3) * 2);
      for (const a of [-40, 10, 60]) o += leaf(x, y, 5 + P.m * 6, 2.2 + P.m * 2, d > 0 ? a - 20 : 200 - a, P.leaf);
    }
    if (P.fk < 0.7) for (let i = 0; i < 3; i++) o += bloom(CX + (i - 1) * 9, 20 + i * 9, 1.6, 5, "#f4d35e", "#e0a530");
    const pods = 3 + Math.round(P.p * 5);
    for (let i = 0; i < pods && P.fk; i++) {
      const y = 16 + (i / pods) * 34, d = i % 2 ? 1 : -1, x0 = CX + d * (5 + (i % 3) * 1.5), L = 8 + 7 * P.fk;
      const pc = P.ready ? "#4a4a30" : "#7fb83f";
      o += `<path d="M${f1(x0)},${f1(y)} q${f1(d * 3)},${f1(L * 0.5)} ${f1(d * 1.4)},${f1(L)} q${f1(-d * 1.2)},.4 ${f1(-d * 2.2)},${f1(-L * 0.2)} q${f1(d * 0.6)},${f1(-L * 0.4)} ${f1(-d * 0.4)},${f1(-L * 0.8)}z" fill="${pc}"/>`;
    }
    return o;
  },
  // vừng: thân thẳng, lá thuôn mọc đối, hoa chuông trắng hồng, quả nang dựng đứng theo thân
  bush(P) {
    let o = line(`M${CX},${GY} L${CX},10`, P.stem, 2) + line(`M${CX},40 Q${CX - 8},30 ${CX - 10},18 M${CX},34 Q${CX + 8},26 ${CX + 10},16`, P.stem, 1.3);
    for (let i = 0; i < 5; i++) {
      const y = GY - 6 - i * 9, L = (9 + P.m * 8) * (1 - i * 0.1);
      o += leaf(CX, y, L, 2.2 + P.m * 2.5, -160, P.leaf, P.leafD) + leaf(CX, y - 2, L, 2.2 + P.m * 2.5, -20, P.leafL, P.leafD);
    }
    const n = 4 + Math.round(P.p * 4), spots = [[CX, 12], [CX - 10, 18], [CX + 10, 16], [CX - 2, 22], [CX + 3, 28], [CX - 7, 26], [CX + 7, 22], [CX - 3, 34]];
    for (let i = 0; i < n && P.fk; i++) {
      const [x, y] = spots[i];
      if (P.fk < 0.6) o += oval(x, y, 2 * P.fk + 1, 3 * P.fk + 1.2, i % 2 ? "#f6dbe6" : "#fff4f0", 0, ` stroke="#d8a7bd" stroke-width=".4"`);
      else o += `<rect x="${f1(x - 1.9)}" y="${f1(y - 5)}" width="3.8" height="${f1(7 * P.fk + 1.5)}" rx="1.6" fill="${P.ready ? "#b98446" : "#c4dc7a"}" stroke="${P.ready ? "#7a5228" : "#6f8f34"}" stroke-width=".5"/>` + line(`M${f1(x)},${f1(y - 4.2)} v${f1(6 * P.fk)}`, P.ready ? "#7a5228" : "#6f8f34", 0.5);
    }
    return o;
  },
  // vạn thọ: bụi lá xẻ lông chim + hoa cầu xếp tầng màu cam vàng (sắc tố càng nhiều càng đậm, càng nhiều bông)
  flower(P) {
    let o = "";
    for (let i = 0; i < 14; i++) {
      const a = -160 + i * 10 + (P.rnd() - 0.5) * 10, x = CX + (P.rnd() - 0.5) * 10, y = GY - 3 - P.rnd() * 12;
      o += leaf(x, y, 8 + P.m * 6, 1.6 + P.m, a, i % 2 ? P.leaf : P.leafD);
    }
    const heads = 2 + Math.round(P.pg * 3), deep = P.pg > 0.6;
    for (let i = 0; i < heads; i++) {
      const x = CX + (i - (heads - 1) / 2) * 9, y = 26 - (i % 2) * 7 + P.rnd() * 4;
      o += line(`M${f1(CX + (x - CX) * 0.3)},${GY - 10} Q${f1(x)},${f1(y + 14)} ${f1(x)},${f1(y)}`, P.stem, 1.2);
      if (!P.fk) { o += oval(x, y, 2, 2.6, "#8cbf4e"); continue; }
      const R = 2.5 + 4 * P.fk;
      o += dot(x, y, R, deep ? "#e8731a" : "#f29a2e") + dot(x, y - 0.4, R * 0.72, deep ? "#f59b22" : "#f6b94a") + dot(x, y - 0.8, R * 0.42, "#ffd166");
      for (let k = 0; k < 8; k++) { const a = (k / 8) * PI * 2; o += dot(x + Math.cos(a) * R * 0.82, y + Math.sin(a) * R * 0.82, R * 0.28, deep ? "#d9621a" : "#ea8a2a"); }
    }
    return o;
  },
  // hướng dương: thân to cao, lá hình tim, một đầu hoa lớn (chín thì cúi xuống, cánh xỉn)
  tall(P) {
    let o = line(`M${CX},${GY} Q${CX + 2},34 ${CX},12`, P.stem, 2.6);
    for (let i = 0; i < 4; i++) {
      const y = GY - 10 - i * 10, d = i % 2 ? 1 : -1, L = (12 + P.m * 6) * (1 - i * 0.12);
      o += leaf(CX, y, L, 4 + P.m * 2.4, d > 0 ? -25 : -155, P.leaf, P.leafD);
    }
    if (!P.fk) return o + oval(CX, 11, 3.4, 3, "#7fb24a");
    const R = 4 + 5 * P.fk, tilt = P.ready ? 28 : 0;
    let h = "";
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * PI * 2, px = CX + Math.cos(a) * R * 1.15, py = 11 + Math.sin(a) * R * 1.15;
      h += oval(px, py, R * 0.42, R * 0.16, P.ready ? "#e0b13a" : "#f7c62f", (a * 180) / PI);
    }
    h += dot(CX, 11, R * 0.82, "#6b4423");
    for (let i = 0; i < 18; i++) { const a = i * 2.4, r = Math.sqrt(i / 18) * R * 0.7; h += dot(CX + Math.cos(a) * r, 11 + Math.sin(a) * r, 0.5 + P.p * 0.5, "#3a2412"); }
    return o + `<g transform="rotate(${tilt} ${CX} 14)">${h}</g>`;
  },
  // ngô: thân cao, lá dài cong rủ, cờ trên ngọn, bắp có râu (chín thì bóc vỏ thấy hạt; sắc tố → hạt cam đỏ)
  stalk(P) {
    let o = line(`M${CX},${GY} L${CX},10`, P.stem, 2.8);
    for (let i = 0; i < 6; i++) {
      const y = GY - 6 - i * 8, d = i % 2 ? 1 : -1, L = 14 + P.m * 6 - i;
      o += line(`M${CX},${f1(y)} q${f1(d * L * 0.6)},${f1(-L * 0.7)} ${f1(d * L)},${f1(-L * 0.1)}`, i % 2 ? P.leaf : P.leafL, 2.6 + P.m * 1.5);
    }
    o += line(`M${CX},10 l-4,-6 M${CX},10 l0,-7 M${CX},10 l4,-6 M${CX},12 l-6,-3 M${CX},12 l6,-3`, P.ready ? "#c9a55a" : "#d8d07a", 0.9);
    const cobs = 1 + (P.e > 0.45 ? 1 : 0);
    for (let i = 0; i < cobs && P.fk; i++) {
      const d = i ? -1 : 1, x = CX + d * 5, y = 36 - i * 8, L = 5 + 6 * P.fk;
      const kc = P.pg > 0.35 ? "#f08a2a" : "#f2c34a";
      if (P.ready) {
        o += oval(x, y, 2.6, L * 0.6, kc, d * 25);
        for (let k = 0; k < 4; k++) o += dot(x + d * Math.sin(0.44) * (k - 1.5) * L * 0.25 - 0.8, y + (k - 1.5) * L * 0.27, 0.6, "#fff0b0", ` opacity=".7"`);
        o += leaf(x - d * 1, y + L * 0.5, L * 1.1, 2.2, d * 25 - 90 - d * 18, "#a9c46a") + leaf(x + d * 1.2, y + L * 0.5, L, 2, d * 25 - 90 + d * 30, "#b7cf78");
      } else {
        o += oval(x, y, 2.4, L * 0.55, "#8fbf55", d * 25) + line(`M${f1(x + d * L * 0.25)},${f1(y - L * 0.5)} q${f1(d * 2)},-2 ${f1(d * 3)},-4`, "#c98f6a", 0.8);
      }
    }
    return o;
  },
  // bí đỏ: dây bò sát đất, lá to tròn, tua cuốn, hoa loa kèn vàng, quả bí nằm dưới đất (chín thì cam)
  creeper(P) {
    let o = line(`M${CX - 24},${GY - 2} Q${CX - 10},${GY - 7} ${CX},${GY - 3} T${CX + 24},${GY - 3}`, P.stem, 1.6);
    o += line(`M${CX - 16},${GY - 5} q-2,-5 2,-6 q3,0 1,3 M${CX + 14},${GY - 4} q2,-6 -2,-7 q-3,0 -1,3`, "#7fb24a", 0.7);
    for (const [x, y, R] of [[CX - 14, GY - 13, 7], [CX + 2, GY - 17, 8.5], [CX + 15, GY - 12, 6.5]]) {
      const r = R * (0.8 + P.m * 0.5);
      o += line(`M${f1(x)},${GY - 3} L${f1(x)},${f1(y + r * 0.6)}`, P.stem, 1.1);
      o += `<path d="M${f1(x)},${f1(y + r * 0.7)} C${f1(x - r * 1.4)},${f1(y + r * 0.4)} ${f1(x - r * 1.1)},${f1(y - r * 1.2)} ${f1(x)},${f1(y - r * 0.5)} C${f1(x + r * 1.1)},${f1(y - r * 1.2)} ${f1(x + r * 1.4)},${f1(y + r * 0.4)} ${f1(x)},${f1(y + r * 0.7)}Z" fill="${P.leaf}"/>`;
      o += line(`M${f1(x)},${f1(y + r * 0.6)} l${f1(-r * 0.6)},${f1(-r * 0.6)} M${f1(x)},${f1(y + r * 0.6)} l0,${f1(-r * 0.9)} M${f1(x)},${f1(y + r * 0.6)} l${f1(r * 0.6)},${f1(-r * 0.6)}`, P.leafD, 0.6, ` opacity=".5"`);
    }
    if (P.fk && P.fk < 0.8) o += `<path d="M${CX - 4},${GY - 26} l-3,-6 q3,-2 6,0 l-3,6z" fill="#f6c12f"/>` + dot(CX - 4, GY - 31.5, 1.2, "#f39a1e");
    if (P.fk) {
      const r = 3 + 6 * P.fk * (0.7 + P.pg * 0.8), x = CX + 6, c = P.ready ? "#ef8a24" : "#9cb84a", cd = P.ready ? "#cf6a16" : "#7f9a38";
      o += oval(x, GY - r * 0.75, r * 1.25, r * 0.85, c);
      o += line(`M${f1(x)},${f1(GY - r * 1.55)} v${f1(r * 1.6)} M${f1(x - r * 0.62)},${f1(GY - r * 1.45)} q${f1(-r * 0.35)},${f1(r * 0.7)} 0,${f1(r * 1.4)} M${f1(x + r * 0.62)},${f1(GY - r * 1.45)} q${f1(r * 0.35)},${f1(r * 0.7)} 0,${f1(r * 1.4)}`, cd, 0.8);
      o += line(`M${f1(x)},${f1(GY - r * 1.55)} q1,-2.5 3.5,-2.5`, "#6b8a2e", 1.4);
    }
    return o;
  },
  // đậu phộng: khóm thấp, lá kép bốn chét tròn, hoa vàng nhỏ; chín thì củ lạc lấp ló trên mặt đất
  low(P) {
    let o = "";
    if (P.fk > 0.4) {
      const n = 2 + Math.round(P.p * 3);
      for (let i = 0; i < n; i++) {
        const x = CX - 10 + i * (20 / Math.max(1, n - 1)), y = GY + 2 + (i % 2), c = P.ready ? "#d6ad73" : "#e6cfa6", d = P.ready ? "#b48a52" : "#cdb48a";
        o += oval(x - 2.1, y, 2.4, 2, c, -15) + oval(x + 2.1, y - 0.6, 2.4, 2, c, -15) + line(`M${f1(x - 3.4)},${f1(y)} h2 M${f1(x + 0.8)},${f1(y - 0.6)} h2.4`, d, 0.5);
      }
    }
    for (let i = 0; i < 7; i++) {
      const a = (-150 + i * 20) * PI / 180, L = 16 + P.rnd() * 6, ex = CX + Math.cos(a) * L, ey = GY + Math.sin(a) * L;
      o += line(`M${CX},${GY} Q${f1(CX + Math.cos(a) * L * 0.4)},${f1(GY + Math.sin(a) * L * 0.7)} ${f1(ex)},${f1(ey)}`, P.stem, 1.1);
      const s = 2.6 + P.m * 2.2;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) o += oval(ex + dx * s * 0.7, ey + dy * s * 0.55, s * 0.62, s * 0.42, i % 2 ? P.leaf : P.leafL, dx * dy * 30);
    }
    if (P.fk && P.fk < 0.9) for (const [x, y] of [[CX - 6, GY - 8], [CX + 5, GY - 10], [CX + 1, GY - 5]]) o += oval(x, y, 1.6, 1.3, "#f6c12f") + dot(x, y + 0.6, 0.6, "#e09a20");
    return o;
  },
  // sen: chậu nước nhỏ, lá tròn nổi, hoa hồng nhiều lớp cánh, đài sen xanh khi chín
  pond(P) {
    let o = oval(CX, GY - 1, 22, 6.5, "#8c7a64") + oval(CX, GY - 2, 20, 5.2, "#6fb3c9") + oval(CX - 6, GY - 3.4, 8, 1.6, "#a9dcea", 0, ` opacity=".6"`);
    for (const [x, y, r] of [[CX - 10, GY - 2.5, 5.5], [CX + 11, GY - 1.8, 4.5]]) o += `<path d="M${f1(x)},${f1(y)} m${f1(r)},0 a${f1(r)},${f1(r * 0.38)} 0 1 1 ${f1(-r * 0.3)},${f1(-r * 0.36)} L${f1(x)},${f1(y)}Z" fill="${P.leaf}"/>`;
    o += line(`M${CX + 4},${GY - 3} Q${CX + 8},36 ${CX + 12},28`, P.stem, 1.2) + oval(CX + 13, 27, 9 + P.m * 3, 2.8, P.leafL, -12);
    o += line(`M${CX - 2},${GY - 3} Q${CX - 4},38 ${CX - 2},18`, P.stem, 1.3);
    if (!P.fk) return o + oval(CX - 2, 16, 2.6, 4, "#e6a6bf");
    const R = 4 + 5 * P.fk;
    for (const [a, k] of [[-60, 1], [-120, 1], [-35, 0.8], [-145, 0.8], [-90, 1.1]]) o += leaf(CX - 2, 19, R * 1.5 * k, R * 0.45, a, a === -90 ? "#f7c6d6" : "#ef8fb1");
    o += oval(CX - 2, 18.5, R * 0.5, R * 0.25, "#f5d25c");
    if (P.ready) {
      o += line(`M${CX + 2},${GY - 3} Q${CX + 6},34 ${CX + 4},22`, P.stem, 1.1);
      o += `<path d="M${CX},22 L${CX + 8},22 L${CX + 6.4},25.6 L${CX + 1.6},25.6Z" fill="#8cae4e"/>` + oval(CX + 4, 22, 4, 1.4, "#a9c86a");
      for (const dx of [-2, 0, 2]) o += dot(CX + 4 + dx, 22, 0.55, "#4f6f2a");
    }
    return o;
  },
};
// quả nang bông nứt (đài nâu)
function path4(x, y) { return `<path d="M${f1(x - 3)},${f1(y + 2)} L${f1(x)},${f1(y + 4)} L${f1(x + 3)},${f1(y + 2)}" stroke="#7a5a30" stroke-width="1" fill="none"/>`; }
export const PLANT_FORMS = Object.keys(FORMS);

export function plantSvg(sp, growth = 1, ready = false, seed = 1) {
  const n = sp?.n ?? { protein: 4, energy: 6, mineral: 3, pigment: 3 };
  const pos = (k) => Math.max(0, n[k]); // chất bị kéo xuống (âm) không làm cây lớn
  const tot = pos("protein") + pos("energy") + pos("mineral") + pos("pigment") || 1;
  const anti = n.protein < 0 || n.energy < 0 || n.mineral < 0 || n.pigment < 0;
  const g = Math.max(0, Math.min(1, growth));
  let r = ((seed >>> 0) * 2654435761) % 4294967296;
  const rnd = () => ((r = (r * 1664525 + 1013904223) % 4294967296) / 4294967296);
  if (g < 0.12) {
    const k = 0.5 + g * 4;
    return svg(`<path d="M30,62 V${f1(62 - 8 * k)}" stroke="#6fae3f" stroke-width="1.6"/><path d="M30,${f1(62 - 7 * k)} q-6,-4 -8,0 q4,3 8,0z M30,${f1(62 - 8 * k)} q6,-5 8,-1 q-4,3 -8,1z" fill="#8cc95a"/>`, "plant");
  }
  const m = pos("mineral") / tot, rich = Math.min(1, tot / 64);
  const P = {
    p: pos("protein") / tot, e: pos("energy") / tot, m, pg: pos("pigment") / tot, rich, rnd, ready,
    fk: Math.max(0, (g - 0.55) / 0.45),
    leaf: m > 0.35 ? "#3f8f3a" : m > 0.2 ? "#4f9f42" : "#62ad48", leafL: m > 0.35 ? "#55a347" : "#7cbf57", leafD: "#2f7a2e", stem: "#5c9a37",
  };
  // hạt có chất kháng: lá ngả tím (nhận ra ngay trong vườn)
  if (anti) Object.assign(P, { leafL: "#8a76a0", leafD: "#5a3f6e", stem: "#6f7a45" });
  const body = (FORMS[sp?.form] ?? FORMS.grass)(P);
  const k = (0.35 + 0.65 * Math.min(1, (g - 0.12) / 0.6)) * (0.84 + 0.16 * rich);
  let o = `<g transform="translate(${CX} ${GY}) scale(${f1(k * 100) / 100}) translate(${-CX} ${-GY})">${body}</g>`;
  const top = { creeper: 40, low: 44, pond: 18 }[sp?.form] ?? 12; // ánh chín quanh ngọn cây
  if (ready) o += `<g class="ripe">${[[15, top + 8], [46, top + 13], [32, top - 4]].map(([x, y]) => `<path d="M${x},${y - 3} l.9,2.1 2.1,.9 -2.1,.9 -.9,2.1 -.9,-2.1 -2.1,-.9 2.1,-.9z" fill="#fff6c4"/>`).join("")}</g>`;
  return svg(o, `plant plant-${sp?.form ?? "grass"}${ready ? " is-ripe" : ""}`);
}
