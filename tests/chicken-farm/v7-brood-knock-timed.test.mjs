// Luật v7 — gà mái ấp giúp, gõ trứng, rương theo giờ. Thiết kế: docs/chicken-farm/next-rounds.md đợt B.
// CHƯA có test (để lại): mái đang ấp thì không đẻ; mái ra đồng thì thôi ấp; rương khi kho túi đầy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, newGame, advance, incubate, knockEgg, claim, questView } from "../../public/apps/chicken-farm/js/game/rules.js";

const { MIN, HOUR, DAY } = TIME;
const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);

// Trại có 1 gà mái trưởng thành no bụng và 1 quả trứng thường (ấp theo gen) vừa đặt vào ổ.
function broodFarm(seed) {
  const s = newGame(seed, T0);
  const first = incubate(s, s.eggs[0].id, T0);
  advance(s, first.hatchAt);
  const hen = s.chickens[0];
  Object.assign(hen, { sex: "hen", growth: CONFIG.stages.adult, adultAt: first.hatchAt, satiety: CONFIG.satietyMax });
  s.eggs.push({ id: "e2", code: hen.code, shell: "#fff", shellName: "x", fertile: true, motherId: null, fatherId: null, laidAt: T0, mutations: 0, hatchAt: null });
  const t = first.hatchAt + 1000;
  const inc = incubate(s, "e2", t);
  return { s, hen, t, hatchAt: inc.hatchAt };
}

test("gà mái lớn no bụng thỉnh thoảng vào ấp giúp → trứng nở sớm hơn; mái đói thì không bao giờ ấp", () => {
  let helped = 0, starvedHelped = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const a = broodFarm(seed);
    const ev = [];
    for (let i = 1; i <= 60 && a.s.eggs.some((e) => e.id === "e2"); i++) { a.hen.satiety = CONFIG.satietyMax; ev.push(...advance(a.s, a.t + i * 30_000, { present: false })); }
    const egg = a.s.eggs.find((e) => e.id === "e2");
    // mái có thể vừa vào ổ ở phút cuối: cho trôi thêm 5 phút để việc ấp kịp có tác dụng (chỉ với trại có mái ấp)
    if (ev.some((e) => e.type === "brood")) { a.hen.satiety = CONFIG.satietyMax; advance(a.s, a.t + 35 * MIN, { present: false }); }
    if (ev.some((e) => e.type === "brood")) {
      helped++;
      assert.ok(egg.hatchAt < a.hatchAt, "đã rút giờ nở");
      assert.ok(a.hatchAt - egg.hatchAt <= CONFIG.brood.minutes * MIN * (CONFIG.brood.speed - 1) * 3, "không rút quá mức");
    } else assert.equal(egg.hatchAt, a.hatchAt, "không ai ấp thì giờ nở giữ nguyên");
    const b = broodFarm(seed);
    b.hen.satiety = 10;
    if (advance(b.s, b.t + 30 * MIN, { present: false }).some((e) => e.type === "brood")) starvedHelped++;
  }
  assert.ok(helped >= 3 && helped <= 30, `40 trại, ${helped} trại có mái ấp giúp trong 30 phút (kỳ vọng ~22%)`);
  assert.equal(starvedHelped, 0);
});

test("gõ trứng: trước mốc 85% → too_early; từ mốc đó gõ là nở ngay, có sự kiện hatched", () => {
  const s = newGame(7, T0);
  s.eggs[0].quick = false;
  const id = s.eggs[0].id;
  assert.equal(knockEgg(s, id, T0).code, "not_incubating");
  const { hatchAt } = incubate(s, id, T0);
  const total = hatchAt - T0;
  assert.equal(knockEgg(s, id, T0 + total * 0.8).code, "too_early");
  assert.equal(s.chickens.length, 0);
  const r = knockEgg(s, id, T0 + total * 0.86);
  assert.equal(r.ok, true);
  assert.equal(s.chickens.length, 1);
  assert.equal(s.chickens[0].id, r.chickenId);
  assert.equal(s.chickens[0].hatchedAt, T0 + total * 0.86);
  assert.ok(r.events.some((e) => e.type === "hatched"));
  assert.equal(s.count.knock, 1);
  assert.equal(knockEgg(s, id, hatchAt).code, "no_egg");
});

test("rương theo giờ: mốc TÍCH LUỸ từ đầu vòng (5′, 15′, 1h, 4h, 12h, 24h); vắng lâu thì nhận liền mấy rương; hết vòng bắt đầu lại", () => {
  const s = newGame(9, T0);
  const C = CONFIG.timed;
  assert.deepEqual(C.map((c) => c.at), [5 * MIN, 15 * MIN, HOUR, 4 * HOUR, 12 * HOUR, 24 * HOUR]);
  assert.equal(claim(s, "timed", T0 + C[0].at - 1).code, "not_done");
  assert.equal(claim(s, "timed", T0 + C[0].at).ok, true);
  assert.equal(s.bags.at(-1).size, C[0].bag);
  // rương 2 mở ở phút 15 tính từ đầu vòng (không phải 15 phút sau khi nhận rương 1)
  assert.equal(questView(s).timed.readyAt, T0 + C[1].at);
  assert.equal(claim(s, "timed", T0 + C[1].at - 1).code, "not_done");
  // vắng mặt tới giờ thứ 13: rương 2, 3, 4, 5 đều đã tới mốc → nhận liền, mỗi lần một rương
  const back = T0 + 13 * HOUR;
  for (let i = 1; i <= 4; i++) {
    s.bags.length = 0;
    assert.equal(claim(s, "timed", back).ok, true, `rương ${i + 1}`);
    assert.equal(s.bags.at(-1).size, C[i].bag);
  }
  assert.equal(claim(s, "timed", back).code, "not_done", "rương cuối chưa tới mốc 24 giờ");
  const tickets = s.tickets;
  assert.equal(claim(s, "timed", T0 + 24 * HOUR).ok, true);
  assert.equal(s.tickets, tickets + 1, "rương cuối tặng 1 vé");
  assert.deepEqual(s.timed, { start: T0 + 24 * HOUR, claimed: 0 }, "vòng mới tính từ lúc nhận rương cuối");
  // sang ngày không làm gì vòng đang chạy; bản lưu v7 ({step, readyAt}) được chuyển sang dạng mới
  advance(s, T0 + 2 * DAY);
  assert.equal(s.timed.start, T0 + 24 * HOUR);
  const old = newGame(10, T0);
  old.timed = { step: 3, readyAt: T0 + HOUR };
  advance(old, T0 + MIN);
  assert.equal(old.timed.claimed, 0);
  assert.equal(typeof old.timed.start, "number");
});
