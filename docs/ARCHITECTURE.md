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
          │                       OpenRouter          Yahoo · SEC       Exa Web Search
          │                       (Gemini 2.5 /       Polygon · ETF.com
          │                        Claude 5 vision)
          │
          └── landing (Next.js) ── renders docs, TestFlight link
```

## Request flow — “what is this?”

1. Client sends `POST /v1/identify` with `image` + optional `location {lat, lng}`.
2. API validates via `packages/core` zod, applies auth + rate limit.
3. `packages/vision.identifyFromImage(bytes, {location})` calls OpenRouter with a multimodal model. Prompt asks for `{brand, product, sector, visible_text, confidence}`.
4. `packages/finance.resolveTicker(brand)` looks up a first-party mapping table. On miss, calls `packages/search.searchBrand()` (Exa) and asks the LLM to extract a ticker with citations.
5. If the brand is private, `packages/finance.resolveComparable()` finds the closest public co and an ETF with meaningful exposure. Sources attached.
6. API returns a single `IdentifyResponse` with `investable[]` and `sources[]`.

## Request flow — “what’s around me?”

1. Client sends `GET /v1/nearby?lat=..&lng=..&radius=..`.
2. API calls Google Places (server-side, using the server’s Maps key).
3. Places results are joined with a **brand→ticker** table (cached in Redis/Postgres).
4. Unknowns are batched to `packages/finance.resolveTicker` (Exa + LLM).
5. Response is a `NearbyResponse` with markers, tickers, and sector tags.

## UX mean (client)

Photos → Share → Mapvest is the same identify loop as Camera (`/share-intent`).
The share extension is native; JS alone cannot appear in the iOS share sheet.
Camera always opens a live shutter (last snap is not the landing state).

The product is four layers, in this order: **(A) identify** anything around
you via camera or map (public ticker, or private → public comparable + ETF)
so the user builds an investable universe from the world; **(B) agentic
research** on that company or the local economy (regional quirks that make a
street better or worse for a business); **(C) a finance agent** with tools
that writes briefs and memos, with saved chats and Chat about / Chat with on
the map and everywhere else; **(D) analytics and charts** (trends, levels,
auction / ridge / regression) so they can think about how and why to own or
trade the name. Mapvest sits on three APIs: location/image → public + private
identity and comparables; a finance agent with stats tools; and a charts
stack. First session still teaches one loop: camera or map → one identity →
one ticker card with sources. Home is a watchlist, not a second command
center. A quiet Identify · Local brief · Research · Analytics strip sits
under the snap/map hero so the rest of the loop is visible without a
carousel. Map and List are blended (bottom sheet on the map + **View as List** / **View as Map**
toggles) rather than duplicated as Home widgets. There is **no bottom tab
bar** — destinations live in the profile drawer (left-sliding) and a camera
icon sits in the top-right of Home / Map / List. The Local Economy Brief sits
above the watchlist on every Home load (featured chrome, always refreshable)
and is **neighborhood-scoped** (Nominatim zoom 16 + suburb/neighbourhood,
map viewport center when the user has panned the map — not “New York, New
York”). Opus writes it first. Research chat proxies Derivation; if that
service returns a machine error (`MODEL_BUDGET_EXHAUSTED`) we fall back to
the same OpenRouter stack and never show the raw code. Every screen has a
**menu burger** (shared `AppTopBar` or the tab header). Map refetch follows
zoom (viewport radius + zoom bucket); Apple/Google POIs are hidden so only
our pins carry tickers; same-brand locations inherit a resolved ticker;
overlapped chips go to the pin closest to the viewport center. Daily brief, movers, and backtest
appear only after the user has saved something. Overview
shows a native Yahoo price series; analyzer PNGs live in an Analytics
section with auction / ridge / regression chips. A listed ticker page is
ticker → name → chart → save/research/Robinhood/alert → comps → analytics
→ glance → financials → news → full brief. Comparables lead only when the
name is actually private. News opens an in-app reader (Safari is optional).
A one-screen first-open sheet
(`mapvest.firstOpen.v1`) appears once and routes to Camera or Map — never a
carousel. Mapvest Daily and Local Economy Brief both collapse behind a
chevron. Leading `$` cashtags stay on map pins and in prose; list rows show
the ticker without a prefix. Overlapped map tooltips use a two-tap sequence
(reveal → open summary). Home search suggests tickers as you type. Detail
staggers section render so the sheet never hangs on a blank spinner.

## Layering rules

- `apps/*` may import `packages/*`.
- `apps/*` may **not** import from another `apps/*`.
- `packages/*` may import from other `packages/*` only if the DAG stays acyclic. `core` is the leaf.

## Storage

| Data | Store | Retention |
| --- | --- | --- |
| Sessions | Postgres (Railway) | 30d |
| User photos (opt-in) | Signed S3 bucket keyed by uid | 7d default |
| Brand→ticker cache | Postgres | ∞ (versioned) |
| Request log (admin) | Postgres | 30d |
| Cost telemetry | Logfire | 90d |

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
