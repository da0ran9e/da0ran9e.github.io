// Trại Gà server — giới hạn tốc độ bằng token bucket trong bộ nhớ.
// Mỗi khoá (vd. "ip:1.2.3.4", "tp:p_abc") một thùng: sức chứa `cap`, nạp lại `perSec` mỗi giây.
// Đồng hồ được truyền vào → test điều khiển được thời gian.

export class RateLimiter {
  constructor(clock) {
    this.clock = clock;
    this.buckets = new Map();
  }

  // Lấy 1 lượt. Trả về { ok:true } hoặc { ok:false, retryAfterMs }.
  take(key, { cap, perSec }) {
    const now = this.clock();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: cap, at: now, cap, perSec };
      this.buckets.set(key, b);
    } else {
      b.cap = cap;
      b.perSec = perSec;
      b.tokens = Math.min(cap, b.tokens + (Math.max(0, now - b.at) / 1000) * perSec);
      b.at = now;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfterMs: Math.ceil(((1 - b.tokens) / perSec) * 1000) };
  }

  // Dọn thùng không dùng lâu để Map không phình mãi. CHỈ xoá thùng đã nạp ĐẦY lại (xoá = tạo lại đầy,
  // nên không đổi hành vi). Trước đây xoá mọi thùng rảnh > 10 phút → thùng "20 khách/ngày" bị reset
  // sau 10 phút → giới hạn tạo khách thực tế ~5 mỗi 10 phút thay vì 20/ngày.
  sweep(idleMs = 10 * 60 * 1000) {
    const now = this.clock();
    for (const [k, b] of this.buckets) {
      const elapsed = now - b.at;
      if (elapsed > idleMs && b.tokens + (elapsed / 1000) * b.perSec >= b.cap) this.buckets.delete(k);
    }
  }

  get size() {
    return this.buckets.size;
  }
}

// Khoá rate limit cho một IP. IPv6: gộp theo /64 (một nhà/một máy thường có cả /64 → đổi địa chỉ
// trong /64 không lách được giới hạn tạo khách). IPv4-mapped (::ffff:a.b.c.d) → a.b.c.d.
export function ipBucket(ip) {
  const s = String(ip ?? "").toLowerCase().split("%")[0];
  if (!s.includes(":")) return s;
  if (s.startsWith("::ffff:") && s.slice(7).includes(".")) return s.slice(7);
  const [h, t] = s.includes("::") ? s.split("::") : [s, null];
  const head = h ? h.split(":") : [];
  const tail = t ? t.split(":") : [];
  const groups = (a) => a.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0);
  const fill = t === null ? 0 : Math.max(0, 8 - groups(head) - groups(tail));
  const all = [...head, ...Array(fill).fill("0"), ...tail];
  return all.slice(0, 4).map((g) => (Number.parseInt(g, 16) || 0).toString(16)).join(":") + "::/64";
}
