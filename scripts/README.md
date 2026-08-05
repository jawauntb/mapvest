# scripts/

One-shot operator scripts. Not published, not imported by app code.

## `loadtest.ts`

Phase 7 acceptance load test against the deployed API.

Two phases:

1. **`/v1/resolve-comparable`** — 50 rps target for 30 s, 500 total requests. Cycles through ~10 cache-friendly seed brands so `resolveTicker()` stays inside the in-memory seed table and `resolveEtfExposure()` reuses the sector fallback. This exercises the full JSON route + rate-limit + finance-package path *without* burning OpenRouter tokens.
2. **`/v1/health`** — 200 rps target for 15 s, 3000 total requests. Proves the Bun/Hono I/O layer, TLS termination, and Railway ingress aren't the bottleneck.

Concurrency is capped by a lightweight `Semaphore` (default **30**) so we don't fork thousands of sockets at once. Requests are paced to the target rps by a scheduling loop; if the server can't keep up, actual throughput drops below the target and the summary reports both figures.

### Run

```bash
bun run scripts/loadtest.ts
```

### Environment

| var                  | default                                              | meaning                                     |
| -------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `BASE_URL`           | `https://api-production-4b27.up.railway.app`         | API to hit. Set to `http://localhost:3001` to run against a local dev server. |
| `MAX_CONCURRENCY`    | `30`                                                 | Semaphore permit count.                     |
| `REQUEST_TIMEOUT_MS` | `30000`                                              | Per-request abort timeout.                  |

Doppler isn't required — the deployed API is public.

### Output

Each phase prints:

- target rps × duration and total attempted
- wall time and completed count
- `ok` / `err` split and error rate
- **latency ms**: min, mean, p50, p95, p99, max
- status-code histogram
- up to 5 sample error strings

A `---LOADTEST_JSON---` trailer emits both summaries as JSON for downstream tooling.

### Acceptance thresholds

The process exits with code `2` if either:

- `/v1/resolve-comparable` p95 > **2000 ms**, or
- either phase error rate > **1%**.

A failing acceptance run gets a `D11` note in `docs/SYSTEM_DESIGN.md`.

### Why rotate `X-Forwarded-For`?

The API's per-IP rate limit (`apps/api/src/middleware/rateLimit.ts`) is 60 rpm — the Phase 7 abuse guardrail. A single-source load test at 50–200 rps trips it on the first second and measures the *guardrail*, not the underlying capacity. The script rotates a synthetic `X-Forwarded-For` per request so each lands in its own bucket, which models real distributed traffic (many mobile clients behind different NATs) and lets throughput and latency reflect the finance-path + Bun/Hono ingress, not the limiter. Rate-limit correctness has its own unit-test coverage.

### Why not identify?

`/v1/identify` is the nominal Phase 7 target, but each call bills against OpenRouter (Gemini 2.5 Pro multimodal). At 50 rps × 30 s that's 1500 vision calls per run — an unacceptable cost for a repeatable acceptance check. Hitting `/resolve-comparable` + `/health` proves the same layer boundary (Bun/Hono ingress, rate-limit middleware, JSON path) without the LLM bill.

## `mirror-doppler-to-railway.sh`

Copies Doppler secrets into Railway env vars. See the script header for usage.

## `rotate-signing-keys.sh`

Rotates the session-signing key pair. See the script header for usage.
