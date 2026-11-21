// Trại Gà — hình trang trí sân trại (phần thưởng nhìn thấy được) và vài biểu tượng cho nhiệm vụ.
// Kiểu "Phẳng 1": mảng màu phẳng, không viền. Toạ độ thế giới 800×480 như icons.js.
// Trang trí suy ra từ tiến độ (rules.decorOf), không lưu riêng.

import { t as tr } from "../game/i18n.js";
const svg = (vb, body, cls = "", label = "") => `<svg class="${cls}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${body}</svg>`;
const FLAG = ["#e4572e", "#f2b318", "#4a8f9c", "#b23a9b", "#7cc35f"];

function bunting() {
  // dây cờ võng giữa các cọc rào phía trên
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, x = 6 + t * 408;
    pts.push([x, 5 + Math.sin(((t * 3) % 1) * Math.PI) * 9]);
  }
  let o = `<path d="M${pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" L")}" fill="none" stroke="#7d5a2e" stroke-width="1.6" stroke-linecap="round"/>`;
  pts.slice(0, -1).forEach(([x, y], i) => {
    const [x2, y2] = pts[i + 1], mx = (x + x2) / 2, my = (y + y2) / 2;
    o += `<path class="flag" style="animation-delay:${-(i % 5) * 0.3}s" d="M${(mx - 8).toFixed(1)},${(my - 0.5).toFixed(1)} L${(mx + 8).toFixed(1)},${(my - 0.5).toFixed(1)} L${mx.toFixed(1)},${(my + 15).toFixed(1)}Z" fill="${FLAG[i % FLAG.length]}"/>`;
  });
  return svg("0 0 420 36", o, "decor-bunting", tr("Dây cờ"));
}

function flowers(seed) {
  const cols = ["#fff6f0", "#ff9db0", "#ffb347", "#c98be0", "#fff6f0"];
  let o = `<ellipse cx="30" cy="25" rx="28" ry="5" fill="#5f9a3e" opacity=".55"/>`;
  for (let i = 0; i < 6; i++) o += `<path d="M${6 + i * 9},26 q${i % 2 ? 3 : -3},-9 ${i % 2 ? -1 : 1},-14" stroke="#4d8a34" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i < 5; i++) {
    const x = 8 + i * 11 + ((seed + i * 7) % 5), y = 9 + ((seed + i * 13) % 7), c = cols[(i + seed) % cols.length];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      o += `<circle cx="${(x + Math.cos(a) * 3.2).toFixed(1)}" cy="${(y + Math.sin(a) * 3.2).toFixed(1)}" r="2.6" fill="${c}"/>`;
    }
    o += `<circle cx="${x}" cy="${y}" r="2" fill="#f2b318"/>`;
  }
  return svg("0 0 60 30", o, "decor-flowers", tr("Luống hoa"));
}

function lantern() {
  return svg("0 0 30 64", `
    <ellipse cx="13" cy="61" rx="9" ry="2.2" fill="#000" opacity=".12"/>
    <rect x="11" y="6" width="3.6" height="55" rx="1.6" fill="#8d5f33"/>
    <path d="M12,7 h12 a2,2 0 0 1 2,2 v3" fill="none" stroke="#8d5f33" stroke-width="2.6" stroke-linecap="round"/>
    <circle class="glow" cx="26" cy="23" r="13" fill="#ffd36b" opacity="0"/>
    <rect x="22.5" y="12" width="7" height="2.4" rx="1" fill="#f2b318"/>
    <rect x="20" y="14" width="12" height="17" rx="5.5" fill="#e4572e"/>
    <rect x="23.4" y="16" width="5.2" height="13" rx="2.4" fill="#ffd36b" opacity=".85"/>
    <rect x="22.5" y="30.6" width="7" height="2.4" rx="1" fill="#f2b318"/>
    <path d="M26,33 v6" stroke="#f2b318" stroke-width="1.6" stroke-linecap="round"/>`, "decor-lantern", tr("Đèn lồng"));
}

function scarecrow() {
  return svg("0 0 56 78", `
    <ellipse cx="28" cy="75" rx="13" ry="2.6" fill="#000" opacity=".12"/>
    <rect x="26" y="22" width="4" height="53" rx="1.8" fill="#8d5f33"/>
    <rect x="5" y="33" width="46" height="4" rx="1.8" fill="#a9743f"/>
    <path d="M14,31 h28 l3,22 h-34z" fill="#4a8f9c"/>
    <path d="M24,31 h8 v22 h-8z" fill="#3d7884"/>
    <path d="M4,33 l-3,-3 M4,35 l-4,1 M4,37 l-3,3 M52,33 l3,-3 M52,35 l4,1 M52,37 l3,3" stroke="#e0b860" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="28" cy="22" r="9" fill="#ecd2a2"/>
    <circle cx="25" cy="21" r="1.3" fill="#3d2a17"/><circle cx="31" cy="21" r="1.3" fill="#3d2a17"/>
    <path d="M25,25.5 q3,2.4 6,0" stroke="#3d2a17" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <path d="M13,15 q15,-7 30,0 l-4,1 q-11,-4 -22,0z" fill="#d9ac57"/>
    <path d="M19,14.5 q9,-17 18,0z" fill="#e0b860"/>
    <rect x="19.5" y="12.6" width="17" height="2.6" rx="1" fill="#e4572e"/>`, "decor-scarecrow", tr("Bù nhìn rơm"));
}

function pinwheel() {
  const blades = [0, 90, 180, 270].map((a, i) => `<path transform="rotate(${a} 15 14)" d="M15,14 L15,2 Q24,4 22,13Z" fill="${FLAG[i % 4]}"/>`).join("");
  return svg("0 0 30 62", `
    <ellipse cx="15" cy="59.5" rx="7" ry="1.8" fill="#000" opacity=".12"/>
    <rect x="13.6" y="13" width="2.8" height="46" rx="1.2" fill="#b98652"/>
    <g class="spin">${blades}<circle cx="15" cy="14" r="2.2" fill="#fffdf6"/></g>`, "decor-pinwheel", tr("Chong chóng"));
}

function rosette(i) {
  const c = ["#e4572e", "#4a8f9c", "#f2b318", "#b23a9b", "#7cc35f", "#e98a2c", "#5b7bd5", "#f2c94c"][i % 8];
  return svg("0 0 16 24", `
    <path d="M5,11 l-2,12 4,-3.4 2.6,3.4 -1,-12z" fill="${c}" opacity=".85"/><path d="M11,11 l2,12 -4,-3.4 -2.6,3.4 1,-12z" fill="${c}"/>
    <circle cx="8" cy="8" r="7" fill="${c}"/><circle cx="8" cy="8" r="4.2" fill="#fffdf6"/><circle cx="8" cy="8" r="2" fill="${c}"/>`, "decor-rosette", tr("Nơ giống"));
}

// d = rules.decorOf(state). Trả về danh sách { key, x, y, w, html }: neo ở ĐÁY-GIỮA, w tính theo thế giới 800.
export function decorItems(d, seed = 1) {
  const out = [];
  if (d.bunting) out.push({ key: "bunting", x: 430, y: 62, w: 400, html: bunting() });
  if (d.flowers) out.push({ key: "flowers1", x: 250, y: 458, w: 78, html: flowers(seed % 9) }, { key: "flowers2", x: 566, y: 468, w: 66, html: flowers((seed + 4) % 9) });
  if (d.lantern) out.push({ key: "lantern", x: 205, y: 172, w: 32, html: lantern() });
  if (d.scarecrow) out.push({ key: "scarecrow", x: 668, y: 440, w: 60, html: scarecrow() });
  if (d.pinwheel) out.push({ key: "pinwheel", x: 382, y: 118, w: 30, html: pinwheel() });
  for (let i = 0; i < Math.min(8, d.ribbons ?? 0); i++) out.push({ key: `ribbon${i}`, x: 56 + i * 15, y: 92, w: 13, html: rosette(i) });
  return out;
}

/* ---------- biểu tượng ---------- */

export const sparkleSvg = () => svg("0 0 40 40", `
  <circle cx="20" cy="20" r="15" fill="#fff6c4" opacity=".4"/>
  <path class="s1" d="M20,3 Q21.6,16 37,20 Q21.6,24 20,37 Q18.4,24 3,20 Q18.4,16 20,3Z" fill="#ffd95a"/>
  <path class="s2" d="M20,10 Q20.9,17.6 30,20 Q20.9,22.4 20,30 Q19.1,22.4 10,20 Q19.1,17.6 20,10Z" fill="#fffdf0"/>
  <path class="s3" d="M32,5 q.5,3.2 3.6,4 q-3.1,.8 -3.6,4 q-.5,-3.2 -3.6,-4 q3.1,-.8 3.6,-4Z" fill="#fff"/>`, "sparkle", tr("Đốm sáng"));

export const chestSvg = (open = false) => svg("0 0 40 36", `
  <ellipse cx="20" cy="33.5" rx="15" ry="2.2" fill="#000" opacity=".12"/>
  <rect x="5" y="15" width="30" height="17" rx="3" fill="#b98652"/>
  <rect x="5" y="15" width="30" height="5" fill="#8d5f33"/>
  ${open
    ? `<path d="M6,15 q14,-22 28,0z" fill="#d7a970"/><path d="M9,15 q11,-15 22,0z" fill="#ffd95a"/><circle cx="15" cy="11" r="2" fill="#fff"/><circle cx="24" cy="8.5" r="1.6" fill="#fff"/>`
    : `<path d="M5,16 v-3 a8,8 0 0 1 8,-8 h14 a8,8 0 0 1 8,8 v3z" fill="#d7a970"/><rect x="5" y="12.6" width="30" height="3.4" fill="#a9743f"/>`}
  <rect x="17.4" y="${open ? 17 : 12}" width="5.2" height="8" rx="1.6" fill="#f2b318"/>
  <rect x="9" y="${open ? 15 : 5}" width="3" height="${open ? 17 : 27}" fill="#f2b318" opacity=".9"/><rect x="28" y="${open ? 15 : 5}" width="3" height="${open ? 17 : 27}" fill="#f2b318" opacity=".9"/>`, "chest", tr("Rương"));

export const flameSvg = () => svg("0 0 20 24", `
  <path d="M10,1 Q16,7 15.5,13 Q18,11 17.6,8 Q21,14 18,19 Q15.5,23 10,23 Q4.5,23 2,19 Q-.6,14 4.4,8.5 Q4.6,12 7,13 Q6,7 10,1Z" fill="#e4572e"/>
  <path d="M10,10 Q13.4,14 13,17.4 Q12.6,21 10,21 Q7.4,21 7,17.6 Q6.8,15 8.6,13.4 Q9,15 10,15.4 Q9.4,12.6 10,10Z" fill="#ffd95a"/>`, "flame", tr("Chuỗi ngày"));

// vết nứt phủ lên trứng trong ổ (viewBox của ổ ấp 96×96, trứng ở giữa ~ (48, 46))
export const nestCrackSvg = (level) => svg("0 0 96 96", `
  <path d="M36,44 l5,-4 4,5 5,-6 4,5 5,-3${level > 1 ? " M45,45 l-2,6 4,3 M54,44 l2,6" : ""}${level > 2 ? " M41,40 l-3,-5 M50,39 l1,-6 4,-2" : ""}" fill="none" stroke="#5a4028" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`, "nest-crack");


/* ---------- v7: gian hàng bên đường, khách qua đường, sân chơi ---------- */

// Gian hàng bên đường (v9 vẽ lại, cao hơn để khách đứng SAU quầy): part "back" = cột, mái bạt, kệ sau;
// part "front" = quầy hàng có rổ trứng, bao hạt, biển tên; "all" = cả hai. Khung 120×124, đáy ở y≈120.
export const stallSvg = (sign = "CHỢ", part = "all") => {
  const n = 8, wTop = 112 / n;
  const stripes = Array.from({ length: n }, (_, i) => `<path d="M${6 + i * wTop + 3},8 L${4 + i * wTop},30 h${wTop} L${6 + (i + 1) * wTop + 3},8Z" fill="${i % 2 ? "#fffdf6" : "#e4572e"}"/>`).join("");
  const scallop = Array.from({ length: n }, (_, i) => `<path d="M${4 + i * wTop},30 a${wTop / 2},${wTop / 2 * 0.8} 0 0 0 ${wTop},0Z" fill="${i % 2 ? "#fffdf6" : "#e4572e"}"/>`).join("");
  const back = `
  <ellipse cx="60" cy="119" rx="54" ry="4.5" fill="#000" opacity=".14"/>
  <rect x="14" y="24" width="6" height="94" rx="2" fill="#8d5f33"/><rect x="100" y="24" width="6" height="94" rx="2" fill="#8d5f33"/>
  <path d="M17,30 V116" stroke="#b07a46" stroke-width="1.4"/><path d="M103,30 V116" stroke="#b07a46" stroke-width="1.4"/>
  <rect x="20" y="52" width="80" height="4" rx="1.6" fill="#a9743f"/>
  ${[[30, "#f2b318"], [38, "#7cc35f"], [46, "#e4572e"], [74, "#4a8f9c"], [82, "#b23a9b"], [90, "#f2b318"]].map(([x, c]) => `<path d="M${x - 3.4},52 v-7 q3.4,-3 6.8,0 v7z" fill="#e8d6ae"/><circle cx="${x}" cy="46" r="2" fill="${c}"/>`).join("")}
  <path d="M2,10 Q60,-2 118,10 L118,30 H2Z" fill="#c4643f"/>${stripes}${scallop}
  <path d="M2,10 Q60,-2 118,10" fill="none" stroke="#9a4630" stroke-width="2"/>`;
  const front = `
  <rect x="6" y="80" width="108" height="38" rx="3" fill="#b98652"/><rect x="6" y="80" width="108" height="7" rx="2.4" fill="#d7a970"/>
  <path d="M10,96 h100 M10,107 h100" stroke="#a9743f" stroke-width="1.6"/><path d="M33,87 v31 M87,87 v31" stroke="#a9743f" stroke-width="1.2" opacity=".7"/>
  <path d="M14,80 q14,-16 30,0z" fill="#c9a66b"/><path d="M14,80 q14,-16 30,0" fill="none" stroke="#a5824c" stroke-width="1.2"/>
  ${[19, 25, 31, 37, 22, 28, 34].map((x, i) => `<ellipse cx="${x}" cy="${i < 4 ? 76 : 71}" rx="3.4" ry="4.2" fill="${["#f6f0e4", "#e8c9a0", "#b5dccd", "#f6f0e4"][i % 4]}"/>`).join("")}
  <path d="M84,80 q-3,-17 9,-19 q13,-2 13,11 q0,6 -2,8z" fill="#d4ac72"/><path d="M88,63 q6,-4 12,0" stroke="#7d5a2e" stroke-width="1.6" fill="none"/><circle cx="92" cy="62" r="2" fill="#e3b23c"/><circle cx="97" cy="61" r="2" fill="#4f8f97"/>
  <rect x="40" y="96" width="40" height="15" rx="2.4" fill="#fffdf6" stroke="#8d5f33" stroke-width="1.2"/>
  <text x="60" y="107" text-anchor="middle" font-size="8.4" font-weight="800" font-family="system-ui,sans-serif" fill="#8a3414">${sign}</text>`;
  const body = part === "back" ? back : part === "front" ? front : back + front;
  return svg("0 0 120 124", body, `decor-stall stall-${part}`, part === "front" ? "" : tr("Gian hàng bên đường"));
};

// Khách qua đường (v9 vẽ lại): mỗi loại khách một nhân vật riêng. Khung 90×104, chân chạm đất ở y≈100;
// đứng sau quầy thì quầy che nửa dưới — phần nhận diện (mũ, mặt, đồ cầm tay) đều ở nửa trên.
const eyes = (y = 33, c = "#3d2a17", dx = 5) => `<circle cx="${45 - dx}" cy="${y}" r="1.8" fill="${c}"/><circle cx="${45 + dx}" cy="${y}" r="1.8" fill="${c}"/><circle cx="${45.6 - dx}" cy="${y - 0.6}" r=".6" fill="#fff"/><circle cx="${45.6 + dx}" cy="${y - 0.6}" r=".6" fill="#fff"/>`;
const smile = (y = 40, w = 5) => `<path d="M${45 - w},${y} q${w},${w * 0.7} ${w * 2},0" stroke="#3d2a17" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
const blush = (y = 38, c = "#f29a8a") => `<ellipse cx="36" cy="${y}" rx="3" ry="1.8" fill="${c}" opacity=".55"/><ellipse cx="54" cy="${y}" rx="3" ry="1.8" fill="${c}" opacity=".55"/>`;
const head = (skin, y = 34, r = 13) => `<ellipse cx="45" cy="${y}" rx="${r}" ry="${r * 1.02}" fill="${skin}"/><ellipse cx="${45 - r}" cy="${y + 1}" rx="2.4" ry="3.4" fill="${skin}"/><ellipse cx="${45 + r}" cy="${y + 1}" rx="2.4" ry="3.4" fill="${skin}"/>`;
const body = (c, cD, { top = 50, hem = 98, w = 22 } = {}) => `<path d="M${45 - w},${hem} Q${45 - w - 3},${top + 8} 45,${top} Q${45 + w + 3},${top + 8} ${45 + w},${hem}Z" fill="${c}"/><path d="M${45 - w + 4},${hem} Q${45 - w + 2},${top + 14} ${45 - w * 0.45},${top + 4}" stroke="${cD}" stroke-width="2" fill="none" opacity=".5"/>`;
const arm = (x0, y0, x1, y1, c, hand) => `<path d="M${x0},${y0} Q${(x0 + x1) / 2 + (x1 > x0 ? -2 : 2)},${(y0 + y1) / 2 + 6} ${x1},${y1}" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="${x1}" cy="${y1}" r="3.6" fill="${hand}"/>`;
const VISITOR_ART = {
  // Bà hàng hạt: nón lá, búi tóc bạc, áo bà ba nâu, rổ hạt trước ngực
  seller: () => `
    ${body("#8a5a3c", "#5e3a22")}<path d="M40,52 L45,62 L50,52" stroke="#5e3a22" stroke-width="1.4" fill="none"/>
    ${head("#efc39a")}<path d="M33,28 q12,-8 24,0 v-4 q-12,-6 -24,0z" fill="#d6d2cc"/><circle cx="58" cy="24" r="4.4" fill="#d6d2cc"/>
    ${eyes(34)}<path d="M38,31 q2,-1 4,0 M48,31 q2,-1 4,0" stroke="#3d2a17" stroke-width=".9" fill="none"/>${smile(40, 4.4)}${blush(38)}
    <path d="M11,25 L45,3 L79,25 Q45,31 11,25Z" fill="#e8cf8a"/><path d="M11,25 Q45,31 79,25" stroke="#b8974e" stroke-width="1.4" fill="none"/>
    ${[18, 26, 34, 42].map((t) => `<path d="M${45 - t * 0.78},${25 - t * 0.02 - (42 - t) * 0.47} L${45 + t * 0.78},${25 - t * 0.02 - (42 - t) * 0.47}" stroke="#c9ad66" stroke-width=".8" opacity=".8"/>`).join("")}
    <path d="M36,27 Q34,40 37,46 M54,27 Q56,40 53,46" stroke="#c9ad66" stroke-width=".8" fill="none"/>
    ${arm(26, 60, 32, 74, "#8a5a3c", "#efc39a")}${arm(64, 60, 58, 74, "#8a5a3c", "#efc39a")}
    <path d="M25,72 Q45,88 65,72 L62,70 Q45,78 28,70Z" fill="#b98652"/><ellipse cx="45" cy="71" rx="19" ry="5" fill="#c99a52"/>
    ${[[35, 70, "#f2b318"], [40, 69, "#e4572e"], [45, 70, "#7cc35f"], [50, 69, "#4a8f9c"], [55, 70, "#b23a9b"], [42, 72, "#f2b318"], [48, 72, "#e0a43c"]].map(([x, y, c]) => `<ellipse cx="${x}" cy="${y}" rx="2.2" ry="1.6" fill="${c}"/>`).join("")}
    <path d="M27,74 q18,8 36,0" stroke="#8d5f33" stroke-width="1.2" fill="none"/>`,
  // Người đổi chác: khăn đỏ buộc trán, bọc đồ to sau lưng, giơ túi hạt ra đổi
  trader: () => `
    <ellipse cx="45" cy="48" rx="28" ry="24" fill="#c9a66b"/><path d="M22,40 q23,-14 46,0" stroke="#a5824c" stroke-width="2" fill="none"/><path d="M45,24 l-6,-6 m6,6 l6,-7" stroke="#a5824c" stroke-width="2.4" stroke-linecap="round"/>
    ${body("#4a8f9c", "#2f6670")}<path d="M30,54 L58,86 M60,54 L32,86" stroke="#8d5f33" stroke-width="3" opacity=".9"/>
    ${head("#d9a273")}<path d="M32,30 Q34,18 45,18 Q56,18 58,30 Q52,24 45,25 Q38,24 32,30Z" fill="#3d2a17"/>
    <path d="M31,29 Q45,24 59,29 L59,33 Q45,28 31,33Z" fill="#e4572e"/><path d="M59,31 l7,-3 -2,6z" fill="#e4572e"/>
    ${eyes(36)}${smile(42, 4.6)}${blush(40, "#e07a5f")}
    ${arm(26, 60, 22, 72, "#4a8f9c", "#d9a273")}${arm(64, 60, 74, 50, "#4a8f9c", "#d9a273")}
    <path d="M69,46 q5,-8 11,0 q2,8 -5,10 q-7,-2 -6,-10z" fill="#e8c9a0"/><path d="M70,45 q4,-3 9,0" stroke="#8d5f33" stroke-width="1.4" fill="none"/><circle cx="74" cy="50" r="1.4" fill="#f2b318"/><circle cx="77" cy="51" r="1.4" fill="#7cc35f"/>`,
  // Người sưu tầm: mũ quả dưa, kính một mắt có dây, ria, áo gi-lê xanh, nơ đỏ, kính lúp
  collector: () => `
    ${body("#2f5a22", "#1e3d16")}<path d="M38,51 L45,72 L52,51Z" fill="#fffdf6"/><path d="M40,53 l5,3 5,-3 -5,3z" fill="#e4572e"/><path d="M41,52 l4,4 4,-4 -4,4z" fill="#c13d22"/>
    ${[60, 66, 72].map((y) => `<circle cx="45" cy="${y}" r="1.1" fill="#f2b318"/>`).join("")}
    ${head("#f2d0b0")}${eyes(34)}<circle cx="51" cy="34" r="4.4" fill="none" stroke="#e9b922" stroke-width="1.4"/><path d="M55,35 q3,8 -2,16" stroke="#e9b922" stroke-width=".8" fill="none"/>
    <path d="M37,40 q4,-3 8,0 q4,-3 8,0 q-4,3 -8,1 q-4,2 -8,-1z" fill="#6b4a2e"/>${blush(38)}
    <path d="M29,24 Q45,20 61,24 L61,27 Q45,23 29,27Z" fill="#2c2620"/><path d="M33,24 Q33,8 45,8 Q57,8 57,24Z" fill="#2c2620"/><path d="M33,21 Q45,18 57,21" stroke="#6b4a2e" stroke-width="2"/>
    ${arm(26, 60, 30, 74, "#2f5a22", "#f2d0b0")}${arm(64, 60, 70, 52, "#2f5a22", "#f2d0b0")}
    <path d="M70,52 L76,42" stroke="#8d5f33" stroke-width="2.6" stroke-linecap="round"/><circle cx="78" cy="38" r="6" fill="#cfe8f2" opacity=".75" stroke="#8a8f94" stroke-width="1.6"/><path d="M75,36 q2,-2 4,-1" stroke="#fff" stroke-width="1" fill="none"/>`,
  // Thầy soi trứng: hói, râu trắng dài, kính tròn, áo xanh lấm tấm sao, cầm nến soi quả trứng
  reader: () => `
    ${body("#4c66b8", "#334985")}${[[34, 66], [56, 74], [40, 86], [58, 58], [48, 92]].map(([x, y]) => `<path d="M${x},${y - 2.4} l.8,1.6 1.6,.8 -1.6,.8 -.8,1.6 -.8,-1.6 -1.6,-.8 1.6,-.8z" fill="#ffd95a"/>`).join("")}
    ${head("#f0c9a0")}<path d="M31,32 q-2,-8 4,-11 M59,32 q2,-8 -4,-11" stroke="#f4f1ea" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M34,40 Q36,62 45,70 Q54,62 56,40 Q50,46 45,45 Q40,46 34,40Z" fill="#f4f1ea"/><path d="M41,48 q4,10 4,18 M49,48 q-2,8 -4,18" stroke="#d9d4c8" stroke-width="1" fill="none"/>
    ${eyes(33)}<circle cx="40" cy="33" r="4" fill="none" stroke="#6b4a2e" stroke-width="1.2"/><circle cx="50" cy="33" r="4" fill="none" stroke="#6b4a2e" stroke-width="1.2"/><path d="M44,33 h2" stroke="#6b4a2e" stroke-width="1.2"/>
    <path d="M37,28 q3,-2 6,0 M47,28 q3,-2 6,0" stroke="#f4f1ea" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    ${arm(26, 60, 22, 70, "#4c66b8", "#f0c9a0")}${arm(64, 60, 68, 62, "#4c66b8", "#f0c9a0")}
    <circle cx="70" cy="50" r="11" fill="#ffe9a8" opacity=".35" class="glow"/><rect x="66" y="52" width="8" height="10" rx="1.6" fill="#fffdf6"/><path d="M70,52 v-3" stroke="#3d2a17" stroke-width="1"/><path d="M70,48 q-3,-4 0,-8 q3,4 0,8z" fill="#f2b318"/><path d="M70,47 q-1.4,-2 0,-4 q1.4,2 0,4z" fill="#fff6c4"/>
    <ellipse cx="20" cy="66" rx="5" ry="6.4" fill="#f6f0e4" stroke="#e0cfa8" stroke-width=".8"/>`,
  // Lái buôn: người tròn, mũ nồi, ria vểnh, gi-lê đỏ, túi tiền leng keng, nháy mắt
  haggler: () => `
    ${body("#f3e6c8", "#cdb98c", { w: 26 })}<path d="M22,98 Q18,60 32,52 L40,98Z M68,98 Q72,60 58,52 L50,98Z" fill="#d1452a"/>${[62, 70, 78].map((y) => `<circle cx="39" cy="${y}" r="1.2" fill="#f2b318"/>`).join("")}
    ${head("#e8b48a", 34, 14)}<path d="M31,27 Q31,14 45,14 Q61,14 60,27 Q46,20 31,27Z" fill="#7d5a2e"/><path d="M30,26 Q45,20 62,25 L66,27 Q46,22 30,29Z" fill="#6b4a2e"/>
    <circle cx="40" cy="33" r="1.8" fill="#3d2a17"/><path d="M48,33 q2.4,-2 5,0" stroke="#3d2a17" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M34,40 q5,-4 11,-1 q6,-3 11,1 q-2,3 -6,2 q-3,-1 -5,0 q-2,-1 -5,0 q-4,1 -6,-2z" fill="#5e3a22"/><path d="M40,44 q5,3 10,0" stroke="#3d2a17" stroke-width="1.3" fill="none"/>${blush(39, "#e07a5f")}
    ${arm(22, 60, 26, 74, "#d1452a", "#e8b48a")}${arm(68, 60, 72, 70, "#d1452a", "#e8b48a")}
    <path d="M66,72 q8,-6 14,2 q2,10 -7,11 q-9,-1 -7,-13z" fill="#b98652"/><path d="M68,71 q6,-3 11,1" stroke="#7d5a2e" stroke-width="1.6" fill="none"/>
    <circle cx="71" cy="66" r="2.6" fill="#f2b318" stroke="#d99a00" stroke-width=".6"/><circle cx="76" cy="64" r="2.4" fill="#f2b318" stroke="#d99a00" stroke-width=".6"/>`,
  // Nghệ nhân: khăn tím buộc đầu, tạp dề cam có túi đồ nghề, má lem sơn, cầm búa gỗ
  artisan: () => `
    ${body("#efe4cf", "#cdb98c")}<path d="M31,98 L33,58 Q45,54 57,58 L59,98Z" fill="#e98a2c"/><path d="M37,58 q8,-10 16,0" stroke="#c4691a" stroke-width="1.6" fill="none"/>
    <rect x="37" y="72" width="16" height="10" rx="2" fill="#c4691a"/><path d="M41,72 v-7 M45,72 v-9 M49,72 v-6" stroke="#8d5f33" stroke-width="1.6" stroke-linecap="round"/><path d="M44,63 h2" stroke="#8a8f94" stroke-width="2"/>
    ${head("#efc39a")}<path d="M31,34 Q29,18 45,16 Q61,18 59,34 Q56,22 45,22 Q34,22 31,34Z" fill="#5e3a22"/>
    <path d="M30,28 Q30,13 45,12 Q60,13 60,28 Q45,20 30,28Z" fill="#b23a9b"/><path d="M58,22 q8,0 9,6 q-5,-1 -8,1z" fill="#b23a9b"/>${[[38, 18], [46, 16], [53, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="#ffd1e8"/>`).join("")}
    ${eyes(34)}${smile(40, 4.4)}${blush(38)}<circle cx="55" cy="40" r="1.6" fill="#5b9bd5" opacity=".85"/><circle cx="53" cy="42" r="1" fill="#7cc35f" opacity=".85"/>
    ${arm(26, 60, 22, 72, "#efe4cf", "#efc39a")}${arm(64, 60, 70, 50, "#efe4cf", "#efc39a")}
    <path d="M70,50 L76,38" stroke="#a5713e" stroke-width="2.8" stroke-linecap="round"/><rect x="70" y="32" width="12" height="6" rx="1.6" fill="#8d5f33" transform="rotate(25 76 35)"/>`,
  // Khách lạ đêm khuya: áo choàng trùm đầu, mặt chìm trong bóng tối, mắt vàng sáng, xách đèn lồng
  stranger: () => `
    <path d="M18,98 Q16,46 45,44 Q74,46 72,98Z" fill="#3b3554"/><path d="M45,46 L42,98 M45,46 L50,98" stroke="#2a2540" stroke-width="1.6" opacity=".7"/>
    <path d="M25,46 Q20,8 45,6 Q70,8 65,46 Q58,52 45,52 Q32,52 25,46Z" fill="#433c60"/><path d="M31,42 Q30,20 45,19 Q60,20 59,42 Q52,46 45,46 Q38,46 31,42Z" fill="#1d1a2c"/>
    <ellipse cx="40" cy="34" rx="2.4" ry="1.6" fill="#ffd95a" class="glint"/><ellipse cx="50" cy="34" rx="2.4" ry="1.6" fill="#ffd95a" class="glint"/>
    <path d="M28,18 Q45,4 62,18" stroke="#5a5280" stroke-width="2" fill="none" opacity=".7"/>
    <path d="M66,58 Q72,62 72,66" stroke="#3b3554" stroke-width="7" fill="none" stroke-linecap="round"/>
    <circle cx="73" cy="78" r="15" fill="#ffd95a" opacity=".22" class="glow"/><path d="M73,66 v4" stroke="#8a8f94" stroke-width="1.4"/><path d="M67,70 h12 l-2,4 h-8z" fill="#5a4028"/>
    <rect x="67" y="74" width="12" height="12" rx="2" fill="#ffe08a" stroke="#5a4028" stroke-width="1.4"/><path d="M73,74 v12 M67,80 h12" stroke="#5a4028" stroke-width=".9"/><path d="M73,83 q-2,-3 0,-6 q2,3 0,6z" fill="#e4572e"/>
    ${[[20, 30], [70, 24], [16, 60]].map(([x, y]) => `<path d="M${x},${y - 2.4} l.7,1.7 1.7,.7 -1.7,.7 -.7,1.7 -.7,-1.7 -1.7,-.7 1.7,-.7z" fill="#e6dcff" opacity=".8" class="glint"/>`).join("")}`,
};
export function visitorSvg(who) {
  const art = (VISITOR_ART[who] ?? VISITOR_ART.seller)();
  return svg("0 0 90 104", `<ellipse cx="45" cy="100" rx="24" ry="3.4" fill="#000" opacity=".12"/><g class="v-body">${art}</g>`, `visitor visitor-${who}`, tr("Khách qua đường"));
}

// Sân chơi (v9 vẽ lại): bãi cát viền gỗ, cầu trượt nhỏ, lốp xe, bập bênh, dây cờ — chỗ để kéo gà vào chơi.
export const playgroundSvg = () => svg("0 0 140 84", `
  <ellipse cx="70" cy="74" rx="66" ry="10" fill="#000" opacity=".08"/>
  <ellipse cx="70" cy="70" rx="64" ry="12" fill="#b98652"/><ellipse cx="70" cy="68" rx="60" ry="10" fill="#ecd9a0"/>
  <path d="M22,68 q8,-3 16,0 M56,72 q10,-3 20,0 M92,67 q9,-3 18,0" stroke="#d8c07e" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  <path d="M10,22 V66 M130,22 V66" stroke="#8d5f33" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M10,24 Q70,40 130,24" fill="none" stroke="#7d5a2e" stroke-width="1.3"/>
  ${[18, 30, 42, 54, 66, 78, 90, 102, 114].map((x, i) => { const y = 24 + 16 * Math.sin(Math.PI * (x - 10) / 120) * 0.62; return `<path class="flag" d="M${x},${y.toFixed(1)} l4.5,9 4.5,-9z" fill="${["#e4572e", "#f2b318", "#5b9bd5", "#7cc35f"][i % 4]}"/>`; }).join("")}
  <g transform="translate(14 36)">
    <path d="M4,30 V6 M14,30 V6" stroke="#a5713e" stroke-width="2.6"/><path d="M4,10 h10 M4,17 h10 M4,24 h10" stroke="#a5713e" stroke-width="1.8"/>
    <path d="M14,6 Q26,10 32,30 L26,31 Q21,15 12,12Z" fill="#e4572e"/><path d="M14,6 Q26,10 32,30" fill="none" stroke="#b8401f" stroke-width="1.4"/>
    <rect x="2" y="3" width="14" height="4" rx="1.6" fill="#8d5f33"/>
  </g>
  <g transform="translate(58 46)">
    <path d="M2,20 L36,10" stroke="#b98652" stroke-width="4.4" stroke-linecap="round"/><path d="M2,20 L36,10" stroke="#d9a56a" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M15,22 L19,13 L23,22Z" fill="#8d5f33"/>
    <rect x="-1" y="15" width="6" height="3" rx="1.2" fill="#f2b318"/><rect x="33" y="5" width="6" height="3" rx="1.2" fill="#f2b318"/>
  </g>
  <g transform="translate(104 48)">
    <ellipse cx="10" cy="11" rx="11" ry="11" fill="#3b3a3e"/><ellipse cx="10" cy="11" rx="5.5" ry="5.5" fill="#ecd9a0"/>
    <path d="M2,6 a10,10 0 0 1 6,-4" stroke="#6b6a70" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </g>
  <circle cx="98" cy="70" r="4" fill="#5b9bd5"/><path d="M95,68 q3,-2 6,0" stroke="#fff" stroke-width="1" fill="none" opacity=".8"/>
  <circle cx="48" cy="72" r="3.2" fill="#e4572e"/>`, "decor-play", tr("Sân chơi"));

// Tháp hạt (v9): kho hạt có ô kính cho thấy mức hạt, ống máng đổ xuống máng ăn bên trái. fill: 0..1.
export function towerSvg(fill = 0) {
  const f = Math.max(0, Math.min(1, fill)), top = 34, bot = 76, lv = bot - (bot - top) * f;
  const grains = f > 0 ? Array.from({ length: Math.round(6 + 18 * f) }, (_, i) => `<circle cx="${(23 + ((i * 37) % 10)).toFixed(1)}" cy="${(bot - 1.5 - ((i * 53) % Math.max(1, (bot - lv - 2) * 10)) / 10).toFixed(1)}" r="1" fill="${["#f2b318", "#e0a43c", "#c98a3a", "#f6d27a"][i % 4]}"/>`).join("") : "";
  return svg("0 0 56 104", `
  <ellipse cx="30" cy="100" rx="20" ry="3.4" fill="#000" opacity=".14"/>
  <path d="M17,82 L14,100 M43,82 L46,100 M17,82 L43,82" stroke="#7a4e28" stroke-width="3" stroke-linecap="round"/><path d="M15,92 L45,92" stroke="#7a4e28" stroke-width="2"/>
  <path d="M14,30 H46 V78 Q30,88 14,78Z" fill="#c38550"/>
  ${[18.5, 23, 27.5, 32, 36.5, 41].map((x) => `<path d="M${x},31 V${x < 30 ? 80 + (x - 14) * 0.25 : 82 - (x - 30) * 0.3}" stroke="#a46a3a" stroke-width=".9"/>`).join("")}
  <path d="M14,46 H46 M14,64 H46" stroke="#8d5f33" stroke-width="2.4"/>
  <rect x="21" y="${top}" width="14" height="${bot - top}" rx="3" fill="#5b3a1f"/>
  <rect x="22" y="${lv.toFixed(1)}" width="12" height="${(bot - lv).toFixed(1)}" fill="#e0a43c"/>${grains}
  <rect x="21" y="${top}" width="14" height="${bot - top}" rx="3" fill="#cfe8f2" opacity=".28"/><path d="M24,${top + 3} V${bot - 4}" stroke="#fff" stroke-width="1.3" opacity=".6"/>
  <rect x="21" y="${top}" width="14" height="${bot - top}" rx="3" fill="none" stroke="#7a4e28" stroke-width="2"/>
  <path d="M10,31 L30,10 L50,31Z" fill="#c0533a"/><path d="M10,31 L30,10 L50,31" fill="none" stroke="#8f3826" stroke-width="2" stroke-linejoin="round"/>
  <path d="M17,24 h26 M22,18 h16" stroke="#a8432f" stroke-width="1.3"/><circle cx="30" cy="9" r="2.4" fill="#f2b318"/>
  <path d="M14,72 L2,86" stroke="#8d5f33" stroke-width="5" stroke-linecap="round"/><path d="M14,72 L2,86" stroke="#b0773f" stroke-width="2" stroke-linecap="round"/>
  ${f > 0 ? `<g class="tower-drip"><circle cx="2" cy="90" r="1.2" fill="#f2b318"/><circle cx="3" cy="94" r="1" fill="#e0a43c"/></g>` : ""}`, "decor-tower", tr("Tháp hạt"));
}
export const ticketSvg = (size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" fill="#e4572e"/><path d="M9 7v10" stroke="#fffdf6" stroke-width="1.6" stroke-dasharray="2 2"/><circle cx="14.5" cy="12" r="2.4" fill="#ffd95a"/></svg>`;

/* ---------- v7: đồ trang trí mua của nghệ nhân (state.decorOwned) ---------- */
const OWNED = {
  bench: { x: 560, y: 196, w: 62, html: () => svg("0 0 60 34", `<ellipse cx="30" cy="31" rx="26" ry="2.6" fill="#000" opacity=".12"/><rect x="6" y="6" width="48" height="5" rx="2" fill="#d7a970"/><rect x="6" y="13" width="48" height="4" rx="2" fill="#b98652"/><rect x="4" y="19" width="52" height="5" rx="2" fill="#d7a970"/><rect x="9" y="6" width="3.4" height="24" fill="#8d5f33"/><rect x="47.6" y="6" width="3.4" height="24" fill="#8d5f33"/>`, "decor-bench", tr("Ghế gỗ")) },
  well: { x: 232, y: 318, w: 58, html: () => svg("0 0 56 64", `<ellipse cx="28" cy="60" rx="22" ry="3" fill="#000" opacity=".12"/><rect x="9" y="8" width="3.4" height="34" fill="#8d5f33"/><rect x="43.6" y="8" width="3.4" height="34" fill="#8d5f33"/><path d="M4,12 L28,0 L52,12Z" fill="#c4643f"/><path d="M12,10 h32" stroke="#7d5a2e" stroke-width="2.4"/><path d="M28,10 v16" stroke="#7d5a2e" stroke-width="1.4"/><rect x="24" y="25" width="8" height="8" rx="1.6" fill="#b98652"/><path d="M8,40 h40 v16 a4,4 0 0 1 -4,4 h-32 a4,4 0 0 1 -4,-4z" fill="#a9a59c"/><path d="M8,40 h40 v5 h-40z" fill="#8d8a82"/><path d="M14,48 h8 M26,52 h9 M38,48 h6" stroke="#8d8a82" stroke-width="2" stroke-linecap="round"/>`, "decor-well", tr("Giếng nước")) },
  birdhouse: { x: 548, y: 66, w: 30, html: () => svg("0 0 28 46", `<rect x="12.4" y="26" width="3.2" height="20" fill="#8d5f33"/><rect x="5" y="10" width="18" height="17" rx="2" fill="#f2b318"/><path d="M2,12 L14,1 L26,12Z" fill="#e4572e"/><circle cx="14" cy="18" r="3.6" fill="#3d2a17"/><rect x="12.6" y="23" width="6" height="1.6" rx=".8" fill="#8d5f33"/>`, "decor-birdhouse", tr("Chuồng chim")) },
  windchime: { x: 178, y: 128, w: 24, html: () => svg("0 0 22 44", `<path d="M11,0 v8" stroke="#7d5a2e" stroke-width="1.4"/><ellipse cx="11" cy="9" rx="9" ry="2.6" fill="#b98652"/><g class="chime"><rect x="3" y="11" width="2.6" height="20" rx="1.3" fill="#9fd0d8"/><rect x="7.6" y="11" width="2.6" height="27" rx="1.3" fill="#c9e6ea"/><rect x="12.2" y="11" width="2.6" height="23" rx="1.3" fill="#9fd0d8"/><rect x="16.8" y="11" width="2.6" height="17" rx="1.3" fill="#c9e6ea"/></g>`, "decor-windchime", tr("Chuông gió")) },
};
// Trang trí đã mua → danh sách cùng dạng với decorItems().
export const ownedDecor = (keys = []) => keys.filter((k) => OWNED[k]).map((k) => ({ key: `own-${k}`, x: OWNED[k].x, y: OWNED[k].y, w: OWNED[k].w, html: OWNED[k].html() }));

/* ---------- v8: con đường trước cổng, kỳ vật ---------- */
// Dải đường đất từ cổng (762, 208) vòng xuống mép dưới, đi ngang gian hàng — vẽ trên toàn sân 800×480.
export const roadSvg = () => `<svg viewBox="0 0 800 480" aria-hidden="true" class="decor-road">
  <path d="M800,196 C760,214 742,236 726,276 C708,320 700,350 676,392 C650,436 622,458 610,480" fill="none" stroke="#cdb57a" stroke-width="54" stroke-linecap="round"/>
  <path d="M800,196 C760,214 742,236 726,276 C708,320 700,350 676,392 C650,436 622,458 610,480" fill="none" stroke="#e3d39b" stroke-width="40" stroke-linecap="round"/>
  <path d="M790,206 C758,224 744,244 732,280 M700,360 C690,380 676,404 660,426" fill="none" stroke="#ecdfad" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 14" opacity=".8"/></svg>`;

const RELIC = {
  peacockTail: `<path d="M20,34 L6,8 M20,34 L14,4 M20,34 L26,4 M20,34 L34,8" stroke="#2f8f6a" stroke-width="1.6"/>${[[6, 8], [14, 4], [26, 4], [34, 8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.6" fill="#2f8f6a"/><circle cx="${x}" cy="${y}" r="2.8" fill="#3d7bd5"/><circle cx="${x}" cy="${y}" r="1.2" fill="#f2b318"/>`).join("")}`,
  butterflyWings: `<path d="M20,22 C8,4 0,12 4,22 C0,32 10,36 20,24Z" fill="#e98a2c"/><path d="M20,22 C32,4 40,12 36,22 C40,32 30,36 20,24Z" fill="#b23a9b"/><circle cx="9" cy="17" r="2.4" fill="#fffdf6"/><circle cx="31" cy="17" r="2.4" fill="#fffdf6"/><rect x="18.8" y="12" width="2.4" height="18" rx="1.2" fill="#3d2a17"/>`,
  goldenClaws: `<path d="M8,10 L14,30 M20,8 L20,30 M32,10 L26,30" stroke="#f2b318" stroke-width="4" stroke-linecap="round"/><path d="M14,30 l-4,6 M20,30 v7 M26,30 l4,6" stroke="#c98f00" stroke-width="2.6" stroke-linecap="round"/>`,
  dogHead: `<ellipse cx="20" cy="22" rx="12" ry="11" fill="#c08a52"/><path d="M8,16 C2,22 4,32 10,30 Z M32,16 C38,22 36,32 30,30 Z" fill="#7d5a2e"/><circle cx="15.5" cy="19" r="1.8" fill="#2c2620"/><circle cx="24.5" cy="19" r="1.8" fill="#2c2620"/><ellipse cx="20" cy="26" rx="4" ry="3" fill="#2c2620"/><path d="M20,29 q0,4 -3,5 M20,29 q0,4 3,5" stroke="#2c2620" stroke-width="1.2" fill="none"/>`,
};
export const relicSvg = (key, size = 40) => `<svg viewBox="0 0 40 40" width="${size}" height="${size}" class="relic-icon" aria-hidden="true">${RELIC[key] ?? `<circle cx="20" cy="20" r="12" fill="#ffd95a"/>`}</svg>`;

/* ---------- v8: dải phong cảnh phía trên cánh đồng (màn treo máy — next-rounds.md đợt D) ---------- */
// Vẽ trong khung 800×480 nhưng chỉ ở dải y 0..120 (gà không đi tới vùng này: FIELD top 40 + margin 56).
// Màu trời, mặt trời / trăng đổi theo [data-sky] bằng CSS; mây, cối xay quay bằng CSS (tắt khi giảm chuyển động).
export function fieldHorizon(seed = 1) {
  const r = (i) => ((Math.sin(seed * 97 + i * 13.37) + 1) / 2);
  const trees = Array.from({ length: 26 }, (_, i) => {
    const x = i * 32 + r(i) * 18 - 6, s = 9 + r(i + 40) * 8;
    return `<circle cx="${x.toFixed(1)}" cy="${(98 - s * 0.6).toFixed(1)}" r="${s.toFixed(1)}"/>`;
  }).join("");
  const cloud = (x, y, s, d) => `<g class="fh-cloud" style="animation-duration:${d}s;animation-delay:${-d * r(x)}s"><g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="26" ry="9"/><ellipse cx="-12" cy="-6" rx="13" ry="10"/><ellipse cx="9" cy="-9" rx="15" ry="12"/></g></g>`;
  return `<svg viewBox="0 0 800 480" preserveAspectRatio="xMidYMid slice" aria-hidden="true" class="field-horizon">
  <defs>
    <linearGradient id="fh-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--sky-top)"/><stop offset="1" style="stop-color:var(--sky-low)"/></linearGradient>
    <linearGradient id="fh-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6d36f" stop-opacity="0"/><stop offset="1" stop-color="#a6d36f"/></linearGradient>
  </defs>
  <rect width="800" height="104" fill="url(#fh-sky)"/>
  <circle class="fh-sun" cx="640" cy="34" r="16"/><circle class="fh-sun-glow" cx="640" cy="34" r="34"/>
  <g class="fh-moon"><circle cx="150" cy="30" r="11" fill="#fff6c4"/><circle cx="156" cy="26" r="10" style="fill:var(--sky-top)"/></g>
  <g class="fh-stars">${Array.from({ length: 22 }, (_, i) => `<circle cx="${(i * 71 + 30) % 800}" cy="${(i * 29) % 70 + 6}" r="${i % 4 ? 0.9 : 1.6}"/>`).join("")}</g>
  <g class="fh-clouds">${cloud(80, 26, 1, 140)}${cloud(330, 40, 0.8, 180)}${cloud(560, 20, 1.2, 160)}</g>
  <path class="fh-hill-far" d="M0,80 C90,60 170,66 250,74 C330,82 400,58 500,62 C600,66 690,52 800,64 V108 H0Z"/>
  <path class="fh-hill-near" d="M0,92 C120,78 220,84 330,90 C450,96 540,80 660,84 C720,86 760,82 800,86 V112 H0Z"/>
  <g class="fh-mill" transform="translate(560 46)"><path d="M-6,46 L-3,8 h6 L6,46Z" fill="#e9dcc3"/><rect x="-2" y="30" width="4" height="7" rx="1" fill="#8d5f33"/><path d="M-7,10 L0,1 L7,10Z" fill="#c4643f"/><g class="fh-blades"><path d="M0,6 L0,-18 M0,6 L24,6 M0,6 L0,30 M0,6 L-24,6" stroke="#fffdf6" stroke-width="3.4" stroke-linecap="round"/></g></g>
  <g class="fh-trees">${trees}</g>
  <rect y="100" width="800" height="26" fill="url(#fh-fade)"/>
</svg>`;
}
