// Q14 (gà con chờ trong ổ khi người chơi vắng) + sổ sưu tầm ★/★★ + mốc mở chuồng/ổ ấp (Q13). Luật v5.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, NUTRIENTS, DEX, newGame, advance, incubate, dexKeysOf, dexStars } from "../../public/apps/chicken-farm/js/game/rules.js";
import { randomGenome, encodeGenome, mulberry32 } from "../../public/apps/chicken-farm/js/genome.js";

const T0 = Date.UTC(2026, 10, 12, 8, 0, 0);
const { MIN, HOUR } = TIME;

function farmWithEgg(set = {}, seed = 7) {
  const s = newGame(seed, T0);
  const g = randomGenome(mulberry32(seed), { sex: "hen" });
  for (const [k, v] of Object.entries(set)) g.g[k] = [v, v];
  s.eggs[0].code = encodeGenome(g);
  return s;
}

test("Q14: vắng mặt lúc trứng ấp xong → chờ trong ổ, nở lúc người chơi quay lại", () => {
  const s = farmWithEgg();
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  advance(s, hatchAt + HOUR, { present: false });
  assert.equal(s.chickens.length, 0);
  assert.ok(s.incubators[0], "ổ vẫn bị chiếm");
  const back = hatchAt + 5 * HOUR;
  const ev = advance(s, back);
  assert.equal(s.chickens.length, 1);
  assert.equal(s.chickens[0].hatchedAt, back);
  assert.ok(ev.some((e) => e.type === "hatched" && e.at === back));
  assert.equal(s.chickens[0].starvedMs, 0, "gà con không đói lúc chủ vắng");
});

test("Q14: đang mở game (cách lần trước ≤ grace) → nở đúng giờ ấp", () => {
  const s = farmWithEgg();
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  advance(s, hatchAt - 30_000);
  advance(s, hatchAt + 30_000);
  assert.equal(s.chickens.length, 1);
  assert.equal(s.chickens[0].hatchedAt, hatchAt);
  assert.ok(CONFIG.hatchPresenceGraceMs >= MIN);
});

test("sổ: nở gà mang đặc điểm → ★; nuôi tới trưởng thành đủ chất → ★★", () => {
  const s = farmWithEgg({ crest: "Cr" });
  assert.ok(dexKeysOf(s.eggs[0].code).includes("crest"));
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  const ev = advance(s, hatchAt);
  assert.equal(s.dex.crest, 1);
  assert.ok(ev.some((e) => e.type === "dex" && e.key === "crest" && e.star === 1));
  const ch = s.chickens[0];
  ch.growth = CONFIG.stages.adult - 0.01;
  ch.dev.protein = 0.5; // nuôi thiếu chất → chưa ★★
  for (const k of NUTRIENTS) ch.n[k] = 0;
  advance(s, hatchAt + 10 * MIN);
  assert.ok(ch.adultAt != null);
  assert.equal(s.dex.crest, 1);
  assert.equal(dexStars(s, 2), 0);
});

test("sổ: ★★ cần độ phát triển nhóm chất ≥ starDev", () => {
  const s = farmWithEgg({ crest: "Cr" });
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  advance(s, hatchAt);
  const ch = s.chickens[0];
  ch.growth = CONFIG.stages.adult - 0.01;
  ch.dev.protein = 0.99;
  for (const k of NUTRIENTS) ch.n[k] = 100;
  const ev = advance(s, hatchAt + 10 * MIN);
  assert.equal(s.dex.crest, 2);
  assert.ok(ev.some((e) => e.type === "dex" && e.key === "crest" && e.star === 2));
});

test("Q13: đủ ★★ tới mốc đầu → +2 chỗ chuồng và thêm 1 ổ ấp; trần coopMax", () => {
  const s = farmWithEgg({ crest: "Cr" });
  const first = CONFIG.dex.milestones[0];
  const others = DEX.map((d) => d.key).filter((k) => k !== "crest").slice(0, first.at - 1);
  for (const k of others) s.dex[k] = 2;
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  advance(s, hatchAt);
  const ch = s.chickens[0];
  ch.growth = CONFIG.stages.adult - 0.01;
  ch.dev.protein = 0.99;
  for (const k of NUTRIENTS) ch.n[k] = 100;
  const ev = advance(s, hatchAt + 10 * MIN);
  assert.equal(s.milestones, 1);
  assert.equal(s.coopCap, CONFIG.start.coopCap + first.coop);
  assert.equal(s.incubators.length, CONFIG.start.incubators + first.incubators);
  assert.ok(ev.some((e) => e.type === "milestone" && e.n === 1));
  // mọi mốc cộng lại không vượt trần
  const total = CONFIG.start.coopCap + CONFIG.dex.milestones.reduce((a, m) => a + (m.coop ?? 0), 0);
  assert.ok(Math.min(total, CONFIG.dex.coopMax) <= CONFIG.dex.coopMax);
  assert.ok(CONFIG.dex.milestones.every((m, i, a) => i === 0 || m.at > a[i - 1].at), "mốc tăng dần");
  assert.ok(CONFIG.dex.milestones.at(-1).at <= DEX.length, "mốc cuối đạt được");
});

test("bản lưu cũ (chưa có sổ) → sổ dựng lại từ đàn hiện có, không đổi gì khác", () => {
  const s = farmWithEgg({ crest: "Cr" });
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  advance(s, hatchAt);
  delete s.dex;
  delete s.milestones;
  const cap = s.coopCap;
  advance(s, hatchAt + MIN);
  assert.equal(s.dex.crest, 1);
  assert.equal(s.milestones, 0);
  assert.equal(s.coopCap, cap);
});
