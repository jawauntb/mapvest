type SaveSource = "camera" | "detail";

export type SaveContinuation = {
  ticker: string;
  name?: string;
  sector?: string;
  source: SaveSource;
};

type SearchParams = Record<string, string | string[] | undefined>;

const MAX_NAME_LENGTH = 160;
const MAX_SECTOR_LENGTH = 80;
const TICKER_RE = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function optionalText(value: string | string[] | undefined, maxLength: number): string | undefined {
  const text = first(value)?.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function normalizedTicker(value: string | string[] | undefined): string | undefined {
  const ticker = first(value)?.trim().toUpperCase();
  return ticker && TICKER_RE.test(ticker) ? ticker : undefined;
}

/** Build the only auth continuation this flow accepts: save one known ticker. */
export function authSavePath(continuation: SaveContinuation): string {
  const ticker = normalizedTicker(continuation.ticker);
  if (!ticker) throw new Error("A valid ticker is required to continue a save.");

  const params = new URLSearchParams({ intent: "save", ticker, source: continuation.source });
  if (continuation.name?.trim())
    params.set("name", continuation.name.trim().slice(0, MAX_NAME_LENGTH));
  if (continuation.sector?.trim()) {
    params.set("sector", continuation.sector.trim().slice(0, MAX_SECTOR_LENGTH));
  }
  return `/auth?${params.toString()}`;
}

/**
 * Reject malformed or unrelated query data rather than treating it as a
 * redirect. The post-auth destination is always derived from this ticker.
 */
export function parseSaveContinuation(params: SearchParams): SaveContinuation | null {
  if (first(params.intent) !== "save") return null;
  const ticker = normalizedTicker(params.ticker);
  const source = first(params.source);
  if (!ticker || (source !== "camera" && source !== "detail")) return null;

  return {
    ticker,
    source,
    name: optionalText(params.name, MAX_NAME_LENGTH),
    sector: optionalText(params.sector, MAX_SECTOR_LENGTH),
  };
}

/** Preserve the investable context without accepting an arbitrary return URL. */
export function saveContinuationDestination({ ticker }: SaveContinuation): string {
  return `/detail/${encodeURIComponent(ticker)}`;
}
