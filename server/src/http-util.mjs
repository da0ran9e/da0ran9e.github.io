// Trại Gà server — tiện ích HTTP: lỗi có mã, đọc thân JSON có giới hạn, CORS, gửi JSON.

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Đọc thân yêu cầu: ≤ limit byte, chỉ application/json. Thân rỗng → {}.
export async function readJson(req, limit) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new HttpError(413, "too_large", `Thân yêu cầu tối đa ${limit} byte`);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "too_large", `Thân yêu cầu tối đa ${limit} byte`);
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "unsupported_media_type", "Chỉ nhận application/json");
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_request", "JSON không hợp lệ");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "bad_request", "Thân phải là một đối tượng JSON");
  return body;
}

/* ---------- CORS ---------- */

// Mẫu dạng "http://localhost:*" khớp mọi cổng; còn lại so khớp nguyên văn.
export function makeOriginCheck(patterns) {
  const exact = new Set();
  const wild = [];
  for (const p of patterns) {
    if (p.endsWith(":*")) wild.push(new RegExp(`^${escapeRe(p.slice(0, -2))}:\\d{1,5}$`));
    else exact.add(p);
  }
  return (origin) => {
    if (!origin) return false;
    if (exact.has(origin)) return true;
    return wild.some((re) => re.test(origin));
  };
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function corsHeaders(origin, allowed) {
  if (!origin || !allowed) return {};
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Expose-Headers": "Retry-After" };
}

export const PREFLIGHT = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
};

export function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(data);
}
