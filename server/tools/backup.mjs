// Trại Gà — sao lưu SQLite khi server ĐANG CHẠY (ảnh chụp nhất quán, WAL vẫn an toàn).
//
//   node --disable-warning=ExperimentalWarning tools/backup.mjs [--db data/farm.db] [--out D:\trai-ga-backup] [--keep 48]
//
// Tạo file farm-YYYYMMDD-HHMM.db trong thư mục đích, rồi xoá bớt bản cũ chỉ giữ `--keep` bản mới nhất.
// Sau khi sao lưu, chạy tools/replay.mjs --db <bản sao> để chắc bản sao dùng được.

import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, d) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : d;
};
const dbPath = opt("--db", process.env.DB_PATH || "data/farm.db");
const outDir = opt("--out", process.env.BACKUP_DIR || "backup");
const keep = Number(opt("--keep", 48));

mkdirSync(outDir, { recursive: true });
const d = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const name = `farm-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.db`;
const target = join(outDir, name);

const src = new DatabaseSync(dbPath, { readOnly: true });
const pages = await backup(src, target);
src.close();
console.log(`Đã sao lưu ${dbPath} → ${target} (${pages} trang)`);

const old = readdirSync(outDir).filter((f) => /^farm-\d{8}-\d{4}\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) rmSync(join(outDir, f));
if (old.length) console.log(`Đã xoá ${old.length} bản cũ`);
