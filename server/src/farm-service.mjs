// Trại Gà server — dịch vụ trại: danh tính khách, áp hành động, nhật ký, phiên xem.
//
// Quy tắc vàng (server-design.md §0):
//   - server cấp `now`; client không bao giờ gửi giờ;
//   - mỗi hành động chạy trên structuredClone(state); chỉ khi luật trả ok mới ghi và thay bản cũ;
//   - mọi thay đổi state có đúng một dòng `actions` (cùng now + giá trị server tung) → replay được;
//   - từ "đọc" tới "ghi" không có await → một tiến trình không thể mất cập nhật.

import { randomBytes, randomInt, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { R, applyAction, createFarmState, rollFor, clientView, inField, sha256 } from "./actions.mjs";
import { HttpError } from "./http-util.mjs";

const NEEDS_ROLL = new Set(["fieldFind", "openBag", "tradeForEgg"]);
const tokenHash = (token) => createHash("sha256").update(token).digest();

export class FarmService {
  constructor({ store, presence, clock, secret, metrics, cfg, log }) {
    this.store = store;
    this.q = store.q;
    this.presence = presence;
    this.clock = clock;
    this.secret = secret;
    this.metrics = metrics;
    this.cfg = cfg;
    this.log = log;
    this.cache = new Map(); // playerId → { state, version, rolls } (LRU; state đã qua JSON như trong DB)
  }

  /* ---------- danh tính ---------- */

  createGuest() {
    const token = randomBytes(32).toString("base64url"); // 43 ký tự, chỉ client giữ
    const playerId = "p_" + randomBytes(9).toString("base64url"); // 12 ký tự, công khai
    const seed = randomInt(0, 2 ** 32); // seed trại, không gửi client
    const now = this.clock();
    this.q.insertPlayer.run(playerId, tokenHash(token), seed, now, now);
    return { token, playerId };
  }

  auth(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    const p = this.q.playerByToken.get(tokenHash(token));
    if (!p || p.status !== "active") return null;
    const now = this.clock();
    if (now - p.last_seen > 60_000) this.q.touchPlayer.run(now, p.id); // ghi tối đa 1 lần/phút
    return p;
  }

  /* ---------- bộ nhớ đệm trại ---------- */

  load(pid) {
    const hit = this.cache.get(pid);
    if (hit) {
      this.cache.delete(pid); // LRU: đưa lên cuối
      this.cache.set(pid, hit);
      return hit;
    }
    const row = this.q.farm.get(pid);
    if (!row) return null;
    return this.#remember(pid, { state: JSON.parse(row.state), version: row.version, rolls: row.rolls });
  }

  #remember(pid, entry) {
    this.cache.set(pid, entry);
    if (this.cache.size > this.cfg.cacheSize) this.cache.delete(this.cache.keys().next().value);
    return entry;
  }

  evict(pid) {
    this.cache.delete(pid);
  }

  /* ---------- ghi ---------- */

  // Ghi một hành động thành công + ảnh chụp mới trong cùng transaction, rồi thay bản trong bộ nhớ.
  #commit(pid, entry, draft, rolls, row) {
    const version = entry.version + 1;
    const json = JSON.stringify(draft);
    const t0 = performance.now();
    this.store.tx(() => {
      this.q.insertAction.run(pid, version, row.aid ?? null, row.type, JSON.stringify(row.args ?? {}), row.rolled ? JSON.stringify(row.rolled) : null,
        row.now, row.source, "ok", row.reqHash ?? null, row.response ?? null);
      const r = this.q.updateFarm.run(R.CONFIG.version, json, version, rolls, row.now, sha256(json), pid, entry.version);
      // Chỉ xảy ra khi có tiến trình thứ hai ghi cùng DB (chưa có ở M2).
      if (r.changes !== 1) throw new HttpError(409, "version_conflict", "Trại vừa được cập nhật ở nơi khác, thử lại");
    });
    this.metrics.observeDbWrite(performance.now() - t0);
    return this.#remember(pid, { state: JSON.parse(json), version, rolls });
  }

  #reject(pid, entry, now, type, code, source, aid, rolls) {
    this.store.tx(() => {
      this.q.insertReject.run(pid, now, type, code, source, aid ?? null);
      if (entry && rolls !== entry.rolls) this.q.bumpRolls.run(rolls, pid); // mỗi giá trị tung chỉ dùng một lần
    });
    if (entry) entry.rolls = rolls;
    this.metrics.counters.rejects++;
  }

  // Gửi lại cùng aid → trả đúng phản hồi cũ; cùng aid nhưng thân khác → 422.
  #replayed(pid, aid, reqHash) {
    const prev = this.q.actionByAid.get(pid, aid);
    if (!prev) return null;
    if (prev.req_hash !== reqHash) throw new HttpError(422, "idempotency_mismatch", "aid này đã dùng cho một hành động khác");
    const body = prev.response ? JSON.parse(prev.response) : { ok: true, aid, version: prev.seq };
    return { status: 200, body: { ...body, replayed: true } };
  }

  /* ---------- API ---------- */

  starters(player) {
    if (this.load(player.id)) throw new HttpError(409, "farm_exists", "Bạn đã có trại");
    const choices = R.starterEggs(player.seed).map((e, i) => ({ choice: i, code: e.code, shell: e.shell, shellName: e.shellName }));
    return { ok: true, now: this.clock(), choices };
  }

  newFarm(player, aid, choice) {
    const pid = player.id;
    const args = { choice };
    const reqHash = sha256("newGame" + JSON.stringify(args));
    const again = this.#replayed(pid, aid, reqHash);
    if (again) return again;
    if (this.load(pid)) throw new HttpError(409, "farm_exists", "Bạn đã có trại");
    const now = this.clock();
    const state = createFarmState(player.seed, now, choice);
    const json = JSON.stringify(state);
    const body = { ok: true, aid, now, version: 1, result: { choice }, events: [], farm: clientView(state, this.cfg.memorialInView) };
    this.store.tx(() => {
      this.q.insertFarm.run(pid, R.CONFIG.version, json, 1, 0, now, sha256(json));
      this.q.insertAction.run(pid, 1, aid, "newGame", JSON.stringify(args), JSON.stringify({ seed: player.seed }), now, "http", "ok", reqHash, JSON.stringify(body));
    });
    this.#remember(pid, { state: JSON.parse(json), version: 1, rolls: 0 });
    return { status: 200, body };
  }

  getFarm(player) {
    const pid = player.id;
    let entry = this.#mustLoad(pid);
    entry = this.enforcePresence(pid, entry);
    const now = Math.max(this.clock(), entry.state.updatedAt);
    let events = [];
    // Ghi một "advance" (người chơi có mặt) khi: vắng lâu (lần tính lười sau khỏi chạy quá dài), hoặc
    // có trứng ấp xong đang chờ trong ổ (Q14) — gà con nở ĐÚNG lúc này và được lưu, không nở lại mỗi lần xem.
    const eggReady = entry.state.eggs.some((e) => e.hatchAt !== null && e.hatchAt <= now);
    if (eggReady || now - entry.state.updatedAt > this.cfg.systemAdvanceMs) {
      const draft = structuredClone(entry.state);
      const out = applyAction(draft, "advance", {}, null, now);
      entry = this.#commit(pid, entry, draft, entry.rolls, { type: "advance", now, source: "view" });
      events = out.events;
    }
    // Phần còn lại: mô phỏng trên BẢN SAO, không ghi (xem không làm đổi state).
    const view = structuredClone(entry.state);
    events = events.concat(R.advance(view, now));
    return { status: 200, body: { ok: true, now, version: entry.version, events, farm: clientView(view, this.cfg.memorialInView), field: this.#fieldInfo(pid, now) } };
  }

  // Một hành động trại (tên trùng hàm luật). args đã qua validate.mjs.
  perform(player, type, args, aid, source = "http") {
    const pid = player.id;
    const reqHash = sha256(type + JSON.stringify(args));
    if (aid) {
      const again = this.#replayed(pid, aid, reqHash);
      if (again) return again;
    }
    let entry = this.#mustLoad(pid);
    entry = this.enforcePresence(pid, entry);
    const now = Math.max(this.clock(), entry.state.updatedAt); // chống đồng hồ máy chủ lùi
    const fail = (status, code, message, rolls = entry.rolls) => {
      this.#reject(pid, entry, now, type, code, source, aid, rolls);
      return { status, body: { ok: false, aid, code, message, now, version: entry.version } };
    };

    // Ngoài đồng chỉ khi đang xem: thả gà = một nhịp tim; tìm hạt cần phiên xem còn hạn.
    if (type === "release") this.presence.beat(pid, now);
    if (type === "fieldFind" && !this.presence.isWatching(pid, now)) return fail(409, "not_watching", "Bạn không còn xem cánh đồng — gà đã về chuồng");

    let rolls = entry.rolls;
    const rolled = NEEDS_ROLL.has(type) ? rollFor(type, this.secret, pid, rolls++) : null;
    const draft = structuredClone(entry.state);
    let out;
    try {
      out = applyAction(draft, type, args, rolled, now);
    } catch (e) {
      // copy-on-write: bản trong bộ nhớ chưa bị đụng tới
      this.metrics.counters.internalErrors++;
      this.log("error", { msg: "rules_threw", type, err: String(e?.stack ?? e) });
      throw new HttpError(500, "internal", "Lỗi server, trại không đổi");
    }
    if (!out.ok) return fail(409, out.code, out.message, rolls);

    const body = { ok: true, aid, now, version: entry.version + 1, result: out.result, events: out.events, farm: clientView(draft, this.cfg.memorialInView) };
    this.#commit(pid, entry, draft, rolls, { type, aid, args, rolled, now, source, reqHash, response: JSON.stringify(body) });
    return { status: 200, body };
  }

  watch(player) {
    const pid = player.id;
    const now = this.clock();
    let entry = this.load(pid);
    // Phiên cũ đã hết hạn mà gà còn ngoài đồng → gà về trước, rồi mới mở phiên mới.
    if (entry) entry = this.enforcePresence(pid, entry);
    this.presence.beat(pid, now);
    return { status: 200, body: { ok: true, now, ...this.#fieldInfo(pid, now), inField: entry ? inField(entry.state) : [] } };
  }

  /* ---------- phiên xem ---------- */

  // Gà ngoài đồng mà chủ không còn xem → recallAll (nguồn system, now = lúc phiên hết hạn).
  enforcePresence(pid, entry) {
    if (!entry.state.chickens.some((c) => c.location === "field")) return entry;
    const clockNow = this.clock();
    if (this.presence.isWatching(pid, clockNow)) return entry;
    const exp = this.presence.expiry(pid) ?? clockNow; // không có phiên (vd. server vừa khởi động) → ngay bây giờ
    const at = Math.max(entry.state.updatedAt, Math.min(exp, clockNow));
    const draft = structuredClone(entry.state);
    applyAction(draft, "recallAll", {}, null, at, { present: false }); // người chơi đã rời đi
    this.presence.clear(pid);
    this.metrics.counters.systemRecalls++;
    this.log("info", { msg: "auto_recall", player: pid });
    return this.#commit(pid, entry, draft, entry.rolls, { type: "recallAll", now: at, source: "system" });
  }

  // Quét định kỳ: phiên hết hạn → gọi gà về (người chơi đóng tab / mất mạng không gửi gì nữa).
  sweep() {
    const now = this.clock();
    for (const pid of this.presence.expired(now)) {
      const entry = this.load(pid);
      if (entry) this.enforcePresence(pid, entry);
      this.presence.clear(pid);
    }
  }

  // Khởi động: trại nào còn gà ngoài đồng (server tắt đột ngột) → gọi về.
  recallStale() {
    for (const { player_id } of this.q.farmsInField.all()) {
      const entry = this.load(player_id);
      if (entry) this.enforcePresence(player_id, entry);
    }
  }

  // Tắt server: coi như mọi người rời đi.
  recallEveryone() {
    for (const pid of this.presence.players()) {
      this.presence.clear(pid);
      const entry = this.load(pid);
      if (entry) this.enforcePresence(pid, entry);
    }
  }

  #fieldInfo(pid, now) {
    return { watching: this.presence.isWatching(pid, now), watchUntil: this.presence.expiry(pid), beatEveryMs: this.cfg.watchEveryMs };
  }

  #mustLoad(pid) {
    const entry = this.load(pid);
    if (!entry) throw new HttpError(404, "no_farm", "Chưa có trại — chọn trứng khởi đầu trước");
    return entry;
  }
}
