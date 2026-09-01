# Architecture

Mapvest is a three-tier product: **iOS client**, **HTTP API**, **shared TS packages**. Everything else is glue.

```
┌────────────────────┐          HTTPS           ┌────────────────────────┐
│  iOS (Expo/RN)     │  ───────────────────►    │  apps/api (Bun + Hono) │
│  camera · map ·    │  ◄─── json + jpegs ───   │   /v1/identify         │
│  list · admin      │                          │   /v1/nearby           │
└─────────┬──────────┘                          │   /v1/resolve-comparable
          │                                     │   /v1/auth · /v1/admin │
          │                                     └────────────┬───────────┘
          │                                                  │
          │                              ┌───────────────────┼────────────────┐
          │                              │                   │                │
          │                              ▼                   ▼                ▼
          │                    packages/vision      packages/finance   packages/search
          │                    (OpenRouter)         (ticker / ETF)     (Exa)
          │                              │                   │                │
          │                              ▼                   ▼                ▼
          │                       OpenRouter          Market data        Exa Web Search
          │                       (Gemini 2.5 /       SEC · Yahoo
          │                        Claude 5 vision)
          │
          └── landing (Next.js) ── mapvest.app — docs, TestFlight link
```

## Request flow — “what is this?”

1. Client sends `POST /v1/identify` with `image` + optional `location {lat, lng}`.
2. API validates via `packages/core` zod, applies auth + the global limiter (300/min, keyed by session then device then IP; see SYSTEM_DESIGN D14).
3. `packages/vision.identifyFromImage(bytes, {location})` calls OpenRouter with a multimodal model. Prompt asks for `{brand, product, sector, visible_text, confidence}`.
4. `packages/finance.resolveTicker(brand)` looks up a first-party mapping table. On miss, calls `packages/search.searchBrand()` (Exa) and asks the LLM to extract a ticker with citations.
5. If the brand is private, `packages/finance.resolveComparable()` finds the closest public co and an ETF with meaningful exposure. Sources attached.
6. API returns a single `IdentifyResponse` with `investable[]`; each returned match carries its `Source[]` citations.

## Request flow — “what’s around me?”

1. Client sends `GET /v1/nearby?lat=..&lng=..&radius=..`.
2. API calls Google Places (server-side, using the server’s Maps key).
3. Places results are joined with a **brand→ticker** table (cached in Redis/Postgres).
4. Unknowns are batched to `packages/finance.resolveTicker` (Exa + LLM).
5. Response is a `NearbyResponse` with markers, tickers, and sector tags.

## UX mean (client)

Photos → Share → Mapvest is the same identify loop as Camera (`/share-intent`).
The share extension is native; JS alone cannot appear in the iOS share sheet.
Camera always opens a live shutter (last snap is not the landing state). The
annotator is optional: snap identifies immediately, **Refine** (circle +
hint) re-runs it, and roi / hint / location now reach the API. The result
card leads with a meaning line (“you can own this” / closest public cousin),
then price, a confidence badge, a concise **Evidence** section, and “Added to
your finds.” Evidence names only the returned providers, explains each source
confidence, shows its fetch date, and links only valid HTTP(S) citations; it
never presents a returned source as independent verification. If none are
returned, Camera and Detail say so and treat the match as low confidence.
It gives the primary match one explicit detail CTA while listing every
additional match; zero matches explain how to **Refine** or **Retake**. During
identify, the camera only marks client-observable work complete (photo ready,
then request started) and names the public-match lookup as the next step — it
does not fabricate server-side progress. Result-card motion is disabled when
the system requests Reduce Motion.
A signed-in public result with an attached positive quote can also show one
static, per-user/device **Find evolution** offer. The result merely qualifies
the offer: this device-global preference covers all of the person's finds, not
the brand that triggered it. Capture never requests iOS permission: only its
direct CTA may do so, and Mapvest writes only `notifications_enabled` plus
`find_evolution` after permission, device registration, an exact-token
preference read, and server persistence have all succeeded. Failed, denied,
lost-response, and Settings recovery states never claim that an alert is enabled.
On iOS, success additionally requires the OS alert-presentation capability,
not merely top-level notification authorization. Push preferences are always
scoped to this install's stored push-token id; a missing or stale id does not
select another device. Camera result state/cache is scoped to the identity that
started identify, clears on an auth transition, and uses one bounded vertical
result scroller so actions and cited evidence remain reachable on compact phones.
A signed-out **Save** from Camera or Detail carries the ticker and save source
through magic-link auth, shows a verified-then-saving state, upserts the
watchlist entry idempotently, and returns to that ticker’s Detail context. The
client never accepts an arbitrary post-auth redirect URL. If saving fails after
verification, the code field stays locked and Retry save uses the verified
session rather than re-running the magic link.

The product is four layers, in this order: **(A) identify** anything around
you via camera or map (public ticker, or private → public comparable + ETF)
so the user builds an investable universe from the world; **(B) agentic
research** on that company or the local economy (regional quirks that make a
street better or worse for a business); **(C) a finance agent** with tools
that writes briefs and memos, with saved chats and Chat about / Chat with on
the map and everywhere else; **(D) analytics and charts** (trends, levels,
auction / ridge / regression) so they can think about how and why to own or
trade the name. iOS charts draw with React Native Views (`apps/ios/src/chartkit`),
not `react-native-svg` — that native module flashed and SIGABRT'd on current
Xcode / iOS builds. Mapvest sits on three APIs: location/image → public + private
identity and comparables; a finance agent with stats tools; and a charts
stack. First session still teaches one loop: camera or map → one identity →
one ticker card with sources. Every successful identify is recorded
server-side as a **find** (`user_finds`, `GET /v1/finds`). Home is
discovery-first: snap hero → map link → **Your universe** (recent finds and
streak; the header row is tappable and opens `/universe`) → ticker search →
Local Economy Brief → watchlist (+ daily brief / movers / backtest after
saves). Search follows discovery, never precedes it. `/universe` is the full
finds journal — day-grouped, with Δ since found — reachable from Home’s
universe header, the sidebar, and the camera result card. The loop strip under
the snap/map hero is gone, and so is Home’s top-bar camera icon — the
snap/map hero card remains Home’s camera entry. Map and List are blended (bottom sheet on the map + **View as List** / **View as Map**
toggles) rather than duplicated as Home widgets. There is **no bottom tab
bar** — destinations live in the profile drawer (left-sliding) and a camera
icon sits in the top-right of Map / List. The sidebar is consolidated to
Home, Map, Camera, Your universe, Watchlists, Saved places, Research,
Alerts, Profile — the “Nearby list” and “Find ticker” rows are removed
(list view lives inside Map; search lives on Home). The Local Economy Brief sits
above the watchlist on every Home load (featured chrome, always refreshable)
and is **neighborhood-scoped** (Nominatim zoom 16 + suburb/neighbourhood,
map viewport center when the user has panned the map — not “New York, New
York”). Opus writes it first. Daily and local briefs both carry “sources
cited · research, not advice” and never name model providers. The client
heartbeats its last location via push prefs so the moved-2km “new
neighborhood” push can fire. Research chat proxies Derivation; if that
service returns a machine error (`MODEL_BUDGET_EXHAUSTED`) we fall back to
OpenRouter (Grok 4.6 → GPT-5.6 Luna → Opus 4.8) and never show the raw code. Every screen has a
**menu burger** (shared `AppTopBar` or the tab header). Map refetch follows
zoom (viewport radius + zoom bucket); Apple/Google POIs are hidden so only
our pins carry tickers; same-brand locations inherit a resolved ticker;
overlapped chips go to the pin closest to the viewport center. The map
renders a **My finds** layer — small jade camera badges where the user found
things — toggleable from the nearby sheet. Overview
shows a native provider-routed price series; analyzer PNGs live in an Analytics
section with auction / ridge / regression chips. A listed ticker page is
ticker → name → chart → save/research/Robinhood/alert → comps → analytics
→ glance → financials → news → full brief. Detail is progressive
disclosure: Financials, SEC, and cited Evidence collapse by default; Analytics
stays open with a plain-language explainer per chart type. Evidence opens when
no citations were returned so the low-confidence state is visible; it is never
silently omitted. Empty Comparables / ETF sections are hidden entirely for
listed names.
Comparables lead only when the name is actually private. News opens an
in-app reader (Safari is optional).
A one-screen first-open sheet
(`mapvest.firstOpen.v1`) appears once and routes to Camera or Map — never a
carousel. Mapvest Daily and Local Economy Brief both collapse behind a
chevron. Mapvest Daily is list-scoped: `GET /v1/watchlist/brief?listId=`
writes the column for that list's tickers (omitted → the default list), each
watchlist detail page mounts its own lazily (the brief for a list is only
generated when its page is opened), and Home's card follows the selected
list chip. Any list can be promoted to default — tap the ★ in a watchlist
detail page's header, or tap ••• on any row on the Watchlists screen (a
long-press shortcut still works too), then "Make default"; `POST
/v1/watchlist/lists/:id/default` demotes the old default in the same call.
The Watchlists screen shows a one-time dismissible tip once a second list
exists, and the currently-default list carries a visible "★ Default list"
badge on its detail page — discoverability was a launch-week complaint, so
the affordance and the "why" (it powers Home and Mapvest Daily) are both
surfaced, not just documented. The 7am daily-brief push, Home's "All" view,
and every default-list consumer follow the new default immediately, and
only the default list's brief may fire the "Your morning read" push. Leading `$` cashtags stay on map pins and in prose; list rows show
the ticker without a prefix. Overlapped map tooltips use a two-tap sequence
(reveal → open summary). Home search suggests tickers as you type. Detail
staggers section render so the sheet never hangs on a blank spinner.
Investable (`/detail/[id]`) is a **card push**, not a UIKit page sheet.
TestFlight was dying on that loading spinner because the stack presented
the screen as a modal, then nested Research / news-reader page sheets and
hot-swapped a Reanimated header while resolve returned. Expo/web
(`www.mapvest.app/app/ticker/RLX`) never used those native presenters, so
it kept working. Charts still live behind an error boundary; SVG polylines
with empty/NaN `points` are not mounted.

Crash-hardening (TestFlight builds 64–86 all aborted on
`com.facebook.react.ExceptionsManagerQueue`, i.e. an uncaught fatal **JS**
error, per the device `.ips` logs — not a chart/native-view bug):

- `react-native-reanimated` is pinned to the **3.19.x** line. 3.17.x only
  supports RN ≤ 0.79 and the app runs RN 0.81 with the old architecture;
  worklet errors from a mismatched Reanimated are rethrown on the JS
  thread outside React's render phase, where no error boundary can catch
  them, and release builds abort. Do not re-pin to 3.17 and do not move to
  4.x while `newArchEnabled` is `false` (4.x is Fabric-only).
- `src/util/fatalGuard.ts` replaces the release-mode global JS error
  handler: an uncaught fatal error now renders a recovery screen (with the
  error message, so a TestFlight screenshot doubles as a crash report)
  instead of `abort()`ing the process. Dev builds keep RedBox.
- The Investable header (`Stack.Screen` options) is memoized on the ticker
  so the native `RNSScreenStackHeaderConfig` is not re-configured on every
  render mid push-transition.
- Home's Local Economy Brief reads the map region from the react-query
  cache only (`queryFn` returns `undefined`, `enabled: false`). A missing
  `queryFn` threw on every Home mount and is the same class of fatal JS
  error that aborted TestFlight.

## Layering rules

- `apps/*` may import `packages/*`.
- `apps/*` may **not** import from another `apps/*`.
- `packages/*` may import from other `packages/*` only if the DAG stays acyclic. `core` is the leaf.

Market data follows the same boundary: `packages/finance/src/marketData` owns
provider selection, response normalization, and the explicit Yahoo fallback.
HTTP routes consume that interface and project stable zod response schemas;
clients do not know which upstream provider supplied a response.

## Storage

| Data | Store | Retention |
| --- | --- | --- |
| Sessions | Postgres (Railway) | 30d |
| User photos (opt-in) | Signed S3 bucket keyed by uid | 7d default |
| Brand→ticker cache | Postgres | ∞ (versioned) |
| Request log (admin) | Postgres | 30d |
| Cost telemetry | Logfire | 90d |

## Push notification account isolation

An Expo token represents one physical application installation, not an account.
`push_tokens` retains its historical per-user rows, while
`push_token_claims` is the authoritative global ownership record: a token can
have one active `(token_id, user_id)` claim, or a tombstone after unlinking.
Every push-delivery, preference-read, preference-write, and token-list query
joins the claim, so an old or duplicate row is never deliverable.

Preference reads require an exact opaque `tokenId`: omitted or stale ids return
an explicit empty result and never select a sibling device. iOS first reads its
local id, then may re-register its physical Expo token without prompting for
permission to recover a missing id. A location heartbeat likewise writes only
an exact or recovered current-device token; it otherwise no-ops. `deviceId` is
never part of authorization.

Location-derived work stays scoped to that same token. The movement scheduler
uses each device's own heartbeat, anchor, local-brief dedupe, uncaught ticker
dedupe, and uncaught daily/weekly budgets; a phone cannot move, spend budget,
or cause a local push on its sibling tablet. Nearby Discovery requires at
least one saved find or watchlist entry and is capped at one alert per UTC day
and three per Monday-based UTC week. Local-brief request responses do not send
a redundant push because the requesting device is already displaying the
brief. Non-location events retain their account-wide opted-in fan-out.

Every Expo handoff is assembled per recipient. Its additive `data.mapvest`
envelope contains schema version, unique delivery claim ID, opaque installation
ID, issue/expiry timestamps, event kind, and a bounded typed destination. The
legacy top-level fields remain for older binaries. Current iOS clients accept
only the typed envelope after session hydration, current claimant verification,
expiry checks, and account/installation matching. They record an accepted item
as `pending` before navigation, mark it `handled` after router handoff, retain
both states through expiry plus clock skew, and retry unexpired pending work on
startup. Corrupt, duplicate, over-capacity, stale, or mismatched state fails
closed. Sign-out clears the replay ledger before another account may activate.

Settings exposes intent bundles rather than nine undifferentiated switches:
Nearby Discovery (`uncaught_nearby`, `local_brief`, `identify_done`), My
Universe (`watchlist_mover`, `find_evolution`), and Research Ready
(`memo_finished`, `agent_response`). Daily Brief and user-created Price Alerts
remain individual. iOS provisional authorization is usable; denial keeps a
visible System Settings path. Notification actions only foreground the app and
navigate to Map, company, or notification settings. A Nearby destination opens
the supplied coordinates, highlights the exact place ID (ticker fallback), and
shows an explicit retry state rather than substituting an unrelated result.

Startup serializes lazy push-schema work with a transaction advisory lock,
elects one deterministic legacy row, then mutes every other row. `CREATE OR
REPLACE FUNCTION` plus idempotent trigger installation avoids a `DROP`/`CREATE`
enforcement gap. The trigger repeats that mute on transfer, unlink, and every
preference write that does not match the active claim, so a mixed-version API
that still writes `push_tokens` directly cannot re-enable an old account's
delivery path.
`push_delivery_claims` stores the short lease and dedupe ownership used by the
central dispatcher; expired leases are retryable and never confer account
ownership.

Registration for the already-claimed account is idempotent and keeps that
installation's choices. Registration under another account runs in a Postgres
transaction guarded by a token-specific advisory lock, switches the claim, and
resets the product switch and every event opt-in to false. This deliberately never
carries notification consent, scheduler state, or location from the prior
account. Existing duplicate database rows are not mass-deleted: the first
claim elects the most recently seen row and leaves the rest inert, avoiding a
risky lossy migration.

Explicit iOS sign-out runs before the session is cleared. The app first writes
a same-key SecureStore cleanup envelope containing the old owner and an
immutable push snapshot, then attempts authenticated
`DELETE /v1/push/token/:id` or claimant-bound `POST /v1/push/revoke-device`.
An expired bearer may use public `POST /v1/push/revoke-device` only with both
the Expo token and its opaque server `tokenId`; a valid bearer that lost that
id may use `POST /v1/push/revoke-current-device`. Both return a typed outcome:
`revoked` and `already-revoked` are safe completed cleanup, while
`claim-mismatch` is fail-closed because a different active owner has claimed
the physical token and is an HTTP 409 rather than a 2xx response, so older
clients cannot mistake it for completed cleanup. `deviceId` is advisory
telemetry only: it may rotate after a reinstall or SecureStore loss, while
the opaque id plus Expo token (or authenticated user plus Expo token) is the
authorization proof. A cryptographically valid former session may instead call
`POST /v1/push/revoke-expired-session-device` with its bearer and either an
Expo token or the opaque registration id when no current Expo identity is
available. Expo-token-only recovery is limited to 90 days after expiry;
exact opaque-id recovery has no age limit because it identifies one historical
row and the route still verifies that row's signed subject owns the current
claim. That route checks the signature, HS256 algorithm, `purpose: "session"`,
and `sub` with expiry validation disabled only for this deletion, then can
revoke only that subject's still-active claim; an old id whose physical token
now belongs to another owner returns 409. It reads no user state, and a fresh
account's bearer is never substituted for a different owner.

Native unregistration, Expo auto-registration shutdown, and notification or
response dismissal are defense-in-depth only, never server revocation proof.
The cleanup envelope and push snapshot remain until server revocation and
local deletion are verified, so a force-quit retries idempotently rather than
resurrecting authenticated UI. New registrations persist their physical claim
before the server write, so permission loss cannot erase the recovery path. If
any token, marker, snapshot, or SecureStore read cannot prove cleanup, the app
stays on a retryable cleanup screen. This only removes the current
installation's claim; another phone or tablet remains registered
independently.

Notifiers do not send from a list snapshot. The central delivery facade claims
one Expo-sized batch (at most 100 tokens) at a time, then holds a reserved
Postgres session advisory lock for each physical token through the Expo
handoff. Registration, unlink, preference writes, claiming, and finalization
take the same sorted advisory keys before row locks, so account changes cannot
commit between validation and the irreversible handoff and cannot deadlock
against finalization. The lock is session-level rather than a 45-second row
transaction; its reserved connection is cleaned with `pg_advisory_unlock_all()`
and dispatcher concurrency is bounded per process. Each handoff lease is at
least 90 seconds from advisory-lock acquisition, exceeding Expo's three-attempt
retry window even after waiting behind a prior handoff, and later batches are
selected only after the previous batch finishes. A request already
accepted by Expo/APNs cannot be retracted after that handoff; the gate closes
the server-side selection/state race without claiming impossible downstream
timing guarantees.

Production Expo dispatch is disabled unless `EXPO_PUSH_SECURITY_ENABLED=1`
and a non-empty Doppler-provided `EXPO_ACCESS_TOKEN` are both present. Request
logs redact opaque push token IDs in paths and query strings, and push spans do
not attach tokens, delivery IDs, envelopes, titles, or bodies.

## Observability

- **Logs**: Logfire via `pydantic-logfire` on the API. Structured spans per request.
- **Metrics**: Railway service metrics + Logfire counters (identify latency p50/p95, hit rate on brand cache).
- **Errors**: Logfire issue tracking, Slack channel `#mapvest-alerts`.

## Failure modes

| Mode | Detection | Response |
| --- | --- | --- |
| OpenRouter down | 5xx or timeout | Fall back to Gemini direct via `GEMINI_API_KEY`. |
| Exa quota exhausted | 429 | Serve cached brand map, mark `confidence: "low"`. |
| Google Places quota | 429 | Serve nearest-cached-tile response, refresh async. |
| Vision returns low confidence | model output | Ask user to reframe; do not return a ticker. |
