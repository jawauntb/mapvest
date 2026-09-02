# Data sources

Mapvest never claims a ticker without a source. This doc lists every provider we use and what they’re for.

## Primary

| Provider | Purpose | Key |
| --- | --- | --- |
| **OpenRouter** | Multimodal LLM (image → brand) + comparable-judge step. Prefer `openai/gpt-5.6-terra`, fall back to `anthropic/claude-opus-4.8` then `x-ai/grok-4.6`. | `OPENROUTER_API_KEY` (shared Doppler) |
| **Gemini (direct)** | Fallback multimodal if OpenRouter degrades. | `GEMINI_API_KEY` |
| **Exa** | Open-web search for ticker discovery, parent-company lookup, ETF constituent lookup. | `EXA_API_KEY` |
| **Google Places** | Nearby POI enumeration for the map view (primary). Multi-type queries (`restaurant`, `cafe`, `store`, `bank`, …) merged + de-noised (no hospitals/doctors/parks). | `GOOGLE_MAPS_API_KEY` (Doppler; billed GCP project `steady-force-468319-u7`) |
| **Massive** | Primary market-data provider for routed quotes, aggregates, options contracts/chains, reference news, splits/dividends, and optional TMX Global Corporate Events. | `MASSIVE_API_KEY` and account entitlements in personal Doppler `shared/prd`; TMX is a separately subscribed partner dataset |

## Secondary / free-tier

| Provider | Purpose | Notes |
| --- | --- | --- |
| **OpenStreetMap Overpass** | Nearby POI fallback when Google Places is denied/unavailable. Mirrors are raced in parallel; prefer `overpass.openstreetmap.fr`. | No key. Cite as OSM/Overpass. |
| **Photon (Komoot)** | Last-resort nearby brand search if every Overpass mirror fails. | No key. Shortlist of common public brands only. |
| **SEC EDGAR** | Parent-company resolution, subsidiary lookup, 10-K brand mentions. | No key, please rate-limit. |
| **Yahoo Finance** (legacy adapter) | Explicit quote/history provider or temporary fallback while Massive parity is being proven. | Never selected implicitly; best-effort and delayed. Never invent closes. |
| **ETF.com** / **Nasdaq holdings** | ETF constituent + weight lookup. | Scraped via Exa (respect robots). |
| **Wikidata** | Brand → parent company mapping for the seed table. | Public SPARQL. |

## Seed brand→ticker table

`packages/finance/data/brands.json` ships with a hand-vetted seed of ~500 common consumer brands mapped to `{ticker, exchange, parent}`. Missing brands hit the runtime resolver (Exa + LLM) and get written back to the cache table.

Seed structure:

```json
{
  "hershey's": { "ticker": "HSY", "exchange": "NYSE", "parent": "The Hershey Company" },
  "mcdonald's": { "ticker": "MCD", "exchange": "NYSE", "parent": "McDonald's Corp" },
  ...
}
```

Add-only. Never edit an entry to silently change a ticker — file an issue with a source URL.

## Private → public comparable

The comparable resolver ranks candidates by:

1. Same sector (GICS / SIC).
2. Same sub-industry.
3. Similar geographic exposure.
4. Similar revenue tier if data available.
5. ETF exposure > 3% of AUM.

Each candidate carries a score in `[0, 1]` and a `reasoning` string. Never return a candidate without at least one Exa source.

## Related sibling repos

> **Callout — sibling repos are link-outs, not dependencies (v0.1).**
> Mapvest does not vendor code from these projects and does not import their
> modules. The API exposes each sibling behind a stable `/v1/*` scaffold that
> today returns a `linkOut` URL and a `note`, and in v0.2 will proxy to a
> deployed instance of the sibling. See `docs/SYSTEM_DESIGN.md` **D10** for
> the boundary decision.

| Repo | What it will provide in v0.2 | v0.1 surface | Ownership |
| --- | --- | --- | --- |
| [`option_derivation`](https://github.com/jawauntb/option_derivation) | Options-chain derivation — implied vol surface, greeks, expected-move bands for a given ticker. Consumed by the iOS detail sheet when a public ticker is resolved. | `GET /v1/options?ticker=XYZ` returns `{ linkOut, note }` and the iOS detail sheet renders an "Options →" badge that opens the linkOut in `expo-web-browser`. | jawauntb (sibling repo, separate service) |
| [`The Underlying Analyzer Reboot`](https://github.com/jawauntb/the-underlying-analyzer-reboot) | Auction + depth charts, analysis snapshots, Anthropic briefs / memos, watchlist cockpit/alerts, SEC packs. Live at `underlying-terminal-production.up.railway.app`. | Thin Mapvest proxies (period `1mo` not `1m`): `GET /v1/chart/:type?ticker=&period=` (eager auction 1mo on ticker open; other types lazy), `GET /v1/analysis/:ticker` (snapshot), `POST /v1/memo` (full brief), `POST /v1/cockpit` / `POST /v1/alerts` (Saved, cap 10), `GET /v1/memo/sec/:ticker`. Comparables stay Exa+agent — Underlying has no comps API. | jawauntb (sibling repo, separate service) |
| **Prism** (working name `ubermemo`) — hosted inside [`The Underlying Analyzer Reboot`](https://github.com/jawauntb/the-underlying-analyzer-reboot) | The full-stack memo engine: one ticker split into macro (FRED), factor, regime (3-state Gaussian HMM), spectral, entropy, fundamental (Massive financials), and filing (SEC EDGAR) components, recombined into bull/neutral/bear scenarios, a recommendation with entry/exit levels, a cited memo, and a chat over the packet. Every number in the packet carries `provider` + `fetched_at`; unreachable sources are listed in `meta.errors` rather than zero-filled. | `POST /v1/prism` (metered as `memo`, 180s budget), `GET /v1/prism/{ticker}`, `GET /v1/prism/{ticker}/summary`, `POST /v1/prism/chat`, `GET /v1/prism/{ticker}/export?format=txt\|json\|pdf`. Same handlers under the `/v1/ubermemo` alias. `POST /v1/agent/chat` pre-loads the summary as research context, best-effort with a 3s budget. Origin: `UNDERLYING_URL`. See `docs/PRISM.md`. | jawauntb (sibling repo, separate service) |
| **Derivation Research Console** | Unified durable research conversations. Every Mapvest research turn starts or continues `POST /api/explore` with `mode: "agent"`; the Console supplies the same full tool, evidence, and model path at every research depth. Mapvest uses `/api/autoresearch?summary=1` for status and `display=1` for progress, evidence, ideas, specialists, and memo detail. Campaign fields are read only as a temporary response fallback; Mapvest has no campaign UI. | Server-only `DERIVATION_RESEARCH_API_ORIGIN` + `DERIVATION_RESEARCH_SERVICE_TOKEN`. Mapvest keeps its existing `POST /v1/agent/chat`, `POST /v1/agent/stream`, and `GET /v1/agent/threads*` client surface, persists the returned conversation ID by user/device, and sends it back with `message_mode: "steer"` on follow-ups. `GET /v1/agent/threads/{id}/memo` owner-proxies completed PDFs. Stable retry IDs deduplicate both Console admission and Mapvest quota; no tools-free OpenRouter fallback replaces a failed conversation. | jawauntb (sibling service) |
| **Nearby geo cache (Postgres)** | Places tiles from Google/Overpass/Photon keyed by geohash6 + radius (12h TTL). Brand→ticker joins cached 7d so Exa is not re-hit for the same brand. | `nearby_cache`, `brand_ticker_cache` via `POSTGRES_URL`. First visit pays cascade cost; repeats serve from DB then resolve tickers. | Mapvest API |

Both siblings are expected to run as their own Railway (or equivalent)
services. Mapvest is only responsible for:

1. Publishing a stable request shape (`ticker`, `brand`, `hintSector`).
2. Rendering whatever the sibling returns behind a "not investment advice"
   disclaimer.
3. Never claiming the sibling's output as its own; the source in `sources[]`
   must name the sibling repo/service so `docs/DATA_SOURCES.md` stays honest.

## Ticker honesty

Comparables pipeline for private brands / IP:

1. Parallel **Exa** searches (competitors, parent ticker, comps).
2. Heuristic extract of exchange-cited symbols (`$MCD`, `NYSE: MCD`).
3. **OpenRouter agent** (`openai/gpt-5.6-terra`, then `anthropic/claude-opus-4.8`, then `x-ai/grok-4.6`) judges the evidence and picks ≤3 real listed tickers with reasoning + source URL.

Random ALLCAPS tokens in titles (e.g. `NYP`, `MOUNT`, `MSHS` for nonprofits) are rejected — see `packages/finance/src/tickerSymbol.ts`.

## Market-data ownership and limits

See [`MARKET_DATA_MIGRATION.md`](MARKET_DATA_MIGRATION.md) for the audited flow
map, route compatibility, Massive endpoint mapping, fallback routing, and
subscription assumptions. `GET /v1/market-data/capabilities` is the runtime
source of truth for configured freshness and dataset access. “Configured” does
not mean “real-time”: the purchased Massive plan and optional TMX entitlement
must be verified in Doppler.

The upgraded-account audit and live endpoint matrix is maintained in
[`MASSIVE_CAPABILITY_MATRIX.md`](MASSIVE_CAPABILITY_MATRIX.md). It covers the
financial ratios/statements, NBBO/trades, technical indicators, option
summary/bars, and TMX datasets that are now available to Mapvest.

## What we do NOT use

- Paid market-data feeds (Polygon paid tier, IEX Cloud paid tier) — not until unit economics justify.
- Any user-content scraper. If we need training data, it comes from provider APIs, not scraping.
- Fabricated tickers from abbreviations or GuideStar / 401k plan names.

## Billing (not market data)

Stripe Checkout / Customer Portal charges Mapvest Pro ($19.99/mo) on the **web**. iOS charges the same plan through StoreKit 2 (`mapvest_pro_monthly`); the API verifies Apple's signed transaction (`POST /v1/billing/apple`) and sets `users.plan = subscribed`. This is not a market-data source and is never cited on a ticker card. Play Billing remains deferred with v0.2.
