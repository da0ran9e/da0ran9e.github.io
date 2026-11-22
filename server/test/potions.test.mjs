// Luật v12 qua API: dùng thuốc (tham số sai bị chặn, thiếu thuốc bị từ chối), gieo tính cách sai bị chặn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.mjs";

const s = await startServer();

test("thuốc: tham số sai → 400; kho không có thuốc → no_potion", async () => {
  const p = await s.player();
  assert.equal((await s.act(p.token, "usePotion", { chickenId: "c1", potion: "nope" })).status, 400);
  assert.equal((await s.act(p.token, "usePotion", { potion: "full" })).status, 400);
  const r = await s.act(p.token, "usePotion", { chickenId: "c1", potion: "full" });
  assert.equal(r.body.code, "no_potion", JSON.stringify(r.body));
});

test("gieo tính cách: tính cách lạ → 400; hợp lệ thì tới luật (không có thầy soi trứng → no_visitor)", async () => {
  const p = await s.player();
  assert.equal((await s.act(p.token, "candle", { eggId: "e1", what: "mood", mood: "angry" })).status, 400);
  assert.equal((await s.act(p.token, "candle", { eggId: "e1", what: "mood" })).status, 400);
  const r = await s.act(p.token, "candle", { eggId: "e1", what: "mood", mood: "calm" });
  assert.ok(["no_visitor", "no_egg"].includes(r.body.code), JSON.stringify(r.body));
});
