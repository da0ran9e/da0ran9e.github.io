// Luật v6: trứng đầu nở nhanh + sưởi trứng, đốm sáng ngoài đồng, nhiệm vụ (chuỗi mở đầu, việc trong ngày,
// rương, chuỗi ngày), sổ ★★★ thuần chủng, giống, đồ trang trí, nâng bản lưu cũ.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG, TIME, NUTRIENTS, SEEDS, DEX, TUTORIAL, DAILY_TASKS, BREEDS, COUNTERS,
  newGame, advance, incubate, warmEgg, feed, release, fieldFind, fieldBonus, collectEgg, openBag,
  claim, questView, decorOf, breedsOf, dexKeysOf, dexStars, dayIndex, incubateMsOf,
} from "../../public/apps/chicken-farm/js/game/rules.js";
import { randomGenome, encodeGenome, mulberry32 } from "../../public/apps/chicken-farm/js/genome.js";

const T0 = Date.UTC(2026, 10, 14, 2, 0, 0); // 09:00 giờ Việt Nam
const { MIN, HOUR, DAY } = TIME;
const seedTotal = (s) => Object.values(s.inventory).reduce((a, b) => a + b, 0);

// Bộ gen "trơn": không mang đặc điểm nào của sổ; `set` bật đặc điểm cần thử (đồng hợp).
function plainGenome(seed, sex, set = {}) {
  const g = randomGenome(mulberry32(seed), { sex });
  Object.assign(g.g, {
    pattern: ["n", "n"], dilute: ["d", "d"], fm: ["fm", "fm"], frizzle: ["fz", "fz"], silkie: ["H", "H"],
    combR: ["r", "r"], combP: ["p", "p"], crest: ["cr", "cr"], muff: ["mb", "mb"], tailType: ["t", "t"],
    feetFeather: ["pti", "pti"], poly: ["po", "po"],
  });
  for (const [k, v] of Object.entries(set)) g.g[k] = [v, v];
  return g;
}
function farm(seed = 11, set = {}, sex = "hen") {
  const s = newGame(seed, T0);
  s.eggs[0].code = encodeGenome(plainGenome(seed, sex, set));
  return s;
}
// Nở quả trứng đầu rồi đưa gà tới sát ngưỡng trưởng thành với độ phát triển cho trước.
function hatchFirst(s, at = T0) {
  const { hatchAt } = incubate(s, s.eggs[0].id, at);
  advance(s, hatchAt);
  return s.chickens[s.chickens.length - 1];
}
function growUp(s, ch, dev = 0.95) {
  ch.growth = CONFIG.stages.adult - 0.001;
  for (const k of NUTRIENTS) { ch.dev[k] = dev; ch.n[k] = dev >= 0.85 ? 100 : 0; }
  ch.devWeight = 1e6; // giữ nguyên độ phát triển ở bước cuối
  ch.satiety = CONFIG.satietyMax;
  advance(s, s.updatedAt + 3 * MIN);
  assert.ok(ch.adultAt != null, "gà phải trưởng thành");
}

test("v6: trứng đầu tiên nở sau 1 phút; trứng thường vẫn 5–30 phút theo gen", () => {
  const s = farm();
  assert.equal(s.eggs[0].quick, true);
  const r = incubate(s, s.eggs[0].id, T0);
  assert.equal(r.hatchAt - T0, CONFIG.start.quickHatchMs);
  assert.ok(CONFIG.start.quickHatchMs <= 2 * MIN);
  advance(s, r.hatchAt);
  assert.equal(s.chickens.length, 1);
  // trứng không đánh dấu quick: theo gen
  s.eggs.push({ id: "ex", code: s.chickens[0].code, shell: "#fff", shellName: "x", fertile: true, motherId: null, fatherId: null, laidAt: T0, mutations: 0, hatchAt: null });
  const r2 = incubate(s, "ex", r.hatchAt);
  assert.ok(Math.abs(r2.hatchAt - r.hatchAt - incubateMsOf(s.chickens[0].code)) < 1);
  assert.ok(r2.hatchAt - r.hatchAt >= 5 * MIN);
});

test("v6: sưởi trứng bớt thời gian ấp; có nhịp chờ và giới hạn số lần", () => {
  const s = farm();
  s.eggs[0].quick = false;
  const id = s.eggs[0].id;
  assert.equal(warmEgg(s, id, T0).code, "not_incubating");
  const { hatchAt } = incubate(s, id, T0);
  const total = hatchAt - T0;
  const w = warmEgg(s, id, T0 + 1000);
  assert.equal(w.ok, true);
  assert.equal(Math.round(hatchAt - w.hatchAt), Math.round(CONFIG.warm.cutPct * total));
  assert.equal(warmEgg(s, id, T0 + 1500).code, "too_fast");
  let t = T0 + 1000, last = w;
  for (let i = 1; i < CONFIG.warm.max; i++) {
    t += CONFIG.warm.cooldownMs;
    last = warmEgg(s, id, t);
    assert.equal(last.ok, true, `lần ${i + 1}`);
  }
  assert.equal(last.warmed, CONFIG.warm.max);
  assert.equal(warmEgg(s, id, t + CONFIG.warm.cooldownMs).code, "warm_max");
  const cut = hatchAt - s.eggs[0].hatchAt;
  assert.ok(Math.abs(cut - CONFIG.warm.max * CONFIG.warm.cutPct * total) < 2, "bớt đúng tổng");
  assert.ok(cut <= 0.5 * total, "không bớt quá nửa thời gian ấp");
  assert.equal(s.count.warm, CONFIG.warm.max);
  // không sưởi được trứng không tồn tại / đã nở
  assert.equal(warmEgg(s, "nope", t).code, "no_egg");
});

test("v6: sưởi không làm trứng nở trước 'bây giờ'", () => {
  const s = farm();
  const id = s.eggs[0].id;
  const { hatchAt } = incubate(s, id, T0);
  const w = warmEgg(s, id, hatchAt - 500);
  assert.equal(w.ok, true);
  assert.ok(w.hatchAt >= hatchAt - 500);
});

test("v6: đốm sáng — chỉ khi gà ngoài đồng, có nhịp chờ, hạt về kho, đôi khi ra túi", () => {
  const s = farm();
  const ch = hatchFirst(s);
  let t = s.updatedAt + 1000;
  assert.equal(fieldBonus(s, ch.id, t).code, "not_in_field");
  release(s, ch.id, t);
  const before = seedTotal(s);
  const r = fieldBonus(s, ch.id, t, { rng: () => 0.1 });
  assert.equal(r.ok, true);
  assert.equal(seedTotal(s) - before, 1, "r < 0.6 → 1 hạt");
  assert.equal(fieldBonus(s, ch.id, t + 1000).code, "too_fast");
  t += CONFIG.lucky.cooldownMs;
  const r3 = fieldBonus(s, ch.id, t, { rng: () => 0.9 });
  assert.equal(Object.values(r3.got).reduce((a, b) => a + b, 0), 3);
  t += CONFIG.lucky.cooldownMs;
  const bags = s.bags.length;
  const rb = fieldBonus(s, ch.id, t, { rng: () => 0.99 });
  assert.ok(rb.bagId, "r ≥ ngưỡng cuối → túi hạt");
  assert.equal(s.bags.length, bags + 1);
  assert.equal(s.bags.at(-1).table, "gift");
  assert.equal(s.count.lucky, 3);
  // kho đầy → từ chối, không tính lượt
  s.inventory.common += CONFIG.storage.seeds;
  t += CONFIG.lucky.cooldownMs;
  assert.equal(fieldBonus(s, ch.id, t).code, "seeds_full");
  assert.equal(s.count.lucky, 3);
});

test("v6: bảng 'lucky' và 'gift' nhiều hạt tốt hơn cánh đồng; túi quà mở theo bảng gift", () => {
  const share = (table) => 1 - CONFIG.drops[table].common / Object.values(CONFIG.drops[table]).reduce((a, b) => a + b, 0);
  assert.ok(share("lucky") > share("field") * 3);
  assert.ok(share("gift") > share("shop"));
  for (const t of ["lucky", "gift"]) for (const k of Object.keys(CONFIG.drops[t])) assert.ok(SEEDS[k], `${t}.${k}`);
  const s = farm();
  s.bags.push({ id: "g1", size: 50, from: "gift", at: T0, table: "gift" }, { id: "s1", size: 50, from: "egg", at: T0 });
  const g = openBag(s, "g1", T0).got, c = openBag(s, "s1", T0).got;
  assert.ok((g.common ?? 0) < (c.common ?? 0), "túi quà ít hạt thường hơn");
  assert.equal(s.count.open, 2);
});

test("v6: chuỗi mở đầu — làm lần lượt, đủ điều kiện mới nhận, thưởng đúng loại", () => {
  const s = farm();
  assert.equal(s.quest.step, 0);
  assert.equal(TUTORIAL[0].key, "warm");
  let q = questView(s).tutorial;
  assert.equal(q.done, false);
  assert.equal(claim(s, "tutorial", T0).code, "not_done");
  const id = s.eggs[0].id;
  incubate(s, id, T0);
  let t = T0;
  for (let i = 0; i < TUTORIAL[0].goal; i++) { t += CONFIG.warm.cooldownMs; assert.equal(warmEgg(s, id, t).ok, true); }
  q = questView(s).tutorial;
  assert.equal(q.done, true);
  const r = claim(s, "tutorial", t);
  assert.equal(r.ok, true);
  assert.equal(s.bags.length, 1);
  assert.equal(s.bags[0].size, TUTORIAL[0].reward.bag);
  assert.equal(s.quest.step, 1);
  assert.equal(claim(s, "tutorial", t).code, "not_done", "bước 2 chưa xong (gà chưa nở)");
  // nở → bước 2: hạt quý vào thẳng kho
  advance(s, s.eggs[0].hatchAt);
  const prem = s.inventory.premium;
  assert.equal(claim(s, "tutorial", s.updatedAt + 1).ok, true);
  assert.equal(s.inventory.premium - prem, TUTORIAL[1].reward.seeds.premium);
  // bước 3: cho ăn 3 hạt
  const ch = s.chickens[0];
  t = s.updatedAt + 2;
  for (let i = 0; i < 3; i++) assert.equal(feed(s, ch.id, "common", t).ok, true);
  assert.equal(claim(s, "tutorial", t).ok, true);
  assert.equal(s.quest.step, 3);
});

test("v6: trứng quà của bước 'kiếm hạt' nở nhanh và chắc chắn khác giới với đàn một giới", () => {
  for (const sex of ["hen", "rooster"]) {
    const s = farm(21, {}, sex);
    const ch = hatchFirst(s);
    assert.equal(ch.sex, sex);
    s.quest.step = TUTORIAL.findIndex((q) => q.key === "forage");
    s.count.forage = 5;
    const r = claim(s, "tutorial", s.updatedAt + 1, { rng: mulberry32(99) });
    assert.equal(r.ok, true);
    const egg = s.eggs.find((e) => e.id === r.got.eggId);
    assert.ok(egg.fertile && egg.quick && egg.gift);
    const h = incubate(s, egg.id, s.updatedAt + 2);
    assert.equal(h.hatchAt - (s.updatedAt), CONFIG.start.quickHatchMs);
    advance(s, h.hatchAt);
    assert.equal(s.chickens.length, 2);
    assert.notEqual(s.chickens[1].sex, sex, "có cặp trống mái");
  }
});

test("v6: nhận thưởng cần chỗ chứa — không trao một nửa", () => {
  const s = farm();
  s.count.warm = 99;
  for (let i = 0; i < CONFIG.storage.bags; i++) s.bags.push({ id: `x${i}`, size: 1, from: "egg", at: T0 });
  assert.equal(claim(s, "tutorial", T0).code, "bags_full");
  assert.equal(s.quest.step, 0);
  s.bags.length = 0;
  s.quest.step = 1;
  s.count.hatch = 1;
  s.inventory.common = CONFIG.storage.seeds;
  assert.equal(claim(s, "tutorial", T0).code, "seeds_full");
  assert.equal(s.quest.step, 1);
});

test("v6: việc trong ngày — 3 việc làm được, tiến độ tính từ lúc giao, rương khi xong cả 3", () => {
  const s = farm();
  assert.equal(s.daily.day, dayIndex(T0));
  assert.equal(s.daily.tasks.length, CONFIG.daily.tasks);
  // trại mới chưa có gà mái lớn → không giao việc nhặt trứng
  assert.ok(!s.daily.tasks.some((d) => d.key === "collect"));
  for (const d of s.daily.tasks) assert.ok(DAILY_TASKS[d.key]);
  assert.equal(new Set(s.daily.tasks.map((d) => d.key)).size, 3, "không trùng việc");
  assert.equal(claim(s, "chest", T0).code, "not_done");
  assert.equal(claim(s, "daily:0", T0).code, "not_done");
  assert.equal(claim(s, "daily:9", T0).code, "no_quest");
  assert.equal(claim(s, "bogus", T0).code, "no_quest");
  for (const d of s.daily.tasks) s.count[d.key] = (s.count[d.key] ?? 0) + d.goal;
  const v = questView(s);
  assert.ok(v.daily.every((d) => d.done && !d.claimed));
  for (let i = 0; i < 3; i++) assert.equal(claim(s, `daily:${i}`, T0).ok, true);
  assert.equal(claim(s, "daily:0", T0).code, "claimed");
  assert.equal(s.bags.length, 3);
  assert.equal(s.streak.days, 1);
  const c = claim(s, "chest", T0);
  assert.equal(c.ok, true);
  assert.equal(s.bags.at(-1).size, CONFIG.daily.chestBag);
  assert.equal(s.bags.at(-1).table, "gift");
  assert.equal(claim(s, "chest", T0).code, "claimed");
});

test("v6: sang ngày mới (giờ Việt Nam) giao việc mới; chuỗi ngày nối tiếp hoặc về 1", () => {
  const s = farm();
  const first = JSON.stringify(s.daily);
  advance(s, T0 + 14 * HOUR); // 23:00 cùng ngày
  assert.equal(JSON.stringify(s.daily), first);
  advance(s, T0 + 15 * HOUR + MIN); // 00:01 hôm sau
  assert.equal(s.daily.day, dayIndex(T0) + 1);
  assert.ok(s.daily.tasks.every((d) => !d.claimed));
  const doDay = (t) => {
    advance(s, t);
    for (const d of s.daily.tasks) s.count[d.key] = d.base + d.goal;
    for (let i = 0; i < s.daily.tasks.length; i++) assert.equal(claim(s, `daily:${i}`, t).ok, true);
    s.bags.length = 0;
  };
  doDay(T0 + DAY);
  assert.equal(s.streak.days, 1);
  doDay(T0 + 2 * DAY);
  assert.equal(s.streak.days, 2);
  // rương ngày thứ 2 to hơn
  assert.equal(questView(s).chest.reward.bag, CONFIG.daily.chestBag + 1);
  doDay(T0 + 3 * DAY);
  assert.equal(s.streak.days, 3);
  const chest = questView(s).chest.reward;
  assert.ok(chest.egg, `ngày thứ ${CONFIG.daily.streakEgg}: rương có trứng quà`);
  const eggs = s.eggs.length;
  assert.equal(claim(s, "chest", T0 + 3 * DAY).ok, true);
  assert.equal(s.eggs.length, eggs + 1);
  doDay(T0 + 5 * DAY); // bỏ một ngày
  assert.equal(s.streak.days, 1);
  assert.equal(s.streak.best, 3);
});

test("v6: việc trong ngày tái lập được — cùng seed, cùng ngày → cùng việc", () => {
  const a = farm(5), b = farm(5);
  advance(a, T0 + DAY + 5 * MIN);
  advance(b, T0 + DAY + 9 * HOUR);
  assert.deepEqual(a.daily.tasks.map((d) => d.key), b.daily.tasks.map((d) => d.key));
});

test("v6: bộ đếm tăng đúng chỗ (cho ăn, kiếm hạt, nhặt trứng, nở, lớn)", () => {
  const s = farm();
  for (const k of COUNTERS) assert.equal(s.count[k], 0);
  const ch = hatchFirst(s);
  assert.equal(s.count.hatch, 1);
  let t = s.updatedAt + 1000;
  feed(s, ch.id, "common", t);
  assert.equal(s.count.feed, 1);
  release(s, ch.id, t);
  fieldFind(s, ch.id, "common", t + 1000);
  assert.equal(s.count.forage, 1);
  assert.equal(fieldFind(s, ch.id, "common", t + 2000).code, "too_fast");
  assert.equal(s.count.forage, 1, "bị từ chối thì không tính");
  s.eggs.push({ id: "y1", code: ch.code, shell: "#fff", shellName: "x", fertile: false, motherId: ch.id, fatherId: null, laidAt: t, mutations: 0, hatchAt: null, inYard: true });
  collectEgg(s, "y1", t + 3000);
  assert.equal(s.count.collect, 1);
  ch.growth = CONFIG.stages.juvenile - 0.001;
  ch.satiety = CONFIG.satietyMax;
  for (const k of NUTRIENTS) ch.n[k] = 100;
  advance(s, t + 5 * MIN);
  assert.equal(s.count.juvenile, 1);
  growUp(s, ch);
  assert.equal(s.count.adult, 1);
});

test("v6: ★★★ thuần chủng — bố mẹ đều mang đặc điểm, con mang và nuôi đủ chất", () => {
  const s = farm(31, { crest: "Cr" }, "hen");
  const hen = hatchFirst(s);
  growUp(s, hen);
  assert.equal(s.dex.crest, 2, "mẹ không có dòng → chỉ ★★");
  // thêm trống chỏm lông, trưởng thành
  const rooster = { ...structuredClone(hen), id: "r1", name: "Trống", sex: "rooster", code: encodeGenome(plainGenome(32, "rooster", { crest: "Cr" })) };
  s.chickens.push(rooster);
  // ép mái đẻ: no bụng, chạy tới khi có trứng có phôi
  let t = s.updatedAt, egg = null;
  for (let i = 0; i < 4000 && !egg; i++) {
    hen.satiety = CONFIG.satietyMax; rooster.satiety = CONFIG.satietyMax;
    t += MIN;
    advance(s, t);
    egg = s.eggs.find((e) => e.fertile && e.motherId === hen.id);
  }
  assert.ok(egg, "mái đã đẻ trứng có phôi");
  assert.ok(egg.line.includes("crest"), "trứng ghi đặc điểm cả bố lẫn mẹ đều mang");
  incubate(s, egg.id, t);
  advance(s, s.eggs.find((e) => e.id === egg.id).hatchAt);
  const kid = s.chickens.find((c) => c.motherId === hen.id);
  assert.ok(kid.line.includes("crest"));
  assert.ok(dexKeysOf(kid.code).includes("crest"), "bố mẹ đồng hợp → con chắc chắn mang");
  growUp(s, kid);
  assert.equal(s.dex.crest, 3);
  assert.equal(dexStars(s, 2), 1, "★★★ vẫn tính là đã đạt ★★ (mốc chuồng)");
  assert.equal(s.count.dex2, 1, "bộ đếm ★★ không tính trùng khi lên ★★★");
});

test("v6: ★★★ không có nếu nuôi thiếu chất, dù có dòng", () => {
  const s = farm(33, { muff: "Mb" });
  const ch = hatchFirst(s);
  ch.line = ["muff"];
  growUp(s, ch, 0.5);
  assert.equal(s.dex.muff, 1);
});

test("v6: giống — đủ tổ hợp đặc điểm + nuôi đủ chất khi trưởng thành → ghi giống, tặng túi quà", () => {
  const dexKeys = new Set(DEX.map((d) => d.key));
  for (const b of BREEDS) for (const t of b.traits) assert.ok(dexKeys.has(t), `${b.key}: ${t} phải là một mục của sổ`);
  assert.equal(new Set(BREEDS.map((b) => b.key)).size, BREEDS.length);
  const s = farm(41, { crest: "Cr", muff: "Mb" });
  assert.deepEqual(breedsOf(s.eggs[0].code), ["chomRau"]);
  const ch = hatchFirst(s);
  const bags = s.bags.length;
  ch.growth = CONFIG.stages.adult - 0.001;
  for (const k of NUTRIENTS) { ch.dev[k] = 0.95; ch.n[k] = 100; }
  ch.devWeight = 1e6;
  ch.satiety = CONFIG.satietyMax;
  const ev = advance(s, s.updatedAt + 3 * MIN);
  assert.ok(s.breeds.chomRau != null);
  assert.ok(ev.some((e) => e.type === "breed" && e.key === "chomRau" && e.chickenId === ch.id));
  assert.equal(s.bags.length, bags + 1);
  assert.equal(s.bags.at(-1).size, CONFIG.breed.bag);
  assert.equal(decorOf(s).ribbons, 1);
});

test("v6: giống — thiếu chất của MỘT đặc điểm thì chưa đạt; mọi đặc điểm của giống đều có trong sổ", () => {
  const s = farm(42, { frizzle: "Fz", feetFeather: "Pti" });
  const ch = hatchFirst(s);
  ch.growth = CONFIG.stages.adult - 0.001;
  for (const k of NUTRIENTS) { ch.dev[k] = 0.95; ch.n[k] = 100; }
  ch.dev.protein = 0.5; // cả hai đặc điểm đều thuộc nhóm đạm
  ch.devWeight = 1e6;
  ch.satiety = CONFIG.satietyMax;
  advance(s, s.updatedAt + 3 * MIN);
  assert.equal(Object.keys(s.breeds).length, 0);
});

test("v6: đủ 3 giống tặng thêm 1 ổ ấp", () => {
  const s = farm(43);
  const combos = [{ crest: "Cr", muff: "Mb" }, { frizzle: "Fz", feetFeather: "Pti" }, { tailType: "Rp", dilute: "D" }];
  let t = T0;
  const nests = s.incubators.length;
  combos.forEach((set, i) => {
    const code = encodeGenome(plainGenome(50 + i, "hen", i === 2 ? { tailType: "Rp" } : set));
    const g = plainGenome(50 + i, "hen", set);
    if (i === 2) g.g.dilute = ["D", "d"]; // lam = một bản D
    s.eggs.push({ id: `b${i}`, code: i === 2 ? encodeGenome(g) : code, shell: "#fff", shellName: "x", fertile: true, motherId: null, fatherId: null, laidAt: t, mutations: 0, hatchAt: null, quick: true });
    const h = incubate(s, `b${i}`, t);
    assert.equal(h.ok, true, JSON.stringify(h));
    advance(s, h.hatchAt);
    const ch = s.chickens.at(-1);
    growUp(s, ch);
    t = s.updatedAt;
  });
  assert.equal(Object.keys(s.breeds).length, 3);
  assert.equal(s.incubators.length, nests + 1, "đủ 3 giống → thêm đúng 1 ổ ấp");
});

test("v6: đồ trang trí suy ra từ tiến độ", () => {
  const s = farm();
  assert.deepEqual(decorOf(s), { bunting: false, flowers: false, lantern: false, scarecrow: false, pinwheel: false, ribbons: 0 });
  s.quest.step = 8; s.milestones = 2; s.streak.best = 7;
  const d = decorOf(s);
  assert.ok(d.bunting && d.flowers && d.lantern && !d.scarecrow && d.pinwheel);
});

test("v6: bản lưu v5 (chưa có bộ đếm / nhiệm vụ) được bổ sung, giữ nguyên phần cũ", () => {
  const s = farm();
  const ch = hatchFirst(s);
  growUp(s, ch);
  const dex = JSON.stringify(s.dex);
  for (const k of ["count", "quest", "streak", "breeds", "daily"]) delete s[k];
  const hatched = s.stats.hatched;
  advance(s, s.updatedAt + MIN);
  assert.equal(s.count.hatch, hatched);
  assert.equal(s.count.adult, 1);
  assert.equal(s.count.dex2, dexStars(s, 2));
  assert.equal(s.quest.step, 0);
  assert.deepEqual(s.streak, { days: 0, last: -1, best: 0 });
  assert.equal(JSON.stringify(s.dex), dex);
  assert.equal(s.daily.tasks.length, 3);
  // người chơi cũ nhận bù ngay các bước đã làm
  assert.equal(questView(s).tutorial.key, "warm");
});

test("v6: cùng seed + cùng hành động → cùng trạng thái (kể cả nhiệm vụ, đốm sáng)", () => {
  const run = () => {
    const s = farm(77);
    const id = s.eggs[0].id;
    incubate(s, id, T0);
    let t = T0;
    for (let i = 0; i < 6; i++) { t += 3000; warmEgg(s, id, t); }
    claim(s, "tutorial", t);
    advance(s, T0 + 2 * MIN);
    const ch = s.chickens[0];
    t = T0 + 2 * MIN + 1000;
    release(s, ch.id, t);
    for (let i = 0; i < 6; i++) { t += 21_000; fieldBonus(s, ch.id, t); fieldFind(s, ch.id, "common", t); }
    claim(s, "tutorial", t);
    for (const b of [...s.bags]) openBag(s, b.id, t);
    return JSON.stringify(s);
  };
  assert.equal(run(), run());
});

test("v6: chuỗi ngày đã đứt thì bản xem hiện 0 và rương về cỡ đầu; nhận thưởng lại → về 1", () => {
  const s = farm();
  for (const d of s.daily.tasks) s.count[d.key] = d.base + d.goal;
  claim(s, "daily:0", T0);
  assert.equal(questView(s).streak, 1);
  s.streak.days = 5; // giả lập đã giữ chuỗi 5 ngày
  s.streak.best = 5;
  advance(s, T0 + 3 * DAY); // bỏ hai ngày
  const v = questView(s);
  assert.equal(v.streak, 0, "chuỗi đã đứt");
  assert.equal(v.chest.reward.bag, CONFIG.daily.chestBag, "rương về cỡ đầu");
  s.count[s.daily.tasks[0].key] = s.daily.tasks[0].base + s.daily.tasks[0].goal;
  assert.equal(claim(s, "daily:0", T0 + 3 * DAY).streak, 1);
  assert.equal(s.streak.best, 5);
});

test("v6: cánh đồng — gà chạy tới đốm sáng người chơi chỉ rồi báo sự kiện 'lure'", async () => {
  const { createField, addChicken, tickField, setLure, FIELD } = await import("../../public/apps/chicken-farm/js/game/field.js");
  const f = createField({ seed: 3, spawnPerSec: 0, maxSeeds: 0 });
  addChicken(f, { id: "c1", speed: 60, sight: 150, x: 100, y: 300 });
  assert.equal(setLure(f, "nope", 10, 10), false);
  assert.equal(setLure(f, "c1", 600, 200), true);
  let hit = null;
  for (let i = 0; i < 400 && !hit; i++) hit = tickField(f).find((e) => e.type === "lure") ?? null;
  assert.ok(hit, "gà tới nơi trong 40 giây");
  assert.equal(hit.chickenId, "c1");
  const c = f.chickens.get("c1");
  assert.ok(Math.hypot(c.x - 600, c.y - 200) <= FIELD.reach + 8, "đứng sát đốm sáng");
  assert.equal(c.lure, null);
  // điểm ngoài rìa bị kéo vào trong cánh đồng
  setLure(f, "c1", -500, 9999);
  assert.ok(c.lure.x >= FIELD.margin && c.lure.y <= FIELD.height - FIELD.margin);
});

test("v6: cánh đồng — gà con chậm vẫn lao tới đốm sáng với tốc độ tối thiểu (không bắt người chơi chờ lâu)", async () => {
  const { createField, addChicken, tickField, setLure, FIELD } = await import("../../public/apps/chicken-farm/js/game/field.js");
  const f = createField({ seed: 4, spawnPerSec: 0, maxSeeds: 0 });
  addChicken(f, { id: "slow", speed: 20, sight: 100, x: 80, y: 250 });
  setLure(f, "slow", 720, 250);
  let ticks = 0;
  while (ticks < 1000 && !tickField(f).some((e) => e.type === "lure")) ticks++;
  const seconds = (ticks * FIELD.tickMs) / 1000;
  assert.ok(seconds <= 640 / FIELD.lureMin + 0.5, `tới nơi sau ${seconds} giây`);
});
