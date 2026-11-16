// Trại Gà — hiệu ứng trình diễn (không đụng tới luật chơi): âm thanh tổng hợp bằng WebAudio
// (không cần tệp âm thanh), rung nhẹ, hạt bay, pháo giấy, vật bay về thanh tài nguyên.
// Mọi thứ ở đây tắt được: nút loa (lưu trong trình duyệt) và "giảm chuyển động" của hệ điều hành.

const KEY = "trai-ga-sound";
let ctx = null, master = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === "off"; } catch {}

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- âm thanh ---------- */

function audio() {
  if (muted) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Một nốt: tần số trượt f0 → f1 trong dur giây, âm lượng lên nhanh rồi tắt dần.
function tone(c, t, { type = "sine", f0 = 440, f1 = f0, dur = 0.12, gain = 0.3, attack = 0.005 }) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf = null;
function noise(c, t, { dur = 0.08, gain = 0.2, type = "highpass", freq = 2000, q = 0.7, f1 = freq }) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (f1 !== freq) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const notes = (c, t, list, opts = {}) => list.forEach(([f, at, dur = 0.16], i) => tone(c, t + at, { type: "triangle", f0: f, dur, gain: 0.22, ...opts, ...(list[i][3] || {}) }));

const SFX = {
  tap: (c, t) => tone(c, t, { f0: 620, f1: 420, dur: 0.05, gain: 0.18 }),
  warm: (c, t) => { tone(c, t, { type: "triangle", f0: 300, f1: 520, dur: 0.12, gain: 0.22 }); noise(c, t, { dur: 0.1, gain: 0.04, type: "lowpass", freq: 900 }); },
  crack: (c, t) => { noise(c, t, { dur: 0.05, gain: 0.35, freq: 2600 }); noise(c, t + 0.05, { dur: 0.07, gain: 0.2, freq: 1500 }); tone(c, t, { type: "square", f0: 180, f1: 90, dur: 0.06, gain: 0.08 }); },
  cheep: (c, t) => { for (const d of [0, 0.13]) tone(c, t + d, { f0: 2500, f1: 3600, dur: 0.07, gain: 0.16 }); },
  cluck: (c, t) => { for (const [d, f] of [[0, 520], [0.09, 460], [0.2, 700]]) tone(c, t + d, { type: "sawtooth", f0: f, f1: f * 0.62, dur: 0.07, gain: 0.07 }); },
  peck: (c, t) => { noise(c, t, { dur: 0.025, gain: 0.22, freq: 3200 }); tone(c, t, { f0: 1100, f1: 700, dur: 0.03, gain: 0.1 }); },
  pop: (c, t) => tone(c, t, { f0: 760, f1: 1500, dur: 0.07, gain: 0.2 }),
  good: (c, t) => notes(c, t, [[1175, 0, 0.1], [1568, 0.07, 0.16]]),
  coin: (c, t) => notes(c, t, [[1319, 0, 0.09], [1976, 0.08, 0.22]], { type: "sine", gain: 0.2 }),
  claim: (c, t) => notes(c, t, [[784, 0], [988, 0.09], [1175, 0.18], [1568, 0.27, 0.3]]),
  hatch: (c, t) => { notes(c, t, [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3, 0.4]]); noise(c, t + 0.3, { dur: 0.35, gain: 0.05, freq: 5000 }); },
  fanfare: (c, t) => { notes(c, t, [[523, 0, 0.14], [523, 0.14, 0.1], [659, 0.26, 0.14], [784, 0.4, 0.14], [1047, 0.56, 0.5]]); notes(c, t + 0.56, [[659, 0, 0.5], [784, 0, 0.5]], { gain: 0.1 }); },
  sparkle: (c, t) => notes(c, t, [[2093, 0, 0.08], [2637, 0.06, 0.08], [3136, 0.12, 0.14]], { type: "sine", gain: 0.1 }),
  whoosh: (c, t) => noise(c, t, { dur: 0.22, gain: 0.12, type: "bandpass", freq: 500, f1: 2600, q: 1.2 }),
  grow: (c, t) => notes(c, t, [[440, 0, 0.1], [554, 0.08, 0.1], [659, 0.16, 0.1], [880, 0.24, 0.24]], { type: "sine", gain: 0.18 }),
  sad: (c, t) => notes(c, t, [[392, 0, 0.22], [330, 0.2, 0.36]], { type: "sine", gain: 0.14 }),
  error: (c, t) => tone(c, t, { type: "square", f0: 170, f1: 130, dur: 0.12, gain: 0.06 }),
};

export function sfx(name, delay = 0) {
  const c = audio();
  if (c && SFX[name]) SFX[name](c, c.currentTime + delay);
}
export const sound = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem(KEY, muted ? "off" : "on"); } catch {}
    if (!muted) sfx("pop");
    return muted;
  },
};
// Trình duyệt chỉ cho phát tiếng sau một thao tác của người dùng: mở sẵn ngữ cảnh ở lần chạm đầu.
addEventListener("pointerdown", () => audio(), { once: true, capture: true });

export function buzz(ms = 12) {
  try { if (!muted) navigator.vibrate?.(ms); } catch {}
}

/* ---------- hạt bay / pháo giấy ---------- */

const rand = (a, b) => a + Math.random() * (b - a);

// Chùm hạt toả ra từ (left, top) của `host` (chuỗi CSS, ví dụ "42%"). kind: spark | heart | heat | bit | star.
export function burst(host, left, top, { n = 8, kind = "spark", colors = ["#ffd95a", "#fff3b0", "#ff9d5c"], spread = 46, rise = 26, life = 650 } = {}) {
  if (!host || calm()) return;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    const a = rand(0, Math.PI * 2), d = rand(spread * 0.35, spread);
    p.className = `fx-p fx-${kind}`;
    p.style.cssText = `left:${left};top:${top};--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d * 0.7 - rise).toFixed(1)}px;--rot:${rand(-200, 200).toFixed(0)}deg;--c:${colors[i % colors.length]};--s:${rand(0.7, 1.25).toFixed(2)};animation-duration:${Math.round(life * rand(0.75, 1.15))}ms`;
    host.append(p);
    setTimeout(() => p.remove(), life * 1.2);
  }
}

// Pháo giấy rơi phủ chiều ngang của `host`.
export function confetti(host, { n = 44, colors = ["#e4572e", "#f2b318", "#4a8f9c", "#b23a9b", "#7cc35f", "#fff"] } = {}) {
  if (!host || calm()) return;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = "fx-confetti";
    p.style.cssText = `left:${rand(2, 98).toFixed(1)}%;--c:${colors[i % colors.length]};--dx:${rand(-60, 60).toFixed(0)}px;--rot:${rand(360, 1080).toFixed(0)}deg;--w:${rand(6, 11).toFixed(0)}px;animation-duration:${rand(1500, 2800).toFixed(0)}ms;animation-delay:${rand(0, 500).toFixed(0)}ms`;
    host.append(p);
    setTimeout(() => p.remove(), 3600);
  }
}

// Một vật (HTML) bay từ điểm màn hình (x, y) tới giữa phần tử `to` rồi biến mất; trả về Promise khi tới nơi.
export function flyTo(html, x, y, to, { size = 34, ms = 560 } = {}) {
  return new Promise((done) => {
    const r = to?.getBoundingClientRect?.();
    if (!r || calm()) return done();
    const el = document.createElement("div");
    el.className = "fx-fly";
    el.innerHTML = html;
    el.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;transition-duration:${ms}ms`;
    document.body.append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transform = `translate(${(r.left + r.width / 2 - x).toFixed(1)}px, ${(r.top + r.height / 2 - y).toFixed(1)}px) translate(-50%, -50%) scale(.45)`;
      el.style.opacity = "0.2";
    }));
    setTimeout(() => { el.remove(); done(); }, ms + 40);
  });
}

// Nảy một cái (thanh tài nguyên, nút…) để báo "vừa thay đổi".
export function bump(el, cls = "bump") {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 600);
}
