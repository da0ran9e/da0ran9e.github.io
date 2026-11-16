// Luật v7 — vé, thể lực, sân chơi (minigame). Thiết kế: docs/chicken-farm/design-hard-parts.md §H2, §H3 và ideas.md mục 12.
// CHƯA có test ở đây (để lại): P6 lượt dở quá hạn, P11 gà bị đổi giữa lượt, P13 kiểu trò theo tuổi, thể lực ngoài đồng / ban đêm.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, NUTRIENTS, newGame, advance, incubate, startPlay, endPlay, tradeToShop, staminaOf, staminaMaxOf } from "../../public/apps/chicken-farm/js/game/rules.js";

const T0 = Date.UTC(2026, 10, 16, 3, 0, 0); // 10:00 giờ Việt Nam (ban ngày)
const { MIN, HOUR, DAY } = TIME;
const P = CONFIG.play;

function farm(tickets = 5, seed = 8) {
  const s = newGame(seed, T0);
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  advance(s, hatchAt);
  const ch = s.chickens[0];
  ch.satiety = CONFIG.satietyMax;
  s.tickets = tickets;
  return { s, ch, t: hatchAt + 1000 };
}

test("P1 không vé → no_ticket, không trừ thể lực", () => {
  const { s, ch, t } = farm(0);
  const before = staminaOf(ch);
  assert.equal(startPlay(s, ch.id, t).code, "no_ticket");
  assert.equal(staminaOf(ch), before);
  assert.equal(s.play, null);
});

test("P2/P3 kết thúc quá sớm hoặc quá muộn → điểm 0 nhưng vé, độ no và thể lực vẫn mất", () => {
  for (const wait of [P.minMs - 1, P.maxMs + 1]) {
    const { s, ch, t } = farm(3);
    const g = ch.growth;
    assert.equal(startPlay(s, ch.id, t).ok, true);
    const r = endPlay(s, 1, t + wait);
    assert.equal(r.score, 0);
    assert.equal(r.win, false);
    assert.equal(s.tickets, 2);
    assert.ok(ch.growth - g < 1, "không được cộng điểm lớn của minigame");
  }
});

test("P4 điểm ngoài khoảng / không phải số bị kẹp: 5 → 1, −1 → 0, NaN → 0, chuỗi → 0", () => {
  for (const [given, want] of [[5, 1], [-1, 0], [NaN, 0], ["1", 0], [0.7, 0.7]]) {
    const { s, ch, t } = farm(3);
    startPlay(s, ch.id, t);
    assert.equal(endPlay(s, given, t + 20_000).score, want, String(given));
  }
});

test("P5 kết thúc hai lần → lần hai no_play, không cộng thêm gì", () => {
  const { s, ch, t } = farm(3);
  startPlay(s, ch.id, t);
  assert.equal(endPlay(s, 1, t + 20_000).ok, true);
  const snap = JSON.stringify([s.tickets, ch.growth, ch.fitness, s.count.play, s.playDay]);
  assert.equal(endPlay(s, 1, t + 21_000).code, "no_play");
  assert.equal(JSON.stringify([s.tickets, ch.growth, ch.fitness, s.count.play, s.playDay]), snap);
});

test("thắng chỉ hoàn lại vé đã bỏ ra (minigame không sinh vé ròng); thua thì mất vé", () => {
  const a = farm(3);
  startPlay(a.s, a.ch.id, a.t);
  assert.deepEqual([endPlay(a.s, P.winAt, a.t + 20_000).ticket, a.s.tickets], [true, 3]);
  const b = farm(3);
  startPlay(b.s, b.ch.id, b.t);
  assert.deepEqual([endPlay(b.s, P.winAt - 0.01, b.t + 20_000).ticket, b.s.tickets], [false, 2]);
});

test("P8 vé thưởng có trần mỗi ngày; sang ngày đếm lại", () => {
  const { s, ch } = farm(50);
  let t = T0 + HOUR, won = 0;
  const round = () => {
    advance(s, t); // trôi tới `t` trước, rồi mới nạp đầy (không thì một ngày trôi qua làm gà đói)
    ch.stamina = staminaMaxOf(ch); ch.satiety = CONFIG.satietyMax; // nạp đầy thể lực / độ no để chỉ thử trần vé
    assert.equal(startPlay(s, ch.id, t).ok, true);
    const r = endPlay(s, 1, t + 20_000);
    t += 30_000;
    return r.ticket;
  };
  for (let i = 0; i < P.winTicketsPerDay + 3; i++) won += round() ? 1 : 0;
  assert.equal(won, P.winTicketsPerDay);
  t += DAY;
  assert.equal(round(), true, "ngày mới lại được vé");
});

test("P9 minigame đẩy gà tới sát ngưỡng lớn → bước mô phỏng kế tiếp vẫn phát 'adult' và ghi adultAt", () => {
  const { s, ch, t } = farm(3);
  ch.growth = CONFIG.stages.adult - 2;
  for (const k of NUTRIENTS) ch.n[k] = 100;
  startPlay(s, ch.id, t);
  endPlay(s, 1, t + 20_000);
  assert.ok(ch.growth < CONFIG.stages.adult, "chưa tự ý thành gà lớn trong endPlay");
  assert.equal(ch.adultAt, null);
  ch.satiety = CONFIG.satietyMax;
  const ev = advance(s, t + 5 * MIN);
  assert.ok(ev.some((e) => e.type === "adult"));
  assert.ok(ch.adultAt != null);
  assert.equal(s.count.adult, 1);
});

test("P10 trứng đang ấp: rút thời gian ấp theo điểm, không sớm hơn 'bây giờ'; mỗi quả chơi có hạn", () => {
  const s = newGame(4, T0);
  s.tickets = 9;
  s.eggs[0].quick = false;
  const id = s.eggs[0].id;
  const { hatchAt } = incubate(s, id, T0);
  const total = hatchAt - T0;
  assert.equal(startPlay(s, id, T0 + 1000).kind, "roll");
  endPlay(s, 0.5, T0 + 21_000);
  assert.ok(Math.abs(hatchAt - s.eggs[0].hatchAt - P.eggCutPct * total * 0.5) < 2);
  startPlay(s, id, T0 + 30_000);
  endPlay(s, 1, T0 + 50_000);
  assert.equal(startPlay(s, id, T0 + 60_000).code, "too_tired");
});

test("thể lực: mỗi lượt tốn, hết thì too_tired, nghỉ ở chuồng (không đói) thì hồi; đói thì không chơi được", () => {
  const { s, ch, t } = farm(9);
  const max = staminaMaxOf(ch);
  assert.equal(staminaOf(ch), max);
  assert.ok(max < 100 * CONFIG.stamina.stage.chick + 1, "gà con có trần thể lực thấp");
  assert.equal(startPlay(s, ch.id, t).ok, true);
  assert.equal(staminaOf(ch), max - P.stamina);
  endPlay(s, 0.9, t + 20_000);
  assert.ok(ch.fitness > 0, "chơi xong có rèn luyện");
  ch.satiety = CONFIG.satietyMax;
  assert.equal(startPlay(s, ch.id, t + 30_000).code, "too_tired");
  for (let i = 1; i <= 8; i++) { ch.satiety = CONFIG.satietyMax; advance(s, t + i * 30 * MIN); }
  assert.ok(staminaOf(ch) > max - P.stamina, "đã hồi");
  ch.satiety = P.hunger - 1;
  ch.stamina = 999;
  assert.equal(startPlay(s, ch.id, s.updatedAt + 1000).code, "too_hungry");
});

test("đổi lấy vé: chỉ trứng có phôi và gà trưởng thành, có trần mỗi ngày; vượt trần vẫn đổi được túi hạt", () => {
  const { s, ch, t } = farm(0);
  const egg = (id, fertile = true) => s.eggs.push({ id, code: ch.code, shell: "#fff", shellName: "x", fertile, motherId: null, fatherId: null, laidAt: t, mutations: 0, hatchAt: null });
  for (let i = 0; i < 5; i++) egg(`f${i}`);
  egg("inf", false);
  assert.equal(tradeToShop(s, { chickens: [ch.id] }, t, { want: "tickets" }).code, "not_adult");
  assert.equal(tradeToShop(s, { eggs: ["inf"] }, t, { want: "tickets" }).code, "infertile");
  assert.equal(tradeToShop(s, { eggs: ["f0", "f1", "f2"] }, t, { want: "tickets" }).tickets, 3 * CONFIG.tickets.perEgg);
  assert.equal(tradeToShop(s, { eggs: ["f3"] }, t, { want: "tickets" }).code, "ticket_limit");
  assert.equal(tradeToShop(s, { eggs: ["f3"] }, t).ok, true, "túi hạt không bị trần vé chặn");
  assert.equal(tradeToShop(s, { eggs: ["f4"] }, t + DAY, { want: "tickets" }).ok, true);
  assert.equal(s.tickets, 4);
});
