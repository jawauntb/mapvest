# Market-data migration

This document records the Mapvest market-data audit and the compatibility
boundary for the Massive migration. The migration is intentionally limited to
this repository; the derivation-research and underlying-analyzer services remain
independent sibling deployments.

## Current flow inventory

| Existing flow | Public surface / consumer | Old upstream path | New owner | Compatibility status |
| --- | --- | --- | --- | --- |
| Single quote | `GET /v1/quote`; identify, ticker resolution, alerts, widgets, watchlists | Yahoo chart endpoint through `packages/finance/src/quote.ts` | Massive stock snapshot; Yahoo only by explicit routing | Stable response fields; `provider` and `freshness` are optional |
| Daily closes | `GET /v1/quote-history`; native iOS price chart; backtest helpers | Yahoo chart history and the `yahooHistory` facade | Massive daily aggregates; Yahoo only by explicit routing | Stable `{points}` and period aliases; thin/missing data remains `502` at the API |
| Ticker validation | `resolveTicker` and identify | Quote probe via Yahoo | Routed quote probe | Same resolver behavior and source citation shape |
| News | `GET /v1/news` | Yahoo RSS, optionally Finnhub | Massive reference news; explicit Yahoo/Finnhub fallback | Existing news item shape and best-effort empty result retained |
| Options link-out | `GET /v1/options?ticker=`; iOS detail sheet | Independent derivation-research link-out | Still the sibling link-out | Unchanged; no sibling code is duplicated |
| Options data | No prior first-party market-data endpoint | Sibling derivation research only | Additive Massive chain, contracts, snapshots, expirations | New endpoints; legacy link-out is unchanged |
| Aggregates | Analyzer/sibling integrations and internal history needs | Yahoo chart-shaped daily data | Additive Massive aggregate endpoint | New endpoint; no old route renamed |
| Corporate events | No stable Mapvest endpoint | Scattered provider assumptions | Additive Massive splits/dividends/events route | New endpoint; subscription/partner access is reported |

### Explicit legacy audit

The repository audit found no executable ThetaData client, import, environment
variable, or HTTP endpoint. It also found no Python `yfinance` runtime: the old
Mapvest path was direct Yahoo chart HTTP in `packages/finance/src/quote.ts` and
`apps/api/src/lib/yahooHistory.ts`, plus Yahoo RSS for news. The remaining
`yfinance` wording belongs to the sibling underlying-analyzer period alias
documentation; that service is outside this migration and was not changed.

## Provider boundary

`packages/finance/src/marketData/types.ts` defines the provider interface.
`massive.ts` implements the Massive REST adapter, `yahoo.ts` contains the
legacy quote/history adapter, and `router.ts` owns provider selection and the
explicit fallback policy. API routes consume the interface and core schemas;
they do not call either provider directly.

The default is `MARKET_DATA_PROVIDER=massive`. Set
`MARKET_DATA_PROVIDER=yahoo` only for an intentional legacy run, or set
`MARKET_DATA_FALLBACK_PROVIDER=yahoo` to allow quote/history fallback while
parity is being proven. The fallback is not used for options, aggregates, or
corporate events merely because those datasets are unavailable from Massive.

## Massive mapping

| Capability | Massive REST family | Mapvest use |
| --- | --- | --- |
| Stock quote / snapshot | `/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` | Existing quote facade and identify probes |
| Historical/intraday aggregates | `/v2/aggs/ticker/{ticker}/range/...` | History facade and additive aggregates endpoint |
| Options chain / snapshot | `/v3/snapshot/options/{underlying}` | Additive `/v1/options/chain` |
| Contracts / expirations | `/v3/reference/options/contracts` | Additive contracts endpoint with cursor and expiration filters |
| Single option contract | `/v3/reference/options/contracts/{ticker}` | Additive contract detail endpoint |
| Splits and dividends | `/stocks/v1/splits`, `/stocks/v1/dividends` | Additive `/v1/market-events` |
| Market news | `/v2/reference/news` | Existing `/v1/news` normalized into its stable response |

The adapter preserves upstream timestamps as ISO strings in the existing
responses and uses Unix seconds for history/aggregate points, matching the
current iOS chart contract. Massive request IDs and provider errors are kept in
the internal error type and mapped to the existing `429`, `502`, and `503`
behavior at the API boundary.

## Freshness, subscription assumptions, and gaps

The repository cannot verify the purchased Massive account from this checkout:
the available Doppler token does not currently have access to the `mapvest`
project. Deployment must populate `MASSIVE_API_KEY` and the plan/freshness
metadata from the account before claiming real-time or options coverage.

Massive plan capabilities vary. Stocks may be end-of-day, delayed, or real-time;
options quotes/Greeks and historical depth likewise depend on the purchased
options entitlement. The API therefore reports `freshness`, configured plan
labels, and per-dataset `access` at `/v1/market-data/capabilities`. An unset
label means “unverified,” not “real-time.”

REST snapshots and aggregates are implemented here. Massive WebSocket streaming
is not proxied through Mapvest yet; realtime UI streaming remains a follow-up,
so the current API must not promise tick-by-tick delivery. Corporate events are
implemented for splits/dividends; broader partner event feeds require explicit
account enablement and `MASSIVE_CORPORATE_EVENTS_ENABLED=1`.

## Verification checklist

Before enabling the primary route in a deployment:

1. Confirm the account has the required stocks, options, aggregates, contracts,
   news, and event entitlements.
2. Set `MASSIVE_*` values in personal Doppler only and run the capabilities
   endpoint through `doppler run`.
3. Run the fixture parity tests and targeted endpoint tests in this repository.
4. Compare sampled quotes/history/options against the current fallback during a
   staged window, then remove the fallback when parity is proven.
