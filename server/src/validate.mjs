// Trại Gà server — kiểm tra dữ liệu vào TRƯỚC khi gọi luật (luật tin vào kiểu dữ liệu).
// Mỗi bộ kiểm tra trả về tham số đã chuẩn hoá (chỉ giữ trường biết trước) hoặc ném HttpError 400.

import { R } from "./actions.mjs";
import { HttpError } from "./http-util.mjs";

const ID_RE = /^[a-z0-9-]{1,48}$/; // id trong trại: c1, e3, e-c2-lx…, b5
const AID_RE = /^[A-Za-z0-9_-]{1,40}$/; // id hành động do client sinh (ULID/UUID…)

const bad = (message) => new HttpError(400, "bad_request", message);

function id(body, key) {
  const v = body[key];
  if (typeof v !== "string" || !ID_RE.test(v)) throw bad(`Trường "${key}" không hợp lệ`);
  return v;
}

function idList(body, key, max) {
  const v = body[key];
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) throw bad(`Trường "${key}" phải là mảng ≤ ${max} phần tử`);
  for (const x of v) if (typeof x !== "string" || !ID_RE.test(x)) throw bad(`Trường "${key}" có id không hợp lệ`);
  return [...new Set(v)];
}

export function aid(body) {
  const v = body.aid;
  if (typeof v !== "string" || !AID_RE.test(v)) throw bad('Thiếu hoặc sai "aid" (id hành động, ≤ 40 ký tự [A-Za-z0-9_-])');
  return v;
}

export function choice(body) {
  const v = body.choice;
  const n = R.CONFIG.start.starterChoices;
  if (!Number.isInteger(v) || v < 0 || v >= n) throw bad(`"choice" phải là số nguyên 0..${n - 1}`);
  return v;
}

function seedKind(body) {
  const v = body.seed;
  if (typeof v !== "string" || !Object.hasOwn(R.SEEDS, v)) throw bad("Không có loại hạt này");
  return v;
}

function count(body, key, max) {
  const v = body[key];
  if (!Number.isInteger(v) || v < 1 || v > max) throw bad(`"${key}" phải là số nguyên 1..${max}`);
  return v;
}

// id nhiệm vụ: bước mở đầu hiện tại, một trong các việc trong ngày, hoặc rương ngày
const QUEST_RE = /^(tutorial|chest|daily:[0-9])$/;
function questId(body) {
  const v = body.id;
  if (typeof v !== "string" || !QUEST_RE.test(v)) throw bad('Trường "id" không hợp lệ');
  return v;
}

// Tham số cho từng hành động trại (tên trùng tên hàm luật).
export const ARGS = {
  collectEgg: (b) => ({ eggId: id(b, "eggId") }), // nhặt trứng ngoài sân vào kho
  incubate: (b) => ({ eggId: id(b, "eggId") }),
  feed: (b) => ({ chickenId: id(b, "chickenId"), seed: seedKind(b) }),
  release: (b) => ({ chickenId: id(b, "chickenId") }),
  recall: (b) => ({ chickenId: id(b, "chickenId") }),
  recallAll: () => ({}),
  fieldFind: (b) => ({ chickenId: id(b, "chickenId") }), // loại hạt do SERVER tung, client không gửi
  tradeToShop: (b) => ({ eggs: idList(b, "eggs", R.CONFIG.storage.eggs), chickens: idList(b, "chickens", 12), ...(b.want === "tickets" ? { want: "tickets" } : {}) }),
  tradeForEgg: (b) => ({ chickenId: id(b, "chickenId") }),
  openBag: (b) => ({ bagId: id(b, "bagId") }),
  // luật v6
  warmEgg: (b) => ({ eggId: id(b, "eggId") }), // sưởi trứng đang ấp
  fieldBonus: (b) => ({ chickenId: id(b, "chickenId") }), // đốm sáng: phần thưởng do SERVER tung
  claim: (b) => ({ id: questId(b) }), // nhận thưởng nhiệm vụ
  // luật v7 — sân chơi: điểm phải là SỐ hữu hạn (luật còn kẹp về 0..1 lần nữa)
  startPlay: (b) => ({ id: id(b, "id") }),
  endPlay: (b) => {
    if (typeof b.score !== "number" || !Number.isFinite(b.score)) throw bad('"score" phải là một số');
    return { score: b.score };
  },
  // luật v7 — tháp hạt
  fillTower: (b) => ({ seed: seedKind(b), n: count(b, "n", R.CONFIG.tower.cap) }),
  takeFromTower: (b) => ({ seed: seedKind(b), n: count(b, "n", R.CONFIG.tower.cap) }),
};
