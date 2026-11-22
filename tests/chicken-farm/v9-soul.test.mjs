// Luật v9 — tính cách từ gen (ideas 4), gia phả (ideas 2), lông kỷ niệm (ideas 5). Không đụng cân bằng.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, PERSONALITY, personalityOf, kinOf, newGame, advance, feed, tradeToShop } from "../../public/apps/chicken-farm/js/game/rules.js";
import { mulberry32, randomGenome, encodeGenome } from "../../public/apps/chicken-farm/js/genome.js";

const { MIN, HOUR, DAY } = TIME;
const T0 = Date.UTC(2026, 10, 20, 2, 0, 0);

function farmWith(sexes, seed = 1, set = {}) {
  const s = newGame(seed, T0);
  s.eggs = [];
  s.coopCap = 50;
  const rng = mulberry32(seed + 99);
  for (const sex of sexes) {
    const g = randomGenome(rng, { sex });
    for (const [k, v] of Object.entries(set)) g.g[k] = [v, v];
    s.eggs.push({ id: `seed-${s.eggs.length}`, code: encodeGenome(g), shell: "#fff", shellName: "", fertile: true, motherId: null, fatherId: null, laidAt: T0, mutations: 0, hatchAt: T0 });
  }
  advance(s, T0 + 1);
  return s;
}
const feedAll = (s, from, until) => {
  let t = from;
  while (t < until) {
    t = Math.min(until, t + 30 * MIN);
    for (const c of s.chickens) for (const k of ["mung", "millet", "sesame", "marigold"]) { s.inventory[k] = 9; feed(s, c.id, k, t); }
  }
  return t;
};

test("tính cách: tất định theo gen, 1–2 nhãn hợp lệ; gà trống không 'chăm đẻ'; không nổi bật gì thì 'điềm tĩnh'", () => {
  const rng = mulberry32(4);
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const g = randomGenome(rng), code = encodeGenome(g), p = personalityOf(code);
    assert.deepEqual(p, personalityOf(code));
    assert.ok(p.length >= 1 && p.length <= 2);
    for (const k of p) { assert.ok(PERSONALITY[k]); seen.add(k); }
    if (p.includes("calm")) assert.equal(p.length, 1, "điềm tĩnh chỉ khi không có nhãn nào khác");
  }
  assert.deepEqual([...seen].sort(), Object.keys(PERSONALITY).sort(), "đủ mọi tính cách trong 400 con");
  const roosters = Array.from({ length: 200 }, () => encodeGenome(randomGenome(rng, { sex: "rooster" })));
  assert.ok(roosters.every((c) => !personalityOf(c).includes("layer")));
});

test("lông kỷ niệm: gà trưởng thành, được chăm no, chết vì tuổi già → lông; bị bỏ đói → không", () => {
  const cared = farmWith(["hen"], 3, { hardiness: 0 });
  const ch = cared.chickens[0];
  Object.assign(ch, { growth: 100, adultAt: T0 });
  const end = T0 + ch.lifespanMs + DAY;
  const t = feedAll(cared, T0 + 1, end);
  advance(cared, t);
  assert.equal(cared.chickens.length, 0);
  assert.equal(cared.feathers.length, 1);
  assert.equal(cared.feathers[0].code, ch.code);
  assert.equal(cared.memorial.at(-1).feather, true);

  const starved = farmWith(["hen"], 3, { hardiness: 0 });
  Object.assign(starved.chickens[0], { growth: 100, adultAt: T0 });
  const ev = advance(starved, T0 + 10 * DAY);
  assert.equal(starved.chickens.length, 0);
  assert.equal(starved.feathers.length, 0);
  assert.ok(!ev.some((e) => e.type === "feather"));
  assert.ok(!starved.memorial.at(-1).feather);
});

test("gia phả: gà rời trại vẫn nhớ khi còn là bố mẹ / ông bà của gà đang có; không còn ai cần thì quên", () => {
  const s = farmWith(["hen", "rooster"], 5);
  const [mom, dad] = s.chickens;
  const kid = { ...structuredClone(mom), id: "kid", name: "Con", motherId: mom.id, fatherId: dad.id };
  s.chickens.push(kid);
  assert.equal(tradeToShop(s, { chickens: [mom.id] }, T0 + 2).ok, true);
  const m = kinOf(s, kid.motherId);
  assert.equal(m.name, mom.name);
  assert.equal(m.here, false);
  assert.equal(kinOf(s, kid.fatherId).here, true);
  assert.equal(kinOf(s, "khong-co"), null);
  // đứa con rời trại → không còn ai cần mẹ nó nữa
  assert.equal(tradeToShop(s, { chickens: ["kid"] }, T0 + 3).ok, true);
  assert.equal(s.family[mom.id], undefined);
  assert.ok(Object.keys(s.family).length <= 1);
});

test("bản lưu cũ chưa có feathers / family → ensure bổ sung", () => {
  const s = farmWith(["hen"], 2);
  delete s.feathers;
  delete s.family;
  advance(s, T0 + HOUR);
  assert.deepEqual(s.feathers, []);
  assert.deepEqual(s.family, {});
  assert.ok(CONFIG.feather.cap > 0);
});
