// Trại Gà server — điểm khởi động. Chạy: `npm start` trong thư mục server/ (xem README.md).

import { createApp } from "./app.mjs";
import { configFromEnv } from "./config.mjs";

const env = configFromEnv();
const log = (level, data) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, ...data }) + "\n");

if (!["127.0.0.1", "::1", "localhost"].includes(env.host)) {
  log("warn", { msg: `HOST=${env.host} — API nghe ngoài loopback: người trong mạng (hoặc Internet nếu mở cổng) gọi thẳng được, bỏ qua Cloudflare. Chỉ cloudflared cần vào → để HOST=127.0.0.1` });
}
if (!env.secretFromEnv) log("warn", { msg: "Chưa đặt SERVER_SECRET — dùng bí mật tạm (chỉ dành cho dev)" });

const app = createApp({ dbPath: env.dbPath, secret: env.secret, allowedOrigins: env.allowedOrigins, clientDir: env.clientDir, log });
const { port, adminPort } = await app.listen({ port: env.port, adminPort: env.adminPort, host: env.host });
log("info", { msg: "listening", api: `http://${env.host}:${port}`, admin: `http://127.0.0.1:${adminPort}`, db: env.dbPath, play: env.clientDir ? `http://${env.host}:${port}/` : "(tắt)" });

// Tắt êm: ngừng nhận kết nối → gọi gà về → checkpoint WAL → đóng DB.
// SIGBREAK: Ctrl+Break / NSSM trên Windows.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log("info", { msg: "shutdown", signal });
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await app.close();
    process.exit(0);
  } catch (e) {
    log("error", { msg: "shutdown_failed", err: String(e?.stack ?? e) });
    process.exit(1);
  }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => shutdown(sig));
