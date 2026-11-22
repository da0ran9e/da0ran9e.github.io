// Luật v7 — tháp hạt: gà chỉ tự ăn ở những phút người chơi đang mở game. Thiết kế: docs/chicken-farm/design-hard-parts.md §H1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, NUTRIENTS, newGame, advance, incubate, fillTower, takeFromTower, bestSeedFor, release } from "../../public/apps/chicken-farm/js/game/rules.js";

const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);
const { MIN, HOUR } = TIME;
const towerTotal = (s) => Object.values(s.tower).reduce((a, b) => a + b, 0);

// Trại có 1 gà con vừa nở, đói (độ no 20), tháp có `n` hạt thường. Trả về { s, ch, t } với t = thời điểm hiện tại.
function hungryFarm(n = 10, seed = 5) {
  const s = newGame(seed, T0);
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  advance(s, hatchAt);
  const ch = s.chickens[0];
  ch.satiety = 20;
  s.inventory.rice = 60;
  assert.equal(fillTower(s, "rice", n, hatchAt).ok, true);
  return { s, ch, t: hatchAt };
}

test("T1 mở game liên tục (gọi mỗi 30 giây suốt 30 phút) → gà đói tự ăn từ tháp", () => {
  const { s, ch, t } = hungryFarm(10);
  for (let i = 1; i <= 60; i++) advance(s, t + i * 30_000);
  assert.ok(towerTotal(s) < 10, "tháp vơi");
  assert.ok(ch.satiety > 20, "gà no hơn");
  assert.equal(ch.starvedMs, 0);
});

test("T2 vắng mặt 3 giờ rồi mới mở game → tháp còn nguyên, gà đói như chưa có tháp", () => {
  const { s, ch, t } = hungryFarm(10);
  advance(s, t + 3 * HOUR);
  assert.equal(towerTotal(s), 10);
  assert.equal(ch.satiety, 0);
  assert.ok(ch.starvedMs > HOUR);
});

test("T3 quay lại sau khi vắng: phiên mới bắt đầu từ lần gọi đầu, các lần gọi sau gà mới ăn", () => {
  const { s, t } = hungryFarm(10);
  advance(s, t + 3 * HOUR);
  assert.equal(s.watchFrom, t + 3 * HOUR);
  for (let i = 1; i <= 10; i++) advance(s, t + 3 * HOUR + i * 30_000);
  assert.ok(towerTotal(s) < 10);
});

test("T5 hành động của hệ thống (present: false) không cho ăn; lần gọi có mặt kế tiếp ăn tiếp", () => {
  const { s, t } = hungryFarm(10);
  advance(s, t + 30_000);
  advance(s, t + 90_000, { present: false });
  const afterSystem = towerTotal(s);
  advance(s, t + 100_000);
  advance(s, t + 160_000);
  assert.ok(towerTotal(s) < afterSystem, "phiên vẫn liên tục (gap ≤ grace) nên ăn tiếp");
  // và nếu CHỈ có hệ thống gọi thì không bao giờ ăn
  const b = hungryFarm(10);
  for (let i = 1; i <= 20; i++) advance(b.s, b.t + i * MIN, { present: false });
  assert.equal(towerTotal(b.s), 10);
});

test("T7 gà chọn hạt bù đúng chất đang thiếu; không bao giờ tự ăn hạt lạ", () => {
  const { ch } = hungryFarm(1);
  for (const k of NUTRIENTS) ch.n[k] = 100;
  ch.n.protein = 0;
  assert.equal(bestSeedFor(ch, { rice: 5, mung: 5, odd: 5 }), "mung");
  ch.n.protein = 100;
  assert.equal(bestSeedFor(ch, { rice: 5, mung: 5 }), "rice", "đủ chất rồi thì tiết kiệm hạt tốt");
  assert.equal(bestSeedFor(ch, { odd: 9 }), null);
  assert.equal(bestSeedFor(ch, {}), null);
});

test("T9 server đưa watchFrom sớm hơn seenAt (người chơi ngồi xem không bấm) → các phút đó gà vẫn được ăn", () => {
  const { s, t } = hungryFarm(10);
  // 10 phút không có lần gọi nào được GHI (server chỉ cho xem), rồi một hành động kèm mốc phiên
  advance(s, t + 10 * MIN, { watchFrom: t });
  assert.ok(towerTotal(s) < 10);
  // không có mốc phiên thì cùng tình huống đó bị coi là vắng mặt
  const b = hungryFarm(10);
  advance(b.s, b.t + 10 * MIN);
  assert.equal(towerTotal(b.s), 10);
});

test("T11 continuous: client tua nhanh thời gian vẫn là một phiên", () => {
  const { s, t } = hungryFarm(10);
  advance(s, t + 30 * MIN, { continuous: true });
  assert.ok(towerTotal(s) < 10);
});

test("T16 cùng seed + cùng chuỗi lần gọi + cùng watchFrom → cùng trạng thái", () => {
  const run = () => {
    const { s, t } = hungryFarm(10, 9);
    advance(s, t + 40_000);
    advance(s, t + 5 * MIN, { watchFrom: t });
    advance(s, t + 6 * MIN, { present: false });
    advance(s, t + 4 * HOUR);
    return JSON.stringify(s);
  };
  assert.equal(run(), run());
});

test("đổ / lấy lại hạt: đủ kho, không quá sức chứa tháp, hạt lạ không vào tháp; đổ hạt tính vào việc 'cho ăn'", () => {
  const s = newGame(3, T0);
  s.inventory.rice = 60; s.inventory.odd = 2;
  assert.equal(fillTower(s, "rice", 0, T0).code, "bad_count");
  assert.equal(fillTower(s, "odd", 1, T0).code, "bad_seed");
  assert.equal(fillTower(s, "mung", 1, T0).code, "no_seed");
  assert.equal(fillTower(s, "rice", CONFIG.tower.cap, T0).ok, true);
  assert.equal(fillTower(s, "rice", 1, T0).code, "tower_full");
  assert.equal(s.count.feed, CONFIG.tower.cap);
  assert.equal(takeFromTower(s, "rice", 5, T0).ok, true);
  assert.equal(s.tower.rice, CONFIG.tower.cap - 5);
  assert.equal(s.inventory.rice, 60 - CONFIG.tower.cap + 5);
  assert.equal(takeFromTower(s, "mung", 1, T0).code, "no_seed");
});

test("T4 hai lần gọi cách đúng hatchPresenceGraceMs → cùng phiên; cách thêm 1 ms → phiên mới", () => {
  const G = CONFIG.hatchPresenceGraceMs;
  const a = hungryFarm(10);
  advance(a.s, a.t + 1000);
  const from = a.s.watchFrom;
  advance(a.s, a.t + 1000 + G);
  assert.equal(a.s.watchFrom, from, "đúng bằng grace: vẫn liên tục");
  const b = hungryFarm(10);
  advance(b.s, b.t + 1000);
  advance(b.s, b.t + 1000 + G + 1);
  assert.equal(b.s.watchFrom, b.t + 1000 + G + 1, "quá grace 1 ms: phiên mới");
});

test("T6 gà đang ở ngoài đồng không ăn từ tháp", () => {
  const { s, ch, t } = hungryFarm(10);
  ch.satiety = 20;
  assert.equal(release(s, ch.id, t).ok, true);
  for (let i = 1; i <= 20; i++) advance(s, t + i * 30_000);
  assert.equal(ch.location, "field");
  assert.equal(towerTotal(s), 10);
});

test("T10 watchFrom sớm hơn lần mô phỏng trước → không ăn bù bước đã tính", () => {
  const a = hungryFarm(10), b = hungryFarm(10);
  for (let i = 1; i <= 20; i++) {
    advance(a.s, a.t + i * 30_000);
    advance(b.s, b.t + i * 30_000, { watchFrom: b.t - 10 * HOUR }); // server báo phiên bắt đầu từ rất lâu
  }
  // b được tính là có mặt từ đầu nên ăn ít nhất như a, nhưng không ăn lại các bước đã mô phỏng
  assert.ok(towerTotal(b.s) <= towerTotal(a.s));
  const once = JSON.stringify(b.s);
  advance(b.s, b.t + 20 * 30_000, { watchFrom: b.t - 10 * HOUR });
  assert.equal(JSON.stringify(b.s), once, "gọi lại cùng thời điểm không đổi gì");
});

test("T11 continuous: true — hai lần gọi cách 30 phút vẫn coi như có mặt suốt", () => {
  const a = hungryFarm(10);
  advance(a.s, a.t + 30 * MIN, { continuous: true });
  assert.ok(towerTotal(a.s) < 10, "ăn trong 30 phút");
  const b = hungryFarm(10);
  advance(b.s, b.t + 30 * MIN);
  assert.equal(towerTotal(b.s), 10, "không continuous: phiên mới, không ăn");
});

test("T12 bản lưu v6 chưa có tower / watchFrom → ensure bổ sung, không đổi phần khác", () => {
  const { s, t } = hungryFarm(1);
  delete s.tower;
  delete s.watchFrom;
  const before = JSON.parse(JSON.stringify(s));
  advance(s, t);
  assert.deepEqual(Object.keys(s.tower).sort(), Object.keys(before.inventory).sort());
  assert.ok(Object.values(s.tower).every((n) => n === 0));
  assert.equal(typeof s.watchFrom, "number");
  for (const k of ["chickens", "eggs", "inventory", "bags", "seed", "tickets"]) assert.deepEqual(s[k], before[k], k);
});
