/**
 * Client for /v1/market-events — corporate events (splits, dividends, and the
 * TMX partner dataset) for a single ticker. Feature-scoped: uses the shared
 * `apiFetch` helper from `./http.ts` rather than the legacy `./client.ts`
 * surface, matching the pattern established for alerts / news / backtest /
 * local-brief clients.
 *
 * Shapes mirror `CorporateEvent` / `MarketEventsResponse` in
 * packages/core/src/schemas/index.ts — keep them in lockstep.
 *
 * Degradation contract: the route answers 503 when the market-data provider
 * is unconfigured and 502 when the provider errors, so callers MUST treat a
 * rejected fetch as "no catalysts to show", never as a broken screen. TMX is a
 * separately subscribed dataset; when it is unavailable the response still
 * carries the splits/dividends events with `tmxAvailable: false`.
 */
import type { FetchOpts } from "./http";
import { apiFetch } from "./http";
import type { Source } from "./types";

export type MarketEventProvider = "massive" | "tmx";

export type MarketEvent = {
  id?: string;
  ticker: string;
  /** Raw provider type, e.g. "dividend", "stock_split", "annual_meeting". */
  type: string;
  /** Usually a `YYYY-MM-DD` day, occasionally a full ISO timestamp. May be absent. */
  date?: string;
  status?: string;
  description?: string;
  sourceUrl?: string;
  provider?: MarketEventProvider;
  companyName?: string;
  isin?: string;
  tradingVenue?: string;
  tmxRecordId?: string;
};

export type MarketEventsResponse = {
  ticker?: string;
  events: MarketEvent[];
  /** False/absent when the TMX partner feed is off or errored — not an error. */
  tmxAvailable?: boolean;
  sources: Source[];
};

/**
 * Fetch recent corporate events for `ticker`, newest first (the API sorts by
 * date descending before truncating to `limit`).
 */
export function fetchMarketEvents(
  ticker: string,
  opts: FetchOpts & { limit?: number } = {},
): Promise<MarketEventsResponse> {
  const qs = new URLSearchParams({ ticker: ticker.trim().toUpperCase() });
  const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : 8;
  qs.set("limit", String(Math.min(500, Math.floor(limit))));
  return apiFetch<MarketEventsResponse>(
    `/v1/market-events?${qs.toString()}`,
    { method: "GET" },
    { token: opts.token, signal: opts.signal },
  );
}
