// v13 — vòng "chơi lại": kỷ lục riêng của từng con ở từng trò (luật ghi trong endPlay) + lợi thế vóc dáng hiển thị ở màn kết quả.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, newGame, advance, incubate, startPlay as startPlayAny, endPlay } from "../../public/apps/chicken-farm/js/game/rules.js";
import { buildEdge } from "../../public/apps/chicken-farm/js/game/play.js";

const T0 = Date.UTC(2026, 10, 24, 3, 0, 0);
const { MIN } = TIME;
const startPlay = (s, id, t) => startPlayAny(s, id, t, { pay: "ticket" });

function farm() {
  const s = newGame(8, T0);
  const { hatchAt } = incubate(s, s.eggs[0].id, T0);
  advance(s, hatchAt);
  const ch = s.chickens[0];
  s.tickets = 20;
  return { s, ch, t: hatchAt + 1000 };
}
// một lượt: cho no, chơi, báo điểm sau 20 giây; trả kết quả endPlay và thời điểm kế tiếp
function round(s, ch, t, score, ms = 20_000) {
  ch.satiety = CONFIG.satietyMax;
  const st = startPlay(s, ch.id, t);
  assert.equal(st.ok, true, JSON.stringify(st));
  return { r: endPlay(s, score, t + ms), kind: st.kind, next: t + ms + MIN };
}

test("kỷ lục: lượt đầu ghi kỷ lục nhưng không gọi là 'kỷ lục mới'", () => {
  const { s, ch, t } = farm();
  const { r, kind } = round(s, ch, t, 0.42);
  assert.equal(r.best, 0.42);
  assert.equal(r.prevBest, 0);
  assert.equal(r.newBest, false);
  assert.equal(ch.best[kind], 0.42);
});

test("kỷ lục: chỉ tăng; vượt kỷ lục cũ thì báo newBest kèm kỷ lục trước", () => {
  const { s, ch, t } = farm();
  const a = round(s, ch, t, 0.5);
  const b = round(s, ch, a.next, 0.3);
  assert.deepEqual([b.r.best, b.r.newBest], [0.5, false]);
  assert.equal(ch.best[a.kind], 0.5);
  const c = round(s, ch, b.next, 0.71);
  assert.deepEqual([c.r.best, c.r.prevBest, c.r.newBest], [0.71, 0.5, true]);
});

test("kỷ lục: lượt bị luật gạt (báo điểm quá sớm) không ghi gì", () => {
  const { s, ch, t } = farm();
  const { r, kind } = round(s, ch, t, 1, CONFIG.play.minMs - 1000);
  assert.equal(r.score, 0);
  assert.equal(ch.best?.[kind] ?? 0, 0);
});

test("kỷ lục: trứng không có kỷ lục", () => {
  const s = newGame(4, T0);
  s.tickets = 9;
  const id = s.eggs[0].id;
  incubate(s, id, T0);
  assert.equal(startPlay(s, id, T0 + 1000).kind, "roll");
  const r = endPlay(s, 0.9, T0 + 21_000);
  assert.deepEqual([r.best, r.newBest], [0, false]);
  assert.equal(s.eggs[0].best, undefined);
});

test("lợi thế vóc dáng: gà trung bình = 0%, giỏi hơn thì dương, kém hơn thì âm; trò của trứng không có", () => {
  const avg = { speed: 0.5, jump: 0.5, steady: 0.5, eye: 0.5 };
  for (const kind of ["hop", "dash", "peck"]) for (const e of buildEdge(kind, avg)) assert.equal(e.pct, 0, `${kind}.${e.key}`);
  const top = { speed: 1, jump: 1, steady: 1, eye: 1 }, low = { speed: 0, jump: 0, steady: 0, eye: 0 };
  for (const kind of ["hop", "dash", "peck"]) {
    for (const e of buildEdge(kind, top)) assert.ok(e.pct > 0, `${kind}.${e.key} top ${e.pct}`);
    for (const e of buildEdge(kind, low)) assert.ok(e.pct < 0, `${kind}.${e.key} low ${e.pct}`);
  }
  assert.deepEqual(buildEdge("roll", top), []);
});
