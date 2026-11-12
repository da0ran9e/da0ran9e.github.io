// Trại Gà server — lắp ráp: HTTP công khai (API trò chơi) + HTTP quản trị (127.0.0.1).
// createApp() không tự nghe cổng và nhận đồng hồ từ ngoài → test chạy nhanh, tua được thời gian.
//
// Thứ tự xử lý một request: CORS → rate limit theo IP → route → xác thực token → rate limit theo
// token → đọc/kiểm tra thân JSON → FarmService (đồng bộ: đọc → luật → ghi).

import http from "node:http";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { R } from "./actions.mjs";
import { DEFAULTS, DEFAULT_LIMITS, DEFAULT_ORIGINS } from "./config.mjs";
import { FarmService } from "./farm-service.mjs";
import { HttpError, PREFLIGHT, corsHeaders, makeOriginCheck, readJson, sendJson } from "./http-util.mjs";
import { Metrics } from "./metrics.mjs";
import { Presence } from "./presence.mjs";
import { RateLimiter, ipBucket } from "./ratelimit.mjs";
import { Store, openDb } from "./store.mjs";
import * as V from "./validate.mjs";
import { createStatic } from "./static.mjs";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const FARM_ACTIONS = Object.keys(V.ARGS); // incubate, feed, release, … (tên trùng hàm luật)

// Logger mặc định: JSON mỗi dòng ra stdout. Không bao giờ ghi token, thân yêu cầu, IP.
const stdoutLog = (level, data) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, ...data }) + "\n");

export function createApp(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  // Đồng hồ server: ms nguyên (cột INTEGER của SQLite là STRICT). Test truyền đồng hồ tua được.
  const rawClock = options.clock ?? Date.now;
  const clock = () => Math.floor(rawClock());
  const log = options.log === false ? () => {} : (options.log ?? stdoutLog);
  if (!options.secret) throw new Error("Thiếu secret (SERVER_SECRET)");

  const db = openDb(options.dbPath ?? ":memory:");
  const store = new Store(db);
  const metrics = new Metrics();
  const presence = new Presence(cfg.watchTimeoutMs);
  const limiter = new RateLimiter(clock);
  const farms = new FarmService({ store, presence, clock, secret: options.secret, metrics, cfg, log });
  const originOk = makeOriginCheck(options.allowedOrigins ?? DEFAULT_ORIGINS);
  // trang game cùng origin (tuỳ chọn): GET / → game.html
  const serveStatic = options.clientDir ? createStatic(options.clientDir) : null;

  /* ---------- bảng route ---------- */

  // auth: cần token; limit: tên bucket theo token; body: có đọc thân JSON
  const routes = new Map();
  const route = (method, path, opts, fn) => routes.set(`${method} ${path}`, { ...opts, fn });

  route("GET", "/healthz", {}, () => ({ status: 200, body: health() }));
  route("GET", "/api/hello", {}, () => ({ status: 200, body: { ok: true, game: "trai-ga", now: clock(), rulesVersion: R.CONFIG.version, proto: 1 } }));
  route("POST", "/api/guest", { body: true, guest: true }, () => ({ status: 200, body: { ok: true, ...farms.createGuest() } }));
  route("GET", "/api/starters", { auth: true, limit: "tokenGet" }, ({ player }) => ({ status: 200, body: farms.starters(player) }));
  route("POST", "/api/farm/new", { auth: true, limit: "tokenPost", body: true }, ({ player, body }) => farms.newFarm(player, V.aid(body), V.choice(body)));
  route("GET", "/api/farm", { auth: true, limit: "tokenGet" }, ({ player }) => farms.getFarm(player));
  route("POST", "/api/field/watch", { auth: true, limit: "tokenPost", body: true }, ({ player }) => farms.watch(player));
  for (const type of FARM_ACTIONS) {
    route("POST", `/api/farm/${type}`, { auth: true, limit: "tokenPost", body: true }, ({ player, body }) => {
      const aid = V.aid(body);
      return farms.perform(player, type, V.ARGS[type](body), aid);
    });
  }

  function health() {
    let dbOk = "ok";
    try {
      db.prepare("SELECT 1").get();
    } catch {
      dbOk = "error";
    }
    return { ok: dbOk === "ok", uptime: Math.round(process.uptime()), db: dbOk, rulesVersion: R.CONFIG.version, watchers: presence.active(clock()) };
  }

  /* ---------- xử lý request công khai ---------- */

  function clientIp(req) {
    const remote = req.socket.remoteAddress ?? "";
    // Chỉ tin CF-Connecting-IP khi request tới từ máy này (cloudflared chạy cùng máy) VÀ là một IP
    // hợp lệ. Nếu đổi HOST sang 0.0.0.0, request từ mạng ngoài không phải loopback → header bị bỏ qua.
    const cf = typeof req.headers["cf-connecting-ip"] === "string" ? req.headers["cf-connecting-ip"].trim() : "";
    return ipBucket(LOOPBACK.has(remote) && isIP(cf) ? cf : remote);
  }

  function limit(key, name) {
    const r = limiter.take(key, limits[name]);
    if (!r.ok) throw new HttpError(429, "rate_limited", "Gửi quá nhanh, thử lại sau", { retryAfterMs: r.retryAfterMs });
  }

  async function handle(req, res) {
    const t0 = performance.now();
    let url = null;
    try {
      url = new URL(req.url ?? "/", "http://x");
    } catch {} // dòng yêu cầu dị dạng (vd. "GET http://[") → 400 bên dưới, không ghi stack vào log
    const key = url ? `${req.method} ${url.pathname}` : "";
    const spec = routes.get(key);
    let routeName = spec ? key : req.method === "OPTIONS" ? "OPTIONS" : "other";
    const origin = req.headers.origin;
    const allowed = originOk(origin);
    const cors = corsHeaders(origin, allowed);
    let status = 500, code = "ok", player = null;
    try {
      if (!url) throw new HttpError(400, "bad_request", "URL không hợp lệ");
      if (req.method === "OPTIONS") {
        // Preflight: chỉ trả lời origin trong danh sách; còn lại 403 (trình duyệt sẽ chặn).
        status = allowed ? 204 : 403;
        res.writeHead(status, allowed ? { ...cors, ...PREFLIGHT } : {});
        res.end();
        return;
      }
      const ip = clientIp(req);
      limit(`ip:${ip}`, "ipAll");
      if (!spec && serveStatic && (req.method === "GET" || req.method === "HEAD") && !url.pathname.startsWith("/api/")) {
        if (await serveStatic(req, res, url.pathname)) {
          status = 200;
          code = "static";
          routeName = "static";
          return;
        }
      }
      if (!spec) {
        const samePath = [...routes.keys()].some((k) => k.endsWith(` ${url.pathname}`));
        throw samePath ? new HttpError(405, "method_not_allowed", "Sai phương thức") : new HttpError(404, "not_found", "Không có đường dẫn này");
      }
      if (spec.guest) {
        limit(`ig:${ip}`, "ipGuest");
        limit(`igd:${ip}`, "ipGuestDay");
      }
      if (spec.auth) {
        const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
        player = m && farms.auth(m[1]);
        if (!player) throw new HttpError(401, "unauthorized", "Thiếu hoặc sai token");
        limit(`${spec.limit}:${player.id}`, spec.limit);
      }
      const body = spec.body ? await readJson(req, cfg.bodyLimit) : null;
      const out = spec.fn({ req, url, player, body });
      status = out.status;
      code = out.body.ok === false ? out.body.code : "ok";
      sendJson(res, status, out.body, cors);
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, "internal", "Lỗi server");
      if (!(e instanceof HttpError)) {
        metrics.counters.internalErrors++;
        log("error", { msg: "unhandled", route: routeName, err: String(e?.stack ?? e) });
      }
      status = err.status;
      code = err.code;
      const headers = { ...cors };
      if (err.extra.retryAfterMs != null) headers["Retry-After"] = String(Math.max(1, Math.ceil(err.extra.retryAfterMs / 1000)));
      if (status === 413) headers.Connection = "close"; // không đọc tiếp phần thân còn lại
      if (!res.headersSent) sendJson(res, status, { ok: false, code: err.code, message: err.message, now: clock() }, headers);
      else res.destroy();
    } finally {
      const ms = performance.now() - t0;
      metrics.observe(routeName, status, ms);
      log(status >= 500 ? "error" : "info", { route: routeName, player: player ? createHash("sha256").update(player.id).digest("hex").slice(0, 8) : undefined, ms: Math.round(ms * 100) / 100, status, code });
    }
  }

  const server = http.createServer({ requestTimeout: 10_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 }, (req, res) => {
    handle(req, res).catch((e) => {
      log("error", { msg: "handler_crash", err: String(e?.stack ?? e) });
      res.destroy();
    });
  });

  /* ---------- cổng quản trị (chỉ 127.0.0.1, không qua tunnel) ---------- */

  const admin = http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (req.method === "GET" && path === "/healthz") return sendJson(res, 200, health());
    if (req.method === "GET" && path === "/metrics") {
      return sendJson(res, 200, metrics.snapshot({ activeWatchers: presence.active(clock()), cachedFarms: farms.cache.size, rateBuckets: limiter.size }));
    }
    sendJson(res, 404, { ok: false, code: "not_found" });
  });

  /* ---------- việc định kỳ ---------- */

  let lastPurge = 0;
  function sweep() {
    farms.sweep();
    limiter.sweep();
    const now = clock();
    if (now - lastPurge > 3600_000) {
      lastPurge = now;
      store.q.purgeResponses.run(now - cfg.responseKeepMs);
      store.q.purgeRejects.run(now - cfg.rejectKeepMs);
    }
  }

  let timer = null;
  function start() {
    farms.recallStale();
    if (cfg.sweepEveryMs > 0 && !timer) {
      timer = setInterval(() => {
        try {
          sweep();
        } catch (e) {
          log("error", { msg: "sweep_failed", err: String(e?.stack ?? e) });
        }
      }, cfg.sweepEveryMs);
      timer.unref();
    }
  }

  const listen = (srv, port, host) =>
    new Promise((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(port, host, () => {
        srv.off("error", reject);
        resolve(srv.address().port);
      });
    });

  async function close() {
    if (timer) clearInterval(timer);
    timer = null;
    farms.recallEveryone(); // tắt server = mọi người rời đi → gà về chuồng
    await Promise.all([server, admin].map((s) => (s.listening ? new Promise((r) => { s.close(r); s.closeAllConnections?.(); }) : null)));
    metrics.close();
    store.close();
  }

  return {
    server,
    admin,
    farms,
    store,
    presence,
    metrics,
    sweep,
    start,
    close,
    // Nghe cổng công khai + cổng quản trị. Trả về số cổng thực (truyền 0 → cổng ngẫu nhiên).
    async listen({ port = 8787, adminPort = 8788, host = "127.0.0.1" } = {}) {
      start();
      const p = await listen(server, port, host);
      const a = adminPort === null ? null : await listen(admin, adminPort, "127.0.0.1");
      return { port: p, adminPort: a };
    },
  };
}
