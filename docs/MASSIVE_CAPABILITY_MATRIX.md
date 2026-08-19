# Massive capability matrix

This is the verified capability audit for the Mapvest account after the
Options Developer, Stocks Advanced, Financials & Ratios, and TMX Corporate
Events upgrades. The audit ran on 2026-08-19 against `shared/prd` without
printing or persisting credential values.

## Verified live access

Each row below returned HTTP 200 and usable response data for an AAPL probe.
The stock snapshot response is an object-shaped snapshot, so it is usable even
though it has no `results[]` array.

| Dataset | Massive endpoint | Current Mapvest use | Status |
| --- | --- | --- | --- |
| Stock snapshot | `/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` | `/v1/quote`, identify, map/list/watchlist quotes | Already consumed; add NBBO fields to the stable quote DTO |
| Stock news | `/v2/reference/news` | `/v1/news`, web/iOS ticker news | Already consumed |
| Stock NBBO | `/v2/last/nbbo/{ticker}` | Not directly exposed | Additive quote-liquidity fields / diagnostics |
| Stock trades | `/v3/trades/{ticker}` | Not directly exposed | Additive trades endpoint for research and auditability |
| SMA | `/v1/indicators/sma/{ticker}` | Not consumed | Additive technical-indicator endpoint |
| Financial ratios | `/stocks/financials/v1/ratios` | Not consumed | Highest-value immediate addition for Investable pages |
| Income statements | `/stocks/financials/v1/income-statements` | Not consumed in Mapvest | Additive financials surface |
| Balance sheets | `/stocks/financials/v1/balance-sheets` | Not consumed in Mapvest | Additive financials surface |
| Cash-flow statements | `/stocks/financials/v1/cash-flow-statements` | Not consumed in Mapvest | Additive financials surface |
| Option contracts | `/v3/reference/options/contracts` | `/v1/options/contracts*` | Already consumed |
| Option chain | `/v3/snapshot/options/{underlying}` | `/v1/options/chain` | Already consumed; now usable with the upgraded account |
| Option contract bars | `/v2/aggs/ticker/{optionsTicker}/range/...` | Generic aggregates only | Additive options analytics surface |
| Option summary | `/v3/snapshot/options/{underlying}/{optionsTicker}` | Not consumed | Additive contract-level Greeks/IV/open-interest surface |
| TMX events | `/tmx/v1/corporate-events` | `/v1/market-events` when enabled | Already implemented; enable the purchased partner feed |

## Subscription and freshness limits

- Options Developer covers contract reference, chain snapshots, and custom
  option aggregate bars according to the [official Options overview](https://massive.com/docs/rest/options/overview).
- Stocks Advanced covers the advanced stock market-data and fundamentals
  surface. Financial ratios are daily/end-of-day data, not realtime data, as
  documented by [Massive’s ratios endpoint](https://massive.com/docs/rest/stocks/fundamentals/ratios).
- TMX Corporate Events is a separate partner dataset. It is a global event
  calendar updated every two hours, not a tick stream. See the [TMX endpoint
  documentation](https://massive.com/docs/rest/partners/tmx/corporate-events).
- REST snapshots are request/response data. Mapvest does not proxy Massive
  WebSocket streams yet, so current clients must not display a tick-by-tick
  guarantee.
- Live HTTP 200 responses confirm this account can reach the endpoints. They do
  not establish an exchange-by-exchange SLA, historical retention promise, or
  realtime entitlement beyond the provider’s account terms.

## Delivery priority

1. Ship financial ratios and statement summaries into the web and iOS ticker
   detail surfaces.
2. Ship option contract summary/chain visibility with Greeks, IV, open
   interest, bid/ask, and expiration filters.
3. Enable TMX in production and keep the existing Yahoo/Massive headline feed
   in the same catalysts panel.
4. Add stock NBBO/trades and SMA as additive research endpoints after the first
   release is stable.

## Ownership boundary

Massive can replace Robinhood for market-data reads. Robinhood remains the
optional account, holdings, authentication, and order integration. The
derivation-research and underlying-analyzer sibling services are not modified
by this capability pass.
