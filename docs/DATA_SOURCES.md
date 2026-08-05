# Data sources

Mapvest never claims a ticker without a source. This doc lists every provider we use and what they’re for.

## Primary

| Provider | Purpose | Key |
| --- | --- | --- |
| **OpenRouter** | Multimodal LLM (image → brand) + comparable-judge step. Prefer `google/gemini-2.5-pro`, fall back to `anthropic/claude-sonnet-5` then `openai/gpt-4o`. | `OPENROUTER_API_KEY` (Doppler `cofounder/dev`) |
| **Gemini (direct)** | Fallback multimodal if OpenRouter degrades. | `GEMINI_API_KEY` |
| **Exa** | Open-web search for ticker discovery, parent-company lookup, ETF constituent lookup. | `EXA_API_KEY` |
| **Google Places** | Nearby POI enumeration for the map view (primary). Multi-type queries (`restaurant`, `cafe`, `store`, `bank`, …) merged + de-noised (no hospitals/doctors/parks). | `GOOGLE_MAPS_API_KEY` (Doppler; billed GCP project `steady-force-468319-u7`) |

## Secondary / free-tier

| Provider | Purpose | Notes |
| --- | --- | --- |
| **OpenStreetMap Overpass** | Nearby POI fallback when Google Places is denied/unavailable. Mirrors are raced in parallel; prefer `overpass.openstreetmap.fr`. | No key. Cite as OSM/Overpass. |
| **Photon (Komoot)** | Last-resort nearby brand search if every Overpass mirror fails. | No key. Shortlist of common public brands only. |
| **SEC EDGAR** | Parent-company resolution, subsidiary lookup, 10-K brand mentions. | No key, please rate-limit. |
| **Yahoo Finance** (via `yfinance` server-side) | Realtime quote for a resolved ticker. | Best-effort, do not display live price without a disclaimer. |
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
| **Derivation Research Console** | Multi-tool LLM research briefs (idea-chats). Tools (Yahoo, Exa, SEC, options research, etc.) run server-side. Factory / Experiments / Jobs UI stays operator-only — not exposed in Mapvest. Call the Railway origin with Cloudflare front-door host attestation (`x-research-console-forwarded-host` + `RESEARCH_CONSOLE_SERVICE_TOKEN_READ` / `_MUTATE`); bare Railway hosts return `403 REQUEST_HOST_INVALID`. | `DERIVATION_URL` (Railway). Mapvest: `POST /v1/agent/chat`, `GET /v1/agent/threads`, `GET /v1/agent/threads/:id`. Product IA: agent overview on ticker detail, Research tab + Research… sheet, Saved → Briefs. Broker orders permanently off. | jawauntb (sibling service) |

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
3. **OpenRouter agent** (`anthropic/claude-sonnet-5`) judges the evidence and picks ≤3 real listed tickers with reasoning + source URL.

Random ALLCAPS tokens in titles (e.g. `NYP`, `MOUNT`, `MSHS` for nonprofits) are rejected — see `packages/finance/src/tickerSymbol.ts`.

## What we do NOT use

- Paid market-data feeds (Polygon paid tier, IEX Cloud paid tier) — not until unit economics justify.
- Any user-content scraper. If we need training data, it comes from provider APIs, not scraping.
- Fabricated tickers from abbreviations or GuideStar / 401k plan names.
