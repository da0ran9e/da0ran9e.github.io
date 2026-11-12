// Test API trại: tạo trại, vòng chơi trọn (ấp → nở bằng cách tua đồng hồ), lỗi cho ăn,
// đổi ở cửa hàng + mở túi, đổi gà lấy trứng, idempotency (aid), replay = ảnh chụp.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { startServer, MIN } from "./helpers.mjs";
import { R } from "../src/actions.mjs";
import { replayAll, replayFarm } from "../tools/replay.mjs";

const s = await startServer();
const actionsOf = (token) => s.app.store.db.prepare("SELECT * FROM actions WHERE player_id = ? ORDER BY seq").all(s.playerIdOf(token));
let yardToken = null; // trại bị sửa tay trong test collectEgg
const rejectsOf = (token) => s.app.store.db.prepare("SELECT * FROM rejects WHERE player_id = ?").all(s.playerIdOf(token));

test("POST /api/farm/new: tạo trại từ trứng đã chọn, không lộ seed; tạo lần hai → farm_exists", async () => {
  const token = await s.guest();
  const st = await s.api("GET", "/api/starters", { token });
  const bad = await s.api("POST", "/api/farm/new", { token, body: { aid: s.aid(), choice: 1.5 } });
  assert.equal(bad.status, 400);
  assert.equal((await s.api("POST", "/api/farm/new", { token, body: { aid: s.aid(), choice: 3 } })).status, 400);
  assert.equal((await s.api("POST", "/api/farm/new", { token, body: { choice: 1 } })).status, 400); // thiếu aid
  const r = await s.api("POST", "/api/farm/new", { token, body: { aid: s.aid(), choice: 2 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 1);
  assert.equal(r.body.farm.eggs[0].code, st.body.choices[2].code);
  assert.equal("seed" in r.body.farm, false);
  assert.equal(r.body.now, s.clock.t); // giờ do server cấp
  const again = await s.api("POST", "/api/farm/new", { token, body: { aid: s.aid(), choice: 0 } });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "farm_exists");
  assert.equal((await s.api("GET", "/api/starters", { token })).body.code, "farm_exists");
  const log = actionsOf(token);
  assert.equal(log.length, 1);
  assert.equal(log[0].type, "newGame");
  assert.equal(typeof JSON.parse(log[0].rolled).seed, "number");
});

test("vòng chơi: ấp → tua đồng hồ → nở → cho ăn; GET không ghi; có trứng chờ / vắng > 1 giờ → ghi advance", async () => {
  const { token, farm } = await s.player();
  const eggId = farm.eggs[0].id;
  const inc = await s.act(token, "incubate", { eggId });
  assert.equal(inc.status, 200);
  const wait = inc.body.result.hatchAt - s.clock.t;
  assert.ok(wait >= 5 * MIN && wait <= 30 * MIN, `ấp ${wait / MIN} phút`);
  assert.equal(inc.body.farm.incubators[0], eggId);
  assert.equal((await s.act(token, "incubate", { eggId })).body.code, "already");

  // chưa tới giờ: chưa nở, GET không ghi gì
  s.clock.t = inc.body.result.hatchAt - 1000;
  let g = await s.api("GET", "/api/farm", { token });
  assert.equal(g.body.farm.chickens.length, 0);
  assert.equal(g.body.version, 2);

  // tua qua giờ nở (người chơi vắng từ lúc ấp): GET = người chơi quay lại → gà con nở NGAY LÚC NÀY (Q14)
  // và được ghi ("advance", nguồn view) để lần xem sau không nở lại
  s.clock.t = inc.body.result.hatchAt + 30 * MIN;
  g = await s.api("GET", "/api/farm", { token });
  assert.equal(g.body.farm.chickens.length, 1);
  assert.ok(g.body.events.some((e) => e.type === "hatched"));
  assert.equal(g.body.farm.chickens[0].hatchedAt, g.body.now);
  assert.ok(g.body.now - inc.body.result.hatchAt > 29 * MIN, "không nở đúng giờ lúc vắng");
  assert.equal(g.body.version, 3);
  assert.equal("seed" in g.body.farm, false);
  const chickenId = g.body.farm.chickens[0].id;
  g = await s.api("GET", "/api/farm", { token });
  assert.equal(g.body.version, 3);

  const fed = await s.act(token, "feed", { chickenId, seed: "common" });
  assert.equal(fed.status, 200);
  assert.equal(fed.body.version, 4);
  assert.equal(fed.body.farm.inventory.common, R.CONFIG.start.seeds.common - 1);

  // vắng 2 giờ: GET ghi một "advance"
  s.clock.t += 2 * 60 * MIN;
  g = await s.api("GET", "/api/farm", { token });
  assert.equal(g.body.version, 5);
  const log = actionsOf(token);
  assert.deepEqual(log.map((a) => a.type), ["newGame", "incubate", "advance", "feed", "advance"]);
  assert.equal(log[4].source, "view");
  assert.equal(log[4].aid, null);
  assert.ok(log.every((a) => a.code === "ok"));
});

test("Q14: hệ thống gọi gà về khi người chơi đã đi → trứng ấp xong vẫn chờ trong ổ", async () => {
  const { token, farm } = await s.player();
  const inc = await s.act(token, "incubate", { eggId: farm.eggs[0].id });
  const pid = s.playerIdOf(token);
  // người chơi không gửi gì nữa; hệ thống làm một việc (recallAll) sau giờ nở
  s.clock.t = inc.body.result.hatchAt + 10 * MIN;
  const entry = s.app.farms.load(pid);
  const draft = structuredClone(entry.state);
  const { applyAction } = await import("../src/actions.mjs");
  applyAction(draft, "recallAll", {}, null, s.clock.t, { present: false });
  assert.equal(draft.chickens.length, 0, "vắng mặt: chưa nở");
  assert.equal(draft.incubators[0], farm.eggs[0].id, "trứng vẫn chiếm ổ");
  applyAction(draft, "advance", {}, null, s.clock.t + (60 * MIN));
  assert.equal(draft.chickens.length, 1);
  assert.equal(draft.chickens[0].hatchedAt, s.clock.t + (60 * MIN), "nở lúc người chơi quay lại");
});

test("cho ăn: lỗi kiểu → 400, lỗi luật → 409 + ghi rejects; bị từ chối thì state không trôi", async () => {
  const { token, chickenId } = await s.hatched();
  for (const seed of ["gold", "__proto__", "toString", 3]) {
    const r = await s.act(token, "feed", { chickenId, seed });
    assert.equal(r.status, 400, String(seed));
    assert.equal(r.body.code, "bad_request");
  }
  assert.equal((await s.act(token, "feed", { chickenId: "C1!", seed: "common" })).status, 400);
  const before = s.app.farms.load(s.playerIdOf(token)).version;

  const noSeed = await s.act(token, "feed", { chickenId, seed: "protein" });
  assert.equal(noSeed.status, 409);
  assert.equal(noSeed.body.code, "no_seed");
  assert.equal(noSeed.body.version, before);
  assert.equal((await s.act(token, "feed", { chickenId: "c99", seed: "common" })).body.code, "no_chicken");

  // cho ăn tới no: đặt độ no gần đầy (theo CONFIG) rồi cho ăn vài hạt → "full"
  // một lần cho ăn thành công để ảnh chụp trong DB đã có gà (gà nở lúc server tính lười)
  assert.equal((await s.act(token, "feed", { chickenId, seed: "common" })).status, 200);
  s.patchState(token, (st) => { st.chickens.find((c) => c.id === chickenId).satiety = R.CONFIG.satietyMax - 30; });
  let r;
  for (let i = 0; i < 6; i++) {
    r = await s.act(token, "feed", { chickenId, seed: "common" });
    if (r.status !== 200) break;
  }
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "full");

  // ngoài đồng thì không cho ăn trong chuồng được
  assert.equal((await s.act(token, "release", { chickenId })).status, 200);
  assert.equal((await s.act(token, "feed", { chickenId, seed: "common" })).body.code, "in_field");

  const codes = rejectsOf(token).map((x) => x.code);
  assert.deepEqual(codes, ["no_seed", "no_chicken", "full", "in_field"]);
  // ảnh chụp trong DB khớp bản trong bộ nhớ (từ chối không ghi gì)
  const row = s.app.store.db.prepare("SELECT version FROM farms WHERE player_id = ?").get(s.playerIdOf(token));
  assert.equal(row.version, s.app.farms.load(s.playerIdOf(token)).version);
});

test("đổi trứng ở cửa hàng → túi hạt; mở túi do server tung (ghi rolled), mở lại → no_bag", async () => {
  const { token, farm } = await s.player();
  const t = await s.act(token, "tradeToShop", { eggs: [farm.eggs[0].id] });
  assert.equal(t.status, 200);
  const [bagId] = t.body.result.bags;
  assert.equal(t.body.farm.bags.length, 1);
  assert.equal(t.body.farm.eggs.length, 0);
  assert.equal((await s.act(token, "tradeToShop", { eggs: ["e77"] })).body.code, "no_egg");
  assert.equal((await s.act(token, "tradeToShop", {})).body.code, "nothing");
  assert.equal((await s.act(token, "tradeToShop", { eggs: "e1" })).status, 400);

  const o = await s.act(token, "openBag", { bagId });
  assert.equal(o.status, 200);
  const got = o.body.result.got;
  assert.equal(Object.values(got).reduce((a, b) => a + b, 0), R.CONFIG.trade.egg);
  assert.ok(Object.keys(got).every((k) => Object.hasOwn(R.SEEDS, k)));
  const total = Object.values(o.body.farm.inventory).reduce((a, b) => a + b, 0);
  assert.equal(total, R.CONFIG.start.seeds.common + R.CONFIG.trade.egg);
  assert.equal((await s.act(token, "openBag", { bagId })).body.code, "no_bag");

  const open = actionsOf(token).find((a) => a.type === "openBag");
  assert.equal(typeof JSON.parse(open.rolled).seed, "number");
  // mỗi lần tung dùng một giá trị bộ đếm mới (kể cả lần bị từ chối)
  assert.equal(s.app.farms.load(s.playerIdOf(token)).rolls, 2);
});

test("đổi gà trưởng thành lấy 2 trứng có phôi (tradeForEgg); gà non → not_adult; ngoài đồng → in_field", async () => {
  const { token, chickenId } = await s.hatched();
  assert.equal((await s.act(token, "release", { chickenId })).status, 200);
  assert.equal((await s.act(token, "tradeForEgg", { chickenId })).body.code, "in_field");
  assert.equal((await s.act(token, "recall", { chickenId })).status, 200);
  assert.equal((await s.act(token, "tradeForEgg", { chickenId })).body.code, "not_adult");
  s.patchState(token, (st) => { st.chickens.find((c) => c.id === chickenId).growth = 100; });
  const r = await s.act(token, "tradeForEgg", { chickenId });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.eggIds.length, R.CONFIG.trade.eggsPerChicken);
  const egg = r.body.farm.eggs.find((e) => e.id === r.body.result.eggId);
  assert.ok(egg);
  assert.equal(egg.fertile, true);
  assert.equal(egg.hatchAt, null);
  assert.equal(r.body.farm.chickens.length, 0);
  assert.equal((await s.act(token, "tradeForEgg", { chickenId })).body.code, "no_chicken");
  const row = actionsOf(token).find((a) => a.type === "tradeForEgg");
  assert.equal(typeof JSON.parse(row.rolled).seed, "number");
  // trứng mới ấp được
  assert.equal((await s.act(token, "incubate", { eggId: egg.id })).status, 200);
});

test("nhặt trứng ngoài sân (collectEgg): vào kho; nhặt lại / trứng trong kho → not_in_yard", async () => {
  const { token, farm } = await s.player();
  yardToken = token;
  // Trứng mới đẻ nằm ngoài sân (inYard). Đẻ thật cần gà mái trưởng thành + vài giờ → nhét thẳng.
  s.injectEgg(token, { id: "e-c9-yard", code: farm.eggs[0].code, fertile: false, inYard: true });
  const before = await s.farm(token);
  assert.equal(before.eggs.find((e) => e.id === "e-c9-yard").inYard, true);
  const r = await s.act(token, "collectEgg", { eggId: "e-c9-yard" });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.eggId, "e-c9-yard");
  assert.equal(r.body.farm.eggs.find((e) => e.id === "e-c9-yard").inYard, false);
  assert.equal((await s.act(token, "collectEgg", { eggId: "e-c9-yard" })).body.code, "not_in_yard");
  assert.equal((await s.act(token, "collectEgg", { eggId: farm.eggs[0].id })).body.code, "not_in_yard"); // trứng khởi đầu đã trong kho
  assert.equal((await s.act(token, "collectEgg", { eggId: "e404" })).body.code, "no_egg");
  assert.equal((await s.act(token, "collectEgg", { eggId: "E!" })).status, 400);
  // trứng ngoài sân ấp / đổi trực tiếp được
  s.injectEgg(token, { id: "e-c9-yard2", code: farm.eggs[0].code, inYard: true });
  const inc = await s.act(token, "incubate", { eggId: "e-c9-yard2" });
  assert.equal(inc.status, 200);
  assert.equal(inc.body.farm.eggs.find((e) => e.id === "e-c9-yard2").inYard, false);
});

test("idempotency: gửi lại cùng aid → trả phản hồi cũ, không áp lần hai; aid cũ + thân khác → 422", async () => {
  const { token, chickenId } = await s.hatched();
  const body = { aid: "retry-1", chickenId, seed: "common" };
  const a = await s.api("POST", "/api/farm/feed", { token, body });
  const b = await s.api("POST", "/api/farm/feed", { token, body });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.body.replayed, true);
  assert.equal(b.body.version, a.body.version);
  assert.deepEqual(b.body.farm, a.body.farm);
  const farm = await s.farm(token);
  assert.equal(farm.inventory.common, R.CONFIG.start.seeds.common - 1);
  assert.equal(actionsOf(token).filter((x) => x.aid === "retry-1").length, 1);

  const c = await s.api("POST", "/api/farm/feed", { token, body: { ...body, seed: "protein" } });
  assert.equal(c.status, 422);
  assert.equal(c.body.code, "idempotency_mismatch");
  const d = await s.api("POST", "/api/farm/recall", { token, body: { aid: "retry-1", chickenId } });
  assert.equal(d.status, 422);

  // hành động bị luật từ chối không giữ aid → dùng lại được
  const rej = await s.api("POST", "/api/farm/feed", { token, body: { aid: "retry-2", chickenId, seed: "protein" } });
  assert.equal(rej.body.code, "no_seed");
  const ok = await s.api("POST", "/api/farm/feed", { token, body: { aid: "retry-2", chickenId, seed: "common" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.replayed, undefined);
});

test("replay: dựng lại mọi trại từ nhật ký = ảnh chụp; sửa tay DB → phát hiện lệch", async () => {
  // thêm một trại có đủ loại hành động
  const { token, chickenId } = await s.hatched();
  await s.act(token, "feed", { chickenId, seed: "common" });
  await s.act(token, "release", { chickenId });
  await s.act(token, "fieldFind", { chickenId });
  s.clock.t += 16_000;
  await s.api("POST", "/api/field/watch", { token, body: {} });
  await s.act(token, "fieldFind", { chickenId });
  await s.act(token, "recallAll");
  s.clock.t += 3 * 60 * MIN;
  await s.farm(token);
  await s.act(token, "tradeToShop", { chickens: [chickenId] });
  const bags = (await s.farm(token)).bags;
  await s.act(token, "openBag", { bagId: bags[0].id });

  // trại bị sửa tay trong DB (injectEgg / patchState) thì phải LỆCH; mọi trại khác khớp
  const results = replayAll(s.app.store.db);
  assert.ok(results.length >= 8);
  assert.ok(s.tampered.size >= 1);
  for (const r of results) assert.equal(r.ok, !s.tampered.has(r.playerId), `${r.playerId}: ${r.error}`);

  // CLI trên file DB (kết nối riêng, chỉ đọc)
  const cli = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", fileURLToPath(new URL("../tools/replay.mjs", import.meta.url)), "--db", s.dbPath, s.playerIdOf(token)], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /1 trại, 0 lệch/);
  const all = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", fileURLToPath(new URL("../tools/replay.mjs", import.meta.url)), "--db", s.dbPath], { encoding: "utf8" });
  assert.equal(all.status, 1); // có trại bị sửa tay → mã thoát 1
  assert.match(all.stdout, new RegExp(` ${s.tampered.size} lệch`));

  // sửa tay ảnh chụp → lệch
  const pid = s.playerIdOf(token);
  const db = new DatabaseSync(s.dbPath);
  const row = db.prepare("SELECT state FROM farms WHERE player_id = ?").get(pid);
  const st = JSON.parse(row.state);
  st.inventory.premium += 50;
  const { sha256 } = await import("../src/actions.mjs");
  const json = JSON.stringify(st);
  db.prepare("UPDATE farms SET state = ?, state_hash = ? WHERE player_id = ?").run(json, sha256(json), pid);
  db.close();
  const bad = replayFarm(s.app.store.db, pid);
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "state khác ảnh chụp");
});
