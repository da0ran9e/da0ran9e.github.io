// Luật v6 qua API: sưởi trứng, nhận thưởng nhiệm vụ, đốm sáng (cần đang xem cánh đồng), việc trong ngày
// được ghi ngay lần xem đầu tiên của ngày, và phát lại (replay) đúng cả khi hệ thống tự gọi gà về.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, MIN } from "./helpers.mjs";
import { R } from "../src/actions.mjs";
import { replayFarm } from "../tools/replay.mjs";

const s = await startServer();
const watch = (token) => s.api("POST", "/api/field/watch", { token, body: {} });
const actionsOf = (token) => s.app.store.db.prepare("SELECT type, source, rolled FROM actions WHERE player_id = ? ORDER BY seq").all(s.playerIdOf(token));

// Trại mới: ấp quả trứng đầu, sưởi `n` lần (mỗi lần cách nhau đúng nhịp chờ của luật).
async function warmed(n = R.TUTORIAL[0].goal) {
  const p = await s.player();
  const eggId = p.farm.eggs[0].id;
  const inc = await s.act(p.token, "incubate", { eggId });
  let last = inc;
  for (let i = 0; i < n; i++) {
    s.clock.t += R.CONFIG.warm.cooldownMs;
    last = await s.act(p.token, "warmEgg", { eggId });
    assert.equal(last.status, 200, JSON.stringify(last.body));
  }
  return { ...p, eggId, hatchAt: last.body.result.hatchAt };
}

test("v6: trứng đầu ấp 1 phút; sưởi trứng bớt giờ nở, chạm dồn dập → too_fast", async () => {
  const p = await s.player();
  const eggId = p.farm.eggs[0].id;
  const inc = await s.act(p.token, "incubate", { eggId });
  assert.equal(inc.body.result.hatchAt - s.clock.t, R.CONFIG.start.quickHatchMs);
  s.clock.t += 1000;
  const w = await s.act(p.token, "warmEgg", { eggId });
  assert.equal(w.status, 200);
  assert.ok(w.body.result.hatchAt < inc.body.result.hatchAt);
  assert.equal(w.body.farm.count.warm, 1);
  const again = await s.act(p.token, "warmEgg", { eggId });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "too_fast");
  for (const bad of ["../x", "", 7]) assert.equal((await s.act(p.token, "warmEgg", { eggId: bad })).status, 400);
});

test("v6: nhận thưởng — id sai kiểu → 400, chưa xong → 409, xong → túi hạt và sang bước sau", async () => {
  const p = await s.player();
  for (const id of ["daily:x", "tutorial2", "__proto__", 1, null]) {
    const r = await s.act(p.token, "claim", { id });
    assert.equal(r.status, 400, String(id));
  }
  const early = await s.act(p.token, "claim", { id: "tutorial" });
  assert.equal(early.status, 409);
  assert.equal(early.body.code, "not_done");
  const w = await warmed();
  const ok = await s.act(w.token, "claim", { id: "tutorial" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.result.got.bagSize, R.TUTORIAL[0].reward.bag);
  assert.equal(ok.body.farm.quest.step, 1);
  assert.equal(ok.body.farm.bags.length, 1);
  const log = actionsOf(w.token);
  assert.equal(typeof JSON.parse(log.at(-1).rolled).seed, "number", "server tự tung seed cho phần thưởng");
});

test("v6: đốm sáng cần đang xem cánh đồng; phần thưởng do server tung", async () => {
  const { token, chickenId } = await s.hatched();
  const nw = await s.act(token, "fieldBonus", { chickenId });
  assert.equal(nw.status, 409);
  assert.equal(nw.body.code, "not_watching");
  await s.act(token, "release", { chickenId });
  const before = Object.values((await s.farm(token)).inventory).reduce((a, b) => a + b, 0);
  const r = await s.act(token, "fieldBonus", { chickenId, got: { premium: 99 } });
  assert.equal(r.status, 200);
  const f = r.body.farm;
  const after = Object.values(f.inventory).reduce((a, b) => a + b, 0);
  assert.ok(r.body.result.bagId ? f.bags.length === 1 : after - before >= 1 && after - before <= 3, "1–3 hạt hoặc một túi");
  assert.equal(f.count.lucky, 1);
  const fast = await s.act(token, "fieldBonus", { chickenId });
  assert.equal(fast.body.code, "too_fast");
});

test("v6: sang ngày mới, lần xem đầu tiên ghi 'advance' để việc trong ngày không đổi giữa hai lần xem", async () => {
  const { token } = await s.hatched();
  const day0 = (await s.farm(token)).daily.day;
  const n0 = actionsOf(token).length;
  s.clock.t += 24 * 60 * MIN;
  const a = await s.api("GET", "/api/farm", { token });
  assert.equal(a.body.farm.daily.day, day0 + 1);
  assert.equal(a.body.farm.daily.tasks.length, R.CONFIG.daily.tasks);
  const log = actionsOf(token);
  assert.equal(log.length, n0 + 1);
  assert.equal(log.at(-1).type, "advance");
  assert.equal(log.at(-1).source, "view");
  const b = await s.api("GET", "/api/farm", { token });
  assert.deepEqual(b.body.farm.daily, a.body.farm.daily);
  assert.equal(actionsOf(token).length, n0 + 1, "lần xem sau không ghi thêm");
});

test("v6: phát lại đúng cả chuỗi mở đầu, kể cả khi hệ thống gọi gà về lúc trứng đã ấp xong (người chơi vắng)", async () => {
  // chuỗi mở đầu qua API: sưởi → nở → cho ăn → ra đồng kiếm hạt → trứng quà
  const p = await warmed();
  const { token } = p;
  assert.equal((await s.act(token, "claim", { id: "tutorial" })).status, 200);
  s.clock.t = Math.ceil(p.hatchAt) + 1000;
  const chickenId = (await s.farm(token)).chickens[0].id;
  assert.equal((await s.act(token, "claim", { id: "tutorial" })).status, 200); // "hatch" → hạt quý
  for (let i = 0; i < 3; i++) assert.equal((await s.act(token, "feed", { chickenId, seed: "common" })).status, 200);
  assert.equal((await s.act(token, "claim", { id: "tutorial" })).status, 200); // "feed"
  await s.act(token, "release", { chickenId });
  for (let i = 0; i < 5; i++) {
    s.clock.t += R.CONFIG.fieldEatCooldownMs;
    await watch(token);
    assert.equal((await s.act(token, "fieldFind", { chickenId })).status, 200);
  }
  const gift = await s.act(token, "claim", { id: "tutorial" }); // "forage" → trứng quà nở nhanh
  assert.equal(gift.status, 200);
  const giftEgg = gift.body.result.got.eggId;
  const inc = await s.act(token, "incubate", { eggId: giftEgg });
  assert.equal(inc.status, 200);
  assert.equal(inc.body.result.hatchAt - s.clock.t, R.CONFIG.start.quickHatchMs);

  // người chơi tắt máy: không nhịp tim nữa; quá giờ nở → hệ thống gọi gà về, trứng vẫn chờ trong ổ (Q14)
  s.clock.t += 5 * MIN;
  s.app.sweep();
  const pid = s.playerIdOf(token);
  const st = JSON.parse(s.app.store.db.prepare("SELECT state FROM farms WHERE player_id = ?").get(pid).state);
  assert.equal(st.chickens.length, 1, "gà con chưa nở lúc chủ vắng");
  assert.equal(st.chickens[0].location, "coop");
  assert.ok(actionsOf(token).some((a) => a.source === "system" && a.type === "recallAll"));

  // nhật ký phải dựng lại đúng ảnh chụp (hành động của hệ thống = người chơi vắng mặt)
  const rep = replayFarm(s.app.store.db, pid);
  assert.equal(rep.ok, true, rep.error ?? `lệch: ${rep.actual} ≠ ${rep.expected}`);

  // người chơi quay lại: gà con nở, có cặp trống mái
  const back = await s.api("GET", "/api/farm", { token });
  assert.equal(back.body.farm.chickens.length, 2);
  assert.equal(new Set(back.body.farm.chickens.map((c) => c.sex)).size, 2);
  assert.equal(replayFarm(s.app.store.db, pid).ok, true);
});

test("v7 T13: người chơi chỉ XEM (GET mỗi vài giây, không ghi) rồi mới bấm → gà đã ăn trong lúc xem; phát lại khớp", async () => {
  const { token, chickenId } = await s.hatched();
  s.patchless = true;
  // đổ tháp; gà con mới nở có độ no 50/200 < ngưỡng 100 nên sẽ ăn
  const fill = await s.act(token, "fillTower", { seed: "common", n: 10 });
  assert.equal(fill.status, 200, JSON.stringify(fill.body));
  for (let i = 0; i < 75; i++) { s.clock.t += 4000; await s.api("GET", "/api/farm", { token }); } // 5 phút chỉ xem
  const act = await s.act(token, "feed", { chickenId, seed: "common" });
  assert.equal(act.status, 200);
  const tower = Object.values(act.body.farm.tower).reduce((a, b) => a + b, 0);
  assert.ok(tower < 10, `gà phải ăn từ tháp trong lúc người chơi xem (tháp còn ${tower})`);
  for (const bad of [0, 41, 1.5, "3"]) assert.equal((await s.act(token, "fillTower", { seed: "common", n: bad })).status, 400, String(bad));
  const rep = replayFarm(s.app.store.db, s.playerIdOf(token));
  assert.equal(rep.ok, true, rep.error ?? "lệch");
});
