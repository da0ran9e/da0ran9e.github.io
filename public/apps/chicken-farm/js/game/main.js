// Trại Gà — client bản M1 (offline, lưu trong trình duyệt).
// Màn hình chính là SÂN TRẠI: gà đi lại; kéo thả bằng chuột hoặc cảm ứng (Pointer Events):
//   gà → cổng: ra cánh đồng (mỗi lần 1 con) · gà → chợ: đổi · gà → máng ăn: tự chọn hạt hợp nhất
//   trứng → ổ ấp: ấp · trứng → chợ: đổi túi hạt · trứng → chuồng / chạm: nhặt vào kho
//   hạt (khay dưới) → gà: cho ăn · chạm gà: xem thông tin
// Luật chơi: rules.js (thuần logic). Cánh đồng: field.js (chỉ chạy khi đang xem).
// Hai chế độ: OFFLINE (luật chạy ngay trong trình duyệt, lưu localStorage) và ONLINE (server M2 có
// thẩm quyền: client chỉ gửi ý định qua act(), hiển thị trại server trả về). Bật online bằng
// ?server=https://… hoặc ô "Máy chủ" trong bảng Dev.
import { express, decodeGenome } from "../genome.js";
import { createNet } from "./net.js";
import { renderChickenFlat, renderEggFlat } from "../chicken-flat.js";
import * as R from "./rules.js";
import { FIELD, createField, addChicken, removeChicken, tickField, snapshot, fieldTraits, setReadyAt, setLure } from "./field.js";
import { sfx, sound, buzz, burst, confetti, flyTo, bump } from "./fx.js";
import { decorItems, sparkleSvg, chestSvg, flameSvg, nestCrackSvg } from "../art/decor.js";

let ICONS = null;
try {
  ICONS = await import("../art/icons.js");
} catch {
  ICONS = null; // chưa có bộ biểu tượng: dùng hình tạm
}

const SAVE_KEY = "trai-ga-game-v1";
const SAVE_COMPAT_MIN = 3; // phiên bản luật cũ nhất mà bản lưu offline còn đọc được (tăng khi đổi cấu trúc state)
const { MIN, HOUR, DAY } = R.TIME;
const W = FIELD.width, H = FIELD.height;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
// Chỉ ghi lại DOM khi nội dung đổi: giữ tiêu điểm bàn phím, không làm trình đọc màn hình đọc lại.
function setHTML(el, html) {
  if (el && el._html !== html) { el._html = html; el.innerHTML = html; }
}
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- chế độ online / offline ---------- */

const SERVER_KEY = "trai-ga-server";
// Máy chủ chính thức (Cloudflare Tunnel trên máy Windows → localhost:8787). Đổi ở đây nếu dùng tên miền khác.
const DEFAULT_SERVER = "https://game.vuducan.qzz.io";
const OFF = "off"; // người chơi chủ động chọn offline

// Hỏi /api/hello có đúng server Trại Gà cùng phiên bản luật không (hết giờ chờ → coi như không có).
async function probe(base, ms = 2500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}/api/hello`, { signal: ctl.signal, cache: "no-store" });
    const j = await r.json();
    return j.ok === true && j.game === "trai-ga" && j.rulesVersion === R.CONFIG.version;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Thứ tự: ?server=… (lưu lại; ?server= rỗng = offline) → lựa chọn đã lưu → trang do chính server
// phục vụ (cùng origin) → trang tĩnh trên tên miền chính và chưa có bản lưu offline → máy chủ mặc định → offline.
const SERVER = await (async () => {
  const q = new URLSearchParams(location.search).get("server");
  if (q !== null) {
    try { localStorage.setItem(SERVER_KEY, q || OFF); } catch {}
    return q || null;
  }
  let saved = null;
  try { saved = localStorage.getItem(SERVER_KEY); } catch {}
  if (saved === OFF) return null;
  if (saved) return saved;
  if (location.protocol.startsWith("http") && (await probe(location.origin, 1500))) return location.origin;
  let hasOffline = false;
  try { hasOffline = !!localStorage.getItem(SAVE_KEY); } catch {}
  const onSite = /(^|\.)vuducan\.qzz\.io$|\.github\.io$/.test(location.hostname);
  if (onSite && !hasOffline && (await probe(DEFAULT_SERVER))) return DEFAULT_SERVER;
  return null;
})();
const net = SERVER ? createNet(SERVER) : null;
const online = !!net;
let clockOffset = 0; // giờ server − giờ máy (online)

/* ---------- đồng hồ game (tua nhanh được khi offline) ---------- */

const clock = { game: Date.now(), real: performance.now(), speed: 1 };
const now = () => (online ? Date.now() + clockOffset : Math.round(clock.game + (performance.now() - clock.real) * clock.speed));
function setSpeed(x) {
  clock.game = now();
  clock.real = performance.now();
  clock.speed = x;
  for (const b of document.querySelectorAll("#speed [data-speed]")) b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === x));
}

/* ---------- lưu / tải ---------- */

let state = null;
let ui = { eggPos: {} }; // vị trí trứng ngoài sân (chỉ để hiển thị)
let awayMs = 0; // thời gian thực đã rời game (để chào "khi bạn vắng mặt")
// Server bản cũ (luật v5) chưa có nhiệm vụ / sưởi trứng / đốm sáng → ẩn các phần đó thay vì báo lỗi.
const hasV6 = () => !!state?.count;
function save() {
  if (!state || online) return; // online: server giữ trại
  try {
    for (const id of Object.keys(ui.eggPos)) if (!state.eggs.some((e) => e.id === id && e.inYard)) delete ui.eggPos[id];
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state, ui, gameAt: now(), realAt: Date.now() }));
  } catch {}
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    // Bản lưu từ v3 trở đi cùng cấu trúc (các bản sau chỉ đổi số CONFIG) → giữ lại, nâng nhãn phiên bản.
    if (!raw || !(raw.state?.v >= SAVE_COMPAT_MIN && raw.state.v <= R.CONFIG.version)) return false;
    state = raw.state;
    state.v = R.CONFIG.version;
    ui = { eggPos: {}, ...(raw.ui || {}) };
    R.recallAll(state, raw.gameAt); // Q4: lúc rời đi, gà ngoài đồng đã tự về
    awayMs = Math.max(0, Date.now() - raw.realAt);
    clock.game = raw.gameAt + awayMs;
    clock.real = performance.now();
    return true;
  } catch {
    return false;
  }
}

/* ---------- định dạng, biểu tượng ---------- */

function fmtDur(ms) {
  if (ms < MIN) return "dưới 1 phút";
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 48) return mm ? `${h} giờ ${mm} phút` : `${h} giờ`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d} ngày ${hh} giờ` : `${d} ngày`;
}
// Thời gian chờ ngắn (trứng sắp nở) thì đếm ngược theo giây cho hồi hộp.
const fmtEta = (ms) => (ms < 2 * MIN ? `${Math.max(1, Math.ceil(ms / 1000))} giây` : fmtDur(ms));
const STAGE = { chick: "Gà con", juvenile: "Gà giò", adult: "Trưởng thành" };
const NUT_COLOR = { protein: "var(--protein)", energy: "var(--energy)", mineral: "var(--mineral)", pigment: "var(--pigment)" };
const SEED_COLOR = { common: "#c9a66b", protein: "#e0603a", energy: "#e3b23c", mineral: "#4f8f97", pigment: "#b0479b", premium: "#e8c34a", odd: "#5fbf8f" };
const SEED_SHORT = { common: "Thường", protein: "Đạm", energy: "Mẩy", mineral: "Khoáng", pigment: "Màu", premium: "Quý", odd: "Lạ" };

function seedIcon(kind, size = 24) {
  if (ICONS?.seedIcon) return ICONS.seedIcon(kind, size);
  return `<svg viewBox="0 0 24 24" role="img" aria-label="${R.SEEDS[kind].name}"><ellipse cx="12" cy="13" rx="6" ry="8" transform="rotate(-20 12 13)" fill="${SEED_COLOR[kind]}"/></svg>`;
}
function seedSummary(kind) {
  if (kind === "common") return "Ít chất, no bụng";
  if (kind === "premium") return "Giàu cả 4 chất";
  if (kind === "odd") return "Tăng biến dị lứa sau";
  const top = Object.entries(R.SEEDS[kind].n).sort((a, b) => b[1] - a[1])[0][0];
  return `Giàu ${R.NUTRIENT_INFO[top].name.toLowerCase()} → ${R.NUTRIENT_INFO[top].grows.split(":")[0].toLowerCase()}`;
}
function eggArt(egg) {
  const ph = { egg: { shell: egg.shell || "#f3ead8", speckle: 0.15, seed: [...(egg.id || "e")].reduce((a, c) => a + c.charCodeAt(0), 0) } };
  return renderEggFlat(ph, { label: egg.fertile ? "Trứng có phôi" : "Trứng không phôi" });
}
const yardEggArt = (egg) => (ICONS?.nestEggSvg ? ICONS.nestEggSvg(egg.shell || "#f3ead8", 40, "grass") : eggArt(egg));

/* ---------- hình con gà (có bộ nhớ đệm) ---------- */

const artCache = new Map();
function chickenSvg(ch, { pose = "stand", phase = 0, detail = "low" } = {}) {
  const v = R.chickenView(ch, now());
  const devKey = R.NUTRIENTS.map((k) => Math.round(v.care.dev[k] * 10)).join("");
  const key = `${ch.id}|${Math.round(v.growth01 * 25)}|${devKey}|${pose}|${phase}|${detail}`;
  let svg = artCache.get(key);
  if (!svg) {
    const ph = express(decodeGenome(ch.code), v.care);
    svg = renderChickenFlat(ph, { growth: v.growth01, pose, walkPhase: phase, detail, label: ch.name });
    if (artCache.size > 500) artCache.delete(artCache.keys().next().value);
    artCache.set(key, svg);
  }
  return { svg, key };
}
const memorialSvg = (m) => renderChickenFlat(express(decodeGenome(m.code), { dev: m.dev, gloss: 0.4 }), { growth: 1, detail: "low", label: m.name });

/* ---------- thông báo, nhật ký ---------- */

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  const host = $("#toasts");
  host.append(el);
  while (host.children.length > 3) host.firstElementChild.remove(); // không chồng quá 3 dòng
  setTimeout(() => el.remove(), 3600);
}
function popIn(layer, x, y, text) {
  const el = document.createElement("div");
  el.className = "pop";
  el.style.left = `${(x / W) * 100}%`;
  el.style.top = `${(y / H) * 100}%`;
  el.textContent = text;
  $(layer).append(el);
  setTimeout(() => el.remove(), 1400);
}
const logItems = [];
const justHatched = new Set();
function nameOf(id) {
  return state.chickens.find((c) => c.id === id)?.name ?? state.memorial.find((m) => m.id === id)?.name ?? "Gà";
}
const seenEvents = new Set();
// quiet: lúc mở game sau khi vắng mặt — không bắn một tràng thông báo; gom lại cho màn "khi bạn vắng mặt".
function handleEvents(events, { quiet = false } = {}) {
  const recap = quiet ? { laid: 0, juveniles: 0, adults: [], died: [] } : null;
  for (const e of events) {
    const key = `${e.type}|${e.at}|${e.chickenId ?? ""}|${e.eggId ?? ""}|${e.key ?? e.n ?? ""}`;
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);
    if (seenEvents.size > 2000) seenEvents.delete(seenEvents.values().next().value);
    let text = "", loud = false;
    if (e.type === "hatched") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> đã nở!`;
      justHatched.add(e.chickenId);
      hiddenChicks.add(e.chickenId); // ra mắt trong màn nở trứng rồi mới chui ra sân
      queueReveal({ kind: "hatch", chickenId: e.chickenId, shell: eggShells.get(e.eggId), fresh: [] });
    } else if (e.type === "juvenile") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> thành gà giò`;
      if (recap) recap.juveniles++;
      else stageFx(e.chickenId, "Thành gà giò!");
    } else if (e.type === "adult") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> đã trưởng thành`;
      loud = true;
      if (recap) recap.adults.push(nameOf(e.chickenId));
      else stageFx(e.chickenId, "Trưởng thành!");
    } else if (e.type === "laid") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> đẻ một trứng ${e.fertile ? "có phôi" : "không phôi"} ngoài sân`;
      loud = true;
      const a = yard?.chickens.get(e.chickenId);
      ui.eggPos[e.eggId] = a ? { x: clampN(a.x + (Math.random() - 0.5) * 30, 70, 730), y: clampN(a.y + 6, 150, 440) } : randomEggSpot(e.eggId);
      if (recap) recap.laid++;
      else {
        sfx("cluck");
        if (a && view === "yard") popIn("#yard-pops", a.x, a.y - 70, "Cục tác!");
      }
    } else if (e.type === "died") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> đã mất${e.starved ? " (bị bỏ đói)" : " vì tuổi già"}`;
      loud = true;
      if (recap) recap.died.push({ name: nameOf(e.chickenId), starved: e.starved });
      else sfx("sad");
    } else if (e.type === "dex") {
      const d = R.DEX.find((x) => x.key === e.key);
      const nm = `<b>${esc(d?.name ?? e.key)}</b>`;
      if (e.star === 1) {
        text = `Sổ sưu tầm: mục mới ${nm} ★`;
        for (let i = reveals.length - 1; i >= 0; i--) if (reveals[i].kind === "hatch" && reveals[i].chickenId === e.chickenId) { reveals[i].fresh.push(e.key); break; }
      } else {
        text = e.star === 3 ? `Sổ sưu tầm ★★★ ${nm} — thuần chủng!` : `Sổ sưu tầm ★★ ${nm} — nuôi đủ chất tới trưởng thành`;
        loud = true;
        if (!recap) sfx("good", 0.4);
      }
    } else if (e.type === "milestone") {
      text = `Đạt mốc sổ ${e.n}: chuồng ${e.coopCap} chỗ · ${e.incubators} ổ ấp`;
      queueReveal({ kind: "milestone", n: e.n, coopCap: e.coopCap, incubators: e.incubators });
    } else if (e.type === "breed") {
      const b = R.BREEDS.find((x) => x.key === e.key);
      text = `Đạt giống <b>${esc(b?.name ?? e.key)}</b>!`;
      queueReveal({ kind: "breed", key: e.key, chickenId: e.chickenId, bagId: e.bagId, n: e.n });
    }
    if (!text) continue;
    logItems.unshift({ at: e.at, text });
    if (loud && !recap) toast(text.replace(/<[^>]+>/g, ""));
  }
  logItems.length = Math.min(logItems.length, 50);
  return recap;
}
// Màn "khi bạn vắng mặt": chỉ khi có chuyện đáng kể; chiếu trước các màn nở trứng.
function queueRecap(recap, away = 0) {
  if (!recap) return;
  const lines = [];
  if (recap.laid) lines.push(`🥚 Gà mái đẻ <b>${recap.laid}</b> quả trứng ngoài sân`);
  if (recap.adults.length) lines.push(`🐔 <b>${recap.adults.map(esc).join(", ")}</b> đã trưởng thành`);
  if (recap.juveniles) lines.push(`🐥 <b>${recap.juveniles}</b> gà con thành gà giò`);
  for (const d of recap.died) lines.push(`🕊 <b>${esc(d.name)}</b> đã mất${d.starved ? " (bị bỏ đói)" : " vì tuổi già"}`);
  const waiting = reveals.filter((r) => r.kind === "hatch").length;
  if (waiting) lines.push(`🐣 <b>${waiting}</b> gà con chờ bạn về mới chui ra`);
  // chỉ có chuyện nhỏ (gà con thành gà giò) thì không cần chặn màn hình
  const major = recap.laid || recap.adults.length || recap.died.length || waiting;
  if (major) reveals.unshift({ kind: "recap", lines, away });
}
// Gà đổi tuổi (thành gà giò / trưởng thành): chùm sao + tiếng nhạc ngay tại con gà.
function stageFx(id, text) {
  setTimeout(() => {
    chickenFx(id, { kind: "star", text, colors: ["#ffd95a", "#fff", "#ff9d5c"], n: 10 });
    sfx("grow");
  }, 350);
}
function randomEggSpot(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { x: 160 + (h % 500), y: 220 + ((h >> 9) % 200) };
}

// Một hành động của người chơi. Offline: gọi thẳng rules.js. Online: gửi lên server, nhận trại mới.
const OFFLINE = {
  feed: (a, t) => R.feed(state, a.chickenId, a.seed, t),
  release: (a, t) => R.release(state, a.chickenId, t),
  recall: (a, t) => R.recall(state, a.chickenId, t),
  recallAll: (a, t) => R.recallAll(state, t),
  fieldFind: (a, t) => R.fieldFind(state, a.chickenId, a.seed, a.at ?? t),
  incubate: (a, t) => R.incubate(state, a.eggId, t),
  collectEgg: (a, t) => R.collectEgg(state, a.eggId, t),
  tradeToShop: (a, t) => R.tradeToShop(state, { eggs: a.eggs ?? [], chickens: a.chickens ?? [] }, t),
  tradeForEgg: (a, t) => R.tradeForEgg(state, a.chickenId, t),
  openBag: (a, t) => R.openBag(state, a.bagId, t),
  warmEgg: (a, t) => R.warmEgg(state, a.eggId, t),
  fieldBonus: (a, t) => R.fieldBonus(state, a.chickenId, t),
  claim: (a, t) => R.claim(state, a.id, t),
};
async function act(name, args = {}, opts) {
  if (!online) return OFFLINE[name](args, now());
  const send = { ...args };
  delete send.at; // server dùng giờ của server
  if (name === "fieldFind") delete send.seed; // loại hạt ngoài đồng do server tung
  const r = await net.act(name, send, opts);
  applyServer(r);
  if (!r.ok) return { ok: false, code: r.code, message: r.message || r.code, events: r.events ?? [] };
  return { ok: true, ...(r.result || {}), events: r.events ?? [] };
}
function applyServer(r) {
  if (typeof r.now === "number") clockOffset = r.now - Date.now();
  if (r.farm) state = r.farm;
}

async function run(p, okText) {
  const result = await p;
  handleEvents(result.events ?? []);
  if (!result.ok) {
    if (result.code === "coop_full" && offerRoom()) return false;
    sfx("error");
    toast(result.message);
    renderAll();
    return false;
  }
  if (okText) toast(okText);
  save();
  renderAll();
  return true;
}

// Hiệu ứng ngay tại một con gà (sân hoặc cánh đồng): chùm hạt bay, chữ nổi, gà nhún một cái.
function chickenFx(id, { kind = "heart", text = "", colors = ["#ff6b81", "#ff9db0", "#fff"], n = 5 } = {}) {
  const inField = view === "field";
  const a = (inField ? field : yard)?.chickens.get(id);
  if (!a) return;
  const layer = inField ? "#field-pops" : "#yard-pops";
  burst($(layer), `${(a.x / W) * 100}%`, `${((a.y - 42) / H) * 100}%`, { kind, n, colors, spread: 36, rise: 30 });
  if (text) popIn(layer, a.x, a.y - 70, text);
  bump((inField ? fieldEls : yardEls).get(id), "hop");
}
const voice = (id) => sfx(R.stageOf(state.chickens.find((c) => c.id === id) ?? { growth: 100 }) === "chick" ? "cheep" : "cluck");

/* ---------- màn "bất ngờ" (toàn màn hình): trứng nở, mở túi, nhận thưởng, mốc sổ, giống mới ---------- */

const reveals = []; // hàng chờ
let revealBusy = false;
const hiddenChicks = new Set(); // gà con chưa "ra mắt": xong màn nở mới chui ra sân
const eggShells = new Map(); // id trứng đang ấp → màu vỏ (nở rồi thì state không còn quả trứng)
const rvBody = () => $("#reveal-body");
const queueReveal = (r) => reveals.push(r);

function rvShow(html) {
  const dlg = $("#reveal");
  rvBody().innerHTML = html;
  if (!dlg.open) dlg.showModal();
  for (const el of rvBody().querySelectorAll(".rv-art, .rv-egg, .rv-seed .egg")) zoomArt(el);
  rvBody().querySelector(".rv-actions button, .rv-egg")?.focus({ preventScroll: true });
}
// Trứng và gà con chỉ chiếm một góc của bản vẽ 200×200: thu khung nhìn lại quanh hình cho vừa khung.
function zoomArt(host) {
  const svg = host?.matches?.("svg") ? host : host?.querySelector("svg");
  try {
    const b = svg.getBBox();
    if (!(b.width > 0 && b.height > 0)) return;
    const side = Math.max(b.width, b.height) * 1.14;
    svg.setAttribute("viewBox", `${(b.x + b.width / 2 - side / 2).toFixed(1)} ${(b.y + b.height / 2 - side / 2).toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}`);
  } catch {} // chưa vẽ xong / trình duyệt không đo được: giữ nguyên
}
// Chờ người chơi bấm một nút [data-go] (hoặc hết `ms` → trả về `idle`).
function rvWait(ms = 0, idle = "idle") {
  return new Promise((done) => {
    let timer = 0;
    const finish = (v) => {
      clearTimeout(timer);
      rvBody().removeEventListener("click", onClick);
      done(v);
    };
    const onClick = (ev) => {
      const b = ev.target.closest("[data-go]");
      if (b) finish(b.dataset.go);
    };
    rvBody().addEventListener("click", onClick);
    if (ms) timer = setTimeout(() => finish(idle), ms);
  });
}
async function pumpReveals() {
  if (revealBusy || !reveals.length || drag || !state) return;
  revealBusy = true;
  try {
    while (reveals.length) {
      const r = reveals.shift();
      await REVEAL[r.kind]?.(r);
    }
  } finally {
    revealBusy = false;
    const dlg = $("#reveal");
    if (dlg.open) dlg.close();
    rvBody().innerHTML = "";
    syncYard();
    renderAll();
  }
}
$("#reveal").addEventListener("cancel", (e) => e.preventDefault()); // Esc không bỏ dở màn (mỗi màn có nút riêng)

// Độ quý của một bộ gen (chỉ để trình diễn): đặc điểm càng hiếm càng nặng điểm.
// Ngưỡng chỉnh theo 20.000 bộ gen ngẫu nhiên: thường ~60%, đẹp ~26%, quý ~11%, huyền thoại ~3%.
const RARE_W = { silkie: 5, splash: 5, fiveToes: 3, rumpless: 3, frizzle: 3, longTail: 3, mottled: 2, spangled: 2, laced: 2, barred: 2, darkSkin: 2, crest: 2, muff: 2, feetFeather: 2, blue: 1.5, rose: 0.5, pea: 0.5, walnut: 0.5 };
const TIERS = [[12, 4, "Gà huyền thoại"], [9, 3, "Gà quý"], [6, 2, "Gà đẹp"], [0, 1, "Gà thường"]];
const TIER_COLORS = { 1: ["#fff", "#ffe9a6", "#cfd8dc"], 2: ["#7fd0ff", "#fff", "#bfe6ff"], 3: ["#d0a8ff", "#fff", "#f0b3ff"], 4: ["#ffd95a", "#fff3b0", "#ff9d5c"] };
function tierOf(code) {
  const score = R.dexKeysOf(code).reduce((a, k) => a + (RARE_W[k] ?? 1), 0);
  const [, n, name] = TIERS.find(([min]) => score >= min);
  return { n, name };
}
const BREED_TIER = ["", "Giống đẹp", "Giống quý", "Giống huyền thoại"];
const dexChip = (k, fresh = false) => {
  const d = R.DEX.find((x) => x.key === k);
  return `<li class="rv-chip${fresh ? " new" : ""}"><i style="--c:var(--${d.group})"></i>${esc(d.name)}</li>`;
};
const seedRank = (k) => (k === "premium" ? 3 : k === "odd" ? 2 : k === "common" ? 0 : 1);
const bagArt = (size, n) => (ICONS?.bagIcon ? ICONS.bagIcon(size, n) : "👜");

const REVEAL = {
  // Trứng nứt → chạm 3 lần giúp gà con chui ra → gà con ra mắt: tên, độ quý, đặc điểm mang trong gen.
  async hatch(r) {
    const ch = state.chickens.find((c) => c.id === r.chickenId);
    if (!ch) return void hiddenChicks.delete(r.chickenId);
    const left = reveals.filter((x) => x.kind === "hatch").length;
    const count = left ? `<span class="rv-count">còn ${left} quả nữa</span>` : "";
    const shell = r.shell || "#f3ead8";
    const eggSvg = (crack) => renderEggFlat({ egg: { shell, speckle: 0.15, seed: 7 } }, { crack, label: "Trứng đang nở" });
    rvShow(`${count}<p class="rv-kicker">Trứng đang nứt!</p>
      <button type="button" class="rv-egg" data-go="tap" aria-label="Chạm để giúp gà con chui ra">${eggSvg(0.15)}</button>
      <p class="rv-sub">Chạm vào trứng để giúp gà con chui ra</p>
      <div class="rv-actions"><button type="button" class="plain" data-go="skip">Bỏ qua</button></div>`);
    sfx("crack");
    for (let taps = 0; taps < 3;) {
      const go = await rvWait(6000, "tap");
      if (go === "skip") break;
      taps++;
      sfx("crack");
      buzz(14);
      const egg = rvBody().querySelector(".rv-egg");
      if (!egg) break;
      egg.innerHTML = eggSvg(0.15 + taps * 0.28);
      zoomArt(egg);
      bump(egg, "hit");
      burst(rvBody(), "50%", "42%", { kind: "bit", n: 7, colors: [shell, "#fff", "#e8dcc0"], spread: 90, rise: 10 });
    }
    const ph = express(decodeGenome(ch.code));
    const tier = tierOf(ch.code);
    const keys = R.dexKeysOf(ch.code);
    const st = ph.stats, perks = [];
    if (st.growth >= 0.62) perks.push("Lớn nhanh");
    if (st.hardiness >= 0.62) perks.push("Sống dai");
    if (st.speed >= 0.62) perks.push("Chạy nhanh");
    if (ph.sex === "hen" && st.eggRate >= 0.62) perks.push("Sai trứng");
    const breeds = R.breedsOf(ch.code).map((k) => R.BREEDS.find((b) => b.key === k).name);
    const note = breeds.length
      ? `Mang đủ gen của giống <b>${esc(breeds.join(", "))}</b> — nuôi đủ chất tới lớn là đạt giống!`
      : keys.length ? "Các đặc điểm này hiện rõ dần khi gà lớn — nếu được ăn đủ chất." : "";
    rvShow(`<div class="rv-rays"></div>${count}
      <p class="rv-kicker">${ph.sex === "rooster" ? "Một chú gà trống" : "Một cô gà mái"} chào đời</p>
      <div class="rv-art">${chickenSvg(ch, { detail: "high" }).svg}</div>
      <h2 class="rv-title">${ph.sex === "rooster" ? "♂" : "♀"} ${esc(ch.name)}</h2>
      <span class="rv-tier tier-${tier.n}">${tier.name}</span>
      ${keys.length ? `<ul class="rv-chips" aria-label="Đặc điểm mang trong gen">${keys.map((k) => dexChip(k, r.fresh.includes(k))).join("")}</ul>` : `<p class="rv-sub">Một bé gà mộc mạc — nuôi khéo vẫn đẹp.</p>`}
      ${perks.length ? `<p class="rv-sub">${perks.join(" · ")}</p>` : ""}
      ${note ? `<p class="rv-note">${note}</p>` : ""}
      <div class="rv-actions"><button type="button" class="gold" data-go="ok">Chào ${esc(ch.name)}!</button></div>`);
    sfx("hatch");
    sfx("cheep", 0.55);
    buzz(30);
    confetti($("#reveal"), { colors: [...TIER_COLORS[tier.n], "#e4572e", "#7cc35f"] });
    await rvWait();
    hiddenChicks.delete(r.chickenId);
  },

  // Mở túi: hạt bật ra lần lượt, hạt xoàng trước, hạt quý sau cùng.
  async bag(r) {
    const entries = Object.entries(r.got).sort((a, b) => seedRank(a[0]) - seedRank(b[0]));
    const total = entries.reduce((a, [, n]) => a + n, 0);
    const good = (k) => seedRank(k) >= 2;
    rvShow(`${entries.some(([k]) => good(k)) ? '<div class="rv-rays"></div>' : ""}<p class="rv-kicker">${r.count > 1 ? `Mở ${r.count} túi hạt` : "Mở túi hạt"}</p>
      <div class="rv-art small rv-bag">${bagArt(130)}</div>
      <h2 class="rv-title">${total} hạt</h2>
      <ul class="rv-seeds">${entries.map(([k, n], i) => `<li class="rv-seed${good(k) ? " good" : ""}" style="--i:${i}">${seedIcon(k, 34)}<b>×${n}</b><span>${R.SEEDS[k].name}</span></li>`).join("")}</ul>
      <div class="rv-actions"><button type="button" class="gold" data-go="ok">Cất vào kho</button></div>`);
    sfx("whoosh");
    entries.forEach(([k], i) => sfx(good(k) ? "good" : "pop", 0.38 + i * 0.13));
    if (entries.some(([k]) => good(k))) buzz(20);
    await rvWait();
  },

  // Thưởng nhiệm vụ: túi (mở ngay được), hạt, trứng quà (ấp ngay được nếu còn ổ và chỗ chuồng).
  async reward(r) {
    const g = r.got ?? {};
    const parts = [];
    if (g.bagId) parts.push(`<li class="rv-seed" style="--i:0">${bagArt(34)}<b>Túi ${g.bagSize} hạt</b><span>chưa mở</span></li>`);
    Object.entries(g.seeds ?? {}).forEach(([k, n]) => parts.push(`<li class="rv-seed${seedRank(k) >= 2 ? " good" : ""}" style="--i:${parts.length}">${seedIcon(k, 34)}<b>×${n}</b><span>${R.SEEDS[k].name}</span></li>`));
    const egg = g.eggId && state.eggs.find((e) => e.id === g.eggId);
    if (egg) parts.push(`<li class="rv-seed good" style="--i:${parts.length}">${eggArt(egg)}<b>Trứng quà</b><span>có phôi</span></li>`);
    const canIncubate = !!egg && state.incubators.includes(null) && state.chickens.length + state.incubators.filter(Boolean).length < state.coopCap;
    const title = r.id === "chest" ? "Rương ngày!" : r.id === "tutorial" ? "Xong một bước!" : "Xong việc!";
    const act2 = g.bagId || canIncubate;
    rvShow(`<div class="rv-rays"></div><p class="rv-kicker">Phần thưởng</p>
      <div class="rv-art small">${chestSvg(true)}</div>
      <h2 class="rv-title">${title}</h2>
      ${r.streak > 1 && r.id !== "tutorial" ? `<p class="rv-sub">Chuỗi ${r.streak} ngày liên tiếp</p>` : ""}
      <ul class="rv-seeds">${parts.join("")}</ul>
      ${egg ? `<p class="rv-note">${egg.quick ? "Quả trứng này nở rất nhanh." : "Trứng quà mang một bộ gen ngẫu nhiên."}${canIncubate ? "" : " Trứng nằm trong Kho — ấp khi có ổ trống."}</p>` : ""}
      <div class="rv-actions">
        ${g.bagId ? `<button type="button" class="gold" data-go="open">Mở túi ngay</button>` : ""}
        ${canIncubate ? `<button type="button" class="gold" data-go="incubate">Ấp ngay</button>` : ""}
        <button type="button" class="${act2 ? "plain" : "gold"}" data-go="ok">${act2 ? "Để sau" : "Tuyệt!"}</button>
      </div>`);
    sfx("claim");
    buzz(20);
    confetti($("#reveal"), { n: 26 });
    const go = await rvWait();
    if (go === "open") await openBags([g.bagId], { direct: true });
    if (go === "incubate" && await run(act("incubate", { eggId: g.eggId }), "Trứng quà đã nằm trong ổ ấp — chạm vào trứng để sưởi ấm")) flashZone("nest");
  },

  async milestone(r) {
    rvShow(`<div class="rv-rays"></div><p class="rv-kicker">Sổ sưu tầm</p>
      <div class="rv-art small">${chestSvg(true)}</div>
      <h2 class="rv-title">Đạt mốc ${r.n}!</h2>
      <ul class="rv-list"><li>🏠 Chuồng rộng thêm: <b>${r.coopCap} chỗ</b></li><li>🪺 Ổ ấp: <b>${r.incubators}</b></li><li>🎀 Sân trại có thêm đồ trang trí</li></ul>
      <div class="rv-actions"><button type="button" class="gold" data-go="ok">Tuyệt!</button></div>`);
    sfx("fanfare");
    confetti($("#reveal"));
    await rvWait();
  },

  async breed(r) {
    const b = R.BREEDS.find((x) => x.key === r.key);
    if (!b) return;
    const ch = state.chickens.find((c) => c.id === r.chickenId);
    const bag = state.bags.find((x) => x.id === r.bagId);
    rvShow(`<div class="rv-rays"></div><p class="rv-kicker">Giống mới · ${r.n}/${R.BREEDS.length}</p>
      <div class="rv-art">${ch ? chickenSvg(ch, { detail: "high" }).svg : chestSvg(true)}</div>
      <h2 class="rv-title">${esc(b.name)}</h2>
      <span class="rv-tier tier-${b.tier + 1}">${BREED_TIER[b.tier]}</span>
      <ul class="rv-chips">${b.traits.map((k) => dexChip(k)).join("")}</ul>
      <p class="rv-note">${ch ? `${esc(ch.name)} là con đầu tiên của trại đạt giống này. ` : ""}Tặng một túi quà ${R.CONFIG.breed.bag} hạt và một chiếc nơ treo ở chuồng${r.n === R.CONFIG.breed.incubatorAt ? ", thêm <b>1 ổ ấp</b>" : ""}.</p>
      <div class="rv-actions">${bag ? `<button type="button" class="gold" data-go="open">Mở túi quà</button><button type="button" class="plain" data-go="ok">Để sau</button>` : `<button type="button" class="gold" data-go="ok">Tuyệt!</button>`}</div>`);
    sfx("fanfare");
    buzz(40);
    confetti($("#reveal"), { n: 70 });
    if ((await rvWait()) === "open" && bag) await openBags([bag.id], { direct: true });
  },

  async recap(r) {
    rvShow(`<p class="rv-kicker">Chào mừng trở lại</p>
      <h2 class="rv-title">Khi bạn vắng mặt…</h2>
      ${r.away > 10 * MIN ? `<p class="rv-sub">Bạn rời trại ${fmtDur(r.away)}</p>` : ""}
      <ul class="rv-list">${r.lines.map((l) => `<li>${l}</li>`).join("")}</ul>
      <div class="rv-actions"><button type="button" class="gold" data-go="ok">Vào trại</button></div>`);
    sfx("pop");
    await rvWait();
  },
};

// Mở một hay nhiều túi rồi chiếu màn "mở túi" (gộp hạt của các túi). direct: đang ở trong một màn khác.
async function openBags(ids, { direct = false } = {}) {
  const got = {};
  let n = 0;
  for (const bagId of ids) {
    const r = await act("openBag", { bagId });
    handleEvents(r.events ?? []);
    if (!r.ok) {
      sfx("error");
      toast(r.message);
      break;
    }
    n++;
    for (const [k, v] of Object.entries(r.got)) got[k] = (got[k] ?? 0) + v;
  }
  save();
  renderAll();
  if (!n) return;
  const rv = { kind: "bag", got, count: n };
  if (direct) await REVEAL.bag(rv);
  else {
    queueReveal(rv);
    pumpReveals();
  }
}

/* ---------- thanh tài nguyên ---------- */

let resPrev = null;
function renderRes() {
  const seeds = Object.values(state.inventory).reduce((a, b) => a + b, 0);
  const eggs = state.eggs.filter((e) => e.hatchAt === null);
  const stored = eggs.filter((e) => !e.inYard).length;
  setHTML($("#res"), `
    <button type="button" class="chip" data-res="seeds" data-open="store" title="Hạt trong kho" aria-label="${seeds} hạt trong kho">${seedIcon("common", 16)} ${seeds}</button>
    <button type="button" class="chip" data-res="eggs" data-open="store" title="Trứng trong kho / tổng (sân + kho)" aria-label="${stored} trứng trong kho, tổng ${eggs.length}/${R.CONFIG.storage.eggs}">🥚 ${stored} · ${eggs.length}/${R.CONFIG.storage.eggs}</button>
    <button type="button" class="chip" data-res="bags" data-open="store" title="Túi hạt chưa mở" aria-label="${state.bags.length} túi hạt chưa mở">${bagArt(16)} ${state.bags.length}</button>
    <span class="chip" data-res="chickens" title="Gà trong trại" aria-label="${state.chickens.length}/${state.coopCap} gà trong trại">🐔 ${state.chickens.length}/${state.coopCap}</span>`);
  $("#clock").textContent = `Giờ trong game: ${new Date(now()).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`;
  // số vừa tăng thì nảy lên một cái
  const cur = { seeds, eggs: eggs.length, bags: state.bags.length, chickens: state.chickens.length };
  if (resPrev) for (const k of Object.keys(cur)) if (cur[k] > resPrev[k]) bump($(`#res [data-res="${k}"]`));
  resPrev = cur;
}
$("#res").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-open=store]")) openStore();
});

/* ---------- sân trại: các điểm thả ---------- */

const DEFAULT_SPOTS = {
  coop: { x: 108, y: 82, r: 74 },
  coopDoor: { x: 95, y: 95, r: 55 },
  feeder: { x: 330, y: 120, r: 42 },
  water: { x: 430, y: 118, r: 30 },
  nest: { x: 610, y: 95, r: 60 },
  gate: { x: 765, y: 210, r: 55 },
  market: { x: 110, y: 415, r: 58 },
};
const SPOTS = {};
for (const [k, d] of Object.entries(DEFAULT_SPOTS)) SPOTS[k] = { ...d, ...(ICONS?.YARD_SPOTS?.[k] || {}) };
for (const s of Object.values(SPOTS)) s.r ??= 50;
const ZONES = [
  { key: "gate", label: "Cổng · Cánh đồng", accepts: ["chicken"], aria: "Cổng: xem cánh đồng. Kéo gà vào đây để thả ra đồng" },
  { key: "market", label: "Chợ", accepts: ["chicken", "egg"], aria: "Chợ: kéo gà hoặc trứng vào để đổi" },
  { key: "coop", label: "Chuồng · Kho", accepts: ["egg"], aria: "Chuồng: mở Kho. Kéo trứng vào để cất" },
  { key: "feeder", label: "Máng ăn", accepts: ["chicken"], aria: "Máng ăn: kéo gà vào để tự chọn hạt" },
];

function renderZones() {
  $("#yard-zones").innerHTML = ZONES.map((z) => {
    const s = SPOTS[z.key];
    return `<div class="zone" role="button" tabindex="0" aria-label="${z.aria}" data-zone="${z.key}" data-accepts="${z.accepts.join(" ")}" style="left:${(s.x / W) * 100}%;top:${(s.y / H) * 100}%;width:${((2 * s.r) / W) * 100}%;height:${((2 * s.r) / H) * 100}%"><span class="label">${z.label}</span></div>`;
  }).join("");
}
function zoneTap(z) {
  if (!state) return;
  if (z === "gate") {
    const out = state.chickens.find((c) => c.location === "field");
    if (out) showField();
    else toast("Kéo một con gà ra cổng để thả ra cánh đồng");
  }
  if (z === "coop") openStore();
  if (z === "market") toast("Kéo gà hoặc trứng vào chợ để đổi lấy hạt / trứng");
  if (z === "feeder") toast("Kéo gà vào máng: tự chọn hạt hợp với gà nhất");
}
$("#yard-zones").addEventListener("click", (ev) => zoneTap(ev.target.closest("[data-zone]")?.dataset.zone));
// bàn phím: Enter / Space trên điểm thả hoặc trứng ngoài sân
function onKeyActivate(host, fn) {
  host.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const el = ev.target.closest("[tabindex]");
    if (!el) return;
    ev.preventDefault();
    fn(el);
  });
}
onKeyActivate($("#yard-zones"), (el) => zoneTap(el.dataset.zone));
onKeyActivate($("#yard-eggs"), (el) => collectWithAnim(el.dataset.id));
// hiệu ứng "trúng" ở điểm thả sau khi thả thành công
function flashZone(key) {
  const el = key === "nest" ? $("#yard-nests .nest") : $(`#yard-zones [data-zone="${key}"]`);
  if (!el) return;
  el.classList.remove("hit");
  void el.offsetWidth;
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 600);
}

function nestSlots() {
  const n = state.incubators.length, s = SPOTS.nest;
  // ổ đầu tiên ở góc rơm, các ổ thêm xếp lùi sang trái (không lấn ra cổng)
  return state.incubators.map((id, i) => ({ id, i, x: s.x - i * 74, y: s.y + (i % 2) * 8 }));
}
function renderNests() {
  const host = $("#yard-nests");
  const slots = nestSlots();
  while (host.children.length > slots.length) host.lastElementChild.remove();
  const t = now();
  const warmQuest = hasV6() && R.TUTORIAL[state.quest.step]?.key === "warm" && state.count.warm < R.TUTORIAL[state.quest.step].goal;
  for (const { id, i, x, y } of slots) {
    let el = host.children[i];
    if (!el) {
      el = document.createElement("div");
      el.className = "nest";
      el.dataset.nest = i;
      el.innerHTML = '<div class="nest-art"></div><div class="nest-crack"></div><span class="eta"></span><span class="pips" hidden></span>';
      host.append(el);
    }
    const egg = id && state.eggs.find((e) => e.id === id);
    if (egg) eggShells.set(egg.id, egg.shell);
    const total = egg ? egg.incubateMs ?? R.incubateMsOf(egg.code) : 1;
    const p = egg ? clampN(1 - (egg.hatchAt - t) / total, 0, 1) : 0;
    // hình vẽ lại theo nấc 2% (không vẽ lại mỗi khung → hoạt cảnh không giật, chạm không trượt)
    const artKey = egg ? `${egg.shell}|${Math.round(p * 50)}` : "free";
    if (el._art !== artKey) {
      el._art = artKey;
      el.querySelector(".nest-art").innerHTML = ICONS?.incubatorIcon ? ICONS.incubatorIcon({ egg: egg ? egg.shell : null, progress: p }, 96) : egg ? eggArt(egg) : "";
    }
    const crack = !egg ? 0 : p >= 0.93 ? 3 : p >= 0.8 ? 2 : p >= 0.62 ? 1 : 0;
    if (el._crack !== crack) {
      el._crack = crack;
      el.querySelector(".nest-crack").innerHTML = crack ? nestCrackSvg(crack) : "";
    }
    const eta = egg ? `Nở sau ${fmtEta(Math.max(0, egg.hatchAt - t))}` : "Ổ ấp trống";
    const warmed = egg?.warmed ?? 0, max = R.CONFIG.warm.max;
    const tip = egg && hasV6() ? (warmed >= max ? `${eta} — đã sưởi đủ ấm` : `${eta} — chạm để sưởi ấm (${warmed}/${max})`) : eta;
    if (el.title !== tip) {
      el.title = tip;
      el.setAttribute("aria-label", tip);
    }
    el.setAttribute("role", egg ? "button" : "img");
    el.tabIndex = egg ? 0 : -1;
    el.dataset.egg = egg?.id ?? "";
    el.classList.toggle("free", !egg);
    el.classList.toggle("soon", p >= 0.8);
    el.classList.toggle("maxed", warmed >= max);
    el.classList.toggle("hint", !!egg && warmQuest && !el.classList.contains("cooling"));
    const etaText = !egg ? "Ổ ấp" : egg.hatchAt <= t ? "đang nở…" : eta.replace("Nở sau ", "");
    const etaEl = el.querySelector(".eta");
    if (etaEl.textContent !== etaText) etaEl.textContent = etaText;
    const pips = el.querySelector(".pips");
    pips.hidden = !egg || !warmed;
    const pipText = warmed >= max ? "♨ đủ ấm" : `♨ ${warmed}/${max}`;
    if (pips.textContent !== pipText) pips.textContent = pipText;
    el.style.left = `${(x / W) * 100}%`;
    el.style.top = `${(y / H) * 100}%`;
  }
}

// Sưởi trứng: chạm trứng trong ổ. Luật giới hạn nhịp chạm và số lần; ở đây chỉ trình diễn.
let warmBusy = false;
async function warmTap(el) {
  const eggId = el?.dataset.egg;
  const egg = eggId && state.eggs.find((e) => e.id === eggId);
  if (!egg || egg.hatchAt === null || !hasV6() || drag?.active) return;
  if ((egg.warmed ?? 0) >= R.CONFIG.warm.max) {
    bump(el, "nope");
    if (!el._toldMax) toast("Trứng đã đủ ấm — chờ gà con chui ra nhé");
    el._toldMax = true;
    return;
  }
  if (warmBusy || now() - (egg.warmAt ?? -1e15) < R.CONFIG.warm.cooldownMs) {
    bump(el, "nope");
    sfx("tap");
    return;
  }
  warmBusy = true;
  const before = egg.hatchAt;
  const r = await act("warmEgg", { eggId });
  warmBusy = false;
  handleEvents(r.events ?? []);
  if (!r.ok) {
    if (r.code !== "too_fast" && r.code !== "no_egg") toast(r.message);
    return renderAll();
  }
  sfx("warm");
  buzz(10);
  const slot = nestSlots().find((n) => n.id === eggId);
  if (slot) {
    burst($("#yard-pops"), `${(slot.x / W) * 100}%`, `${((slot.y - 8) / H) * 100}%`, { kind: "heat", n: 7, colors: ["#ff9d5c", "#ffd95a", "#ff7a59"], spread: 26, rise: 40, life: 800 });
    const cut = Math.round((before - r.hatchAt) / 1000);
    popIn("#yard-pops", slot.x, slot.y - 44, cut >= 60 ? `Ấm hơn! −${Math.round(cut / 60)} phút` : `Ấm hơn! −${cut} giây`);
  }
  bump(el, "warmed");
  el.classList.remove("hint");
  el.classList.add("cooling");
  setTimeout(() => el.classList.remove("cooling"), R.CONFIG.warm.cooldownMs);
  save();
  renderAll();
}
$("#yard-nests").addEventListener("pointerdown", (ev) => {
  if (ev.button > 0) return;
  warmTap(ev.target.closest(".nest"));
});
onKeyActivate($("#yard-nests"), (el) => warmTap(el));

/* ---------- trứng ngoài sân ---------- */

function renderYardEggs() {
  const host = $("#yard-eggs");
  const eggs = state.eggs.filter((e) => e.inYard && e.hatchAt === null);
  const want = new Set(eggs.map((e) => e.id));
  for (const el of [...host.children]) if (!want.has(el.dataset.id) && !el.classList.contains("collect")) el.remove();
  for (const e of eggs) {
    let el = host.querySelector(`[data-id="${e.id}"]`);
    ui.eggPos[e.id] ??= randomEggSpot(e.id);
    if (!el) {
      el = document.createElement("div");
      el.className = `yegg${e.fertile ? " fertile" : ""}`;
      el.dataset.id = e.id;
      el.dataset.drag = "egg";
      el.title = e.fertile ? "Trứng có phôi — chạm để nhặt, kéo vào ổ để ấp" : "Trứng không phôi — chạm để nhặt (chỉ để đổi hạt)";
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.setAttribute("aria-label", `${e.fertile ? "Trứng có phôi" : "Trứng không phôi"} ngoài sân — nhặt vào kho`);
      el.innerHTML = yardEggArt(e);
      host.append(el);
    }
    el.style.left = `${(ui.eggPos[e.id].x / W) * 100}%`;
    el.style.top = `${(ui.eggPos[e.id].y / H) * 100}%`;
  }
}
async function collectWithAnim(eggId) {
  const el = $(`#yard-eggs [data-id="${eggId}"]`);
  const box = el?.getBoundingClientRect();
  if (await run(act("collectEgg", { eggId }))) {
    sfx("pop");
    buzz(8);
    if (el) {
      // quả trứng bay về ô "trứng" trên thanh tài nguyên
      flyTo(el.innerHTML, box.left + box.width / 2, box.top + box.height / 2, $('#res [data-res="eggs"]'), { size: Math.max(30, box.width) });
      el.remove();
    }
  }
}

/* ---------- sân trại: gà đi lại (chỉ để ngắm, không ảnh hưởng luật) ---------- */

let yard = null;
let yardLastReal = 0;
const yardEls = new Map();
let held = null; // gà đang bị kéo

// seed cho phần trang trí (nền, đường đi của gà). Online không có state.seed (server giữ bí mật).
const sceneSeed = () => (state.seed ?? Math.floor((state.createdAt ?? 1) / 1000)) >>> 0;
function ensureYard() {
  if (yard) return;
  yard = createField({ seed: (sceneSeed() ^ 0x7a2d) >>> 0, spawnPerSec: 0, maxSeeds: 0, top: 110, margin: 60 });
  $("#yard-bg").innerHTML = ICONS?.yardBackdrop ? ICONS.yardBackdrop(W, H, sceneSeed()) : ICONS?.fieldBackdrop ? ICONS.fieldBackdrop(W, H, sceneSeed() + 1) : "";
  renderZones();
}
function syncYard() {
  ensureYard();
  const home = new Set(state.chickens.filter((c) => c.location === "coop").map((c) => c.id));
  for (const id of [...yard.chickens.keys()]) if (!home.has(id)) removeChicken(yard, id);
  const slots = nestSlots();
  for (const ch of state.chickens) {
    if (!home.has(ch.id) || yard.chickens.has(ch.id) || hiddenChicks.has(ch.id)) continue;
    const v = R.chickenView(ch, now());
    const t = fieldTraits(express(decodeGenome(ch.code), v.care));
    let pos = {};
    if (justHatched.has(ch.id)) {
      // gà con chui ra ngay tại ổ ấp
      const s = slots[0] ?? SPOTS.nest;
      pos = { x: s.x, y: s.y + 60 };
      justHatched.delete(ch.id);
      setTimeout(() => {
        popIn("#yard-pops", pos.x, pos.y - 20, "Chiếp chiếp!");
        burst($("#yard-pops"), `${(pos.x / W) * 100}%`, `${((pos.y - 20) / H) * 100}%`, { kind: "star", n: 8, colors: ["#ffd95a", "#fff"] });
      }, 50);
    }
    addChicken(yard, { id: ch.id, speed: t.speed * (0.6 + 0.4 * v.growth01) * 0.7, sight: 0, ...pos });
  }
}
function stepYard(t) {
  if (!yard || view !== "yard" || document.hidden) { yardLastReal = t; return; }
  let dt = Math.min(500, t - yardLastReal);
  yardLastReal = t;
  for (; dt >= FIELD.tickMs; dt -= FIELD.tickMs) tickField(yard);
  yardLastReal -= dt;
  // gà đang bị kéo, hoặc đang được rê hạt lên, đứng yên cho dễ thả trúng
  for (const id of [held, drag?.hover]) {
    const a = id && yard.chickens.get(id);
    if (a) { a.mode = "rest"; a.timer = 1e9; a.target = null; }
  }
  drawChickens(snapshot(yard).chickens, $("#yard-chickens"), yardEls, (c, ch) => {
    if (c.moving) return "walk";
    return ch.satiety <= 0 ? "sit" : "stand";
  });
  for (const [id, el] of yardEls) {
    el.classList.toggle("selected", id === selectedId);
    el.classList.toggle("held", id === held);
    el.classList.toggle("hungry", (state.chickens.find((c) => c.id === id)?.satiety ?? 1) <= 0);
    el.dataset.drag = "chicken";
  }
}

// Vẽ gà của một cảnh; sắp theo y để con phía dưới đè lên con phía trên.
function drawChickens(list, layer, els, poseOf) {
  const live = new Set();
  const phase = Math.floor(performance.now() / 160) % 4;
  list.sort((a, b) => a.y - b.y);
  for (const c of list) {
    const ch = state.chickens.find((x) => x.id === c.id);
    if (!ch) continue;
    live.add(c.id);
    let el = els.get(c.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "fc";
      el.dataset.id = c.id;
      el.innerHTML = `<div class="flip"></div><span class="tag"></span>`;
      els.set(c.id, el);
      layer.append(el);
    }
    el.querySelector(".tag").textContent = ch.name;
    el.style.left = `${(c.x / W) * 100}%`;
    el.style.top = `${(c.y / H) * 100}%`;
    el.style.zIndex = String(Math.round(c.y));
    el.classList.toggle("left", c.dir < 0);
    const pose = poseOf(c, ch);
    const art = chickenSvg(ch, { pose, phase: pose === "walk" ? phase / 4 : 0 });
    const flip = el.querySelector(".flip");
    if (flip.dataset.key !== art.key) {
      flip.innerHTML = art.svg;
      flip.dataset.key = art.key;
    }
  }
  for (const [id, el] of els) if (!live.has(id)) { el.remove(); els.delete(id); }
}

/* ---------- kéo thả (chuột + cảm ứng) ---------- */

let drag = null;
const ghost = $("#ghost");

function toWorld(cx, cy) {
  const r = $("#yard").getBoundingClientRect();
  return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H, inside: cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom };
}
// Màn hình nhỏ: nới vùng nhận thả cho dễ trúng bằng ngón tay (chỉ là giao diện).
const dropSlack = () => ($("#yard").getBoundingClientRect().width < 560 ? 1.3 : 1.1);
function zoneAt(p, kind) {
  const k = dropSlack();
  if (kind === "egg") {
    for (const s of nestSlots()) if (Math.hypot(p.x - s.x, p.y - s.y) <= 50 * k) return { key: "nest", slot: s };
  }
  for (const z of ZONES) {
    if (!z.accepts.includes(kind)) continue;
    const s = SPOTS[z.key];
    if (Math.hypot(p.x - s.x, p.y - s.y) <= s.r * k) return { key: z.key };
  }
  return null;
}
// Xem trước khi đang kéo: thả ở đây sẽ làm gì (ok = có thể thành công).
function dropPreview(d, z, cx, cy) {
  if (d.kind === "seed") {
    const id = chickenAtPoint(cx, cy);
    const ch = id && state.chickens.find((c) => c.id === id);
    return ch ? { text: `Cho ${ch.name} ăn`, ok: true, chickenId: id } : null;
  }
  if (!z) return null;
  if (d.kind === "chicken") {
    if (z.key === "gate") return { text: "Ra cánh đồng", ok: true };
    if (z.key === "market") return { text: "Đổi ở chợ", ok: true };
    if (z.key === "feeder") return Object.values(state.inventory).some((n) => n > 0) ? { text: "Tự chọn hạt", ok: true } : { text: "Kho hết hạt", ok: false };
  }
  if (d.kind === "egg") {
    const egg = state.eggs.find((e) => e.id === d.id);
    if (z.key === "nest") {
      if (z.slot.id) return { text: "Ổ đang ấp", ok: false };
      if (!egg?.fertile) return { text: "Không phôi — không ấp được", ok: false };
      return { text: "Ấp trứng", ok: true };
    }
    if (z.key === "coop") return { text: "Cất vào kho", ok: true };
    if (z.key === "market") return { text: "Đổi túi hạt", ok: true };
  }
  return null;
}
function chickenAtPoint(cx, cy) {
  for (const el of document.elementsFromPoint(cx, cy)) {
    const fc = el.closest?.("#yard .fc");
    if (fc) return fc.dataset.id;
  }
  return null;
}

document.addEventListener("pointerdown", (ev) => {
  const t = ev.target.closest("[data-drag]");
  if (!t || !state || ev.button > 0) return;
  if (t.dataset.drag === "seed" && !(state.inventory[t.dataset.id] > 0)) return;
  drag = { kind: t.dataset.drag, id: t.dataset.id, el: t, x0: ev.clientX, y0: ev.clientY, active: false };
  try { t.setPointerCapture(ev.pointerId); } catch {}
});
document.addEventListener("pointermove", (ev) => {
  if (!drag) return;
  if (!drag.active) {
    if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 7) return;
    drag.active = true;
    document.body.classList.add("dragging", `drag-${drag.kind}`);
    renderHint();
    for (const z of document.querySelectorAll(".zone")) z.classList.toggle("accepts", z.dataset.accepts.split(" ").includes(drag.kind));
    ghost.className = `ghost${drag.kind === "chicken" ? "" : " small"}`;
    if (drag.kind === "chicken") {
      const ch = state.chickens.find((c) => c.id === drag.id);
      held = drag.id;
      ghost.innerHTML = `<div class="flip${drag.el.classList.contains("left") ? " left" : ""}">${chickenSvg(ch, { pose: "walk", phase: 0.25 }).svg}</div>`;
    } else if (drag.kind === "egg") {
      ghost.innerHTML = drag.el.innerHTML;
    } else {
      ghost.innerHTML = seedIcon(drag.id, 44);
    }
    ghost.insertAdjacentHTML("beforeend", '<span class="ghost-label" hidden></span>');
    ghost.hidden = false;
  }
  ghost.style.left = `${ev.clientX}px`;
  ghost.style.top = `${ev.clientY}px`;
  const p = toWorld(ev.clientX, ev.clientY);
  const z = p.inside ? zoneAt(p, drag.kind) : null;
  const pv = dropPreview(drag, z, ev.clientX, ev.clientY);
  for (const el of document.querySelectorAll(".zone")) {
    el.classList.toggle("is-target", el.dataset.zone === z?.key);
    el.classList.toggle("is-bad", el.dataset.zone === z?.key && pv?.ok === false);
  }
  for (const el of document.querySelectorAll("#yard-nests .nest")) {
    const on = z?.key === "nest" && Number(el.dataset.nest) === z.slot.i;
    el.classList.toggle("is-target", on);
    el.classList.toggle("is-bad", on && pv?.ok === false);
  }
  if (drag.kind === "seed") {
    if (drag.hover && drag.hover !== pv?.chickenId) {
      const a = yard?.chickens.get(drag.hover);
      if (a) a.timer = 400; // thả ra: đi tiếp sau một lúc
    }
    drag.hover = pv?.chickenId ?? null;
    for (const [id, el] of yardEls) el.classList.toggle("selected", id === pv?.chickenId || id === selectedId);
  }
  ghost.classList.toggle("bad", pv?.ok === false);
  ghost.classList.toggle("good", pv?.ok === true);
  const label = ghost.querySelector(".ghost-label");
  if (label) {
    label.hidden = !pv;
    if (pv && label.textContent !== pv.text) label.textContent = pv.text;
    // giữ nhãn trong màn hình (cổng nằm sát mép phải)
    if (pv) {
      const w = label.offsetWidth;
      const cx = clampN(ev.clientX, w / 2 + 8, innerWidth - w / 2 - 8);
      label.style.marginLeft = `${Math.round(cx - ev.clientX)}px`;
    }
  }
});
function endDrag(ev, cancelled = false) {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.classList.remove("dragging", "drag-chicken", "drag-egg", "drag-seed");
  ghost.hidden = true;
  // gà bị giữ đứng yên lúc kéo: cho đi lại sau một lúc (kể cả khi huỷ / thả vào chợ rồi thôi)
  for (const id of [held, d.hover]) {
    const a = id && yard?.chickens.get(id);
    if (a && a.timer > 1e6) a.timer = 800;
  }
  held = null;
  for (const el of document.querySelectorAll(".zone, #yard-nests .nest")) el.classList.remove("is-target", "is-bad", "accepts");
  renderHint();
  if (cancelled) return;
  if (!d.active) return onTap(d);
  onDrop(d, ev.clientX, ev.clientY);
}
document.addEventListener("pointerup", (ev) => endDrag(ev));
document.addEventListener("pointercancel", (ev) => endDrag(ev, true));

function onTap(d) {
  if (d.kind === "chicken") {
    select(d.id);
    chickenFx(d.id, { n: 4 });
    voice(d.id);
    // bảng thông tin nằm dưới khay: kéo vào tầm nhìn nếu đang khuất (nhất là trên điện thoại)
    const r = $("#info").getBoundingClientRect();
    if (r.bottom > innerHeight) $("#info").scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
  } else if (d.kind === "egg") collectWithAnim(d.id);
  else if (d.kind === "seed") toast(selectedId ? "Kéo hạt thả lên gà — hoặc bấm “Cho ăn” trong bảng của gà" : "Kéo hạt thả lên một con gà để cho ăn");
}

async function onDrop(d, cx, cy) {
  const p = toWorld(cx, cy);
  if (d.kind === "seed") {
    const id = chickenAtPoint(cx, cy) ?? d.hover;
    if (!id) return toast("Thả hạt lên một con gà trong sân");
    const ch = state.chickens.find((c) => c.id === id);
    if (await run(act("feed", { chickenId: id, seed: d.id }))) {
      chickenFx(id, { text: `Ăn ${R.SEEDS[d.id].name.toLowerCase()}`, colors: [SEED_COLOR[d.id], "#ff9db0", "#fff"] });
      sfx("peck");
      sfx("peck", 0.12);
      select(ch.id);
    }
    return;
  }
  if (!p.inside) return;
  const z = zoneAt(p, d.kind);
  if (d.kind === "chicken") {
    const ch = state.chickens.find((c) => c.id === d.id);
    if (!ch) return;
    if (z?.key === "gate") {
      flashZone("gate");
      if (await sendToField(ch.id)) showField();
      return;
    }
    if (z?.key === "market") return openTrade({ chickenId: ch.id });
    if (z?.key === "feeder") {
      flashZone("feeder");
      return autoFeed(ch.id);
    }
    // thả xuống chỗ khác trong sân
    const a = yard?.chickens.get(ch.id);
    if (a) {
      a.x = clampN(p.x, 60, W - 60);
      a.y = clampN(p.y + 30, 120, H - 50);
      a.mode = "rest";
      a.timer = 800;
      a.wander = null;
    }
    return;
  }
  if (d.kind === "egg") {
    const egg = state.eggs.find((e) => e.id === d.id);
    if (!egg) return;
    if (z?.key === "nest") {
      if (await run(act("incubate", { eggId: egg.id }), "Đã đặt trứng vào ổ ấp")) {
        delete ui.eggPos[egg.id];
        flashZone("nest");
      }
      return;
    }
    if (z?.key === "market") return openTrade({ eggId: egg.id });
    if (z?.key === "coop") {
      flashZone("coop");
      return collectWithAnim(egg.id);
    }
    ui.eggPos[egg.id] = { x: clampN(p.x, 60, W - 60), y: clampN(p.y, 140, H - 30) };
    save();
    renderYardEggs();
  }
}

// Gà vào máng: chọn hạt bù đúng chất đang thiếu nhất (ăn tới khi no, tối đa 4 hạt).
async function autoFeed(id, announce = false) {
  let fed = 0;
  for (let i = 0; i < 4; i++) {
    const ch = state.chickens.find((c) => c.id === id);
    const kinds = Object.keys(R.SEEDS).filter((k) => state.inventory[k] > 0 && k !== "odd");
    if (!kinds.length) break;
    const score = (k) => {
      const s = R.SEEDS[k];
      let v = 0;
      for (const n of R.NUTRIENTS) v += Math.min(Math.max(0, R.CONFIG.nutrientFull - ch.n[n]), s.n[n]);
      return v + (k === "common" ? 0.5 : 0); // hoà điểm thì tiết kiệm hạt quý
    };
    kinds.sort((a, b) => score(b) - score(a));
    const r = await act("feed", { chickenId: id, seed: kinds[0] });
    handleEvents(r.events ?? []);
    if (!r.ok) {
      if (!fed) toast(r.message);
      break;
    }
    fed++;
  }
  if (fed) {
    chickenFx(id, { text: `Ăn ${fed} hạt` });
    for (let i = 0; i < Math.min(fed, 3); i++) sfx("peck", i * 0.12);
    if (announce) toast(`${nameOf(id)} ăn ${fed} hạt`); // bấm nút: sân có thể đang khuất
    save();
    renderAll();
  } else if (!Object.values(state.inventory).some((n) => n > 0)) toast("Kho hết hạt — thả gà ra đồng để kiếm hạt");
}

/* ---------- khay hạt ---------- */

function renderTray() {
  // chỉ hiện loại đang có (hạt thường luôn hiện để người mới biết khay ở đâu)
  const kinds = Object.keys(R.SEEDS).filter((k) => k === "common" || state.inventory[k] > 0);
  const empty = !Object.values(state.inventory).some((n) => n > 0);
  setHTML($("#tray"), kinds.map((k) => {
    const n = state.inventory[k];
    return `<div class="seedbtn${n ? "" : " empty"}" data-drag="seed" data-id="${k}" title="${R.SEEDS[k].name}: ${seedSummary(k)}"><span class="ico">${seedIcon(k, 28)}</span><span><b>${n}</b><small>${SEED_SHORT[k]}</small></span></div>`;
  }).join("") + (empty ? '<span class="tray-empty muted">Hết hạt — thả gà ra <b>cổng</b> để kiếm hạt, hoặc đổi ở <b>chợ</b>.</span>' : ""));
}

/* ---------- chọn gà: bảng thông tin + đàn gà ---------- */

let selectedId = null;
function select(id) {
  selectedId = id;
  renderInfo();
  renderFlock();
}

function renderInfo() {
  const host = $("#info");
  const ch = state.chickens.find((c) => c.id === selectedId);
  if (!ch) {
    host.hidden = true;
    selectedId = null;
    return;
  }
  host.hidden = false;
  if (host.dataset.id !== ch.id) {
    host.dataset.id = ch.id;
    host.innerHTML = `
      <article class="ck">
        <div class="ck-top">
          <div class="ck-art"></div>
          <div><div class="ck-name"></div><div class="ck-sub"></div><div class="ck-badges"></div></div>
          <button type="button" class="small" data-act="close" aria-label="Đóng">✕</button>
        </div>
        <div class="meters">
          <div class="meter m-sat"><span>Độ no</span><div class="progress"><i></i></div></div>
          <div class="meter m-grow"><span>Lớn</span><div class="progress"><i style="--c:var(--ok)"></i></div></div>
          <div class="meter m-life"><span>Tuổi thọ</span><div class="progress"><i style="--c:var(--muted)"></i></div></div>
          <div class="meter m-speed"><span>Tốc độ</span><div class="progress"><i style="--c:var(--accent)"></i></div></div>
          <div class="nutr">${R.NUTRIENTS.map((k) => `<div class="n n-${k}" title="${R.NUTRIENT_INFO[k].name}: ${R.NUTRIENT_INFO[k].grows}"><span>${R.NUTRIENT_INFO[k].name}</span><div class="progress"><i style="--c:${NUT_COLOR[k]}"></i></div></div>`).join("")}</div>
        </div>
        <div class="ck-actions">
          <button type="button" class="small primary" data-act="feed">Cho ăn</button>
          <button type="button" class="small" data-act="auto" title="Như kéo gà vào máng: tự chọn hạt hợp nhất">Máng ăn</button>
          <button type="button" class="small" data-act="field">Ra cánh đồng</button>
          <button type="button" class="small" data-act="trade">Đổi ở chợ</button>
        </div>
      </article>`;
  }
  const v = R.chickenView(ch, now());
  const art = chickenSvg(ch);
  const artEl = host.querySelector(".ck-art");
  if (artEl.dataset.key !== art.key) { artEl.innerHTML = art.svg; artEl.dataset.key = art.key; }
  host.querySelector(".ck-name").textContent = `${ch.sex === "rooster" ? "♂" : "♀"} ${ch.name}`;
  host.querySelector(".ck-sub").textContent = `${STAGE[v.stage]} · ${fmtDur(v.ageMs)} tuổi${v.stage === "adult" ? "" : ` · lớn sau ~${fmtDur(R.msToAdult(ch))}`}`;
  const b = [];
  if (ch.location === "field") b.push('<span class="badge ok">Đang ngoài đồng</span>');
  if (v.hungry) b.push('<span class="badge bad">Đói — chóng già</span>');
  else if (v.satiety01 < 0.3) b.push('<span class="badge warn">Sắp đói</span>');
  if (ch.sex === "hen" && v.stage === "adult") b.push(v.canLay ? '<span class="badge ok">Có thể đẻ</span>' : '<span class="badge">Chưa đủ no để đẻ</span>');
  if (ch.mutationBoost > 0) b.push('<span class="badge">Dễ biến dị</span>');
  for (const k of R.breedsOf(ch.code)) {
    const br = R.BREEDS.find((x) => x.key === k);
    b.push(`<span class="badge gold" title="${br.traits.map((t) => R.DEX.find((d) => d.key === t).name).join(" + ")}">${v.stage === "adult" && state.breeds?.[k] != null ? "Giống" : "Mang gen giống"} ${esc(br.name)}</span>`);
  }
  if (ch.line?.length) b.push(`<span class="badge" title="Bố mẹ đều mang: ${ch.line.map((t) => R.DEX.find((d) => d.key === t)?.name ?? t).join(", ")} — nuôi đủ chất sẽ đạt ★★★">Dòng thuần</span>`);
  host.querySelector(".ck-badges").innerHTML = b.join(" ");
  host.querySelector(".m-sat").classList.toggle("hungry", v.hungry);
  host.querySelector(".m-sat i").style.setProperty("--v", v.satiety01.toFixed(3));
  host.querySelector(".m-grow i").style.setProperty("--v", v.growth01.toFixed(3));
  host.querySelector(".m-life i").style.setProperty("--v", Math.max(0, v.lifeLeftMs / ch.lifespanMs).toFixed(3));
  host.querySelector(".m-life span").textContent = `Còn ~${fmtDur(Math.max(0, v.lifeLeftMs))}`;
  host.querySelector(".m-speed i").style.setProperty("--v", v.speed01.toFixed(3));
  host.querySelector(".m-speed span").textContent = `Tốc độ ${Math.round(1 + v.speed01 * 9)}/10`;
  for (const k of R.NUTRIENTS) host.querySelector(`.n-${k} i`).style.setProperty("--v", v.nutrients01[k].toFixed(3));
  host.querySelector('[data-act="feed"]').disabled = ch.location !== "coop";
  host.querySelector('[data-act="auto"]').disabled = ch.location !== "coop";
  host.querySelector('[data-act="field"]').textContent = ch.location === "field" ? "Xem cánh đồng" : "Ra cánh đồng";
  host.querySelector('[data-act="trade"]').disabled = ch.location !== "coop";
}
$("#info").addEventListener("click", (ev) => {
  const act = ev.target.closest("[data-act]")?.dataset.act;
  const ch = state.chickens.find((c) => c.id === selectedId);
  if (!act || !ch) return;
  if (act === "close") select(null);
  if (act === "feed") openFeed(ch.id);
  if (act === "auto") autoFeed(ch.id, true);
  if (act === "field") {
    if (ch.location === "field") showField();
    else sendToField(ch.id).then((ok) => ok && showField());
  }
  if (act === "trade") openTrade({ chickenId: ch.id });
});

function renderFlock() {
  setHTML($("#flock"), state.chickens.map((c) => {
    const v = R.chickenView(c, now());
    const status = c.location === "field" ? '<span class="where">ngoài đồng</span>' : v.hungry ? '<span class="hungry">đói</span>' : "";
    return `<button type="button" data-pick="${c.id}" aria-pressed="${c.id === selectedId}"><span class="mini">${chickenSvg(c).svg}</span>${c.sex === "rooster" ? "♂" : "♀"} ${esc(c.name)} ${status}</button>`;
  }).join("") || '<span class="muted">Đàn gà: chưa có con nào.</span>');
}
$("#flock").addEventListener("click", (ev) => {
  const id = ev.target.closest("[data-pick]")?.dataset.pick;
  if (id) select(id === selectedId ? null : id);
});

/* ---------- cho ăn (hộp thoại) ---------- */

let feedTarget = null;
function openFeed(chId) {
  feedTarget = chId;
  renderFeed();
  $("#feed-dialog").showModal();
}
function renderFeed() {
  const ch = state.chickens.find((c) => c.id === feedTarget);
  if (!ch) return $("#feed-dialog").close();
  const v = R.chickenView(ch, now());
  $("#feed-title").textContent = `Cho ${ch.name} ăn · độ no ${Math.round(v.satiety01 * 100)}%`;
  const kinds = Object.keys(R.SEEDS).filter((k) => state.inventory[k] > 0);
  $("#feed-list").innerHTML = kinds.length
    ? kinds.map((k) => `<button type="button" data-seed="${k}"><span class="ico">${seedIcon(k, 26)}</span><span><b>${R.SEEDS[k].name}</b><br><small class="muted">${seedSummary(k)}</small></span><b>×${state.inventory[k]}</b></button>`).join("")
    : '<p class="muted">Kho hết hạt. Thả gà ra đồng để kiếm hạt, hoặc đổi trứng lấy túi hạt.</p>';
}
$("#feed-list").addEventListener("click", async (ev) => {
  const k = ev.target.closest("[data-seed]")?.dataset.seed;
  if (!k) return;
  if (await run(act("feed", { chickenId: feedTarget, seed: k }))) {
    chickenFx(feedTarget, { colors: [SEED_COLOR[k], "#ff9db0", "#fff"] });
    sfx("peck");
    sfx("peck", 0.12);
  }
  renderFeed();
});

/* ---------- chợ (hộp thoại) ---------- */

let tradeTarget = null;
function openTrade(t) {
  tradeTarget = t;
  if (t.chickenId) {
    const ch = state.chickens.find((c) => c.id === t.chickenId);
    if (!ch) return;
    $("#trade-title").textContent = `Đổi ${ch.name} ở chợ`;
    $("#trade-note").textContent = "Gà sẽ rời trại. Chọn thứ muốn nhận:";
    $("#trade-bag").textContent = `Lấy túi ${R.chickenTradeValue(ch)} hạt`;
    const adult = R.stageOf(ch) === "adult";
    $("#trade-egg").hidden = false;
    $("#trade-egg").disabled = !adult;
    $("#trade-egg").textContent = adult
      ? `Lấy ${R.CONFIG.trade.eggsPerChicken} trứng ngẫu nhiên có phôi (trống/mái tuỳ may)`
      : `Lấy ${R.CONFIG.trade.eggsPerChicken} trứng có phôi — cần gà đã trưởng thành`;
  } else {
    const egg = state.eggs.find((e) => e.id === t.eggId);
    if (!egg) return;
    $("#trade-title").textContent = `Đổi trứng ${egg.fertile ? "có phôi" : "không phôi"}`;
    $("#trade-note").textContent = egg.fertile ? "Trứng có phôi ấp được ra gà mới — chắc chắn muốn đổi?" : "Trứng không phôi không ấp được, đổi lấy hạt là hợp lý.";
    $("#trade-bag").textContent = `Lấy túi ${R.eggTradeValue()} hạt`;
    $("#trade-egg").hidden = true;
  }
  $("#trade-dialog").showModal();
}
$("#trade-bag").addEventListener("click", async () => {
  const t = tradeTarget;
  $("#trade-dialog").close();
  if (t?.chickenId) await run(act("tradeToShop", { chickens: [t.chickenId] }), "Nhận một túi hạt — mở trong Kho");
  else if (t?.eggId) await run(act("tradeToShop", { eggs: [t.eggId] }), "Nhận túi 2 hạt — mở trong Kho");
  if (t?.chickenId === selectedId) select(null);
  syncYard();
});
$("#trade-egg").addEventListener("click", async () => {
  const t = tradeTarget;
  $("#trade-dialog").close();
  if (t?.chickenId && await run(act("tradeForEgg", { chickenId: t.chickenId }), `Nhận ${R.CONFIG.trade.eggsPerChicken} trứng có phôi — trong Kho, kéo vào ổ để ấp`)) {
    if (t.chickenId === selectedId) select(null);
    syncYard();
  }
});

/* ---------- kho, kỷ niệm (ngăn trượt) ---------- */

function openStore() {
  if (!state) return;
  renderStore();
  $("#store-dialog").showModal();
}
function renderStore() {
  const seeds = Object.values(state.inventory).reduce((a, b) => a + b, 0);
  $("#seed-cap").textContent = `(${seeds}/${R.CONFIG.storage.seeds})`;
  setHTML($("#seeds"), Object.keys(R.SEEDS).map((k) => `<div class="seed-card"><span class="ico">${seedIcon(k, 28)}</span><span>${R.SEEDS[k].name}<small>${seedSummary(k)}</small></span><b>${state.inventory[k]}</b></div>`).join(""));
  setHTML($("#bags"), state.bags.length
    ? state.bags.map((b) => `<div class="item"><div class="art">${bagArt(72, b.size)}</div><div>${b.table === "gift" ? "Túi quà" : "Túi"} ${b.size} hạt</div><button type="button" class="small primary" data-bag="${b.id}">Mở túi</button></div>`).join("")
    : '<p class="muted">Không có túi nào. Kéo gà hoặc trứng vào chợ để đổi lấy túi hạt.</p>');
  $("#open-all-bags").hidden = state.bags.length < 2;
  const stored = state.eggs.filter((e) => e.hatchAt === null && !e.inYard);
  const all = state.eggs.filter((e) => e.hatchAt === null).length;
  $("#egg-cap").textContent = `(${stored.length} trong kho · ${all}/${R.CONFIG.storage.eggs} cả ngoài sân)`;
  const freeSlot = state.incubators.includes(null);
  setHTML($("#eggs"), stored.length
    ? stored.map((e) => `<div class="item"><div class="art">${eggArt(e)}</div><div>${e.fertile ? '<span class="badge ok">Có phôi</span>' : '<span class="badge">Không phôi</span>'}</div>${e.fertile ? `<div class="muted">Ấp ${Math.round(R.incubateMsOf(e.code) / MIN)} phút</div>` : '<div class="muted">Chỉ để đổi hạt</div>'}<div class="row">${e.fertile ? `<button type="button" class="small primary" data-incubate="${e.id}" ${freeSlot ? "" : 'disabled title="Ổ ấp đang bận"'}>Ấp</button>` : ""}<button type="button" class="small" data-trade-egg="${e.id}">Đổi túi 2 hạt</button></div></div>`).join("")
    : '<p class="muted">Kho chưa có trứng. Trứng gà mái đẻ nằm ngoài sân — chạm để nhặt.</p>');
}
$("#store-dialog").addEventListener("click", async (ev) => {
  const t = ev.target;
  if (t.dataset.bag) await openBags([t.dataset.bag]);
  if (t.id === "open-all-bags") await openBags(state.bags.map((b) => b.id));
  if (t.dataset.incubate) await run(act("incubate", { eggId: t.dataset.incubate }), "Đã đặt trứng vào ổ ấp");
  if (t.dataset.tradeEgg) await run(act("tradeToShop", { eggs: [t.dataset.tradeEgg] }), "Nhận túi 2 hạt");
  if ($("#store-dialog").open) renderStore();
});
$("#open-store").addEventListener("click", openStore);

/* ---------- sổ sưu tầm (★ đã nở · ★★ nuôi đủ chất) + mốc mở chuồng (Q13) ---------- */

function renderDex() {
  const dex = state.dex ?? {};
  const done = R.dexStars(state, 2);
  const ms = R.CONFIG.dex.milestones;
  const next = ms[state.milestones ?? 0];
  const prev = (state.milestones ?? 0) > 0 ? ms[state.milestones - 1].at : 0;
  const reward = next ? [next.coop ? `+${next.coop} chỗ chuồng` : "", next.incubators ? `+${next.incubators} ổ ấp` : ""].filter(Boolean).join(", ") : "";
  $("#dex-progress").innerHTML = next
    ? `<p><b>${done}</b> mục ★★ · mốc tiếp theo ở <b>${next.at}</b>: ${reward}</p><div class="progress" role="progressbar" aria-valuemin="${prev}" aria-valuemax="${next.at}" aria-valuenow="${done}"><i style="--p:${Math.round(((done - prev) / (next.at - prev)) * 100)}%"></i></div>`
    : `<p><b>${done}</b> mục ★★ — đã đạt mọi mốc (chuồng ${state.coopCap} chỗ, ${state.incubators.length} ổ ấp).</p>`;
  $("#dex-list").innerHTML = R.DEX.map((d) => {
    const st = dex[d.key] ?? 0;
    const stars = `<span class="stars" aria-label="${st} trên 3 sao">${[1, 2, 3].map((i) => `<span class="${i > st ? "off" : i === 3 ? "s3" : ""}">★</span>`).join("")}</span>`;
    return `<li class="dex-item${st ? "" : " unknown"}"><span class="dot" style="background:var(--${d.group})" title="${esc(R.NUTRIENT_INFO[d.group].name)}"></span><span class="nm">${st ? esc(d.name) : "???"}</span>${stars}</li>`;
  }).join("");
  const got = state.breeds ?? {};
  $("#breed-cap").textContent = `(${Object.keys(got).length}/${R.BREEDS.length})`;
  $("#breed-list").innerHTML = R.BREEDS.map((b) => `<div class="breed${got[b.key] != null ? " got" : ""}"><span class="tier">${BREED_TIER[b.tier]}</span><b>${esc(b.name)}</b><ul>${b.traits.map((t) => `<li class="${dex[t] ? "has" : ""}">${dex[t] ? esc(R.DEX.find((d) => d.key === t).name) : "???"}</li>`).join("")}</ul></div>`).join("");
}
$("#open-dex").addEventListener("click", () => {
  if (!state) return;
  renderDex();
  $("#dex-dialog").showModal();
});

// Chuồng đầy khi ấp → gợi ý đổi con gà sắp hết tuổi lấy túi hạt để có chỗ (luật đổi ở chợ đã có).
function offerRoom() {
  const cands = state.chickens.filter((c) => c.location !== "field");
  if (!cands.length) return false;
  const old = cands.reduce((a, b) => (b.lifespanMs - b.lifeUsed < a.lifespanMs - a.lifeUsed ? b : a));
  const bag = R.chickenTradeValue(old);
  $("#room-text").innerHTML = `Chuồng đã đủ ${state.coopCap} chỗ. Đổi <b>${esc(old.name)}</b> (${R.stageOf(old) === "adult" ? "trưởng thành" : "đang lớn"}, còn ~${fmtDur(old.lifespanMs - old.lifeUsed)} tuổi) lấy túi ${bag} hạt để có chỗ cho gà mới? Mở thêm chỗ chuồng bằng cách hoàn thiện <b>Sổ sưu tầm</b>.`;
  $("#room-yes").textContent = `Đổi ${old.name} lấy túi ${bag} hạt`;
  $("#room-yes").onclick = async () => {
    $("#room-dialog").close();
    await run(act("tradeToShop", { chickens: [old.id] }), `Đã đổi ${old.name} — chuồng có chỗ, đặt trứng vào ổ lại nhé`);
  };
  $("#room-dialog").showModal();
  renderAll();
  return true;
}
$("#open-memorial").addEventListener("click", () => {
  if (!state) return;
  $("#memorial").innerHTML = state.memorial.length
    ? [...state.memorial].reverse().map((m) => `<div class="item"><div class="art">${memorialSvg(m)}</div><b>${esc(m.name)}</b><div class="muted">Sống ${fmtDur(m.diedAt - m.hatchedAt)}${m.starvedMs > HOUR ? ` · từng đói ${fmtDur(m.starvedMs)}` : ""}</div></div>`).join("")
    : '<p class="muted">Chưa có con gà nào rời trại.</p>';
  $("#memorial-dialog").showModal();
});

/* ---------- cánh đồng: chỉ chạy khi đang xem, mỗi lần 1 con ---------- */

let field = null;
let fieldOrigin = 0;
let fieldRunning = false;
const fieldEls = new Map();
const seedEls = new Map();

// Mỗi lần chỉ 1 con ra đồng: chọn con khác thì đổi chỗ (con cũ về chuồng).
async function sendToField(id) {
  const out = state.chickens.find((c) => c.location === "field" && c.id !== id);
  if (out) await act("recall", { chickenId: out.id });
  const ok = await run(act("release", { chickenId: id }));
  if (ok && out) toast(`${out.name} về chuồng, ${nameOf(id)} ra đồng`);
  syncYard();
  return ok;
}
function ensureField() {
  if (field) return;
  field = createField({ seed: (sceneSeed() ^ 0x5eed) >>> 0 });
  if (ICONS?.fieldBackdrop) $("#field-bg").innerHTML = ICONS.fieldBackdrop(W, H, sceneSeed());
}
function startObserving() {
  ensureField();
  fieldOrigin = now() - field.t;
  fieldRunning = true;
  fieldFull = false;
  // đốm sáng đầu tiên: đang ở bước hướng dẫn thì hiện sớm
  scheduleLucky(luckyQuest() ? 3500 : 6000 + Math.random() * 9000);
  syncField();
}

/* đốm sáng: thỉnh thoảng lấp lánh trong cỏ; người chơi chạm → gà chạy tới bới (rules.fieldBonus) */
let lucky = null; // { x, y, el, until, taken }
let luckyNextAt = Infinity; // giờ game
let fieldFull = false; // gà no + kho đầy → gà nằm nghỉ (không mổ vô ích)
const luckyQuest = () => hasV6() && R.TUTORIAL[state.quest.step]?.key === "lucky";
const scheduleLucky = (ms) => { luckyNextAt = now() + ms; };
function clearLucky(fade = false) {
  if (!lucky) return;
  const el = lucky.el;
  lucky = null;
  if (!fade) return el.remove();
  el.classList.add("leaving");
  setTimeout(() => el.remove(), 420);
}
function stepLucky() {
  if (!fieldRunning || !hasV6()) return;
  const t = now();
  const out = state.chickens.find((c) => c.location === "field");
  if (!out) return clearLucky();
  if (lucky) {
    if (!lucky.taken && t > lucky.until) {
      clearLucky(true);
      scheduleLucky(8000 + Math.random() * 12000);
    }
    return;
  }
  if (t < luckyNextAt || t - (state.luckyAt ?? -1e15) < R.CONFIG.lucky.cooldownMs) return;
  const x = 90 + Math.random() * (W - 180), y = 130 + Math.random() * (H - 200);
  const el = document.createElement("button");
  el.type = "button";
  el.className = "lucky";
  el.setAttribute("aria-label", "Đốm sáng — chạm để chỉ cho gà");
  el.innerHTML = sparkleSvg();
  el.style.left = `${(x / W) * 100}%`;
  el.style.top = `${(y / H) * 100}%`;
  $("#field-spots").append(el);
  lucky = { x, y, el, until: t + 11000, taken: false };
  sfx("sparkle");
}
function takeLucky(ev) {
  const out = state?.chickens.find((c) => c.location === "field");
  if (!lucky || lucky.taken || !out || ev.target.closest(".lucky") !== lucky.el) return;
  if (!setLure(field, out.id, lucky.x, lucky.y)) return;
  lucky.taken = true;
  lucky.el.classList.add("taken");
  sfx("tap");
  buzz(8);
}
$("#field-spots").addEventListener("pointerdown", takeLucky); // chạm / chuột: nhận ngay lúc ấn xuống
$("#field-spots").addEventListener("click", takeLucky); // bàn phím (Enter / Space trên nút)
// Gà đã tới đốm sáng: hỏi luật (offline) / server (online) xem bới được gì.
async function resolveLucky(e) {
  const spot = lucky;
  const r = await act("fieldBonus", { chickenId: e.chickenId });
  handleEvents(r.events ?? []);
  if (spot && lucky === spot) clearLucky();
  const at = `${(e.x / W) * 100}%`, top = `${(e.y / H) * 100}%`;
  if (!r.ok) {
    if (r.code === "seeds_full") popIn("#field-pops", e.x, e.y, "Kho đầy");
    else if (r.code === "not_watching" || r.code === "not_in_field") syncField();
    return scheduleLucky(R.CONFIG.lucky.cooldownMs);
  }
  buzz(16);
  if (r.bagId) {
    popIn("#field-pops", e.x, e.y, `Bới được túi ${r.bagSize} hạt!`);
    burst($("#field-pops"), at, top, { kind: "star", n: 14, colors: ["#ffd95a", "#fff", "#ff9d5c"], spread: 60 });
    sfx("claim");
  } else {
    const kinds = Object.keys(r.got);
    popIn("#field-pops", e.x, e.y, `✨ ${Object.entries(r.got).map(([k, n]) => `+${n} ${R.SEEDS[k].name.toLowerCase()}`).join(", ")}`);
    burst($("#field-pops"), at, top, { kind: "star", n: 8, colors: [...kinds.map((k) => SEED_COLOR[k]), "#fff"] });
    sfx(kinds.some((k) => k !== "common") ? "good" : "coin");
  }
  scheduleLucky(R.CONFIG.lucky.cooldownMs + (luckyQuest() ? 1200 : 2000 + Math.random() * 16000));
  save();
  renderAll();
}
// Q4: rời màn hình / về trại → gà tự về chuồng
async function stopObserving({ leaving = false } = {}) {
  if (!fieldRunning) return;
  fieldRunning = false;
  clearLucky();
  luckyNextAt = Infinity;
  // rời trang: gửi kiểu keepalive (server cũng tự gọi gà về khi hết nhịp tim)
  const r = await act("recallAll", {}, leaving ? { keepalive: true } : undefined);
  handleEvents(r.events ?? []);
  if (r.ok && r.recalled?.length) toast(`${r.recalled.map(nameOf).join(", ")} đã về chuồng`);
  syncField();
  save();
}
function syncField() {
  if (!field) return;
  const inField = new Set(state.chickens.filter((c) => c.location === "field").map((c) => c.id));
  for (const id of [...field.chickens.keys()]) if (!inField.has(id)) removeChicken(field, id);
  for (const ch of state.chickens) {
    if (ch.location !== "field" || field.chickens.has(ch.id)) continue;
    const v = R.chickenView(ch, now());
    const t = fieldTraits(express(decodeGenome(ch.code), v.care));
    addChicken(field, { id: ch.id, speed: t.speed * (0.6 + 0.4 * v.growth01), sight: t.sight, x: W - 70, y: H / 2 });
  }
  renderRoster();
}
function renderRoster() {
  const out = state.chickens.find((c) => c.location === "field");
  setHTML($("#field-who"), out
    ? fieldFull
      ? `<b>${esc(out.name)}</b> đã no và <b>kho hạt đầy</b> — gà nằm nghỉ. Về trại cho đàn ăn bớt hạt rồi thả lại nhé.`
      : `<b>${esc(out.name)}</b> đang kiếm ăn (tốc độ ${Math.round(1 + R.chickenView(out, now()).speed01 * 9)}/10)${hasV6() ? ". Thấy <b>đốm sáng</b> thì chạm vào: gà chạy tới bới được hạt tốt" : ""}. Rời màn hình là gà tự về chuồng; no rồi thì hạt nhặt được mang về kho.`
    : "Chưa có gà ngoài đồng — chọn một con bên dưới (mỗi lần chỉ 1 con).");
  setHTML($("#field-roster"), state.chickens.map((c) => `<button type="button" class="small" data-roster="${c.id}" aria-pressed="${c.location === "field"}">${c.sex === "rooster" ? "♂" : "♀"} ${esc(c.name)}</button>`).join("") || '<span class="muted">Chưa có gà để thả.</span>');
}
$("#field-roster").addEventListener("click", async (ev) => {
  const id = ev.target.closest("[data-roster]")?.dataset.roster;
  const c = id && state.chickens.find((x) => x.id === id);
  if (!c) return;
  if (c.location === "field") await run(act("recall", { chickenId: id }));
  else await sendToField(id);
  syncField();
});
function stepField() {
  if (!fieldRunning || !field) return;
  const target = now() - fieldOrigin;
  let n = 0;
  while (field.t + FIELD.tickMs <= target && n < 400) {
    for (const e of tickField(field)) {
      if (e.type === "lure") {
        resolveLucky(e);
        continue;
      }
      const at = fieldOrigin + field.t;
      const tick = field.t;
      // chờ luật (offline) / server (online) trả lời rồi mới đặt thời gian chờ cho gà
      setReadyAt(field, e.chickenId, tick + R.CONFIG.fieldEatCooldownMs);
      act("fieldFind", { chickenId: e.chickenId, seed: e.seed, at }).then((r) => {
        const kind = r.seed ?? e.seed; // online: loại hạt do server tung
        const name = R.SEEDS[kind]?.name.toLowerCase() ?? "hạt";
        if (r.ok) {
          popIn("#field-pops", e.x, e.y, r.action === "ate" ? `Ăn ${name}` : `+${name} về kho`);
          sfx("peck");
          if (kind !== "common") {
            sfx("good", 0.08);
            burst($("#field-pops"), `${(e.x / W) * 100}%`, `${(e.y / H) * 100}%`, { kind: "star", n: 6, colors: [SEED_COLOR[kind], "#fff"] });
          }
          if (fieldFull) { fieldFull = false; renderRoster(); }
        } else if (r.code === "seeds_full") {
          // gà no + kho đầy: nằm nghỉ một lúc lâu thay vì mổ rồi bị từ chối liên tục (design-review H1)
          popIn("#field-pops", e.x, e.y, "Kho đầy");
          const a = field.chickens.get(e.chickenId);
          if (a) { a.mode = "rest"; a.timer = 45000; a.target = null; a.wander = null; }
          setReadyAt(field, e.chickenId, field.t + 45000);
          if (!fieldFull) { fieldFull = true; renderRoster(); }
          return handleEvents(r.events ?? []);
        }
        else if (r.code === "not_watching" || r.code === "not_in_field") syncField();
        handleEvents(r.events ?? []);
        // bị từ chối (kho đầy, đang no…) → gà nghỉ gấp đôi rồi mới tìm tiếp, tránh mổ liên tục vô ích
        if (!r.ok && r.code !== "too_fast") setReadyAt(field, e.chickenId, field.t + 2 * R.CONFIG.fieldEatCooldownMs);
      });
    }
    n++;
  }
  if (n >= 400) fieldOrigin = now() - field.t;
  const snap = snapshot(field);
  const seen = new Set();
  for (const s of snap.seeds) {
    seen.add(s.id);
    if (seedEls.has(s.id)) continue;
    const el = document.createElement("div");
    // online: server mới quyết định loại hạt → mọi hạt trông như nhau, biết loại khi gà mổ trúng
    const look = online ? "common" : s.kind;
    if (ICONS?.fieldSeedSvg) {
      el.className = "seed-dot";
      el.innerHTML = ICONS.fieldSeedSvg(look);
    } else {
      el.className = "seed-dot plain";
      el.style.background = SEED_COLOR[look];
    }
    el.style.left = `${(s.x / W) * 100}%`;
    el.style.top = `${(s.y / H) * 100}%`;
    seedEls.set(s.id, el);
    $("#field-seeds").append(el);
  }
  for (const [id, el] of seedEls) if (!seen.has(id)) { el.remove(); seedEls.delete(id); }
  drawChickens(snap.chickens, $("#field-chickens"), fieldEls, (c) => (c.mode === "peck" ? "peck" : c.moving ? "walk" : fieldFull ? "sit" : "stand"));
  stepLucky();
}

/* ---------- chuyển màn ---------- */

let view = "yard";
function showField() {
  view = "field";
  $("#view-yard").hidden = true;
  $("#view-field").hidden = false;
  startObserving();
  scrollTo({ top: 0 });
}
function showYard() {
  stopObserving();
  view = "yard";
  $("#view-field").hidden = true;
  $("#view-yard").hidden = false;
  syncYard();
  renderAll();
}
$("#back-yard").addEventListener("click", showYard);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopObserving();
    save();
  } else if (view === "field") startObserving();
});
addEventListener("pagehide", () => {
  stopObserving({ leaving: true });
  save();
});

/* ---------- nhiệm vụ: thẻ dưới sân + hộp thoại ---------- */

function rewardText(rw) {
  const parts = [];
  if (rw.bag) parts.push(`${rw.table === "gift" ? "túi quà" : "túi"} ${rw.bag} hạt`);
  const seeds = Object.entries(rw.seeds ?? {});
  if (seeds.length > 2) parts.push(`${seeds.reduce((a, [, n]) => a + n, 0)} hạt giàu chất`);
  else for (const [k, n] of seeds) parts.push(`${n} ${R.SEEDS[k].name.toLowerCase()}`);
  if (rw.egg) parts.push("trứng quà");
  return parts.join(" + ");
}
// Việc đáng chú ý nhất lúc này: thứ nhận thưởng được → bước mở đầu → việc trong ngày.
function questFocus(q) {
  if (q.tutorial?.done) return { ...q.tutorial, kicker: `Bước ${q.tutorial.step + 1}/${q.tutorial.total} · xong!`, ready: true };
  const d = q.daily.find((x) => x.done && !x.claimed);
  if (d) return { ...d, kicker: "Việc hôm nay · xong!", ready: true };
  if (q.chest.done && !q.chest.claimed) return { id: "chest", text: "Mở rương ngày", have: q.daily.length, goal: q.daily.length, reward: q.chest.reward, kicker: "Xong cả việc hôm nay!", ready: true };
  if (q.tutorial) return { ...q.tutorial, kicker: `Bước ${q.tutorial.step + 1}/${q.tutorial.total}` };
  const n = q.daily.find((x) => !x.claimed);
  if (n) return { ...n, kicker: `Việc hôm nay ${q.daily.filter((x) => x.claimed).length + 1}/${q.daily.length}` };
  return null;
}
const questSeen = new Set();
let questPrimed = false;
function renderQuest() {
  const host = $("#quest");
  const on = hasV6();
  $("#open-quests").hidden = !on;
  host.hidden = !on;
  if (!on) return;
  const q = R.questView(state);
  const f = questFocus(q);
  const ready = [q.tutorial?.done && `t${q.tutorial.step}`, ...q.daily.filter((d) => d.done && !d.claimed).map((d) => `d${state.daily.day}:${d.id}`), q.chest.done && !q.chest.claimed && `c${state.daily.day}`].filter(Boolean);
  let fresh = false;
  for (const k of ready) if (!questSeen.has(k)) { questSeen.add(k); fresh = true; }
  $("#quest-dot").hidden = !ready.length;
  host.classList.toggle("ready", !!f?.ready);
  if (!f) {
    setHTML(host, `<button type="button" class="q-main" data-open-quests><span class="q-ico">${flameSvg()}</span><span><span class="q-kicker">Việc hôm nay</span><span class="q-text">Xong hết rồi! Chuỗi ${q.streak} ngày — mai có việc mới.</span></span></button>`);
  } else {
    setHTML(host, `<button type="button" class="q-main" data-open-quests aria-label="${esc(f.kicker)}: ${esc(f.text)} — ${f.have}/${f.goal}"><span class="q-ico">${chestSvg(!!f.ready)}</span><span><span class="q-kicker">${esc(f.kicker)}</span><span class="q-text">${esc(f.text)}</span><span class="q-sub"><span class="q-bar"><i style="--p:${Math.round((f.have / f.goal) * 100)}%"></i></span><span>${f.have}/${f.goal}</span><span class="q-rw">🎁 ${esc(rewardText(f.reward))}</span></span></span></button>${f.ready ? `<button type="button" class="q-claim gold" data-claim="${f.id}">Nhận</button>` : ""}`);
  }
  if (fresh && questPrimed) {
    sfx("coin");
    bump(host);
  }
  questPrimed = true;
}
function renderQuests() {
  const q = R.questView(state);
  const sub = (x) => `<div class="q-sub"><span class="q-bar"><i style="--p:${Math.round((x.have / x.goal) * 100)}%"></i></span><span>${x.have}/${x.goal}</span><span class="q-rw">🎁 ${esc(rewardText(x.reward))}</span></div>`;
  const row = (x) => `<div class="qrow${x.done && !x.claimed ? " done" : ""}${x.claimed ? " claimed" : ""}"><div><b>${esc(x.text)}</b>${sub(x)}</div>${x.claimed ? '<span class="tick">✓ Đã nhận</span>' : `<button type="button" class="small${x.done ? " gold" : ""}" data-claim="${x.id}"${x.done ? "" : " disabled"}>Nhận</button>`}</div>`;
  const t = q.tutorial, c = q.chest;
  const reset = (R.dayIndex(now()) + 1) * DAY - R.CONFIG.daily.tzOffsetMs - now();
  $("#quests-body").innerHTML = `
    <h3 class="section-title">Bước đầu làm trại <span class="muted">${t ? `(${t.step}/${t.total})` : `— đã xong cả ${R.TUTORIAL.length} bước`}</span></h3>
    ${t ? `<div class="qlist">${row(t)}</div>` : ""}
    <h3 class="section-title">Việc hôm nay <span class="muted">(đổi việc sau ${fmtDur(reset)})</span></h3>
    <div class="qlist">${q.daily.map(row).join("")}
      <div class="qrow chest-row${c.done && !c.claimed ? " done" : ""}${c.claimed ? " claimed" : ""}">${chestSvg(c.claimed)}<div><b>Rương ngày</b><div class="q-sub"><span>Xong cả ${q.daily.length} việc để mở · 🎁 ${esc(rewardText(c.reward))}</span></div></div>${c.claimed ? '<span class="tick">✓ Đã mở</span>' : `<button type="button" class="small${c.done ? " gold" : ""}" data-claim="chest"${c.done ? "" : " disabled"}>Mở</button>`}</div>
    </div>
    <div class="streak">${flameSvg()}<span class="n">${q.streak}</span><span>ngày liên tiếp${q.best > q.streak ? ` (kỷ lục ${q.best})` : ""}. Mỗi ngày nhận thưởng ít nhất một việc để giữ chuỗi: rương to dần, cứ ${R.CONFIG.daily.streakEgg} ngày thêm một quả trứng quà.</span></div>`;
}
async function claimQuest(id) {
  const r = await act("claim", { id });
  handleEvents(r.events ?? []);
  if (!r.ok) {
    sfx("error");
    toast(r.message);
    return renderAll();
  }
  save();
  if ($("#quests-dialog").open) $("#quests-dialog").close();
  queueReveal({ kind: "reward", id, got: r.got, streak: r.streak });
  renderAll();
  pumpReveals();
}
function openQuests() {
  if (!state || !hasV6()) return;
  renderQuests();
  $("#quests-dialog").showModal();
}
$("#open-quests").addEventListener("click", openQuests);
$("#quest").addEventListener("click", (ev) => {
  const id = ev.target.closest("[data-claim]")?.dataset.claim;
  if (id) claimQuest(id);
  else if (ev.target.closest("[data-open-quests]")) openQuests();
});
$("#quests-dialog").addEventListener("click", (ev) => {
  const id = ev.target.closest("[data-claim]")?.dataset.claim;
  if (id) claimQuest(id);
});

/* ---------- trang trí sân, bầu trời theo giờ, âm thanh ---------- */

function renderDecor() {
  setHTML($("#yard-decor"), decorItems(R.decorOf(state), sceneSeed()).map((d) => `<div class="decor" data-decor="${d.key}" style="left:${(d.x / W) * 100}%;top:${(d.y / H) * 100}%;width:${(d.w / W) * 100}%">${d.html}</div>`).join(""));
}
function renderSky() {
  const h = new Date(now()).getHours();
  const sky = h < 5 || h >= 19 ? "night" : h < 7 ? "dawn" : h >= 17 ? "dusk" : "day";
  if (document.body.dataset.sky !== sky) document.body.dataset.sky = sky;
}
for (const amb of document.querySelectorAll(".amb")) {
  let h = '<i class="cloud"></i>';
  for (let i = 0; i < 7; i++) h += `<i class="ff" style="left:${(8 + Math.random() * 84).toFixed(1)}%;top:${(22 + Math.random() * 68).toFixed(1)}%;animation-delay:${(-Math.random() * 7).toFixed(1)}s,${(-Math.random() * 2).toFixed(1)}s"></i>`;
  for (let i = 0; i < 2; i++) h += `<i class="bf" style="left:${18 + i * 38}%;top:${44 + i * 20}%;--c:${["#fff6f0", "#ffd95a"][i]};animation-delay:${-i * 8}s"></i>`;
  amb.innerHTML = h;
}
const SPEAKER = (on) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${on ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`;
function renderSound() {
  const b = $("#sound");
  b.innerHTML = SPEAKER(!sound.muted);
  b.setAttribute("aria-pressed", String(!sound.muted));
  b.title = sound.muted ? "Đang tắt tiếng — bấm để bật" : "Đang bật tiếng — bấm để tắt";
}
$("#sound").addEventListener("click", () => {
  sound.toggle();
  renderSound();
});
renderSound();

/* ---------- gợi ý bước tiếp theo (thay dòng hướng dẫn dài) ---------- */

const DRAG_HINT = {
  chicken: "Thả gà vào <b>Cổng</b> (ra đồng), <b>Máng ăn</b> (tự ăn) hoặc <b>Chợ</b> (đổi)",
  egg: "Thả trứng vào <b>ổ ấp</b>, <b>Chuồng</b> (cất kho) hoặc <b>Chợ</b> (đổi)",
  seed: "Thả hạt lên một con gà để cho ăn",
};
function nextStep() {
  if (drag?.active) return DRAG_HINT[drag.kind];
  const t = now();
  const n = (c) => `<b>${esc(c.name)}</b>`;
  const seeds = Object.values(state.inventory).reduce((a, b) => a + b, 0);
  const home = state.chickens.filter((c) => c.location === "coop");
  const out = state.chickens.find((c) => c.location === "field");
  const views = new Map(home.map((c) => [c.id, R.chickenView(c, t)]));
  const yardEggs = state.eggs.filter((e) => e.inYard && e.hatchAt === null);
  const hatching = state.eggs.filter((e) => e.hatchAt !== null).sort((a, b) => a.hatchAt - b.hatchAt);
  const freeNest = state.incubators.includes(null);
  const storedFertile = state.eggs.some((e) => e.hatchAt === null && !e.inYard && e.fertile);
  const hungry = home.find((c) => views.get(c.id).hungry);
  const low = home.find((c) => views.get(c.id).satiety01 < 0.3);
  if (!state.chickens.length) {
    if (hatching.length) return hasV6() && (hatching[0].warmed ?? 0) < R.CONFIG.warm.max
      ? `<b>Chạm vào quả trứng</b> trong ổ (góc phải sân) để sưởi ấm — trứng nở nhanh hơn. Còn ${fmtEta(Math.max(0, hatching[0].hatchAt - t))}`
      : `Trứng đang ấp trong ổ (góc phải sân) — nở sau ${fmtEta(Math.max(0, hatching[0].hatchAt - t))}. Chờ gà con nhé!`;
    if (yardEggs.some((e) => e.fertile) && freeNest) return "Kéo trứng có phôi (chấm xanh) vào <b>ổ ấp</b> để có gà mới";
    if (storedFertile && freeNest) return "Mở <b>Kho</b> và bấm <b>Ấp</b> một trứng có phôi để có gà mới";
    if (state.bags.length) return "Mở túi hạt trong <b>Kho</b>, rồi đổi trứng ở <b>Chợ</b>";
    return "Trại chưa có gà. Mở <b>Kho</b> xem còn trứng có phôi không";
  }
  if (hungry && seeds) return `${n(hungry)} đang đói — kéo hạt từ khay lên gà, hoặc kéo gà vào <b>Máng ăn</b>`;
  if (!seeds && state.bags.length) return `Hết hạt — mở ${state.bags.length} túi hạt trong <b>Kho</b>`;
  if (!seeds && !out && home.length) return "Hết hạt — kéo một con gà ra <b>Cổng</b> để kiếm hạt ngoài cánh đồng";
  if (yardEggs.length) return yardEggs.some((e) => e.fertile) && freeNest
    ? "Có trứng ngoài sân — kéo trứng có phôi (chấm xanh) vào <b>ổ ấp</b>, hoặc chạm để nhặt"
    : "Có trứng ngoài sân — chạm để nhặt vào kho";
  if (low && seeds) return `${n(low)} sắp đói — kéo hạt lên gà để cho ăn`;
  if (state.bags.length) return `Có ${state.bags.length} túi hạt chưa mở — mở trong <b>Kho</b>`;
  if (storedFertile && freeNest) return "Ổ ấp đang trống — mở <b>Kho</b> để ấp trứng có phôi";
  if (out) return `${n(out)} đang ở ngoài đồng — chạm <b>Cổng</b> để xem gà kiếm hạt`;
  if ((state.stats?.hatched ?? 0) <= 1 && !state.memorial?.length) return "Kéo gà ra <b>Cổng</b> để kiếm thêm hạt ngoài cánh đồng · chạm gà để xem chi tiết";
  return "Chạm một con gà để xem độ no, dinh dưỡng và tuổi thọ";
}
function renderHint() {
  if (state) setHTML($("#yard-hint"), nextStep());
}

/* ---------- vòng lặp ---------- */

function renderAll() {
  if (!state) return;
  renderRes();
  renderSky();
  if ($("#quests-dialog").open) renderQuests();
  if (view === "yard") {
    syncYard();
    renderDecor();
    renderQuest();
    renderNests();
    renderYardEggs();
    renderTray();
    renderInfo();
    renderFlock();
    renderHint();
    setHTML($("#log"), logItems.map((l) => `<li>${new Date(l.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} · ${l.text}</li>`).join("") || '<li class="muted">Chưa có gì xảy ra.</li>');
  } else renderRoster();
  if ($("#store-dialog").open) renderStore();
}

let lastTick = 0;
let lastSync = 0, syncing = false, lastWatch = 0;
function frame(t) {
  if (state) {
    if (view === "field") stepField();
    stepYard(t);
    if (t - lastTick > 500 && !drag) {
      lastTick = t;
      if (!online) {
        const ev = R.advance(state, now());
        if (ev.length) {
          handleEvents(ev);
          syncField();
          save();
        }
      }
      renderAll();
      pumpReveals();
    }
    if (online && !document.hidden) {
      // đồng bộ trại với server (server tự tính lười tới giờ của nó); trứng vừa tới giờ nở thì hỏi ngay
      const eggDue = state.eggs.some((e) => e.hatchAt !== null && e.hatchAt <= now());
      if (t - lastSync > (eggDue ? 1000 : 4000) && !syncing && !drag) {
        lastSync = t;
        syncing = true;
        net.farm().then((r) => {
          syncing = false;
          if (!r.ok) return setNetStatus(r.message || r.code);
          setNetStatus(null);
          applyServer(r);
          handleEvents(r.events ?? []);
          syncField();
          renderAll();
        });
      }
      // nhịp tim "đang xem cánh đồng" (server gọi gà về nếu 20 giây không có)
      if (fieldRunning && t - lastWatch > 8000) {
        lastWatch = t;
        net.watch();
      }
    }
  }
  requestAnimationFrame(frame);
}
function setNetStatus(msg) {
  const el = $("#net-status");
  if (!el) return;
  el.hidden = !online;
  el.textContent = msg ? `Mất kết nối: ${msg}` : `Online · ${new URL(SERVER).host}`;
  el.classList.toggle("bad", !!msg);
}

/* ---------- bắt đầu ---------- */

async function showStarterOnline() {
  const r = await net.starters();
  if (!r.ok) return toast(r.message || "Không lấy được trứng khởi đầu");
  const eggs = r.choices ?? [];
  $("#starter-eggs").innerHTML = eggs.map((e, i) => `<button type="button" data-pick="${e.choice ?? i}">${eggArt({ ...e, id: `s${i}`, fertile: true })}<span>${esc(e.shellName)}</span></button>`).join("");
  $("#starter-eggs").onclick = async (ev) => {
    const i = ev.target.closest("[data-pick]")?.dataset.pick;
    if (i == null) return;
    const n = await net.newFarm(Number(i));
    if (!n.ok) return toast(n.message || n.code);
    applyServer(n);
    $("#starter").close();
    await run(act("incubate", { eggId: state.eggs[0].id }), hasV6() ? "Trứng đã nằm trong ổ ấp — chạm vào trứng để sưởi ấm!" : "Trứng đã nằm trong ổ ấp ở góc sân. Chờ trứng nở nhé!");
    syncYard();
  };
  $("#starter").showModal();
}

function showStarter() {
  if (online) return showStarterOnline();
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const eggs = R.starterEggs(seed);
  $("#starter-eggs").innerHTML = eggs.map((e, i) => `<button type="button" data-pick="${i}">${eggArt({ ...e, id: `s${i}${seed}`, fertile: true })}<span>${esc(e.shellName)}</span></button>`).join("");
  $("#starter-eggs").onclick = (ev) => {
    const i = ev.target.closest("[data-pick]")?.dataset.pick;
    if (i == null) return;
    state = R.newGame(seed, now(), Number(i));
    R.incubate(state, state.eggs[0].id, now());
    $("#starter").close();
    sfx("pop");
    toast("Trứng đã nằm trong ổ ấp — chạm vào trứng để sưởi ấm!");
    save();
    syncYard();
    renderAll();
  };
  $("#starter").showModal();
}

for (const b of document.querySelectorAll("#speed [data-speed]")) b.addEventListener("click", () => setSpeed(Number(b.dataset.speed)));
$("#skip-hour").addEventListener("click", () => {
  const wasField = view === "field";
  stopObserving();
  clock.game = now() + HOUR;
  clock.real = performance.now();
  handleEvents(R.advance(state, now()));
  if (wasField) startObserving();
  save();
  renderAll();
});
$("#give-seeds").addEventListener("click", () => {
  state.inventory.premium += 10;
  save();
  renderAll();
});
$("#reset").addEventListener("click", () => {
  if (!confirm(online ? "Bỏ trại trên máy chủ này và bắt đầu trại mới (tài khoản khách mới)?" : "Xoá trại hiện tại và chơi lại từ đầu?")) return;
  if (online) net.forget();
  else localStorage.removeItem(SAVE_KEY);
  state = null; // không thì lúc rời trang (pagehide) save() ghi lại đúng trại vừa xoá
  location.reload();
});
$("#starter").addEventListener("cancel", (e) => e.preventDefault());

// bảng Dev: chọn máy chủ (online) hoặc chơi offline
$("#server-url").value = SERVER ?? "";
$("#server-connect").addEventListener("click", () => {
  const v = $("#server-url").value.trim();
  location.search = v ? `?server=${encodeURIComponent(v)}` : "?server=";
});
for (const id of ["skip-hour", "give-seeds"]) $(`#${id}`).disabled = online;
for (const b of document.querySelectorAll("#speed [data-speed]")) b.disabled = online;

async function startOnline() {
  setNetStatus(null);
  try {
    await net.ensureGuest();
  } catch (e) {
    setNetStatus(e.message);
    return toast(`${e.message} — kiểm tra địa chỉ máy chủ trong bảng Dev`);
  }
  const r = await net.farm();
  if (r.code === "no_farm") return showStarter();
  if (r.status === 401) {
    net.forget(); // token hết hạn / server mới → tạo khách mới
    return startOnline();
  }
  if (!r.ok) {
    setNetStatus(r.message || r.code);
    return toast(r.message || r.code);
  }
  applyServer(r);
  queueRecap(handleEvents(r.events ?? [], { quiet: true }));
  syncYard();
  renderAll();
}

setSpeed(1);
if (online) {
  startOnline();
} else if (load()) {
  queueRecap(handleEvents(R.advance(state, now()), { quiet: true }), awayMs);
  save();
  syncYard();
  renderAll();
} else {
  showStarter();
}
requestAnimationFrame(frame);
