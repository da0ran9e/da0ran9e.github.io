// Test tầng HTTP: khách, xác thực, CORS, giới hạn thân, rate limit, healthz, cổng quản trị.
// Chạy: node --test server/test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.mjs";

const s = await startServer();

test("POST /api/guest tạo khách: token 43 ký tự, playerId công khai, DB chỉ lưu băm", async () => {
  const r = await s.api("POST", "/api/guest", { body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.token.length, 43);
  assert.match(r.body.playerId, /^p_[A-Za-z0-9_-]{12}$/);
  const row = s.app.store.db.prepare("SELECT token_hash FROM players WHERE id = ?").get(r.body.playerId);
  assert.equal(row.token_hash.length, 32); // sha256
  assert.notEqual(Buffer.from(row.token_hash).toString("base64url"), r.body.token);
  // thân rỗng cũng được
  assert.equal((await s.api("POST", "/api/guest")).status, 200);
});

test("thiếu / sai token → 401 unauthorized", async () => {
  assert.equal((await s.api("GET", "/api/farm")).body.code, "unauthorized");
  const r = await s.api("GET", "/api/farm", { token: "x".repeat(43) });
  assert.equal(r.status, 401);
});

test("khách chưa có trại: GET /api/farm → 404 no_farm; starters trả 3 trứng, không lộ seed", async () => {
  const token = await s.guest();
  const r = await s.api("GET", "/api/farm", { token });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, "no_farm");
  const st = await s.api("GET", "/api/starters", { token });
  assert.equal(st.status, 200);
  assert.equal(st.body.choices.length, 3);
  assert.ok(st.body.choices.every((c) => typeof c.code === "string" && c.shell));
  assert.equal(JSON.stringify(st.body).includes('"seed"'), false);
});

test("route lạ → 404, sai phương thức → 405", async () => {
  assert.equal((await s.api("GET", "/api/nope")).status, 404);
  assert.equal((await s.api("GET", "/api/farm/feed")).status, 405);
});

test("CORS: preflight cho origin được phép, 403 cho origin lạ; localhost mọi cổng", async () => {
  const pre = (origin) =>
    fetch(`${s.base}/api/farm/feed`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" } });
  for (const origin of ["https://vuducan.qzz.io", "https://da0ran9e.github.io", "http://localhost:5173", "http://localhost:3000"]) {
    const r = await pre(origin);
    assert.equal(r.status, 204, origin);
    assert.equal(r.headers.get("access-control-allow-origin"), origin);
    assert.match(r.headers.get("access-control-allow-headers"), /authorization/);
    assert.match(r.headers.get("access-control-allow-methods"), /POST/);
    assert.equal(r.headers.get("access-control-max-age"), "86400");
  }
  for (const origin of ["https://evil.example", "http://localhost.evil.example:80", "https://vuducan.qzz.io.evil.example"]) {
    const r = await pre(origin);
    assert.equal(r.status, 403, origin);
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  }
  // request thường: origin lạ không nhận ACAO (trình duyệt sẽ chặn đọc)
  const bad = await s.api("GET", "/api/hello", { headers: { origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
  const good = await s.api("GET", "/api/hello", { headers: { origin: "https://vuducan.qzz.io" } });
  assert.equal(good.headers.get("access-control-allow-origin"), "https://vuducan.qzz.io");
  assert.equal(good.headers.get("vary"), "Origin");
});

test("ALLOWED_ORIGINS cấu hình được", async () => {
  const s2 = await startServer({ allowedOrigins: ["https://only.example"] });
  const r = await fetch(`${s2.base}/api/guest`, { method: "OPTIONS", headers: { origin: "https://vuducan.qzz.io", "access-control-request-method": "POST" } });
  assert.equal(r.status, 403);
  const ok = await fetch(`${s2.base}/api/guest`, { method: "OPTIONS", headers: { origin: "https://only.example", "access-control-request-method": "POST" } });
  assert.equal(ok.status, 204);
});

test("thân yêu cầu: > 4 KB → 413, không phải JSON → 415, JSON hỏng → 400", async () => {
  const { token } = await s.player();
  const big = await s.api("POST", "/api/farm/recallAll", { token, raw: JSON.stringify({ aid: "x1", pad: "x".repeat(5000) }), headers: { "content-type": "application/json" } });
  assert.equal(big.status, 413);
  const text = await s.api("POST", "/api/farm/recallAll", { token, raw: "aid=x2", headers: { "content-type": "text/plain" } });
  assert.equal(text.status, 415);
  const broken = await s.api("POST", "/api/farm/recallAll", { token, raw: "{aid:", headers: { "content-type": "application/json" } });
  assert.equal(broken.status, 400);
  const arr = await s.api("POST", "/api/farm/recallAll", { token, body: [1] });
  assert.equal(arr.status, 400);
});

test("rate limit theo token: bucket 3, hết → 429 + Retry-After; tua đồng hồ thì nạp lại", async () => {
  const s3 = await startServer({ limits: { tokenPost: { cap: 3, perSec: 1 } } });
  const { token } = await s3.player(); // farm/new dùng 1 lượt
  assert.equal((await s3.act(token, "recallAll")).status, 200);
  assert.equal((await s3.act(token, "recallAll")).status, 200);
  const r = await s3.act(token, "recallAll");
  assert.equal(r.status, 429);
  assert.equal(r.body.code, "rate_limited");
  assert.equal(r.headers.get("retry-after"), "1");
  s3.clock.t += 1000;
  assert.equal((await s3.act(token, "recallAll")).status, 200);
});

test("rate limit theo IP cho POST /api/guest (5/giờ), tách theo CF-Connecting-IP", async () => {
  const s4 = await startServer({ limits: { ipGuest: { cap: 5, perSec: 5 / 3600 } } });
  const hdr = { "cf-connecting-ip": "203.0.113.7" };
  for (let i = 0; i < 5; i++) assert.equal((await s4.api("POST", "/api/guest", { headers: hdr })).status, 200);
  const r = await s4.api("POST", "/api/guest", { headers: hdr });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("retry-after")) > 600);
  // IP khác vẫn tạo được
  assert.equal((await s4.api("POST", "/api/guest", { headers: { "cf-connecting-ip": "203.0.113.8" } })).status, 200);
});

test("rate limit theo IP cho mọi request (60/s mặc định)", async () => {
  const s5 = await startServer({ limits: { ipAll: { cap: 60, perSec: 60 } } });
  const codes = [];
  for (let i = 0; i < 61; i++) codes.push((await s5.api("GET", "/api/hello")).status);
  assert.equal(codes.filter((c) => c === 200).length, 60);
  assert.equal(codes.at(-1), 429);
});

test("healthz công khai + cổng quản trị: healthz và metrics JSON (p50/p99 theo route, watchers)", async () => {
  const h = await s.api("GET", "/healthz");
  assert.equal(h.status, 200);
  assert.equal(h.body.db, "ok");
  const ah = await fetch(`${s.adminBase}/healthz`).then((r) => r.json());
  assert.equal(ah.ok, true);
  const m = await fetch(`${s.adminBase}/metrics`).then((r) => r.json());
  assert.ok(m.requests > 0);
  assert.equal(typeof m.activeWatchers, "number");
  const route = m.routes["POST /api/guest"];
  assert.ok(route.count > 0);
  assert.ok(route.ms.p50 > 0 && route.ms.p99 >= route.ms.p50);
  // cổng quản trị chỉ nghe trên loopback
  assert.equal(s.app.admin.address().address, "127.0.0.1");
});
