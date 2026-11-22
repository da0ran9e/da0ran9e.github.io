// Luật v10 qua API: gieo, tưới, thu hoạch (số hạt được mùa do server tung, ghi nhật ký → phát lại khớp).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.mjs";
import { R } from "../src/actions.mjs";
import { replayFarm } from "../tools/replay.mjs";

const s = await startServer();

test("vườn: gieo → tưới → chín → thu hoạch; tham số sai bị chặn; phát lại khớp", async () => {
  const p = await s.player();
  assert.equal((await s.act(p.token, "plant", { plot: 9, seed: "rice" })).status, 400);
  assert.equal((await s.act(p.token, "plant", { plot: 0, seed: "nope" })).status, 400);
  const pl = await s.act(p.token, "plant", { plot: 0, seed: "rice" });
  assert.equal(pl.status, 200, JSON.stringify(pl.body));
  assert.equal(pl.body.farm.garden[0].seed, "rice");
  s.clock.t += 1000;
  const w = await s.act(p.token, "waterPlot", { plot: 0 });
  assert.equal(w.status, 200);
  assert.ok(w.body.result.readyAt < pl.body.result.readyAt);
  assert.equal((await s.act(p.token, "harvest", { plot: 0 })).body.code, "not_ready");
  s.clock.t = w.body.result.readyAt + 1000;
  const h = await s.act(p.token, "harvest", { plot: 0 });
  assert.equal(h.status, 200, JSON.stringify(h.body));
  assert.ok(h.body.result.n >= R.CONFIG.garden.yield);
  assert.equal(h.body.farm.garden[0], null);
  const rp = replayFarm(s.app.store.db, s.playerIdOf(p.token));
  assert.equal(rp.ok, true, JSON.stringify(rp));
});
