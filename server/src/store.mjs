// Trại Gà server — lưu trữ bằng node:sqlite (DatabaseSync, API đồng bộ).
// Đồng bộ là cố ý: "đọc → áp luật → ghi" không có await ở giữa → một tiến trình không thể
// mất cập nhật. Bảng `farms` là ẢNH CHỤP; nguồn sự thật là nhật ký `actions` (chỉ thêm).

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,                    -- 'p_…' công khai
  token_hash BLOB NOT NULL UNIQUE,        -- sha256(token); không lưu token
  seed INTEGER NOT NULL,                  -- seed trại (newGame), bí mật với client
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'   -- active | banned | deleted
) STRICT;

CREATE TABLE IF NOT EXISTS farms (        -- ảnh chụp sau hành động cuối
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  rules_v INTEGER NOT NULL,               -- CONFIG.version lúc ghi
  state TEXT NOT NULL,                    -- JSON đầy đủ (có seed)
  version INTEGER NOT NULL,               -- = seq của hành động cuối đã áp
  rolls INTEGER NOT NULL DEFAULT 0,       -- bộ đếm cho HMAC (giá trị ngẫu nhiên phía server)
  updated_at INTEGER NOT NULL,
  state_hash TEXT NOT NULL                -- sha256(state), replay so với cái này
) STRICT;

CREATE TABLE IF NOT EXISTS actions (      -- CHỈ THÊM, không sửa (trừ xoá response cũ)
  player_id TEXT NOT NULL REFERENCES players(id),
  seq INTEGER NOT NULL,                   -- 1, 2, 3… theo người chơi
  aid TEXT,                               -- id hành động của client; NULL với system
  type TEXT NOT NULL,                     -- newGame | advance | feed | release | … | openBag
  args TEXT NOT NULL,                     -- JSON tham số đã chuẩn hoá
  rolled TEXT,                            -- JSON giá trị server tung (seed trại, loại hạt, seed túi…)
  now INTEGER NOT NULL,                   -- giờ server dùng cho hàm luật
  source TEXT NOT NULL,                   -- http | view (GET /api/farm ghi advance) | system (người chơi vắng) (| ws ở M3)
  code TEXT NOT NULL,                     -- mã kết quả ('ok' — hành động bị từ chối nằm ở rejects)
  req_hash TEXT,                          -- sha256(type + args) để phát hiện dùng lại aid với thân khác
  response TEXT,                          -- phản hồi đã gửi (idempotency), xoá sau 24 giờ
  PRIMARY KEY (player_id, seq)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS actions_aid ON actions(player_id, aid) WHERE aid IS NOT NULL;

CREATE TABLE IF NOT EXISTS rejects (      -- tín hiệu gian lận / lỗi client, giữ 30 ngày
  player_id TEXT NOT NULL, at INTEGER NOT NULL, type TEXT NOT NULL,
  code TEXT NOT NULL, source TEXT NOT NULL, aid TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS rejects_at ON rejects(at);
`;

export function openDb(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`);
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  return db;
}

export class Store {
  constructor(db) {
    this.db = db;
    const p = (sql) => db.prepare(sql);
    this.q = {
      insertPlayer: p("INSERT INTO players (id, token_hash, seed, created_at, last_seen) VALUES (?, ?, ?, ?, ?)"),
      playerByToken: p("SELECT id, seed, created_at, last_seen, status FROM players WHERE token_hash = ?"),
      player: p("SELECT id, seed, created_at, last_seen, status FROM players WHERE id = ?"),
      touchPlayer: p("UPDATE players SET last_seen = ? WHERE id = ?"),
      farm: p("SELECT state, version, rolls, rules_v, updated_at, state_hash FROM farms WHERE player_id = ?"),
      insertFarm: p("INSERT INTO farms (player_id, rules_v, state, version, rolls, updated_at, state_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"),
      updateFarm: p("UPDATE farms SET rules_v = ?, state = ?, version = ?, rolls = ?, updated_at = ?, state_hash = ? WHERE player_id = ? AND version = ?"),
      bumpRolls: p("UPDATE farms SET rolls = ? WHERE player_id = ?"),
      insertAction: p("INSERT INTO actions (player_id, seq, aid, type, args, rolled, now, source, code, req_hash, response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
      actionByAid: p("SELECT seq, type, req_hash, response FROM actions WHERE player_id = ? AND aid = ?"),
      actions: p("SELECT seq, aid, type, args, rolled, now, source, code FROM actions WHERE player_id = ? ORDER BY seq"),
      insertReject: p("INSERT INTO rejects (player_id, at, type, code, source, aid) VALUES (?, ?, ?, ?, ?, ?)"),
      farmsInField: p(`SELECT player_id FROM farms WHERE state LIKE '%"location":"field"%'`),
      purgeResponses: p("UPDATE actions SET response = NULL WHERE response IS NOT NULL AND now < ?"),
      purgeRejects: p("DELETE FROM rejects WHERE at < ?"),
    };
  }

  // Chạy fn trong BEGIN IMMEDIATE … COMMIT; lỗi → ROLLBACK và ném tiếp.
  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  close() {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {}
    this.db.close();
  }
}
