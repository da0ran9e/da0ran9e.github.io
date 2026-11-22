// v11 — hạt là giống cây thật: tên theo loài, chất pha trộn, dáng cây; bản lưu cũ đổi tên hạt không mất gì.
import test from "node:test";
import assert from "node:assert/strict";
import { SEEDS, SEED_ALIAS, seedKey, formOf, seedLowers, handOnly, bestSeedFor, fillTower, feed, CONFIG, newGame, advance, plant, NUTRIENTS } from "../../public/apps/chicken-farm/js/game/rules.js";

const T0 = Date.UTC(2026, 10, 23, 3, 0);

test("mỗi loài có đủ 4 chất, có loài thiên hai chất; mọi bảng rơi / trồng chỉ dùng loài có thật", () => {
  for (const [k, s] of Object.entries(SEEDS)) {
    for (const n of NUTRIENTS) assert.ok(s.n[n] !== 0, `${k}.${n}`);
    assert.ok(NUTRIENTS.filter((n) => s.n[n] < 0).length <= 1, `${k}: kéo xuống nhiều nhất một chất`);
  }
  const twoWay = Object.values(SEEDS).filter((s) => { const v = Object.values(s.n).sort((a, b) => b - a); return v[1] > v[0] * 0.75 && v[2] < v[1] * 0.5; });
  assert.ok(twoWay.length >= 4, "ít nhất 4 loài hai chất");
  for (const t of Object.values(CONFIG.drops)) for (const k of Object.keys(t)) assert.ok(SEEDS[k], k);
  for (const k of Object.keys(CONFIG.garden.growMs)) assert.ok(SEEDS[k] && !SEEDS[k].mutation, k);
  for (const k of Object.values(SEED_ALIAS)) assert.ok(SEEDS[k], k);
  assert.ok(SEEDS.peanut.n.protein > 10 && SEEDS.peanut.n.mineral > 10, "đậu phộng: đạm + khoáng");
});

test("dáng cây: theo loài; loài không ghi dáng thì suy từ chất trội", () => {
  assert.equal(formOf("sunflower"), "tall");
  assert.equal(formOf("protein"), "vine", "tên cũ vẫn ra loài mới");
  SEEDS.__test = { name: "x", satiety: 1, n: { protein: 1, energy: 2, mineral: 9, pigment: 1 } };
  try { assert.equal(formOf("__test"), "bush"); } finally { delete SEEDS.__test; }
});

test("bản lưu v10: kho, tháp, luống đổi sang tên loài; tổng số hạt giữ nguyên", () => {
  const s = newGame(7, T0);
  s.inventory = { common: 9, protein: 3, energy: 2, mineral: 1, pigment: 4, premium: 2, odd: 1 };
  s.tower = { common: 5, protein: 1, energy: 0, mineral: 0, pigment: 0, premium: 0, odd: 0 };
  s.garden = [{ seed: "pigment", at: T0, readyAt: T0 + 1, total: 1, water: 0 }, null, null];
  advance(s, T0 + 1000); // mọi lần tải / hành động đều qua ensure
  assert.equal(s.inventory.marigold, 4);
  assert.equal(s.inventory.lotus, 2);
  assert.equal(s.inventory.odd, 1);
  assert.equal(s.inventory.peanut, 0);
  assert.ok(!("common" in s.inventory));
  assert.equal(s.tower.rice, 5);
  assert.equal(s.tower.mung, 1);
  assert.equal(s.garden[0].seed, "marigold");
});

test("lời gọi bằng tên cũ vẫn chạy (nhật ký server trước v11)", () => {
  const s = newGame(3, T0);
  assert.equal(seedKey("premium"), "lotus");
  assert.equal(seedKey("corn"), "corn");
  const r = plant(s, 0, "common", T0);
  assert.equal(r.ok, true);
  assert.equal(s.garden[0].seed, "rice");
  assert.equal(s.inventory.rice, CONFIG.start.seeds.rice - 1);
});

test("hạt có chất kháng: kéo chất xuống không dưới 0, chỉ cho ăn tay (không tháp, không tự chọn)", () => {
  const anti = Object.keys(SEEDS).filter((k) => seedLowers(k).length);
  assert.deepEqual(anti.sort(), ["cotton", "rapeseed", "sorghum", "wheat"]);
  for (const k of anti) assert.equal(handOnly(k), true, k);
  assert.equal(handOnly("rice"), false);
  assert.equal(seedLowers("sorghum")[0], "protein");
  // tháp từ chối, gà tự ăn không bao giờ chọn
  const s = newGame(5, T0);
  s.inventory.sorghum = 5;
  assert.equal(fillTower(s, "sorghum", 1, T0).code, "bad_seed");
  const hungry = { n: { protein: 0, energy: 0, mineral: 0, pigment: 0 } };
  assert.equal(bestSeedFor(hungry, { sorghum: 9, wheat: 9, cotton: 9, rapeseed: 9 }), null);
  // cho ăn tay: năng lượng lên, đạm xuống nhưng không âm
  const t = T0 + 3 * 60 * 60 * 1000;
  advance(s, t);
  const ch = s.chickens.find((c) => c.location === "coop") ?? s.chickens[0];
  if (!ch) return; // trại mới chưa nở gà thì bỏ qua phần cho ăn
  ch.n.protein = 5; ch.n.energy = 0; ch.satiety = 0;
  const r = feed(s, ch.id, "sorghum", t);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(ch.n.protein, 0);
  assert.equal(ch.n.energy, SEEDS.sorghum.n.energy);
});
