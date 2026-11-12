// Trại Gà — bộ dựng gà 3D (Three.js) từ kiểu hình.
// Cùng ý tưởng với bản SVG: không có mô hình làm sẵn, mỗi bộ phận là một khối
// hình học sinh ra từ số đo của express(). Đổi gen → đổi khối.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clamp, lerp, mix, shade, tint, luminance, mulberry32 } from "./genome.js";

const RAD = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function supported() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/* ---------- texture hoa văn (vẽ bằng canvas, có bộ nhớ đệm) ---------- */

const texCache = new Map();
function cachedTexture(key, draw, repeat) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  draw(c.getContext("2d"));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 4;
  t.userData.cached = true;
  texCache.set(key, t);
  if (texCache.size > 240) {
    const [oldKey, old] = texCache.entries().next().value;
    texCache.delete(oldKey);
    old.dispose();
  }
  return t;
}

function markColor(fill, accent, kind) {
  if (kind === "mottled") return tint(fill, 0.85);
  if (Math.abs(luminance(fill) - luminance(accent)) > 0.18) return accent;
  return luminance(fill) > 0.45 ? shade(fill, 0.75) : tint(fill, 0.7);
}

function patternTexture(kind, fill, mark, alpha) {
  const a = Math.round(alpha * 10) / 10;
  const repeat = { barred: [1, 2], laced: [12, 7], spangled: [12, 7], mottled: [9, 6] }[kind];
  return cachedTexture(`${kind}|${fill}|${mark}|${a}`, (x) => {
    x.fillStyle = fill;
    x.fillRect(0, 0, 128, 128);
    x.globalAlpha = a;
    x.fillStyle = mark;
    x.strokeStyle = mark;
    if (kind === "barred") {
      for (let i = 0; i < 8; i++) x.fillRect(0, i * 16, 128, 7);
    } else if (kind === "laced") {
      x.lineWidth = 9;
      for (const [cx, cy] of [[0, 64], [64, 64], [128, 64], [32, 128], [96, 128], [32, 0], [96, 0]]) {
        x.beginPath();
        x.arc(cx, cy, 30, Math.PI, 0);
        x.stroke();
      }
    } else if (kind === "spangled") {
      for (const [cx, cy] of [[32, 40], [96, 104], [96, 40 - 64], [32, 104 + 64 - 128]]) {
        x.beginPath();
        x.ellipse(cx, cy, 14, 20, 0, 0, Math.PI * 2);
        x.fill();
      }
    } else if (kind === "mottled") {
      for (const [cx, cy, r] of [[20, 22, 9], [84, 40, 7], [44, 92, 8], [108, 104, 6], [70, 8, 5]]) {
        x.beginPath();
        x.arc(cx, cy, r, 0, Math.PI * 2);
        x.fill();
      }
    }
  }, repeat);
}

function speckleTexture(shell, amount, seed) {
  return cachedTexture(`egg|${shell}|${amount.toFixed(2)}|${seed}`, (x) => {
    x.fillStyle = shell;
    x.fillRect(0, 0, 128, 128);
    const rng = mulberry32(seed + 7);
    x.fillStyle = shade(shell, 0.55);
    for (let i = 0; i < Math.round(amount * 70); i++) {
      x.globalAlpha = 0.45 + rng() * 0.45;
      x.beginPath();
      x.ellipse(rng() * 128, 12 + rng() * 104, 1.5 + rng() * 3, 1.2 + rng() * 2.5, rng() * 3, 0, Math.PI * 2);
      x.fill();
    }
  }, [1, 1]);
}

let shadowTex = null;
function shadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,.32)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  shadowTex.userData.cached = true;
  return shadowTex;
}

/* ---------- khối hình cơ bản ---------- */

function material(color, { map = null, rough = 0.8, side = THREE.FrontSide } = {}) {
  return new THREE.MeshStandardMaterial({ color: map ? 0xffffff : color, map, roughness: rough, metalness: 0, side });
}

// Hình cầu bị nắn: fn nhận điểm trên mặt cầu đơn vị, trả về vị trí mới.
function shapedSphere(w, h, fn) {
  const geo = new THREE.SphereGeometry(1, w, h);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = fn(p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

const ellipsoid = (rx, ry, rz, seg = 16) => shapedSphere(seg, Math.max(8, seg * 0.66 | 0), (x, y, z) => [x * rx, y * ry, z * rz]);

// lông tơ (gợn tròn) và lông xoăn (gai) trên bề mặt
function texture(x, y, z, fluff, frizz) {
  let d = 0;
  if (frizz) d += frizz * Math.max(0, Math.sin(x * 23 + y * 7) * Math.sin(y * 19 + z * 11) * Math.sin(z * 17 + x * 5)) * 2.2;
  if (fluff) d += fluff * (0.5 + 0.5 * Math.sin(x * 15) * Math.sin(y * 13 + 1) * Math.sin(z * 14 + 2));
  return 1 + d;
}

function leafGeometry(len, w, curl = 0) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(len * 0.45, w, len, curl * len);
  s.quadraticCurveTo(len * 0.45, -w, 0, 0);
  return new THREE.ShapeGeometry(s, 8);
}

// Ống thuôn dọc đường cong (lông đuôi cong của gà trống)
function taperedTube(curve, r0, r1, seg = 32, radial = 6) {
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const p = geo.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const r = lerp(r0, r1, i / seg);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r);
      v.z *= 0.55;
      p.setXYZ(k, c.x + v.x, c.y + v.y, c.z + v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function orient(mesh, from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return len;
}

/* ---------- mào: 4 kiểu theo gen R và P ---------- */

function combShape(type, r, ch, rooster) {
  const P = (deg, rad) => new THREE.Vector2(rad * Math.cos(deg * RAD), rad * Math.sin(deg * RAD));
  const s = new THREE.Shape();
  const move = (v) => s.moveTo(v.x, v.y);
  const line = (v) => s.lineTo(v.x, v.y);
  const quad = (c, v) => s.quadraticCurveTo(c.x, c.y, v.x, v.y);
  if (type === "single") {
    const a0 = 32, a1 = rooster ? 158 : 142;
    const n = Math.max(4, Math.min(6, Math.round(3 + ch / (r * 0.33))));
    const val = (t) => P(lerp(a0, a1, t), r + ch * 0.26);
    move(P(a0, r * 0.5));
    line(val(0));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const prof = 0.68 + 0.32 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      quad(P(lerp(a0, a1, t) + 7, r + ch * prof * 1.5), val((i + 1) / n));
    }
    line(P(a1, r * 0.5));
  } else if (type === "rose") {
    const a0 = 40, a1 = 138, n = 7;
    const val = (t) => P(lerp(a0, a1, t), r + ch * 0.14);
    move(P(a0, r * 0.55));
    line(val(0));
    for (let i = 0; i < n; i++) quad(P(lerp(a0, a1, (i + 0.5) / n), r + ch * 0.48), val((i + 1) / n));
    line(P(150, r + ch * 0.3));
    const leader = P(165, r + ch * 0.22);
    line(new THREE.Vector2(leader.x - ch * 0.75, leader.y));
    line(P(160, r * 0.75));
  } else if (type === "pea") {
    const a0 = 55, a1 = 122, n = 3;
    const val = (t) => P(lerp(a0, a1, t), r + ch * 0.1);
    move(P(a0, r * 0.6));
    line(val(0));
    for (let i = 0; i < n; i++) quad(P(lerp(a0, a1, (i + 0.5) / n), r + ch * 0.62), val((i + 1) / n));
    line(P(a1, r * 0.6));
  } else {
    move(P(52, r * 0.65));
    line(P(52, r + ch * 0.08));
    const c1 = P(58, r + ch * 0.8), c2 = P(118, r + ch * 0.8), e = P(124, r + ch * 0.08);
    s.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
    line(P(124, r * 0.65));
  }
  s.closePath();
  return s;
}

/* ---------- con gà ---------- */

export function buildChicken(ph, growth = 1) {
  const g = clamp(growth);
  const S = ph.shape, K = ph.colors;
  const rooster = ph.sex === "rooster";
  const adult = smooth(0.12, 0.95, g);
  const mature = smooth(0.5, 1, g);
  const featherIn = smooth(0.3, 0.9, g);
  const combG = smooth(0.35, 1, g);

  const region = (c) => mix(K.down, c, featherIn);
  const fills = { body: region(K.base), wing: region(K.wing), tail: region(K.tail), hackle: region(K.hackle) };
  const rough = lerp(0.92, 0.38, ph.care.gloss * featherIn);
  const M = {};
  for (const [k, col] of Object.entries(fills)) {
    const map = ph.pattern === "solid" ? null : patternTexture(ph.pattern, col, markColor(col, K.accent, ph.pattern), featherIn * (k === "hackle" ? 0.7 : 1));
    M[k] = material(col, { map, rough });
  }
  M.tailSide = M.tail.clone();
  M.tailSide.side = THREE.DoubleSide;
  M.head = material(fills.hackle, { rough });
  M.comb = material(K.comb, { rough: 0.5 });
  M.combDark = material(shade(K.comb, 0.12), { rough: 0.5 });
  M.leg = material(K.leg, { rough: 0.55 });
  M.beak = material(K.beak, { rough: 0.45 });
  M.iris = material(mix("#2b211c", K.eye, adult), { rough: 0.15 });
  M.pupil = material("#0d0907", { rough: 0.1 });
  M.white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  M.ear = material(K.earlobe, { rough: 0.4 });
  M.crest = material(region(tint(K.hackle, 0.08)), { rough });

  const root = new THREE.Group();
  const put = (parent, geo, mat, part, pos) => {
    const m = new THREE.Mesh(geo, mat.clone()); // vật liệu riêng để làm mờ / làm nổi từng bộ phận
    m.userData.part = part;
    if (pos) m.position.copy(pos);
    parent.add(m);
    return m;
  };

  const L = lerp(0.85, S.bodyLength, adult);
  const H = lerp(1, S.plump, adult) * (rooster ? lerp(1, 0.95, mature) : 1);
  const a = 1.0 * L, b = 0.8 * H, c = 0.7 * H;
  const tilt = lerp(6, S.posture, adult) * RAD;
  const legLen = lerp(0.3, 0.72 * S.legLen, adult);
  const bodyY = legLen + b * 0.8;
  const rotB = (x, y) => new THREE.Vector3(x * Math.cos(tilt) - y * Math.sin(tilt), bodyY + x * Math.sin(tilt) + y * Math.cos(tilt), 0);

  const fluff = 0.07 * (1 - adult) + (S.silkie ? 0.08 : 0);
  const frizz = S.frizzle * 0.05 * adult;

  /* thân */
  const body = new THREE.Group();
  body.position.set(0, bodyY, 0);
  body.rotation.z = tilt;
  root.add(body);
  put(body, shapedSphere(48, 32, (x, y, z) => {
    let Y = y, Z = z;
    if (x < 0) {
      const k = 1 + x * 0.32 * adult;
      Y = Y * k - x * 0.22 * adult;
      Z *= k;
    } else if (y < 0) Y *= 1 + 0.12 * x * adult;
    const k = texture(x, y, z, fluff, frizz);
    return [x * a * k, Y * b * k, Z * c * k];
  }), M.body, "body");

  /* cánh */
  const ws = lerp(0.45, 0.92, adult);
  const droop = S.wingDroop * adult;
  for (const side of [1, -1]) {
    const geo = shapedSphere(28, 18, (x, y, z) => {
      let Y = y;
      if (x < 0) Y = Y * (1 + x * 0.55) - x * 0.12;
      const k = texture(x, y, z, fluff * 0.8, frizz * 0.6);
      return [x * 0.62 * a * ws * k, Y * 0.44 * b * ws * k, z * 0.12 * k];
    });
    const w = put(body, geo, M.wing, "wing", new THREE.Vector3(-0.1 * a, 0.08 * b - droop * 0.12, side * c * 0.9));
    w.rotation.set(side * 0.06, side * -0.08, -0.1 - droop * 0.35);
  }

  /* đuôi */
  const tailG = smooth(0.25, 1, g);
  if (S.tailType !== "rumpless" && tailG > 0.02) {
    const tail = new THREE.Group();
    tail.position.set(-0.84 * a, 0.3 * b, 0);
    tail.rotation.z = -tilt * 0.6;
    body.add(tail);
    const longF = 1 + 0.35 * S.longTail;
    const len = 0.95 * S.tailLen * tailG * longF * (S.silkie ? 0.7 : 1);
    const center = lerp(162, 108, S.tailAngle);
    const curl = (0.5 - S.tailCurl) * 0.35;
    const n = S.tailCount;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const side = i % 2 ? 1 : -1;
      const pivot = new THREE.Group();
      pivot.rotation.x = side * (0.22 + 0.25 * Math.abs(t - 0.5));
      pivot.position.z = side * 0.04;
      tail.add(pivot);
      const l = len * (0.72 + 0.28 * Math.sin(Math.PI * t));
      const m = put(pivot, leafGeometry(l, (S.silkie ? 0.2 : 0.15) * lerp(0.6, 1, tailG), curl), M.tailSide, "tail");
      m.rotation.z = (center + (t - 0.5) * 44) * RAD;
    }
    if (rooster && mature > 0.02) {
      const sickles = n > 6 ? 3 : 2;
      const Ls = len * mature;
      for (let j = 0; j < sickles; j++) {
        const k = (1.12 + 0.2 * j) * (1 + 0.8 * S.longTail);
        const a0 = (center - 10 + j * 6) * RAD;
        const z = (j - (sickles - 1) / 2) * 0.07;
        const p0 = new THREE.Vector3(0.02, 0.02, z);
        const p1 = new THREE.Vector3(Math.cos(a0) * Ls * k * 0.55, Math.sin(a0) * Ls * k * 0.55, z);
        const dropY = S.longTail ? -Ls * k * 0.45 * S.longTail : Ls * k * 0.05 - (S.tailCurl - 0.5) * Ls * 0.4;
        const p3 = new THREE.Vector3(-Ls * k * 0.9, dropY, z * 1.6);
        const p2 = new THREE.Vector3(p3.x + Ls * k * 0.12, p3.y + Ls * k * (0.42 + S.tailCurl * 0.2), z * 1.4);
        put(tail, taperedTube(new THREE.CubicBezierCurve3(p0, p1, p2, p3), 0.095, 0.015), M.tail, "tail");
      }
    }
  }

  /* chân */
  const belly = rotB(0.04 * a, -0.84 * b);
  const lw = lerp(0.045, 0.058, adult);
  const toeL = lerp(0.13, 0.22, adult);
  for (const side of [1, -1]) {
    const z = side * c * 0.36;
    const top = new THREE.Vector3(belly.x, belly.y + 0.05, z);
    const foot = new THREE.Vector3(belly.x, lw * 0.7, z);
    const shank = put(root, new THREE.CylinderGeometry(lw, lw * 1.08, 1, 10), M.leg, "legs");
    shank.scale.y = orient(shank, top, foot);
    const thigh = put(root, ellipsoid(0.2 * L, lerp(0.16, 0.24, adult), 0.17, 18), M.body, "legs", new THREE.Vector3(belly.x - 0.02, belly.y + 0.1, z * 0.9));
    thigh.rotation.z = -0.2;
    const toes = [-28, 0, 28, 180];
    if (S.toes > 4) toes.push(158);
    for (const deg of toes) {
      const l = deg === 180 || deg === 158 ? toeL * 0.5 : toeL * (deg ? 0.85 : 1);
      const end = foot.clone().add(new THREE.Vector3(Math.cos(deg * RAD) * l, -lw * 0.4, Math.sin(deg * RAD) * l));
      const toe = put(root, new THREE.CylinderGeometry(lw * 0.55, lw * 0.6, 1, 8), M.leg, "legs");
      toe.scale.y = orient(toe, foot, end);
    }
    if (rooster && mature > 0.3) {
      const spur = put(root, new THREE.ConeGeometry(lw * 0.5, 0.12 * mature, 8), M.leg, "legs", new THREE.Vector3(foot.x - lw - 0.04 * mature, legLen * 0.35, z));
      spur.rotation.z = Math.PI / 2;
    }
    if (S.feetFeather) {
      const n = S.feetFeather === 2 ? 6 : 3;
      for (let i = 0; i < n; i++) {
        const y = lerp(belly.y - 0.05, 0.08, i / Math.max(1, n - 1));
        const f = put(root, ellipsoid(0.05, 0.11 * (S.feetFeather === 2 ? 1.25 : 1), 0.04, 10), M.body, "legs", new THREE.Vector3(foot.x - 0.03, y, z + side * lw * 1.4));
        f.rotation.set(side * 0.5, 0, -0.5);
      }
      if (S.feetFeather === 2) {
        const f = put(root, ellipsoid(toeL * 0.55, 0.035, 0.05, 10), M.body, "legs", foot.clone().add(new THREE.Vector3(toeL * 0.45, 0.03, side * 0.03)));
        f.rotation.z = 0.1;
      }
    }
  }

  /* cổ, bờm, đầu */
  const shoulder = rotB(0.56 * a, 0.5 * b);
  const r = lerp(0.42, 0.3, adult) * (rooster ? lerp(1, 1.05, mature) : 1);
  const headOff = new THREE.Vector3(lerp(0.12, 0.2 + 0.08 * S.neck, adult), lerp(0.34, 0.28 + 0.5 * S.neck, adult), 0);
  const headPivot = new THREE.Group();
  headPivot.position.copy(shoulder);
  root.add(headPivot);
  const neck = put(headPivot, new THREE.CylinderGeometry(r * 0.78, c * lerp(0.55, 0.62, adult), 1, 20, 1, true), M.hackle, "hackle");
  neck.scale.y = orient(neck, new THREE.Vector3(-0.04, -0.12, 0), headOff);
  if (adult > 0.2 && !S.silkie) {
    // áo choàng lông bờm: viền dưới là các mũi lông nhọn rủ xuống vai
    const dist = headOff.length();
    const capeH = dist * 0.8 + 0.08;
    const tl = lerp(0.03, 0.14 + (rooster ? 0.12 * mature : 0), adult) * (S.frizzle ? 1.3 : 1);
    const seg = rooster ? 22 : 18;
    const geo = new THREE.CylinderGeometry(r * 0.86, c * 0.82, capeH, seg, 1, true);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) continue;
      const j = i % (seg + 1);
      const tip = j % 2 === 0;
      const out = tip ? 1.1 : 0.98;
      p.setXYZ(i, p.getX(i) * out, p.getY(i) - (tip ? tl : -tl * 0.15), p.getZ(i) * out);
    }
    geo.computeVertexNormals();
    const cape = new THREE.Mesh(geo, M.hackle.clone());
    cape.material.side = THREE.DoubleSide;
    cape.userData.part = "hackle";
    headPivot.add(cape);
    const dir = headOff.clone().normalize();
    cape.quaternion.setFromUnitVectors(UP, dir);
    cape.position.copy(dir.clone().multiplyScalar(dist * 0.62 - capeH / 2)).add(new THREE.Vector3(-0.03, 0, 0));
    if (S.frizzle) cape.scale.set(1.08, 1, 1.08);
  }

  const head = new THREE.Group();
  head.position.copy(headOff);
  headPivot.add(head);
  put(head, shapedSphere(28, 20, (x, y, z) => {
    const k = texture(x * 1.3, y * 1.3, z * 1.3, fluff * 0.6, 0);
    return [x * r * 1.04 * k, y * r * k, z * r * 0.94 * k];
  }), M.head, "head");

  // mắt (hai bên)
  const eyes = [];
  const eyeR = lerp(0.12, 0.062, adult) * S.eyeSize;
  for (const side of [1, -1]) {
    const eye = new THREE.Group();
    eye.position.set(r * 0.36, r * 0.16, side * r * 0.8);
    head.add(eye);
    put(eye, new THREE.SphereGeometry(eyeR, 16, 12), M.iris, "eye");
    put(eye, new THREE.SphereGeometry(eyeR * (adult > 0.5 ? 0.52 : 0.66), 12, 10), M.pupil, "eye", new THREE.Vector3(eyeR * 0.1, 0, side * eyeR * 0.55));
    put(eye, new THREE.SphereGeometry(eyeR * 0.24, 8, 6), M.white, "eye", new THREE.Vector3(eyeR * 0.35, eyeR * 0.4, side * eyeR * 0.85));
    eyes.push(eye);
    if (combG > 0.05) {
      const face = put(head, ellipsoid(r * 0.46, r * 0.42, r * 0.22), M.comb, "face", new THREE.Vector3(r * 0.32, -r * 0.04, side * r * 0.74));
      face.scale.setScalar(combG);
      face.rotation.y = side * -0.5;
      const ear = put(head, ellipsoid(r * 0.15, r * 0.21, r * 0.06, 12), M.ear, "earlobe", new THREE.Vector3(-r * 0.08, -r * 0.4, side * r * 0.86));
      ear.scale.setScalar(combG);
      ear.rotation.y = side * -0.3;
    }
  }

  // mỏ
  const bl = lerp(0.17, 0.12 + 0.17 * S.beakLen, adult);
  const bh = r * 0.27;
  const beakGeo = (radius, length, bend) => {
    const geo = new THREE.ConeGeometry(radius, length, 14);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + length / 2) / length;
      p.setX(i, p.getX(i) + bend * t * t * length);
    }
    geo.rotateZ(-Math.PI / 2);
    geo.scale(1, 1, 0.82);
    geo.computeVertexNormals();
    return geo;
  };
  put(head, beakGeo(bh, bl, S.beakCurve * 0.35), M.beak, "beak", new THREE.Vector3(r * 0.86 + bl * 0.4, -r * 0.02, 0));
  put(head, beakGeo(bh * 0.62, bl * 0.72, 0.1), material(shade(K.beak, 0.12), { rough: 0.45 }), "beak", new THREE.Vector3(r * 0.82 + bl * 0.3, -r * 0.2, 0));

  // mào
  const combScale = S.combSize * (rooster ? lerp(0.75, 1.3, mature) : 0.7) * (S.crest ? 0.5 : 1) * combG;
  const ch = combScale * r * 0.95;
  if (ch > 0.012) {
    const depth = r * (S.combType === "single" ? 0.14 : 0.42);
    const geo = new THREE.ExtrudeGeometry(combShape(S.combType, r, ch, rooster), { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 8 });
    geo.translate(0, 0, -depth / 2);
    put(head, geo, M.comb, "comb");
  }

  // yếm thịt
  const wl = (rooster ? 0.4 : 0.22) * S.wattle * combG * (S.muff ? 0.35 : 1);
  if (wl > 0.015) {
    for (const side of [1, -1]) {
      put(head, ellipsoid(wl * 0.34, wl * 0.6, wl * 0.2, 14), side > 0 ? M.comb : M.combDark, "wattle", new THREE.Vector3(r * 0.6, -r * 0.7 - wl * 0.4, side * r * 0.14));
    }
  }

  // chỏm lông
  if (S.crest) {
    const n = S.crest === 2 ? 26 : 14;
    const cl = r * (S.crest === 2 ? 1.0 : 0.66) * lerp(0.5, 1, adult);
    const cc = new THREE.Vector3(-r * 0.08, r * 0.62, 0);
    for (let i = 0; i < n; i++) {
      const yv = 1 - (i + 0.5) / n * 0.9;
      const rad = Math.sqrt(1 - yv * yv);
      const th = i * 2.399;
      const dir = new THREE.Vector3(Math.cos(th) * rad - 0.25, yv, Math.sin(th) * rad).normalize();
      const f = put(head, ellipsoid(0.045, cl * 0.5, 0.045, 10), M.crest, "crest", cc.clone().addScaledVector(dir, cl * 0.42));
      f.quaternion.setFromUnitVectors(UP, dir);
    }
  }
  // râu, tóc mai
  if (S.muff) {
    for (let i = 0; i < 9; i++) {
      const th = lerp(-0.9, 0.9, i / 8);
      const dir = new THREE.Vector3(0.25, -0.75, Math.sin(th) * 1.1).normalize();
      const f = put(head, ellipsoid(0.04, r * 0.32, 0.04, 10), M.crest, "muff", new THREE.Vector3(r * 0.45, -r * 0.55, Math.sin(th) * r * 0.75).addScaledVector(dir, r * 0.15));
      f.quaternion.setFromUnitVectors(UP, dir);
    }
  }

  /* bóng đổ */
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6 * a, 1.6 * c + 0.4), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(belly.x - 0.1, 0.003, 0);
  root.add(shadow);

  root.scale.setScalar(S.size * lerp(0.62, 1, smooth(0, 1, g)));
  return { root, headPivot, eyes, kind: "chicken" };
}

export function buildEgg(ph) {
  const pts = [];
  const w = 0.42, h = 0.55;
  for (let i = 0; i <= 32; i++) {
    const t = (i / 32) * Math.PI;
    pts.push(new THREE.Vector2(Math.max(0.0001, Math.sin(t) * w * (1 + 0.1 * Math.cos(t))), -Math.cos(t) * h));
  }
  const geo = new THREE.LatheGeometry(pts, 40);
  const mat = material(ph.egg.shell, { map: ph.egg.speckle ? speckleTexture(ph.egg.shell, ph.egg.speckle, ph.egg.seed) : null, rough: 0.45 });
  const root = new THREE.Group();
  const shell = new THREE.Group();
  shell.position.y = 0;
  const egg = new THREE.Mesh(geo, mat);
  egg.position.y = h;
  egg.userData.part = "egg";
  shell.add(egg);
  root.add(shell);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.003;
  root.add(shadow);
  return { root, shell, kind: "egg" };
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of [].concat(o.material)) {
        if (m.map && !m.map.userData.cached) m.map.dispose();
        m.dispose();
      }
    }
  });
}

/* ---------- cảnh: ánh sáng, máy quay ---------- */

function makeScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x7d9a5c, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffe9cf, 0.7);
  rim.position.set(-4, 3, -3);
  scene.add(rim);
  return scene;
}

function frame(camera, target, obj, minRadius, dir) {
  const box = new THREE.Box3().setFromObject(obj);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, minRadius);
  const dist = radius / Math.sin((camera.fov * RAD) / 2) * 1.02;
  target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir.normalize(), dist);
  camera.lookAt(target);
}

const VIEW_DIR = new THREE.Vector3(0.45, 0.32, 1);

export function createStage(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(renderer.domElement);
  const scene = makeScene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.5;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.53;
  let current = null;
  let focus = null;
  let wobble = 0;
  let userMoved = false;
  controls.addEventListener("start", () => (userMoved = true));

  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(host);
  resize();

  function applyFocus() {
    if (!current) return;
    current.root.traverse((o) => {
      if (!o.isMesh || !o.userData.part) return;
      const mats = [].concat(o.material);
      for (const m of mats) {
        if (m.userData.base === undefined) m.userData.base = { opacity: m.opacity, transparent: m.transparent };
        const on = focus && focus.includes(o.userData.part);
        m.transparent = !!focus && !on ? true : m.userData.base.transparent;
        m.opacity = focus && !on ? 0.12 : m.userData.base.opacity;
        m.depthWrite = !(focus && !on);
        if (m.emissive) m.emissive.set(on ? 0x6a2410 : 0x000000);
        m.needsUpdate = true;
      }
    });
  }

  function show(ph, { growth = 1, egg = false, wobble: wob = 0, refit = true } = {}) {
    if (current) {
      scene.remove(current.root);
      disposeTree(current.root);
    }
    current = egg ? buildEgg(ph) : buildChicken(ph, growth);
    wobble = wob;
    scene.add(current.root);
    applyFocus();
    if (refit && !userMoved) {
      const dir = camera.position.clone().sub(controls.target);
      frame(camera, controls.target, current.root, egg ? 0.9 : lerp(0.85, 1.45, smooth(0, 1, growth)), dir.lengthSq() > 0 ? dir : VIEW_DIR.clone());
    } else if (refit) {
      const box = new THREE.Box3().setFromObject(current.root);
      controls.target.lerp(box.getCenter(new THREE.Vector3()), 0.5);
    }
  }

  function resetView() {
    userMoved = false;
    if (current) frame(camera, controls.target, current.root, current.kind === "egg" ? 0.9 : 1.45, VIEW_DIR.clone());
  }

  const clock = new THREE.Clock();
  const loop = () => {
    const t = clock.getElapsedTime();
    if (current?.kind === "chicken") {
      current.root.position.y = Math.sin(t * 2.2) * 0.012;
      const ph = (t % 7.5) / 7.5;
      current.headPivot.rotation.z = ph > 0.86 ? -(Math.sin(((ph - 0.86) / 0.14) * Math.PI * 2) ** 2) * 0.35 : 0;
      const blink = t % 4.7 < 0.12 ? 0.12 : 1;
      for (const e of current.eyes) e.scale.y = blink;
    } else if (current?.kind === "egg") {
      current.shell.rotation.z = Math.sin(t * 10) * 0.13 * wobble;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(loop);

  return {
    show,
    setActive(on) {
      renderer.setAnimationLoop(on ? loop : null);
      if (on) resize();
    },
    resetView,
    setFocus(parts) {
      focus = parts;
      applyFocus();
    },
    canvas: renderer.domElement,
  };
}

/* ---------- ảnh tĩnh cho thẻ trong chuồng (dùng chung 1 renderer) ---------- */

let snap = null;
export function snapshot(ph, { growth = 1, egg = false, size = 256 } = {}) {
  if (!snap) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(1);
    snap = { renderer, scene: makeScene(), camera: new THREE.PerspectiveCamera(30, 1, 0.05, 100) };
  }
  snap.renderer.setSize(size, size, false);
  const built = egg ? buildEgg(ph) : buildChicken(ph, growth);
  snap.scene.add(built.root);
  frame(snap.camera, new THREE.Vector3(), built.root, egg ? 0.8 : lerp(0.7, 1.05, smooth(0, 1, growth)), VIEW_DIR.clone());
  snap.renderer.render(snap.scene, snap.camera);
  const url = snap.renderer.domElement.toDataURL("image/png");
  snap.scene.remove(built.root);
  disposeTree(built.root);
  return url;
}
