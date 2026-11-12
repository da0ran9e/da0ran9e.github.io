// Trại Gà — dựng lại trại từ nhật ký `actions` rồi so với ảnh chụp trong `farms`.
//
//   node --disable-warning=ExperimentalWarning tools/replay.mjs [--db data/farm.db] [playerId …]
//   (không nêu playerId → kiểm tra mọi trại; mã thoát 1 nếu có trại lệch)
//
// Không cần SERVER_SECRET: mọi giá trị server đã tung (seed trại, loại hạt, seed túi…) nằm trong
// cột `rolled`. Lệch nghĩa là: server đổi state ngoài nhật ký, DB bị sửa tay, hoặc luật không
// tất định giữa hai phiên bản (rules.js / Node).

import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { applyAction, createFarmState, sha256 } from "../src/actions.mjs";

// Chạy lại nhật ký của một người chơi. Trả về { playerId, ok, actions, version, expected, actual, error? }.
export function replayFarm(db, playerId) {
  const farm = db.prepare("SELECT state_hash, version FROM farms WHERE player_id = ?").get(playerId);
  const rows = db.prepare("SELECT seq, type, args, rolled, now FROM actions WHERE player_id = ? ORDER BY seq").all(playerId);
  const report = { playerId, ok: false, actions: rows.length, version: farm?.version ?? null, expected: farm?.state_hash ?? null, actual: null };
  if (!farm) return { ...report, error: "không có ảnh chụp trong farms" };
  if (!rows.length || rows[0].type !== "newGame") return { ...report, error: "nhật ký không bắt đầu bằng newGame" };

  let json = null;
  for (const [i, row] of rows.entries()) {
    if (row.seq !== i + 1) return { ...report, error: `thiếu hành động seq ${i + 1}` };
    const args = JSON.parse(row.args);
    const rolled = row.rolled ? JSON.parse(row.rolled) : null;
    let state;
    if (row.type === "newGame") {
      if (i !== 0) return { ...report, error: `newGame ở giữa nhật ký (seq ${row.seq})` };
      state = createFarmState(rolled.seed, row.now, args.choice);
    } else {
      // Đi qua JSON giữa hai hành động — y như server (state nạp từ DB / bộ nhớ đệm đã qua JSON).
      state = JSON.parse(json);
      const out = applyAction(state, row.type, args, rolled, row.now, { present: row.source !== "system" }); // Q14: hệ thống làm = người chơi vắng
      if (!out.ok) return { ...report, error: `seq ${row.seq} (${row.type}) bị luật từ chối khi chạy lại: ${out.code}` };
    }
    json = JSON.stringify(state);
  }
  const actual = sha256(json);
  const ok = actual === farm.state_hash && rows.length === farm.version;
  return { ...report, ok, actual, ...(ok ? {} : { error: rows.length !== farm.version ? "số hành động khác version" : "state khác ảnh chụp" }) };
}

export function replayAll(db) {
  return db.prepare("SELECT player_id FROM farms ORDER BY player_id").all().map((r) => replayFarm(db, r.player_id));
}

/* ---------- dòng lệnh ---------- */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const argv = process.argv.slice(2);
  let dbPath = process.env.DB_PATH || "data/farm.db";
  const ids = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") dbPath = argv[++i];
    else ids.push(argv[i]);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const results = ids.length ? ids.map((id) => replayFarm(db, id)) : replayAll(db);
  let bad = 0;
  for (const r of results) {
    if (!r.ok) bad++;
    console.log(`${r.ok ? "OK  " : "LỆCH"} ${r.playerId}  ${r.actions} hành động${r.error ? `  — ${r.error}` : ""}`);
  }
  console.log(`\n${results.length} trại, ${bad} lệch`);
  db.close();
  process.exit(bad ? 1 : 0);
}
