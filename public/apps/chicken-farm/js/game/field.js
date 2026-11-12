// Trại Gà — mô phỏng cánh đồng: gà tự đi tìm hạt.
// Thuần logic, không DOM, chạy theo bước cố định (FIELD.tickMs) → dùng lại nguyên vẹn
// trên server ở M3. Bộ mô phỏng chỉ QUYẾT ĐỊNH gà tìm được hạt gì; việc ăn / cất kho
// do rules.fieldFind() kiểm tra (đúng chỗ, không quá nhanh, kho còn chỗ).
//
// Mỗi con gà: lang thang → thấy hạt trong tầm mắt → đi tới → mổ → nghỉ (chờ hết hạn 15 giây
// giữa hai lần mổ của luật chơi). Hai con cùng nhắm một hạt: con tới trước được ăn.

import { mulberry32, lerp, clamp } from "../genome.js";
import { rollSeed, CONFIG as RULES } from "./rules.js";

export const FIELD = {
  width: 800,
  height: 480,
  margin: 56, // đủ chỗ cho hình gà (rộng ~13% cánh đồng) không bị khuất mép
  tickMs: 100,
  maxSeeds: 36,
  spawnPerSec: 0.7,
  seedTtlMs: 120 * 1000,
  reach: 12, // khoảng cách mỏ chạm hạt
  peckMs: 700,
  restMs: [600, 2500],
  speed: [45, 95], // px/giây, theo gen độ dài chân
  sight: [110, 210], // px, theo gen cỡ mắt
};

// Đặc tính ngoài đồng rút từ kiểu hình (genome.express):
// tốc độ chủ yếu theo gen "Tốc độ", chân dài nhỉnh hơn một chút; tầm nhìn theo cỡ mắt.
export function fieldTraits(ph) {
  const legs = clamp((ph.shape.legLen - 0.55) / 0.9);
  const eyes = clamp((ph.shape.eyeSize - 0.8) / 0.45);
  const spd = clamp(0.8 * (ph.stats.speed ?? 0.5) + 0.2 * legs);
  return { speed: lerp(FIELD.speed[0], FIELD.speed[1], spd), sight: lerp(FIELD.sight[0], FIELD.sight[1], eyes) };
}

// Tuỳ chọn theo từng cánh đồng (sân trại: không mọc hạt; cánh đồng lớn ở M3: mọc nhiều hơn).
export function createField({ seed = 1, width = FIELD.width, height = FIELD.height, spawnPerSec = FIELD.spawnPerSec, maxSeeds = FIELD.maxSeeds, margin = FIELD.margin, top = 40 } = {}) {
  return { w: width, h: height, t: 0, seq: 0, rng: mulberry32(seed >>> 0), chickens: new Map(), seeds: new Map(), spawnAcc: 0, opts: { spawnPerSec, maxSeeds, margin, top } };
}

const randIn = (f, lo, hi) => lo + f.rng() * (hi - lo);
const randPoint = (f) => ({ x: randIn(f, f.opts.margin, f.w - f.opts.margin), y: randIn(f, f.opts.margin + f.opts.top, f.h - f.opts.margin) });

export function addChicken(f, { id, speed, sight, x, y }) {
  const p = x == null ? randPoint(f) : { x, y };
  f.chickens.set(id, { id, x: p.x, y: p.y, dir: f.rng() < 0.5 ? -1 : 1, speed, sight, mode: "rest", timer: randIn(f, ...FIELD.restMs), target: null, wander: null, readyAt: 0, moving: false });
}

export function removeChicken(f, id) {
  const c = f.chickens.get(id);
  if (c?.target) {
    const s = f.seeds.get(c.target);
    if (s && s.claimedBy === id) s.claimedBy = null;
  }
  f.chickens.delete(id);
}

// Báo cho bộ mô phỏng biết luật chơi đã chấp nhận / từ chối một lần mổ (để đặt thời gian chờ).
export function setReadyAt(f, id, t) {
  const c = f.chickens.get(id);
  if (c) c.readyAt = t;
}

function spawn(f) {
  if (f.seeds.size >= f.opts.maxSeeds) return;
  const p = randPoint(f);
  const id = `s${(++f.seq).toString(36)}`;
  f.seeds.set(id, { id, x: p.x, y: p.y, kind: rollSeed("field", f.rng), born: f.t, claimedBy: null });
}

function nearestSeed(f, c) {
  let best = null, bd = c.sight * c.sight;
  for (const s of f.seeds.values()) {
    if (s.claimedBy && s.claimedBy !== c.id) continue;
    const d = (s.x - c.x) ** 2 + (s.y - c.y) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function moveToward(c, tx, ty, dist) {
  const dx = tx - c.x, dy = ty - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return 0;
  const k = Math.min(1, dist / d);
  c.x += dx * k;
  c.y += dy * k;
  if (Math.abs(dx) > 0.5) c.dir = dx < 0 ? -1 : 1;
  c.moving = true;
  return d - dist;
}

// Tiến 1 bước cố định. Trả về sự kiện: { type: "found", chickenId, seed, x, y }
export function tickField(f, dt = FIELD.tickMs) {
  const events = [];
  f.t += dt;
  // hạt mọc ngẫu nhiên, để lâu thì mất
  f.spawnAcc += (f.opts.spawnPerSec * dt) / 1000;
  while (f.spawnAcc >= 1) { spawn(f); f.spawnAcc -= 1; }
  if (f.rng() < f.spawnAcc) { spawn(f); f.spawnAcc = 0; }
  for (const s of f.seeds.values()) if (f.t - s.born > FIELD.seedTtlMs && !s.claimedBy) f.seeds.delete(s.id);

  for (const c of f.chickens.values()) {
    c.moving = false;
    if (c.mode === "peck") {
      c.timer -= dt;
      if (c.timer <= 0) {
        const s = f.seeds.get(c.target);
        if (s && Math.hypot(s.x - c.x, s.y - c.y) <= FIELD.reach + 2) {
          f.seeds.delete(s.id);
          events.push({ type: "found", chickenId: c.id, seed: s.kind, x: s.x, y: s.y });
          c.readyAt = f.t + RULES.fieldEatCooldownMs;
        }
        c.target = null;
        c.mode = "rest";
        c.timer = randIn(f, ...FIELD.restMs);
      }
      continue;
    }
    const step = (c.speed * dt) / 1000;
    // đang nhắm hạt?
    if (c.target) {
      const s = f.seeds.get(c.target);
      if (!s || (s.claimedBy && s.claimedBy !== c.id)) {
        c.target = null;
      } else {
        const left = moveToward(c, s.x - c.dir * 6, s.y, step);
        if (left <= FIELD.reach) {
          c.mode = "peck";
          c.timer = FIELD.peckMs;
          c.moving = false;
        }
        continue;
      }
    }
    // sẵn sàng mổ tiếp thì tìm hạt trong tầm mắt
    if (f.t >= c.readyAt) {
      const s = nearestSeed(f, c);
      if (s) {
        s.claimedBy = c.id;
        c.target = s.id;
        c.mode = "seek";
        continue;
      }
    }
    // lang thang / nghỉ
    if (c.mode === "rest") {
      c.timer -= dt;
      if (c.timer <= 0) {
        c.mode = "wander";
        const p = randPoint(f);
        c.wander = { x: lerp(c.x, p.x, 0.6), y: lerp(c.y, p.y, 0.6) };
      }
    } else {
      if (!c.wander) c.wander = randPoint(f);
      const left = moveToward(c, c.wander.x, c.wander.y, step * 0.55);
      if (left <= 1) {
        c.mode = "rest";
        c.wander = null;
        c.timer = randIn(f, ...FIELD.restMs);
      }
    }
  }
  return events;
}

export function snapshot(f) {
  return {
    t: f.t,
    chickens: [...f.chickens.values()].map((c) => ({ id: c.id, x: c.x, y: c.y, dir: c.dir, mode: c.mode, moving: c.moving })),
    seeds: [...f.seeds.values()].map((s) => ({ id: s.id, x: s.x, y: s.y, kind: s.kind })),
  };
}
