// Trại Gà — nhạc nền tự sinh bằng WebAudio (không tệp nhạc, không lo bản quyền). Thiết kế: docs/chicken-farm/next-rounds.md §F1.
//
// Thang ngũ cung Đô–Rê–Mi–Sol–La cho không khí đồng quê. Ba lớp: đệm hợp âm rải (triangle), giai điệu sinh ngẫu nhiên có
// trọng số (ưu tiên bước liền bậc, câu 4 ô nhịp, lặp lại có biến tấu), bè trầm (sine). Ba cảnh: "yard" (vui), "field"
// (thưa, chậm — nhạc treo máy), "night" (bỏ giai điệu, thêm tiếng dế). Bộ lập lịch "lookahead": mỗi 100 ms xếp trước các
// nốt trong 300 ms tới theo đồng hồ âm thanh, nên không lệch nhịp khi trình duyệt bận.

import { audioOut } from "./fx.js";

const KEY = "trai-ga-music";
const SCALE = [0, 2, 4, 7, 9]; // ngũ cung (nửa cung tính từ Đô)
const CHORDS = [[0, 4, 7], [9, 0, 4], [5, 9, 0], [7, 11, 2]]; // I – vi – IV – V (theo nửa cung)
const SCENES = {
  yard: { bpm: 80, melody: 0.78, arp: true, gain: 1 },
  field: { bpm: 64, melody: 0.5, arp: true, gain: 0.85 },
  night: { bpm: 56, melody: 0, arp: true, gain: 0.7, crickets: true },
};
const freq = (semi, octave) => 261.63 * 2 ** (octave - 4 + semi / 12);

let enabled = true;
try { enabled = localStorage.getItem(KEY) !== "off"; } catch {}
let out = null, bus = null, timer = 0, step = 0, nextAt = 0, scene = "yard", wanted = "yard";
let melodyIdx = 7, phrase = [], phraseBar = 0;

function voice(ctx, t, { f, type = "triangle", dur = 0.3, gain = 0.1, attack = 0.02 }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function cricket(ctx, t) {
  const len = 0.05, buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / d.length) * Math.PI);
  for (let k = 0; k < 3; k++) {
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = buf;
    bp.type = "bandpass";
    bp.frequency.value = 4200;
    bp.Q.value = 12;
    g.gain.value = 0.25;
    src.connect(bp).connect(g).connect(bus);
    src.start(t + k * 0.09);
  }
}

// Một câu giai điệu 4 ô nhịp × 8 nốt móc đơn: chỉ số trong thang (bậc), null = lặng.
function makePhrase(density) {
  const out = [];
  for (let bar = 0; bar < 4; bar++) {
    for (let s = 0; s < 8; s++) {
      const strong = s === 0 || s === 4;
      if (Math.random() > (strong ? 0.95 : density * 0.7)) { out.push(null); continue; }
      const r = Math.random();
      melodyIdx += r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : -2;
      melodyIdx = Math.max(3, Math.min(12, melodyIdx));
      out.push(melodyIdx);
    }
  }
  out[31] = null; // nghỉ cuối câu
  return out;
}

function schedule() {
  if (!out) return;
  const { ctx } = out, S = SCENES[scene], stepDur = 60 / S.bpm / 2;
  while (nextAt < ctx.currentTime + 0.3) {
    const t = nextAt, bar = Math.floor(step / 8), s = step % 8, chord = CHORDS[bar % 4];
    // đổi cảnh chỉ ở đầu câu (4 ô nhịp) để không cắt ngang
    if (step % 32 === 0) {
      if (wanted !== scene) { scene = wanted; bus.gain.setTargetAtTime(0.12 * SCENES[scene].gain, t, 0.8); }
      phraseBar++;
      if (phraseBar % 2 === 1 || !phrase.length) phrase = makePhrase(SCENES[scene].melody);
      else for (let i = 24; i < 32; i++) if (Math.random() < 0.5) phrase[i] = phrase[i] == null ? null : Math.max(3, phrase[i] + (Math.random() < 0.5 ? 1 : -1)); // lặp lại có biến tấu ô cuối
    }
    const Sx = SCENES[scene];
    if (s === 0) voice(ctx, t, { f: freq(chord[0], 2), type: "sine", dur: stepDur * 7, gain: 0.32, attack: 0.04 });
    if (s === 4) voice(ctx, t, { f: freq(chord[2], 2), type: "sine", dur: stepDur * 3.5, gain: 0.2, attack: 0.04 });
    if (Sx.arp && s % 2 === 0) voice(ctx, t, { f: freq(chord[(s / 2) % 3], 3), dur: stepDur * 2.4, gain: 0.07 });
    const m = Sx.melody ? phrase[step % 32] : null;
    if (m != null) voice(ctx, t, { f: freq(SCALE[m % 5], 4 + Math.floor(m / 5) - 1), dur: stepDur * 1.8, gain: 0.11, attack: 0.01 });
    if (Sx.crickets && s % 4 === 1 && Math.random() < 0.55) cricket(ctx, t);
    step++;
    nextAt += stepDur;
  }
}

function start() {
  if (!enabled || timer || document.hidden) return;
  out = audioOut();
  if (!out) return;
  if (!bus) {
    bus = out.ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(out.master);
  }
  bus.gain.setTargetAtTime(0.12 * SCENES[scene].gain, out.ctx.currentTime, 1.2); // vào nhạc từ từ
  nextAt = out.ctx.currentTime + 0.1;
  timer = setInterval(schedule, 100);
}
function stop() {
  clearInterval(timer);
  timer = 0;
  if (out && bus) bus.gain.setTargetAtTime(0.0001, out.ctx.currentTime, 0.3);
}

export const music = {
  get enabled() { return enabled; },
  // cảnh: "yard" | "field" | "night" — đổi ở đầu câu nhạc kế tiếp
  scene(name) { if (SCENES[name]) wanted = name; },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch {}
    enabled ? start() : stop();
    return enabled;
  },
  start,
  stop,
};
// Trình duyệt chỉ cho phát tiếng sau một thao tác của người dùng.
addEventListener("pointerdown", () => start(), { once: true, capture: true });
document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
