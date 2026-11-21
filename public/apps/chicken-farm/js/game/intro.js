// Trại Gà — đoạn mở đầu dạng visual novel ngắn (chạy lần đầu vào game, xem lại được trong Cách chơi).
// Chỉ là trình diễn phía client, không đụng luật chơi.
//
// playIntro(dialog, art, sfx) → Promise (xong / bỏ qua).
//   dialog: phần tử <dialog id="vn"> trống; art: { yard, rooster, egg(shell, i) } — chuỗi SVG do main.js vẽ sẵn
//   sfx(name): phát hiệu ứng (fx.js)
// Cấu trúc: mỗi CẢNH có nền + nhân vật đứng trên sân khấu, và nhiều LỜI THOẠI hiện trong khung thoại ở đáy
// (chữ chạy từng ký tự; chạm lần 1 = hiện hết câu, lần 2 = sang câu kế). Phím cách / Enter = tiếp, Esc = bỏ qua.

const NARRATOR = null; // lời dẫn chuyện: không có bảng tên
const ROOSTER = "Ông Mào Đỏ";

// Kịch bản. Mỗi cảnh: bg (khoá nền), cast (nhân vật trên sân khấu), lines: [người nói, câu, tuỳ chọn { fx, pose }].
const SCRIPT = [
  {
    bg: "night", cast: [],
    lines: [
      [NARRATOR, "Ở cuối làng có một trại gà nhỏ."],
      [NARRATOR, "Cụ chủ trại đã đi xa từ lâu. Cỏ mọc kín lối, chuồng gà im lìm."],
      [NARRATOR, "Rồi một đêm…", { fx: "shoot" }],
      [NARRATOR, "…một ngôi sao băng lao xuống, rơi đúng vào giữa sân trại!", { fx: "impact" }],
    ],
  },
  {
    bg: "dawn", cast: ["eggs"],
    lines: [
      [NARRATOR, "Sáng hôm sau, trong ổ rơm cũ có ba quả trứng đang toả sáng lấp lánh."],
      [NARRATOR, "Chúng ấm áp lạ thường, như vừa được mặt trời ủ suốt đêm."],
    ],
  },
  {
    bg: "dawn", cast: ["eggs", "rooster"],
    lines: [
      [ROOSTER, "Ò ó o! Lâu lắm rồi mới có người ghé cái trại này!", { pose: "hop" }],
      [ROOSTER, "Ta là Mào Đỏ, canh trại từ hồi cụ chủ còn ở đây đấy."],
      [ROOSTER, "Ba quả trứng kia rơi xuống cùng ngôi sao đêm qua. Mỗi quả mang một dòng giống chưa ai từng thấy."],
      [NARRATOR, "Ông gà già nghiêng đầu, nhìn bạn từ đầu đến chân."],
      [ROOSTER, "Hừm… trông cháu cũng được việc đấy. Cháu chăm chúng giúp ta nhé?", { pose: "hop" }],
    ],
  },
  {
    bg: "day", cast: ["rooster"],
    lines: [
      [ROOSTER, "Chọn một quả, sưởi ấm nó, cho gà con ăn hạt thật ngon…"],
      [ROOSTER, "…rồi một ngày, cả trại này sẽ lại rộn tiếng gà!", { pose: "hop" }],
      [ROOSTER, "Nào, đi chọn trứng thôi!"],
    ],
  },
];

const nightSky = () => `<svg viewBox="0 0 800 480" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs><linearGradient id="vn-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#141a3e"/><stop offset=".7" stop-color="#3b3270"/><stop offset="1" stop-color="#5a4a82"/></linearGradient>
  <radialGradient id="vn-moon"><stop offset="0" stop-color="#fffbe0"/><stop offset="1" stop-color="#fffbe0" stop-opacity="0"/></radialGradient></defs>
  <rect width="800" height="480" fill="url(#vn-sky)"/>
  ${Array.from({ length: 70 }, (_, i) => `<circle class="vn-star" style="animation-delay:${(i % 9) * 0.37}s" cx="${(i * 113) % 800}" cy="${(i * 61) % 300}" r="${i % 5 ? 1.1 : 2}" fill="#fff"/>`).join("")}
  <circle cx="640" cy="90" r="70" fill="url(#vn-moon)" opacity=".5"/><circle cx="640" cy="90" r="26" fill="#fff6c4"/>
  <path d="M0,330 C120,300 220,316 330,296 C450,276 560,300 800,286 V480 H0Z" fill="#1f2b3e"/>
  <path d="M90,330 l70,-46 70,46 v60 h-140z" fill="#2a2433"/><path d="M80,334 l80,-54 80,54" fill="none" stroke="#3a2e3f" stroke-width="8"/>
  <rect x="140" y="350" width="36" height="40" fill="#151019"/>
  ${[300, 340, 380, 420, 460, 500, 540].map((x) => `<rect x="${x}" y="352" width="8" height="40" fill="#2a2433"/>`).join("")}<path d="M296,364 h256 M296,380 h256" stroke="#2a2433" stroke-width="5"/>
  <path d="M0,400 C200,388 500,410 800,396 V480 H0Z" fill="#17202e"/>
  <g class="vn-shoot"><path d="M760,20 L470,250" stroke="#fff6c4" stroke-width="4" stroke-linecap="round"/><circle cx="470" cy="250" r="9" fill="#ffd95a"/></g>
  <circle class="vn-flash" cx="470" cy="330" r="10" fill="#fff6c4"/></svg>`;

function stageHtml(scene, art) {
  const bg = scene.bg === "night" ? nightSky() : `<div class="vn-yard ${scene.bg}">${art.yard}</div>`;
  const cast = scene.cast.map((c) => (c === "eggs"
    ? `<div class="vn-eggs">${["#f3ead8", "#b5dccd", "#c69a72"].map(art.egg).join("")}</div>`
    : `<div class="vn-actor rooster">${art.rooster}</div>`)).join("");
  return `<div class="vn-bg">${bg}</div>${cast}`;
}

export function playIntro(dialog, art, sfx = () => {}) {
  return new Promise((done) => {
    dialog.innerHTML = `<div class="vn-stage"></div>
      <button type="button" class="vn-skip">Bỏ qua ⏭</button>
      <div class="vn-box" role="button" tabindex="0" aria-live="polite"><div class="vn-name" hidden></div><p class="vn-text"></p><span class="vn-next" aria-hidden="true">▼</span></div>`;
    const stage = dialog.querySelector(".vn-stage"), box = dialog.querySelector(".vn-box");
    const nameEl = dialog.querySelector(".vn-name"), textEl = dialog.querySelector(".vn-text");
    let si = -1, li = -1, typing = 0, full = "", shown = 0, over = false;

    const finish = () => {
      if (over) return;
      over = true;
      clearInterval(typing);
      removeEventListener("keydown", onKey);
      dialog.classList.add("vn-out");
      setTimeout(() => { if (dialog.open) dialog.close(); dialog.innerHTML = ""; dialog.classList.remove("vn-out"); done(); }, 350);
    };
    const showLine = () => {
      const scene = SCRIPT[si], [who, text, opt = {}] = scene.lines[li];
      nameEl.hidden = !who;
      nameEl.textContent = who ?? "";
      box.classList.toggle("narrator", !who);
      full = text;
      shown = 0;
      textEl.textContent = "";
      box.classList.remove("ready");
      if (opt.fx === "shoot") { stage.classList.add("shooting"); sfx("whoosh"); }
      if (opt.fx === "impact") { stage.classList.add("impact"); sfx("crack"); setTimeout(() => sfx("sparkle"), 250); }
      const actor = stage.querySelector(".vn-actor");
      if (actor) {
        actor.classList.toggle("talking", !!who);
        if (opt.pose === "hop") { actor.classList.remove("hop"); void actor.offsetWidth; actor.classList.add("hop"); }
      }
      if (who === ROOSTER && li === 0) sfx("cluck");
      clearInterval(typing);
      typing = setInterval(() => {
        shown += 1;
        textEl.textContent = full.slice(0, shown);
        if (shown % 4 === 0 && who) sfx("tap");
        if (shown >= full.length) { clearInterval(typing); typing = 0; box.classList.add("ready"); }
      }, 24);
    };
    const next = () => {
      if (over) return;
      if (typing) { clearInterval(typing); typing = 0; textEl.textContent = full; box.classList.add("ready"); return; } // chạm lần 1: hiện hết câu
      li++;
      if (si < 0 || li >= SCRIPT[si].lines.length) {
        si++;
        li = 0;
        if (si >= SCRIPT.length) return finish();
        stage.classList.remove("shooting", "impact");
        stage.classList.add("fade");
        setTimeout(() => {
          stage.innerHTML = stageHtml(SCRIPT[si], art);
          stage.classList.remove("fade");
          showLine();
        }, si === 0 ? 0 : 280);
        return;
      }
      showLine();
    };
    const onKey = (e) => {
      if (!dialog.open) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); next(); }
      if (e.key === "Escape") { e.preventDefault(); finish(); }
    };
    box.addEventListener("click", next);
    stage.addEventListener("click", next);
    dialog.querySelector(".vn-skip").addEventListener("click", finish);
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); }, { once: true });
    addEventListener("keydown", onKey);
    if (!dialog.open) dialog.showModal();
    box.focus({ preventScroll: true });
    next();
  });
}
