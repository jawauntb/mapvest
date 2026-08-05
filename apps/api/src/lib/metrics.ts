/**
 * In-memory ring buffer of request records + counters.
 * Good enough for /v1/admin/metrics + /v1/admin/log in v0. Swap for a real
 * metrics backend once we have one.
 */

export type RequestRecord = {
  ts: string; // ISO
  method: string;
  path: string;
  status: number;
  ms: number;
  userId?: string;
  ip?: string;
};

const CAPACITY = 500;
const ring: RequestRecord[] = [];
let cursor = 0;
let total = 0;

const perPathCount: Map<string, number> = new Map();
const perStatusCount: Map<number, number> = new Map();

export function record(r: RequestRecord) {
  ring[cursor % CAPACITY] = r;
  cursor += 1;
  total += 1;
  perPathCount.set(r.path, (perPathCount.get(r.path) ?? 0) + 1);
  perStatusCount.set(r.status, (perStatusCount.get(r.status) ?? 0) + 1);
}

export function tail(limit = 100): RequestRecord[] {
  const clamped = Math.max(1, Math.min(limit, CAPACITY));
  const out: RequestRecord[] = [];
  const count = Math.min(cursor, CAPACITY);
  const start = cursor > CAPACITY ? cursor - CAPACITY : 0;
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % CAPACITY;
    const r = ring[idx];
    if (r) out.push(r);
  }
  return out.slice(-clamped);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

export function stats() {
  const recs = tail(CAPACITY);
  const latencies = recs.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const mean = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const errors = recs.filter((r) => r.status >= 500).length;
  return {
    total,
    windowSize: recs.length,
    p50,
    p95,
    p99,
    mean,
    errors,
    perPath: Object.fromEntries(perPathCount),
    perStatus: Object.fromEntries(perStatusCount),
  };
}

/** Test-only helper — resets the ring so tests do not bleed into each other. */
export function __resetMetrics() {
  ring.length = 0;
  cursor = 0;
  total = 0;
  perPathCount.clear();
  perStatusCount.clear();
}
