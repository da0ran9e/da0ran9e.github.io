// Luật v7 — khách qua đường. Thiết kế: docs/chicken-farm/ideas.md mục 15.
// CHƯA có test (để lại): nghệ nhân, người đổi chác bằng trứng, kho đầy khi mua, khách hết giờ giữa chừng.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, NUTRIENTS, VISITORS, VISIT_CONFIG, RARE_TRAITS, newGame, advance, incubate, visitorsOfDay, visitorView, buy, barter, deliver, candle, haggle, matchesOrder, dexKeysOf, dayIndex } from "../../public/apps/chicken-farm/js/game/rules.js";

const { MIN, HOUR, DAY } = TIME;
const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);

// Trại (seed cho trước) ở đúng lúc một khách loại `who` đang ghé; dò các ngày tới khi gặp. null nếu 60 ngày không gặp.
function farmWith(who, seed = 3) {
  const s = newGame(seed, T0);
  for (let d = dayIndex(T0); d < dayIndex(T0) + 60; d++) {
    const v = visitorsOfDay(seed, d).find((x) => x.who === who);
    if (v) { s.tickets = 60; return { s, v, t: v.from + 1000 }; }
  }
  return null;
}

test("lịch khách: tất định theo (seed, ngày), không trùng giờ, trong 7:00–23:00, bà hàng hạt ghé mỗi ngày, khách lạ chỉ ban đêm", () => {
  const day = dayIndex(T0);
  assert.deepEqual(visitorsOfDay(5, day), visitorsOfDay(5, day));
  const seen = new Set();
  for (let d = day; d < day + 40; d++) {
    const list = visitorsOfDay(5, d), start = d * DAY - CONFIG.daily.tzOffsetMs;
    assert.equal(list.filter((v) => v.who === "seller").length, VISITORS.seller.perDay, "bà hàng hạt");
    for (const [i, v] of list.entries()) {
      seen.add(v.who);
      assert.ok(v.from >= start + 7 * HOUR && v.until <= start + 23 * HOUR, "trong giờ thức");
      if (i) assert.ok(v.from >= list[i - 1].until, "không trùng giờ");
      if (v.who === "stranger") assert.ok(v.from >= start + 19 * HOUR && v.until - v.from === 15 * MIN, "khách lạ: đêm, 15 phút");
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(VISITORS).sort(), "40 ngày gặp đủ mọi loại khách");
});

test("bà hàng hạt: mua bằng vé, mỗi món một lần; sai loại khách / hết giờ / hết vé thì từ chối", () => {
  const { s, t, v } = farmWith("seller");
  const view = visitorView(s, t);
  assert.equal(view.who, "seller");
  assert.equal(view.stock.length, 3);
  const before = s.tickets;
  const r = buy(s, 0, t);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(before - s.tickets, view.stock[0].price);
  assert.equal(buy(s, 0, t).code, "sold");
  assert.equal(buy(s, 9, t).code, "no_item");
  assert.equal(haggle(s, 5, t).code, "no_visitor");
  s.tickets = 0;
  assert.equal(buy(s, 1, t).code, "no_ticket");
  s.tickets = 9;
  if (visitorView(s, v.until + 1).who === null) assert.equal(buy(s, 1, v.until + 1).code, "no_visitor");
});

test("khách lạ: mỗi lượt một giỏ; trúng thì trứng CHẮC CHẮN mang đặc điểm hiếm; trượt vẫn có quà", () => {
  const a = farmWith("stranger");
  const r = buy(a.s, 1, a.t, { rng: () => 0 });
  assert.equal(r.rare, true);
  const egg = a.s.eggs.find((e) => e.id === r.got.eggId);
  assert.ok(RARE_TRAITS.includes(r.got.trait));
  assert.ok(dexKeysOf(egg.code).includes(r.got.trait));
  assert.deepEqual(egg.known.traits, [r.got.trait]);
  assert.equal(buy(a.s, 2, a.t).code, "sold");
  const b = farmWith("stranger", 11);
  const miss = buy(b.s, 0, b.t, { rng: () => 0.99 });
  assert.equal(miss.rare, false);
  assert.ok(miss.got.seeds || miss.got.bagId);
});

test("trứng theo đặc điểm của lái buôn: nở ra chắc chắn mang đặc điểm đã ghi (thử nhiều đặc điểm thường gặp)", () => {
  const tried = new Set();
  for (let seed = 1; seed < 500 && tried.size < 7; seed++) {
    const f = farmWith("haggler", seed);
    if (!f) continue;
    const item = visitorView(f.s, f.t).stock[0];
    if (!item.egg || tried.has(item.egg)) continue;
    const r = haggle(f.s, item.price, f.t);
    assert.equal(r.sold, true, JSON.stringify(r));
    assert.ok(dexKeysOf(f.s.eggs.find((e) => e.id === r.got.eggId).code).includes(item.egg), item.egg);
    tried.add(item.egg);
  }
  assert.ok(tried.size >= 6, `đã thử ${tried.size} đặc điểm`);
});

test("mặc cả: trả đủ sàn thì mua với giá mình trả; thấp quá thì ông bỏ đi; lửng lơ thì ông hạ giá, tối đa 3 lần, không lộ sàn", () => {
  const H = VISIT_CONFIG.haggle;
  const mk = () => { const f = farmWith("haggler"); return { ...f, item: visitorView(f.s, f.t).stock[0] }; };
  const mid = () => 0.5; // sàn = ceil(giá × giữa khoảng)
  const a = mk();
  const floor = Math.ceil(a.item.price * (H.floor[0] + (H.floor[1] - H.floor[0]) * 0.5));
  const r = haggle(a.s, floor, a.t, { rng: mid });
  assert.deepEqual([r.sold, r.price], [true, floor]);
  assert.equal(a.s.tickets, 60 - floor);
  const b = mk();
  assert.equal(haggle(b.s, 1, b.t, { rng: mid }).gone, true);
  assert.equal(haggle(b.s, b.item.price, b.t).code, "visitor_gone");
  const c = mk();
  let last;
  for (let i = 0; i < H.tries; i++) {
    last = haggle(c.s, floor - 1, c.t + i, { rng: mid });
    assert.ok(last.counter >= floor, "không bao giờ hạ dưới sàn");
  }
  assert.equal(last.left, 0);
  assert.equal(visitorView(c.s, c.t).floor, undefined, "bản xem không lộ sàn");
  assert.equal(haggle(c.s, last.counter, c.t + 9).sold, true, "mua theo giá cuối");
  assert.equal(haggle(mk().s, 0, a.t).code, "bad_offer");
});

test("người sưu tầm: chỉ nhận gà trưởng thành đúng yêu cầu; giao rồi gà rời trại, nhận vé", () => {
  const { s, t } = farmWith("collector");
  s.tickets = 0;
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  advance(s, hatchAt);
  const ch = s.chickens[0];
  assert.equal(deliver(s, ch.id, t).code, "no_match", "gà con chưa giao được");
  ch.growth = CONFIG.stages.adult;
  ch.adultAt = t;
  for (const k of NUTRIENTS) ch.dev[k] = 0.5;
  assert.equal(matchesOrder(ch, { traits: [], quality: true }), false, "nuôi thiếu chất");
  for (const k of NUTRIENTS) ch.dev[k] = 0.95;
  assert.equal(matchesOrder(ch, { traits: [], quality: true }), true);
  assert.equal(matchesOrder(ch, { traits: ["__none__"], quality: false }), false);
  const order = visitorView(s, s.updatedAt).stock?.[0];
  if (order && matchesOrder(ch, order)) {
    const r = deliver(s, ch.id, s.updatedAt);
    assert.equal(r.tickets, order.pay);
    assert.equal(s.chickens.length, 0);
  }
});

test("thầy soi trứng: biết trống/mái hoặc từng đặc điểm, mỗi lần tốn vé; soi hết thì thôi", () => {
  const { s, t } = farmWith("reader");
  const id = s.eggs[0].id, before = s.tickets;
  const a = candle(s, id, "sex", t);
  assert.ok(["hen", "rooster"].includes(a.known.sex));
  assert.equal(before - s.tickets, VISIT_CONFIG.reader.sex);
  assert.equal(candle(s, id, "sex", t).code, "known");
  const total = dexKeysOf(s.eggs[0].code).length;
  for (let i = 0; i < Math.max(1, total); i++) assert.equal(candle(s, id, "trait", t).ok, true);
  assert.equal((s.eggs[0].known.traits ?? []).length, total);
  assert.equal(candle(s, id, "trait", t).code, "known");
  assert.equal(candle(s, id, "weight", t).code, "bad_deal");
});

test("người đổi chác: đưa đủ hạt thì nhận món kia; thiếu thì từ chối và không mất gì", () => {
  let f = null, slot = -1;
  for (let seed = 1; seed < 60 && slot < 0; seed++) {
    f = farmWith("trader", seed);
    slot = f ? visitorView(f.s, f.t).stock.findIndex((o) => o.give.seed && o.give.seed !== "premium") : -1;
  }
  assert.ok(slot >= 0, "tìm được một lời đổi bằng hạt");
  const { s, t } = f, o = visitorView(s, t).stock[slot];
  s.inventory[o.give.seed] = o.give.n - 1;
  const snap = JSON.stringify(s.inventory);
  assert.equal(barter(s, slot, t).code, "no_seed");
  assert.equal(JSON.stringify(s.inventory), snap);
  s.inventory[o.give.seed] = o.give.n;
  assert.equal(barter(s, slot, t).ok, true);
  assert.equal(s.inventory[o.give.seed], 0);
  assert.equal(s.inventory.premium, 1);
  assert.equal(barter(s, slot, t).code, "sold");
});
