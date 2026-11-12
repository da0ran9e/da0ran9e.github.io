// Test cánh đồng ở M2: thả gà (1 con/lần — field_busy), nhịp tim "đang xem", tìm hạt do server
// tung loại, kiểm tra không ở ngoài đồng / quá nhanh / hết nhịp tim → gà tự về chuồng.

import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.mjs";
import { R } from "../src/actions.mjs";

const s = await startServer();
const watch = (token) => s.api("POST", "/api/field/watch", { token, body: {} });
const pidOf = (token) => s.playerIdOf(token);
const locationOf = async (token, chickenId) => (await s.farm(token)).chickens.find((c) => c.id === chickenId).location;

test("tìm hạt khi gà còn trong chuồng → not_in_field; chưa từng xem → not_watching", async () => {
  const { token, chickenId } = await s.hatched();
  const nw = await s.act(token, "fieldFind", { chickenId });
  assert.equal(nw.status, 409);
  assert.equal(nw.body.code, "not_watching");
  await watch(token);
  const r = await s.act(token, "fieldFind", { chickenId });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "not_in_field");
});

test("tìm hạt: loại hạt do server tung (client gửi seed bị bỏ qua), cooldown 15 s của luật → too_fast", async () => {
  const { token, chickenId } = await s.hatched();
  const rel = await s.act(token, "release", { chickenId }); // thả = một nhịp tim
  assert.equal(rel.status, 200);
  const a = await s.act(token, "fieldFind", { chickenId, seed: "premium" });
  assert.equal(a.status, 200);
  assert.ok(Object.hasOwn(R.SEEDS, a.body.result.seed));
  assert.ok(["ate", "stored"].includes(a.body.result.action));
  const row = s.app.store.db.prepare("SELECT args, rolled FROM actions WHERE player_id = ? AND type = 'fieldFind'").get(pidOf(token));
  assert.deepEqual(JSON.parse(row.args), { chickenId }); // không có "seed" của client
  assert.equal(JSON.parse(row.rolled).kind, a.body.result.seed);

  const fast = await s.act(token, "fieldFind", { chickenId });
  assert.equal(fast.status, 409);
  assert.equal(fast.body.code, "too_fast");
  s.clock.t += 10_000;
  await watch(token);
  assert.equal((await s.act(token, "fieldFind", { chickenId })).body.code, "too_fast");
  s.clock.t += 5_000;
  assert.equal((await s.act(token, "fieldFind", { chickenId })).status, 200);
});

test("loại hạt tung bằng HMAC: phân bố gần bảng rơi ngoài đồng (chủ yếu hạt thường)", async () => {
  const { rollFor } = await import("../src/actions.mjs");
  const n = 4000;
  let common = 0;
  for (let i = 0; i < n; i++) if (rollFor("fieldFind", "k", "p_x", i).kind === "common") common++;
  const w = R.CONFIG.drops.field;
  const expected = w.common / Object.values(w).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(common / n - expected) < 0.03, `${common / n} ≉ ${expected}`);
  // khác bí mật → khác kết quả
  const seq = (k) => Array.from({ length: 50 }, (_, i) => rollFor("openBag", k, "p_x", i).seed).join();
  assert.notEqual(seq("k1"), seq("k2"));
});

test("nhịp tim đều mỗi 10 s giữ gà ngoài đồng; ngừng 20 s → tìm hạt bị từ chối và gà về chuồng", async () => {
  const { token, chickenId } = await s.hatched();
  await s.act(token, "release", { chickenId });
  const releasedAt = s.clock.t;
  for (let i = 0; i < 6; i++) {
    s.clock.t += 10_000;
    const w = await watch(token);
    assert.equal(w.body.watching, true);
    assert.deepEqual(w.body.inField, [chickenId]);
    assert.equal(w.body.watchUntil, s.clock.t + 20_000);
  }
  assert.equal(await locationOf(token, chickenId), "field");
  assert.equal((await s.act(token, "fieldFind", { chickenId })).status, 200);

  const lastBeat = s.clock.t;
  s.clock.t += 21_000; // mất kết nối: không có nhịp tim
  const r = await s.act(token, "fieldFind", { chickenId });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "not_watching");
  assert.equal(await locationOf(token, chickenId), "coop");
  const sys = s.app.store.db.prepare("SELECT * FROM actions WHERE player_id = ? AND source = 'system'").all(pidOf(token));
  assert.equal(sys.length, 1);
  assert.equal(sys[0].type, "recallAll");
  assert.equal(sys[0].now, lastBeat + 20_000); // gọi về đúng lúc phiên hết hạn
  assert.ok(releasedAt < sys[0].now);
});

test("quét định kỳ: không ai gọi API nữa → sweep() tự gọi gà về; nhịp tim muộn không cứu được", async () => {
  const a = await s.hatched();
  await s.act(a.token, "release", { chickenId: a.chickenId });
  const b = await s.hatched();
  await s.act(b.token, "release", { chickenId: b.chickenId });
  s.clock.t += 25_000;
  await watch(b.token); // b gửi nhịp tim muộn: gà đã phải về trước, phiên mới không có gà
  const recalls = s.app.metrics.counters.systemRecalls;
  s.app.sweep();
  assert.ok(s.app.metrics.counters.systemRecalls > recalls); // a bị gọi về bởi sweep (b đã về lúc watch)
  const row = s.app.store.db.prepare("SELECT state FROM farms WHERE player_id = ?").get(pidOf(a.token));
  assert.equal(JSON.parse(row.state).chickens[0].location, "coop");
  assert.equal(await locationOf(b.token, b.chickenId), "coop");
  const m = await fetch(`${s.adminBase}/metrics`).then((r) => r.json());
  assert.equal(typeof m.activeWatchers, "number");
});

test("khởi động lại server: trại còn gà ngoài đồng → recallStale() gọi về", async () => {
  const { token, chickenId } = await s.hatched();
  await s.act(token, "release", { chickenId });
  s.app.presence.clear(pidOf(token)); // giả lập mất bộ nhớ phiên xem (tiến trình mới)
  s.app.farms.evict(pidOf(token));
  s.app.farms.recallStale();
  const row = s.app.store.db.prepare("SELECT state FROM farms WHERE player_id = ?").get(pidOf(token));
  assert.equal(JSON.parse(row.state).chickens[0].location, "coop");
});

test("mỗi lần chỉ thả 1 con ra đồng → field_busy", async () => {
  const { token, chickenId } = await s.hatched();
  // Thêm con thứ hai: một quả trứng nở ngay (chỉ trong test; trại này không replay được).
  s.injectEgg(token, { id: "e-test", code: R.starterEggs(7)[0].code, hatchAt: s.clock.t });
  s.clock.t += 1000;
  const farm = await s.farm(token);
  assert.equal(farm.chickens.length, 2);
  const other = farm.chickens.find((c) => c.id !== chickenId).id;

  assert.equal((await s.act(token, "release", { chickenId })).status, 200);
  const busy = await s.act(token, "release", { chickenId: other });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, "field_busy");
  // gọi con đầu về thì thả con kia được
  assert.equal((await s.act(token, "recall", { chickenId })).status, 200);
  assert.equal((await s.act(token, "release", { chickenId: other })).status, 200);
  const view = await s.farm(token);
  assert.deepEqual(view.chickens.filter((c) => c.location === "field").map((c) => c.id), [other]);
});
