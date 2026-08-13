/**
 * Yahoo Finance daily history (v7 chart). Shared by backtest and
 * GET /v1/quote-history. In-process cache, 30 min TTL. Prefers adjclose.
 * Never invents prices — returns null on any failure or thin series.
 */

export type Period = "1mo" | "3mo" | "6mo" | "1y";
export const VALID_PERIODS = new Set<Period>(["1mo", "3mo", "6mo", "1y"]);

const YAHOO_CHART_BASE = "https://query1.finance.yahoo.com/v7/finance/chart";
const HISTORY_TTL_MS = 30 * 60 * 1000;
const HISTORY_TIMEOUT_MS = 5_000;

export type HistoryPoint = { ts: number; close: number };
type HistoryCacheEntry = { at: number; value: HistoryPoint[] | null };
const historyCache = new Map<string, HistoryCacheEntry>();

type YahooHistoryResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    } | null> | null;
    error?: unknown;
  };
};

/**
 * Fetch daily closes for a symbol over a Yahoo `range` window. Returns null
 * on any failure — this is best-effort and must never throw so a single
 * flaky ticker doesn't blow up the whole basket.
 */
export async function getHistoricalCloses(
  symbol: string,
  period: Period,
): Promise<HistoryPoint[] | null> {
  const key = `${symbol}::${period}`;
  const now = Date.now();
  const cached = historyCache.get(key);
  if (cached && now - cached.at < HISTORY_TTL_MS) return cached.value;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HISTORY_TIMEOUT_MS);
  try {
    const url = `${YAHOO_CHART_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=${period}`;
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "user-agent": "mapvest/0.1 (+https://mapvest.app)" },
    });
    if (!res.ok) {
      historyCache.set(key, { at: now, value: null });
      return null;
    }
    const json = (await res.json()) as YahooHistoryResponse;
    const result = json?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    // Prefer adjclose so dividends/splits don't distort return math; fall back
    // to raw close when adjclose is missing (thinly-traded / recent IPOs).
    const adjcloses = result?.indicators?.adjclose?.[0]?.adjclose;
    const rawcloses = result?.indicators?.quote?.[0]?.close;
    const closes = adjcloses ?? rawcloses;
    if (!timestamps || !closes || timestamps.length === 0 || closes.length === 0) {
      historyCache.set(key, { at: now, value: null });
      return null;
    }
    const points: HistoryPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      const ts = timestamps[i];
      if (typeof c === "number" && Number.isFinite(c) && c > 0 && typeof ts === "number") {
        points.push({ ts, close: c });
      }
    }
    if (points.length < 2) {
      historyCache.set(key, { at: now, value: null });
      return null;
    }
    historyCache.set(key, { at: now, value: points });
    return points;
  } catch {
    historyCache.set(key, { at: now, value: null });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
