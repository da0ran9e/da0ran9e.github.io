// Trại Gà server — "đang quan sát" (Q4: gà chỉ ở ngoài đồng khi chủ đang xem).
// M2: client gửi nhịp tim POST /api/field/watch mỗi ≤ 10 s; quá `timeoutMs` không có nhịp tim
// → coi như rời đi / mất kết nối → server gọi recallAll.
// M3: kết nối WebSocket đang hiển thị sẽ gọi beat() cùng giao diện này.

export class Presence {
  constructor(timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.last = new Map(); // playerId → giờ nhịp tim cuối (ms)
  }

  beat(playerId, now) {
    this.last.set(playerId, now);
    return now + this.timeoutMs;
  }

  // Giờ hết hạn phiên xem; null nếu không có phiên (chưa từng xem / server vừa khởi động lại).
  expiry(playerId) {
    const t = this.last.get(playerId);
    return t == null ? null : t + this.timeoutMs;
  }

  isWatching(playerId, now) {
    const e = this.expiry(playerId);
    return e != null && now <= e;
  }

  clear(playerId) {
    this.last.delete(playerId);
  }

  // Người chơi có phiên đã hết hạn ở thời điểm `now`.
  expired(now) {
    const out = [];
    for (const [id, t] of this.last) if (now > t + this.timeoutMs) out.push(id);
    return out;
  }

  active(now) {
    let n = 0;
    for (const t of this.last.values()) if (now <= t + this.timeoutMs) n++;
    return n;
  }

  players() {
    return [...this.last.keys()];
  }
}
