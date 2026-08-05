# Load test — v0.1.0

Phase 7 acceptance load test against the deployed API.

- **Command**: `bun run scripts/loadtest.ts`
- **Timestamp**: started 2026-08-05T04:07:58.552Z, finished 2026-08-05T04:08:23.590Z
- **Target**: `https://api-production-4b27.up.railway.app`
- **Source**: single laptop, max in-flight = 30 (semaphore)
- **Script**: `scripts/loadtest.ts` (see `scripts/README.md`)

## What we tested

Phase 7's stated target is *"50 rps identify, 200 rps nearby"*. We swapped `/v1/identify` for `/v1/resolve-comparable` (same layer, no OpenRouter cost) and `/v1/nearby` for `/v1/health` (I/O-only baseline). The layer boundary being proven is the point — see checklist note in `IMPLEMENTATION_PLAN.md` Phase 7.

- `/v1/resolve-comparable` — 50 rps target for 30 s, **500 total requests**, POSTing one of ten cache-friendly seed brands (`starbucks`, `mcdonald's`, `chipotle`, `walmart`, `target`, `home depot`, `costco`, `nike`, `apple`, `wingstop`).
- `/v1/health` — 200 rps target for 15 s, **3000 total requests**.

## Raw numbers

### `/v1/resolve-comparable` @ 50 rps × 30 s

| metric                     | value            |
| -------------------------- | ---------------- |
| target                     | 50 rps for 30 s (500 req) |
| wall clock                 | 10.02 s          |
| completed                  | 500 (58 ok / 442 err) |
| throughput                 | 49.92 rps        |
| error rate                 | **88.40 %** — all `HTTP 429` |
| latency ms (all)           | min=18 · mean=53 · p50=30 · **p95=150** · p99=193 · max=346 |
| latency ms (2xx only, n=58)| min=102 · mean=140 · p50=137 · p95=180 · p99=193 · max=193 |
| status histogram           | `{ "200": 58, "http:429": 442 }` |

### `/v1/health` @ 200 rps × 15 s

| metric               | value          |
| -------------------- | -------------- |
| target               | 200 rps for 15 s (3000 req) |
| wall clock           | 15.02 s        |
| completed            | 3000 (0 ok / 3000 err) |
| throughput           | 199.76 rps     |
| error rate           | **100.00 %** — all `HTTP 429` |
| latency ms (all)     | min=14 · mean=52 · p50=35 · p95=93 · p99=565 · max=1143 |
| latency ms (2xx only)| n=0 (no request survived the rate-limit bucket) |
| status histogram     | `{ "http:429": 3000 }` |

## Acceptance verdict

The script's built-in acceptance gate (`resolve p95 > 2000 ms` OR either-phase error > 1 %) **fails**, but for the guardrail-not-capacity reason documented in `docs/SYSTEM_DESIGN.md` **D11**:

- The abuse guardrail (`apps/api/src/middleware/rateLimit.ts`) is fixed at 60 rpm per IP. From a single laptop the bucket saturates after ~1 second of the resolve phase and never recovers during the 30-second run. The health phase never receives a single 2xx because the same bucket is still exhausted.
- Railway's edge rewrites client-supplied `X-Forwarded-For` (verified with three distinct spoofed values that all landed in one bucket — see D11), so the loadtest can't spread traffic across synthetic IPs from the outside.

For the 58 requests that *did* survive the rate limiter on the resolve phase, the application path (Bun/Hono → `resolveTicker` seed lookup → `resolveEtfExposure` Exa call → JSON response) posted **p95 = 180 ms, p99 = 193 ms, max = 193 ms** — well inside the 2000 ms budget. That is the useful signal in this run.

## Follow-ups (tracked in D11)

1. Add a per-request bypass token (or an `X-LoadTest-Key`) that skips the middleware when equal to a Doppler-provided secret. Rerun this script with the header and produce v0.1.1 numbers.
2. When we move to more than one API replica, migrate the rate limiter's in-memory `Map` to Redis / Upstash so per-IP buckets survive multi-instance deploys.
3. Distribute the load test across ≥3 sources (e.g. GitHub Actions matrix, or `k6 cloud`) so the natural per-IP limit isn't a single-node bottleneck.

## Reproducing this run

```bash
# Rate-limit bucket needs to be near-empty; wait ~60 s after any curl bursts.
bun run scripts/loadtest.ts | tee docs/loadtest-v0.1.0.md
```

`BASE_URL` and `MAX_CONCURRENCY` can be overridden via env vars.
