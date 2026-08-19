import {
  getHistoricalCloses as routedGetHistoricalCloses,
  getHistoricalClosesWithProvider as routedGetHistoricalClosesWithProvider,
} from "./marketData/router.js";
export type { HistoryPoint } from "./marketData/types.js";

export type Period = "1mo" | "3mo" | "6mo" | "1y";
export const VALID_PERIODS = new Set<Period>(["1mo", "3mo", "6mo", "1y"]);

export async function getHistoricalCloses(symbol: string, period: Period) {
  try {
    return await routedGetHistoricalCloses(symbol, period);
  } catch {
    // Existing quote-history and backtest callers treat missing history as a
    // normal omission and must retain their 502/flat-benchmark behavior.
    return null;
  }
}

export async function getHistoricalClosesWithProvider(symbol: string, period: Period) {
  try {
    return await routedGetHistoricalClosesWithProvider(symbol, period);
  } catch {
    return null;
  }
}
