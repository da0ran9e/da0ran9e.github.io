// Đa ngôn ngữ: mọi câu tiếng Việt gọi qua tr("…") trong giao diện đều phải có bản dịch tiếng Anh, giữ nguyên các biến {x}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import EN from "../../public/apps/chicken-farm/js/game/i18n-en.js";

const DIR = new URL("../../public/apps/chicken-farm/js/game/", import.meta.url);
const FILES = ["main.js", "play.js", "intro.js", "net.js"];

test("mọi tr(\"…\") trong giao diện đều có bản dịch tiếng Anh", () => {
  const missing = [];
  for (const f of FILES) {
    const src = readFileSync(new URL(f, DIR), "utf8");
    for (const m of src.matchAll(/\btr\("((?:[^"\\]|\\.)*)"/g)) {
      const key = JSON.parse(`"${m[1]}"`);
      if (!/[À-ỹ]/.test(key) && !key.includes("{")) continue; // khoá dạng menu.store… nằm trong i18n.js
      if (EN[key] == null) missing.push(`${f}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("bản dịch giữ nguyên các biến {x} của câu gốc", () => {
  for (const [k, v] of Object.entries(EN)) {
    const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(vars(v), vars(k), k);
  }
});

test("mọi mã lỗi của luật đều có câu tiếng Anh", () => {
  const rules = readFileSync(new URL("rules.js", DIR), "utf8");
  const codes = new Set([...rules.matchAll(/err\("([a-z_]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...codes].filter((c) => !EN[`err.${c}`]), []);
});
