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
import { FIELD, createField, addChicken, removeChicken, tickField, snapshot, fieldTraits, setReadyAt } from "./field.js";

let ICONS = null;
try {
  ICONS = await import("../art/icons.js");
} catch {
  ICONS = null; // chưa có bộ biểu tượng: dùng hình tạm
}

const SAVE_KEY = "trai-ga-game-v1";
const SAVE_COMPAT_MIN = 3; // phiên bản luật cũ nhất mà bản lưu offline còn đọc được (tăng khi đổi cấu trúc state)
const { MIN, HOUR } = R.TIME;
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
    clock.game = raw.gameAt + Math.max(0, Date.now() - raw.realAt);
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
function handleEvents(events) {
  for (const e of events) {
    const key = `${e.type}|${e.at}|${e.chickenId ?? ""}|${e.eggId ?? ""}|${e.key ?? e.n ?? ""}`;
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);
    if (seenEvents.size > 2000) seenEvents.delete(seenEvents.values().next().value);
    let text = "";
    if (e.type === "hatched") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> đã nở!`;
      justHatched.add(e.chickenId);
    } else if (e.type === "juvenile") text = `<b>${esc(nameOf(e.chickenId))}</b> thành gà giò`;
    else if (e.type === "adult") text = `<b>${esc(nameOf(e.chickenId))}</b> đã trưởng thành`;
    else if (e.type === "laid") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> đẻ một trứng ${e.fertile ? "có phôi" : "không phôi"} ngoài sân`;
      const a = yard?.chickens.get(e.chickenId);
      ui.eggPos[e.eggId] = a ? { x: clampN(a.x + (Math.random() - 0.5) * 30, 70, 730), y: clampN(a.y + 6, 150, 440) } : randomEggSpot(e.eggId);
    } else if (e.type === "died") text = `<b>${esc(nameOf(e.chickenId))}</b> đã mất${e.starved ? " (bị bỏ đói)" : " vì tuổi già"}`;
    else if (e.type === "dex") {
      const d = R.DEX.find((x) => x.key === e.key);
      text = e.star === 2 ? `Sổ sưu tầm ★★ <b>${esc(d?.name ?? e.key)}</b> — nuôi đủ chất tới trưởng thành` : `Sổ sưu tầm: mục mới <b>${esc(d?.name ?? e.key)}</b> ★`;
    } else if (e.type === "milestone") text = `Đạt mốc sổ ${e.n}: chuồng ${e.coopCap} chỗ · ${e.incubators} ổ ấp`;
    if (!text) continue;
    logItems.unshift({ at: e.at, text });
    if (["hatched", "adult", "laid", "died", "milestone"].includes(e.type) || (e.type === "dex" && e.star === 2)) toast(text.replace(/<[^>]+>/g, ""));
  }
  logItems.length = Math.min(logItems.length, 50);
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
    toast(result.message);
    renderAll();
    return false;
  }
  if (okText) toast(okText);
  save();
  renderAll();
  return true;
}

/* ---------- thanh tài nguyên ---------- */

function renderRes() {
  const seeds = Object.values(state.inventory).reduce((a, b) => a + b, 0);
  const eggs = state.eggs.filter((e) => e.hatchAt === null);
  const stored = eggs.filter((e) => !e.inYard).length;
  setHTML($("#res"), `
    <button type="button" class="chip" data-open="store" title="Hạt trong kho" aria-label="${seeds} hạt trong kho">${seedIcon("common", 16)} ${seeds}</button>
    <button type="button" class="chip" data-open="store" title="Trứng trong kho / tổng (sân + kho)" aria-label="${stored} trứng trong kho, tổng ${eggs.length}/${R.CONFIG.storage.eggs}">🥚 ${stored} · ${eggs.length}/${R.CONFIG.storage.eggs}</button>
    <button type="button" class="chip" data-open="store" title="Túi hạt chưa mở" aria-label="${state.bags.length} túi hạt chưa mở">${ICONS?.bagIcon ? ICONS.bagIcon(16) : "👜"} ${state.bags.length}</button>
    <span class="chip" title="Gà trong trại" aria-label="${state.chickens.length}/${state.coopCap} gà trong trại">🐔 ${state.chickens.length}/${state.coopCap}</span>`);
  $("#clock").textContent = `Giờ trong game: ${new Date(now()).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`;
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
  setHTML($("#yard-nests"), nestSlots().map(({ id, i, x, y }) => {
    const egg = id && state.eggs.find((e) => e.id === id);
    const total = egg ? R.incubateMsOf(egg.code) : 1;
    const p = egg ? clampN(1 - (egg.hatchAt - now()) / total, 0, 1) : 0;
    const art = ICONS?.incubatorIcon ? ICONS.incubatorIcon({ egg: egg ? egg.shell : null, progress: p }, 96) : egg ? eggArt(egg) : "";
    const eta = egg ? `Nở sau ${fmtDur(Math.max(0, egg.hatchAt - now()))}` : "Ổ ấp trống";
    return `<div class="nest${egg ? "" : " free"}" data-nest="${i}" title="${eta}" role="img" aria-label="${eta}" style="left:${(x / W) * 100}%;top:${(y / H) * 100}%">${art}<span class="eta">${egg ? eta.replace("Nở sau ", "") : "Ổ ấp"}</span></div>`;
  }).join(""));
}

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
  if (await run(act("collectEgg", { eggId }))) {
    if (el) {
      el.classList.add("collect");
      setTimeout(() => el.remove(), 450);
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
    if (!home.has(ch.id) || yard.chickens.has(ch.id)) continue;
    const v = R.chickenView(ch, now());
    const t = fieldTraits(express(decodeGenome(ch.code), v.care));
    let pos = {};
    if (justHatched.has(ch.id)) {
      // gà con chui ra ngay tại ổ ấp
      const s = slots[0] ?? SPOTS.nest;
      pos = { x: s.x, y: s.y + 60 };
      justHatched.delete(ch.id);
      setTimeout(() => popIn("#yard-pops", pos.x, pos.y - 20, "Chiếp chiếp!"), 50);
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
    const a = yard?.chickens.get(d.id);
    if (a) popIn("#yard-pops", a.x, a.y - 70, "♥");
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
      const a = yard?.chickens.get(id);
      if (a) popIn("#yard-pops", a.x, a.y - 70, `Ăn ${R.SEEDS[d.id].name.toLowerCase()}`);
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
    const a = yard?.chickens.get(id);
    if (a) popIn("#yard-pops", a.x, a.y - 70, `Ăn ${fed} hạt`);
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
  await run(act("feed", { chickenId: feedTarget, seed: k }));
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
    ? state.bags.map((b) => `<div class="item"><div class="art">${ICONS?.bagIcon ? ICONS.bagIcon(72, b.size) : "👜"}</div><div>Túi ${b.size} hạt</div><button type="button" class="small primary" data-bag="${b.id}">Mở túi</button></div>`).join("")
    : '<p class="muted">Không có túi nào. Kéo gà hoặc trứng vào chợ để đổi lấy túi hạt.</p>');
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
  if (t.dataset.bag) {
    const r = await act("openBag", { bagId: t.dataset.bag });
    if (r.ok && r.got) toast(`Mở túi: ${Object.entries(r.got).map(([k, n]) => `${n} ${R.SEEDS[k].name.toLowerCase()}`).join(", ")}`);
    await run(r);
  }
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
    const stars = `<span class="stars" aria-label="${st} sao">${"★".repeat(st)}<span class="off">${"★".repeat(2 - st)}</span></span>`;
    return `<li class="dex-item${st ? "" : " unknown"}"><span class="dot" style="background:var(--${d.group})" title="${esc(R.NUTRIENT_INFO[d.group].name)}"></span><span class="nm">${st ? esc(d.name) : "???"}</span>${stars}</li>`;
  }).join("");
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
  syncField();
}
// Q4: rời màn hình / về trại → gà tự về chuồng
async function stopObserving({ leaving = false } = {}) {
  if (!fieldRunning) return;
  fieldRunning = false;
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
    ? `<b>${esc(out.name)}</b> đang kiếm ăn (tốc độ ${Math.round(1 + R.chickenView(out, now()).speed01 * 9)}/10). Gà chỉ kiếm ăn khi bạn đang xem; rời màn hình là gà tự về chuồng. No rồi thì hạt nhặt được mang về kho.`
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
      const at = fieldOrigin + field.t;
      const tick = field.t;
      // chờ luật (offline) / server (online) trả lời rồi mới đặt thời gian chờ cho gà
      setReadyAt(field, e.chickenId, tick + R.CONFIG.fieldEatCooldownMs);
      act("fieldFind", { chickenId: e.chickenId, seed: e.seed, at }).then((r) => {
        const kind = r.seed ?? e.seed; // online: loại hạt do server tung
        const name = R.SEEDS[kind]?.name.toLowerCase() ?? "hạt";
        if (r.ok) popIn("#field-pops", e.x, e.y, r.action === "ate" ? `Ăn ${name}` : `+${name} về kho`);
        else if (r.code === "seeds_full") popIn("#field-pops", e.x, e.y, "Kho đầy");
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
  drawChickens(snap.chickens, $("#field-chickens"), fieldEls, (c) => (c.mode === "peck" ? "peck" : c.moving ? "walk" : "stand"));
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
    if (hatching.length) return `Trứng đang ấp trong ổ (góc phải sân) — nở sau ~${fmtDur(Math.max(0, hatching[0].hatchAt - t))}. Chờ gà con nhé!`;
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
  if (view === "yard") {
    syncYard();
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
    }
    if (online && !document.hidden) {
      // đồng bộ trại với server (server tự tính lười tới giờ của nó)
      if (t - lastSync > 4000 && !syncing && !drag) {
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
    await run(act("incubate", { eggId: state.eggs[0].id }), "Trứng đã nằm trong ổ ấp ở góc sân. Chờ trứng nở nhé!");
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
    toast("Trứng đã nằm trong ổ ấp ở góc sân. Chờ trứng nở nhé!");
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
  handleEvents(r.events ?? []);
  syncYard();
  renderAll();
}

setSpeed(1);
if (online) {
  startOnline();
} else if (load()) {
  handleEvents(R.advance(state, now()));
  save();
  syncYard();
  renderAll();
} else {
  showStarter();
}
requestAnimationFrame(frame);
