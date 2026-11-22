// Luật v7 — vé, thể lực, sân chơi (minigame). Thiết kế: docs/chicken-farm/design-hard-parts.md §H2, §H3 và ideas.md mục 12.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, NUTRIENTS, newGame, advance, incubate, release, startPlay as startPlayAny, endPlay, tradeToShop, staminaOf, staminaMaxOf, energyOf, energyNextAt } from "../../public/apps/chicken-farm/js/game/rules.js";

const T0 = Date.UTC(2026, 10, 16, 3, 0, 0); // 10:00 giờ Việt Nam (ban ngày)
const { MIN, HOUR, DAY } = TIME;
const P = CONFIG.play;
// Các test cũ thử lượt chơi BẰNG VÉ; lượt miễn phí (sức chơi) có test riêng ở cuối tệp.
const startPlay = (s, id, t) => startPlayAny(s, id, t, { pay: "ticket" });

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
  const snap = JSON.stringify([s.tickets, ch.growth, s.count.play, s.playDay]);
  assert.equal(endPlay(s, 1, t + 21_000).code, "no_play");
  assert.equal(JSON.stringify([s.tickets, ch.growth, s.count.play, s.playDay]), snap);
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
  assert.ok(Math.abs(hatchAt - s.eggs[0].hatchAt - P.eggCutPct * P.ticketMul * total * 0.5) < 2);
  startPlay(s, id, T0 + 30_000);
  endPlay(s, 1, T0 + 50_000);
  assert.equal(startPlay(s, id, T0 + 60_000).code, "too_tired");
});

test("sức chơi: lượt miễn phí tốn 1 điểm, hết thì no_energy (vẫn chơi được bằng vé); hồi 1 điểm mỗi 30 phút, tối đa 5", () => {
  const E = CONFIG.energy;
  const { s, ch, t } = farm(0);
  assert.equal(energyOf(s, t), E.max);
  let at = t;
  for (let i = 0; i < E.max; i++) {
    ch.satiety = CONFIG.satietyMax;
    assert.equal(startPlayAny(s, ch.id, at).ok, true, `lượt ${i + 1}`);
    endPlay(s, 0.9, at + 20_000);
    at += 30_000;
  }
  assert.equal(s.tickets, 0, "lượt miễn phí không tốn vé");
  assert.equal(energyOf(s, at), 0);
  ch.satiety = CONFIG.satietyMax;
  assert.equal(startPlayAny(s, ch.id, at).code, "no_energy");
  assert.equal(startPlayAny(s, ch.id, at, { pay: "ticket" }).code, "no_ticket");
  // hồi: đủ 30 phút kể từ lúc tiêu điểm đầu tiên (lúc đang đầy) mới có 1 điểm; phần lẻ không mất
  assert.equal(energyNextAt(s, at), t + E.regenMs);
  assert.equal(energyOf(s, t + E.regenMs - 1), 0);
  assert.equal(energyOf(s, t + E.regenMs), 1);
  assert.equal(energyOf(s, t + 2.5 * E.regenMs), 2);
  assert.equal(energyOf(s, t + 99 * E.regenMs), E.max, "tối đa 5");
  ch.satiety = CONFIG.satietyMax;
  assert.equal(startPlayAny(s, ch.id, t + 2.5 * E.regenMs).ok, true);
  assert.equal(energyOf(s, t + 2.5 * E.regenMs), 1);
  assert.equal(energyOf(s, t + 3 * E.regenMs), 2, "mốc hồi giữ nguyên nhịp 30 phút cũ");
});

test("lượt miễn phí không hoàn vé; lượt bằng vé thưởng gấp rưỡi; thể lực từng con không chặn việc chơi", () => {
  const a = farm(3);
  a.ch.stamina = 0;
  const g0 = a.ch.growth;
  assert.equal(startPlayAny(a.s, a.ch.id, a.t).ok, true, "thể lực của gà không còn chặn sân chơi");
  const r = endPlay(a.s, 1, a.t + 20_000);
  assert.deepEqual([r.win, r.ticket, a.s.tickets], [true, false, 3]);
  const gFree = a.ch.growth - g0;
  const b = farm(3);
  const g1 = b.ch.growth;
  startPlay(b.s, b.ch.id, b.t);
  endPlay(b.s, 1, b.t + 20_000);
  assert.ok(Math.abs(b.ch.growth - g1 - gFree * P.ticketMul) < 0.01);
  assert.ok(staminaMaxOf(a.ch) > 0 && staminaOf(a.ch) >= 0);
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

test("P6 lượt dở: còn trong hạn → play_busy; quá maxMs thì lượt mới thay lượt cũ (không hoàn vé)", () => {
  const { s, ch, t } = farm(3);
  assert.equal(startPlay(s, ch.id, t).ok, true);
  assert.equal(startPlay(s, ch.id, t + P.maxMs).code, "play_busy");
  assert.equal(startPlay(s, ch.id, t + P.maxMs + 1).ok, true);
  assert.equal(s.tickets, 1, "hai lượt, mỗi lượt 1 vé");
  assert.equal(s.play.at, t + P.maxMs + 1);
});

test("P11 gà rời trại giữa lượt (đổi ở chợ) → kết thúc trả gone, điểm 0, không lỗi", () => {
  const { s, ch, t } = farm(3);
  assert.equal(startPlay(s, ch.id, t).ok, true);
  s.chickens = s.chickens.filter((c) => c.id !== ch.id);
  const r = endPlay(s, 1, t + P.minMs + 1000);
  assert.equal(r.ok, true);
  assert.equal(r.gone, true);
  assert.equal(r.score, 0);
  assert.equal(s.play, null);
});

test("P13 kiểu trò theo tuổi: gà con nhảy, gà giò chạy, gà lớn mổ, trứng lăn", () => {
  const { s, ch, t } = farm(10);
  const kinds = [];
  for (const g of [0, CONFIG.stages.juvenile, CONFIG.stages.adult]) {
    ch.growth = g;
    if (g >= CONFIG.stages.adult) ch.adultAt = t;
    ch.satiety = CONFIG.satietyMax;
    kinds.push(startPlay(s, ch.id, t + kinds.length * (P.maxMs + 1)).kind);
  }
  s.eggs.push({ id: "eg", code: ch.code, shell: "#fff", shellName: "", fertile: true, motherId: null, fatherId: null, laidAt: t, mutations: 0, hatchAt: t + 10 * HOUR });
  kinds.push(startPlay(s, "eg", t + 3 * (P.maxMs + 1)).kind);
  assert.deepEqual(kinds, ["hop", "dash", "peck", "roll"]);
});

test("thể lực: ngoài đồng tiêu dần; về chuồng no bụng thì hồi, ban đêm hồi gấp đôi", () => {
  const S = CONFIG.stamina;
  const { s, ch, t } = farm(0);
  ch.stamina = staminaMaxOf(ch);
  assert.equal(release(s, ch.id, t).ok, true);
  advance(s, t + HOUR, { continuous: true });
  assert.ok(Math.abs(staminaOf(ch) - (staminaMaxOf(ch) - S.fieldPerHour)) <= 1, "1 giờ ngoài đồng mất ~fieldPerHour");
  // hồi: so một giờ ban ngày với một giờ ban đêm (giờ Việt Nam)
  const regen = (startUtcHour) => {
    const f = farm(0);
    const at = Date.UTC(2026, 10, 17, startUtcHour, 0, 0);
    advance(f.s, at);
    f.ch.satiety = CONFIG.satietyMax;
    f.ch.stamina = 0;
    advance(f.s, at + 30 * MIN, { continuous: true });
    return staminaOf(f.ch);
  };
  const day = regen(3), night = regen(17); // 10:00 và 0:00 giờ VN
  assert.ok(day > 0);
  assert.ok(Math.abs(night - day * S.nightMul) <= 1, `đêm ${night} ≈ ${S.nightMul} × ngày ${day}`);
});
