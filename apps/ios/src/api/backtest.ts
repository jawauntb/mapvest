import { type FetchOpts, apiFetch } from "./http";

/**
 * Client for POST /v1/backtest.
 *
 * Uses the shared `apiFetch` helper (bearer + X-Device-Id + JSON error
 * handling) rather than `./client.ts` so this feature ships without
 * expanding the main client surface.
 */

export type BacktestPeriod = "1mo" | "3mo" | "6mo" | "1y";

export type BacktestResponse = {
  period: BacktestPeriod;
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

export function fetchBacktest(
  args: { tickers: string[]; period?: BacktestPeriod },
  opts: FetchOpts = {},
): Promise<BacktestResponse> {
  return apiFetch<BacktestResponse>(
    "/v1/backtest",
    {
      method: "POST",
      body: JSON.stringify({
        tickers: args.tickers,
        period: args.period ?? "3mo",
      }),
    },
    opts,
  );
}
