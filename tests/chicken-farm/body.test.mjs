// Thể trạng = hàm của kiểu hình (body.js): đúng chiều tỉ lệ thuận / nghịch, nằm trong 0..1, và dinh dưỡng nắn được dáng.
import test from "node:test";
import assert from "node:assert/strict";
import { STATS, measures, bodyStats } from "../../public/apps/chicken-farm/js/game/body.js";
import { express, randomGenome, mulberry32 } from "../../public/apps/chicken-farm/js/genome.js";

const base = { legs: 0.5, body: 0.5, feathers: 0.5, beak: 0.5, eyes: 0.5, neck: 0.5, toes: 0 };
// chiều của từng thể trạng theo từng số đo: +1 tăng, -1 giảm, 0 không phụ thuộc
const DIR = {
  speed: { legs: 1, body: -1, feathers: 0, beak: 0, eyes: 0, neck: 0, toes: 0 },
  jump: { legs: 1, body: -1, feathers: 1, beak: 0, eyes: 0, neck: 0, toes: 0 },
  steady: { legs: -1, body: 1, feathers: 0, beak: 0, eyes: 0, neck: 0, toes: 1 },
  eye: { legs: 0, body: 0, feathers: 0, beak: 1, eyes: 1, neck: 1, toes: 0 },
};

test("mỗi thể trạng đúng chiều với từng số đo kiểu hình", () => {
  for (const [stat, dirs] of Object.entries(DIR)) {
    for (const [m, d] of Object.entries(dirs)) {
      const lo = STATS[stat]({ ...base, [m]: 0.2 }), hi = STATS[stat]({ ...base, [m]: m === "toes" ? 1 : 0.8 });
      if (d > 0) assert.ok(hi > lo, `${stat} phải tăng theo ${m}`);
      else if (d < 0) assert.ok(hi < lo, `${stat} phải giảm theo ${m}`);
      else assert.equal(hi, lo, `${stat} không phụ thuộc ${m}`);
    }
  }
});

test("thể trạng của gà thật luôn trong 0..1; không có dáng nào giỏi mọi thứ", () => {
  const rng = mulberry32(42);
  let allTop = 0;
  for (let i = 0; i < 500; i++) {
    const s = bodyStats(express(randomGenome(rng)));
    for (const v of Object.values(s)) assert.ok(v >= 0 && v <= 1);
    if (s.speed > 0.8 && s.steady > 0.8) allTop++;
  }
  assert.equal(allTop, 0, "chạy nhanh và vững chân là hai đầu của một cán cân");
});

test("dinh dưỡng lúc lớn nắn thể trạng: thiếu khoáng (chân ngắn) thì vững hơn, chạy chậm hơn", () => {
  const g = randomGenome(mulberry32(7));
  const dev = (mineral) => ({ dev: { protein: 0.8, energy: 0.8, mineral, pigment: 0.8 } });
  const full = bodyStats(express(g, dev(1))), low = bodyStats(express(g, dev(0)));
  assert.ok(low.steady > full.steady);
  assert.ok(low.speed < full.speed);
  assert.ok(measures(express(g, dev(0))).legs < measures(express(g, dev(1))).legs);
});
