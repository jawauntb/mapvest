# Data sources

Mapvest never claims a ticker without a source. This doc lists every provider we use and what they’re for.

## Primary

| Provider | Purpose | Key |
| --- | --- | --- |
| **OpenRouter** | Multimodal LLM (image → brand + text extraction). Prefer `google/gemini-2.5-pro`, fall back to `anthropic/claude-5-sonnet` or `openai/gpt-4o` per cost/latency budget. | `OPENROUTER_API_KEY` (Doppler `cofounder/dev`) |
| **Gemini (direct)** | Fallback multimodal if OpenRouter degrades. | `GEMINI_API_KEY` |
| **Exa** | Open-web search for ticker discovery, parent-company lookup, ETF constituent lookup. | `EXA_API_KEY` |
| **Google Places** | Nearby POI enumeration for the map view. | `GOOGLE_MAPS_API_KEY` |

## Secondary / free-tier

| Provider | Purpose | Notes |
| --- | --- | --- |
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

- `~/option_derivation` — options-chain derivation. Deferred to v0.2; expose via `/v1/options?ticker=…` proxy.
- `~/The Underlying Analyzer Reboot` — private-company sector proxies. Same v0.2 plan; borrow the sector-mapping tables.

## What we do NOT use

- Paid market-data feeds (Polygon paid tier, IEX Cloud paid tier) — not until unit economics justify.
- Any user-content scraper. If we need training data, it comes from provider APIs, not scraping.
