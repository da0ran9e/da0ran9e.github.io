// Trại Gà server — cấu hình từ biến môi trường (xem server/README.md).
// Mọi giá trị đều ghi đè được qua createApp(options) để test chạy với cấu hình riêng.

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

// thư mục trang game trong repo (server phục vụ luôn để chơi online cùng địa chỉ với API)
export const DEFAULT_CLIENT_DIR = fileURLToPath(new URL("../../public/apps/chicken-farm/", import.meta.url));

const SEC = 1000;
const HOUR = 3600 * SEC;

// Giới hạn tốc độ mặc định (token bucket): cap = sức chứa, perSec = tốc độ nạp lại mỗi giây.
export const DEFAULT_LIMITS = {
  ipAll: { cap: 60, perSec: 60 }, // IP · mọi request HTTP
  ipGuest: { cap: 5, perSec: 5 / 3600 }, // IP · POST /api/guest: 5/giờ
  ipGuestDay: { cap: 20, perSec: 20 / 86400 }, // IP · POST /api/guest: 20/ngày
  tokenPost: { cap: 10, perSec: 5 }, // token · mọi POST (hành động + nhịp tim)
  tokenGet: { cap: 4, perSec: 2 }, // token · GET
};

export const DEFAULT_ORIGINS = ["https://game.vuducan.qzz.io", "https://vuducan.qzz.io", "https://da0ran9e.github.io", "http://localhost:*"];

export function configFromEnv(env = process.env) {
  const secret = env.SERVER_SECRET || "";
  return {
    port: intOr(env.PORT, 8787),
    adminPort: intOr(env.ADMIN_PORT, 8788),
    host: env.HOST || "127.0.0.1", // chỉ cloudflared gọi tới → nghe trên loopback
    dbPath: env.DB_PATH || "data/farm.db",
    // Không có SERVER_SECRET → tự sinh (chỉ hợp cho dev: khởi động lại là đổi bí mật, nhưng
    // giá trị đã tung đều nằm trong nhật ký nên replay vẫn đúng).
    secret: secret || randomBytes(32).toString("hex"),
    secretFromEnv: Boolean(secret),
    allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS,
    // SERVE_CLIENT=0 để tắt; CLIENT_DIR để đổi thư mục trang game
    clientDir: env.SERVE_CLIENT === "0" ? null : env.CLIENT_DIR || DEFAULT_CLIENT_DIR,
  };
}

export const DEFAULTS = {
  bodyLimit: 4 * 1024, // byte, thân JSON tối đa
  watchTimeoutMs: 20 * SEC, // không có nhịp tim 20 s → gọi gà về
  watchEveryMs: 10 * SEC, // client gửi nhịp tim mỗi ≤ 10 s
  sweepEveryMs: 2 * SEC, // chu kỳ quét phiên xem hết hạn + dọn bucket
  systemAdvanceMs: HOUR, // GET /api/farm: lần ghi cuối > 1 giờ → ghi hành động hệ thống "advance"
  memorialInView: 20, // số mục kỷ niệm cuối gửi kèm farm
  responseKeepMs: 24 * HOUR, // giữ response cho idempotency 24 giờ (client chỉ gửi lại trong vài giây; SEC-04)
  rejectKeepMs: 30 * 24 * HOUR, // giữ bảng rejects 30 ngày
  cacheSize: 2000, // số trại giữ trong bộ nhớ (LRU)
};

function intOr(v, d) {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : d;
}
