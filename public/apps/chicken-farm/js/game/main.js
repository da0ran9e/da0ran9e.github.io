// Trại Gà — client bản M1 (offline, lưu trong trình duyệt).
// Màn hình chính là SÂN TRẠI: gà đi lại; kéo thả bằng chuột hoặc cảm ứng (Pointer Events):
//   gà → cổng: ra cánh đồng (mỗi lần 1 con) · gà → chợ: đổi · gà → máng ăn: tự chọn hạt hợp nhất
//   trứng → ổ ấp: ấp · trứng → chợ: đổi túi hạt · trứng → chuồng / chạm: nhặt vào kho
//   hạt (khay dưới) → gà: cho ăn · chạm gà: xem thông tin
// Luật chơi: rules.js (thuần logic). Cánh đồng: field.js (chỉ chạy khi đang xem).
// Hai chế độ: OFFLINE (luật chạy ngay trong trình duyệt, lưu localStorage) và ONLINE (server M2 có
// thẩm quyền: client chỉ gửi ý định qua act(), hiển thị trại server trả về). Bật online bằng
// ?server=https://… hoặc ô "Máy chủ" trong bảng Dev.
import { express, decodeGenome, randomGenome, mulberry32 } from "../genome.js";
import { createNet } from "./net.js";
import { renderChickenFlat, renderEggFlat } from "../chicken-flat.js";
import * as R from "./rules.js";
import { FIELD, createField, addChicken, removeChicken, tickField, snapshot, fieldTraits, setReadyAt, setLure } from "./field.js";
import { sfx, sound, buzz, burst, confetti, flyTo, bump } from "./fx.js";
import { GAMES, GAME_NAMES, PLAY_STATS } from "./play.js";
import { playIntro as runIntro } from "./intro.js";
import { music } from "./music.js";
import { t as tr, name as tname, errText, lang, setLang, applyI18n, LANG_NAMES } from "./i18n.js";
import { decorItems, sparkleSvg, chestSvg, flameSvg, nestCrackSvg, stallSvg, visitorSvg, playgroundSvg, towerSvg, plantSvg, bedSvg, gardenSvg, ticketSvg, ownedDecor, roadSvg, relicSvg, fieldHorizon } from "../art/decor.js";

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
// chữ trong CSS (::after) theo ngôn ngữ
for (const [k, v] of [["--t-warm", `👆 ${tr("Chạm để sưởi")}`], ["--t-hungry", tr("đói")], ["--t-new", tr("mới")]]) document.documentElement.style.setProperty(k, JSON.stringify(v));
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Tiếng mở / đóng cho các hộp thoại thường (màn "bất ngờ" và đoạn mở đầu có âm thanh riêng).
const QUIET_DIALOGS = new Set(["reveal", "vn", "starter"]);
const showModal0 = HTMLDialogElement.prototype.showModal;
HTMLDialogElement.prototype.showModal = function () {
  if (!this.open && !QUIET_DIALOGS.has(this.id)) sfx("open");
  return showModal0.call(this);
};
document.addEventListener("close", (e) => { if (e.target instanceof HTMLDialogElement && !QUIET_DIALOGS.has(e.target.id)) sfx("close"); }, true);

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
const hasV7 = () => state?.tickets != null; // vé, tháp hạt, khách qua đường, sân chơi
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
  if (ms < MIN) return tr("dưới 1 phút");
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} ${tr("phút")}`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 48) return mm ? `${h} ${tr("giờ")} ${mm} ${tr("phút")}` : `${h} ${tr("giờ")}`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d} ${tr("ngày")} ${hh} ${tr("giờ")}` : `${d} ${tr("ngày")}`;
}
// Thời gian chờ ngắn (trứng sắp nở) thì đếm ngược theo giây cho hồi hộp.
const fmtEta = (ms) => (ms < 2 * MIN ? `${Math.max(1, Math.ceil(ms / 1000))} ${tr("giây")}` : fmtDur(ms));
const LOCALE = lang === "vi" ? "vi-VN" : "en-GB";
const seedName = (k) => tname("seed", k, R.SEEDS[k]?.name);
// lời nhiệm vụ theo ngôn ngữ; thiếu bản dịch thì dùng lời của luật
const questText = (q) => { const k = `quest.${q.key}`, s = tr(k, { n: q.goal }); return s === k ? tr(q.text) : s; };
const STAGE = { chick: tr("Gà con"), juvenile: tr("Gà giò"), adult: tr("Trưởng thành") };
const NUT_COLOR = { protein: "var(--protein)", energy: "var(--energy)", mineral: "var(--mineral)", pigment: "var(--pigment)" };
const seedColor = (k) => ICONS?.seedColor?.(k) ?? "#c9a66b";
const isStaple = (k) => !!R.SEEDS[k]?.staple;
const isOdd = (k) => !!R.SEEDS[k]?.mutation;
// v11: cây trong vườn vẽ theo loài (dáng) + chất của hạt
// hạt có chất kháng: thiếu chất nào thì gà đang lớn ra dáng nào (để nắn dáng cho từng trò chơi)
const LOWER_LOOK = { protein: "lông ngắn, kém bóng", energy: "mình nhỏ, gọn", mineral: "chân ngắn, đứng vững", pigment: "màu lông nhạt" };
const plantSpec = (k) => ({ n: R.SEEDS[k]?.n ?? R.SEEDS.rice.n, form: R.formOf(k) });

function seedIcon(kind, size = 24) {
  if (ICONS?.seedIcon) return ICONS.seedIcon(kind, size);
  return `<svg viewBox="0 0 24 24" role="img" aria-label="${seedName(kind)}"><ellipse cx="12" cy="13" rx="6" ry="8" transform="rotate(-20 12 13)" fill="${seedColor(kind)}"/></svg>`;
}
function seedSummary(kind) {
  const s = R.SEEDS[kind];
  if (!s) return "";
  if (s.staple) return tr("Ít chất, no bụng");
  if (s.mutation) return tr("Tăng biến dị lứa sau");
  const [a, b, c] = Object.entries(s.n).sort((x, y) => y[1] - x[1]);
  const low = R.seedLowers(kind)[0];
  if (low) return `${tr("Giàu")} ${tr(R.NUTRIENT_INFO[a[0]].name).toLowerCase()}, ${tr("kéo {x} xuống", { x: tr(R.NUTRIENT_INFO[low].name).toLowerCase() })} → ${tr(LOWER_LOOK[low])}`;
  const nm = (k) => tr(R.NUTRIENT_INFO[k].name).toLowerCase(), grows = (k) => tr(R.NUTRIENT_INFO[k].grows).split(":")[0].toLowerCase();
  if (c[1] >= a[1] * 0.75) return tr("Giàu cả 4 chất");
  const first = (k) => grows(k).split(",")[0]; // hai chất: mỗi chất một chữ cho gọn
  if (b[1] >= a[1] * 0.75) return `${tr("Giàu")} ${nm(a[0])} + ${nm(b[0])} → ${first(a[0])}, ${first(b[0])}`;
  return `${tr("Giàu")} ${nm(a[0])} → ${grows(a[0])}`;
}
function eggArt(egg) {
  const ph = { egg: { shell: egg.shell || "#f3ead8", speckle: 0.15, seed: [...(egg.id || "e")].reduce((a, c) => a + c.charCodeAt(0), 0) } };
  return moonMark(renderEggFlat(ph, { label: egg.fertile ? tr("Trứng có phôi") : tr("Trứng không phôi") }), egg, 152, 50, 17);
}
const yardEggArt = (egg) => (ICONS?.nestEggSvg ? moonMark(ICONS.nestEggSvg(egg.shell || "#f3ead8", 40, "grass"), egg, 33, 7, 3.6) : eggArt(egg));
// v9: trứng đẻ đêm trăng tròn mang một vầng trăng nhỏ (dễ biến dị hơn)
function moonMark(svg, egg, x, y, r) {
  if (!egg.moon) return svg;
  const m = `<g class="moon-mark"><title>${tr("Đẻ đêm trăng tròn — dễ biến dị hơn")}</title><circle cx="${x}" cy="${y}" r="${r * 1.6}" fill="#fff6c4" opacity=".35"/><circle cx="${x}" cy="${y}" r="${r}" fill="#fff3b0" stroke="#c9a640" stroke-width="${r / 6}"/><circle cx="${x - r * 0.3}" cy="${y + r * 0.2}" r="${r * 0.22}" fill="#e8d68a"/></g>`;
  return svg.replace(/<\/svg>$/, `${m}</svg>`);
}

/* ---------- hình con gà (có bộ nhớ đệm) ---------- */

const artCache = new Map();
function chickenSvg(ch, { pose = "stand", phase = 0, detail = "low" } = {}) {
  const v = R.chickenView(ch, now());
  const devKey = R.NUTRIENTS.map((k) => Math.round(v.care.dev[k] * 10)).join("");
  const key = `${ch.id}|${Math.round(v.growth01 * 25)}|${devKey}|${pose}|${phase}|${detail}`;
  let svg = artCache.get(key);
  if (!svg) {
    const ph = express(decodeGenome(ch.code), v.care);
    svg = renderChickenFlat(ph, { growth: v.growth01, pose, walkPhase: phase, detail, label: ch.name, relic: ch.relic ?? null });
    if (artCache.size > 500) artCache.delete(artCache.keys().next().value);
    artCache.set(key, svg);
  }
  return { svg, key };
}
// v9 — tính cách (từ gen) và chỗ con gà thích quanh quẩn trên sân
const MOOD_TIP = () => ({
  greedy: tr("Hay quanh quẩn bên máng ăn"), lively: tr("Đi lại không ngừng, ít khi đứng yên"), shy: tr("Thích nép gần chuồng"),
  layer: tr("Hay ghé quanh ổ"), calm: tr("Thong thả, không vội gì"),
});
const moodName = (k) => tr(R.PERSONALITY[k].name);
const moodsOf = (ch) => (R.personalityOf ? R.personalityOf(ch.code) : []);
function yardMood(ch) {
  const m = moodsOf(ch)[0];
  if (m === "greedy") return { home: { x: SPOTS.feeder.x, y: SPOTS.feeder.y + 60, pull: 0.55 }, restMul: 1 };
  if (m === "shy") return { home: { x: SPOTS.coopDoor.x + 30, y: SPOTS.coopDoor.y + 70, pull: 0.6 }, restMul: 1.3 };
  if (m === "layer") return { home: { x: SPOTS.nest.x - 40, y: SPOTS.nest.y + 80, pull: 0.4 }, restMul: 1 };
  if (m === "lively") return { home: null, restMul: 0.4 };
  if (m === "calm") return { home: null, restMul: 1.5 };
  return {};
}
// Lông kỷ niệm: vẽ từ màu và hoa văn trong gen của con gà
function featherSvg(code, size = 34, relic = null) {
  const ph = express(decodeGenome(code), { gloss: 0.5 }), K = ph.colors;
  const base = K.base, acc = K.accent ?? K.hackle ?? base, id = `fe${(featherSvg.n = (featherSvg.n ?? 0) + 1)}`;
  const vane = "M15,6 C24,14 25,34 22,54 C20,64 17,70 15,72 C13,70 10,64 8,54 C5,34 6,14 15,6Z";
  let deco = "";
  if (ph.pattern === "barred") deco = [18, 28, 38, 48, 58].map((y) => `<path d="M4,${y} Q15,${y - 4} 26,${y}" stroke="${acc}" stroke-width="3.2" fill="none"/>`).join("");
  else if (ph.pattern === "laced") deco = `<path d="${vane}" fill="none" stroke="${acc}" stroke-width="3"/>`;
  else if (ph.pattern === "spangled") deco = `<ellipse cx="15" cy="16" rx="6" ry="8" fill="${acc}"/>`;
  else if (ph.pattern === "mottled") deco = [[11, 20], [19, 30], [12, 42], [18, 52]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#fff" opacity=".85"/>`).join("");
  else deco = `<path d="M15,8 C20,16 21,30 19,44" stroke="${acc}" stroke-width="4" fill="none" opacity=".45"/>`;
  if (relic === "peacockTail") deco += `<circle cx="15" cy="18" r="6" fill="#e9c449"/><circle cx="15" cy="18" r="4" fill="#1fa9a2"/><circle cx="15" cy="18" r="2.2" fill="#14306e"/>`;
  const rim = relic ? `<path d="${vane}" fill="none" stroke="#e9b922" stroke-width="1.6"/>` : "";
  return `<svg class="feather" viewBox="0 0 30 80" width="${size * 0.38}" height="${size}" aria-hidden="true"><defs><clipPath id="${id}"><path d="${vane}"/></clipPath></defs>`
    + `<path d="${vane}" fill="${base}"/><g clip-path="url(#${id})">${deco}<path d="M15,6 L15,72" stroke="#000" stroke-opacity=".1" stroke-width="5"/></g>${rim}`
    + `<path d="M15,4 L15,78" stroke="#f4ead8" stroke-width="1.4" stroke-linecap="round"/><path d="M8,62 l-3,4 M22,62 l3,4" stroke="${base}" stroke-width="1.4"/></svg>`;
}
const memorialSvg = (m) => renderChickenFlat(express(decodeGenome(m.code), { dev: m.dev, gloss: 0.4 }), { growth: 1, detail: "low", label: m.name, relic: m.relic ?? null });

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
  return state.chickens.find((c) => c.id === id)?.name ?? state.memorial.find((m) => m.id === id)?.name ?? tr("Gà");
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
      text = `<b>${esc(nameOf(e.chickenId))}</b> ${tr("đã nở!")}`;
      justHatched.add(e.chickenId);
      hiddenChicks.add(e.chickenId); // ra mắt trong màn nở trứng rồi mới chui ra sân
      queueReveal({ kind: "hatch", chickenId: e.chickenId, shell: eggShells.get(e.eggId), fresh: [] });
    } else if (e.type === "juvenile") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> ${tr("thành gà giò")}`;
      if (recap) recap.juveniles++;
      else stageFx(e.chickenId, tr("Thành gà giò!"));
    } else if (e.type === "adult") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> ${tr("đã trưởng thành")}`;
      loud = true;
      if (recap) recap.adults.push(nameOf(e.chickenId));
      else {
        stageFx(e.chickenId, tr("Trưởng thành!"));
        if (state.chickens.find((c) => c.id === e.chickenId)?.sex === "rooster") sfx("crow", 0.9);
      }
    } else if (e.type === "laid") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> ${tr("đẻ một trứng")} ${e.fertile ? tr("có phôi") : tr("không phôi")} ${tr("ngoài sân")}`;
      loud = true;
      const a = yard?.chickens.get(e.chickenId);
      ui.eggPos[e.eggId] = a ? { x: clampN(a.x + (Math.random() - 0.5) * 30, 70, 730), y: clampN(a.y + 6, 150, 440) } : randomEggSpot(e.eggId);
      if (recap) recap.laid++;
      else {
        sfx("cluck");
        if (a && view === "yard") popIn("#yard-pops", a.x, a.y - 70, tr("Cục tác!"));
      }
    } else if (e.type === "died") {
      text = `<b>${esc(nameOf(e.chickenId))}</b> ${tr("đã mất")}${e.starved ? tr(" (bị bỏ đói)") : tr(" vì tuổi già")}`;
      loud = true;
      if (recap) recap.died.push({ name: nameOf(e.chickenId), starved: e.starved });
      else sfx("sad");
    } else if (e.type === "feather") {
      text = `🪶 <b>${esc(e.name)}</b> ${tr("để lại một chiếc lông kỷ niệm")}`;
    } else if (e.type === "dex") {
      const d = R.DEX.find((x) => x.key === e.key);
      const nm = `<b>${esc(tr(d?.name ?? e.key))}</b>`;
      if (e.star === 1) {
        text = `${tr("Sổ sưu tầm: mục mới")} ${nm} ★`;
        for (let i = reveals.length - 1; i >= 0; i--) if (reveals[i].kind === "hatch" && reveals[i].chickenId === e.chickenId) { reveals[i].fresh.push(e.key); break; }
      } else {
        text = e.star === 3 ? `${tr("Sổ sưu tầm ★★★")} ${nm} ${tr("— thuần chủng!")}` : `${tr("Sổ sưu tầm ★★")} ${nm} ${tr("— nuôi đủ chất tới trưởng thành")}`;
        loud = true;
        if (!recap) sfx("good", 0.4);
      }
    } else if (e.type === "milestone") {
      text = `${tr("Đạt mốc sổ")} ${e.n}${tr(": chuồng")} ${e.coopCap} ${tr("chỗ ·")} ${e.incubators} ${tr("ổ ấp")}`;
      queueReveal({ kind: "milestone", n: e.n, coopCap: e.coopCap, incubators: e.incubators });
    } else if (e.type === "breed") {
      const b = R.BREEDS.find((x) => x.key === e.key);
      text = `${tr("Đạt giống")} <b>${esc(tr(b?.name ?? e.key))}</b>!`;
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
  if (recap.laid) lines.push(`${tr("🥚 Gà mái đẻ")} <b>${recap.laid}</b> ${tr("quả trứng ngoài sân")}`);
  if (recap.adults.length) lines.push(`🐔 <b>${recap.adults.map(esc).join(", ")}</b> ${tr("đã trưởng thành")}`);
  if (recap.juveniles) lines.push(`🐥 <b>${recap.juveniles}</b> ${tr("gà con thành gà giò")}`);
  for (const d of recap.died) lines.push(`🕊 <b>${esc(d.name)}</b> ${tr("đã mất")}${d.starved ? tr(" (bị bỏ đói)") : tr(" vì tuổi già")}`);
  const waiting = reveals.filter((r) => r.kind === "hatch").length;
  if (waiting) lines.push(`🐣 <b>${waiting}</b> ${tr("gà con chờ bạn về mới chui ra")}`);
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
  tradeToShop: (a, t) => R.tradeToShop(state, { eggs: a.eggs ?? [], chickens: a.chickens ?? [] }, t, { want: a.want }),
  tradeForEgg: (a, t) => R.tradeForEgg(state, a.chickenId, t),
  openBag: (a, t) => R.openBag(state, a.bagId, t),
  warmEgg: (a, t) => R.warmEgg(state, a.eggId, t),
  fieldBonus: (a, t) => R.fieldBonus(state, a.chickenId, t),
  claim: (a, t) => R.claim(state, a.id, t),
  fillTower: (a, t) => R.fillTower(state, a.seed, a.n, t),
  takeFromTower: (a, t) => R.takeFromTower(state, a.seed, a.n, t),
  buy: (a, t) => R.buy(state, a.slot, t),
  barter: (a, t) => R.barter(state, a.slot, t, { eggs: a.eggs }),
  deliver: (a, t) => R.deliver(state, a.chickenId, t),
  candle: (a, t) => R.candle(state, a.eggId, a.what, t),
  haggle: (a, t) => R.haggle(state, a.offer, t),
  knockEgg: (a, t) => R.knockEgg(state, a.eggId, t),
  startPlay: (a, t) => R.startPlay(state, a.id, t),
  endPlay: (a, t) => R.endPlay(state, a.score, t),
  plant: (a, t) => R.plant(state, a.plot, a.seed, t),
  waterPlot: (a, t) => R.waterPlot(state, a.plot, t),
  harvest: (a, t) => R.harvest(state, a.plot, t),
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
    toast(errText(result));
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
const relicName = (k) => tname("relic", k, R.MYSTERY.find((m) => m.key === k)?.name ?? k);
const RARE_W = { silkie: 5, splash: 5, fiveToes: 3, rumpless: 3, frizzle: 3, longTail: 3, mottled: 2, spangled: 2, laced: 2, barred: 2, darkSkin: 2, crest: 2, muff: 2, feetFeather: 2, blue: 1.5, rose: 0.5, pea: 0.5, walnut: 0.5 };
const TIERS = [[12, 4, tr("Gà huyền thoại")], [9, 3, tr("Gà quý")], [6, 2, tr("Gà đẹp")], [0, 1, tr("Gà thường")]];
const TIER_COLORS = { 1: ["#fff", "#ffe9a6", "#cfd8dc"], 2: ["#7fd0ff", "#fff", "#bfe6ff"], 3: ["#d0a8ff", "#fff", "#f0b3ff"], 4: ["#ffd95a", "#fff3b0", "#ff9d5c"] };
function tierOf(code) {
  const score = R.dexKeysOf(code).reduce((a, k) => a + (RARE_W[k] ?? 1), 0);
  const [, n, name] = TIERS.find(([min]) => score >= min);
  return { n, name };
}
const BREED_TIER = ["", tr("Giống đẹp"), tr("Giống quý"), tr("Giống huyền thoại")];
const dexChip = (k, fresh = false) => {
  const d = R.DEX.find((x) => x.key === k);
  return `<li class="rv-chip${fresh ? " new" : ""}"><i style="--c:var(--${d.group})"></i>${esc(tr(d.name))}</li>`;
};
const seedRank = (k) => (k === "lotus" ? 3 : isOdd(k) ? 2 : isStaple(k) ? 0 : 1);
const bagArt = (size, n) => (ICONS?.bagIcon ? ICONS.bagIcon(size, n) : "👜");

const REVEAL = {
  // Trứng nứt → chạm 3 lần giúp gà con chui ra → gà con ra mắt: tên, độ quý, đặc điểm mang trong gen.
  async hatch(r) {
    const ch = state.chickens.find((c) => c.id === r.chickenId);
    if (!ch) return void hiddenChicks.delete(r.chickenId);
    const left = reveals.filter((x) => x.kind === "hatch").length;
    const count = left ? `<span class="rv-count">${tr("còn")} ${left} ${tr("quả nữa")}</span>` : "";
    const shell = r.shell || "#f3ead8";
    const eggSvg = (crack) => renderEggFlat({ egg: { shell, speckle: 0.15, seed: 7 } }, { crack, label: tr("Trứng đang nở") });
    rvShow(`${count}<p class="rv-kicker">${tr("Trứng đang nứt!")}</p>
      <button type="button" class="rv-egg" data-go="tap" aria-label="${tr("Chạm để giúp gà con chui ra")}">${eggSvg(0.15)}</button>
      <p class="rv-sub">${tr("Chạm vào trứng để giúp gà con chui ra")}</p>
      <div class="rv-actions"><button type="button" class="plain" data-go="skip">${tr("Bỏ qua")}</button></div>`);
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
    if (st.growth >= 0.62) perks.push(tr("Lớn nhanh"));
    if (st.hardiness >= 0.62) perks.push(tr("Sống dai"));
    if (st.speed >= 0.62) perks.push(tr("Chạy nhanh"));
    if (ph.sex === "hen" && st.eggRate >= 0.62) perks.push(tr("Sai trứng"));
    const breeds = R.breedsOf(ch.code).map((k) => tr(R.BREEDS.find((b) => b.key === k).name));
    const relic = ch.relic ? `<div class="rv-relic">${relicSvg(ch.relic, 56)}<span><b>${tr("Kỳ vật:")} ${esc(relicName(ch.relic))}</b><br><small>${tr("Bộ phận độc nhất — không lai giống ra được, không truyền cho con")}</small></span></div>` : "";
    const note = breeds.length
      ? `${tr("Mang đủ gen của giống")} <b>${esc(breeds.join(", "))}</b> ${tr("— nuôi đủ chất tới lớn là đạt giống!")}`
      : keys.length ? tr("Các đặc điểm này hiện rõ dần khi gà lớn — nếu được ăn đủ chất.") : "";
    rvShow(`<div class="rv-rays"></div>${count}
      <p class="rv-kicker">${ph.sex === "rooster" ? tr("Một chú gà trống") : tr("Một cô gà mái")} ${tr("chào đời")}</p>
      <div class="rv-art">${chickenSvg(ch, { detail: "high" }).svg}</div>
      <h2 class="rv-title">${ph.sex === "rooster" ? "♂" : "♀"} ${esc(ch.name)}</h2>
      <span class="rv-tier tier-${ch.relic ? 4 : tier.n}">${ch.relic ? tr("Gà kỳ vật") : tier.name}</span>${relic}
      ${keys.length ? `<ul class="rv-chips" aria-label="${tr("Đặc điểm mang trong gen")}">${keys.map((k) => dexChip(k, r.fresh.includes(k))).join("")}</ul>` : `<p class="rv-sub">${tr("Một bé gà mộc mạc — nuôi khéo vẫn đẹp.")}</p>`}
      ${perks.length ? `<p class="rv-sub">${perks.join(" · ")}</p>` : ""}
      ${R.personalityOf ? `<p class="rv-sub rv-mood">${tr("Tính cách:")} ${moodsOf(ch).map((k) => `<b title="${MOOD_TIP()[k]}">${moodName(k)}</b>`).join(" · ")}</p>` : ""}
      ${note ? `<p class="rv-note">${note}</p>` : ""}
      <div class="rv-actions"><button type="button" class="gold" data-go="ok">${tr("Chào")} ${esc(ch.name)}!</button></div>`);
    sfx("hatch");
    sfx("cheep", 0.55);
    buzz(30);
    confetti($("#reveal"), { n: ch.relic ? 90 : 44, colors: [...TIER_COLORS[ch.relic ? 4 : tier.n], "#e4572e", "#7cc35f"] });
    if (ch.relic) sfx("fanfare", 0.4);
    await rvWait();
    hiddenChicks.delete(r.chickenId);
  },

  // Mở túi: hạt bật ra lần lượt, hạt xoàng trước, sen / hạt lạ sau cùng.
  async bag(r) {
    const entries = Object.entries(r.got).sort((a, b) => seedRank(a[0]) - seedRank(b[0]));
    const total = entries.reduce((a, [, n]) => a + n, 0);
    const good = (k) => seedRank(k) >= 2;
    rvShow(`${entries.some(([k]) => good(k)) ? '<div class="rv-rays"></div>' : ""}<p class="rv-kicker">${r.count > 1 ? `${tr("Mở")} ${r.count} ${tr("túi hạt")}` : tr("Mở túi hạt")}</p>
      <div class="rv-art small rv-bag">${bagArt(130)}</div>
      <h2 class="rv-title">${total} ${tr("hạt")}</h2>
      <ul class="rv-seeds">${entries.map(([k, n], i) => `<li class="rv-seed${good(k) ? " good" : ""}" style="--i:${i}">${seedIcon(k, 34)}<b>×${n}</b><span>${seedName(k)}</span></li>`).join("")}</ul>
      <div class="rv-actions"><button type="button" class="gold" data-go="ok">${tr("Cất vào kho")}</button></div>`);
    sfx("whoosh");
    entries.forEach(([k], i) => sfx(good(k) ? "good" : "pop", 0.38 + i * 0.13));
    if (entries.some(([k]) => good(k))) buzz(20);
    await rvWait();
  },

  // Thưởng nhiệm vụ: túi (mở ngay được), hạt, trứng quà (ấp ngay được nếu còn ổ và chỗ chuồng).
  async reward(r) {
    const g = r.got ?? {};
    const parts = [];
    if (g.bagId) parts.push(`<li class="rv-seed" style="--i:0">${bagArt(34)}<b>${tr("Túi")} ${g.bagSize} ${tr("hạt")}</b><span>${tr("chưa mở")}</span></li>`);
    Object.entries(g.seeds ?? {}).forEach(([k, n]) => parts.push(`<li class="rv-seed${seedRank(k) >= 2 ? " good" : ""}" style="--i:${parts.length}">${seedIcon(k, 34)}<b>×${n}</b><span>${seedName(k)}</span></li>`));
    if (g.tickets) parts.push(`<li class="rv-seed good" style="--i:${parts.length}">${ticketSvg(34)}<b>×${g.tickets}</b><span>${tr("vé")}</span></li>`);
    if (g.decor) parts.push(`<li class="rv-seed good" style="--i:${parts.length}">${chestSvg(true)}<b>${tr("Đồ trang trí")}</b></li>`);
    const egg = g.eggId && state.eggs.find((e) => e.id === g.eggId);
    if (egg) parts.push(`<li class="rv-seed good" style="--i:${parts.length}">${eggArt(egg)}<b>${egg.mysteryEgg ? tr("Trứng bí ẩn") : tr("Trứng quà")}</b><span>${egg.mysteryEgg ? tr("nở ra mới biết") : tr("có phôi")}</span></li>`);
    const canIncubate = !!egg && state.incubators.includes(null) && state.chickens.length + state.incubators.filter(Boolean).length < state.coopCap;
    const title = r.title ?? (r.id === "chest" ? tr("Rương ngày!") : r.id === "timed" ? tr("Rương theo giờ!") : r.id === "tutorial" ? tr("Xong một bước!") : tr("Xong việc!"));
    const act2 = g.bagId || canIncubate;
    rvShow(`<div class="rv-rays"></div><p class="rv-kicker">${tr("Phần thưởng")}</p>
      <div class="rv-art small">${chestSvg(true)}</div>
      <h2 class="rv-title">${title}</h2>
      ${r.streak > 1 && r.id !== "tutorial" ? `<p class="rv-sub">${tr("Chuỗi")} ${r.streak} ${tr("ngày liên tiếp")}</p>` : ""}
      <ul class="rv-seeds">${parts.join("")}</ul>
      ${egg ? `<p class="rv-note">${egg.quick ? tr("Quả trứng này nở rất nhanh.") : tr("Trứng quà mang một bộ gen ngẫu nhiên.")}${canIncubate ? "" : tr(" Trứng nằm trong Kho — ấp khi có ổ trống.")}</p>` : ""}
      <div class="rv-actions">
        ${g.bagId ? `<button type="button" class="gold" data-go="open">${tr("Mở túi ngay")}</button>` : ""}
        ${canIncubate ? `<button type="button" class="gold" data-go="incubate">${tr("Ấp ngay")}</button>` : ""}
        <button type="button" class="${act2 ? "plain" : "gold"}" data-go="ok">${act2 ? tr("Để sau") : tr("Tuyệt!")}</button>
      </div>`);
    sfx("claim");
    buzz(20);
    confetti($("#reveal"), { n: 26 });
    const go = await rvWait();
    if (go === "open") await openBags([g.bagId], { direct: true });
    if (go === "incubate" && await run(act("incubate", { eggId: g.eggId }), tr("Trứng quà đã nằm trong ổ ấp — chạm vào trứng để sưởi ấm"))) flashZone("nest");
  },

  async milestone(r) {
    rvShow(`<div class="rv-rays"></div><p class="rv-kicker">${tr("Sổ sưu tầm")}</p>
      <div class="rv-art small">${chestSvg(true)}</div>
      <h2 class="rv-title">${tr("Đạt mốc")} ${r.n}!</h2>
      <ul class="rv-list"><li>${tr("🏠 Chuồng rộng thêm:")} <b>${r.coopCap} ${tr("chỗ")}</b></li><li>${tr("🪺 Ổ ấp:")} <b>${r.incubators}</b></li><li>${tr("🎀 Sân trại có thêm đồ trang trí")}</li></ul>
      <div class="rv-actions"><button type="button" class="gold" data-go="ok">${tr("Tuyệt!")}</button></div>`);
    sfx("fanfare");
    confetti($("#reveal"));
    await rvWait();
  },

  async breed(r) {
    const b = R.BREEDS.find((x) => x.key === r.key);
    if (!b) return;
    const ch = state.chickens.find((c) => c.id === r.chickenId);
    const bag = state.bags.find((x) => x.id === r.bagId);
    rvShow(`<div class="rv-rays"></div><p class="rv-kicker">${tr("Giống mới ·")} ${r.n}/${R.BREEDS.length}</p>
      <div class="rv-art">${ch ? chickenSvg(ch, { detail: "high" }).svg : chestSvg(true)}</div>
      <h2 class="rv-title">${esc(tr(b.name))}</h2>
      <span class="rv-tier tier-${b.tier + 1}">${BREED_TIER[b.tier]}</span>
      <ul class="rv-chips">${b.traits.map((k) => dexChip(k)).join("")}</ul>
      <p class="rv-note">${ch ? `${esc(ch.name)} ${tr("là con đầu tiên của trại đạt giống này.")} ` : ""}${tr("Tặng một túi quà")} ${R.CONFIG.breed.bag} ${tr("hạt và một chiếc nơ treo ở chuồng")}${r.n === R.CONFIG.breed.incubatorAt ? `${tr(", thêm")} <b>${tr("1 ổ ấp")}</b>` : ""}.</p>
      <div class="rv-actions">${bag ? `<button type="button" class="gold" data-go="open">${tr("Mở túi quà")}</button><button type="button" class="plain" data-go="ok">${tr("Để sau")}</button>` : `<button type="button" class="gold" data-go="ok">${tr("Tuyệt!")}</button>`}</div>`);
    sfx("fanfare");
    buzz(40);
    confetti($("#reveal"), { n: 70 });
    if ((await rvWait()) === "open" && bag) await openBags([bag.id], { direct: true });
  },

  async recap(r) {
    rvShow(`<p class="rv-kicker">${tr("Chào mừng trở lại")}</p>
      <h2 class="rv-title">${tr("Khi bạn vắng mặt…")}</h2>
      ${r.away > 10 * MIN ? `<p class="rv-sub">${tr("Bạn rời trại")} ${fmtDur(r.away)}</p>` : ""}
      <ul class="rv-list">${r.lines.map((l) => `<li>${l}</li>`).join("")}</ul>
      <div class="rv-actions"><button type="button" class="gold" data-go="ok">${tr("Vào trại")}</button></div>`);
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
      toast(errText(r));
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

// Sức chơi: 5 chấm; rê chuột xem khi nào có thêm điểm.
function energyChip() {
  const n = R.energyOf(state, now()), max = R.CONFIG.energy.max, next = R.energyNextAt(state, now());
  const tip = n >= max ? tr("Sức chơi đầy — chơi miễn phí ở sân chơi") : `${tr("Sức chơi")} ${n}/${max} ${tr("— thêm 1 sau")} ${fmtEta(next - now())}`;
  return `<span class="chip energy" data-res="energy" title="${tip}" aria-label="${tip}">${"<i class=on></i>".repeat(n)}${"<i></i>".repeat(max - n)}</span>`;
}
let resPrev = null;
function renderRes() {
  const seeds = Object.values(state.inventory).reduce((a, b) => a + b, 0);
  const eggs = state.eggs.filter((e) => e.hatchAt === null);
  const stored = eggs.filter((e) => !e.inYard).length;
  setHTML($("#res"), `
    <button type="button" class="chip" data-res="seeds" data-open="store" title="${tr("Hạt trong kho")}" aria-label="${seeds} ${tr("hạt trong kho")}">${seedIcon("rice", 16)} ${seeds}</button>
    <button type="button" class="chip" data-res="eggs" data-open="store" title="${tr("Trứng trong kho / tổng (sân + kho)")}" aria-label="${stored} ${tr("trứng trong kho, tổng")} ${eggs.length}/${R.CONFIG.storage.eggs}">🥚 ${stored} · ${eggs.length}/${R.CONFIG.storage.eggs}</button>
    <button type="button" class="chip" data-res="bags" data-open="store" title="${tr("Túi hạt chưa mở")}" aria-label="${state.bags.length} ${tr("túi hạt chưa mở")}">${bagArt(16)} ${state.bags.length}</button>
    ${state.energy ? energyChip() : ""}
    ${hasV7() ? `<span class="chip" data-res="tickets" title="${tr("Vé — vào sân chơi, mua ở gian hàng")}" aria-label="${state.tickets} ${tr("vé")}">${ticketSvg(16)} ${state.tickets}</span>` : ""}
    ${seasonChip()}
    <span class="chip" data-res="chickens" title="${tr("Gà trong trại")}" aria-label="${state.chickens.length}/${state.coopCap} ${tr("gà trong trại")}">🐔 ${state.chickens.length}/${state.coopCap}</span>`);
  $("#clock").textContent = `${tr("Giờ trong game:")} ${new Date(now()).toLocaleString(LOCALE, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`;
  // số vừa tăng thì nảy lên một cái
  const cur = { seeds, eggs: eggs.length, bags: state.bags.length, chickens: state.chickens.length, tickets: state.tickets ?? 0 };
  if (resPrev) for (const k of Object.keys(cur)) if (cur[k] > resPrev[k]) bump($(`#res [data-res="${k}"]`));
  if (resPrev && cur.tickets > resPrev.tickets) sfx("ticket", 0.2);
  resPrev = cur;
}
// v9 — mùa theo tuần + đêm trăng tròn: một chip nhỏ, chi tiết trong chú thích (chạm để đọc trên điện thoại)
const SEASON_ICON = { harvest: "🌾", rain: "🌧️", bloom: "🌸", dry: "☀️" };
const seasonName = (k) => ({ harvest: tr("Mùa gặt"), rain: tr("Mùa mưa"), bloom: tr("Mùa hoa"), dry: tr("Mùa khô") })[k];
// v11: loài được mùa lấy thẳng từ luật (thêm loài là chữ tự đổi theo)
const seasonSeeds = (k) => Object.keys(R.CONFIG.season[k].field ?? {}).map((s) => seedName(s).toLowerCase()).join(", ");
const seasonFx = (k) => ({
  harvest: `${tr("ngoài đồng nhiều")} ${seasonSeeds("harvest")}`,
  rain: `${tr("đốm sáng hiện dày hơn")}, ${tr("ngoài đồng nhiều")} ${seasonSeeds("rain")}`,
  bloom: `${tr("ngoài đồng và đốm sáng nhiều")} ${seasonSeeds("bloom")}`,
  dry: tr("ngoài đồng ít hạt, khách bên đường bán rẻ hơn"),
})[k];
function seasonText() {
  const c = R.calendarView(now());
  const lines = [`${SEASON_ICON[c.season]} ${seasonName(c.season)}: ${seasonFx(c.season)}.`, `${tr("Sang")} ${seasonName(c.next)} ${tr("sau")} ${fmtDur(c.ends - now())}.`];
  lines.push(c.fullMoon ? `🌕 ${tr("Đêm trăng tròn: trứng có phôi đẻ đêm nay dễ biến dị gấp 3.")}` : c.nextFull ? `🌕 ${tr("Đêm trăng tròn sau")} ${fmtDur(c.nextFull - now())}.` : "");
  return { c, text: lines.filter(Boolean).join("\n") };
}
function seasonChip() {
  if (!R.calendarView) return "";
  const { c, text } = seasonText();
  return `<button type="button" class="chip season" data-res="season" title="${text}" aria-label="${text}">${SEASON_ICON[c.season]}${c.fullMoon ? " 🌕" : ""}</button>`;
}
$("#res").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-res=season]")) toast(seasonText().text);
  const rs = ev.target.closest("[data-open=store]");
  if (rs) openStore({ eggs: "eggs", bags: "bags" }[rs.dataset.res] ?? "seeds"); // chip trứng / túi mở đúng thẻ
});

/* ---------- sân trại: các điểm thả ---------- */

const DEFAULT_SPOTS = {
  coop: { x: 108, y: 82, r: 74 },
  coopDoor: { x: 95, y: 95, r: 55 },
  feeder: { x: 330, y: 120, r: 42 },
  water: { x: 430, y: 118, r: 30 },
  nest: { x: 600, y: 104, r: 66 },
  gate: { x: 680, y: 234, r: 48 },
  market: { x: 748, y: 340, r: 50 }, // gian hàng bên đường: chợ + khách qua đường
  play: { x: 160, y: 382, r: 70 }, // góc dưới trái
};
const SPOTS = {};
for (const [k, d] of Object.entries(DEFAULT_SPOTS)) SPOTS[k] = { ...d, ...(ICONS?.YARD_SPOTS?.[k] || {}) };
for (const s of Object.values(SPOTS)) s.r ??= 50;
const ZONES = [
  { key: "gate", label: tr("Cổng · Cánh đồng"), accepts: ["chicken"], aria: tr("Cổng: xem cánh đồng. Kéo gà vào đây để thả ra đồng") },
  { key: "market", label: tr("Chợ"), accepts: ["chicken", "egg"], aria: tr("Gian hàng bên đường: kéo gà hoặc trứng vào để đổi; chạm để gặp khách đang ghé") },
  { key: "coop", label: tr("Chuồng · Kho"), accepts: ["egg"], aria: tr("Chuồng: mở Kho. Kéo trứng vào để cất") },
  { key: "feeder", label: tr("Tháp hạt"), accepts: [], aria: tr("Tháp hạt: đổ hạt vào cho gà tự ăn") },
  { key: "play", label: tr("Sân chơi"), accepts: ["chicken"], aria: tr("Sân chơi: kéo gà vào để chơi (tốn 1 sức chơi, hết thì 1 vé)") },
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
    else toast(tr("Kéo một con gà ra cổng để thả ra cánh đồng"));
  }
  if (z === "coop") openStore();
  if (z === "market") {
    const vis = hasV7() && R.visitorView(state, now());
    if (vis?.who && !vis.gone) openVisitor();
    else toast(tr("Kéo gà hoặc trứng vào gian hàng để đổi lấy hạt / trứng / vé"));
  }
  if (z === "feeder") hasV7() ? openTower() : toast(tr("Kéo gà vào máng: tự chọn hạt hợp với gà nhất"));
  if (z === "play") {
    // trứng đang ấp không kéo được: chạm sân chơi để chơi với quả trứng trong ổ
    const egg = hasV7() && state.eggs.find((e) => e.hatchAt !== null && (e.played ?? 0) < R.CONFIG.play.eggMax);
    if (egg && canPlay()) playFlow(egg.id);
    else toast(egg ? tr("Hết sức chơi và vé — sức chơi hồi 1 điểm mỗi 30 phút") : tr("Kéo một con gà vào sân chơi. Có trứng đang ấp thì chạm vào đây để chơi với trứng"));
  }
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
// Điện thoại dọc: cảnh cuộn ngang — cuộn tới chỗ x (toạ độ cảnh 0..W) nếu nó đang khuất.
function panTo(x, pan = $(view === "field" ? "#field-pan" : "#yard-pan"), smooth = true) {
  if (!pan || pan.scrollWidth <= pan.clientWidth + 2) return;
  const px = (x / W) * pan.scrollWidth, left = pan.scrollLeft, w = pan.clientWidth;
  if (px > left + w * 0.15 && px < left + w * 0.85) return;
  pan.scrollTo({ left: Math.max(0, px - w / 2), behavior: smooth && !reduceMotion() ? "smooth" : "auto" });
}
const centerPan = (pan) => { if (pan) pan.scrollLeft = (pan.scrollWidth - pan.clientWidth) / 2; };
let panW = innerWidth; // chỉ canh lại khi đổi bề ngang (thanh địa chỉ điện thoại ẩn / hiện thì thôi)
addEventListener("resize", () => { if (innerWidth === panW) return; panW = innerWidth; panTo(470, $("#yard-pan"), false); centerPan($("#field-pan")); });
setTimeout(() => panTo(470, $("#yard-pan"), false), 0); // lúc mở game: giữa sân, thấy cả ổ ấp
function flashZone(key) {
  sfx("drop");
  const el = key === "nest" ? $("#yard-nests .nest") : $(`#yard-zones [data-zone="${key}"]`);
  if (!el) return;
  const sp = key === "nest" ? SPOTS.nest : SPOTS[key];
  if (sp) panTo(sp.x);
  el.classList.remove("hit");
  void el.offsetWidth;
  el.classList.add("hit");
  setTimeout(() => el.classList.remove("hit"), 600);
}

function nestSlots() {
  const n = state.incubators.length, s = SPOTS.nest;
  // ổ xếp trong lều rơm (trong hàng rào): hai ổ một hàng, hàng sau thấp xuống; quá 4 ổ thì lùi sang trái
  const pos = n === 1 ? [[0, -2]] : [[-32, -4], [36, -4], [-32, 44], [36, 44]];
  return state.incubators.map((id, i) => ({ id, i, x: s.x + (pos[i]?.[0] ?? -30 - (i - 3) * 70), y: s.y + (pos[i]?.[1] ?? 44) }));
}
/* ---------- vườn rau (v10) ---------- */

const GARDEN = { x: 128, y: 238 }; // giữa khu vườn (bên trái, giữa chuồng và sân chơi)
const PLOT_POS = [[-56, 10], [0, 10], [56, 10], [-28, 50], [28, 50]]; // đáy luống so với GARDEN
const plotXY = (i) => ({ x: GARDEN.x + PLOT_POS[i][0], y: GARDEN.y + PLOT_POS[i][1] });
function plotTip(v) {
  if (v.empty) return tr("Luống trống — chạm để gieo hạt");
  const nm = seedName(v.seed);
  if (v.ready) return `${nm}: ${tr("đã chín — chạm để thu hoạch")}`;
  return `${nm}: ${tr("chín sau")} ${fmtEta(Math.max(0, v.readyAt - now()))}${v.waterLeft > 0 ? ` ${tr("— chạm để tưới")} (${v.water}/${R.CONFIG.garden.water.max})` : ` ${tr("— đã tưới đủ")}`}`;
}
function renderGarden() {
  const host = $("#yard-garden");
  if (!host) return;
  if (!state.garden) { host.innerHTML = ""; return; }
  const t = now(), n = state.garden.length;
  while (host.children.length > n) host.lastElementChild.remove();
  for (let i = 0; i < n; i++) {
    let el = host.children[i];
    if (!el) {
      el = document.createElement("div");
      el.className = "plot";
      el.dataset.plot = i;
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.innerHTML = '<div class="plot-bed"></div><div class="plot-plant"></div><span class="eta"></span>';
      host.append(el);
      const { x, y } = plotXY(i);
      el.style.left = `${(x / W) * 100}%`;
      el.style.top = `${(y / H) * 100}%`;
    }
    const v = R.plotView(state, i, t);
    const key = v.empty ? "empty" : `${v.seed}|${Math.round(v.growth * 24)}|${v.ready}`;
    if (el._key !== key) {
      el._key = key;
      el.querySelector(".plot-bed").innerHTML = bedSvg(!v.empty && v.water > 0 && !v.ready);
      el.querySelector(".plot-plant").innerHTML = v.empty ? "" : plantSvg(plantSpec(v.seed), v.growth, v.ready, i * 7 + 3);
    }
    const tip = plotTip(v);
    if (el.title !== tip) { el.title = tip; el.setAttribute("aria-label", tip); }
    el.classList.toggle("empty", v.empty);
    el.classList.toggle("ripe", !!v.ready);
    const eta = v.empty ? "" : v.ready ? tr("Chín!") : fmtEta(Math.max(0, v.readyAt - t));
    const e = el.querySelector(".eta");
    if (e.textContent !== eta) e.textContent = eta;
    e.hidden = !eta;
  }
}
$("#yard-garden")?.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-plot]");
  if (!el || !state?.garden) return;
  const i = Number(el.dataset.plot), v = R.plotView(state, i, now()), { x, y } = plotXY(i);
  if (v.empty) return openPlant(i);
  if (v.ready) {
    const r = await act("harvest", { plot: i });
    if (await run(Promise.resolve(r))) {
      sfx("harvest");
      popIn("#yard-pops", x, y - 46, `+${r.n} ${seedName(r.seed)}`);
      burst($("#yard-pops"), `${(x / W) * 100}%`, `${((y - 30) / H) * 100}%`, { kind: "star", n: 10, colors: ["#ffd95a", "#7cc35f", "#fff"] });
      const chip = $('#res [data-res="seeds"]');
      if (chip) { const rc = el.getBoundingClientRect(); flyTo(seedIcon(r.seed, 22), rc.left + rc.width / 2, rc.top, chip); }
      if (r.n > R.CONFIG.garden.yield) toast(`${tr("Được mùa! Thêm 1 hạt")}`);
    }
    return;
  }
  if (v.waterLeft <= 0) return toast(tr("Đã tưới đủ — chờ cây chín nhé"));
  if (await run(act("waterPlot", { plot: i }))) {
    sfx("water");
    burst($("#yard-pops"), `${(x / W) * 100}%`, `${((y - 24) / H) * 100}%`, { kind: "spark", n: 9, colors: ["#8fd3ff", "#c9ecff", "#5fb3e8"], rise: 18 });
  }
});
let plantTarget = 0;
function openPlant(i) {
  plantTarget = i;
  const ks = Object.keys(R.SEEDS).filter((k) => R.canPlant(k));
  $("#plant-list").innerHTML = ks.map((k) => {
    const have = state.inventory[k] ?? 0;
    return `<button type="button" class="plant-opt" data-seed="${k}"${have ? "" : " disabled"}><span class="po-art">${plantSvg(plantSpec(k), 1, false, 5)}</span><b>${esc(seedName(k))}</b><small>${tr("có")} ${have} · ${tr("chín sau")} ${fmtDur(R.growMsOf(k, now()))}</small><small class="po-yield">→ ${R.CONFIG.garden.yield} ${esc(seedName(k))}</small></button>`;
  }).join("");
  $("#plant-dialog").showModal();
}
$("#plant-list")?.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-seed]");
  if (!b || b.disabled) return;
  $("#plant-dialog").close();
  const { x, y } = plotXY(plantTarget);
  if (await run(act("plant", { plot: plantTarget, seed: b.dataset.seed }))) {
    sfx("drop");
    burst($("#yard-pops"), `${(x / W) * 100}%`, `${((y - 10) / H) * 100}%`, { kind: "spark", n: 7, colors: ["#8a5a36", "#a5713e", "#7cc35f"], rise: 12 });
  }
});

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
    const eta = egg ? `${tr("Nở sau")} ${fmtEta(Math.max(0, egg.hatchAt - t))}` : tr("Ổ ấp trống");
    const warmed = egg?.warmed ?? 0, max = R.CONFIG.warm.max;
    const tip = egg && hasV6() ? (warmed >= max ? `${eta} ${tr("— đã sưởi đủ ấm")}` : `${eta} ${tr("— chạm để sưởi ấm (")}${warmed}/${max})`) : eta;
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
    const etaText = !egg ? tr("Ổ ấp") : egg.hatchAt <= t ? tr("đang nở…") : eta.replace(tr("Nở sau "), "");
    const etaEl = el.querySelector(".eta");
    if (etaEl.textContent !== etaText) etaEl.textContent = etaText;
    const pips = el.querySelector(".pips");
    const canKnock = !!egg && hasV7() && p >= R.CONFIG.knock.fromPct;
    el.classList.toggle("knock", canKnock);
    pips.hidden = !egg || (!warmed && !canKnock && !egg.broodBy);
    const pipText = canKnock ? tr("Gõ!") : egg?.broodBy ? tr("🐔 đang ấp giúp") : warmed >= max ? tr("♨ đủ ấm") : `♨ ${warmed}/${max}`;
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
  if (el.classList.contains("knock")) {
    // trứng đã sẵn sàng: gõ cho nở ngay (màn nở trứng tự chiếu qua sự kiện hatched)
    sfx("crack");
    buzz(14);
    if (await run(act("knockEgg", { eggId }))) pumpReveals();
    return;
  }
  if ((egg.warmed ?? 0) >= R.CONFIG.warm.max) {
    bump(el, "nope");
    if (!el._toldMax) toast(tr("Trứng đã đủ ấm — chờ gà con chui ra nhé"));
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
    if (r.code !== "too_fast" && r.code !== "no_egg") toast(errText(r));
    return renderAll();
  }
  sfx("warm");
  buzz(10);
  const slot = nestSlots().find((n) => n.id === eggId);
  if (slot) {
    burst($("#yard-pops"), `${(slot.x / W) * 100}%`, `${((slot.y - 8) / H) * 100}%`, { kind: "heat", n: 7, colors: ["#ff9d5c", "#ffd95a", "#ff7a59"], spread: 26, rise: 40, life: 800 });
    const cut = Math.round((before - r.hatchAt) / 1000);
    popIn("#yard-pops", slot.x, slot.y - 44, cut >= 60 ? `${tr("Ấm hơn! −")}${Math.round(cut / 60)} ${tr("phút")}` : `${tr("Ấm hơn! −")}${cut} ${tr("giây")}`);
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
      el.title = e.fertile ? tr("Trứng có phôi — chạm để nhặt, kéo vào ổ để ấp") : tr("Trứng không phôi — chạm để nhặt (chỉ để đổi hạt)");
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.setAttribute("aria-label", `${e.fertile ? tr("Trứng có phôi") : tr("Trứng không phôi")} ${tr("ngoài sân — nhặt vào kho")}`);
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
  // gà chỉ đi lại TRONG hàng rào (rào phải ở x ≈ 700; ngoài đó là con đường)
  yard = createField({ seed: (sceneSeed() ^ 0x7a2d) >>> 0, spawnPerSec: 0, maxSeeds: 0, top: 110, margin: 60, width: 700 });
  $("#yard-bg").innerHTML = ICONS?.yardBackdrop ? ICONS.yardBackdrop(W, H, sceneSeed()) : ICONS?.fieldBackdrop ? ICONS.fieldBackdrop(W, H, sceneSeed() + 1) : "";
  renderZones();
}
let entryDone = false; // đã cho đàn gà đi ra từ chuồng lúc vào game chưa
const entering = new Set(); // gà đang chờ tới lượt ra khỏi chuồng
function syncYard() {
  ensureYard();
  const home = new Set(state.chickens.filter((c) => c.location === "coop").map((c) => c.id));
  for (const id of [...yard.chickens.keys()]) if (!home.has(id)) removeChicken(yard, id);
  const slots = nestSlots();
  for (const ch of state.chickens) {
    if (!home.has(ch.id) || yard.chickens.has(ch.id) || hiddenChicks.has(ch.id) || entering.has(ch.id)) continue;
    const v = R.chickenView(ch, now());
    const t = fieldTraits(express(decodeGenome(ch.code), v.care));
    if (!entryDone && !justHatched.has(ch.id)) {
      // vừa vào game: từng con một chui ra từ cửa chuồng
      const id = ch.id, speed = t.speed * (0.6 + 0.4 * v.growth01) * 0.7;
      entering.add(id);
      setTimeout(() => {
        entering.delete(id);
        if (!yard || yard.chickens.has(id) || !state?.chickens.some((c) => c.id === id && c.location === "coop")) return;
        addChicken(yard, { id, speed, sight: 0, x: SPOTS.coopDoor.x + (Math.random() - 0.5) * 16, y: SPOTS.coopDoor.y + 12, ...yardMood(ch) });
        const a = yard.chickens.get(id);
        a.mode = "wander";
        a.wander = { x: 220 + Math.random() * 380, y: 230 + Math.random() * 170 };
        if (entering.size % 2 === 0) voice(id);
      }, 350 + (entering.size - 1) * 650);
      continue;
    }
    let pos = {};
    if (justHatched.has(ch.id)) {
      // gà con chui ra ngay tại ổ ấp
      const s = slots[0] ?? SPOTS.nest;
      pos = { x: s.x, y: s.y + 60 };
      justHatched.delete(ch.id);
      setTimeout(() => {
        popIn("#yard-pops", pos.x, pos.y - 20, tr("Chiếp chiếp!"));
        burst($("#yard-pops"), `${(pos.x / W) * 100}%`, `${((pos.y - 20) / H) * 100}%`, { kind: "star", n: 8, colors: ["#ffd95a", "#fff"] });
      }, 50);
    }
    addChicken(yard, { id: ch.id, speed: t.speed * (0.6 + 0.4 * v.growth01) * 0.7, sight: 0, ...pos, ...yardMood(ch) });
  }
  if (state.chickens.length || state.eggs.length) entryDone = true;
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
    return ch ? { text: tr("Cho {n} ăn", { n: ch.name }), ok: true, chickenId: id } : null;
  }
  if (!z) return null;
  if (d.kind === "chicken") {
    if (z.key === "gate") return { text: tr("Ra cánh đồng"), ok: true };
    if (z.key === "market") return { text: tr("Đổi ở chợ"), ok: true };
    if (z.key === "play") return canPlay() ? { text: canPlay() === "energy" ? tr("Vào sân chơi") : tr("Vào sân chơi · 1 vé"), ok: true } : { text: tr("Hết sức chơi và vé"), ok: false };
    if (z.key === "feeder") return Object.values(state.inventory).some((n) => n > 0) ? { text: tr("Tự chọn hạt"), ok: true } : { text: tr("Kho hết hạt"), ok: false };
  }
  if (d.kind === "egg") {
    const egg = state.eggs.find((e) => e.id === d.id);
    if (z.key === "nest") {
      if (z.slot.id) return { text: tr("Ổ đang ấp"), ok: false };
      if (!egg?.fertile) return { text: tr("Không phôi — không ấp được"), ok: false };
      return { text: tr("Ấp trứng"), ok: true };
    }
    if (z.key === "coop") return { text: tr("Cất vào kho"), ok: true };
    if (z.key === "market") return { text: tr("Đổi túi hạt"), ok: true };
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
// Điện thoại dọc: kéo tới sát mép cảnh thì cảnh tự cuộn (cổng, chợ, ổ ấp có thể đang khuất).
let edgeRaf = 0;
function edgeScroll() {
  edgeRaf = 0;
  if (!drag?.active || drag.cx == null) return;
  const pan = $(view === "field" ? "#field-pan" : "#yard-pan");
  if (!pan || pan.scrollWidth <= pan.clientWidth + 2) return;
  const r = pan.getBoundingClientRect(), edge = Math.min(56, r.width * 0.16);
  const dl = drag.cx - r.left, dr = r.right - drag.cx;
  const v = dl < edge ? -(1 - dl / edge) : dr < edge ? 1 - dr / edge : 0;
  if (!v) return;
  const before = pan.scrollLeft;
  pan.scrollLeft += Math.round(v * 14);
  if (pan.scrollLeft !== before) dragMove({ clientX: drag.cx, clientY: drag.cy });
  edgeRaf = requestAnimationFrame(edgeScroll);
}
document.addEventListener("pointermove", dragMove);
function dragMove(ev) {
  if (!drag) return;
  drag.cx = ev.clientX;
  drag.cy = ev.clientY;
  if (drag.active && !edgeRaf) edgeRaf = requestAnimationFrame(edgeScroll);
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
}
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
  else if (d.kind === "seed") toast(selectedId ? tr("Kéo hạt thả lên gà — hoặc bấm “Cho ăn” trong bảng của gà") : tr("Kéo hạt thả lên một con gà để cho ăn"));
}

async function onDrop(d, cx, cy) {
  const p = toWorld(cx, cy);
  if (d.kind === "seed") {
    const id = chickenAtPoint(cx, cy) ?? d.hover;
    if (!id) return toast(tr("Thả hạt lên một con gà trong sân"));
    const ch = state.chickens.find((c) => c.id === id);
    if (await run(act("feed", { chickenId: id, seed: d.id }))) {
      chickenFx(id, { text: `${tr("Ăn")} ${seedName(d.id).toLowerCase()}`, colors: [seedColor(d.id), "#ff9db0", "#fff"] });
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
    if (z?.key === "play") return playFlow(ch.id);
    if (z?.key === "feeder") {
      flashZone("feeder");
      return autoFeed(ch.id);
    }
    // thả xuống chỗ khác trong sân
    const a = yard?.chickens.get(ch.id);
    if (a) {
      a.x = clampN(p.x, 60, 640);
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
      if (await run(act("incubate", { eggId: egg.id }), tr("Đã đặt trứng vào ổ ấp"))) {
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
    const kinds = Object.keys(R.SEEDS).filter((k) => state.inventory[k] > 0 && !R.handOnly(k));
    if (!kinds.length) break;
    const score = (k) => {
      const s = R.SEEDS[k];
      let v = 0;
      for (const n of R.NUTRIENTS) v += Math.min(Math.max(0, R.CONFIG.nutrientFull - ch.n[n]), s.n[n]);
      return v + (isStaple(k) ? 0.5 : 0); // hoà điểm thì tiết kiệm hạt tốt
    };
    kinds.sort((a, b) => score(b) - score(a));
    const r = await act("feed", { chickenId: id, seed: kinds[0] });
    handleEvents(r.events ?? []);
    if (!r.ok) {
      if (!fed) toast(errText(r));
      break;
    }
    fed++;
  }
  if (fed) {
    chickenFx(id, { text: `${tr("Ăn")} ${fed} ${tr("hạt")}` });
    for (let i = 0; i < Math.min(fed, 3); i++) sfx("peck", i * 0.12);
    if (announce) toast(`${nameOf(id)} ${tr("ăn")} ${fed} ${tr("hạt")}`); // bấm nút: sân có thể đang khuất
    save();
    renderAll();
  } else if (!Object.values(state.inventory).some((n) => n > 0)) toast(tr("Kho hết hạt — thả gà ra đồng để kiếm hạt"));
}

/* ---------- khay hạt ---------- */

function renderTray() {
  // chỉ hiện loại đang có (lúa luôn hiện để người mới biết khay ở đâu)
  const kinds = Object.keys(R.SEEDS).filter((k) => isStaple(k) || state.inventory[k] > 0);
  const empty = !Object.values(state.inventory).some((n) => n > 0);
  setHTML($("#tray"), kinds.map((k) => {
    const n = state.inventory[k];
    return `<div class="seedbtn${n ? "" : " empty"}" data-drag="seed" data-id="${k}" title="${seedName(k)}: ${seedSummary(k)}"><span class="ico">${seedIcon(k, 28)}</span><span><b>${n}</b><small>${seedName(k)}</small></span></div>`;
  }).join("") + (empty ? `<span class="tray-empty muted">${tr("Hết hạt — thả gà ra")} <b>${tr("cổng")}</b> ${tr("để kiếm hạt, hoặc đổi ở")} <b>${tr("chợ")}</b>.</span>` : ""));
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
          <button type="button" class="small" data-act="close" aria-label="${tr("Đóng")}">✕</button>
        </div>
        <div class="meters">
          <div class="meter m-sat"><span>${tr("Độ no")}</span><div class="progress"><i></i></div></div>
          <div class="meter m-grow"><span>${tr("Lớn")}</span><div class="progress"><i style="--c:var(--ok)"></i></div></div>
          <div class="meter m-life"><span>${tr("Tuổi thọ")}</span><div class="progress"><i style="--c:var(--muted)"></i></div></div>
          <div class="meter m-speed"><span>${tr("Tốc độ")}</span><div class="progress"><i style="--c:var(--accent)"></i></div></div>
          <div class="meter m-stam"><span>${tr("Thể lực")}</span><div class="progress"><i style="--c:var(--energy)"></i></div></div>
          <div class="pstats" title="${tr("Lợi thế ở sân chơi — theo vóc dáng gà")}">${PLAY_STATS.map(([k, label, tip]) => `<span class="ps-${k}" title="${tip}"><b>${label}</b><i></i></span>`).join("")}</div>
          <div class="nutr">${R.NUTRIENTS.map((k) => `<div class="n n-${k}" title="${tr(R.NUTRIENT_INFO[k].name)}: ${tr(R.NUTRIENT_INFO[k].grows)}"><span>${tr(R.NUTRIENT_INFO[k].name)}</span><div class="progress"><i style="--c:${NUT_COLOR[k]}"></i></div></div>`).join("")}</div>
        </div>
        <div class="ck-actions">
          <button type="button" class="small primary" data-act="feed">${tr("Cho ăn")}</button>
          <button type="button" class="small" data-act="auto" title="${tr("Như kéo gà vào máng: tự chọn hạt hợp nhất")}">${tr("Máng ăn")}</button>
          <button type="button" class="small" data-act="field">${tr("Ra cánh đồng")}</button>
          <button type="button" class="small" data-act="trade">${tr("Đổi ở chợ")}</button>
          <button type="button" class="small" data-act="tree" title="${tr("Bố mẹ, ông bà — đặc điểm truyền từ ai sang")}">${tr("Gia phả")}</button>
        </div>
      </article>`;
  }
  const v = R.chickenView(ch, now());
  const art = chickenSvg(ch);
  const artEl = host.querySelector(".ck-art");
  if (artEl.dataset.key !== art.key) { artEl.innerHTML = art.svg; artEl.dataset.key = art.key; }
  host.querySelector(".ck-name").textContent = `${ch.sex === "rooster" ? "♂" : "♀"} ${ch.name}`;
  host.querySelector(".ck-sub").textContent = `${STAGE[v.stage]} · ${fmtDur(v.ageMs)} ${tr("tuổi")}${v.stage === "adult" ? "" : ` ${tr("· lớn sau ~")}${fmtDur(R.msToAdult(ch))}`}`;
  const b = moodsOf(ch).map((k) => `<span class="badge mood" title="${MOOD_TIP()[k]}">${moodName(k)}</span>`);
  if (ch.location === "field") b.push(`<span class="badge ok">${tr("Đang ngoài đồng")}</span>`);
  if (v.hungry) b.push(`<span class="badge bad">${tr("Đói — chóng già")}</span>`);
  else if (v.satiety01 < 0.3) b.push(`<span class="badge warn">${tr("Sắp đói")}</span>`);
  if (ch.sex === "hen" && v.stage === "adult") b.push(v.canLay ? `<span class="badge ok">${tr("Có thể đẻ")}</span>` : `<span class="badge">${tr("Chưa đủ no để đẻ")}</span>`);
  if (ch.mutationBoost > 0) b.push(`<span class="badge">${tr("Dễ biến dị")}</span>`);
  if (ch.relic) b.push(`<span class="badge gold">${tr("Kỳ vật:")} ${esc(relicName(ch.relic))}</span>`);
  for (const k of R.breedsOf(ch.code)) {
    const br = R.BREEDS.find((x) => x.key === k);
    b.push(`<span class="badge gold" title="${br.traits.map((k2) => tr(R.DEX.find((d) => d.key === k2).name)).join(" + ")}">${v.stage === "adult" && state.breeds?.[k] != null ? tr("Giống") : tr("Mang gen giống")} ${esc(tr(br.name))}</span>`);
  }
  if (ch.line?.length) b.push(`<span class="badge" title="${tr("Bố mẹ đều mang:")} ${ch.line.map((k2) => tr(R.DEX.find((d) => d.key === k2)?.name ?? k2)).join(", ")} ${tr("— nuôi đủ chất sẽ đạt ★★★")}">${tr("Dòng thuần")}</span>`);
  host.querySelector(".ck-badges").innerHTML = b.join(" ");
  host.querySelector(".m-sat").classList.toggle("hungry", v.hungry);
  host.querySelector(".m-sat i").style.setProperty("--v", v.satiety01.toFixed(3));
  host.querySelector(".m-grow i").style.setProperty("--v", v.growth01.toFixed(3));
  host.querySelector(".m-life i").style.setProperty("--v", Math.max(0, v.lifeLeftMs / ch.lifespanMs).toFixed(3));
  host.querySelector(".m-life span").textContent = `${tr("Tuổi thọ")} ~${fmtDur(Math.max(0, v.lifeLeftMs))}`;
  host.querySelector(".m-speed i").style.setProperty("--v", v.speed01.toFixed(3));
  host.querySelector(".m-speed span").textContent = `${tr("Tốc độ")} ${Math.round(1 + v.speed01 * 9)}/10`;
  const ps = playStats(ch);
  for (const [k] of PLAY_STATS) host.querySelector(`.ps-${k} i`).style.setProperty("--v", ps[k].toFixed(2));
  host.querySelector(".m-stam").hidden = !hasV7();
  if (hasV7()) {
    const sm = R.staminaMaxOf(ch), sn = Math.round(R.staminaOf(ch));
    host.querySelector(".m-stam i").style.setProperty("--v", (sn / sm).toFixed(3));
    host.querySelector(".m-stam span").textContent = `${tr("Thể lực")} ${sn}/${sm}`;
  }
  for (const k of R.NUTRIENTS) host.querySelector(`.n-${k} i`).style.setProperty("--v", v.nutrients01[k].toFixed(3));
  host.querySelector('[data-act="feed"]').disabled = ch.location !== "coop";
  host.querySelector('[data-act="auto"]').disabled = ch.location !== "coop";
  host.querySelector('[data-act="field"]').textContent = ch.location === "field" ? tr("Xem cánh đồng") : tr("Ra cánh đồng");
  host.querySelector('[data-act="trade"]').disabled = ch.location !== "coop";
}
$("#info").addEventListener("click", (ev) => {
  const act = ev.target.closest("[data-act]")?.dataset.act;
  const ch = state.chickens.find((c) => c.id === selectedId);
  if (!act || !ch) return;
  if (act === "close") select(null);
  if (act === "feed") openFeed(ch.id);
  if (act === "auto") hasV7() ? openTower() : autoFeed(ch.id, true);
  if (act === "field") {
    if (ch.location === "field") showField();
    else sendToField(ch.id).then((ok) => ok && showField());
  }
  if (act === "trade") openTrade({ chickenId: ch.id });
  if (act === "tree") openTree(ch.id);
});

/* ---------- gia phả 3 đời (v9) ---------- */

function openTree(id) {
  const me = R.kinOf(state, id);
  if (!me) return;
  const mine = new Set(R.dexKeysOf(me.code));
  const mom = R.kinOf(state, me.motherId), dad = R.kinOf(state, me.fatherId);
  const node = (k, role, cls = "") => {
    if (!k) return `<div class="tree-node unknown ${cls}"><div class="tn-art">?</div><b>${role}</b><small>${tr("Không rõ")}</small></div>`;
    const live = state.chickens.find((c) => c.id === k.id);
    const art = live ? chickenSvg(live).svg : renderChickenFlat(express(decodeGenome(k.code), { gloss: 0.4 }), { growth: 1, detail: "low", label: k.name });
    const keys = R.dexKeysOf(k.code);
    const chips = keys.map((x) => `<li class="${cls !== "me" && mine.has(x) ? "passed" : ""}">${esc(tr(R.DEX.find((d) => d.key === x)?.name ?? x))}</li>`).join("");
    return `<div class="tree-node ${cls}${k.here ? "" : " gone"}"><div class="tn-art">${art}</div><b>${esc(k.name)}</b><small>${role}${k.here ? "" : ` · ${tr("đã rời trại")}`}</small>${chips ? `<ul>${chips}</ul>` : ""}</div>`;
  };
  const gp = (p) => [R.kinOf(state, p?.motherId), R.kinOf(state, p?.fatherId)];
  const [mm, mf] = mom ? gp(mom) : [null, null], [fm, ff] = dad ? gp(dad) : [null, null];
  // hàng nào không biết ai thì bỏ hẳn (gà khởi đầu, trứng quà, trứng mua không có bố mẹ trong trại)
  const g2 = mm || mf || fm || ff, g1 = mom || dad;
  $("#tree").innerHTML = `
    ${g2 ? `<div class="tree-row g2">${node(mm, tr("Bà ngoại"))}${node(mf, tr("Ông ngoại"))}${node(fm, tr("Bà nội"))}${node(ff, tr("Ông nội"))}</div>` : ""}
    ${g1 ? `<div class="tree-row g1">${node(mom, tr("Mẹ"))}${node(dad, tr("Bố"))}</div>` : ""}
    <div class="tree-row g0${g1 ? "" : " alone"}">${node(me, tr("Con gà này"), "me")}</div>
    <p class="muted tree-note">${g1 ? tr("Đặc điểm tô màu: con gà này cũng mang — được truyền xuống từ đời trước.") : tr("Không rõ bố mẹ: gà nở từ trứng khởi đầu, trứng quà hoặc trứng mua. Gà nở từ trứng đẻ trong trại mới có gia phả.")}</p>`;
  $("#tree-title").textContent = `${tr("Gia phả")} · ${me.name}`;
  $("#tree-dialog").showModal();
}

function renderFlock() {
  setHTML($("#flock"), state.chickens.map((c) => {
    const v = R.chickenView(c, now());
    const label = `${c.sex === "rooster" ? "♂" : "♀"} ${esc(c.name)}${c.location === "field" ? tr(" · ngoài đồng") : v.hungry ? tr(" · đói") : ""}`;
    return `<button type="button" data-pick="${c.id}" class="${v.hungry ? "is-hungry" : ""}" title="${label}" aria-label="${label}" aria-pressed="${c.id === selectedId}"><span class="mini">${chickenSvg(c).svg}</span></button>`;
  }).join("") || `<span class="muted">${tr("Đàn gà: chưa có con nào.")}</span>`);
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
  $("#feed-title").textContent = `${tr("Cho {n} ăn · độ no", { n: ch.name })} ${Math.round(v.satiety01 * 100)}%`;
  const kinds = Object.keys(R.SEEDS).filter((k) => state.inventory[k] > 0);
  $("#feed-list").innerHTML = kinds.length
    ? kinds.map((k) => `<button type="button" data-seed="${k}"><span class="ico">${seedIcon(k, 26)}</span><span><b>${seedName(k)}</b><br><small class="muted">${seedSummary(k)}</small></span><b>×${state.inventory[k]}</b></button>`).join("")
    : `<p class="muted">${tr("Kho hết hạt. Thả gà ra đồng để kiếm hạt, hoặc đổi trứng lấy túi hạt.")}</p>`;
}
$("#feed-list").addEventListener("click", async (ev) => {
  const pickCh = ev.target.closest("[data-chick]")?.dataset.chick;
  if (pickCh) {
    // cho ăn riêng: đã chọn loại hạt ở Kho, giờ chọn gà
    if (await run(act("feed", { chickenId: pickCh, seed: feedSeed }))) {
      chickenFx(pickCh, { colors: [seedColor(feedSeed), "#ff9db0", "#fff"] });
      sfx("peck");
    }
    return state.inventory[feedSeed] > 0 ? openFeedSeed(feedSeed) : $("#feed-dialog").close();
  }
  const k = ev.target.closest("[data-seed]")?.dataset.seed;
  if (!k) return;
  if (await run(act("feed", { chickenId: feedTarget, seed: k }))) {
    chickenFx(feedTarget, { colors: [seedColor(k), "#ff9db0", "#fff"] });
    sfx("peck");
    sfx("peck", 0.12);
  }
  renderFeed();
});

/* ---------- chợ (hộp thoại) ---------- */

let tradeTarget = null;
function openTrade(t) {
  tradeTarget = t;
  const card = (art, title, sub, two = false) => `<span class="art${two ? " two" : ""}">${art}</span><b>${title}</b><span class="muted">${sub}</span>`;
  if (t.chickenId) {
    const ch = state.chickens.find((c) => c.id === t.chickenId);
    if (!ch) return;
    const n = R.CONFIG.trade.eggsPerChicken, adult = R.stageOf(ch) === "adult";
    $("#trade-title").textContent = `${tr("Đổi")} ${ch.name} ${tr("ở chợ")}`;
    $("#trade-note").textContent = tr("Gà sẽ rời trại. Chọn thứ muốn nhận:");
    $("#trade-give").innerHTML = `<div class="art">${chickenSvg(ch).svg}</div>${ch.sex === "rooster" ? "♂" : "♀"} ${esc(ch.name)}`;
    $("#trade-bag").innerHTML = card(bagArt(72, R.chickenTradeValue(ch)), `${tr("Túi")} ${R.chickenTradeValue(ch)} ${tr("hạt")}`, tr("mở ra ngẫu nhiên"));
    const egg = eggArt({ id: "shop", shell: "#f3ead8", fertile: true });
    $("#trade-egg").hidden = false;
    $("#trade-egg").disabled = !adult;
    $("#trade-ticket").hidden = !(hasV7() && adult);
    $("#trade-ticket").innerHTML = card(ticketSvg(60), `${R.CONFIG.tickets.perChicken} ${tr("vé")}`, tr("tối đa 2 con mỗi ngày"));
    $("#trade-egg").innerHTML = card(egg + egg, `${n} ${tr("trứng có phôi")}`, adult ? tr("gen ngẫu nhiên, trống/mái tuỳ may") : tr("cần gà đã trưởng thành"), true);
  } else {
    const egg = state.eggs.find((e) => e.id === t.eggId);
    if (!egg) return;
    $("#trade-title").textContent = `${tr("Đổi trứng")} ${egg.fertile ? tr("có phôi") : tr("không phôi")}`;
    $("#trade-note").textContent = egg.fertile ? tr("Trứng có phôi ấp được ra gà mới — chắc chắn muốn đổi?") : tr("Trứng không phôi không ấp được, đổi lấy hạt là hợp lý.");
    $("#trade-give").innerHTML = `<div class="art">${eggArt(egg)}</div>${egg.fertile ? tr("Có phôi") : tr("Không phôi")}`;
    $("#trade-bag").innerHTML = card(bagArt(72, R.eggTradeValue()), `${tr("Túi")} ${R.eggTradeValue()} ${tr("hạt")}`, tr("mở ra ngẫu nhiên"));
    $("#trade-egg").hidden = true;
    $("#trade-ticket").hidden = !(hasV7() && egg.fertile);
    $("#trade-ticket").innerHTML = card(ticketSvg(60), `${R.CONFIG.tickets.perEgg} ${tr("vé")}`, tr("tối đa 3 quả mỗi ngày"));
  }
  $("#trade-dialog").showModal();
  for (const el of document.querySelectorAll("#trade-dialog .egg")) zoomArt(el);
}
$("#trade-bag").addEventListener("click", async () => {
  const t = tradeTarget;
  $("#trade-dialog").close();
  if (t?.chickenId) await run(act("tradeToShop", { chickens: [t.chickenId] }), tr("Nhận một túi hạt — mở trong Kho"));
  else if (t?.eggId) await run(act("tradeToShop", { eggs: [t.eggId] }), tr("Nhận túi 2 hạt — mở trong Kho"));
  if (t?.chickenId === selectedId) select(null);
  syncYard();
});
$("#trade-ticket").addEventListener("click", async () => {
  const t = tradeTarget;
  $("#trade-dialog").close();
  const give = t?.chickenId ? { chickens: [t.chickenId] } : { eggs: [t.eggId] };
  if (await run(act("tradeToShop", { ...give, want: "tickets" }), tr("Đã nhận vé"))) {
    sfx("coin");
    if (t.chickenId === selectedId) select(null);
    syncYard();
  }
});
$("#trade-egg").addEventListener("click", async () => {
  const t = tradeTarget;
  $("#trade-dialog").close();
  if (t?.chickenId && await run(act("tradeForEgg", { chickenId: t.chickenId }), `${tr("Nhận")} ${R.CONFIG.trade.eggsPerChicken} ${tr("trứng có phôi — trong Kho, kéo vào ổ để ấp")}`)) {
    if (t.chickenId === selectedId) select(null);
    syncYard();
  }
});

/* ---------- kho, kỷ niệm (ngăn trượt) ---------- */

let storeTab = "seeds";
function showStoreTab(k) {
  storeTab = k;
  for (const b of document.querySelectorAll("#store-dialog [data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === k));
  for (const p of document.querySelectorAll("#store-dialog [data-pane]")) p.hidden = p.dataset.pane !== k;
}
function openStore(tab) {
  if (!state) return;
  showStoreTab(typeof tab === "string" ? tab : storeTab);
  renderStore();
  $("#store-dialog").showModal();
}
function renderStore() {
  const seeds = Object.values(state.inventory).reduce((a, b) => a + b, 0);
  $("#seed-cap").textContent = `${seeds}/${R.CONFIG.storage.seeds}`;
  $("#bag-cap").textContent = state.bags.length || "";
  const bar = $("#seed-bar i");
  bar.style.setProperty("--p", `${Math.round((seeds / R.CONFIG.storage.seeds) * 100)}%`);
  $("#seed-bar").classList.toggle("full", seeds >= R.CONFIG.storage.seeds * 0.9);
  // thẻ hạt: hình to, số lượng, 4 vạch chất dinh dưỡng (mô tả chữ nằm trong chú thích)
  setHTML($("#seeds"), Object.keys(R.SEEDS).map((k) => {
    const n = state.inventory[k], nut = R.SEEDS[k].n;
    const bars = R.NUTRIENTS.map((x) => `<i${nut[x] < 0 ? ' class="neg"' : ""} style="--c:${nut[x] < 0 ? "var(--bad, #d64545)" : NUT_COLOR[x]};--v:${Math.min(1, Math.abs(nut[x]) / 26).toFixed(2)}" title="${esc(tr(R.NUTRIENT_INFO[x].name))} ${nut[x]}"></i>`).join("");
    return `<div class="seed-tile${n ? "" : " none"}" title="${esc(seedName(k))}: ${esc(seedSummary(k))}"><span class="ico">${seedIcon(k, 40)}</span><b class="cnt">${n}</b><span class="nm">${seedName(k)}</span><span class="nbars" aria-hidden="true">${bars}</span>${hasV7() ? `<button type="button" class="small" data-feed-seed="${k}"${n > 0 && state.chickens.length ? "" : " disabled"}>${tr("Cho ăn")}</button>` : ""}</div>`;
  }).join(""));
  setHTML($("#bags"), state.bags.length
    ? state.bags.map((b) => `<div class="item"><div class="art">${bagArt(72, b.size)}</div><div>${b.table === "gift" ? tr("Túi quà") : tr("Túi")} ${b.size} ${tr("hạt")}</div><button type="button" class="small primary" data-bag="${b.id}">${tr("Mở túi")}</button></div>`).join("")
    : `<p class="muted">${tr("Không có túi nào. Kéo gà hoặc trứng vào chợ để đổi lấy túi hạt.")}</p>`);
  $("#open-all-bags").hidden = state.bags.length < 2;
  const stored = state.eggs.filter((e) => e.hatchAt === null && !e.inYard);
  const all = state.eggs.filter((e) => e.hatchAt === null).length;
  $("#egg-cap").textContent = stored.length || "";
  $("#egg-cap").title = `${stored.length} ${tr("trong kho")} · ${all}/${R.CONFIG.storage.eggs} ${tr("cả ngoài sân")}`;
  const freeSlot = state.incubators.includes(null);
  setHTML($("#eggs"), stored.length
    ? stored.map((e) => `<div class="item"><div class="art">${eggArt(e)}</div><div>${e.fertile ? `<span class="badge ok">${tr("Có phôi")}</span>` : `<span class="badge">${tr("Không phôi")}</span>`}</div>${e.fertile ? `<div class="muted">${tr("Ấp")} ${Math.round((e.incubateMin ?? R.incubateMsOf(e.code) / MIN))} ${tr("phút")}</div>` : `<div class="muted">${tr("Chỉ để đổi hạt")}</div>`}<div class="row">${e.fertile ? `<button type="button" class="small primary" data-incubate="${e.id}" ${freeSlot ? "" : tr("disabled title=\"Ổ ấp đang bận\"")}>${tr("Ấp")}</button>` : ""}<button type="button" class="small" data-trade-egg="${e.id}">${tr("Đổi túi 2 hạt")}</button></div></div>`).join("")
    : `<p class="muted">${tr("Kho chưa có trứng. Trứng gà mái đẻ nằm ngoài sân — chạm để nhặt.")}</p>`);
}
$("#store-dialog").addEventListener("click", async (ev) => {
  const t = ev.target.closest("button") ?? ev.target;
  if (t.dataset.tab) return showStoreTab(t.dataset.tab);
  if (t.dataset.bag) await openBags([t.dataset.bag]);
  if (t.dataset.feedSeed) return openFeedSeed(t.dataset.feedSeed);
  if (t.id === "open-all-bags") await openBags(state.bags.map((b) => b.id));
  if (t.dataset.incubate) await run(act("incubate", { eggId: t.dataset.incubate }), tr("Đã đặt trứng vào ổ ấp"));
  if (t.dataset.tradeEgg) await run(act("tradeToShop", { eggs: [t.dataset.tradeEgg] }), tr("Nhận túi 2 hạt"));
  if ($("#store-dialog").open) renderStore();
});
$("#open-store").addEventListener("click", () => openStore());
$("#open-log").addEventListener("click", () => $("#log-dialog").showModal());
$("#open-help").addEventListener("click", () => $("#help-dialog").showModal());
$("#replay-intro")?.addEventListener("click", () => { $("#help-dialog").close(); playIntro(true); });

/* ---------- sổ sưu tầm (★ đã nở · ★★ nuôi đủ chất) + mốc mở chuồng (Q13) ---------- */

// Hình minh hoạ cho từng mục sổ / kỳ vật — vẽ một lần rồi giữ lại
const dexArtCache = new Map();
function dexArt(key) {
  if (!dexArtCache.has(key)) {
    const g = R.traitGenome?.(key);
    dexArtCache.set(key, g ? renderChickenFlat(express(g, { nutrition: 0.95, gloss: 0.6 }), { growth: 1, detail: "low", label: "" }) : "");
  }
  return dexArtCache.get(key);
}
function relicArt(key) {
  const k = `relic:${key}`;
  if (!dexArtCache.has(k)) dexArtCache.set(k, renderChickenFlat(express(randomGenome(mulberry32(31), { sex: "hen" }), { nutrition: 0.95, gloss: 0.6 }), { growth: 1, detail: "low", relic: key, label: "" }));
  return dexArtCache.get(k);
}
function renderDex() {
  const dex = state.dex ?? {};
  const done = R.dexStars(state, 2);
  const ms = R.CONFIG.dex.milestones;
  const next = ms[state.milestones ?? 0];
  const prev = (state.milestones ?? 0) > 0 ? ms[state.milestones - 1].at : 0;
  const reward = next ? [next.coop ? `+${next.coop} ${tr("chỗ chuồng")}` : "", next.incubators ? `+${next.incubators} ${tr("ổ ấp")}` : ""].filter(Boolean).join(", ") : "";
  $("#dex-progress").innerHTML = next
    ? `<p><b>${done}</b> ${tr("mục ★★ · mốc tiếp theo ở")} <b>${next.at}</b>: ${reward}</p><div class="progress" role="progressbar" aria-valuemin="${prev}" aria-valuemax="${next.at}" aria-valuenow="${done}"><i style="--p:${Math.round(((done - prev) / (next.at - prev)) * 100)}%"></i></div>`
    : `<p><b>${done}</b> ${tr("mục ★★ — đã đạt mọi mốc (chuồng")} ${state.coopCap} ${tr("chỗ,")} ${state.incubators.length} ${tr("ổ ấp).")}</p>`;
  // v9: thẻ có hình minh hoạ, xếp theo nhóm chất; mục chưa có hiện bóng đen (đoán được dáng, chưa biết tên)
  const groups = [...new Set(R.DEX.map((d) => d.group))];
  $("#dex-list").innerHTML = groups.map((g) => {
    const items = R.DEX.filter((d) => d.group === g);
    const have = items.filter((d) => dex[d.key]).length;
    return `<li class="dex-group"><h3><span class="dot" style="background:var(--${g})"></span>${esc(tr(R.NUTRIENT_INFO[g].name))} <span class="muted">${have}/${items.length}</span><small class="muted">${esc(tr(R.NUTRIENT_INFO[g].grows))}</small></h3><ul class="dex-cards">${items.map((d) => {
      const st = dex[d.key] ?? 0;
      const stars = `<span class="stars" aria-label="${st} ${tr("trên 3 sao")}">${[1, 2, 3].map((i) => `<span class="${i > st ? "off" : i === 3 ? "s3" : ""}">★</span>`).join("")}</span>`;
      return `<li class="dex-item${st ? ` st${st}` : " unknown"}" title="${st ? esc(tr(d.name)) : tr("Chưa nở được gà mang đặc điểm này")}"><div class="dex-art">${dexArt(d.key)}</div><span class="nm">${st ? esc(tr(d.name)) : "???"}</span>${stars}</li>`;
    }).join("")}</ul></li>`;
  }).join("");
  const got = state.breeds ?? {};
  const relics = state.relics ?? {};
  $("#relic-list").innerHTML = R.MYSTERY.map((m) => `<div class="breed relic-card${relics[m.key] != null ? " got" : " unknown"}"><div class="relic-art">${relicArt(m.key)}</div><b>${relics[m.key] != null ? esc(relicName(m.key)) : "???"}</b></div>`).join("");
  $("#breed-cap").textContent = `(${Object.keys(got).length}/${R.BREEDS.length})`;
  $("#breed-list").innerHTML = R.BREEDS.map((b) => `<div class="breed${got[b.key] != null ? " got" : ""}"><span class="tier">${BREED_TIER[b.tier]}</span><b>${esc(tr(b.name))}</b><ul>${b.traits.map((t) => `<li class="${dex[t] ? "has" : ""}">${dex[t] ? esc(tr(R.DEX.find((d) => d.key === t).name)) : "???"}</li>`).join("")}</ul></div>`).join("");
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
  $("#room-text").innerHTML = `${tr("Chuồng đã đủ")} ${state.coopCap} ${tr("chỗ. Đổi")} <b>${esc(old.name)}</b> (${R.stageOf(old) === "adult" ? tr("trưởng thành") : tr("đang lớn")}${tr(", còn ~")}${fmtDur(old.lifespanMs - old.lifeUsed)} ${tr("tuổi) lấy túi")} ${bag} ${tr("hạt để có chỗ cho gà mới? Mở thêm chỗ chuồng bằng cách hoàn thiện")} <b>${tr("Sổ sưu tầm")}</b>.`;
  $("#room-yes").textContent = `${tr("Đổi")} ${old.name} ${tr("lấy túi")} ${bag} ${tr("hạt")}`;
  $("#room-yes").onclick = async () => {
    $("#room-dialog").close();
    await run(act("tradeToShop", { chickens: [old.id] }), `${tr("Đã đổi")} ${old.name} ${tr("— chuồng có chỗ, đặt trứng vào ổ lại nhé")}`);
  };
  $("#room-dialog").showModal();
  renderAll();
  return true;
}
$("#open-memorial").addEventListener("click", () => {
  if (!state) return;
  const fs = state.feathers ?? [];
  $("#feathers").innerHTML = `<h3>${tr("Lông kỷ niệm")} <span class="muted">${fs.length}</span></h3>`
    + (fs.length ? `<div class="feather-row">${[...fs].reverse().map((f) => `<span class="feather-item" title="${esc(f.name)}">${featherSvg(f.code, 76, f.relic)}<small>${esc(f.name)}</small></span>`).join("")}</div>`
      : `<p class="muted">${tr("Gà được chăm no đủ, sống tới tuổi già sẽ để lại một chiếc lông mang màu của nó.")}</p>`);
  $("#feathers").hidden = !state.feathers;
  $("#memorial").innerHTML = state.memorial.length
    ? [...state.memorial].reverse().map((m) => `<div class="item"><div class="art">${memorialSvg(m)}</div><b>${m.feather ? "🪶 " : ""}${esc(m.name)}</b><div class="muted">${tr("Sống")} ${fmtDur(m.diedAt - m.hatchedAt)}${m.starvedMs > HOUR ? ` ${tr("· từng đói")} ${fmtDur(m.starvedMs)}` : ""}</div></div>`).join("")
    : `<p class="muted">${tr("Chưa có con gà nào rời trại.")}</p>`;
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
  if (ok && out) toast(`${out.name} ${tr("về chuồng,")} ${nameOf(id)} ${tr("ra đồng")}`);
  syncYard();
  return ok;
}
function ensureField() {
  if (field) return;
  field = createField({ seed: (sceneSeed() ^ 0x5eed) >>> 0, clock: () => now() });
  if (ICONS?.fieldBackdrop) $("#field-bg").innerHTML = ICONS.fieldBackdrop(W, H, sceneSeed()) + fieldHorizon(sceneSeed());
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
  if (t < luckyNextAt || t - (state.luckyAt ?? -1e15) < R.luckyCooldownMs(now())) return;
  const x = 90 + Math.random() * (W - 180), y = 130 + Math.random() * (H - 200);
  const el = document.createElement("button");
  el.type = "button";
  el.className = "lucky";
  el.setAttribute("aria-label", tr("Đốm sáng — chạm để chỉ cho gà"));
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
  if (hasV7() && R.staminaOf(out) < 1) return toast(`${out.name} ${tr("mệt quá, chạy không nổi — về chuồng nghỉ đã")}`);
  if (!setLure(field, out.id, lucky.x, lucky.y)) return;
  lucky.taken = true;
  lucky.el.classList.add("taken");
  sfx("step");
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
    if (r.code === "seeds_full") popIn("#field-pops", e.x, e.y, tr("Kho đầy"));
    else if (r.code === "not_watching" || r.code === "not_in_field") syncField();
    return scheduleLucky(R.luckyCooldownMs(now()));
  }
  buzz(16);
  if (r.bagId) {
    popIn("#field-pops", e.x, e.y, `${tr("Bới được túi")} ${r.bagSize} ${tr("hạt!")}`);
    burst($("#field-pops"), at, top, { kind: "star", n: 14, colors: ["#ffd95a", "#fff", "#ff9d5c"], spread: 60 });
    sfx("claim");
  } else {
    const kinds = Object.keys(r.got);
    popIn("#field-pops", e.x, e.y, `✨ ${Object.entries(r.got).map(([k, n]) => `+${n} ${seedName(k).toLowerCase()}`).join(", ")}`);
    burst($("#field-pops"), at, top, { kind: "star", n: 8, colors: [...kinds.map((k) => seedColor(k)), "#fff"] });
    sfx(kinds.some((k) => !isStaple(k)) ? "good" : "coin");
  }
  scheduleLucky(R.luckyCooldownMs(now()) + (luckyQuest() ? 1200 : 2000 + Math.random() * 16000));
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
  if (r.ok && r.recalled?.length) toast(`${r.recalled.map(nameOf).join(", ")} ${tr("đã về chuồng")}`);
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
      ? `<b>${esc(out.name)}</b> ${tr("đã no và")} <b>${tr("kho hạt đầy")}</b> ${tr("— gà nằm nghỉ. Về trại cho đàn ăn bớt hạt rồi thả lại nhé.")}`
      : `<b>${esc(out.name)}</b> ${tr("đang kiếm ăn (tốc độ")} ${Math.round(1 + R.chickenView(out, now()).speed01 * 9)}/10)${hasV6() ? `${tr(". Thấy")} <b>${tr("đốm sáng")}</b> ${tr("thì chạm vào: gà chạy tới bới được hạt tốt")}` : ""}${tr(". Rời màn hình là gà tự về chuồng; no rồi thì hạt nhặt được mang về kho.")}`
    : tr("Chưa có gà ngoài đồng — chọn một con bên dưới (mỗi lần chỉ 1 con)."));
  setHTML($("#field-roster"), state.chickens.map((c) => `<button type="button" class="small" data-roster="${c.id}" aria-pressed="${c.location === "field"}">${c.sex === "rooster" ? "♂" : "♀"} ${esc(c.name)}</button>`).join("") || `<span class="muted">${tr("Chưa có gà để thả.")}</span>`);
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
  // gà hết thể lực thì đi chậm một nửa
  for (const [id, a] of field.chickens) {
    const ch = state.chickens.find((c) => c.id === id);
    a.base ??= a.speed;
    a.speed = a.base * (hasV7() && ch && R.staminaOf(ch) < 1 ? 0.5 : 1);
  }
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
        const name = R.SEEDS[kind] ? seedName(kind).toLowerCase() : tr("hạt");
        if (r.ok) {
          popIn("#field-pops", e.x, e.y, r.action === "ate" ? `${tr("Ăn")} ${name}` : `+${name} ${tr("về kho")}`);
          sfx("peck");
          if (!isStaple(kind)) {
            sfx("good", 0.08);
            burst($("#field-pops"), `${(e.x / W) * 100}%`, `${(e.y / H) * 100}%`, { kind: "star", n: 6, colors: [seedColor(kind), "#fff"] });
          }
          if (fieldFull) { fieldFull = false; renderRoster(); }
        } else if (r.code === "seeds_full") {
          // gà no + kho đầy: nằm nghỉ một lúc lâu thay vì mổ rồi bị từ chối liên tục (design-review H1)
          popIn("#field-pops", e.x, e.y, tr("Kho đầy"));
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
    const look = online ? "rice" : s.kind;
    if (ICONS?.fieldSeedSvg) {
      el.className = "seed-dot";
      el.innerHTML = ICONS.fieldSeedSvg(look);
    } else {
      el.className = "seed-dot plain";
      el.style.background = seedColor(look);
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
  sfx("gate");
  view = "field";
  setTimeout(wake, 0);
  $("#view-yard").hidden = true;
  $("#view-field").hidden = false;
  requestAnimationFrame(() => centerPan($("#field-pan")));
  setTimeout(() => centerPan($("#field-pan")), 120); // sau khi cánh đồng vẽ xong nền
  startObserving();
  scrollTo({ top: 0 });
}
function showYard() {
  if (view === "field") sfx("gate");
  document.body.classList.remove("idle");
  stopObserving();
  view = "yard";
  $("#view-field").hidden = true;
  $("#view-yard").hidden = false;
  requestAnimationFrame(() => panTo(470, $("#yard-pan"), false));
  syncYard();
  renderAll();
}
$("#back-yard").addEventListener("click", showYard);
// Treo máy ở cánh đồng: 20 giây không chạm / gõ phím thì ẩn các nút, chỉ còn cảnh và gà. Chạm lại là hiện.
let idleTimer = 0;
function wake() {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  if (view === "field") idleTimer = setTimeout(() => { if (view === "field" && !document.querySelector("dialog[open]")) document.body.classList.add("idle"); }, 20000);
}
for (const ev of ["pointerdown", "pointermove", "keydown"]) addEventListener(ev, wake, { passive: true });
$("#fullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast(tr("Trình duyệt không cho toàn màn hình")));
});
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
  if (rw.bag) parts.push(`${rw.table === "gift" ? tr("túi quà") : tr("túi")} ${rw.bag} ${tr("hạt")}`);
  const seeds = Object.entries(rw.seeds ?? {});
  if (seeds.length > 2) parts.push(`${seeds.reduce((a, [, n]) => a + n, 0)} ${tr("hạt giàu chất")}`);
  else for (const [k, n] of seeds) parts.push(`${n} ${seedName(k).toLowerCase()}`);
  if (rw.egg) parts.push(tr("trứng quà"));
  return parts.join(" + ");
}
// Việc đáng chú ý nhất lúc này: thứ nhận thưởng được → bước mở đầu → việc trong ngày.
function questFocus(q) {
  if (q.tutorial?.done) return { ...q.tutorial, kicker: `${tr("Bước")} ${q.tutorial.step + 1}/${q.tutorial.total} · ${tr("xong!")}`, ready: true };
  const d = q.daily.find((x) => x.done && !x.claimed);
  if (d) return { ...d, kicker: tr("Việc hôm nay · xong!"), ready: true };
  if (q.chest.done && !q.chest.claimed) return { id: "chest", text: tr("Mở rương ngày"), have: q.daily.length, goal: q.daily.length, reward: q.chest.reward, kicker: tr("Xong cả việc hôm nay!"), ready: true };
  if (q.tutorial) return { ...q.tutorial, kicker: `${tr("Bước")} ${q.tutorial.step + 1}/${q.tutorial.total}` };
  const n = q.daily.find((x) => !x.claimed);
  if (n) return { ...n, kicker: `${tr("Việc hôm nay")} ${q.daily.filter((x) => x.claimed).length + 1}/${q.daily.length}` };
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
    setHTML(host, `<button type="button" class="q-main" data-open-quests><span class="q-ico">${flameSvg()}</span><span><span class="q-kicker">${tr("Việc hôm nay")}</span><span class="q-text">${tr("Xong hết rồi! Chuỗi")} ${q.streak} ${tr("ngày — mai có việc mới.")}</span></span></button>`);
  } else {
    setHTML(host, `<button type="button" class="q-main" data-open-quests aria-label="${esc(f.kicker)}: ${esc(f.key ? questText(f) : f.text)} — ${f.have}/${f.goal}"><span class="q-ico">${chestSvg(!!f.ready)}</span><span><span class="q-kicker">${esc(f.kicker)}</span><span class="q-text">${esc(f.key ? questText(f) : f.text)}</span><span class="q-sub"><span class="q-bar"><i style="--p:${Math.round((f.have / f.goal) * 100)}%"></i></span><span>${f.have}/${f.goal}</span><span class="q-rw">🎁 ${esc(rewardText(f.reward))}</span></span></span></button>${f.ready ? `<button type="button" class="q-claim gold" data-claim="${f.id}">${tr("Nhận")}</button>` : ""}`);
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
  const row = (x) => `<div class="qrow${x.done && !x.claimed ? " done" : ""}${x.claimed ? " claimed" : ""}"><div><b>${esc(questText(x))}</b>${sub(x)}</div>${x.claimed ? `<span class="tick">${tr("✓ Đã nhận")}</span>` : `<button type="button" class="small${x.done ? " gold" : ""}" data-claim="${x.id}"${x.done ? "" : " disabled"}>${tr("Nhận")}</button>`}</div>`;
  const t = q.tutorial, c = q.chest;
  const reset = (R.dayIndex(now()) + 1) * DAY - R.CONFIG.daily.tzOffsetMs - now();
  $("#quests-body").innerHTML = `
    <h3 class="section-title">${tr("Bước đầu làm trại")} <span class="muted">${t ? `(${t.step}/${t.total})` : `${tr("— đã xong cả")} ${R.TUTORIAL.length} ${tr("bước")}`}</span></h3>
    ${t ? `<div class="qlist">${row(t)}</div>` : ""}
    <h3 class="section-title">${tr("Việc hôm nay")} <span class="muted">${tr("(đổi việc sau")} ${fmtDur(reset)})</span></h3>
    <div class="qlist">${q.daily.map(row).join("")}
      <div class="qrow chest-row${c.done && !c.claimed ? " done" : ""}${c.claimed ? " claimed" : ""}">${chestSvg(c.claimed)}<div><b>${tr("Rương ngày")}</b><div class="q-sub"><span>${tr("Xong cả")} ${q.daily.length} ${tr("việc để mở · 🎁")} ${esc(rewardText(c.reward))}</span></div></div>${c.claimed ? `<span class="tick">${tr("✓ Đã mở")}</span>` : `<button type="button" class="small${c.done ? " gold" : ""}" data-claim="chest"${c.done ? "" : " disabled"}>${tr("Mở")}</button>`}</div>
    </div>
    <div class="streak">${flameSvg()}<span class="n">${q.streak}</span><span>${tr("ngày liên tiếp")}${q.best > q.streak ? ` ${tr("(kỷ lục")} ${q.best})` : ""}${tr(". Mỗi ngày nhận thưởng ít nhất một việc để giữ chuỗi: rương to dần, cứ")} ${R.CONFIG.daily.streakEgg} ${tr("ngày thêm một quả trứng quà.")}</span></div>`;
}
async function claimQuest(id) {
  const r = await act("claim", { id });
  handleEvents(r.events ?? []);
  if (!r.ok) {
    sfx("error");
    toast(errText(r));
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
  const extra = [];
  if (hasV7()) {
    const vis = R.visitorView(state, now());
    const here = vis?.who && !vis.gone;
    extra.push(...ownedDecor(state.decorOwned));
    if (state.garden) extra.push({ key: "garden", x: GARDEN.x, y: GARDEN.y + 66, w: 220, html: gardenSvg() });
    extra.push({ key: "play", x: SPOTS.play.x, y: SPOTS.play.y + 46, w: 220, html: playgroundSvg() });
    const inTower = Object.values(state.tower ?? {}).reduce((a, b) => a + b, 0);
    extra.push({ key: "tower", x: 384, y: 156, w: 54, html: towerSvg(inTower / R.CONFIG.tower.cap) });
    if (here) extra.push({ key: `visitor-${vis.who}`, x: SPOTS.market.x + 2, y: SPOTS.market.y + 17, w: 52, html: visitorSvg(vis.who) }); // đứng sau quầy
    const z = $('#yard-zones [data-zone="market"]');
    if (z) {
      z.classList.toggle("has-visitor", !!here);
      const lb = z.querySelector(".label"), txt = here ? tr(vis.name) : tr("Chợ");
      if (lb.textContent !== txt) lb.textContent = txt;
      if (here && z.dataset.seen !== String(vis.from)) { z.dataset.seen = String(vis.from); sfx("merchant"); }
    }
    const tw = $('#yard-zones [data-zone="feeder"] .label'), n = Object.values(state.tower).reduce((a, b) => a + b, 0), tx = `${tr("Tháp hạt")} ${n}/${R.CONFIG.tower.cap}`;
    if (tw && tw.textContent !== tx) tw.textContent = tx;
  }
  // gian hàng bên đường luôn có (chợ), kể cả với server luật cũ
  // gian hàng tách hai lớp: mái + cột (sau khách) và quầy (trước khách)
  const stallAt = { x: SPOTS.market.x + 2, y: SPOTS.market.y + 42, w: 92 };
  const vi = extra.findIndex((d) => d.key.startsWith("visitor-"));
  const front = { key: "stall-front", ...stallAt, html: stallSvg(tr("CHỢ"), "front") };
  if (vi >= 0) extra.splice(vi + 1, 0, front); else extra.push(front);
  extra.unshift({ key: "stall", ...stallAt, html: stallSvg(tr("CHỢ"), "back") });
  // cập nhật từng món (theo key): món mới mới "bật" ra; món đổi nội dung (vd. mức hạt trong tháp) chỉ thay hình, không nhảy lại
  const host = $("#yard-decor"), items = [...decorItems(R.decorOf(state), sceneSeed()), ...extra];
  const keep = new Set(items.map((d) => d.key));
  for (const el of [...host.children]) if (!keep.has(el.dataset.decor)) el.remove();
  let prev = null;
  for (const d of items) {
    let el = host.querySelector(`:scope > [data-decor="${d.key}"]`);
    if (!el) {
      el = document.createElement("div");
      el.className = "decor";
      el.dataset.decor = d.key;
    }
    const style = `left:${(d.x / W) * 100}%;top:${(d.y / H) * 100}%;width:${(d.w / W) * 100}%`;
    if (el.getAttribute("style") !== style) el.setAttribute("style", style);
    if (el._html !== d.html) { el._html = d.html; el.innerHTML = d.html; }
    // giữ đúng thứ tự lớp (mái gian hàng → khách → quầy)
    if (prev ? prev.nextElementSibling !== el : host.firstElementChild !== el) prev ? prev.after(el) : host.prepend(el);
    prev = el;
  }
}
function renderSky() {
  const h = new Date(now()).getHours();
  const sky = h < 5 || h >= 19 ? "night" : h < 7 ? "dawn" : h >= 17 ? "dusk" : "day";
  music.scene(sky === "night" ? "night" : view === "field" ? "field" : "yard");
  const cal = R.calendarView?.(now());
  if (cal) {
    if (document.body.dataset.season !== cal.season) document.body.dataset.season = cal.season;
    document.body.classList.toggle("fullmoon", cal.fullMoon);
  }
  if (document.body.dataset.sky !== sky) {
    if (sky === "dawn" && document.body.dataset.sky && state.chickens.some((c) => c.sex === "rooster" && c.adultAt != null)) sfx("crow");
    document.body.dataset.sky = sky;
  }
}
for (const amb of document.querySelectorAll(".amb")) {
  let h = '<i class="cloud"></i>';
  for (let i = 0; i < 7; i++) h += `<i class="ff" style="left:${(8 + Math.random() * 84).toFixed(1)}%;top:${(22 + Math.random() * 68).toFixed(1)}%;animation-delay:${(-Math.random() * 7).toFixed(1)}s,${(-Math.random() * 2).toFixed(1)}s"></i>`;
  for (let i = 0; i < 26; i++) h += `<i class="rd" style="left:${(Math.random() * 100).toFixed(1)}%;animation-delay:${(-Math.random() * 1.2).toFixed(2)}s;animation-duration:${(0.7 + Math.random() * 0.5).toFixed(2)}s"></i>`;
  for (let i = 0; i < 14; i++) h += `<i class="pt" style="left:${(Math.random() * 100).toFixed(1)}%;--c:${["#ff9fc0", "#ffd1e0", "#ffb4a8"][i % 3]};animation-delay:${(-Math.random() * 12).toFixed(1)}s;animation-duration:${(9 + Math.random() * 6).toFixed(1)}s"></i>`;
  h += '<i class="moon"></i>';
  for (let i = 0; i < 2; i++) h += `<i class="bf" style="left:${18 + i * 38}%;top:${44 + i * 20}%;--c:${["#fff6f0", "#ffd95a"][i]};animation-delay:${-i * 8}s"></i>`;
  amb.innerHTML = h;
}
const SPEAKER = (on) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${on ? '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`;
function renderSound() {
  const b = $("#sound");
  b.innerHTML = SPEAKER(!sound.muted);
  b.setAttribute("aria-pressed", String(!sound.muted));
  b.title = sound.muted ? tr("Đang tắt tiếng — bấm để bật") : tr("Đang bật tiếng — bấm để tắt");
}
$("#sound").addEventListener("click", () => {
  sound.toggle();
  if (sound.muted) music.stop(); else music.start();
  renderSound();
});
function renderMusic() {
  const b = $("#music");
  b.setAttribute("aria-pressed", String(music.enabled));
  b.classList.toggle("off", !music.enabled);
  b.title = music.enabled ? tr("Đang bật nhạc nền — bấm để tắt") : tr("Đang tắt nhạc nền — bấm để bật");
}
$("#music").addEventListener("click", () => { music.toggle(); renderMusic(); });
renderMusic();
renderSound();
applyI18n();
$("#lang").textContent = lang.toUpperCase();
$("#lang").title = Object.values(LANG_NAMES).join(" / ");
$("#lang").addEventListener("click", () => setLang(lang === "vi" ? "en" : "vi"));

/* ---------- v7: rương theo giờ, tháp hạt, cho ăn riêng ---------- */

function renderTimed() {
  const b = $("#timed"), tm = hasV7() ? R.questView(state).timed : null;
  b.hidden = !tm;
  if (!tm) return;
  const left = tm.readyAt - now(), ready = left <= 0;
  b.classList.toggle("ready", ready);
  setHTML(b, `${chestSvg(ready)}<span>${ready ? tr("Mở!") : fmtEta(left).replace(tr(" phút"), "′").replace(tr(" giây"), "″").replace(tr(" giờ"), "h")}</span>`);
  b.title = ready ? `${tr("Rương theo giờ:")} ${rewardText(tm.reward)}` : `${tr("Rương theo giờ mở sau")} ${fmtEta(left)} — ${rewardText(tm.reward)}`;
  b.setAttribute("aria-label", b.title);
}
$("#timed").addEventListener("click", () => {
  const tm = R.questView(state).timed;
  if (tm.readyAt <= now()) claimQuest("timed");
  else toast(`${tr("Rương mở sau")} ${fmtEta(tm.readyAt - now())}`);
});

function openTower() {
  renderTower();
  $("#tower-dialog").showModal();
}
function renderTower() {
  const total = Object.values(state.tower).reduce((a, b) => a + b, 0), room = R.CONFIG.tower.cap - total;
  $("#tower-cap").textContent = `(${total}/${R.CONFIG.tower.cap})`;
  $("#tower-list").innerHTML = Object.keys(R.SEEDS).filter((k) => !R.handOnly(k) && (state.inventory[k] > 0 || state.tower[k] > 0)).map((k) => {
    const inv = state.inventory[k], tw = state.tower[k];
    return `<div class="tower-row">${seedIcon(k, 28)}<span>${seedName(k)}<small>${tr("kho")} ${inv} ${tr("· tháp")} <b>${tw}</b></small></span><span class="btns">
      <button type="button" class="small" data-tw="${k}" data-n="1"${inv >= 1 && room >= 1 ? "" : " disabled"}>+1</button>
      <button type="button" class="small primary" data-tw="${k}" data-n="${Math.min(inv, room, 10)}"${inv >= 1 && room >= 1 ? "" : " disabled"}>+${Math.max(1, Math.min(inv, room, 10))}</button>
      <button type="button" class="small" data-tw="${k}" data-n="-${tw}"${tw ? "" : " disabled"} title="${tr("Lấy lại về kho")}">↩</button></span></div>`;
  }).join("") || `<p class="muted">${tr("Kho hết hạt — thả gà ra đồng để kiếm hạt.")}</p>`;
}
$("#tower-list").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-tw]");
  if (!b) return;
  const n = Number(b.dataset.n);
  if (await run(n > 0 ? act("fillTower", { seed: b.dataset.tw, n }) : act("takeFromTower", { seed: b.dataset.tw, n: -n }))) sfx(n > 0 ? "pop" : "tap");
  renderTower();
});

let feedSeed = null;
function openFeedSeed(kind) {
  feedSeed = kind;
  $("#feed-title").textContent = `${tr("Cho ăn")} ${seedName(kind).toLowerCase()} ${tr("(còn")} ${state.inventory[kind]}${tr(") — chọn gà")}`;
  $("#feed-list").innerHTML = state.chickens.filter((c) => c.location === "coop").map((c) => {
    const v = R.chickenView(c, now());
    return `<button type="button" data-chick="${c.id}"><span class="ico">${chickenSvg(c).svg}</span><span><b>${c.sex === "rooster" ? "♂" : "♀"} ${esc(c.name)}</b><br><small class="muted">${STAGE[v.stage]} · no ${Math.round(v.satiety01 * 100)}%</small></span><b></b></button>`;
  }).join("") || `<p class="muted">${tr("Không có con gà nào ở chuồng.")}</p>`;
  if (!$("#feed-dialog").open) $("#feed-dialog").showModal();
}

/* ---------- v7: khách qua đường ---------- */

const V_SAY = {
  seller: tr("Hạt ngon đây cháu ơi! Giá phải chăng, bà chỉ lấy vé thôi."),
  trader: tr("Ta không dùng vé. Đưa đúng thứ ta cần, ta đổi cho thứ khác."),
  collector: tr("Tôi đang tìm một con gà như thế này. Có thì tôi trả vé ngay."),
  reader: tr("Đưa quả trứng đây, để ta soi xem trong đó có gì."),
  haggler: tr("Hàng hiếm đấy! Nhưng giá thì… ta nói chuyện được."),
  artisan: tr("Tự tay tôi làm cả. Trại đẹp thì gà cũng vui."),
  stranger: tr("Ba cái giỏ. Chọn một. Một trong số đó có thứ rất quý…"),
};
const itemText = (it) => (it.decor ? ({ bench: tr("Ghế gỗ"), well: tr("Giếng nước"), birdhouse: tr("Chuồng chim"), windchime: tr("Chuông gió") })[it.decor] : it.egg ? `${tr("Trứng mang")} ${dexName(it.egg).toLowerCase()}` : rewardText(it));
const itemArt = (it) => (it.egg ? eggArt({ id: "v", shell: "#e9dcc3", fertile: true }) : it.bag ? bagArt(64, it.bag) : it.seeds ? seedIcon(Object.keys(it.seeds)[0], 56) : chestSvg(true));
const dexName = (k) => tname("dex", k, R.DEX.find((d) => d.key === k)?.name ?? k);
const price = (n) => `<span class="v-price">${ticketSvg(15)} ${n}</span>`;
const orderText = (o) => `${o.traits.length ? `${tr("gà trưởng thành có")} ${o.traits.map((t) => dexName(t).toLowerCase()).join(tr(" và "))}` : tr("một con gà trưởng thành")}${o.quality ? tr(", nuôi đủ chất") : ""}`;

function openVisitor() {
  if (!hasV7()) return;
  renderVisitor();
  $("#visitor-dialog").showModal();
}
function renderVisitor() {
  const v = R.visitorView(state, now()), body = $("#visitor-body");
  if (!v?.who || v.gone) {
    $("#visitor-title").textContent = tr("Gian hàng bên đường");
    const nx = v?.next;
    body.innerHTML = `<p class="muted">${v?.gone ? tr("Ông lái buôn giận dỗi bỏ đi rồi.") : tr("Chưa có ai ghé.")} ${nx ? `${tr("Khách tiếp theo (")}${tr(R.VISITORS[nx.who].name)}${tr(") tới sau")} ${fmtDur(nx.from - now())}.` : tr("Hôm nay không còn khách nào — mai lại có.")}</p>`;
    return;
  }
  $("#visitor-title").textContent = tr(v.name);
  const head = `<div class="v-head">${visitorSvg(v.who)}<div class="v-say">${V_SAY[v.who]}<br><small class="muted">${tr("Ở lại thêm")} ${fmtEta(v.until - now())} ${tr("· bạn có")} ${state.tickets} ${tr("vé")}</small></div></div>`;
  const done = (i) => v.bought.includes(i);
  let html = "";
  if (v.who === "seller" || v.who === "artisan") {
    html = `<div class="v-list">${v.stock.map((it, i) => `<div class="v-card${done(i) ? " done" : ""}"><div class="art">${itemArt(it)}</div><b>${esc(itemText(it))}</b><button type="button" class="small primary" data-buy="${i}"${done(i) ? " disabled" : ""}>${done(i) ? tr("Đã mua") : `Mua ${price(it.price)}`}</button></div>`).join("")}</div>`;
  } else if (v.who === "stranger") {
    const it = v.stock[0];
    html = `<p class="muted">${tr("Trứng bí ẩn: khoảng")} ${Math.round(R.CONFIG.mystery.chance * 100)}${tr("% nở ra gà mang một")} <b>${tr("kỳ vật")}</b> ${tr("— bộ phận độc nhất không lai giống ra được (đuôi công, cánh bướm…). Có hay không, chỉ biết khi trứng nở.")}</p><div class="v-list"><div class="v-card${done(0) ? " done" : ""}"><div class="art">${eggArt({ id: "m", shell: R.CONFIG.mystery.shell, fertile: true })}</div><b>${tr("Trứng bí ẩn")}</b><button type="button" class="small primary" data-buy="0"${done(0) ? " disabled" : ""}>${done(0) ? tr("Đã mua") : `Mua ${price(it.price)}`}</button></div></div>`;
  } else if (v.who === "trader") {
    html = `<div class="v-list">${v.stock.map((o, i) => `<div class="v-card${done(i) ? " done" : ""}"><div class="art">${itemArt(o.get)}</div><b>${esc(rewardText(o.get))}</b><span class="muted">${tr("đổi lấy")} ${o.give.seed ? `${o.give.n} ${seedName(o.give.seed).toLowerCase()}` : `${o.give.eggs} ${tr("trứng không phôi")}`}</span><button type="button" class="small primary" data-barter="${i}"${done(i) ? " disabled" : ""}>${done(i) ? tr("Đã đổi") : tr("Đổi")}</button></div>`).join("")}</div>`;
  } else if (v.who === "collector") {
    const o = v.stock[0], list = state.chickens.filter((c) => c.location === "coop" && R.stageOf(c) === "adult");
    html = `<p>${tr("Cần:")} <b>${esc(orderText(o))}</b> ${tr("— trả")} ${price(o.pay)}</p>${done(0) ? `<p class="muted">${tr("Bạn đã giao rồi. Cảm ơn nhé!")}</p>` : `<div class="v-list">${list.map((c) => { const ok = R.matchesOrder(c, o); return `<div class="v-card${ok ? " match" : ""}"><div class="art">${chickenSvg(c).svg}</div><b>${esc(c.name)}</b><button type="button" class="small${ok ? " primary" : ""}" data-deliver="${c.id}"${ok ? "" : " disabled"}>${ok ? tr("Giao con này") : tr("Chưa đúng")}</button></div>`; }).join("") || `<p class="muted">${tr("Trại chưa có gà trưởng thành nào ở chuồng.")}</p>`}</div>`}`;
  } else if (v.who === "reader") {
    const eggs = state.eggs.filter((e) => e.fertile);
    html = `<div class="v-list">${eggs.map((e) => `<div class="v-card"><div class="art">${eggArt(e)}</div>${knownText(e) || `<span class="muted">${tr("chưa soi")}</span>`}<button type="button" class="small" data-candle="${e.id}" data-what="sex"${e.known?.sex ? " disabled" : ""}>${tr("Trống hay mái")} ${price(v.stock[0].price)}</button><button type="button" class="small" data-candle="${e.id}" data-what="trait"${e.known?.all ? " disabled" : ""}>${tr("Một đặc điểm")} ${price(v.stock[1].price)}</button></div>`).join("") || `<p class="muted">${tr("Bạn không có quả trứng có phôi nào.")}</p>`}</div>`;
  } else if (v.who === "haggler") {
    const it = v.stock[0], cur = v.price ?? it.price, left = R.VISIT_CONFIG.haggle.tries - v.tries;
    html = `<div class="v-list"><div class="v-card${done(0) ? " done" : ""}"><div class="art">${itemArt(it)}</div><b>${esc(itemText(it))}</b><span>${tr("Giá đang ra:")} ${price(cur)}</span></div></div>${done(0) ? `<p class="muted">${tr("Bạn đã mua món này.")}</p>` : `<div class="v-haggle"><label>${tr("Trả giá")} <input id="offer" type="number" min="1" max="${cur}" value="${Math.max(1, Math.round(cur * 0.8))}" inputmode="numeric"> ${tr("vé")}</label><button type="button" class="primary" data-haggle="offer"${left > 0 ? "" : " disabled"}>${tr("Trả giá (còn")} ${Math.max(0, left)} ${tr("lần)")}</button><button type="button" data-haggle="${cur}">${tr("Mua giá")} ${cur}</button></div><p class="muted">${tr("Trả thấp quá ông ấy sẽ bỏ đi.")}</p>`}`;
  }
  body.innerHTML = head + html;
  for (const el of body.querySelectorAll(".egg")) zoomArt(el);
}
const knownText = (e) => {
  const k = e.known;
  if (!k) return "";
  const parts = [k.sex ? (k.sex === "hen" ? tr("♀ mái") : tr("♂ trống")) : "", ...(k.traits ?? []).map(dexName), k.all && !(k.traits ?? []).length ? tr("không có đặc điểm riêng") : ""].filter(Boolean);
  return parts.length ? `<span class="known">${parts.map(esc).join(" · ")}</span>` : "";
};
$("#visitor-body").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b || b.disabled) return;
  const d = b.dataset;
  let r = null;
  if (d.buy != null) r = await act("buy", { slot: Number(d.buy) });
  else if (d.barter != null) {
    const o = R.visitorView(state, now()).stock[Number(d.barter)];
    const eggs = o.give.eggs ? state.eggs.filter((e) => e.hatchAt === null && !e.fertile).slice(0, o.give.eggs).map((e) => e.id) : [];
    r = await act("barter", { slot: Number(d.barter), eggs });
  } else if (d.deliver) r = await act("deliver", { chickenId: d.deliver });
  else if (d.candle) r = await act("candle", { eggId: d.candle, what: d.what });
  else if (d.haggle) r = await act("haggle", { offer: d.haggle === "offer" ? Math.round(Number($("#offer").value)) : Number(d.haggle) });
  if (!r) return;
  handleEvents(r.events ?? []);
  if (!r.ok) {
    sfx("error");
    toast(errText(r));
  } else {
    save();
    if (r.gone) { sfx("sad"); toast(tr("Ông lái buôn lắc đầu bỏ đi.")); }
    else if (r.counter != null) { sfx("tap"); toast(r.left ? `“${r.counter} ${tr("vé, không bớt nữa đâu!” — còn")} ${r.left} ${tr("lần trả giá")}` : `${tr("“Giá chót")} ${r.counter} ${tr("vé. Mua thì mua.”")}`); }
    else if (d.candle) { sfx("sparkle"); toast(`${tr("Thầy soi thấy:")} ${knownText({ known: r.known }).replace(/<[^>]+>/g, "")}`); }
    else if (d.deliver) { sfx("coin"); if (d.deliver === selectedId) select(null); toast(`${tr("Giao gà, nhận")} ${r.tickets} ${tr("vé")}`); }
    else if (r.got) {
      $("#visitor-dialog").close();
      queueReveal({ kind: "reward", id: "shop", title: d.barter != null ? tr("Đổi xong!") : "Mua xong!", got: r.got });
      pumpReveals();
    }
  }
  syncYard();
  renderAll();
  if ($("#visitor-dialog").open) renderVisitor();
});

/* ---------- v7: sân chơi — trò "đúng nhịp" (bản đầu; trò riêng cho từng tuổi viết sau theo hợp đồng run()) ---------- */

const PLAY_INFO = {
  hop: { name: tr("Nhảy vũng nước"), speed: 0.9, zone: 0.26 },
  dash: { name: tr("Chạy đua"), speed: 1.25, zone: 0.22 },
  peck: { name: tr("Mổ hạt"), speed: 1.5, zone: 0.18 },
  roll: { name: tr("Lăn trứng"), speed: 0.8, zone: 0.28 },
};
// Vạch trắng chạy qua lại; bấm khi vạch nằm trong vùng xanh. 8 lượt, điểm = số lần trúng / 8.
function rhythmGame(host, ch, kind) {
  const P = PLAY_INFO[kind], rounds = 8;
  return new Promise((done) => {
    let i = 0, hits = 0, pos = 0, dir = 1, last = performance.now(), zone = 0.5, over = false;
    host.innerHTML = `<div class="pg"><p class="rv-kicker">${P.name}</p><div class="pg-art">${ch ? chickenSvg(ch, { detail: "high" }).svg : ""}</div>
      <div class="pg-bar"><div class="pg-zone"></div><div class="pg-mark"></div></div><div class="pg-dots">${"<i></i>".repeat(rounds)}</div>
      <div class="rv-actions"><button type="button" class="gold" data-pg="tap">${tr("Bấm!")}</button></div><p class="rv-sub">${tr("Bấm khi vạch trắng nằm trong vùng xanh")}</p></div>`;
    zoomArt(host.querySelector(".pg-art"));
    const mark = host.querySelector(".pg-mark"), zoneEl = host.querySelector(".pg-zone"), dots = host.querySelectorAll(".pg-dots i"), art = host.querySelector(".pg-art");
    const place = () => { zone = 0.18 + Math.random() * 0.64; zoneEl.style.left = `${(zone - P.zone / 2) * 100}%`; zoneEl.style.width = `${P.zone * 100}%`; };
    place();
    const tick = (t) => {
      if (over) return;
      pos += dir * ((t - last) / 1000) * P.speed * (1 + i * 0.06);
      last = t;
      if (pos > 1) { pos = 1; dir = -1; } else if (pos < 0) { pos = 0; dir = 1; }
      mark.style.left = `${pos * 100}%`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const tap = () => {
      if (over) return;
      const ok = Math.abs(pos - zone) <= P.zone / 2;
      dots[i].className = ok ? "hit" : "miss";
      if (ok) { hits++; sfx("pop"); bump(art, "hop"); } else sfx("tap");
      if (++i >= rounds) { over = true; removeEventListener("keydown", key); return setTimeout(() => done(hits / rounds), 500); }
      place();
    };
    const key = (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); tap(); } };
    host.querySelector("[data-pg]").addEventListener("pointerdown", tap);
    addEventListener("keydown", key);
  });
}
// Thuộc tính đưa vào trò chơi (0..1), suy từ VÓC DÁNG (gen + dinh dưỡng lúc lớn) — chỉ đổi cách trò diễn ra,
// không gửi lên server (luật vẫn kẹp điểm và thưởng). Mỗi dáng một lợi thế: chân dài người nhẹ chạy / nhảy giỏi,
// mình to chân ngắn vững chân, lông dài bay lâu, mắt to mỏ dài mổ giỏi. Hạt có chất kháng dùng để nắn dáng.
const playCache = new Map();
function playStats(ch) {
  if (!ch) return { speed: 0.5, jump: 0.5, steady: 0.5, eye: 0.5 };
  const care = R.chickenView(ch, now()).care, key = `${ch.id}|${R.NUTRIENTS.map((k) => (care.dev?.[k] ?? 0).toFixed(2)).join(",")}`;
  if (playCache.has(key)) return playCache.get(key);
  const ph = express(decodeGenome(ch.code), care), sh = ph.shape, c = (v) => clampN(v, 0, 1);
  const weight = c((sh.size * sh.plump - 0.5) / 1.1), legs = c((sh.legLen - 0.55) / 0.9);
  const feathers = c(((sh.tailLen - 0.45) / 1.05) * 0.6 + sh.saddle * 0.4), beak = c((sh.beakLen - 0.6) / 0.85), eye = c((sh.eyeSize - 0.8) / 0.45);
  const out = {
    speed: c(0.45 * (ph.stats.speed ?? 0.5) + 0.35 * legs + 0.2 * (1 - weight)),
    jump: c(0.4 * legs + 0.35 * (1 - weight) + 0.25 * feathers),
    steady: c(0.6 * weight + 0.4 * (1 - legs)),
    eye: c(0.6 * eye + 0.4 * beak),
  };
  if (playCache.size > 200) playCache.clear();
  playCache.set(key, out);
  return out;
}
// Cách trả cho lượt kế tiếp: sức chơi trước (miễn phí), hết thì vé; không còn gì → null.
const canPlay = () => (state.energy && R.energyOf(state, now()) > 0 ? "energy" : (state.tickets ?? 0) >= R.CONFIG.play.cost ? "ticket" : null);
async function playFlow(id) {
  const ch = state.chickens.find((c) => c.id === id);
  const eggSubject = ch ? null : state.eggs.find((e) => e.id === id);
  const pay = canPlay();
  if (!pay) { sfx("error"); return toast(tr("Hết sức chơi và vé — sức chơi hồi 1 điểm mỗi 30 phút")); }
  if (pay === "ticket" && !confirm(tr("Hết sức chơi. Chơi bằng 1 vé (thưởng gấp rưỡi, thắng thì hoàn vé)?"))) return;
  const st = await act("startPlay", { id, ...(pay === "ticket" ? { pay } : {}) });
  handleEvents(st.events ?? []);
  if (!st.ok) { sfx("error"); toast(errText(st)); return renderAll(); }
  save();
  renderAll();
  const dlg = $("#reveal"), t0 = Date.now();
  revealBusy = true;
  try {
    rvBody().innerHTML = "";
    if (!dlg.open) dlg.showModal();
    sfx("whoosh");
    const art = ch ? chickenSvg(ch, { detail: "high" }).svg : eggArt(eggSubject ?? { id: "p", shell: "#f3ead8", fertile: true });
    const game = GAMES[st.kind];
    const running = game ? game(rvBody(), { art, name: ch?.name ?? tr("Trứng"), stats: playStats(ch), sfx }) : rhythmGame(rvBody(), ch, st.kind);
    for (const el of rvBody().querySelectorAll(".pg-hero")) zoomArt(el); // gà con / trứng chỉ chiếm một góc bản vẽ
    const score = await running;
    // luật chỉ nhận kết quả sau ít nhất minMs kể từ lúc bắt đầu
    const wait = R.CONFIG.play.minMs + 300 - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await act("endPlay", { score });
    handleEvents(r.events ?? []);
    save();
    const pct = Math.round((r.score ?? 0) * 100);
    rvShow(`${r.win ? '<div class="rv-rays"></div>' : ""}<p class="rv-kicker">${GAME_NAMES[st.kind] ?? PLAY_INFO[st.kind].name}</p>
      <div class="rv-art">${ch ? chickenSvg(ch, { detail: "high" }).svg : eggArt(eggSubject ?? { id: "p", shell: "#f3ead8", fertile: true })}</div>
      <h2 class="rv-title">${r.win ? tr("Thắng rồi!") : pct >= 30 ? tr("Cũng được đấy") : tr("Hụt mất rồi")}</h2>
      <p class="rv-sub">${tr("Điểm")} ${pct}/100${r.win ? "" : ` ${tr("· cần")} ${Math.round(R.CONFIG.play.winAt * 100)} ${tr("để thắng")}`}</p>
      <ul class="rv-list"><li>${!ch ? tr("Quả trứng sẽ nở sớm hơn") : (r.score ?? 0) <= 0 ? `${esc(ch.name)} ${tr("chơi xong thì đói và mệt hơn")}` : st.kind === "peck" ? `${esc(ch.name)} ${tr("khoẻ ra một chút, nhưng đói và mệt hơn")}` : `${esc(ch.name)} ${tr("lớn nhanh hơn một chút, nhưng đói và mệt hơn")}`}</li>${r.ticket ? `<li>${ticketSvg(16)} ${tr("Thắng: nhận lại 1 vé")}</li>` : r.win && r.pay === "ticket" ? `<li>${tr("Hôm nay đã nhận đủ vé thưởng")}</li>` : ""}${r.pay === "ticket" ? `<li>${tr("Chơi bằng vé: thưởng gấp rưỡi")}</li>` : `<li>${tr("Sức chơi còn")} ${R.energyOf(state, now())}/${R.CONFIG.energy.max}</li>`}</ul>
      <div class="rv-actions"><button type="button" class="gold" data-go="ok">${tr("Về trại")}</button></div>`);
    sfx(r.win ? "claim" : "pop");
    if (r.win) confetti($("#reveal"), { n: 30 });
    await rvWait();
  } finally {
    revealBusy = false;
    if (dlg.open) dlg.close();
    rvBody().innerHTML = "";
    syncYard();
    renderAll();
  }
}

/* ---------- gợi ý bước tiếp theo (thay dòng hướng dẫn dài) ---------- */

const DRAG_HINT = {
  chicken: `${tr("Thả gà vào")} <b>${tr("Cổng")}</b> ${tr("(ra đồng),")} <b>${tr("Máng ăn")}</b> ${tr("(tự ăn) hoặc")} <b>${tr("Chợ")}</b> ${tr("(đổi)")}`,
  egg: `${tr("Thả trứng vào")} <b>${tr("ổ ấp")}</b>, <b>${tr("Chuồng")}</b> ${tr("(cất kho) hoặc")} <b>${tr("Chợ")}</b> ${tr("(đổi)")}`,
  seed: tr("Thả hạt lên một con gà để cho ăn"),
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
      ? `<b>${tr("Chạm vào quả trứng")}</b> ${tr("trong ổ (góc phải sân) để sưởi ấm — trứng nở nhanh hơn. Còn")} ${fmtEta(Math.max(0, hatching[0].hatchAt - t))}`
      : `${tr("Trứng đang ấp trong ổ (góc phải sân) — nở sau")} ${fmtEta(Math.max(0, hatching[0].hatchAt - t))}${tr(". Chờ gà con nhé!")}`;
    if (yardEggs.some((e) => e.fertile) && freeNest) return `${tr("Kéo trứng có phôi (chấm xanh) vào")} <b>${tr("ổ ấp")}</b> ${tr("để có gà mới")}`;
    if (storedFertile && freeNest) return `${tr("Mở")} <b>${tr("Kho")}</b> ${tr("và bấm")} <b>${tr("Ấp")}</b> ${tr("một trứng có phôi để có gà mới")}`;
    if (state.bags.length) return `${tr("Mở túi hạt trong")} <b>${tr("Kho")}</b>${tr(", rồi đổi trứng ở")} <b>${tr("Chợ")}</b>`;
    return `${tr("Trại chưa có gà. Mở")} <b>${tr("Kho")}</b> ${tr("xem còn trứng có phôi không")}`;
  }
  const ripe = (state.garden ?? []).findIndex((p, i) => p && R.plotView(state, i, t).ready);
  if (ripe >= 0 && !hungry) return `${tr("Rau đã chín —")} ${tr("chạm")} <b>${tr("luống rau")}</b> ${tr("để thu hoạch")}`;
  if (hungry && seeds) return `${n(hungry)} ${tr("đang đói —")} ${hasV7() ? `${tr("chạm")} <b>${tr("Tháp hạt")}</b> ${tr("để đổ hạt cho gà tự ăn")}` : `${tr("kéo hạt từ khay lên gà, hoặc kéo gà vào")} <b>${tr("Máng ăn")}</b>`}`;
  if (!seeds && state.bags.length) return `${tr("Hết hạt — mở")} ${state.bags.length} ${tr("túi hạt trong")} <b>${tr("Kho")}</b>`;
  if (!seeds && !out && home.length) return `${tr("Hết hạt — kéo một con gà ra")} <b>${tr("Cổng")}</b> ${tr("để kiếm hạt ngoài cánh đồng")}`;
  if (yardEggs.length) return yardEggs.some((e) => e.fertile) && freeNest
    ? `${tr("Có trứng ngoài sân — kéo trứng có phôi (chấm xanh) vào")} <b>${tr("ổ ấp")}</b>${tr(", hoặc chạm để nhặt")}`
    : tr("Có trứng ngoài sân — chạm để nhặt vào kho");
  if (low && seeds) return `${n(low)} ${tr("sắp đói —")} ${hasV7() ? `${tr("đổ thêm hạt vào")} <b>${tr("Tháp hạt")}</b>` : tr("kéo hạt lên gà để cho ăn")}`;
  if (state.bags.length) return `${tr("Có")} ${state.bags.length} ${tr("túi hạt chưa mở — mở trong")} <b>${tr("Kho")}</b>`;
  if (storedFertile && freeNest) return `${tr("Ổ ấp đang trống — mở")} <b>${tr("Kho")}</b> ${tr("để ấp trứng có phôi")}`;
  if (out) return `${n(out)} ${tr("đang ở ngoài đồng — chạm")} <b>${tr("Cổng")}</b> ${tr("để xem gà kiếm hạt")}`;
  if ((state.stats?.hatched ?? 0) <= 1 && !state.memorial?.length) return `${tr("Kéo gà ra")} <b>${tr("Cổng")}</b> ${tr("để kiếm thêm hạt ngoài cánh đồng · chạm gà để xem chi tiết")}`;
  return tr("Chạm một con gà để xem độ no, dinh dưỡng và tuổi thọ");
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
  document.body.classList.toggle("v7", hasV7());
  renderTimed();
  if (view === "yard") {
    syncYard();
    renderDecor();
    renderQuest();
    renderNests();
    renderGarden();
    renderYardEggs();
    renderTray();
    renderInfo();
    renderFlock();
    renderHint();
    setHTML($("#log"), logItems.map((l) => `<li>${new Date(l.at).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })} · ${l.text}</li>`).join("") || `<li class="muted">${tr("Chưa có gì xảy ra.")}</li>`);
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
        const ev = R.advance(state, now(), { continuous: clock.speed > 1 }); // tua nhanh vẫn là một phiên có mặt
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
          if (!r.ok) return setNetStatus(errText(r));
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
  el.textContent = msg ? `${tr("Mất kết nối:")} ${msg}` : `Online · ${new URL(SERVER).host}`;
  el.classList.toggle("bad", !!msg);
}

/* ---------- bắt đầu ---------- */

async function showStarterOnline() {
  const r = await net.starters();
  if (!r.ok) return toast(r.ok === false && r.code ? errText(r) : tr("Không lấy được trứng khởi đầu"));
  const eggs = r.choices ?? [];
  $("#starter-eggs").innerHTML = eggs.map((e, i) => `<button type="button" data-pick="${e.choice ?? i}">${eggArt({ ...e, id: `s${i}`, fertile: true })}<span>${esc(tr(e.shellName))}</span></button>`).join("");
  $("#starter-eggs").onclick = async (ev) => {
    const i = ev.target.closest("[data-pick]")?.dataset.pick;
    if (i == null) return;
    const n = await net.newFarm(Number(i));
    if (!n.ok) return toast(errText(n));
    applyServer(n);
    $("#starter").close();
    await run(act("incubate", { eggId: state.eggs[0].id }), hasV6() ? tr("Trứng đã nằm trong ổ ấp — chạm vào trứng để sưởi ấm!") : tr("Trứng đã nằm trong ổ ấp ở góc sân. Chờ trứng nở nhé!"));
    syncYard();
  };
  $("#starter").showModal();
}

// Đoạn mở đầu: vài khung hình chạy một lần trước màn chọn trứng (xem lại được trong Cách chơi).
const INTRO_KEY = "trai-ga-intro";
async function playIntro(force = false) {
  try { if (!force && localStorage.getItem(INTRO_KEY)) return; localStorage.setItem(INTRO_KEY, "1"); } catch {}
  const art = {
    yard: ICONS?.yardBackdrop ? ICONS.yardBackdrop(800, 480, 7) : "",
    rooster: renderChickenFlat(express(randomGenome(mulberry32(2026), { sex: "rooster" }), { nutrition: 0.95, gloss: 0.6 }), { growth: 1, detail: "high", label: tr("Ông Mào Đỏ") }),
    egg: (shell, i) => renderEggFlat({ egg: { shell, speckle: 0.2, seed: 11 + i } }, { label: tr("Trứng") }),
  };
  revealBusy = true;
  try {
    await runIntro($("#vn"), art, sfx);
  } finally {
    revealBusy = false;
  }
}

async function showStarter() {
  await playIntro();
  if (online) return showStarterOnline();
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const eggs = R.starterEggs(seed);
  $("#starter-eggs").innerHTML = eggs.map((e, i) => `<button type="button" data-pick="${i}">${eggArt({ ...e, id: `s${i}${seed}`, fertile: true })}<span>${esc(tr(e.shellName))}</span></button>`).join("");
  $("#starter-eggs").onclick = (ev) => {
    const i = ev.target.closest("[data-pick]")?.dataset.pick;
    if (i == null) return;
    state = R.newGame(seed, now(), Number(i));
    R.incubate(state, state.eggs[0].id, now());
    $("#starter").close();
    sfx("pop");
    toast(tr("Trứng đã nằm trong ổ ấp — chạm vào trứng để sưởi ấm!"));
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
  state.inventory.lotus += 10;
  save();
  renderAll();
});
$("#reset").addEventListener("click", () => {
  if (!confirm(online ? tr("Bỏ trại trên máy chủ này và bắt đầu trại mới (tài khoản khách mới)?") : tr("Xoá trại hiện tại và chơi lại từ đầu?"))) return;
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
    return toast(`${e.message} ${tr("— kiểm tra địa chỉ máy chủ trong bảng Dev")}`);
  }
  const r = await net.farm();
  if (r.code === "no_farm") return showStarter();
  if (r.status === 401) {
    net.forget(); // token hết hạn / server mới → tạo khách mới
    return startOnline();
  }
  if (!r.ok) {
    setNetStatus(errText(r));
    return toast(errText(r));
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
