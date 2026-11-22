// Trại Gà — đa ngôn ngữ (chỉ phía client; luật chơi và server không đổi).
//
// Cách dùng:
//   t("menu.store")                    chuỗi theo khoá; thiếu ở ngôn ngữ hiện tại → lấy bản tiếng Việt → trả về chính khoá
//   t("quest.feed", { n: 8 })          thay {n} trong chuỗi
//   name("seed", "common", fallback)   tên dữ liệu của luật theo id (seed.*, dex.*, breed.*, nutrient.*); thiếu → fallback
//   errText(result)                    lỗi của luật theo result.code (err.*); thiếu → result.message (tiếng Việt của luật)
//   applyI18n(root)                    điền chữ cho phần tử có data-i18n / data-i18n-title / data-i18n-aria trong HTML tĩnh
//
// Thêm ngôn ngữ: thêm một khối vào DICT với cùng bộ khoá. Thêm chuỗi: thêm khoá vào DICT.vi TRƯỚC (bản gốc),
// rồi dịch sang các khối khác. READY liệt kê ngôn ngữ đã dịch đủ; ngôn ngữ chưa đủ chỉ bật được bằng ?lang=.
// Việc còn lại (chuyển hết chuỗi trong main.js / game.html sang khoá): xem docs/chicken-farm/next-rounds.md §i18n.

import EN from "./i18n-en.js"; // bản dịch tiếng Anh, khoá = chính câu tiếng Việt trong mã

const KEY = "trai-ga-lang";
export const READY = ["en", "vi"]; // ngôn ngữ đầu tiên là mặc định (chủ dự án: tiếng Anh)
export const LANG_NAMES = { en: "English", vi: "Tiếng Việt" };

const DICT = {
  vi: {
    "menu.quests": "Nhiệm vụ", "menu.store": "Kho", "menu.dex": "Sổ", "menu.memorial": "Kỷ niệm",
    "menu.log": "Nhật ký", "menu.help": "Cách chơi", "menu.sound": "Âm thanh", "menu.lang": "Ngôn ngữ",
    "seed.rice": "Lúa", "seed.mung": "Đậu xanh", "seed.millet": "Kê", "seed.sesame": "Vừng", "seed.marigold": "Vạn thọ",
    "seed.sunflower": "Hướng dương", "seed.corn": "Ngô", "seed.pumpkin": "Bí đỏ", "seed.peanut": "Đậu phộng", "seed.lotus": "Sen", "seed.odd": "Hạt lạ",
    "quest.warm": "Sưởi ấm quả trứng: chạm vào trứng trong ổ {n} lần", "quest.hatch": "Đón gà con đầu tiên chào đời",
    "quest.feed": "Cho gà ăn {n} hạt", "quest.forage": "Để gà kiếm {n} hạt ngoài đồng", "quest.lucky": "Chạm {n} đốm sáng ngoài đồng",
    "quest.hatch2": "Ấp nở quả trứng thứ hai", "quest.juvenile": "Nuôi một con thành gà giò", "quest.adult": "Nuôi một con tới trưởng thành",
    "quest.collect": "Nhặt {n} quả trứng ngoài sân", "quest.dex2": "Đạt mục ★★ đầu tiên trong Sổ sưu tầm", "quest.open": "Mở {n} túi hạt", "quest.harvest": "Thu hoạch {n} luống rau",
    "quest.claim": "Nhận", "store.seeds": "Hạt", "store.bags": "Túi hạt", "store.eggs": "Trứng", "quest.step": "Bước {a}/{b}", "quest.today": "Việc hôm nay",
  },
  en: {
    "menu.quests": "Quests", "menu.store": "Storage", "menu.dex": "Book", "menu.memorial": "Memories",
    "menu.log": "Log", "menu.help": "How to play", "menu.sound": "Sound", "menu.lang": "Language",
    "seed.rice": "Rice", "seed.mung": "Mung bean", "seed.millet": "Millet", "seed.sesame": "Sesame", "seed.marigold": "Marigold",
    "seed.sunflower": "Sunflower", "seed.corn": "Corn", "seed.pumpkin": "Pumpkin", "seed.peanut": "Peanut", "seed.lotus": "Lotus", "seed.odd": "Odd seed",
    "quest.warm": "Warm the egg: tap the egg in the nest {n} times", "quest.hatch": "Welcome your first chick",
    "quest.feed": "Feed your chickens {n} seeds", "quest.forage": "Let a chicken find {n} seeds in the field", "quest.lucky": "Tap {n} sparkles in the field",
    "quest.hatch2": "Hatch a second egg", "quest.juvenile": "Raise a chick into a young chicken", "quest.adult": "Raise a chicken to adulthood",
    "quest.collect": "Pick up {n} eggs in the yard", "quest.dex2": "Earn your first ★★ entry in the Book", "quest.open": "Open {n} seed bags", "quest.harvest": "Harvest {n} garden beds",
    "quest.claim": "Claim", "store.seeds": "Seeds", "store.bags": "Bags", "store.eggs": "Eggs", "quest.step": "Step {a}/{b}", "quest.today": "Today",
  },
};

Object.assign(DICT.en, EN);

function pick() {
  let q = null, saved = null;
  try { q = new URLSearchParams(location.search).get("lang"); } catch {}
  try { saved = localStorage.getItem(KEY); } catch {}
  if (q && DICT[q]) { try { localStorage.setItem(KEY, q); } catch {} return q; }
  if (saved && DICT[saved]) return saved;
  return READY[0];
}
export const lang = pick();

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s);
export const has = (key) => key in DICT[lang] || key in DICT.vi;
export const t = (key, vars) => fill(DICT[lang][key] ?? DICT.vi[key] ?? key, vars);
// Tên dữ liệu của luật (hạt, sổ, giống…): khoá nhóm.id nếu có, không thì dịch chính tên tiếng Việt của luật.
export const name = (group, id, fallback) => DICT[lang][`${group}.${id}`] ?? (fallback != null ? t(fallback) : DICT.vi[`${group}.${id}`] ?? id);
export const errText = (r) => DICT[lang][`err.${r.code}`] ?? r.message ?? r.code;

export function setLang(code) {
  if (!DICT[code]) return;
  try { localStorage.setItem(KEY, code); } catch {}
  const u = new URL(location.href);
  u.searchParams.delete("lang");
  location.replace(u);
}
// Chữ tĩnh trong game.html (viết bằng tiếng Việt): dịch một lần lúc tải trang. Phần tử có data-i18n-html được dịch
// cả câu (giữ thẻ <b> bên trong, đúng thứ tự từ); còn lại dịch từng đoạn chữ và các thuộc tính title / aria-label.
const VI = /[À-ÖØ-öø-ỹ]/;
function translateStatic(root) {
  if (lang === "vi") return;
  for (const el of root.querySelectorAll("[data-i18n-html]")) {
    const k = el.innerHTML.replace(/\s+/g, " ").trim();
    if (DICT[lang][k]) el.innerHTML = DICT[lang][k];
  }
  const walk = document.createTreeWalker(root.body ?? root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const raw = n.nodeValue, k = raw.trim();
    if (k && DICT[lang][k] != null && !n.parentElement?.closest("script, style, [data-i18n], [data-i18n-html]")) n.nodeValue = raw.replace(k, DICT[lang][k]);
  }
  for (const el of root.querySelectorAll("[title], [aria-label], [placeholder]")) {
    for (const a of ["title", "aria-label", "placeholder"]) {
      const v = el.getAttribute(a);
      if (v && VI.test(v) && DICT[lang][v] != null) el.setAttribute(a, DICT[lang][v]);
    }
  }
  if (DICT[lang][document.title]) document.title = DICT[lang][document.title];
  const meta = document.querySelector('meta[name="description"]');
  if (meta && DICT[lang][meta.content]) meta.content = DICT[lang][meta.content];
}

export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  translateStatic(root);
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
}
