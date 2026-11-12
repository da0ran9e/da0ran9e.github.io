// Kiểm thử luật chơi Trại Gà (thiết kế v0.3). Chạy: node --test tests/chicken-farm/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG, SEEDS, TIME, NUTRIENTS, newGame, starterEggs, advance, feed, incubate, release, recall, recallAll, fieldFind,
  tradeToShop, tradeForEgg, openBag, rollSeed, collectEgg, stageOf, incubateMsOf, chickenView, chickenTradeValue,
} from "../../public/apps/chicken-farm/js/game/rules.js";
import { randomGenome, encodeGenome, decodeGenome, mulberry32, express, GENE_MAP, breed } from "../../public/apps/chicken-farm/js/genome.js";

const T0 = Date.UTC(2026, 10, 10, 8, 0, 0);
const { MIN, HOUR, DAY } = TIME;
const NEUTRAL = { growthRate: 0.5, hardiness: 1, appetite: 0.5, eggRate: 0.5 };

function farmWith(sexes, { seed = 1, set = {} } = {}) {
  const s = newGame(seed, T0);
  s.eggs = [];
  const rng = mulberry32(seed + 99);
  for (const sex of sexes) {
    const g = randomGenome(rng, { sex });
    for (const [k, v] of Object.entries(set)) g.g[k] = [v, v];
    s.eggs.push({ id: `seed-${s.eggs.length}`, code: encodeGenome(g), shell: "#fff", shellName: "", fertile: true, motherId: null, fatherId: null, laidAt: T0, mutations: 0, hatchAt: T0 });
  }
  s.coopCap = 50;
  advance(s, T0 + 1);
  return s;
}
const adultAll = (s) => s.chickens.forEach((c) => { c.growth = 100; c.adultAt = T0; });
const fill = (ch, lvl) => { for (const k of NUTRIENTS) ch.n[k] = lvl; };

// Cho ăn hạt cân bằng mỗi 15 phút (giữ no bụng)
function feedWell(s, from, until, ids = s.chickens.map((c) => c.id)) {
  let t = from;
  while (t < until) {
    t = Math.min(until, t + 15 * MIN);
    for (const id of ids) for (const k of ["protein", "energy", "mineral", "pigment"]) { s.inventory[k] = 9; feed(s, id, k, t); }
  }
  for (const k of Object.keys(s.inventory)) s.inventory[k] = 0;
  return t;
}

test("khởi đầu: 3 trứng để chọn, có phôi, ít hạt thường, 1 ổ ấp, không có tiền", () => {
  const eggs = starterEggs(42);
  const s = newGame(42, T0, 2);
  assert.equal(eggs.length, 3);
  assert.equal(s.eggs[0].code, eggs[2].code);
  assert.equal(s.eggs[0].fertile, true);
  assert.equal(s.incubators.length, 1);
  assert.ok(s.inventory.common > 0);
  assert.equal(Object.keys(s.inventory).length, Object.keys(SEEDS).length);
  assert.equal("coins" in s, false);
});

test("thời gian ấp 5–30 phút theo gen của quả trứng", () => {
  const rng = mulberry32(3);
  const mk = (v) => { const g = randomGenome(rng); g.g.incubation = [v, v]; return encodeGenome(g); };
  assert.equal(incubateMsOf(mk(0)), 5 * MIN);
  assert.equal(incubateMsOf(mk(1)), 30 * MIN);
  const s = newGame(7, T0);
  const r = incubate(s, s.eggs[0].id, T0);
  advance(s, r.hatchAt - 1);
  assert.equal(s.chickens.length, 0);
  advance(s, r.hatchAt + MIN);
  assert.equal(s.chickens.length, 1);
});

test("lớn: đủ chất ~20 phút, thiếu hết 24 giờ, hạt thường ở giữa", () => {
  const timeToAdult = (each) => {
    const s = farmWith(["hen"], { set: NEUTRAL });
    const ch = s.chickens[0];
    ch.growthMul = 1;
    let t = T0 + 1;
    while (stageOf(ch) !== "adult" && t < T0 + 3 * DAY) { t += MIN; each(s, ch, t); advance(s, t); }
    return t - T0;
  };
  const best = timeToAdult((s, ch) => { fill(ch, 100); ch.satiety = 100; });
  const worst = timeToAdult((s, ch) => { fill(ch, 0); ch.satiety = 100; });
  const common = timeToAdult((s, ch, t) => { if ((t - T0) % (5 * MIN) < MIN) { s.inventory.common = 9; feed(s, ch.id, "common", t); } });
  assert.ok(best >= 19 * MIN && best <= 22 * MIN, `best=${best / MIN}`);
  assert.ok(worst >= 23.9 * HOUR && worst <= 24.1 * HOUR, `worst=${worst / HOUR}`);
  assert.ok(common > 3 * best && common < worst, `common=${common / HOUR} giờ`);
});

test("Q2: bỏ đói làm giảm tuổi thọ (1 giờ đói = CONFIG.starveAging giờ tuổi)", () => {
  const fed = farmWith(["hen"], { set: { hardiness: 0 } });
  const starved = farmWith(["hen"], { set: { hardiness: 0 } });
  feedWell(fed, T0 + 1, T0 + 2 * DAY + HOUR);
  advance(starved, T0 + 2 * DAY + HOUR);
  assert.equal(fed.memorial.length, 1, "gà được ăn vẫn mất vì già sau 2 ngày");
  assert.equal(starved.memorial.length, 1);
  const diedFed = fed.memorial[0].diedAt - T0, diedStarved = starved.memorial[0].diedAt - T0;
  assert.ok(diedFed >= 2 * DAY - MIN, `fed=${diedFed / HOUR}`);
  // no lúc nở được vài giờ, sau đó già nhanh gấp starveAging
  const fedHours = CONFIG.hatch.satiety / CONFIG.satietyDrainPerHour;
  const expected = fedHours + (2 * 24 - fedHours) / CONFIG.starveAging;
  assert.ok(Math.abs(diedStarved / HOUR - expected) < 0.2, `starved=${diedStarved / HOUR} giờ, kỳ vọng ${expected}`);
  assert.ok(diedStarved < diedFed * 0.75);
  assert.ok(starved.memorial[0].starvedMs > 0);
});

test("gen tốc độ: lưu khi nở, xem được, ảnh hưởng tốc độ ngoài đồng", () => {
  const slow = farmWith(["hen"], { set: { speed: 0 } }).chickens[0];
  const fast = farmWith(["hen"], { set: { speed: 1 } }).chickens[0];
  assert.equal(slow.speed, 0);
  assert.equal(chickenView(fast, T0).speed01, 1);
});

test("tuổi thọ 2–5 ngày theo gen", () => {
  assert.equal(farmWith(["hen"], { set: { hardiness: 0 } }).chickens[0].lifespanMs, 2 * DAY);
  assert.equal(farmWith(["hen"], { set: { hardiness: 1 } }).chickens[0].lifespanMs, 5 * DAY);
});

test("dinh dưỡng lúc lớn quyết định gen biểu hiện tới đâu", () => {
  const grown = (lvls) => {
    const s = farmWith(["hen"], { seed: 5, set: NEUTRAL });
    const ch = s.chickens[0];
    for (let m = 1; m < 24 * 60 && stageOf(ch) !== "adult"; m++) { Object.assign(ch.n, lvls); ch.satiety = 100; advance(s, T0 + m * MIN + 1); }
    return { ch, ph: express(decodeGenome(ch.code), chickenView(ch, T0).care) };
  };
  const rich = grown({ protein: 100, energy: 100, mineral: 100, pigment: 100 });
  const noProtein = grown({ protein: 0, energy: 100, mineral: 100, pigment: 100 });
  const noPigment = grown({ protein: 100, energy: 100, mineral: 100, pigment: 0 });
  assert.ok(rich.ph.shape.tailLen > noProtein.ph.shape.tailLen * 1.15, "thiếu đạm → đuôi ngắn");
  assert.ok(Math.abs(rich.ph.shape.legLen - noProtein.ph.shape.legLen) < 1e-9, "đạm không ảnh hưởng chân");
  assert.notEqual(rich.ph.colors.base, noPigment.ph.colors.base, "thiếu sắc tố → màu nhạt");
});

test("Q3: đẻ ngẫu nhiên khi no; đói (dưới mức no) thì không đẻ", () => {
  const fedFarm = farmWith(["hen"], { set: NEUTRAL });
  adultAll(fedFarm);
  feedWell(fedFarm, T0 + 1, T0 + 12 * HOUR);
  const n = fedFarm.stats.laid;
  // trung bình 2 giờ/trứng → ~6 trứng trong 12 giờ, ngẫu nhiên nên cho khoảng rộng
  assert.ok(n >= 2 && n <= 12, `đẻ ${n} trứng`);
  const times = fedFarm.eggs.map((e) => e.laidAt).sort();
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  assert.ok(new Set(gaps).size > 1, "khoảng cách giữa các lần đẻ không đều");
  const hungry = farmWith(["hen"], { set: NEUTRAL });
  adultAll(hungry);
  hungry.chickens[0].satiety = 55;
  advance(hungry, T0 + 12 * HOUR);
  assert.equal(hungry.stats.laid, 0);
});

test("trứng mới đẻ nằm ngoài sân; nhặt thì vào kho; ấp thẳng từ sân cũng được", () => {
  const s = farmWith(["hen", "rooster"], { set: NEUTRAL });
  adultAll(s);
  const t = feedWell(s, T0 + 1, T0 + 10 * HOUR);
  assert.ok(s.eggs.length >= 2 && s.eggs.every((e) => e.inYard));
  const [a, b] = s.eggs;
  assert.equal(collectEgg(s, a.id, t).ok, true);
  assert.equal(a.inYard, false);
  assert.equal(collectEgg(s, a.id, t).code, "not_in_yard");
  assert.equal(incubate(s, b.id, t).ok, true);
  assert.equal(b.inYard, false);
  assert.equal(collectEgg(s, "khong-co", t).code, "no_egg");
});

test("không trống → trứng không phôi, không ấp được, chỉ đổi hạt", () => {
  const s = farmWith(["hen"], { set: NEUTRAL });
  adultAll(s);
  const t = feedWell(s, T0 + 1, T0 + 10 * HOUR);
  assert.ok(s.eggs.length > 0 && s.eggs.every((e) => !e.fertile));
  assert.equal(incubate(s, s.eggs[0].id, t).code, "infertile");
  assert.equal(tradeToShop(s, { eggs: [s.eggs[0].id] }, t).ok, true);
});

test("Q1: có trống trưởng thành → trứng có phôi, bố ngẫu nhiên trong các trống, gen của cả bố lẫn mẹ", () => {
  const s = farmWith(["hen", "rooster", "rooster"], { set: NEUTRAL });
  adultAll(s);
  const hen = s.chickens.find((c) => c.sex === "hen");
  const roosters = s.chickens.filter((c) => c.sex === "rooster");
  feedWell(s, T0 + 1, T0 + 20 * HOUR);
  assert.ok(s.eggs.length >= 4);
  const fathers = new Set(s.eggs.map((e) => e.fatherId));
  assert.ok(s.eggs.every((e) => e.fertile && roosters.some((r) => r.id === e.fatherId)));
  assert.equal(fathers.size, 2, "cả hai trống đều có lúc làm bố");
  const egg = s.eggs[0], kid = decodeGenome(egg.code), mom = decodeGenome(hen.code);
  const dad = decodeGenome(roosters.find((r) => r.id === egg.fatherId).code);
  const keys = Object.keys(kid.g);
  assert.ok(keys.filter((k) => dad.g[k].includes(kid.g[k][0])).length / keys.length > 0.8);
  assert.ok(keys.filter((k) => mom.g[k].includes(kid.g[k][1])).length / keys.length > 0.8);
});

test("trống chưa trưởng thành thì trứng chưa có phôi", () => {
  const s = farmWith(["hen", "rooster"], { set: NEUTRAL });
  const hen = s.chickens.find((c) => c.sex === "hen");
  hen.growth = 100;
  hen.adultAt = T0;
  feedWell(s, T0 + 1, T0 + 8 * HOUR, [hen.id]);
  assert.ok(s.eggs.length >= 1 && s.eggs.every((e) => !e.fertile));
});

test("Q4: thả đồng chỉ khi quan sát; gà ngoài đồng tự mổ hạt; rời màn hình thì gà tự về trại", () => {
  const s = farmWith(["hen", "rooster"]);
  const [a, b] = s.chickens;
  release(s, a.id, T0 + MIN);
  // mỗi người chơi chỉ được thả 1 con ra đồng
  assert.equal(release(s, b.id, T0 + MIN).code, "field_busy");
  assert.equal(b.location, "coop");
  assert.equal(feed(s, a.id, "common", T0 + MIN).code, "in_field");
  const before = a.satiety;
  assert.equal(fieldFind(s, a.id, "common", T0 + 2 * MIN).ok, true);
  assert.ok(a.satiety > before - 1);
  assert.equal(fieldFind(s, a.id, "common", T0 + 2 * MIN + 1000).code, "too_fast");
  // Q7: đã no mà vẫn tìm được hạt → hạt về kho
  a.satiety = CONFIG.satietyMax;
  const stock = s.inventory.premium;
  const st = fieldFind(s, a.id, "premium", T0 + 2 * MIN + CONFIG.fieldEatCooldownMs + 1000);
  assert.equal(st.action, "stored");
  assert.equal(s.inventory.premium, stock + 1);
  const r = recallAll(s, T0 + 3 * MIN);
  assert.deepEqual(r.recalled, [a.id]);
  assert.ok(s.chickens.every((c) => c.location === "coop"));
  assert.equal(fieldFind(s, a.id, "common", T0 + 4 * MIN).code, "not_in_field");
  release(s, a.id, T0 + 5 * MIN);
  assert.equal(recall(s, a.id, T0 + 6 * MIN).ok, true);
});

test("Q5: cánh đồng chủ yếu ra hạt thường; túi cửa hàng nhiều hạt tốt hơn", () => {
  const rng = mulberry32(1);
  const share = (table) => { let c = 0; for (let i = 0; i < 10000; i++) if (rollSeed(table, rng) === "common") c++; return c / 10000; };
  const field = share("field"), shop = share("shop");
  assert.ok(field > 0.75, `field common=${field}`);
  assert.ok(shop < 0.5, `shop common=${shop}`);
});

test("Q6: trứng → túi 2 hạt, gà → túi 4–9 hạt theo độ trưởng thành; không theo độ hiếm", () => {
  const s = farmWith(["hen", "hen"], { set: NEUTRAL });
  const [chick, adult] = s.chickens;
  adult.growth = 100;
  assert.equal(chickenTradeValue(chick), 4);
  assert.equal(chickenTradeValue(adult), 9);
  s.eggs.push({ id: "x", code: chick.code, shell: "#fff", fertile: false, hatchAt: null, laidAt: T0 });
  const r = tradeToShop(s, { eggs: ["x"], chickens: [adult.id] }, T0 + MIN);
  assert.equal(r.ok, true);
  assert.deepEqual(s.bags.map((b) => b.size).sort(), [2, 9]);
  assert.equal(s.chickens.length, 1);
  assert.equal(tradeToShop(s, { eggs: ["x"] }, T0 + MIN).code, "no_egg", "không đổi được 2 lần");
  const total = () => Object.values(s.inventory).reduce((a, b) => a + b, 0);
  const before = total();
  const o = openBag(s, s.bags.find((b) => b.size === 9).id, T0 + MIN);
  assert.equal(Object.values(o.got).reduce((a, b) => a + b, 0), 9);
  assert.equal(total(), before + 9);
});

test("gà đang ngoài đồng phải gọi về mới đổi được; lựa chọn trứng sai không làm sập game", () => {
  const s = farmWith(["hen"]);
  const ch = s.chickens[0];
  release(s, ch.id, T0 + MIN);
  assert.equal(tradeToShop(s, { chickens: [ch.id] }, T0 + MIN).code, "in_field");
  recall(s, ch.id, T0 + MIN);
  assert.equal(tradeToShop(s, { chickens: [ch.id] }, T0 + MIN).ok, true);
  for (const bad of [1.5, "x", null, undefined, -3, 99]) assert.ok(newGame(1, T0, bad).eggs.length === 1);
});

test("Q11/Q12: gà TRƯỞNG THÀNH đổi được 2 trứng ngẫu nhiên có phôi — gỡ thế kẹt thiếu trống/mái", () => {
  const s = farmWith(["hen"]);
  const hen = s.chickens[0];
  assert.equal(tradeForEgg(s, hen.id, T0 + MIN).code, "not_adult", "gà chưa lớn không đổi được");
  hen.growth = 100;
  const r = tradeForEgg(s, hen.id, T0 + MIN);
  assert.equal(r.ok, true);
  assert.equal(r.eggIds.length, CONFIG.trade.eggsPerChicken);
  assert.equal(s.chickens.length, 0);
  const eggs = r.eggIds.map((id) => s.eggs.find((e) => e.id === id));
  assert.ok(eggs.every((e) => e.fertile));
  assert.notEqual(eggs[0].code, eggs[1].code);
  assert.equal(incubate(s, eggs[0].id, T0 + MIN).ok, true);
  // trống/mái ngẫu nhiên: qua nhiều lần đổi phải ra cả hai
  const sexes = new Set();
  for (let i = 0; i < 20; i++) {
    const f = farmWith(["hen"], { seed: 100 + i });
    f.chickens[0].growth = 100;
    for (const id of tradeForEgg(f, f.chickens[0].id, T0 + MIN).eggIds) sexes.add(express(decodeGenome(f.eggs.find((x) => x.id === id).code)).sex);
  }
  assert.equal(sexes.size, 2);
  // kho phải còn đủ chỗ cho cả 2 quả
  const full = farmWith(["hen"]);
  full.chickens[0].growth = 100;
  for (let i = 0; i < CONFIG.storage.eggs - 1; i++) full.eggs.push({ id: `f${i}`, code: full.chickens[0].code, fertile: false, hatchAt: null });
  assert.equal(tradeForEgg(full, full.chickens[0].id, T0 + MIN).code, "eggs_full");
});

test("trứng đang ấp không đổi được; kho đầy thì không mở túi", () => {
  const s = newGame(1, T0);
  incubate(s, s.eggs[0].id, T0);
  assert.equal(tradeToShop(s, { eggs: [s.eggs[0].id] }, T0).code, "incubating");
  s.bags.push({ id: "big", size: 5, from: "egg", at: T0 });
  s.inventory.common = CONFIG.storage.seeds;
  assert.equal(openBag(s, "big", T0).code, "seeds_full");
});

test("hạt lạ tăng biến dị; gen màu dễ biến, gen hiếm khó biến", () => {
  assert.ok(GENE_MAP.baseHue.mut > 1 && GENE_MAP.silkie.mut < 0.5 && GENE_MAP.sex.mut === 0);
  const rng = mulberry32(8);
  const a = randomGenome(rng, { sex: "rooster" }), b = randomGenome(rng, { sex: "hen" });
  const count = {};
  for (let i = 0; i < 4000; i++) for (const m of breed(a, b, rng, { mutationRate: 5 }).mutations) count[m.key] = (count[m.key] ?? 0) + 1;
  assert.ok((count.baseHue ?? 0) > (count.silkie ?? 0) * 2);
  const s = farmWith(["hen"]);
  s.inventory.odd = 1;
  feed(s, s.chickens[0].id, "odd", T0 + MIN);
  assert.ok(s.chickens[0].mutationBoost > 0);
});

test("tính lười + ngẫu nhiên: xem nhiều lần hay một lần ra CÙNG một chuỗi trứng", () => {
  const mk = () => { const s = farmWith(["hen", "hen", "rooster"], { set: NEUTRAL }); adultAll(s); return s; };
  const a = mk(), b = mk();
  for (const s of [a, b]) for (const c of s.chickens) { c.satiety = 100; fill(c, 80); }
  // a: mở game liên tục mỗi vài phút; b: mở một lần
  for (let m = 2; m <= 200; m += 7) advance(a, T0 + m * MIN + 123);
  advance(a, T0 + 200 * MIN);
  advance(b, T0 + 200 * MIN);
  assert.ok(a.eggs.length > 0);
  assert.equal(JSON.stringify(a.eggs), JSON.stringify(b.eggs));
  assert.equal(JSON.stringify(a.chickens), JSON.stringify(b.chickens));
});

test("thời gian lùi lại không làm gì; hành động lỗi không đổi trạng thái", () => {
  const s = farmWith(["hen"]);
  advance(s, T0 + HOUR);
  const snap = JSON.stringify(s);
  advance(s, T0);
  feed(s, "khong-co", "common", T0 + HOUR);
  incubate(s, "khong-co", T0 + HOUR);
  tradeToShop(s, { eggs: ["khong-co"] }, T0 + HOUR);
  openBag(s, "khong-co", T0 + HOUR);
  fieldFind(s, "khong-co", "common", T0 + HOUR);
  assert.equal(JSON.stringify(s), snap);
});

test("cùng seed + cùng hành động → cùng trạng thái (server tái lập được)", () => {
  const run = () => {
    const s = farmWith(["hen", "rooster"], { seed: 77, set: NEUTRAL });
    adultAll(s);
    feedWell(s, T0 + 1, T0 + DAY);
    return JSON.stringify(s);
  };
  assert.equal(run(), run());
});

test("hiệu năng: 10 gà sống trọn đời (5 ngày) dưới 200 ms", () => {
  const s = farmWith(Array(10).fill("hen"), { set: { hardiness: 1 } });
  for (const c of s.chickens) c.satiety = 100;
  const t = performance.now();
  advance(s, T0 + 6 * DAY);
  assert.ok(performance.now() - t < 200, `${(performance.now() - t).toFixed(1)} ms`);
});
