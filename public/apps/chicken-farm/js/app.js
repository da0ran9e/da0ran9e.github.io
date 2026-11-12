// Trại Gà — trang demo "phòng gen": xem gà vẽ từ gen, chỉnh gen, lai giống.
import {
  GENES, GENE_MAP, PATTERN_NAMES, COMB_NAMES,
  express, randomGenome, breed, mutate, encodeGenome, decodeGenome, randomName, mulberry32, randomSeed,
} from "./genome.js?v=9";
import { renderChicken, renderEgg } from "./chicken-svg.js";
import { renderChickenFlat, renderEggFlat } from "./chicken-flat.js?v=7";
import { renderChickenFlat2 } from "./chicken-flat2.js?v=7";

// Ưu tiên bản 3D; máy không có WebGL (hoặc không tải được Three.js) thì dùng bản SVG.
let R3 = null;
try {
  const mod = await import("./chicken-3d.js");
  if (mod.supported()) R3 = mod;
} catch (err) {
  console.warn("Không dùng được 3D, chuyển sang 2D", err);
}
let stage3d = null;
const MODE_KEY = "trai-ga-demo-mode-v3";
const MODES = ["flat", "flat2", "detail", "3d"];
let mode = "flat";
try {
  const saved = localStorage.getItem(MODE_KEY);
  if (MODES.includes(saved)) mode = saved;
} catch {}
const use3d = () => mode === "3d" && !!R3;
// Kiểu vẽ 2D: "Phẳng 1" (mặc định — hướng đã chốt; cũng dùng làm dự phòng cho 3D),
// "Phẳng 2" (bóng liền mạch, để dành), "Chi tiết" (từng chiếc lông)
const drawChicken = (ph, o) => (mode === "detail" ? renderChicken(ph, o) : mode === "flat" ? renderChickenFlat(ph, o) : renderChickenFlat2(ph, o));
const drawEgg = (ph, o) => (mode === "detail" ? renderEgg(ph, o) : renderEggFlat(ph, o));
const thumbCache = new Map();
function thumb(ph, key, opts = {}) {
  if (!use3d()) return null;
  const k = `${key}|${opts.egg ? "egg" : opts.growth ?? 1}`;
  if (!thumbCache.has(k)) {
    if (thumbCache.size > 300) thumbCache.delete(thumbCache.keys().next().value);
    thumbCache.set(k, R3.snapshot(ph, opts));
  }
  return thumbCache.get(k);
}
function artHtml(ph, key, label, opts = {}) {
  const url = thumb(ph, key, opts);
  if (url) return `<img src="${url}" alt="${label}" draggable="false">`;
  return opts.egg ? drawEgg(ph, { label }) : drawChicken(ph, { growth: opts.growth ?? 1, label, detail: "low" });
}

const STORE_KEY = "trai-ga-demo-v1";
const $ = (sel) => document.querySelector(sel);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  current: null, // { name, genome }
  coop: [], // [{ id, name, code }]
  father: null,
  mother: null,
  care: { nutrition: 0.7, gloss: 0.35 },
  age: 100,
  focus: null,
};

/* ---------- lưu trữ ---------- */

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      current: { name: state.current.name, code: encodeGenome(state.current.genome) },
      coop: state.coop, father: state.father, mother: state.mother, care: state.care,
    }));
  } catch {}
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!raw) return false;
    state.coop = (raw.coop || []).filter((c) => { try { decodeGenome(c.code); return true; } catch { return false; } });
    state.current = { name: raw.current.name, genome: decodeGenome(raw.current.code) };
    state.father = state.coop.some((c) => c.id === raw.father) ? raw.father : null;
    state.mother = state.coop.some((c) => c.id === raw.mother) ? raw.mother : null;
    if (raw.care) state.care = raw.care;
    return true;
  } catch {
    return false;
  }
}

const newId = () => Math.random().toString(36).slice(2, 10);

function seedCoop() {
  const rng = mulberry32(randomSeed());
  state.coop = [];
  for (let i = 0; i < 8; i++) {
    const genome = randomGenome(rng, { sex: i % 2 ? "hen" : "rooster" });
    state.coop.push({ id: newId(), name: randomName(rng), code: encodeGenome(genome) });
  }
  state.father = state.coop[0].id;
  state.mother = state.coop[1].id;
}

/* ---------- mô tả ---------- */

function summary(ph) {
  const s = ph.shape;
  const bits = [COMB_NAMES[s.combType], PATTERN_NAMES[ph.pattern], `chân ${ph.legName.toLowerCase()}`];
  if (s.crest) bits.push(s.crest === 2 ? "chỏm bông to" : "chỏm nhỏ");
  if (s.muff) bits.push("có râu");
  if (s.silkie) bits.push("lông tơ");
  if (s.frizzle) bits.push(s.frizzle === 2 ? "lông xoăn tít" : "lông xoăn");
  if (s.feetFeather) bits.push("chân có lông");
  if (s.toes > 4) bits.push("5 ngón");
  if (s.tailType === "rumpless") bits.push("cụt đuôi");
  if (s.tailType === "long") bits.push("đuôi dài");
  if (ph.darkSkin) bits.push("da đen");
  if (s.size < 0.9) bits.push("gà tre");
  return bits.join(" · ");
}

const ageLabel = (age) => (age === 0 ? "Trứng" : age < 25 ? "Gà con" : age < 70 ? "Gà giò" : "Trưởng thành");
const growthOf = (age) => Math.max(0, (age - 1) / 99);

/* ---------- sân khấu ---------- */

function applyFocus(root) {
  if (root.id === "stage") {
    if (use3d() && stage3d) stage3d.setFocus(state.focus);
    root = $("#stage-2d");
  }
  if (root.id === "egg-mini") root.classList.toggle("is-focus", !!state.focus && state.focus.includes("egg"));
  const svg = root.querySelector("svg");
  if (!svg) return;
  const parts = state.focus;
  svg.classList.toggle("has-focus", !!parts);
  for (const el of svg.querySelectorAll("[data-part]")) el.classList.toggle("is-focus", !!parts && parts.includes(el.dataset.part));
}

function renderStage({ wobble = false, crack = 0 } = {}) {
  const ph = express(state.current.genome, state.care);
  const stage = $("#stage");
  if (use3d() && stage3d) {
    stage3d.show(ph, { egg: state.age === 0, growth: growthOf(state.age), wobble: wobble ? 1 + crack * 1.5 : 0 });
  } else $("#stage-2d").innerHTML = state.age === 0
    ? drawEgg(ph, { wobble, crack, label: `Trứng của ${state.current.name}` })
    : drawChicken(ph, { growth: growthOf(state.age), label: state.current.name });
  applyFocus(stage);
  $("#age").value = state.age;
  $("#age-label").textContent = ageLabel(state.age);
  return ph;
}

function renderInfo(ph) {
  $("#ck-name").textContent = state.current.name;
  $("#ck-summary").textContent = summary(ph);
  const badge = $("#ck-sex");
  badge.textContent = ph.sex === "rooster" ? "♂ Trống" : "♀ Mái";
  badge.dataset.sex = ph.sex;
  $("#code").value = encodeGenome(state.current.genome);
  $("#egg-mini").innerHTML = artHtml(ph, encodeGenome(state.current.genome) + JSON.stringify(state.care), `Trứng: ${ph.egg.name}`, { egg: true });
  applyFocus($("#egg-mini"));
  $("#btn-mutate").disabled = false;
}

function refresh() {
  const ph = renderStage();
  renderInfo(ph);
  updateGeneOutputs(ph);
  save();
}

function setCurrent(name, genome, { rebuild = true } = {}) {
  state.current = { name, genome };
  if (rebuild) buildGenome();
  refresh();
}

/* ---------- bảng gen ---------- */

const aliasParts = (parts) => parts.map((p) => (p === "feet" ? "legs" : p));

function geneShowText(gene, ph) {
  const pair = state.current.genome.g[gene.key];
  const v = gene.kind === "quant" ? (pair[0] + pair[1]) / 2 : null;
  if (gene.stat) return { bar: v };
  const out = gene.show ? gene.show(ph, v) : "";
  return typeof out === "string" ? { text: out } : out;
}

function buildGenome() {
  const host = $("#genome");
  host.textContent = "";
  const groups = new Map();
  for (const gene of GENES) {
    if (!groups.has(gene.group)) groups.set(gene.group, []);
    groups.get(gene.group).push(gene);
  }
  for (const [group, genes] of groups) {
    const box = document.createElement("details");
    box.className = "gene-group";
    box.open = group !== "Chỉ số ẩn";
    box.innerHTML = `<summary>${group}</summary>`;
    for (const gene of genes) box.append(geneRow(gene));
    host.append(box);
  }
}

function geneRow(gene) {
  const row = document.createElement("div");
  row.className = "gene";
  row.dataset.key = gene.key;
  row.tabIndex = -1;
  const pair = state.current.genome.g[gene.key];
  const name = document.createElement("span");
  name.className = "gene-name";
  name.textContent = gene.label;
  const inputs = document.createElement("span");
  inputs.className = "gene-alleles";
  pair.forEach((value, side) => {
    let input;
    if (gene.kind === "quant") {
      input = document.createElement("input");
      input.type = "range";
      input.min = 0;
      input.max = 255;
      input.value = Math.round(value * 255);
    } else {
      input = document.createElement("select");
      for (const a of gene.alleles) input.add(new Option(a.name === a.id ? a.id : `${a.id} · ${a.name}`, a.id));
      input.value = value;
      input.disabled = !!gene.locked && !(gene.key === "sex" && side === 1);
      if (gene.key === "sex" && side === 1) {
        input.title = "Bản thứ hai quyết định giới tính";
      }
    }
    input.setAttribute("aria-label", `${gene.label} – bản ${side ? "mẹ" : "bố"}`);
    input.addEventListener("input", () => {
      const g = state.current.genome.g[gene.key];
      g[side] = gene.kind === "quant" ? Number(input.value) / 255 : input.value;
      refresh();
    });
    inputs.append(input);
  });
  const out = document.createElement("span");
  out.className = "gene-out";
  row.append(name, inputs, out);

  const parts = aliasParts(gene.parts);
  const focus = () => {
    if (!parts.length) return;
    state.focus = parts;
    applyFocus($("#stage"));
    applyFocus($("#egg-mini"));
    row.classList.add("is-hover");
  };
  const blur = () => {
    state.focus = null;
    applyFocus($("#stage"));
    applyFocus($("#egg-mini"));
    row.classList.remove("is-hover");
  };
  row.addEventListener("pointerenter", focus);
  row.addEventListener("pointerleave", blur);
  row.addEventListener("focusin", focus);
  row.addEventListener("focusout", blur);
  return row;
}

function updateGeneOutputs(ph) {
  for (const row of document.querySelectorAll("#genome .gene")) {
    const gene = GENE_MAP[row.dataset.key];
    const out = row.querySelector(".gene-out");
    const info = geneShowText(gene, ph);
    out.textContent = "";
    if (info.bar !== undefined) {
      const bar = document.createElement("span");
      bar.className = "stat-bar";
      bar.style.setProperty("--v", info.bar.toFixed(3));
      out.append(bar);
      continue;
    }
    if (info.swatch) {
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = info.swatch;
      out.append(sw);
    }
    if (info.text) out.append(info.text);
  }
}

/* ---------- hoạt cảnh ấp nở ---------- */

let animToken = 0;
function animate(duration, step) {
  const token = ++animToken;
  return new Promise((resolve) => {
    const t0 = performance.now();
    const frame = (now) => {
      if (token !== animToken) return resolve(false);
      const t = Math.min(1, (now - t0) / duration);
      step(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve(true);
    };
    requestAnimationFrame(frame);
  });
}

async function hatchOnStage() {
  state.age = 0;
  if (reducedMotion) {
    state.age = 100;
    refresh();
    return;
  }
  renderStage({ wobble: true });
  if (!(await animate(1400, () => {}))) return;
  if (!(await animate(700, (t) => renderStage({ wobble: true, crack: t })))) return;
  await animate(4200, (t) => {
    state.age = Math.max(1, Math.round(1 + 99 * (1 - Math.pow(1 - t, 1.6))));
    renderStage();
  });
  save();
}

/* ---------- chuồng ---------- */

function cardFor(entry, { actions = [], badge } = {}) {
  const node = $("#coop-item").content.firstElementChild.cloneNode(true);
  const genome = decodeGenome(entry.code);
  const ph = express(genome);
  node.dataset.id = entry.id;
  node.querySelector(".ck-card-art").innerHTML = artHtml(ph, entry.code, entry.name);
  node.querySelector(".ck-card-name").textContent = `${ph.sex === "rooster" ? "♂" : "♀"} ${entry.name}`;
  node.querySelector(".ck-card-sub").textContent = summary(ph).split(" · ").slice(0, 2).join(" · ");
  node.querySelector(".ck-card-view").addEventListener("click", () => {
    state.age = 100;
    setCurrent(entry.name, genome);
    $("#stage").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
  });
  node.querySelector(".ck-card-view").setAttribute("aria-label", `Xem ${entry.name}`);
  if (badge) {
    const b = document.createElement("span");
    b.className = "ck-badge";
    b.textContent = badge;
    node.append(b);
  }
  const host = node.querySelector(".ck-card-actions");
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = a.label;
    if (a.pressed !== undefined) btn.setAttribute("aria-pressed", String(a.pressed));
    btn.addEventListener("click", a.run);
    host.append(btn);
  }
  return { node, ph, genome };
}

function renderCoop() {
  const host = $("#coop");
  host.textContent = "";
  $("#coop-count").textContent = `(${state.coop.length})`;
  for (const entry of state.coop) {
    const ph = express(decodeGenome(entry.code));
    const rooster = ph.sex === "rooster";
    const chosen = rooster ? state.father === entry.id : state.mother === entry.id;
    const { node } = cardFor(entry, {
      actions: [
        {
          label: chosen ? (rooster ? "Đang làm bố" : "Đang làm mẹ") : rooster ? "Làm bố" : "Làm mẹ",
          pressed: chosen,
          run: () => {
            if (rooster) state.father = chosen ? null : entry.id;
            else state.mother = chosen ? null : entry.id;
            renderCoop();
            renderParents();
            save();
          },
        },
        {
          label: "Thả",
          run: () => {
            state.coop = state.coop.filter((c) => c.id !== entry.id);
            if (state.father === entry.id) state.father = null;
            if (state.mother === entry.id) state.mother = null;
            renderCoop();
            renderParents();
            save();
          },
        },
      ],
    });
    node.classList.toggle("is-chosen", chosen);
    host.append(node);
  }
}

function renderParents() {
  for (const [slot, id, empty] of [["#slot-father", state.father, "Chọn gà trống"], ["#slot-mother", state.mother, "Chọn gà mái"]]) {
    const el = $(slot);
    const entry = state.coop.find((c) => c.id === id);
    if (!entry) {
      el.innerHTML = `<span class="muted">${empty}</span>`;
      continue;
    }
    const ph = express(decodeGenome(entry.code));
    el.innerHTML = artHtml(ph, entry.code, entry.name) + `<span>${entry.name}</span>`;
  }
  $("#btn-breed").disabled = !(state.father && state.mother);
}

function addToCoop(name, genome) {
  state.coop.unshift({ id: newId(), name, code: encodeGenome(genome) });
  renderCoop();
  save();
}

/* ---------- phối giống ---------- */

function mutationText(mutations) {
  const keys = [...new Set(mutations.map((m) => m.key))];
  return keys.map((k) => GENE_MAP[k].label).join(", ");
}

function breedClutch() {
  const father = state.coop.find((c) => c.id === state.father);
  const mother = state.coop.find((c) => c.id === state.mother);
  if (!father || !mother) return;
  const fg = decodeGenome(father.code), mg = decodeGenome(mother.code);
  const rate = $("#special-feed").checked ? 5 : 1;
  const rng = mulberry32(randomSeed());
  const host = $("#clutch");
  host.textContent = "";
  for (let i = 0; i < 6; i++) {
    const { genome, mutations } = breed(fg, mg, rng, { mutationRate: rate });
    const name = randomName(rng);
    const entry = { id: newId(), name, code: encodeGenome(genome) };
    const ph = express(genome);
    const { node } = cardFor(entry, {
      badge: mutations.length ? "Biến dị" : undefined,
      actions: [{
        label: "Giữ",
        run: (ev) => {
          addToCoop(name, genome);
          ev.currentTarget.disabled = true;
          ev.currentTarget.textContent = "Đã giữ";
        },
      }],
    });
    if (mutations.length) node.title = `Biến dị: ${mutationText(mutations)}`;
    host.append(node);
    hatchCard(node.querySelector(".ck-card-art"), ph, entry.code, name, i * 260);
  }
}

function hatchCard(art, ph, key, name, delay) {
  if (reducedMotion) return;
  if (use3d()) {
    const steps = [[0, { egg: true }, "is-wobble"], [delay + 1100, { growth: 0 }, "is-pop"], [delay + 1900, { growth: 0.45 }, "is-pop"], [delay + 2700, { growth: 1 }, "is-pop"]];
    for (const [ms, opts, cls] of steps) {
      setTimeout(() => {
        if (!art.isConnected) return;
        art.innerHTML = artHtml(ph, key, name, opts);
        art.className = `ck-card-art ${cls}`;
      }, ms);
    }
    return;
  }
  art.innerHTML = drawEgg(ph, { wobble: true, label: `Trứng ${name}` });
  const start = performance.now() + delay + 900;
  const frame = (now) => {
    if (!art.isConnected) return;
    const t = (now - start) / 1600;
    if (t < 0) return requestAnimationFrame(frame);
    if (t >= 1) {
      art.innerHTML = drawChicken(ph, { label: name, detail: "low" });
      return;
    }
    art.innerHTML = drawChicken(ph, { growth: 1 - Math.pow(1 - t, 2), label: name, detail: "low" });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ---------- sự kiện ---------- */

function wire() {
  $("#stage-3d").addEventListener("dblclick", () => stage3d?.resetView());
  $("#btn-view").addEventListener("click", () => stage3d?.resetView());
  if (!R3) $('#view-toggle [data-mode="3d"]').hidden = true;
  for (const btn of document.querySelectorAll("#view-toggle [data-mode]")) {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  }
  $("#age").addEventListener("input", (e) => {
    animToken++;
    state.age = Number(e.target.value);
    renderStage();
  });
  $("#btn-hatch").addEventListener("click", hatchOnStage);
  $("#btn-random").addEventListener("click", () => {
    animToken++;
    state.age = 100;
    $("#mutation-note").hidden = true;
    setCurrent(randomName(), randomGenome());
  });
  $("#btn-mutate").addEventListener("click", () => {
    animToken++;
    const { genome, mutations } = mutate(state.current.genome);
    const note = $("#mutation-note");
    note.hidden = false;
    note.textContent = mutations.length ? `Đã biến dị: ${mutationText(mutations)}` : "Lần này không có gen nào biến dị. Thử lại nhé.";
    setCurrent(state.current.name, genome);
  });
  $("#btn-save").addEventListener("click", () => {
    addToCoop(state.current.name, structuredClone(state.current.genome));
    $("#btn-save").textContent = "Đã đưa vào chuồng";
    setTimeout(() => ($("#btn-save").textContent = "Đưa vào chuồng"), 1500);
  });
  for (const key of ["nutrition", "gloss"]) {
    $(`#${key}`).value = Math.round(state.care[key] * 100);
    $(`#${key}`).addEventListener("input", (e) => {
      state.care[key] = Number(e.target.value) / 100;
      refresh();
    });
  }
  $("#btn-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#code").value);
      $("#btn-copy").textContent = "Đã chép";
    } catch {
      $("#code").select();
    }
    setTimeout(() => ($("#btn-copy").textContent = "Sao chép"), 1200);
  });
  $("#btn-load").addEventListener("click", () => {
    try {
      setCurrent(state.current.name, decodeGenome($("#code").value));
      $("#code").setCustomValidity("");
    } catch (err) {
      $("#code").setCustomValidity(err.message);
      $("#code").reportValidity();
    }
  });
  $("#btn-breed").addEventListener("click", breedClutch);
  $("#btn-reset").addEventListener("click", () => {
    seedCoop();
    renderCoop();
    renderParents();
    save();
  });
}

/* ---------- 2D / 3D ---------- */

function setMode(next, { initial = false } = {}) {
  if (next === "3d" && R3 && !stage3d) {
    try {
      stage3d = R3.createStage($("#stage-3d"));
    } catch (err) {
      console.warn("Không tạo được cảnh 3D", err);
      R3 = null;
    }
  }
  mode = next === "3d" && R3 ? "3d" : MODES.includes(next) && next !== "3d" ? next : "flat";
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  document.body.classList.toggle("is-3d", mode === "3d");
  document.body.classList.toggle("is-flat", mode === "flat" || mode === "flat2");
  $("#stage-2d").hidden = mode === "3d";
  $("#stage-3d").hidden = mode !== "3d";
  stage3d?.setActive(mode === "3d");
  for (const btn of document.querySelectorAll("#view-toggle [data-mode]")) btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
  if (initial) return;
  refresh();
  renderCoop();
  renderParents();
}

/* ---------- khởi động ---------- */

function start() {
  const fromHash = location.hash.length > 1 ? location.hash.slice(1) : null;
  if (!load()) {
    seedCoop();
    const first = state.coop[0];
    state.current = { name: first.name, genome: decodeGenome(first.code) };
  }
  if (fromHash) {
    try {
      state.current = { name: "Gà được chia sẻ", genome: decodeGenome(fromHash) };
    } catch {}
  }
  wire();
  setMode(mode, { initial: true });
  buildGenome();
  refresh();
  renderCoop();
  renderParents();
}

start();
