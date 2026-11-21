// Trại Gà — hình trang trí sân trại (phần thưởng nhìn thấy được) và vài biểu tượng cho nhiệm vụ.
// Kiểu "Phẳng 1": mảng màu phẳng, không viền. Toạ độ thế giới 800×480 như icons.js.
// Trang trí suy ra từ tiến độ (rules.decorOf), không lưu riêng.

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
  return svg("0 0 420 36", o, "decor-bunting", "Dây cờ");
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
  return svg("0 0 60 30", o, "decor-flowers", "Luống hoa");
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
    <path d="M26,33 v6" stroke="#f2b318" stroke-width="1.6" stroke-linecap="round"/>`, "decor-lantern", "Đèn lồng");
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
    <rect x="19.5" y="12.6" width="17" height="2.6" rx="1" fill="#e4572e"/>`, "decor-scarecrow", "Bù nhìn rơm");
}

function pinwheel() {
  const blades = [0, 90, 180, 270].map((a, i) => `<path transform="rotate(${a} 15 14)" d="M15,14 L15,2 Q24,4 22,13Z" fill="${FLAG[i % 4]}"/>`).join("");
  return svg("0 0 30 62", `
    <ellipse cx="15" cy="59.5" rx="7" ry="1.8" fill="#000" opacity=".12"/>
    <rect x="13.6" y="13" width="2.8" height="46" rx="1.2" fill="#b98652"/>
    <g class="spin">${blades}<circle cx="15" cy="14" r="2.2" fill="#fffdf6"/></g>`, "decor-pinwheel", "Chong chóng");
}

function rosette(i) {
  const c = ["#e4572e", "#4a8f9c", "#f2b318", "#b23a9b", "#7cc35f", "#e98a2c", "#5b7bd5", "#f2c94c"][i % 8];
  return svg("0 0 16 24", `
    <path d="M5,11 l-2,12 4,-3.4 2.6,3.4 -1,-12z" fill="${c}" opacity=".85"/><path d="M11,11 l2,12 -4,-3.4 -2.6,3.4 1,-12z" fill="${c}"/>
    <circle cx="8" cy="8" r="7" fill="${c}"/><circle cx="8" cy="8" r="4.2" fill="#fffdf6"/><circle cx="8" cy="8" r="2" fill="${c}"/>`, "decor-rosette", "Nơ giống");
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
  <path class="s3" d="M32,5 q.5,3.2 3.6,4 q-3.1,.8 -3.6,4 q-.5,-3.2 -3.6,-4 q3.1,-.8 3.6,-4Z" fill="#fff"/>`, "sparkle", "Đốm sáng");

export const chestSvg = (open = false) => svg("0 0 40 36", `
  <ellipse cx="20" cy="33.5" rx="15" ry="2.2" fill="#000" opacity=".12"/>
  <rect x="5" y="15" width="30" height="17" rx="3" fill="#b98652"/>
  <rect x="5" y="15" width="30" height="5" fill="#8d5f33"/>
  ${open
    ? `<path d="M6,15 q14,-22 28,0z" fill="#d7a970"/><path d="M9,15 q11,-15 22,0z" fill="#ffd95a"/><circle cx="15" cy="11" r="2" fill="#fff"/><circle cx="24" cy="8.5" r="1.6" fill="#fff"/>`
    : `<path d="M5,16 v-3 a8,8 0 0 1 8,-8 h14 a8,8 0 0 1 8,8 v3z" fill="#d7a970"/><rect x="5" y="12.6" width="30" height="3.4" fill="#a9743f"/>`}
  <rect x="17.4" y="${open ? 17 : 12}" width="5.2" height="8" rx="1.6" fill="#f2b318"/>
  <rect x="9" y="${open ? 15 : 5}" width="3" height="${open ? 17 : 27}" fill="#f2b318" opacity=".9"/><rect x="28" y="${open ? 15 : 5}" width="3" height="${open ? 17 : 27}" fill="#f2b318" opacity=".9"/>`, "chest", "Rương");

export const flameSvg = () => svg("0 0 20 24", `
  <path d="M10,1 Q16,7 15.5,13 Q18,11 17.6,8 Q21,14 18,19 Q15.5,23 10,23 Q4.5,23 2,19 Q-.6,14 4.4,8.5 Q4.6,12 7,13 Q6,7 10,1Z" fill="#e4572e"/>
  <path d="M10,10 Q13.4,14 13,17.4 Q12.6,21 10,21 Q7.4,21 7,17.6 Q6.8,15 8.6,13.4 Q9,15 10,15.4 Q9.4,12.6 10,10Z" fill="#ffd95a"/>`, "flame", "Chuỗi ngày");

// vết nứt phủ lên trứng trong ổ (viewBox của ổ ấp 96×96, trứng ở giữa ~ (48, 46))
export const nestCrackSvg = (level) => svg("0 0 96 96", `
  <path d="M36,44 l5,-4 4,5 5,-6 4,5 5,-3${level > 1 ? " M45,45 l-2,6 4,3 M54,44 l2,6" : ""}${level > 2 ? " M41,40 l-3,-5 M50,39 l1,-6 4,-2" : ""}" fill="none" stroke="#5a4028" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`, "nest-crack");


/* ---------- v7: gian hàng bên đường, khách qua đường, sân chơi ---------- */

export const stallSvg = (sign = "CHỢ") => {
  // quầy gỗ có mái bạt sọc mép lượn sóng, trên quầy: rổ trứng, bao hạt, biển "CHỢ"
  const scallop = Array.from({ length: 7 }, (_, i) => `<path d="M${10 + i * 14},27 a7,7 0 0 0 14,0Z" fill="${i % 2 ? "#fffdf6" : "#e4572e"}"/>`).join("");
  const stripes = Array.from({ length: 7 }, (_, i) => `<path d="M${14 + i * 14},10 L${10 + i * 14},27 h14 L${28 + i * 14},10Z" fill="${i % 2 ? "#fffdf6" : "#e4572e"}"/>`).join("");
  return svg("0 0 120 96", `
  <ellipse cx="60" cy="92" rx="50" ry="4.5" fill="#000" opacity=".14"/>
  <rect x="16" y="22" width="5" height="68" rx="2" fill="#8d5f33"/><rect x="99" y="22" width="5" height="68" rx="2" fill="#8d5f33"/>
  <path d="M6,12 Q60,2 114,12 L112,27 H8Z" fill="#c4643f"/>${stripes}${scallop}
  <rect x="10" y="56" width="100" height="32" rx="3" fill="#b98652"/><rect x="10" y="56" width="100" height="6" rx="2" fill="#d7a970"/>
  <path d="M14,70 h92 M14,80 h92" stroke="#a9743f" stroke-width="1.6"/>
  <path d="M22,56 q12,-14 26,0z" fill="#c9a66b"/>${[26, 32, 38, 44, 29, 35, 41].map((x, i) => `<ellipse cx="${x}" cy="${i < 4 ? 52 : 47}" rx="3.4" ry="4.2" fill="${["#f6f0e4", "#e8c9a0", "#b5dccd", "#f6f0e4"][i % 4]}"/>`).join("")}
  <path d="M62,56 q-2,-16 8,-18 q12,-2 12,10 q0,6 -2,8z" fill="#d4ac72"/><path d="M66,42 q6,-4 12,0" stroke="#7d5a2e" stroke-width="1.6" fill="none"/><circle cx="70" cy="40" r="2" fill="#e3b23c"/><circle cx="75" cy="39" r="2" fill="#4f8f97"/>
  <rect x="86" y="44" width="18" height="12" rx="2" fill="#fffdf6"/><path d="M95,44 v-6" stroke="#8d5f33" stroke-width="1.6"/>
  <text x="95" y="53" text-anchor="middle" font-size="7" font-weight="800" font-family="system-ui,sans-serif" fill="#8a3414">${sign}</text>`, "decor-stall", "Gian hàng bên đường");
};

const LOOK = {
  seller: ["#b23a9b", "#f2b318", "cone"], trader: ["#4a8f9c", "#8d5f33", "flat"], collector: ["#3f7a2c", "#2c2620", "top"],
  reader: ["#5b7bd5", "#fffdf6", "none"], haggler: ["#e4572e", "#7d5a2e", "flat"], artisan: ["#e98a2c", "#b23a9b", "beret"], stranger: ["#3b3554", "#3b3554", "hood"],
};
export function visitorSvg(who) {
  const [robe, hatC, hat] = LOOK[who] ?? LOOK.seller;
  const hats = {
    cone: `<path d="M22,26 L45,8 L68,26 Q45,31 22,26Z" fill="${hatC}"/>`,
    flat: `<ellipse cx="45" cy="22" rx="20" ry="4.5" fill="${hatC}"/><path d="M33,22 q12,-14 24,0z" fill="${hatC}"/>`,
    top: `<rect x="35" y="5" width="20" height="16" rx="2" fill="${hatC}"/><rect x="28" y="19" width="34" height="4" rx="2" fill="${hatC}"/>`,
    beret: `<path d="M29,22 q4,-13 20,-11 q14,2 12,11z" fill="${hatC}"/>`,
    hood: `<path d="M26,44 Q22,8 45,7 Q68,8 64,44 Q56,26 45,26 Q34,26 26,44Z" fill="${hatC}"/>`,
    none: `<path d="M32,24 q13,-13 26,0" stroke="#d9d4c8" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  };
  return svg("0 0 90 104", `
    <ellipse cx="45" cy="100" rx="24" ry="3.4" fill="#000" opacity=".12"/>
    <path d="M24,98 Q20,54 45,50 Q70,54 66,98Z" fill="${robe}"/><path d="M40,52 h10 v46 h-10z" fill="#000" opacity=".12"/>
    <circle cx="45" cy="34" r="14" fill="${who === "stranger" ? "#55506e" : "#f0c9a0"}"/>
    ${who === "stranger" ? `<circle cx="40" cy="34" r="2" fill="#ffd95a"/><circle cx="50" cy="34" r="2" fill="#ffd95a"/>` : `<circle cx="40" cy="33" r="1.7" fill="#3d2a17"/><circle cx="50" cy="33" r="1.7" fill="#3d2a17"/><path d="M40,40 q5,3.4 10,0" stroke="#3d2a17" stroke-width="1.6" fill="none" stroke-linecap="round"/>`}
    ${hats[hat]}`, "visitor", "Khách qua đường");
}
export const playgroundSvg = () => svg("0 0 90 60", `
  <ellipse cx="45" cy="52" rx="42" ry="7" fill="#e3d39b"/><ellipse cx="45" cy="52" rx="42" ry="7" fill="none" stroke="#cdb57a" stroke-width="2"/>
  <rect x="14" y="20" width="3.4" height="32" fill="#8d5f33"/><rect x="72" y="20" width="3.4" height="32" fill="#8d5f33"/>
  <path d="M15,22 Q45,34 74,22" fill="none" stroke="#7d5a2e" stroke-width="1.6"/>
  <path d="M26,25 l4,9 4,-8z M40,28 l4,9 4,-9z M54,27 l4,9 4,-9z" fill="#e4572e"/><path d="M33,27 l4,9 4,-9z M47,28 l4,9 4,-9z" fill="#f2b318"/>
  <rect x="34" y="44" width="22" height="4" rx="2" fill="#b98652"/><rect x="43" y="40" width="4" height="10" fill="#8d5f33"/>`, "decor-play", "Sân chơi");
export const ticketSvg = (size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" fill="#e4572e"/><path d="M9 7v10" stroke="#fffdf6" stroke-width="1.6" stroke-dasharray="2 2"/><circle cx="14.5" cy="12" r="2.4" fill="#ffd95a"/></svg>`;

/* ---------- v7: đồ trang trí mua của nghệ nhân (state.decorOwned) ---------- */
const OWNED = {
  bench: { x: 560, y: 196, w: 62, html: () => svg("0 0 60 34", `<ellipse cx="30" cy="31" rx="26" ry="2.6" fill="#000" opacity=".12"/><rect x="6" y="6" width="48" height="5" rx="2" fill="#d7a970"/><rect x="6" y="13" width="48" height="4" rx="2" fill="#b98652"/><rect x="4" y="19" width="52" height="5" rx="2" fill="#d7a970"/><rect x="9" y="6" width="3.4" height="24" fill="#8d5f33"/><rect x="47.6" y="6" width="3.4" height="24" fill="#8d5f33"/>`, "decor-bench", "Ghế gỗ") },
  well: { x: 232, y: 318, w: 58, html: () => svg("0 0 56 64", `<ellipse cx="28" cy="60" rx="22" ry="3" fill="#000" opacity=".12"/><rect x="9" y="8" width="3.4" height="34" fill="#8d5f33"/><rect x="43.6" y="8" width="3.4" height="34" fill="#8d5f33"/><path d="M4,12 L28,0 L52,12Z" fill="#c4643f"/><path d="M12,10 h32" stroke="#7d5a2e" stroke-width="2.4"/><path d="M28,10 v16" stroke="#7d5a2e" stroke-width="1.4"/><rect x="24" y="25" width="8" height="8" rx="1.6" fill="#b98652"/><path d="M8,40 h40 v16 a4,4 0 0 1 -4,4 h-32 a4,4 0 0 1 -4,-4z" fill="#a9a59c"/><path d="M8,40 h40 v5 h-40z" fill="#8d8a82"/><path d="M14,48 h8 M26,52 h9 M38,48 h6" stroke="#8d8a82" stroke-width="2" stroke-linecap="round"/>`, "decor-well", "Giếng nước") },
  birdhouse: { x: 548, y: 66, w: 30, html: () => svg("0 0 28 46", `<rect x="12.4" y="26" width="3.2" height="20" fill="#8d5f33"/><rect x="5" y="10" width="18" height="17" rx="2" fill="#f2b318"/><path d="M2,12 L14,1 L26,12Z" fill="#e4572e"/><circle cx="14" cy="18" r="3.6" fill="#3d2a17"/><rect x="12.6" y="23" width="6" height="1.6" rx=".8" fill="#8d5f33"/>`, "decor-birdhouse", "Chuồng chim") },
  windchime: { x: 178, y: 128, w: 24, html: () => svg("0 0 22 44", `<path d="M11,0 v8" stroke="#7d5a2e" stroke-width="1.4"/><ellipse cx="11" cy="9" rx="9" ry="2.6" fill="#b98652"/><g class="chime"><rect x="3" y="11" width="2.6" height="20" rx="1.3" fill="#9fd0d8"/><rect x="7.6" y="11" width="2.6" height="27" rx="1.3" fill="#c9e6ea"/><rect x="12.2" y="11" width="2.6" height="23" rx="1.3" fill="#9fd0d8"/><rect x="16.8" y="11" width="2.6" height="17" rx="1.3" fill="#c9e6ea"/></g>`, "decor-windchime", "Chuông gió") },
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
