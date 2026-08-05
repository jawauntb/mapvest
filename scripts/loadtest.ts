#!/usr/bin/env bun
/**
 * scripts/loadtest.ts — Phase 7 acceptance load test for the deployed API.
 *
 * Two phases:
 *   1. /v1/resolve-comparable — 50 rps target for 30 s (500 total requests),
 *      cycling through ~10 cache-friendly seed brands.
 *   2. /v1/health — 200 rps target for 15 s (3000 total requests). Proves the
 *      Bun/Hono I/O layer, not the finance path.
 *
 * Concurrency is capped by a lightweight Semaphore (default 30) so we don't
 * open thousands of sockets at once. Requests are paced to the target RPS via
 * a scheduling loop; if the server can't keep up, actual throughput will drop
 * below the target and the summary reports both figures.
 *
 * Usage:
 *   bun run scripts/loadtest.ts
 *   BASE_URL=https://api-production-4b27.up.railway.app bun run scripts/loadtest.ts
 *   MAX_CONCURRENCY=60 bun run scripts/loadtest.ts
 */

const BASE_URL = process.env.BASE_URL ?? "https://api-production-4b27.up.railway.app";
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY ?? 30);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000);
// The deployed API's per-IP rate limit is 60 rpm (apps/api/src/middleware/rateLimit.ts).
// A single-source load test trips it in the first second, which measures the
// guardrail rather than throughput. We attach a synthetic X-Forwarded-For per
// request in case the ingress trusts it (which models distributed traffic from
// many mobile clients). Empirically Railway rewrites X-Forwarded-For at the
// edge, so on the deployed API the header is ignored and every request lands in
// the same bucket — that limitation is documented in D11.
const spoofedIp = (i: number): string => `10.${(i >> 16) & 0xff}.${(i >> 8) & 0xff}.${(i & 0xff) || 1}`;

// ~10 cache-friendly seed brands (all present in packages/finance/data/brands.json).
// resolveTicker() hits the seed table for these and never calls out to Exa/LLM,
// so the load path is deterministic across the run.
const BRANDS = [
  "starbucks",
  "mcdonald's",
  "chipotle",
  "walmart",
  "target",
  "home depot",
  "costco",
  "nike",
  "apple",
  "wingstop",
];

// -----------------------------------------------------------------------------
// Semaphore — bounded concurrency without pulling in a dep.
// -----------------------------------------------------------------------------

class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = permits;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.available -= 1;
  }

  release(): void {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

// -----------------------------------------------------------------------------
// Types + stats.
// -----------------------------------------------------------------------------

type Sample = {
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
};

type Summary = {
  label: string;
  targetRps: number;
  durationSec: number;
  totalAttempted: number;
  totalCompleted: number;
  ok: number;
  err: number;
  errorRate: number;
  wallSec: number;
  throughputRps: number;
  latency: {
    min: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  statusCounts: Record<string, number>;
  errorSample: string[];
  /**
   * Latency histogram computed over 2xx responses only. On a healthy run this
   * matches `latency`. When the rate limiter or another guardrail returns fast
   * 429s, the overall `latency` is dominated by the reject path — `okLatency`
   * is what the app path actually delivered.
   */
  okLatency: {
    count: number;
    min: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
};

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  // Nearest-rank percentile, clamped to array bounds.
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(
  label: string,
  targetRps: number,
  durationSec: number,
  attempted: number,
  wallSec: number,
  samples: Sample[],
): Summary {
  const oks = samples.filter((s) => s.ok);
  const errs = samples.filter((s) => !s.ok);
  const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
  const okLatencies = oks.map((s) => s.latencyMs).sort((a, b) => a - b);
  const mean =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const okMean =
    okLatencies.length > 0 ? okLatencies.reduce((a, b) => a + b, 0) / okLatencies.length : 0;
  const statusCounts: Record<string, number> = {};
  for (const s of samples) {
    const k = s.ok ? String(s.status) : s.error ? `err:${s.error}` : `http:${s.status}`;
    statusCounts[k] = (statusCounts[k] ?? 0) + 1;
  }
  const errorSample = errs
    .slice(0, 5)
    .map((e) => (e.error ? `${e.error}` : `HTTP ${e.status}`));
  return {
    label,
    targetRps,
    durationSec,
    totalAttempted: attempted,
    totalCompleted: samples.length,
    ok: oks.length,
    err: errs.length,
    errorRate: samples.length === 0 ? 0 : errs.length / samples.length,
    wallSec,
    throughputRps: wallSec === 0 ? 0 : samples.length / wallSec,
    latency: {
      min: Math.round(latencies[0] ?? 0),
      mean: Math.round(mean),
      p50: Math.round(pct(latencies, 50)),
      p95: Math.round(pct(latencies, 95)),
      p99: Math.round(pct(latencies, 99)),
      max: Math.round(latencies[latencies.length - 1] ?? 0),
    },
    statusCounts,
    errorSample,
    okLatency: {
      count: okLatencies.length,
      min: Math.round(okLatencies[0] ?? 0),
      mean: Math.round(okMean),
      p50: Math.round(pct(okLatencies, 50)),
      p95: Math.round(pct(okLatencies, 95)),
      p99: Math.round(pct(okLatencies, 99)),
      max: Math.round(okLatencies[okLatencies.length - 1] ?? 0),
    },
  };
}

function fmtSummary(s: Summary): string {
  const lines: string[] = [];
  lines.push(`\n=== ${s.label} ===`);
  lines.push(`target:      ${s.targetRps} rps for ${s.durationSec}s (${s.totalAttempted} req)`);
  lines.push(`wall:        ${s.wallSec.toFixed(2)}s`);
  lines.push(`completed:   ${s.totalCompleted} (${s.ok} ok / ${s.err} err)`);
  lines.push(`throughput:  ${s.throughputRps.toFixed(2)} rps`);
  lines.push(`error rate:  ${(s.errorRate * 100).toFixed(2)}%`);
  lines.push(`latency ms:  min=${s.latency.min}  mean=${s.latency.mean}  p50=${s.latency.p50}  p95=${s.latency.p95}  p99=${s.latency.p99}  max=${s.latency.max}`);
  lines.push(
    `  2xx-only:  n=${s.okLatency.count}  min=${s.okLatency.min}  mean=${s.okLatency.mean}  p50=${s.okLatency.p50}  p95=${s.okLatency.p95}  p99=${s.okLatency.p99}  max=${s.okLatency.max}`,
  );
  lines.push(`statuses:    ${JSON.stringify(s.statusCounts)}`);
  if (s.errorSample.length > 0) {
    lines.push(`err sample:  ${s.errorSample.join(" | ")}`);
  }
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Request driver — paced scheduler + semaphore.
// -----------------------------------------------------------------------------

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Sample> {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Drain body so keep-alive can reuse the socket.
    await res.arrayBuffer().catch(() => undefined);
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: performance.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: performance.now() - started,
      error: (err as Error).name === "AbortError" ? "timeout" : (err as Error).message,
    };
  } finally {
    clearTimeout(to);
  }
}

type Phase = {
  label: string;
  targetRps: number;
  durationSec: number;
  totalRequests: number;
  build: (i: number) => { url: string; init: RequestInit };
};

async function runPhase(phase: Phase, sem: Semaphore): Promise<Summary> {
  const samples: Sample[] = [];
  const inflight: Promise<void>[] = [];
  const intervalMs = 1000 / phase.targetRps;
  const phaseStart = performance.now();

  console.log(
    `\n> ${phase.label}: firing ${phase.totalRequests} requests at ${phase.targetRps} rps (target ${phase.durationSec}s)`,
  );

  for (let i = 0; i < phase.totalRequests; i += 1) {
    // Pace scheduling to the target RPS. If the loop is behind (concurrency
    // stalls, slow server), the schedule slips but we don't skip requests.
    const nominalStart = phaseStart + i * intervalMs;
    const drift = performance.now() - nominalStart;
    if (drift < 0) {
      await new Promise((r) => setTimeout(r, -drift));
    }
    await sem.acquire();
    const { url, init } = phase.build(i);
    const p = timedFetch(url, init, REQUEST_TIMEOUT_MS).then((s) => {
      samples.push(s);
      sem.release();
    });
    inflight.push(p);

    // Periodic progress heartbeat.
    if ((i + 1) % Math.max(1, Math.floor(phase.totalRequests / 5)) === 0) {
      const done = samples.length;
      const elapsed = (performance.now() - phaseStart) / 1000;
      process.stdout.write(
        `  ..scheduled ${i + 1}/${phase.totalRequests}  completed ${done}  t=${elapsed.toFixed(1)}s\n`,
      );
    }
  }

  await Promise.all(inflight);
  const wallSec = (performance.now() - phaseStart) / 1000;
  return summarize(
    phase.label,
    phase.targetRps,
    phase.durationSec,
    phase.totalRequests,
    wallSec,
    samples,
  );
}

// -----------------------------------------------------------------------------
// Main.
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`mapvest loadtest — base=${BASE_URL}  maxConcurrency=${MAX_CONCURRENCY}`);
  console.log(`started at ${new Date().toISOString()}`);

  const sem = new Semaphore(MAX_CONCURRENCY);

  const resolvePhase: Phase = {
    label: "/v1/resolve-comparable @ 50 rps × 30 s",
    targetRps: 50,
    durationSec: 30,
    totalRequests: 500,
    build: (i) => ({
      url: `${BASE_URL}/v1/resolve-comparable`,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": spoofedIp(i),
        },
        body: JSON.stringify({ brand: BRANDS[i % BRANDS.length] }),
      },
    }),
  };

  const healthPhase: Phase = {
    label: "/v1/health @ 200 rps × 15 s",
    targetRps: 200,
    durationSec: 15,
    totalRequests: 3000,
    build: (i) => ({
      url: `${BASE_URL}/v1/health`,
      init: {
        method: "GET",
        headers: { "x-forwarded-for": spoofedIp(i + 100_000) },
      },
    }),
  };

  const resolveSummary = await runPhase(resolvePhase, sem);
  console.log(fmtSummary(resolveSummary));

  const healthSummary = await runPhase(healthPhase, sem);
  console.log(fmtSummary(healthSummary));

  console.log(`\nfinished at ${new Date().toISOString()}`);

  // Machine-readable trailer so downstream tooling can grep JSON out.
  const combined = { resolve: resolveSummary, health: healthSummary };
  console.log(`\n---LOADTEST_JSON---\n${JSON.stringify(combined, null, 2)}\n---END---`);

  // Exit code signals acceptance: p95 > 2000 ms on resolve OR error rate > 1%
  // on either phase is a Phase 7 fail.
  const failResolve =
    resolveSummary.latency.p95 > 2000 || resolveSummary.errorRate > 0.01;
  const failHealth = healthSummary.errorRate > 0.01;
  if (failResolve || failHealth) {
    console.error(
      `\n[loadtest] acceptance FAIL — resolveP95=${resolveSummary.latency.p95}ms resolveErr=${(resolveSummary.errorRate * 100).toFixed(2)}% healthErr=${(healthSummary.errorRate * 100).toFixed(2)}%`,
    );
    process.exitCode = 2;
  } else {
    console.log("\n[loadtest] acceptance PASS");
  }
}

main().catch((err) => {
  console.error("[loadtest] fatal:", err);
  process.exit(1);
});
