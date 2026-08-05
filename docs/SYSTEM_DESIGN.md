# System design notes

Design decisions and the reasoning behind them. Update this file when a decision changes.

## D1 — Monorepo with Bun workspaces

**Decision**: One repo, `bun` workspaces, `apps/*` and `packages/*`.

**Why**: The iOS app, landing page, and API all share the finance + vision code. A monorepo makes refactors atomic. Bun workspaces give us the smallest possible install footprint vs Yarn/pnpm and are ~5× faster to install.

**Trade-off**: We accept some coupling in exchange for atomic refactors and shared types. If a team spins out any package for reuse elsewhere, it can be extracted with a `bun run publish:packages/<name>` script (not built yet).

## D2 — API layer / implementation layer split

**Decision**: `apps/api` exposes HTTP. All business logic lives in `packages/*`.

**Why**: A future Android app, a web app, or a partner integration can consume `apps/api` without any code change. Business logic is unit-testable without a server.

**Enforcement**: The AGENTS.md says `apps/api` cannot import from `apps/ios` or `apps/landing`. Lint rule TBD.

## D3 — Multimodal via OpenRouter (Gemini primary)

**Decision**: `packages/vision` calls OpenRouter with `google/gemini-2.5-pro` as the default model, falling back to `anthropic/claude-sonnet-5` then `openai/gpt-4o` on errors/timeouts (default 25s for multimodal).

**Why**: Gemini 2.5 Pro is currently the best price/quality on OCR + brand identification for the ticker use case. OpenRouter gives us a single interface for A/B testing without changing our code.

**Trade-off**: OpenRouter adds a small latency tax (~50-100ms). Acceptable for camera path (users expect ~1-2s), tighter for live scan (want < 800ms end-to-end).

## D4 — Private→public comparable via cascade

**Decision**: `resolveComparable` cascades: (a) sector table lookup, (b) LLM w/ Exa citations, (c) ETF exposure map. Never returns a single ticker without a `confidence` and a `sources[]`.

**Why**: Users make investment decisions from this output. Precision matters more than recall — better to say "we're not sure" than to fabricate a comparable.

## D5 — Client never holds raw Google key

**Decision**: All Google Places calls go through the API. The iOS app receives short-lived signed tokens.

**Why**: Client-side keys leak; server-side keys can be scoped and revoked.

**Trade-off**: One extra hop on every map query. Cached tiles + prefetch cover it.

## D6 — Docs are code

**Decision**: All product-shaping docs live in `docs/*.md` in the repo. The landing page renders them at build time.

**Why**: If the docs and code diverge, agents (and humans) get lost. Coupling docs to deploys means truth is versioned.

## D7 — Photos are private by default

**Decision**: Uploaded photos are held in memory during the request and discarded. Users can opt-in to a 7-day signed-URL bucket for their history.

**Why**: Real-world camera scans include storefronts, faces, license plates. The default has to protect the user.

## D8 — No live financial advice

**Decision**: Every ticker view carries the disclaimer "not investment advice." Realtime quotes are best-effort.

**Why**: We're an identification + research tool. Turning it into a broker is a regulatory rabbit hole we're not walking into at v0.1.

## D9 — Feature flags via Doppler

**Decision**: Flags like `ENABLE_LIVE_SCAN`, `ENABLE_ADMIN_LOGS` are Doppler env vars, read by the API and returned in `/v1/config` to the client.

**Why**: Single source of truth, no separate LaunchDarkly. Iteration speed > flag sophistication.

## D10 — Sibling repo boundary

**Decision**: The sibling repos `option_derivation` and
`The Underlying Analyzer Reboot` are treated as external services accessed
by URL. Mapvest does not vendor their source, does not import their
modules as `packages/*`, and does not run their code in-process.

For v0.1 the boundary is a stub: `GET /v1/options?ticker=…` returns
`{ linkOut, note }` and the iOS detail sheet renders a badge that opens
the linkOut in `expo-web-browser`. For v0.2 the same endpoint proxies to
a deployed instance of the sibling (Railway service or equivalent),
preserving the response shape so clients do not have to change.

**Why**:

- **Independent release cadence.** Options-derivation math is a research
  project with its own iteration loop. Coupling deployments would slow
  both repos down.
- **Clear licensing / attribution.** If a sibling ships under a different
  license or gets spun out, a URL boundary is trivially removable; a
  vendored `packages/options/*` is not.
- **Blast-radius containment.** A crash or dependency-hell moment in
  `option_derivation` cannot take down `/v1/nearby` or `/v1/identify`.
  The worst case is that `/v1/options` returns the v0.1 link-out payload.
- **Honest sources.** Anything the sibling returns is cited with the
  sibling's own `provider` name in `sources[]`, so `docs/DATA_SOURCES.md`
  stays truthful about where the numbers come from.

**Trade-off**: One extra network hop per options request in v0.2. Given
options data is a detail-sheet action (not a hot map path), the latency
budget is comfortable — target < 400ms p95 including the proxy.

**Enforcement**: `apps/api/src/routes/options.ts` must not import from
`~/option_derivation`. Any future proxy code lives in
`apps/api/src/routes/**` and reads the sibling's base URL from a Doppler
env var (`OPTION_DERIVATION_URL`), never from a filesystem path.

## D11 — Load test at v0.1.0 measures the guardrail, not capacity

**Decision**: The Phase 7 load test (`scripts/loadtest.ts`, results in `docs/loadtest-v0.1.0.md`) is treated as **passing on the application path and failing on the ingress path**, and the ingress finding is a known issue we ship with rather than a regression.

**Context**:

- The deployed API's abuse guardrail (`apps/api/src/middleware/rateLimit.ts`) is a fixed **60 rpm per IP**, in-memory `Map`. It's exactly what D3/Phase 7's "rate limits + abuse guardrails" asked for.
- A single-source load test at 50 rps for 30 s (or 200 rps for 15 s) fills that bucket in under a second and every subsequent request returns `HTTP 429`. Empirically that's 88 % / 100 % of the two phases returning 429.
- The 58 requests on `/v1/resolve-comparable` that landed *before* the bucket saturated posted **p95 = 180 ms, p99 = 193 ms** for the full finance path (Bun/Hono → seed-table lookup → Exa ETF query → JSON serialization). That's inside the 2000 ms budget by an order of magnitude.
- Railway's edge rewrites client-supplied `X-Forwarded-For`, so IP rotation from the outside doesn't spread requests across buckets. This was verified by observing that three distinct spoofed XFF values consumed a single shared bucket.

**Why we accept it for v0.1.0**:

- The guardrail is doing its stated job — protecting the API and the OpenRouter/Exa spend from a single misbehaving client. Weakening it to make a load test pass would defeat its purpose.
- The application path's p95/p99 numbers from the 58 successful resolve requests are well inside budget, so the API is not the bottleneck the guardrail is protecting.
- The v0.1 launch surface is a small TestFlight cohort. Real distributed traffic is unlikely to trip the per-IP limit before we ship v0.2.

**Follow-ups (v0.2 or sooner if needed)**:

1. **Bypass token**: add an `X-Loadtest-Key` header (validated against a Doppler secret) that skips the rate-limit middleware. Rerun `scripts/loadtest.ts` with the header set and record `docs/loadtest-v0.1.1.md`.
2. **Multi-source runner**: run the same script from a GitHub Actions matrix (≥3 workers) or `k6 cloud` so per-IP buckets aren't a single-node bottleneck.
3. **Redis-backed limiter**: when we scale beyond one API replica, migrate `buckets` from the in-process `Map` to Redis / Upstash so a per-user token isn't reset by a bounce.
4. **Higher default for authenticated users**: `RateLimitOpts.limit` is already parameterizable — bump it to 300 rpm on user-scoped routes once we tune it against real usage.

**Trade-off accepted**: Load-test numbers for v0.1.0 report application-path latencies from a small (n = 58) sample. We are not claiming a distributed-throughput ceiling from this run — see `docs/loadtest-v0.1.0.md` for the honest bounds.

## Open questions

- **Model routing cost budget**: at what monthly OpenRouter spend do we self-host a fine-tuned vision model?
- **Push notifications**: does earnings-window alerting justify APNs infra?
- **Watchlists**: separate table or a per-user JSON blob until >1000 users?
