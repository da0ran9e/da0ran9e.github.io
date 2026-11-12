// Test các bản vá kiểm toán bảo mật (server/SECURITY-AUDIT.md): rate limit không bị reset khi dọn,
// gộp IPv6 theo /64, chỉ tin CF-Connecting-IP hợp lệ, URL dị dạng → 400, CSP cho trang HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RateLimiter, ipBucket } from "../src/ratelimit.mjs";
import { startServer, MIN } from "./helpers.mjs";

test("rate limit: sweep() không xoá thùng chưa nạp đầy (giới hạn 20 khách/ngày không bị reset sau 10 phút)", () => {
  const clock = { t: 0 };
  const rl = new RateLimiter(() => clock.t);
  const day = { cap: 20, perSec: 20 / 86400 };
  for (let i = 0; i < 20; i++) assert.equal(rl.take("igd:x", day).ok, true);
  assert.equal(rl.take("igd:x", day).ok, false);
  clock.t += 11 * MIN;
  rl.sweep();
  assert.equal(rl.size, 1, "thùng còn thiếu lượt phải được giữ lại");
  assert.equal(rl.take("igd:x", day).ok, false, "sau 11 phút mới nạp ~0.15 lượt");
  // thùng đã đầy lại thì dọn được (xoá = tạo lại đầy, không đổi hành vi)
  rl.take("ip:y", { cap: 60, perSec: 60 });
  clock.t += 2 * 86400_000;
  rl.sweep();
  assert.equal(rl.size, 0);
});

test("ipBucket: IPv4 giữ nguyên, IPv4-mapped bỏ tiền tố, IPv6 gộp theo /64", () => {
  assert.equal(ipBucket("203.0.113.7"), "203.0.113.7");
  assert.equal(ipBucket("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(ipBucket("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
  assert.equal(ipBucket("2001:DB8:0001:0002::9"), "2001:db8:1:2::/64");
  assert.equal(ipBucket("2001:db8::1"), "2001:db8:0:0::/64");
  assert.notEqual(ipBucket("2001:db8:1:3::1"), ipBucket("2001:db8:1:2::1"));
});

test("tạo khách: đổi địa chỉ trong cùng IPv6 /64 không lách được giới hạn; header IP rác bị bỏ qua", async () => {
  const s = await startServer({ limits: { ipGuest: { cap: 2, perSec: 1e-9 } } });
  const guest = (ip) => s.api("POST", "/api/guest", { body: {}, headers: ip ? { "cf-connecting-ip": ip } : {} });
  assert.equal((await guest("2001:db8:aa:1::1")).status, 200);
  assert.equal((await guest("2001:db8:aa:1::2")).status, 200);
  const r = await guest("2001:db8:aa:1:ffff:1:2:3");
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
  assert.equal((await guest("2001:db8:aa:2::1")).status, 200, "/64 khác là người khác");
  // CF-Connecting-IP không phải IP → dùng địa chỉ socket (127.0.0.1), không tạo thùng mới theo chuỗi rác
  assert.equal((await guest("not-an-ip-1")).status, 200);
  assert.equal((await guest("not-an-ip-2")).status, 200);
  assert.equal((await guest("not-an-ip-3")).status, 429);
});

test("dòng yêu cầu có URL dị dạng → 400 JSON, không ghi lỗi 'handler_crash' vào log", async () => {
  const logs = [];
  const s = await startServer({ log: (level, d) => logs.push({ level, ...d }) });
  const port = new URL(s.base).port;
  const raw = await new Promise((resolve) => {
    const c = net.connect(port, "127.0.0.1", () => c.write("GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
    let d = "";
    c.on("data", (x) => (d += x));
    c.on("close", () => resolve(d));
    c.on("error", () => resolve(d));
  });
  assert.match(raw, /^HTTP\/1\.1 400/);
  assert.match(raw, /"code":"bad_request"/);
  assert.equal(logs.filter((l) => l.level === "error").length, 0);
});

test("trang HTML có CSP (script chỉ 'self' + băm importmap), chống nhúng iframe; JS không gắn CSP", async () => {
  const client = mkdtempSync(join(tmpdir(), "trai-ga-csp-"));
  writeFileSync(join(client, "game.html"), '<!doctype html><script type="module" src="js/x.js"></script>');
  const map = '{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js" } }';
  writeFileSync(join(client, "index.html"), `<!doctype html><script type="importmap">${map}</script>`);
  writeFileSync(join(client, "a.js"), "export {}");
  const { base } = await startServer({ clientDir: client });

  let r = await fetch(base + "/");
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers.get("x-frame-options"), "DENY");

  r = await fetch(base + "/index.html");
  const hash = createHash("sha256").update(map).digest("base64");
  assert.match(r.headers.get("content-security-policy"), new RegExp(`script-src 'self' 'sha256-${hash.replace(/[+/]/g, "\\$&")}' https://cdn\\.jsdelivr\\.net;`));

  r = await fetch(base + "/a.js");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-security-policy"), null);
});
