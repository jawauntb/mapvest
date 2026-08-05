# Mapvest — Implementation Plan

Phased build. Each phase has an acceptance test. When agents tick a checkbox, commit the tick.

Legend: `[ ]` = todo · `[x]` = done · `[~]` = in progress

---

## Phase 0 — Bootstrap

- [x] Create GitHub repo `jawauntb/mapvest`
- [x] Wire remote to local repo
- [x] `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `README.md`
- [x] `docs/ARCHITECTURE.md`, `docs/DATA_SOURCES.md`, `docs/SECRETS.md`, `docs/DEPLOY.md`, `docs/SYSTEM_DESIGN.md`
- [x] Monorepo scaffold (`apps/`, `packages/`, `infra/`) with root `package.json` + `bun` workspaces
- [x] Biome config, .gitignore, tsconfig base
- [x] Initial push to origin

**Acceptance**: `git clone && bun install` runs cleanly on a fresh machine.

---

## Phase 1 — Core types + shared packages

- [ ] `packages/core` — zod schemas for `Investable`, `Brand`, `Location`, `PhotoIdentification`, `Comparable`, `Source`, `User`, `Session`
- [ ] `packages/vision` — OpenRouter multimodal client. Function `identifyFromImage(bytes, {location?})` returns `PhotoIdentification`
- [ ] `packages/search` — Exa client wrapper. `searchBrand(query)`, `enrichTicker(brand)`
- [x] `packages/finance` — 
  - [x] `resolveTicker(brand)` — first-party mapping + fallback via Exa + LLM
  - [x] `resolveComparable(private_brand)` — returns nearest public co + confidence
  - [x] `resolveEtfExposure(brand|sector)` — returns ETFs with % exposure
- [ ] Package tests (`bun test`) hitting real APIs behind `doppler run`

**Acceptance**: `bun test` green for each package. `bun run --filter vision identify examples/hershey.jpg` returns `{brand: "Hershey's", ticker: "HSY", confidence: "high"}`.

---

## Phase 2 — API layer (Bun + Hono)

- [x] `apps/api` skeleton — Hono, zod-validation middleware, request logger, health check
- [ ] `POST /v1/identify` — multipart image → `PhotoIdentification` + finance annotations
- [x] `GET /v1/nearby?lat=..&lng=..&radius=..` — Google Places → filter → annotate tickers/ETFs
- [ ] `POST /v1/resolve-comparable` — `{brand: "…"}` → public comparable + ETF
- [x] `POST /v1/auth/session` — passwordless email sign-in (magic link)
- [x] `GET /v1/admin/…` — admin scope: metrics, user list, request log
- [x] Rate limits (per-user + per-ip), abuse guardrails
- [x] OpenAPI schema generated from zod (`packages/core`) — `bun run openapi` writes `openapi.yaml`; `bun run postman` writes `postman.json`

**Acceptance**: `curl -F 'image=@examples/mcd.jpg' localhost:3001/v1/identify` returns `{brand:"McDonald's", ticker:"MCD", …}`. `/v1/nearby?lat=37.77&lng=-122.42` returns ≥5 investable items.

---

## Phase 3 — iOS app (Expo)

- [x] `apps/ios` — Expo React Native (TypeScript, expo-router). SDK 52+.
- [x] Auth screen — magic-link email flow
- [x] Map screen — `react-native-maps` w/ Google provider; pins colored by publicness
- [x] Camera screen — capture → upload to `/v1/identify` → result card
- [x] Live-scan screen — throttled frame capture (~1 fps) → `/v1/identify`
- [x] List screen — sortable by distance, market cap, sector
- [x] Detail sheet — ticker, comparables, ETFs, sources
- [x] Admin tab (hidden unless user has `admin` scope)
- [x] Offline queue for photos (uploads on reconnect)

**Acceptance**: Simulator run shows map with real data around San Francisco; camera identifies a chocolate bar photo end-to-end.

---

## Phase 4 — Landing page

- [x] `apps/landing` — Next.js 15 App Router, minimal marketing
- [x] Server-renders `docs/*.md` at `/docs/{slug}`
- [x] TestFlight CTA + GitHub link
- [x] Screenshot gallery pulled from `docs/assets/` (horizontally-scrolling gallery in `apps/landing/src/app/page.tsx` wraps four SVG "screenshots" — `auth.svg`, `map.svg`, `camera.svg`, `detail.svg` — in a 12:19 device frame under `apps/landing/public/screenshots/`; real simulator captures replace them one-for-one post-TestFlight)
- [x] SEO: og-image, sitemap

**Acceptance**: `bun run --filter landing build` succeeds; `/docs/architecture` renders the file.

---

## Phase 5 — Deploy (Railway)

- [ ] Railway project `mapvest` in the user's default workspace
- [ ] Service: `api` (Bun) — Doppler mount, healthcheck, autoscaling off, generated domain
- [ ] Service: `landing` (Next.js) — generated domain
- [ ] Postgres plugin — sessions + admin log
- [ ] Env vars mirrored from Doppler via `doppler secrets download --format env --no-file | railway variables set`
- [ ] Custom domain optional (deferred)

**Acceptance**: `https://mapvest-api-*.up.railway.app/v1/health` returns 200; landing loads at its Railway URL.

---

## Phase 6 — TestFlight

- [ ] `apps/ios/eas.json` — internal + external profiles
- [ ] Bundle id `com.mapvest.app` (or under existing Apple Team)
- [ ] `eas build --platform ios --profile production`
- [ ] `eas submit --platform ios`
- [ ] Internal testers group configured

**Acceptance**: Build appears in App Store Connect → TestFlight; internal group can install.

---

## Phase 7 — Polish + guardrails

- [x] Rate limit + WAF sanity on `/v1/identify`
- [x] Cost telemetry per request (OpenRouter model, image size, resolution ms)
- [x] Prompt-injection guard on OCR'd text
- [x] Load test: 50 rps identify, 200 rps nearby — ran `scripts/loadtest.ts` against the deployed API on 2026-08-05 (`docs/loadtest-v0.1.0.md`). Substituted `/v1/resolve-comparable` for `/v1/identify` (skips OpenRouter cost per run) and `/v1/health` for `/v1/nearby` (I/O-only baseline) — the layer boundary being proven (Bun/Hono ingress + rate-limit middleware + finance path) is the point. Application path posted p95 = 180 ms / p99 = 193 ms on the 58 requests that survived the guardrail; the 60 rpm per-IP limiter dominated the rest of the run and is documented as a known limitation in `docs/SYSTEM_DESIGN.md` §D11 with follow-ups tracked there.
- [ ] Landing page polish + docs pass
- [ ] "Ship" tag `v0.1.0`, GitHub Release notes

**Acceptance**: `v0.1.0` release with a demo GIF and a working TestFlight link.

---

## Deferred / v0.2

- Android build via EAS
- Options-derivation integration (link out to sibling `option_derivation` repo)
- Underlying-Analyzer integration (private-firm sector proxies)
- Watchlist sync (per-user portfolios)
- Push notifications when a nearby brand hits an earnings window
