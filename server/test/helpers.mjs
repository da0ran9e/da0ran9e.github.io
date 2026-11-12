// Tiện ích cho test server: khởi động server trên cổng ngẫu nhiên với DB tạm và đồng hồ tua được.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { createApp } from "../src/app.mjs";
import { sha256 } from "../src/actions.mjs";

export const T0 = Date.UTC(2026, 10, 10, 8, 0, 0);
export const MIN = 60_000;

// Giới hạn rộng cho test thường (đồng hồ đứng yên → bucket không tự nạp).
export const LOOSE = {
  ipAll: { cap: 1e6, perSec: 1e6 },
  ipGuest: { cap: 1e6, perSec: 1e6 },
  ipGuestDay: { cap: 1e6, perSec: 1e6 },
  tokenPost: { cap: 1e6, perSec: 1e6 },
  tokenGet: { cap: 1e6, perSec: 1e6 },
};

export async function startServer({ limits = {}, ...opts } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "trai-ga-test-"));
  const dbPath = join(dir, "farm.db");
  const clock = { t: T0 };
  const app = createApp({ dbPath, secret: "test-secret", clock: () => clock.t, log: process.env.TLOG ? (l, d) => console.error(l, JSON.stringify(d)) : false, limits: { ...LOOSE, ...limits }, sweepEveryMs: 0, ...opts });
  const { port, adminPort } = await app.listen({ port: 0, adminPort: 0 });
  const base = `http://127.0.0.1:${port}`;
  let n = 0;
  const ctx = {
    tampered: new Set(), // trại bị sửa tay trong DB (injectEgg / patchState) → không phát lại được
    app,
    clock,
    dbPath,
    base,
    adminBase: `http://127.0.0.1:${adminPort}`,
    aid: () => `aid-${++n}`,
    // Gọi API, trả về { status, headers, body }
    async api(method, path, { token, body, headers = {}, raw } = {}) {
      const h = { ...headers };
      if (token) h.authorization = `Bearer ${token}`;
      let payload;
      if (raw !== undefined) payload = raw;
      else if (body !== undefined) {
        payload = JSON.stringify(body);
        h["content-type"] ??= "application/json";
      }
      const res = await fetch(base + path, { method, headers: h, body: payload });
      const text = await res.text();
      return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
    },
    async guest() {
      const r = await ctx.api("POST", "/api/guest", { body: {} });
      if (r.status !== 200) throw new Error(`guest ${r.status}`);
      return r.body.token;
    },
    // Hành động trại: POST /api/farm/<type> với aid mới
    act(token, type, body = {}) {
      return ctx.api("POST", `/api/farm/${type}`, { token, body: { aid: ctx.aid(), ...body } });
    },
    async farm(token) {
      const r = await ctx.api("GET", "/api/farm", { token });
      return r.body.farm;
    },
    // Khách mới + trại mới
    async player(choice = 0) {
      const token = await ctx.guest();
      const r = await ctx.api("POST", "/api/farm/new", { token, body: { aid: ctx.aid(), choice } });
      if (r.status !== 200) throw new Error(`farm/new ${r.status} ${JSON.stringify(r.body)}`);
      return { token, farm: r.body.farm };
    },
    // Khách mới, ấp trứng khởi đầu, tua tới lúc nở → trả về id con gà
    async hatched() {
      const p = await ctx.player();
      const r = await ctx.act(p.token, "incubate", { eggId: p.farm.eggs[0].id });
      if (r.status !== 200) throw new Error(`incubate ${r.status}`);
      clock.t = Math.max(clock.t, Math.ceil(r.body.result.hatchAt + MIN));
      const farm = await ctx.farm(p.token);
      return { ...p, chickenId: farm.chickens[0].id, farm };
    },
    playerIdOf(token) {
      return ctx.app.farms.auth(token).id;
    },
    // CHỈ TRONG TEST: nhét một quả trứng thẳng vào ảnh chụp trong DB (bỏ qua nhật ký →
    // trại này không còn replay được). Dùng để có gà thứ hai / trứng ngoài sân mà không phải
    // chờ gà mái trưởng thành rồi đẻ.
    // Sửa thẳng trạng thái trại trong DB (dựng tình huống nhanh; trại này không còn phát lại được)
    patchState(token, fn) {
      const pid = ctx.playerIdOf(token);
      const row = app.store.db.prepare("SELECT state FROM farms WHERE player_id = ?").get(pid);
      const st = JSON.parse(row.state);
      fn(st);
      ctx.tampered.add(pid);
      const json = JSON.stringify(st);
      app.store.db.prepare("UPDATE farms SET state = ?, state_hash = ? WHERE player_id = ?").run(json, sha256(json), pid);
      app.farms.evict(pid);
    },
    injectEgg(token, egg) {
      const pid = ctx.playerIdOf(token);
      const row = app.store.db.prepare("SELECT state FROM farms WHERE player_id = ?").get(pid);
      const st = JSON.parse(row.state);
      ctx.tampered.add(pid);
      st.eggs.push({ shell: "#fff", shellName: "", fertile: true, motherId: null, fatherId: null, laidAt: clock.t, mutations: 0, hatchAt: null, ...egg });
      const json = JSON.stringify(st);
      app.store.db.prepare("UPDATE farms SET state = ?, state_hash = ? WHERE player_id = ?").run(json, sha256(json), pid);
      app.farms.evict(pid);
    },
  };
  after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return ctx;
}
