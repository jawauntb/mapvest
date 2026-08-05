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

**Decision**: `packages/vision` calls OpenRouter with `google/gemini-2.5-pro` as the default model, falling back to `anthropic/claude-5-sonnet` on 5xx or timeout > 8s.

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

## Open questions

- **Model routing cost budget**: at what monthly OpenRouter spend do we self-host a fine-tuned vision model?
- **Push notifications**: does earnings-window alerting justify APNs infra?
- **Watchlists**: separate table or a per-user JSON blob until >1000 users?
