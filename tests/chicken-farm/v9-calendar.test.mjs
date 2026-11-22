// Luật v9 — mùa theo tuần (ideas 7) và đêm trăng tròn (ideas 9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, seasonOf, advance, feed, weekIndex, calendarView, fullMoonAt, moonPhase, rollSeed, luckyCooldownMs, fieldSpawnMul, newGame, visitorsOfDay, visitorView, dayIndex } from "../../public/apps/chicken-farm/js/game/rules.js";
import { mulberry32, randomGenome, encodeGenome, breed } from "../../public/apps/chicken-farm/js/genome.js";

const { MIN, HOUR, DAY } = TIME;
const MON = Date.UTC(2026, 10, 22, 17, 0, 0); // thứ Hai 23/11/2026 0:00 giờ Việt Nam

test("mùa: đổi đúng 0:00 thứ Hai giờ Việt Nam, xoay vòng 4 mùa, chung cho mọi trại", () => {
  assert.notEqual(seasonOf(MON - 1), seasonOf(MON));
  assert.equal(weekIndex(MON) - weekIndex(MON - 1), 1);
  for (let d = 0; d < 7; d++) assert.equal(seasonOf(MON + d * DAY + 5 * HOUR), seasonOf(MON), "cả tuần một mùa");
  const four = [0, 1, 2, 3].map((w) => seasonOf(MON + w * 7 * DAY));
  assert.deepEqual([...four].sort(), [...CONFIG.season.order].sort());
  assert.equal(seasonOf(MON + 28 * DAY), seasonOf(MON));
  const c = calendarView(MON + 3 * DAY);
  assert.equal(c.ends, MON + 7 * DAY);
  assert.equal(c.next, seasonOf(MON + 7 * DAY));
});

// tìm một thời điểm thuộc mùa `key`
const at = (key) => [0, 1, 2, 3].map((w) => MON + w * 7 * DAY + DAY).find((t) => seasonOf(t) === key);

test("mùa chỉ nhân trọng số bảng rơi và tần suất: gặt nhiều hạt mẩy, mưa đốm sáng dày, khô ít hạt và rẻ", () => {
  const count = (t, kind, table = "field") => {
    const rng = mulberry32(7);
    let n = 0;
    for (let i = 0; i < 20000; i++) if (rollSeed(table, rng, t) === kind) n++;
    return n;
  };
  assert.ok(count(at("harvest"), "millet") > 2 * count(at("dry"), "millet"), "mùa gặt: hạt mẩy");
  assert.ok(count(at("rain"), "sesame") > 2 * count(at("dry"), "sesame"), "mùa mưa: hạt khoáng");
  assert.ok(count(at("bloom"), "marigold") > 3 * count(at("dry"), "marigold"), "mùa hoa: hạt màu");
  assert.ok(count(at("bloom"), "marigold", "lucky") > 1.5 * count(at("dry"), "marigold", "lucky"), "mùa hoa: đốm sáng");
  // không có `now` → bảng gốc, như trước v9
  const rng1 = mulberry32(3), rng2 = mulberry32(3);
  for (let i = 0; i < 50; i++) assert.equal(rollSeed("field", rng1), rollSeed("field", rng2, at("dry")), "mùa khô không đổi bảng rơi");
  assert.ok(luckyCooldownMs(at("rain")) < CONFIG.lucky.cooldownMs);
  assert.equal(luckyCooldownMs(at("harvest")), CONFIG.lucky.cooldownMs);
  assert.ok(fieldSpawnMul(at("dry")) < 1);
  assert.equal(fieldSpawnMul(at("bloom")), 1);
});

test("mùa khô: khách bên đường bán rẻ hơn (giá ≥ 1 vé), mùa khác giữ giá", () => {
  const s = newGame(3, MON);
  let dry = null, other = null;
  for (let d = dayIndex(MON); d < dayIndex(MON) + 28 && !(dry && other); d++) {
    for (const v of visitorsOfDay(3, d)) {
      if (v.who !== "seller") continue;
      const view = visitorView(s, v.from + 1000);
      if (seasonOf(v.from) === "dry") dry ??= view;
      else other ??= view;
    }
  }
  assert.ok(dry && other);
  for (const it of dry.stock) assert.ok(it.price >= 1 && it.price <= Math.ceil(3 * CONFIG.season.dry.price), "mùa khô");
  assert.ok(other.stock.every((it) => [2, 3].includes(it.price)), "giá gốc");
});

test("đêm trăng tròn: khoảng 2 đêm mỗi chu kỳ, chỉ ban đêm; calendarView báo đêm kế tiếp", () => {
  let nights = 0, prev = false;
  const start = MON, end = MON + Math.round(CONFIG.moon.synodicMs);
  for (let t = start; t < end; t += HOUR) {
    const f = fullMoonAt(t);
    if (f) {
      const h = new Date(t + CONFIG.daily.tzOffsetMs).getUTCHours();
      assert.ok(h >= 18 || h < 6, "chỉ ban đêm");
      assert.ok(Math.abs(moonPhase(t) - 0.5) <= CONFIG.moon.halfWidth);
    }
    if (f && !prev) nights++;
    prev = f;
  }
  assert.ok(nights >= 1 && nights <= 3, `số đêm trăng tròn: ${nights}`);
  const c = calendarView(start);
  assert.ok(c.nextFull > start && fullMoonAt(c.nextFull), "mốc đêm trăng tròn kế tiếp đúng là trăng tròn");
  assert.ok(!fullMoonAt(c.nextFull - HOUR) || c.nextFull - HOUR < start, "là lúc bắt đầu");
  // trăng tròn 24/11/2026 (thiên văn ~14:53 UTC): đêm 24/11 giờ Việt Nam là đêm trăng tròn
  assert.ok(fullMoonAt(Date.UTC(2026, 10, 24, 15, 0)));
  assert.ok(!fullMoonAt(Date.UTC(2026, 10, 10, 15, 0)), "trăng non thì không");
});

// trại có trống + mái trưởng thành, cho ăn đủ từ `from` tới `until`; trả về các trứng có phôi đã đẻ
function layBetween(from, until, seed = 1) {
  const s = newGame(seed, from);
  s.eggs = [];
  s.coopCap = 50;
  const rng = mulberry32(seed + 99);
  for (const sex of ["hen", "hen", "hen", "rooster"]) {
    const g = randomGenome(rng, { sex });
    for (const [k, v] of Object.entries({ growthRate: 0.5, hardiness: 1, appetite: 0.5, eggRate: 1 })) g.g[k] = [v, v];
    s.eggs.push({ id: `seed-${s.eggs.length}`, code: encodeGenome(g), shell: "#fff", shellName: "", fertile: true, motherId: null, fatherId: null, laidAt: from, mutations: 0, hatchAt: from });
  }
  advance(s, from + 1);
  s.chickens.forEach((c) => { c.growth = 100; c.adultAt = from; });
  for (let t = from; t < until; ) {
    t = Math.min(until, t + 15 * MIN);
    for (const c of s.chickens) for (const k of ["mung", "millet", "sesame", "marigold"]) { s.inventory[k] = 9; feed(s, c.id, k, t); }
  }
  return s.eggs.filter((e) => e.fertile && e.motherId);
}

test("đêm trăng tròn: trứng có phôi đẻ lúc đó mang dấu trăng; đẻ đêm thường thì không", () => {
  const moonEve = Date.UTC(2026, 10, 24, 11, 0); // 18:00 giờ VN, đêm trăng tròn
  assert.ok(fullMoonAt(moonEve + HOUR));
  const eggs = layBetween(moonEve, moonEve + 11 * HOUR);
  assert.ok(eggs.length > 0, "có trứng");
  for (const e of eggs) assert.equal(!!e.moon, fullMoonAt(e.laidAt), "dấu trăng đúng lúc đẻ");
  assert.ok(eggs.some((e) => e.moon));
  const plain = layBetween(Date.UTC(2026, 10, 10, 11, 0), Date.UTC(2026, 10, 10, 22, 0));
  assert.ok(plain.length > 0 && plain.every((e) => !e.moon), "trăng non: không có dấu trăng");
});

test("đêm trăng tròn làm tỉ lệ biến dị tăng (mutationRate ×mutationMul)", () => {
  // so cùng cặp bố mẹ, cùng nguồn ngẫu nhiên: tổng biến dị qua nhiều lần lai
  const rng = mulberry32(5);
  const a = randomGenome(rng, { sex: "rooster" }), b = randomGenome(rng, { sex: "hen" });
  let base = 0, moon = 0;
  for (let i = 0; i < 3000; i++) {
    base += breed(a, b, mulberry32(i), { mutationRate: 1 }).mutations.length;
    moon += breed(a, b, mulberry32(i), { mutationRate: CONFIG.moon.mutationMul }).mutations.length;
  }
  assert.ok(moon > 2 * base, `${moon} > 2×${base}`);
});
