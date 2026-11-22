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
//   fieldBonus  → seed riêng cho lần bới đốm sáng (số hạt, loại hạt, hay cả túi)
//   claim       → seed riêng cho phần thưởng nhiệm vụ (trứng quà)
const SEEDED = new Set(["openBag", "tradeForEgg", "fieldBonus", "claim", "buy", "barter", "candle", "haggle", "harvest"]);
// now: bảng rơi ngoài đồng theo mùa (luật v9) — loại hạt đã tung ghi vào nhật ký nên phát lại không cần biết mùa
export function rollFor(type, secret, playerId, counter, now = null) {
  if (type === "fieldFind") return { kind: R.rollSeed("field", mulberry32(serverRoll(secret, "field", playerId, counter)), now) };
  if (SEEDED.has(type)) return { seed: serverRoll(secret, type, playerId, counter) };
  return null;
}
export const NEEDS_ROLL = new Set(["fieldFind", ...SEEDED]);

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
  tradeToShop: (s, a, now) => R.tradeToShop(s, { eggs: a.eggs, chickens: a.chickens }, now, { want: a.want }),
  // luật nhận nguồn ngẫu nhiên từ ngoài (opts.rng) — seed HMAC đã ghi ở cột rolled nên phát lại được
  tradeForEgg: (s, a, now, rolled) => R.tradeForEgg(s, a.chickenId, now, { rng: mulberry32(rolled.seed >>> 0) }),
  openBag: (s, a, now, rolled) => R.openBag(s, a.bagId, now, { rng: mulberry32(rolled.seed >>> 0) }),
  // luật v6
  warmEgg: (s, a, now) => R.warmEgg(s, a.eggId, now),
  fieldBonus: (s, a, now, rolled) => R.fieldBonus(s, a.chickenId, now, { rng: mulberry32(rolled.seed >>> 0) }),
  // luật v7 — khách qua đường (mọi thứ ngẫu nhiên do server tung)
  buy: (s, a, now, rolled) => R.buy(s, a.slot, now, { rng: mulberry32(rolled.seed >>> 0) }),
  barter: (s, a, now, rolled) => R.barter(s, a.slot, now, { eggs: a.eggs, rng: mulberry32(rolled.seed >>> 0) }),
  deliver: (s, a, now) => R.deliver(s, a.chickenId, now),
  candle: (s, a, now, rolled) => R.candle(s, a.eggId, a.what, now, { rng: mulberry32(rolled.seed >>> 0), mood: a.mood }),
  usePotion: (s, a, now) => R.usePotion(s, a.chickenId, a.potion, now), // luật v12
  haggle: (s, a, now, rolled) => R.haggle(s, a.offer, now, { rng: mulberry32(rolled.seed >>> 0) }),
  knockEgg: (s, a, now) => R.knockEgg(s, a.eggId, now),
  startPlay: (s, a, now) => R.startPlay(s, a.id, now, { pay: a.pay }),
  endPlay: (s, a, now) => R.endPlay(s, a.score, now),
  fillTower: (s, a, now) => R.fillTower(s, a.seed, a.n, now),
  takeFromTower: (s, a, now) => R.takeFromTower(s, a.seed, a.n, now),
  claim: (s, a, now, rolled) => R.claim(s, a.id, now, { rng: mulberry32(rolled.seed >>> 0) }),
  // luật v10 — vườn rau
  plant: (s, a, now) => R.plant(s, a.plot, a.seed, now),
  waterPlot: (s, a, now) => R.waterPlot(s, a.plot, now),
  harvest: (s, a, now, rolled) => R.harvest(s, a.plot, now, { rng: mulberry32(rolled.seed >>> 0) }),
  advance: () => ({ ok: true }), // hành động hệ thống: chỉ mô phỏng tới `now`
};

// Áp một hành động lên `state` (state BỊ SỬA — người gọi truyền bản sao).
// Trả về { ok, result, events } hoặc { ok:false, code, message }.
// present: người chơi có mặt (mọi request của họ). Hành động nguồn "system" (tự gọi gà về khi hết
// phiên xem) truyền false → trứng ấp xong chờ trong ổ tới khi người chơi quay lại (Q14).
export function applyAction(state, type, args, rolled, now, { present = true } = {}) {
  const run = ACTIONS[type];
  if (!run) throw new Error(`Hành động không tồn tại: ${type}`);
  // rolled.w = mốc đầu phiên mở game do server theo dõi (v7, tháp hạt) — nằm trong nhật ký nên phát lại y hệt
  const opts = { present, ...(present && rolled?.w !== undefined ? { watchFrom: rolled.w } : {}) };
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
// v7: trứng CHƯA NỞ không gửi mã gen (không thì ai mở công cụ lập trình cũng đọc được trống/mái, đặc điểm — thầy soi trứng
// hết nghĩa); thay bằng số phút ấp và những gì đã soi (egg.known). Giá sàn mặc cả (visit.floor) cũng không bao giờ gửi.
// `now` có thì kèm khách đang ghé (client không có seed nên không tự tính được lịch).
export function clientView(state, memorialMax = 20, now = null) {
  const { seed, memorial, visit, eggs, ...rest } = state;
  const { floor, ...visitPublic } = visit ?? {};
  return {
    ...rest,
    // trứng bí ẩn: kết quả (mystery) giấu tới khi nở
    eggs: eggs.map(({ code, mutations, mystery, ...e }) => ({ ...e, incubateMin: Math.round(R.incubateMsOf(code) / 6000) / 10 })),
    ...(visit ? { visit: visitPublic } : {}),
    ...(now != null ? { visitor: R.visitorView(state, now) } : {}),
    memorial: memorial.slice(-memorialMax),
    memorialTotal: memorial.length,
  };
}

export const inField = (state) => state.chickens.filter((c) => c.location === "field").map((c) => c.id);
