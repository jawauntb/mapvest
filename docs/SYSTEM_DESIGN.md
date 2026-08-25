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

## D3 — Multimodal via OpenRouter (GPT-5.6 Terra primary)

**Decision**: `packages/vision` calls OpenRouter with `openai/gpt-5.6-terra` as the default model (image + text), falling back to `anthropic/claude-opus-4.8` then `x-ai/grok-4.6` on errors/timeouts (default 25s for multimodal). Same chain judges private→public comparables and user-facing briefs. Claude via OpenRouter is OK on the user path (`ANTHROPIC_API_KEY` stays agent-ops only).

**Why**: GPT-5.6 Terra is the balanced SOTA default on the camera, comparable, and brief loop. OpenRouter keeps one key and a fallback chain (Claude Opus 4.8, then Grok 4.6 last).

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

## D12 — Entitlements: device-metered free tier, not per-request billing

**Decision**: The 50-generation free tier (`apps/api/src/lib/entitlements.ts`) meters lifetime usage per identity (signed-in `userId`, else anonymous `X-Device-Id`), not per time window, and is enforced by a single `requireGenerationQuota` middleware shared by the three billable routes (`POST /v1/identify`, `POST /v1/agent/chat`, `POST /v1/memo`).

**Context**:

- `optionalAuth` runs first and populates `c.get("user")` from a session bearer token *without* rejecting anonymous requests — these routes must stay usable by guests (Phase 8 product rule 1).
- `requireGenerationQuota(kind)` then requires either that user or an `X-Device-Id` header, checks `getEntitlementState()`, and returns `402 { error, code: "quota_exceeded", remaining, limit, priceUsd, interval }` when the quota is spent. It records the usage event only after the wrapped handler responds with status `< 400`, so failed upstream calls (e.g. a 502 from Derivation/Underlying) don't burn a user's quota.
- Research chat supplies its stable `clientMessageId` as the usage-event request key. A lost-response retry or `/stream` → `/chat` recovery therefore reuses the original event and remains recoverable even when that first accepted request spent the user's last free generation.
- **Clients must present a paywall on that 402**, not a generic error. iOS (`PaywallProvider`) and web (`/app` `PaywallRoot`) show remaining count, require sign-in, then start `POST /v1/billing/checkout` with `{ platform }`. Camera does **not** enqueue a snap that failed with `quota_exceeded`.
- Checkout is channel-aware: **iOS StoreKit 2** posts the signed transaction to `POST /v1/billing/apple` (Apple Root CA G3 pin); `ios` + `APPLE_IAP_PRODUCT_ID` → `{ channel: "apple_iap", productId }`. Web uses Stripe Checkout. Android Play Billing remains deferred. Do not open Stripe from the iOS paywall on StoreKit builds.
- `free_forever` (auto-granted for emails containing `jawaun`, or admin-scoped accounts; also settable via `POST /v1/admin/users/:id/entitlement`) and `subscribed` (Stripe, Slice E) both short-circuit to unlimited.
- Anonymous usage is **not** merged into an account's usage when a device later signs in — a device's counter and a user's counter are independent. This is a deliberate v1 simplification (device→account usage migration is a Slice E+ follow-up) rather than an oversight.
- `canPersist` (save/watchlist/memo-on-watchlist) is a separate field from `canGenerate` and is `true` only when signed in — that's Phase 8 product rule 2, independent of remaining quota.

**Trade-off accepted**: Postgres is queried with a `count(*)` per quota check rather than a cached counter. At v0.1 traffic this is fine (`usage_events` is indexed on both `user_id` and `device_id`); revisit with a materialized counter column if quota checks show up in the hot-path latency budget.

## D13 — Research chat is one durable Console conversation

**Decision**: Both Mapvest research entry points call Derivation `POST /api/explore` with `mode: "agent"`. A follow-up sends the returned conversation ID with `message_mode: "steer"`; retries reuse the same client message ID. Mapvest polls `/api/autoresearch?summary=1` for progress and requests `display=1` for the full article projection.

**Why**: The Console now puts its full research behavior behind `/api/explore`; campaigns are an internal execution detail. Keeping the existing Mapvest chat and SSE routes avoids a second campaign UI while giving every turn the richer evidence path. The service bearer remains server-side, and Mapvest stores only owner-scoped conversation references.

`POST /v1/agent/stream` still emits 3-second `ping` frames so Railway and iOS do not close an otherwise idle poll. Before forwarding, Mapvest hashes a stable isolation namespace plus the client message ID: the owned conversation for follow-ups, or the device/user for a new conversation. That keeps retries stable across conversation claims without letting one shared service credential deduplicate unrelated users or conversations. Mapvest retains the caller's original ID in its response and applies the same scoping to retry-safe quota metering.

Completed display projections keep progress, evidence, context, tool activity, ideas, specialist findings, memo summaries, and failures in the existing chat. `GET /v1/agent/threads/{id}/memo` proxies a finished PDF without exposing the Console service token. A signed-in request carrying its existing device ID claims that device's anonymous research references into the user scope; quota counters remain separate as described in D12.

Blocked or exhausted conversations are surfaced as such; Mapvest does not replace them with a tools-free model response. Local direct Console calls omit proxy-shaped headers, while the canonical Railway deployment (or an explicitly configured `RESEARCH_CONSOLE_FORWARDED_HOST`) retains the front-door attestation.

## D14 — Global rate limit keys by session, not shared NAT IP

**Decision**: The API limiter (`apps/api/src/middleware/rateLimit.ts`) is 300 req/min, keyed by session `sub` when a bearer token is present, else `X-Device-Id`, else IP. OPTIONS/HEAD, `/v1/health`, `/v1/config`, and the Stripe webhook do not count.

**Why**: Production on 2026-08-19: opening Home (10 parallel quotes + watchlist + finds + brief) then Investable (`resolve-comparable` + analysis + SEC) burned a shared 60/min IP bucket. The Investable page then replaced the whole sheet with `rate limit exceeded`. Auth middleware runs per-route *after* the global limiter, so the old `c.get("user")` key never fired. Phone + laptop + web on one NAT looked like one client.

**What we are not doing**: Redis yet. Per-route quotas stay on identify (`identifyGuards`) and generation (`requireGenerationQuota`).

## D15 — Investable never dies for a chart throw or a 429

**Decision**: The Investable sheet always paints a header. `resolve-comparable` failures (including 429) use a local fallback: typed tickers still get charts; brand names show the name + inline retry and do **not** invent a ticker. Chart SVG throws stay inside `ChartErrorBoundary`. React Query does not retry 429/401.

**Why**: PR #26 stopped IP-wide 60/min exhaustion and wrapped charts, but a map pin named "Starbucks" still replaced the whole sheet with `rate limit exceeded` when resolve 429'd, and a `toFixed` on missing quote/regression fields still escaped the chart boundary.

**What we are not doing**: A batch `/v1/quotes` endpoint. Home's 24-wide quote fan-out is absorbed by the 300/min user/device bucket.

## D16 — Market data is provider-routed behind stable contracts

**Decision**: Massive is the primary market-data provider inside
`packages/finance/src/marketData`. Existing quote, history, news, and options
link-out routes keep their names, request shapes, response fields, status codes,
and timestamp conventions. New Massive capabilities are additive under
`/v1/market-data/*`, `/v1/options/chain`, `/v1/options/contracts*`, and
`/v1/market-events`.

**Fallback**: Yahoo is available only when `MARKET_DATA_PRIMARY=yahoo` (with
the legacy `MARKET_DATA_PROVIDER=yahoo` alias) or the
explicit `MARKET_DATA_FALLBACK_PROVIDER=yahoo` flag is set. The fallback is
limited to quote/history parity; it is not silently substituted for options,
aggregates, or events. Provider failures preserve the existing best-effort
`null`/`502` behavior and map rate limits to `429`.

**Freshness**: The purchased Massive subscription is authoritative for realtime,
delayed, end-of-day, historical depth, options Greeks/IV, and event coverage.
Mapvest reports configured freshness and dataset access through
`GET /v1/market-data/capabilities`; unset plan metadata is treated as
unverified. TMX corporate events are a separately subscribed partner dataset
updated every two hours and are surfaced in the Investable News & catalysts
panel when enabled. WebSocket tick streaming is not yet proxied, so REST
consumers must not infer tick-by-tick guarantees.

**Robinhood boundary**: Massive replaces Robinhood only for market-data reads
(quotes, history, options, and corporate events). Robinhood remains an optional
broker/account integration for holdings, account state, authentication, and
order workflows; market-data flakiness does not require routing those reads
through Robinhood.

**Evidence**: The complete route/consumer inventory and endpoint mapping lives
in `docs/MARKET_DATA_MIGRATION.md`. Sibling derivation-research and
underlying-analyzer services remain separate and are not modified by this
migration.

## Open questions

- **Model routing cost budget**: at what monthly OpenRouter spend do we self-host a fine-tuned vision model?
- **Push notifications**: does earnings-window alerting justify APNs infra?
- **Watchlists**: separate table or a per-user JSON blob until >1000 users?
