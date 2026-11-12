// Trại Gà server — số đo nhỏ gọn (không phụ thuộc ngoài): đếm request, độ trễ p50/p99 theo route,
// độ trễ event loop, thời gian ghi DB. Xem qua cổng quản trị 127.0.0.1:ADMIN_PORT/metrics.

import { createHistogram, monitorEventLoopDelay } from "node:perf_hooks";

export class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.routes = new Map(); // "POST /api/farm/feed" → { count, status: {2xx…}, hist }
    this.counters = { requests: 0, rejects: 0, systemRecalls: 0, internalErrors: 0 };
    this.dbWrite = createHistogram();
    // số đo của monitorEventLoopDelay gồm cả chu kỳ lấy mẫu (10 ms) → lag() trừ đi khi báo cáo
    this.loop = monitorEventLoopDelay({ resolution: 10 });
    this.loop.enable();
  }

  // ms: độ trễ (số thực, mili giây). Histogram lưu số nguyên → ghi theo micro giây.
  observe(route, status, ms) {
    this.counters.requests++;
    let r = this.routes.get(route);
    if (!r) this.routes.set(route, (r = { count: 0, status: {}, hist: createHistogram() }));
    r.count++;
    const cls = `${Math.floor(status / 100)}xx`;
    r.status[cls] = (r.status[cls] ?? 0) + 1;
    r.hist.record(Math.max(1, Math.round(ms * 1000)));
  }

  observeDbWrite(ms) {
    this.dbWrite.record(Math.max(1, Math.round(ms * 1000)));
  }

  snapshot(extra = {}) {
    const q = (h) => (h.count ? { p50: us(h.percentile(50)), p99: us(h.percentile(99)), max: us(h.max), n: h.count } : { n: 0 });
    const mem = process.memoryUsage();
    return {
      uptimeS: Math.round((Date.now() - this.startedAt) / 1000),
      ...this.counters,
      ...extra,
      routes: Object.fromEntries([...this.routes].sort().map(([k, r]) => [k, { count: r.count, status: r.status, ms: q(r.hist) }])),
      dbWriteMs: q(this.dbWrite),
      eventLoopDelayMs: this.loop.count ? { p50: lag(this.loop.percentile(50)), p99: lag(this.loop.percentile(99)), max: lag(this.loop.max) } : {},
      memoryMB: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed) },
    };
  }

  close() {
    this.loop.disable();
  }
}

const us = (v) => Math.round(v) / 1000; // micro giây → ms, 3 chữ số thập phân
const lag = (v) => Math.max(0, Math.round(v / 1e3 - 10_000) / 1000); // ns → ms, bỏ chu kỳ lấy mẫu 10 ms
const mb = (v) => Math.round((v / 1048576) * 10) / 10;
