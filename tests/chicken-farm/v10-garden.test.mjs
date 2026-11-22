// Luật v10 — vườn rau: gieo, tưới, thu hoạch; số luống theo mốc sổ; mùa đổi thời gian lớn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, TIME, newGame, advance, plant, waterPlot, harvest, plotView, gardenSize, growMsOf, seasonOf, canPlant, questView } from "../../public/apps/chicken-farm/js/game/rules.js";

const { MIN, HOUR, DAY } = TIME;
const G = CONFIG.garden;
// thứ Năm 26/11/2026 10:00 VN (tuần mùa mưa / gặt tuỳ lịch — các test tự tính theo growMsOf)
const T0 = Date.UTC(2026, 10, 26, 3, 0, 0);
const farm = () => { const s = newGame(4, T0); s.inventory.mung = 5; s.inventory.odd = 2; return s; };

test("gieo: trừ 1 hạt, luống có cây; luống bận / hết hạt / hạt lạ / sai luống đều từ chối", () => {
  const s = farm();
  assert.equal(s.garden.length, G.plots);
  const r = plant(s, 0, "mung", T0);
  assert.equal(r.ok, true);
  assert.equal(s.inventory.mung, 4);
  assert.equal(r.readyAt, T0 + growMsOf("mung", T0));
  assert.equal(plant(s, 0, "rice", T0).code, "plot_busy");
  assert.equal(plant(s, 1, "odd", T0).code, "bad_seed");
  assert.equal(canPlant("odd"), false);
  s.inventory.sesame = 0;
  assert.equal(plant(s, 1, "sesame", T0).code, "no_seed");
  assert.equal(plant(s, 7, "mung", T0).code, "no_plot");
  assert.equal(plant(s, -1, "mung", T0).code, "no_plot");
});

test("cây lớn cả khi vắng mặt; chưa chín thì not_ready; chín thì thu 3 (đôi khi 4) hạt cùng loại", () => {
  const s = farm();
  plant(s, 0, "mung", T0);
  const ready = s.garden[0].readyAt;
  assert.equal(harvest(s, 0, ready - 1).code, "not_ready");
  advance(s, ready + 5 * HOUR, { present: false }); // vắng mặt
  const before = s.inventory.mung;
  const r = harvest(s, 0, ready + 5 * HOUR);
  assert.equal(r.ok, true);
  assert.ok(r.n === G.yield || r.n === G.yield + 1);
  assert.equal(s.inventory.mung, before + r.n);
  assert.equal(s.garden[0], null);
  assert.equal(s.count.harvest, 1);
  assert.equal(harvest(s, 0, ready + 5 * HOUR).code, "no_plant");
  // thống kê được mùa ~25%
  let bonus = 0;
  for (let i = 0; i < 400; i++) {
    const f = farm();
    plant(f, 1, "rice", T0 + i * MIN);
    if (harvest(f, 1, T0 + i * MIN + DAY).n > G.yield) bonus++;
  }
  assert.ok(bonus > 60 && bonus < 140, `được mùa ${bonus}/400`);
});

test("tưới: mỗi lần bớt cutPct, có giới hạn lần và nhịp; không tưới cây đã chín", () => {
  const s = farm();
  plant(s, 0, "mung", T0);
  const total = s.garden[0].total, r0 = s.garden[0].readyAt;
  assert.equal(waterPlot(s, 0, T0 + 1000).ok, true);
  assert.equal(s.garden[0].readyAt, r0 - Math.round(G.water.cutPct * total));
  assert.equal(waterPlot(s, 0, T0 + 1500).code, "too_fast");
  let t = T0 + 1000;
  for (let i = 1; i < G.water.max; i++) { t += G.water.cooldownMs; assert.equal(waterPlot(s, 0, t).ok, true); }
  assert.equal(waterPlot(s, 0, t + G.water.cooldownMs).code, "watered");
  assert.equal(s.garden[0].readyAt, r0 - G.water.max * Math.round(G.water.cutPct * total));
  assert.equal(waterPlot(s, 1, t + 9000).code, "no_plant");
  const v = plotView(s, 0, s.garden[0].readyAt);
  assert.equal(v.ready, true);
  assert.equal(waterPlot(s, 0, s.garden[0].readyAt + 9000).code, "ready");
});

test("kho đầy thì không thu hoạch được (cây vẫn còn)", () => {
  const s = farm();
  plant(s, 0, "rice", T0);
  s.inventory.rice = CONFIG.storage.seeds;
  const t = s.garden[0].readyAt;
  assert.equal(harvest(s, 0, t).code, "seeds_full");
  assert.ok(s.garden[0]);
});

test("mốc sổ thêm luống tới plotsMax; mùa mưa lớn nhanh, mùa khô lớn chậm", () => {
  const s = farm();
  s.milestones = 1;
  advance(s, T0 + 1000);
  assert.equal(s.garden.length, G.plots + 1);
  s.milestones = 5;
  advance(s, T0 + 2000);
  assert.equal(gardenSize(s), G.plotsMax);
  assert.equal(s.garden.length, G.plotsMax);
  const weeks = [0, 1, 2, 3].map((w) => T0 + w * 7 * DAY);
  const rain = weeks.find((t) => seasonOf(t) === "rain"), dry = weeks.find((t) => seasonOf(t) === "dry"), other = weeks.find((t) => !["rain", "dry"].includes(seasonOf(t)));
  assert.ok(growMsOf("mung", rain) < growMsOf("mung", other));
  assert.ok(growMsOf("mung", dry) > growMsOf("mung", other));
});

test("bản lưu cũ (v9) chưa có vườn → ensure thêm luống trống; việc trong ngày 'thu hoạch' có thể được giao", () => {
  const s = farm();
  delete s.garden;
  advance(s, T0 + HOUR);
  assert.deepEqual(s.garden, Array(G.plots).fill(null));
  let seen = false;
  for (let d = 0; d < 30 && !seen; d++) {
    const f = farm();
    advance(f, T0 + d * DAY);
    seen = questView(f).daily.some((q) => q.key === "harvest");
  }
  assert.ok(seen, "30 ngày có ít nhất một ngày được giao 'thu hoạch'");
});
