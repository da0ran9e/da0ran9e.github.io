// Server phục vụ luôn trang game (cùng origin với API) — và không để lộ file ngoài thư mục client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.mjs";

const root = mkdtempSync(join(tmpdir(), "trai-ga-static-"));
const client = join(root, "client");
mkdirSync(join(client, "js"), { recursive: true });
writeFileSync(join(client, "game.html"), "<!doctype html><title>Trại Gà</title>");
writeFileSync(join(client, "js", "a.js"), "export const a = 1;");
writeFileSync(join(client, "notes.md"), "không phục vụ đuôi lạ");
writeFileSync(join(root, "secret.js"), "export const leak = 1;"); // nằm NGOÀI thư mục client

const get = (base, path, method = "GET") => fetch(base + path, { method });

test("static: / → game.html, js đúng content-type, API vẫn chạy", async () => {
  const { base } = await startServer({ clientDir: client });
  let r = await get(base, "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.equal(r.headers.get("cache-control"), "no-cache");
  assert.match(await r.text(), /Trại Gà/);
  r = await get(base, "/js/a.js");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /javascript/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  r = await get(base, "/js/a.js", "HEAD");
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "");
  r = await get(base, "/api/hello");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test("static: chặn thoát thư mục, đuôi lạ, /api/ không rơi sang file", async () => {
  const { base } = await startServer({ clientDir: client });
  for (const p of ["/../secret.js", "/%2e%2e/secret.js", "/js/%2e%2e/%2e%2e/secret.js", "/js/..%5c..%5csecret.js", "/notes.md", "/nope.js", "/js", "/%00.js", "/%E0%A4%A.js"]) {
    const r = await get(base, p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(await r.text(), /leak/, p);
  }
  const r = await get(base, "/api/game.html");
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, "not_found");
});

test("static: tắt khi không có clientDir", async () => {
  const { base } = await startServer();
  assert.equal((await get(base, "/")).status, 404);
});
