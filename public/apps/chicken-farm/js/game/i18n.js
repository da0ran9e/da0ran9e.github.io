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

const KEY = "trai-ga-lang";
export const READY = ["vi"]; // thêm "en" vào ĐẦU danh sách khi đã dịch đủ → tiếng Anh thành mặc định
export const LANG_NAMES = { en: "English", vi: "Tiếng Việt" };

const DICT = {
  vi: {
    "menu.quests": "Nhiệm vụ", "menu.store": "Kho", "menu.dex": "Sổ", "menu.memorial": "Kỷ niệm",
    "menu.log": "Nhật ký", "menu.help": "Cách chơi", "menu.sound": "Âm thanh", "menu.lang": "Ngôn ngữ",
    "seed.common": "Hạt thường", "seed.protein": "Hạt đạm", "seed.energy": "Hạt mẩy", "seed.mineral": "Hạt khoáng",
    "seed.pigment": "Hạt màu", "seed.premium": "Hạt quý", "seed.odd": "Hạt lạ",
    "quest.warm": "Sưởi ấm quả trứng: chạm vào trứng trong ổ {n} lần", "quest.hatch": "Đón gà con đầu tiên chào đời",
    "quest.feed": "Cho gà ăn {n} hạt", "quest.forage": "Để gà kiếm {n} hạt ngoài đồng", "quest.lucky": "Chạm {n} đốm sáng ngoài đồng",
    "quest.hatch2": "Ấp nở quả trứng thứ hai", "quest.juvenile": "Nuôi một con thành gà giò", "quest.adult": "Nuôi một con tới trưởng thành",
    "quest.collect": "Nhặt {n} quả trứng ngoài sân", "quest.dex2": "Đạt mục ★★ đầu tiên trong Sổ sưu tầm", "quest.open": "Mở {n} túi hạt",
    "quest.claim": "Nhận", "quest.step": "Bước {a}/{b}", "quest.today": "Việc hôm nay",
  },
  en: {
    "menu.quests": "Quests", "menu.store": "Storage", "menu.dex": "Book", "menu.memorial": "Memories",
    "menu.log": "Log", "menu.help": "How to play", "menu.sound": "Sound", "menu.lang": "Language",
    "seed.common": "Plain seed", "seed.protein": "Protein seed", "seed.energy": "Plump seed", "seed.mineral": "Mineral seed",
    "seed.pigment": "Colour seed", "seed.premium": "Golden seed", "seed.odd": "Odd seed",
    "quest.warm": "Warm the egg: tap the egg in the nest {n} times", "quest.hatch": "Welcome your first chick",
    "quest.feed": "Feed your chickens {n} seeds", "quest.forage": "Let a chicken find {n} seeds in the field", "quest.lucky": "Tap {n} sparkles in the field",
    "quest.hatch2": "Hatch a second egg", "quest.juvenile": "Raise a chick into a young chicken", "quest.adult": "Raise a chicken to adulthood",
    "quest.collect": "Pick up {n} eggs in the yard", "quest.dex2": "Earn your first ★★ entry in the Book", "quest.open": "Open {n} seed bags",
    "quest.claim": "Claim", "quest.step": "Step {a}/{b}", "quest.today": "Today",
  },
};

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
export const name = (group, id, fallback) => DICT[lang][`${group}.${id}`] ?? fallback ?? DICT.vi[`${group}.${id}`] ?? id;
export const errText = (r) => DICT[lang][`err.${r.code}`] ?? r.message ?? r.code;

export function setLang(code) {
  if (!DICT[code]) return;
  try { localStorage.setItem(KEY, code); } catch {}
  const u = new URL(location.href);
  u.searchParams.delete("lang");
  location.replace(u);
}
export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
}
