// Trại Gà server — cầu nối tới luật chơi. Dùng chung cho server và tools/replay.mjs
// → chạy lại nhật ký đi qua ĐÚNG đoạn mã mà server đã dùng lúc nhận hành động.
//
// Không chép luật: mọi thay đổi state đều do hàm của rules.js làm. Ở đây chỉ:
//   1. ánh xạ tên hành động → lời gọi hàm luật với tham số đã kiểm tra,
//   2. tung các giá trị ngẫu nhiên phía server (HMAC với bí mật server) và đưa vào luật,
//   3. tạo bản xem cho client (bỏ seed).

import { createHash, createHmac } from "node:crypto";
import * as R from "../../public/apps/chicken-farm/js/game/rules.js";
import { mulberry32 } from "../../public/apps/chicken-farm/js/genome.js";

export { R };

/* ---------- ngẫu nhiên phía server ---------- */

// u32 không đoán trước được: HMAC-SHA256(SERVER_SECRET, mục đích | người chơi | bộ đếm).
// Bộ đếm (farms.rolls) tăng sau mỗi lần tung → mỗi giá trị dùng đúng một lần.
export function serverRoll(secret, purpose, playerId, counter) {
  return createHmac("sha256", secret).update(`${purpose}|${playerId}|${counter}`).digest().readUInt32BE(0);
}

// Hành động nào cần giá trị ngẫu nhiên do server tung (ghi vào cột actions.rolled):
//   fieldFind   → loại hạt ngoài đồng (rollSeed("field") của luật trên rng từ HMAC)
//   openBag     → seed riêng cho lần mở túi
//   tradeForEgg → seed riêng cho quả trứng của cửa hàng
export function rollFor(type, secret, playerId, counter) {
  if (type === "fieldFind") return { kind: R.rollSeed("field", mulberry32(serverRoll(secret, "field", playerId, counter))) };
  if (type === "openBag" || type === "tradeForEgg") return { seed: serverRoll(secret, type, playerId, counter) };
  return null;
}

/* ---------- bảng hành động ---------- */

// run(state, args, now, rolled) → kết quả của hàm luật ({ok, …} | {ok:false, code, message})
export const ACTIONS = {
  collectEgg: (s, a, now) => R.collectEgg(s, a.eggId, now),
  incubate: (s, a, now) => R.incubate(s, a.eggId, now),
  feed: (s, a, now) => R.feed(s, a.chickenId, a.seed, now),
  release: (s, a, now) => R.release(s, a.chickenId, now),
  recall: (s, a, now, _r, opts) => R.recall(s, a.chickenId, now, opts),
  recallAll: (s, a, now, _r, opts) => R.recallAll(s, now, opts),
  fieldFind: (s, a, now, rolled) => R.fieldFind(s, a.chickenId, rolled.kind, now),
  tradeToShop: (s, a, now) => R.tradeToShop(s, { eggs: a.eggs, chickens: a.chickens }, now),
  // luật nhận nguồn ngẫu nhiên từ ngoài (opts.rng) — seed HMAC đã ghi ở cột rolled nên phát lại được
  tradeForEgg: (s, a, now, rolled) => R.tradeForEgg(s, a.chickenId, now, { rng: mulberry32(rolled.seed >>> 0) }),
  openBag: (s, a, now, rolled) => R.openBag(s, a.bagId, now, { rng: mulberry32(rolled.seed >>> 0) }),
  advance: () => ({ ok: true }), // hành động hệ thống: chỉ mô phỏng tới `now`
};

// Áp một hành động lên `state` (state BỊ SỬA — người gọi truyền bản sao).
// Trả về { ok, result, events } hoặc { ok:false, code, message }.
// present: người chơi có mặt (mọi request của họ). Hành động nguồn "system" (tự gọi gà về khi hết
// phiên xem) truyền false → trứng ấp xong chờ trong ổ tới khi người chơi quay lại (Q14).
export function applyAction(state, type, args, rolled, now, { present = true } = {}) {
  const run = ACTIONS[type];
  if (!run) throw new Error(`Hành động không tồn tại: ${type}`);
  const opts = { present };
  const events = R.advance(state, now, opts); // giống act() của luật; tách ra để lấy sự kiện của phần thời gian trôi
  const r = run(state, args ?? {}, now, rolled ?? {}, opts);
  if (r && r.ok === false) return { ok: false, code: r.code, message: r.message };
  const { ok, events: more = [], ...result } = r ?? {};
  return { ok: true, result, events: [...events, ...more] };
}

// Hành động đầu tiên của mọi trại.
export const createFarmState = (seed, now, choice) => R.newGame(seed, now, choice);

/* ---------- băm / bản xem ---------- */

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// Bản client được thấy: KHÔNG có seed (seed cho phép đoán lượt đẻ, tên gà…); sổ kỷ niệm chỉ phần cuối.
export function clientView(state, memorialMax = 20) {
  const { seed, memorial, ...rest } = state;
  return { ...rest, memorial: memorial.slice(-memorialMax), memorialTotal: memorial.length };
}

export const inField = (state) => state.chickens.filter((c) => c.location === "field").map((c) => c.id);
