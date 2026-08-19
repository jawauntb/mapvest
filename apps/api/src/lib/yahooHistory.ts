/**
 * Compatibility import for the backtest and quote-history routes.
 * Provider selection now lives in @mapvest/finance; Yahoo remains available
 * only when MARKET_DATA_PROVIDER=yahoo or MARKET_DATA_FALLBACK_PROVIDER=yahoo.
 */
export { getHistoricalCloses, VALID_PERIODS } from "@mapvest/finance";
export type { HistoryPoint, Period } from "@mapvest/finance";
