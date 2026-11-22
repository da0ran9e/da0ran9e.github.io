// v12 — tính cách ngẫu nhiên (đôi khi giống bố mẹ, thầy soi trứng gieo được) + Thầy lang bán thuốc cất trong kho.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, PERSONALITY, moodOf, buffOf, newGame, advance, incubate, usePotion, candle, buy, visitorsOfDay, visitorView, dayIndex } from "../../public/apps/chicken-farm/js/game/rules.js";
import { breed, randomGenome, mulberry32 } from "../../public/apps/chicken-farm/js/genome.js";

const { MIN, HOUR } = TIME;
const T0 = Date.UTC(2026, 10, 23, 2, 0, 0);

// trại mới, ấp quả trứng đầu (nở sau 1 phút); `prep(egg)` sửa quả trứng trước khi nở. Trả về { s, ch }.
function hatchOne(seed, prep = () => {}) {
  const s = newGame(seed, T0);
  const egg = s.eggs[0];
  prep(egg);
  incubate(s, egg.id, T0);
  advance(s, T0 + 3 * MIN);
  return { s, ch: s.chickens[0] };
}

test("tính cách: mỗi con một, tung lúc nở, tất định; đủ mọi loại; trống không bao giờ 'chăm đẻ'", () => {
  const seen = new Set();
  for (let seed = 1; seed <= 120; seed++) {
    const { ch } = hatchOne(seed);
    if (!ch) continue;
    assert.ok(PERSONALITY[ch.mood], ch.mood);
    assert.equal(hatchOne(seed).ch.mood, ch.mood, "cùng trại thì cùng kết quả");
    if (ch.sex !== "hen") assert.notEqual(ch.mood, "layer");
    seen.add(ch.mood);
  }
  assert.deepEqual([...seen].sort(), Object.keys(PERSONALITY).sort());
});

test("tính cách: có tỉ lệ nhỏ giống bố mẹ; thầy soi trứng gieo thì chắc chắn", () => {
  let same = 0, n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const { ch } = hatchOne(seed, (e) => { e.fertile = true; e.pm = ["shy", "shy"]; });
    if (!ch) continue;
    n++;
    if (ch.mood === "shy") same++;
  }
  const base = 1 / 5, expect = CONFIG.mood.inherit + (1 - CONFIG.mood.inherit) * base;
  assert.ok(same / n > base + 0.08 && Math.abs(same / n - expect) < 0.12, `giống bố mẹ ${same}/${n}`);
  for (let seed = 1; seed <= 20; seed++) {
    const { ch } = hatchOne(seed, (e) => { e.mood = "lively"; });
    if (ch) assert.equal(ch.mood, "lively");
  }
});

test("gà nở trước v12 giữ tính cách suy từ gen", () => {
  const { s, ch } = hatchOne(4);
  delete ch.mood;
  advance(s, T0 + 4 * MIN);
  assert.ok(PERSONALITY[moodOf(ch)]);
  assert.equal(ch.mood, moodOf(ch));
});

test("thuốc: dùng từ kho cho một con, mỗi con một thuốc; điều kiện mái / trưởng thành", () => {
  const { s, ch } = hatchOne(6);
  const t = T0 + 5 * MIN;
  assert.equal(usePotion(s, ch.id, "full", t).code, "no_potion");
  s.potions.full = 1; s.potions.swift = 1; s.potions.laying = 1; s.potions.breed = 1;
  assert.equal(usePotion(s, ch.id, "laying", t).code, "not_adult");
  assert.equal(usePotion(s, ch.id, "breed", t).code, "not_adult");
  assert.equal(usePotion(s, ch.id, "nope", t).code, "bad_potion");
  assert.equal(usePotion(s, ch.id, "full", t).ok, true);
  assert.equal(s.potions.full, 0);
  assert.equal(usePotion(s, ch.id, "swift", t).code, "buff_active");
  // no lâu: 4 giờ không đói
  const sat = ch.satiety;
  advance(s, t + 3 * HOUR);
  assert.equal(ch.satiety, sat);
  // hết giờ thì dùng thuốc khác được
  advance(s, t + CONFIG.potions.full.ms + MIN);
  assert.equal(buffOf(ch, t + CONFIG.potions.full.ms + MIN), null);
  assert.equal(usePotion(s, ch.id, "swift", t + CONFIG.potions.full.ms + MIN).ok, true);
});

test("thuốc giữ giống: bên uống truyền alen đặc điểm ~75%, không uống thì ~50%", () => {
  const rng = mulberry32(9);
  const het = randomGenome(rng);
  het.g.crest = ["Cr", "cr"];
  const other = randomGenome(rng);
  other.g.crest = ["cr", "cr"];
  const count = (prefer) => { let c = 0; for (let i = 0; i < 4000; i++) if (breed(het, other, mulberry32(i), { prefer, mutationRate: 0 }).genome.g.crest[0] === "Cr") c++; return c / 4000; };
  const plain = count([null, null]), kept = count([{ crest: new Set(["Cr"]) }, null]);
  assert.ok(Math.abs(plain - 0.5) < 0.04, `thường ${plain}`);
  assert.ok(Math.abs(kept - 0.75) < 0.04, `giữ giống ${kept}`);
});

test("Thầy lang bán thuốc vào kho (có sức chứa); thầy soi trứng gieo tính cách", () => {
  let found = null;
  for (let seed = 1; seed < 40 && !found; seed++) {
    for (let d = dayIndex(T0); d < dayIndex(T0) + 30 && !found; d++) {
      const v = visitorsOfDay(seed, d).find((x) => x.who === "herbalist");
      if (v) found = { s: newGame(seed, T0), t: v.from + 1000 };
    }
  }
  assert.ok(found, "có lượt Thầy lang ghé");
  const { s, t } = found;
  s.tickets = 60;
  const view = visitorView(s, t);
  assert.equal(view.who, "herbalist");
  assert.equal(view.stock.length, 3);
  const k = view.stock[0].potion, r = buy(s, 0, t);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.potions[k], 1);
  for (const p of Object.keys(s.potions)) s.potions[p] = 2;
  assert.equal(buy(s, 1, t).code, "potions_full");

  let rd = null;
  for (let seed = 1; seed < 40 && !rd; seed++) for (let d = dayIndex(T0); d < dayIndex(T0) + 30 && !rd; d++) {
    const v = visitorsOfDay(seed, d).find((x) => x.who === "reader");
    if (v) rd = { s: newGame(seed, T0), t: v.from + 1000 };
  }
  const s2 = rd.s;
  s2.tickets = 20;
  const egg = s2.eggs.find((e) => e.fertile && e.hatchAt == null) ?? s2.eggs.find((e) => e.fertile);
  egg.hatchAt = null; // giữ trong kho để không nở trước lượt ghé
  assert.equal(candle(s2, egg.id, "mood", rd.t, { mood: "nope" }).code, "bad_mood");
  assert.equal(candle(s2, egg.id, "mood", rd.t, { mood: "calm" }).ok, true);
  assert.equal(egg.mood, "calm");
  assert.equal(candle(s2, egg.id, "mood", rd.t, { mood: "shy" }).code, "known");
});
