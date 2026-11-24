import { t as tr } from "./i18n.js";
// Trại Gà — bốn trò ở sân chơi, mỗi tuổi một trò. Chỉ là trình diễn phía client: luật (rules.startPlay / endPlay)
// không tin điểm ở đây, nó kẹp về 0..1 và giới hạn phần thưởng (docs/chicken-farm/design-hard-parts.md §H2).
//
// Hợp đồng: GAMES[kind](host, ctx) → Promise<điểm 0..1>
//   host: phần tử để vẽ vào (trò tự dọn timer / listener khi xong; host do người gọi xoá)
//   ctx:  { art: chuỗi SVG của con gà hoặc quả trứng, name, stats: { speed, jump, steady, eye } mỗi số 0..1, sfx(name) }
//   (v11: mỗi thể trạng là một hàm của kiểu hình — body.js; nắn dáng bằng hạt để hợp từng trò.)
// Thuộc tính của gà đổi CÁCH trò diễn ra (nhảy xa hơn, hạt hiện lâu hơn…), không đổi trần phần thưởng.
// Mỗi trò dài 16–20 giây (luật chỉ nhận kết quả sau 10 giây) và chơi được bằng một nút / phím cách.

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

// Lợi thế vóc dáng ở sân chơi: [khoá, nhãn ngắn, chú thích]. Thứ tự hiển thị trên thẻ gà.
export const PLAY_STATS = [
  ["speed", tr("Chạy"), tr("Chạy đua: mỗi bước dài hơn. Chân dài thì nhanh, mình to thì chậm.")],
  ["jump", tr("Nhảy"), tr("Nhảy vũng nước: bay lâu hơn. Chân dài, lông dài thì nhảy xa; mình to thì nặng.")],
  ["steady", tr("Vững"), tr("Chạy đua: vấp đèn đỏ ít bị lùi hơn. Mình to, năm ngón thì vững; chân dài thì chênh vênh.")],
  ["eye", tr("Mắt"), tr("Mổ hạt: hạt hiện lâu hơn. Mắt to, mỏ dài, cổ dài thì tinh.")],
];
// Dải lợi thế đang có tác dụng trong trò này (để người chơi thấy vóc dáng gà giúp gì) + kỷ lục của con này
function perks(ctx, keys) {
  if (!ctx.stats || ctx.egg) return "";
  const best = ctx.best > 0 ? `<span class="pg-best" title="${tr("Kỷ lục của con này ở trò này")}">${tr("Kỷ lục")} <b>${Math.round(ctx.best * 100)}</b></span>` : "";
  return `<div class="pg-perks">${PLAY_STATS.filter(([k]) => keys.includes(k)).map(([k, label, tip]) => `<span title="${tip}"><b>${label}</b><i style="--v:${clamp(ctx.stats[k] ?? 0.5).toFixed(2)}"></i></span>`).join("")}${best}</div>`;
}

// Vóc dáng giúp được bao nhiêu so với một con gà trung bình (mọi thể trạng 0.5) — dùng đúng công thức trong từng trò.
// Trả [{ key, pct, text }]: pct > 0 là lợi, < 0 là thiệt. Trò của trứng không dùng thể trạng → [].
const AVG = 0.5;
const rel = (f, v) => Math.round((f(v) / f(AVG) - 1) * 100);
const EDGE = {
  hop: (st) => [{ key: "jump", pct: rel((j) => 0.55 + 0.25 * j, st.jump), text: tr("thời gian bay") }],
  dash: (st) => [
    { key: "speed", pct: rel((v) => 0.85 + 0.35 * v, st.speed), text: tr("sải bước") },
    { key: "steady", pct: 0 - rel((v) => 1.25 - 0.75 * v, st.steady), text: tr("bám chân khi vấp") },
  ],
  peck: (st) => [{ key: "eye", pct: rel((e) => 0.85 + 0.45 * e, st.eye), text: tr("hạt hiện lâu") }],
};
export function buildEdge(kind, stats) {
  return stats && EDGE[kind] ? EDGE[kind](stats) : [];
}
const rand = (a, b) => a + Math.random() * (b - a);

// Khung chung: tiêu đề, vùng chơi, dòng hướng dẫn. Trả về các phần tử và hàm loop/finish.
function stage(host, title, hint, inner) {
  host.innerHTML = `<div class="pg"><p class="rv-kicker">${title}</p><div class="pg-time"><i></i></div>${inner}<p class="rv-sub">${hint}</p></div>`;
  const root = host.querySelector(".pg"), bar = root.querySelector(".pg-time i");
  let alive = true, raf = 0;
  const offs = [];
  const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); offs.push(() => el.removeEventListener(type, fn, opts)); };
  // loop(fn): gọi fn(dt giây, t giây đã trôi) mỗi khung hình cho tới khi finish()
  const loop = (fn) => {
    let last = performance.now(), t = 0;
    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      fn(dt, t);
      if (alive) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const stop = () => { alive = false; cancelAnimationFrame(raf); offs.forEach((f) => f()); };
  const time = (left01) => { bar.style.width = `${clamp(left01) * 100}%`; };
  // phím cách / Enter = nút chính
  const key = (fn) => on(window, "keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); fn(); } });
  return { root, on, loop, stop, time, key };
}

/* ---------- gà con: nhảy vũng nước ---------- */
// Vũng nước trôi từ phải sang; bấm để nhảy qua. 10 vũng, điểm = số vũng qua được / 10. Chân dài (jump) nhảy lâu hơn.
function hop(host, ctx) {
  return new Promise((done) => {
    const total = 10, air = 0.55 + 0.25 * ctx.stats.jump;
    const s = stage(host, tr("Nhảy vũng nước"), tr("Bấm để nhảy qua vũng nước"), `${perks(ctx, ["jump"])}
      <div class="pg-field"><div class="pg-hero" style="left:18%">${ctx.art}</div><div class="pg-ground"></div></div>
      <div class="pg-dots">${"<i></i>".repeat(total)}</div><div class="rv-actions"><button type="button" class="gold" data-pg>${tr("Nhảy!")}</button></div>`);
    const field = s.root.querySelector(".pg-field"), hero = s.root.querySelector(".pg-hero"), dots = s.root.querySelectorAll(".pg-dots i");
    let jumpT = -1, spawned = 0, seen = 0, cleared = 0, nextAt = 1.2;
    const puddles = [];
    const jump = () => { if (jumpT < 0) { jumpT = 0; ctx.sfx("pop"); } };
    s.on(s.root.querySelector("[data-pg]"), "pointerdown", jump);
    s.key(jump);
    s.loop((dt, t) => {
      const speed = 34 + spawned * 2.2; // % chiều ngang mỗi giây, nhanh dần
      if (spawned < total && t >= nextAt) {
        const el = document.createElement("i");
        el.className = "pg-puddle";
        field.append(el);
        puddles.push({ el, x: 104, done: false });
        spawned++;
        nextAt = t + rand(1.15, 1.8);
      }
      let y = 0;
      if (jumpT >= 0) {
        jumpT += dt;
        const k = jumpT / air;
        y = k >= 1 ? 0 : Math.sin(k * Math.PI);
        if (k >= 1) jumpT = -1;
      }
      hero.style.transform = `translate(-50%, ${-y * 62}%)`;
      for (const p of puddles) {
        p.x -= speed * dt;
        p.el.style.left = `${p.x}%`;
        if (!p.done && p.x < 24) {
          if (p.x > 12 && y < 0.35) { p.done = true; p.el.classList.add("splash"); dots[seen++].className = "miss"; ctx.sfx("tap"); }
          else if (p.x <= 12) { p.done = true; dots[seen++].className = "hit"; cleared++; }
        }
        if (p.x < -10) p.el.remove();
      }
      s.time(1 - seen / total);
      if (seen >= total) { s.stop(); setTimeout(() => done(cleared / total), 450); }
    });
  });
}

/* ---------- gà giò: chạy đua đèn xanh đèn đỏ ---------- */
// Bấm liên tục để chạy; đèn đỏ mà còn bấm thì vấp, lùi lại. 16 giây, điểm = quãng đường / đích. Gà nhanh (speed) mỗi bước dài hơn.
function dash(host, ctx) {
  return new Promise((done) => {
    const dur = 16, gain = 0.024 * (0.85 + 0.35 * ctx.stats.speed);
    // gà vững chân (mình to, chân ngắn) vấp đèn đỏ thì lùi ít và đứng dậy nhanh hơn
    const steady = ctx.stats.steady ?? 0.5, slip = 0.07 * (1.25 - 0.75 * steady), lock = 0.4 * (1.2 - 0.6 * steady);
    const s = stage(host, tr("Chạy đua"), tr("Bấm thật nhanh khi đèn XANH — đèn ĐỎ thì đứng yên!"), `${perks(ctx, ["speed", "steady"])}
      <div class="pg-field track"><div class="pg-light go"></div><div class="pg-flag"></div><div class="pg-hero" style="left:6%">${ctx.art}</div><div class="pg-ground"></div></div>
      <div class="rv-actions"><button type="button" class="gold" data-pg>${tr("Chạy!")}</button></div>`);
    const hero = s.root.querySelector(".pg-hero"), light = s.root.querySelector(".pg-light");
    let p = 0, red = false, flip = rand(2.2, 3.4), stumble = 0;
    const tap = () => {
      if (red) { p = Math.max(0, p - slip); stumble = lock; ctx.sfx("error"); hero.classList.add("oops"); setTimeout(() => hero.classList.remove("oops"), 380); }
      else if (stumble <= 0) { p = Math.min(1, p + gain); ctx.sfx("tap"); }
    };
    s.on(s.root.querySelector("[data-pg]"), "pointerdown", tap);
    s.key(tap);
    s.loop((dt, t) => {
      stumble -= dt;
      if (t >= flip) {
        red = !red;
        light.className = `pg-light ${red ? "stop" : "go"}`;
        flip = t + (red ? rand(0.9, 1.5) : rand(2, 3.6));
        if (red) ctx.sfx("pop");
      }
      hero.style.left = `${6 + p * 80}%`;
      hero.style.transform = `translate(-50%, ${Math.abs(Math.sin(p * 60)) * -8}%)`;
      s.time(1 - t / dur);
      if (t >= dur || p >= 1) { s.stop(); setTimeout(() => done(clamp(p)), 350); }
    });
  });
}

/* ---------- gà trưởng thành: mổ hạt ---------- */
// Lưới 3×3: hạt vàng và hòn sỏi hiện rồi biến mất; chạm hạt (+1), tránh sỏi (−1). 18 giây. Gà tinh mắt (eye) thấy hạt lâu hơn.
function peck(host, ctx) {
  return new Promise((done) => {
    const dur = 18, life = 0.85 + 0.45 * ctx.stats.eye;
    const s = stage(host, tr("Mổ hạt"), tr("Chạm vào HẠT vàng — đừng mổ sỏi xám"), `${perks(ctx, ["eye"])}
      <div class="pg-hero small">${ctx.art}</div><div class="pg-grid">${'<button type="button" class="pg-hole"></button>'.repeat(9)}</div>`);
    const holes = [...s.root.querySelectorAll(".pg-hole")], hero = s.root.querySelector(".pg-hero");
    const slot = holes.map(() => ({ kind: null, until: 0 }));
    let score = 0, seeds = 0, nextAt = 0.5;
    holes.forEach((el, i) => s.on(el, "pointerdown", () => {
      const k = slot[i].kind;
      if (!k) return;
      if (k === "seed") { score++; ctx.sfx("peck"); hero.classList.add("hop"); setTimeout(() => hero.classList.remove("hop"), 300); }
      else { score = Math.max(0, score - 1); ctx.sfx("error"); }
      el.className = `pg-hole ${k === "seed" ? "got" : "bad"}`;
      slot[i].kind = null;
    }));
    s.loop((dt, t) => {
      if (t >= nextAt && t < dur - 0.6) {
        const free = slot.map((x, i) => (x.kind ? -1 : i)).filter((i) => i >= 0);
        if (free.length) {
          const i = free[Math.floor(Math.random() * free.length)], kind = Math.random() < 0.72 ? "seed" : "stone";
          slot[i] = { kind, until: t + life * (kind === "seed" ? 1 : 1.25) };
          holes[i].className = `pg-hole ${kind}`;
          if (kind === "seed") seeds++;
        }
        nextAt = t + rand(0.42, 0.72);
      }
      slot.forEach((x, i) => { if (x.kind && t >= x.until) { x.kind = null; holes[i].className = "pg-hole"; } });
      s.time(1 - t / dur);
      // mổ được 3/4 số hạt đã hiện là điểm tối đa (không ai chạm kịp tất cả)
      if (t >= dur) { s.stop(); setTimeout(() => done(clamp(score / Math.max(1, seeds * 0.75))), 300); }
    });
  });
}

/* ---------- trứng: giữ thăng bằng ---------- */
// Quả trứng lăn trên thanh gỗ, gió đẩy qua lại; giữ nút trái / phải (hoặc phím mũi tên) để nó ở vùng giữa. 18 giây,
// điểm = phần thời gian trứng nằm trong vùng an toàn.
function roll(host, ctx) {
  return new Promise((done) => {
    const dur = 18, safe = 0.42;
    const s = stage(host, tr("Giữ trứng thăng bằng"), tr("Giữ nút ◀ ▶ để quả trứng nằm trong vùng xanh"), `
      <div class="pg-beam"><div class="pg-safe" style="left:${50 - safe * 50}%;width:${safe * 100}%"></div><div class="pg-hero egg">${ctx.art}</div></div>
      <div class="rv-actions pg-lr"><button type="button" class="gold" data-dir="-1">◀</button><button type="button" class="gold" data-dir="1">▶</button></div>`);
    const egg = s.root.querySelector(".pg-hero");
    let x = 0, v = 0, wind = 0, windAt = 0, push = 0, good = 0;
    for (const b of s.root.querySelectorAll("[data-dir]")) {
      s.on(b, "pointerdown", () => { push = Number(b.dataset.dir); });
      for (const up of ["pointerup", "pointerleave", "pointercancel"]) s.on(b, up, () => { push = 0; });
    }
    s.on(window, "keydown", (e) => { if (e.key === "ArrowLeft") push = -1; else if (e.key === "ArrowRight") push = 1; });
    s.on(window, "keyup", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") push = 0; });
    s.loop((dt, t) => {
      if (t >= windAt) { wind = rand(-1, 1) * (0.5 + t / dur); windAt = t + rand(0.9, 1.8); }
      v += (wind * 0.9 + push * 1.7 + x * 0.6) * dt; // nghiêng về phía nào thì càng lăn về phía đó
      v *= 1 - 1.2 * dt;
      x += v * dt;
      if (Math.abs(x) >= 1) { x = Math.sign(x); v = -v * 0.4; ctx.sfx("tap"); }
      if (Math.abs(x) <= safe) good += dt;
      egg.style.left = `${50 + x * 46}%`;
      egg.style.transform = `translate(-50%, 0) rotate(${x * 140}deg)`;
      egg.classList.toggle("warn", Math.abs(x) > safe);
      s.time(1 - t / dur);
      if (t >= dur) { s.stop(); setTimeout(() => done(clamp(good / dur / 0.8)), 300); } // giữ được 80% thời gian là điểm tối đa
    });
  });
}

export const GAMES = { hop, dash, peck, roll };
export const GAME_NAMES = { hop: tr("Nhảy vũng nước"), dash: tr("Chạy đua"), peck: tr("Mổ hạt"), roll: tr("Giữ trứng thăng bằng") };
