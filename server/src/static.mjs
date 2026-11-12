// Phục vụ luôn trang game (public/apps/chicken-farm) từ chính server: chỉ cần 1 đường tunnel,
// người chơi vào https://game.vuducan.qzz.io/ là chơi online (cùng origin với API, không cần CORS).
// An toàn: chỉ đọc trong thư mục gốc đã chỉ định, chặn "..", chỉ phục vụ các đuôi file web đã biết.

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// Content-Security-Policy cho một trang HTML, tính từ chính nội dung trang:
//   - script chỉ từ cùng origin + băm sha256 của từng <script> nội tuyến (vd. importmap của phòng gen)
//     + origin https mà importmap trỏ tới (cdn.jsdelivr.net cho three.js) — game.html chỉ có 'self';
//   - style 'unsafe-inline' vì mã vẽ gà/SVG dùng thuộc tính style= trong innerHTML;
//   - connect-src cho phép https: và localhost vì người chơi được chọn máy chủ khác (?server=…);
//   - không cho nhúng iframe (chống clickjacking), không plugin, không <base>.
export function cspFor(html) {
  const scripts = new Set(["'self'"]);
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    scripts.add(`'sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}'`);
    if (/\btype\s*=\s*["']?importmap/i.test(m[1])) for (const o of m[2].matchAll(/https:\/\/[a-z0-9.-]+(?::\d+)?/gi)) scripts.add(o[0].toLowerCase());
  }
  return [
    "default-src 'self'",
    `script-src ${[...scripts].join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const HTML_HEADERS = {
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

export function createStatic(root, { index = "game.html" } = {}) {
  root = resolve(root);
  const cache = new Map(); // đường dẫn → { mtimeMs, data } (file nhỏ, ít)
  return async function serveStatic(req, res, pathname) {
    let p;
    try {
      p = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    if (p === "/" || p === "") p = `/${index}`;
    if (p.includes("\0") || p.includes("\\")) return false;
    const file = resolve(root, `.${p}`);
    if (!file.startsWith(root + sep)) return false; // thoát khỏi thư mục gốc
    const type = TYPES[extname(file).toLowerCase()];
    if (!type) return false;
    let st;
    try {
      st = await stat(file);
    } catch {
      return false;
    }
    if (!st.isFile()) return false;
    let hit = cache.get(file);
    if (!hit || hit.mtimeMs !== st.mtimeMs) {
      const data = await readFile(file);
      hit = { mtimeMs: st.mtimeMs, data, csp: type.startsWith("text/html") ? cspFor(data.toString("utf8")) : null };
      cache.set(file, hit);
    }
    res.writeHead(200, {
      ...(hit.csp ? { "content-security-policy": hit.csp, ...HTML_HEADERS } : {}),
      "content-type": type,
      "content-length": hit.data.length,
      "cache-control": type.startsWith("text/html") ? "no-cache" : "public, max-age=300",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    res.end(req.method === "HEAD" ? undefined : hit.data);
    return true;
  };
}
