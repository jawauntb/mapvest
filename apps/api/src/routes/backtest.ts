import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import {
  type HistoryPoint,
  type Period,
  VALID_PERIODS,
  getHistoricalCloses,
} from "../lib/yahooHistory.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/**
 * Watchlist backtest.
 *
 * POST /v1/backtest → for a set of tickers + period, computes what an
 * equal-weighted basket would have done vs SPY. This is not portfolio
 * accounting — no rebalancing, no dividends, just naive normalized closes.
 *
 * Daily closes come from the provider-routed `getHistoricalCloses` facade.
 * The assembled backtest
 * response is cached per (userId + ticker-set + period) for the same window.
 */

const RESULT_TTL_MS = 30 * 60 * 1000;
const SPARKLINE_POINTS = 20;

/** Nearest-index resample to a fixed length. Cheap enough for ~20 points. */
function resample(values: number[], targetLen: number): number[] {
  if (values.length === 0) return [];
  if (values.length <= targetLen) return values.slice();
  const out: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const idx = Math.floor((i * (values.length - 1)) / (targetLen - 1));
    const v = values[idx];
    if (typeof v === "number") out.push(v);
  }
  return out;
}

type BacktestResponse = {
  period: Period;
  totalReturn: number;
  benchmarkReturn: number;
  spread: number;
  best: { ticker: string; return: number };
  worst: { ticker: string; return: number };
  series: number[];
  benchmarkSeries: number[];
  omitted: string[];
  generatedAt: string;
};

const resultCache = new Map<string, { at: number; value: BacktestResponse }>();

const backtest = new Hono<AuthEnv>();
backtest.use("*", bearerAuth);

/** POST /v1/backtest  { tickers: string[]; period: '1mo'|'3mo'|'6mo'|'1y' } */
backtest.post("/", async (c) => {
  return safeExecuteWithSpan("http.backtest", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      tickers?: unknown;
      period?: unknown;
    };
    const rawTickers = Array.isArray(body.tickers) ? body.tickers : [];
    const tickers = [
      ...new Set(
        rawTickers
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().toUpperCase())
          .filter((t) => /^[A-Z][A-Z0-9.-]{0,7}$/.test(t)),
      ),
    ];
    if (tickers.length === 0) {
      return c.json({ error: "tickers required (non-empty array of symbols)" }, 400);
    }
    const period: Period = VALID_PERIODS.has(body.period as Period)
      ? (body.period as Period)
      : "3mo";

    const user = c.get("user");
    const cacheKey = `${user.id}::${[...tickers].sort().join(",")}::${period}`;
    const now = Date.now();
    const cached = resultCache.get(cacheKey);
    if (cached && now - cached.at < RESULT_TTL_MS) {
      span.setAttributes({
        user_id: user.id,
        cache_hit: true,
        tickers_count: tickers.length,
        period,
      });
      return c.json(cached.value);
    }

    // Parallel fetch. SPY runs alongside the basket — its failure must not
    // fail the response (see benchmark fallback below).
    const [portfolio, spy] = await Promise.all([
      Promise.all(
        tickers.map(async (t) => ({ ticker: t, history: await getHistoricalCloses(t, period) })),
      ),
      getHistoricalCloses("SPY", period).catch(() => null),
    ]);

    const usable = portfolio.filter(
      (p): p is { ticker: string; history: HistoryPoint[] } => !!p.history && p.history.length >= 2,
    );
    const omitted = portfolio
      .filter((p) => !p.history || p.history.length < 2)
      .map((p) => p.ticker);

    if (usable.length === 0) {
      span.setAttributes({
        user_id: user.id,
        tickers_count: tickers.length,
        omitted: omitted.length,
        period,
        error: "no_history",
      });
      return c.json({ error: "no price history for any ticker in this period", omitted }, 502);
    }

    // Tail-align every ticker's series to the length of the shortest so the
    // story stays "N months ago (or as far back as we have) → today". Each
    // ticker is re-normalized to 1.0 at its tail start so equal-weighting is
    // the arithmetic mean of ratios.
    const minLen = Math.min(...usable.map((u) => u.history.length));
    const aligned: { ticker: string; series: number[] }[] = usable.map((u) => {
      const tail = u.history.slice(-minLen).map((p) => p.close);
      const base = tail[0] ?? 1;
      const series = tail.map((c) => (base > 0 ? c / base : 1));
      return { ticker: u.ticker, series };
    });

    const portfolioSeries: number[] = [];
    for (let i = 0; i < minLen; i++) {
      let sum = 0;
      for (const a of aligned) sum += a.series[i] ?? 1;
      portfolioSeries.push(sum / aligned.length);
    }
    const totalReturn = (portfolioSeries[portfolioSeries.length - 1] ?? 1) - 1;

    // Best/worst are computed on the same tail window so contributor labels
    // match the sparkline the user sees, not each ticker's individual longer
    // history.
    const contributors = aligned.map((a) => ({
      ticker: a.ticker,
      return: (a.series[a.series.length - 1] ?? 1) - 1,
    }));
    const sorted = [...contributors].sort((x, y) => y.return - x.return);
    const best = sorted[0] ?? { ticker: aligned[0]?.ticker ?? "", return: 0 };
    const worst = sorted[sorted.length - 1] ?? best;

    // SPY benchmark, tail-aligned to same window. On failure fall back to a
    // flat 1.0 series so `spread === totalReturn`.
    let benchmarkReturn = 0;
    let benchmarkSeries: number[];
    if (spy && spy.length >= 2) {
      const spyTail = spy.slice(-minLen).map((p) => p.close);
      if (spyTail.length >= 2) {
        const base = spyTail[0] ?? 1;
        benchmarkSeries = spyTail.map((c) => (base > 0 ? c / base : 1));
        benchmarkReturn = (benchmarkSeries[benchmarkSeries.length - 1] ?? 1) - 1;
      } else {
        benchmarkSeries = portfolioSeries.map(() => 1);
      }
    } else {
      benchmarkSeries = portfolioSeries.map(() => 1);
    }
    const spread = totalReturn - benchmarkReturn;

    const response: BacktestResponse = {
      period,
      totalReturn,
      benchmarkReturn,
      spread,
      best,
      worst,
      series: resample(portfolioSeries, SPARKLINE_POINTS),
      benchmarkSeries: resample(benchmarkSeries, SPARKLINE_POINTS),
      omitted,
      generatedAt: new Date().toISOString(),
    };
    resultCache.set(cacheKey, { at: now, value: response });

    span.setAttributes({
      user_id: user.id,
      tickers_count: tickers.length,
      usable: usable.length,
      omitted: omitted.length,
      period,
      total_return: Math.round(totalReturn * 10000) / 10000,
      benchmark_return: Math.round(benchmarkReturn * 10000) / 10000,
      benchmark_ok: !!spy,
    });
    return c.json(response);
  });
});

export default backtest;
