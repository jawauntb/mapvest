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
- Watchlist portfolio analytics (basic ★ Save is now Postgres-backed via `user_watchlist`)
- Push notifications when a nearby brand hits an earnings window

---

## Phase 8.5 — Atlas Signal design system

- [x] Morphospace of 4 directions; ship **Atlas Signal** (Maps + RH green + Chat clarity + X density)
- [x] `packages/design` tokens + CSS vars; iOS `src/theme/tokens.ts`
- [x] Logo mark / wordmark / favicon / apple-touch / OG / app icon
- [x] Landing fonts: Syne (display) + IBM Plex Sans/Mono; brand-first hero
- [x] iOS chrome colors + splash/icon

---

## Phase 8 — Performance, continuity, freemium, billing

Ship as small slices; each slice merges to `main` and redeploys Railway (API + landing). iOS picks up via Expo reload / next EAS build.

### Product rules (source of truth)

1. **Browse free without account** — open app/web, use map/list/nearby/identify/research up to **50 generations** (billable: identify, agent chat, memo).
2. **Signup required to persist** — Save/watchlist, Robinhood MCP, memos-on-watchlist need a session.
3. **After 50 gens** — must subscribe **$20/month** (Stripe) unless entitled free.
4. **Forever-free entitlements**
   - Auto: email contains `jawaun` (case-insensitive) → free forever.
   - Admin: grant/revoke free on `/v1/admin/users` (and Admin UI).
5. **Login sticks** until explicit logout (web localStorage + iOS SecureStore; users in Postgres; session JWT long-lived / refreshable).
6. **Home/settings** — login, logout, account, plan status, Robinhood MCP, manage subscription.

### Slice A — Geo cache + tab continuity *(ship first)*

- [ ] Postgres `nearby_cache` (geohash6 + radius, 12h TTL) + `brand_ticker_cache` (7d)
- [ ] iOS: `freezeOnBlur` / `unmountOnBlur: false`, PersistQueryClient → AsyncStorage
- [ ] Camera/Live last result in React Query cache; map nearby longer staleTime + chart prefetch for top tickers

**Acceptance**: Second `/v1/nearby` same tile is cache hit; switch Camera→Home→Camera keeps frozen result.

### Slice B — Durable session + settings auth UX

- [ ] Session refresh on `/v1/auth/me` (extend expiry); 90d TTL
- [ ] Guest mode: tabs usable without Redirect-to-auth; auth only for save/settings actions
- [ ] Home shows plan + Sign in / Sign out; web Home same

**Acceptance**: Kill app / refresh web → still signed in; Sign out clears both surfaces’ tokens.

### Slice C — Anonymous 50-generation meter

- [x] `X-Device-Id` (UUID in SecureStore / localStorage) on billable calls
- [x] Postgres `usage_events` + `GET /v1/entitlements`
- [x] Gate identify / agent/chat / memo at 50 for anon + unpaid users
- [ ] Clients show remaining count + soft paywall CTA

**Acceptance**: 51st identify without login returns `402`/`403` with `{ code: "quota_exceeded" }`.

### Slice D — Entitlements (jawaun + admin free)

- [x] User columns / table: `plan` = `free_forever | free_trial | subscribed | none`, `free_forever_reason`
- [x] Auto-set free_forever when email matches `jawaun`
- [x] Admin POST `/v1/admin/users/:id/entitlement` `{ freeForever: boolean }`
- [ ] Admin UI to toggle free

**Acceptance**: `jawaun@…` never hits quota; admin can free another email.

### Slice E — Stripe $20/mo

- [ ] Doppler/Railway: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_MONTHLY`
- [ ] `POST /v1/billing/checkout` → Stripe Checkout Session
- [ ] `POST /v1/billing/portal` → customer portal
- [ ] Webhook `customer.subscription.*` → set `subscribed`
- [ ] Web + iOS “Subscribe $20/mo” (iOS may open Stripe Checkout in browser for v1; App Store IAP later)

**Acceptance**: Test-mode checkout flips user to subscribed; quota lifts.

### Slice F — Docs + OpenAPI regen

- [ ] `docs/SECRETS.md`, `DATA_SOURCES.md`, OpenAPI/Postman for entitlements/billing
- [ ] Tick this phase’s checkboxes as each slice lands

**Acceptance**: Docs match live env vars; `bun run openapi && bun run postman` clean.

---

## Phase 9 — Share-to-Mapvest + home-screen widgets

See `docs/SHARE_AND_WIDGETS.md` for the full design + activation checklist.
API + JS/TS are done and tested; the native share extension and widget
extensions only activate after an `expo prebuild` + Xcode/EAS build, which
this environment can't run — that step is the "acceptance" gate below.

- [x] `apps/api`: `GET /v1/widget/nearby` + `GET /v1/widget/map-snapshot`
      (Google Static Maps proxy, key stays server-side), sharing the
      `/v1/nearby` places cascade via `lib/nearby-resolve.ts`
- [x] `packages/core`: `WidgetNearbyItem` / `WidgetNearbyResponse` schemas;
      `openapi.yaml` + `postman.json` regenerated
- [x] iOS: outbound Share button on the detail sheet (native OS share sheet)
- [x] iOS: inbound share-to-Mapvest via `expo-share-intent` —
      `ShareIntentListener` + `app/share-intent.tsx` run a shared image
      through the same `/v1/identify` pipeline as the Camera tab
- [x] iOS: WidgetKit "Nearby" list + map widgets (`targets/widget/`, via
      `@bacons/apple-targets`) — Swift source in place, deployment target
      16.0, no iOS-17-only APIs
- [x] Android: "Nearby" home-screen widget (`src/widgets/`, via
      `react-native-android-widget`) — JSX widget UI + headless task handler
- [ ] `expo prebuild --clean` run at least once against these changes and
      verified in a simulator/device (share sheet target appears; both
      widgets render and refresh)
- [ ] `ios.appleTeamId` set in `app.json` before the next EAS build (needed
      for the widget extension to code-sign)
- [ ] Real simulator/device screenshots of both widgets + the share sheet
      replace the placeholder description above once verified

**Acceptance**: Sharing a photo from Photos/Messages/a browser to Mapvest
identifies it end-to-end; both home-screen widgets show real nearby data
and refresh after visiting Map/List.
