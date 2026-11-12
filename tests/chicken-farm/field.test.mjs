// Kiểm thử mô phỏng cánh đồng. Chạy: node --test tests/chicken-farm/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD, createField, addChicken, removeChicken, tickField, snapshot, fieldTraits } from "../../public/apps/chicken-farm/js/game/field.js";
import { CONFIG } from "../../public/apps/chicken-farm/js/game/rules.js";

const run = (f, ms) => {
  const ev = [];
  for (let t = 0; t < ms; t += FIELD.tickMs) ev.push(...tickField(f));
  return ev;
};

test("gà tự tìm được hạt; mỗi con không mổ nhanh hơn thời gian chờ của luật chơi", () => {
  const f = createField({ seed: 3 });
  addChicken(f, { id: "a", speed: 70, sight: 160 });
  addChicken(f, { id: "b", speed: 70, sight: 160 });
  const ev = run(f, 3 * 60 * 1000);
  assert.ok(ev.length >= 6, `tìm được ${ev.length} hạt trong 3 phút`);
  for (const id of ["a", "b"]) {
    const times = [];
    let t = 0;
    const g = createField({ seed: 3 });
    addChicken(g, { id: "a", speed: 70, sight: 160 });
    addChicken(g, { id: "b", speed: 70, sight: 160 });
    for (; t < 3 * 60 * 1000; t += FIELD.tickMs) for (const e of tickField(g)) if (e.chickenId === id) times.push(g.t);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= CONFIG.fieldEatCooldownMs);
  }
});

test("cùng seed → cùng diễn biến (server tái lập được)", () => {
  const mk = () => { const f = createField({ seed: 9 }); addChicken(f, { id: "a", speed: 60, sight: 150 }); return f; };
  const a = mk(), b = mk();
  assert.deepEqual(run(a, 60000), run(b, 60000));
  assert.deepEqual(snapshot(a), snapshot(b));
});

test("gà nhanh, tinh mắt tìm được nhiều hạt hơn", () => {
  let fast = 0, slow = 0;
  for (let s = 1; s <= 10; s++) {
    const f = createField({ seed: s });
    addChicken(f, { id: "fast", speed: FIELD.speed[1], sight: FIELD.sight[1] });
    addChicken(f, { id: "slow", speed: FIELD.speed[0], sight: FIELD.sight[0] });
    for (const e of run(f, 120000)) e.chickenId === "fast" ? fast++ : slow++;
  }
  assert.ok(fast > slow, `nhanh ${fast} / chậm ${slow}`);
});

test("gà rời đồng thì nhả hạt đang nhắm; gà luôn ở trong cánh đồng", () => {
  const f = createField({ seed: 5 });
  addChicken(f, { id: "a", speed: 90, sight: 300 });
  run(f, 20000);
  removeChicken(f, "a");
  assert.ok([...f.seeds.values()].every((s) => s.claimedBy !== "a"));
  const g = createField({ seed: 5 });
  for (let i = 0; i < 20; i++) addChicken(g, { id: `c${i}`, speed: 95, sight: 210 });
  run(g, 60000);
  for (const c of snapshot(g).chickens) assert.ok(c.x >= 0 && c.x <= g.w && c.y >= 0 && c.y <= g.h);
});

test("hiệu năng: 200 gà, 10 phút mô phỏng (6000 bước) dưới 1 giây", () => {
  const f = createField({ seed: 1 });
  for (let i = 0; i < 200; i++) addChicken(f, { id: `c${i}`, speed: 70, sight: 160 });
  const t = performance.now();
  run(f, 10 * 60 * 1000);
  assert.ok(performance.now() - t < 1000, `${(performance.now() - t).toFixed(0)} ms`);
});

test("tuỳ chọn từng cánh đồng: sân trại không mọc hạt; gen tốc độ → chạy nhanh hơn", async () => {
  const yard = createField({ seed: 2, spawnPerSec: 0, maxSeeds: 0 });
  addChicken(yard, { id: "a", speed: 60, sight: 150 });
  assert.equal(run(yard, 60000).length, 0);
  assert.equal(yard.seeds.size, 0);
  const { express, randomGenome, mulberry32 } = await import("../../public/apps/chicken-farm/js/genome.js");
  const g = randomGenome(mulberry32(1));
  g.g.speed = [0, 0];
  const slow = fieldTraits(express(g)).speed;
  g.g.speed = [1, 1];
  assert.ok(fieldTraits(express(g)).speed > slow * 1.4);
});
