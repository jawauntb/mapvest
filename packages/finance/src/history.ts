import {
  type HistoryInterval,
  type HistoryPeriod,
  applyLiveClose,
  normalizeHistoryInterval,
} from "./marketData/historyIntervals.js";
import {
  getHistoricalCloses as routedGetHistoricalCloses,
  getHistoricalClosesWithProvider as routedGetHistoricalClosesWithProvider,
  getQuote as routedGetQuote,
} from "./marketData/router.js";
export type { HistoryPoint } from "./marketData/types.js";
export type { HistoryInterval, HistoryPeriod } from "./marketData/historyIntervals.js";
export {
  VALID_HISTORY_PERIODS,
  VALID_INTERVALS,
  DEFAULT_PERIOD_FOR_INTERVAL,
  clampPeriodForInterval,
  normalizeHistoryInterval,
} from "./marketData/historyIntervals.js";

export type Period = Extract<HistoryPeriod, "1mo" | "3mo" | "6mo" | "1y">;
export const VALID_PERIODS = new Set<Period>(["1mo", "3mo", "6mo", "1y"]);

export async function getHistoricalCloses(
  symbol: string,
  period: HistoryPeriod,
  interval: HistoryInterval | string = "1d",
) {
  try {
    const resolved = normalizeHistoryInterval(interval);
    const points = await routedGetHistoricalCloses(symbol, period, resolved);
    if (!points) return null;
    return applyLiveClose(points, await routedGetQuote(symbol).catch(() => null), resolved);
  } catch {
    // Existing quote-history and backtest callers treat missing history as a
    // normal omission and must retain their 502/flat-benchmark behavior.
    return null;
  }
}

export async function getHistoricalClosesWithProvider(
  symbol: string,
  period: HistoryPeriod,
  interval: HistoryInterval | string = "1d",
) {
  try {
    const resolved = normalizeHistoryInterval(interval);
    const result = await routedGetHistoricalClosesWithProvider(symbol, period, resolved);
    if (!result?.value) return result;
    return {
      ...result,
      value: applyLiveClose(result.value, await routedGetQuote(symbol).catch(() => null), resolved),
    };
  } catch {
    return null;
  }
}
