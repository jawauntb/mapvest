/**
 * FRED (Federal Reserve Bank of St. Louis) macro series — the environment layer
 * of the company graph (Universe Roadmap §3 C4).
 *
 * Free public API, gated on `FRED_API_KEY` exactly like `EXA_API_KEY` in
 * `packages/search`: no key, no data — we never synthesize a macro observation.
 *
 * Scope is deliberately narrow. This is not a `MarketDataProvider`: FRED serves
 * economic time series, not quotes/aggregates/options, so it is not routed
 * through `router.ts`'s primary/fallback machinery. Callers ask for a series id
 * and get back the observations that actually came off the wire.
 *
 * Env: `FRED_API_KEY` (Doppler). `FRED_BASE_URL` is a non-secret override used
 * by offline tests only.
 */

const DEFAULT_BASE_URL = "https://api.stlouisfed.org/fred";
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 1_000;

/** One FRED observation. `value` is always finite — missing points are dropped. */
export type FredObservation = {
  /** Observation date, `YYYY-MM-DD`. */
  date: string;
  value: number;
};

/** A macro series recommended for a sector, with the label the brief renders. */
export type FredSeriesRef = {
  /** FRED series id, e.g. `"DFF"`. */
  id: string;
  label: string;
  unit?: string;
};

export type FredSeriesQuery = {
  /** Max observations, newest first. Defaults to 24. */
  limit?: number;
  /** Inclusive lower bound on observation date, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive upper bound on observation date, `YYYY-MM-DD`. */
  to?: string;
};

function fredApiKey(): string {
  const key = process.env.FRED_API_KEY?.trim();
  if (!key) throw new Error("FRED_API_KEY missing (Doppler)");
  return key;
}

function fredBaseUrl(): string {
  return (process.env.FRED_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
}

/** True when the FRED layer can run at all. Callers degrade rather than guess. */
export function fredConfigured(): boolean {
  return Boolean(process.env.FRED_API_KEY?.trim());
}

/**
 * Public, key-free landing page for a series — safe to hand to a client as the
 * human-readable provenance of an observation.
 */
export function fredSeriesUrl(seriesId: string): string {
  return `https://fred.stlouisfed.org/series/${encodeURIComponent(seriesId.trim().toUpperCase())}`;
}

type FredObservationsResponse = {
  observations?: Array<{ date?: unknown; value?: unknown }>;
  error_message?: string;
};

/**
 * Observations for one FRED series, **newest first**.
 *
 * FRED encodes a missing observation as the string `"."` — those rows are
 * dropped rather than coerced to 0, so a caller can never mistake "no data" for
 * "zero". A non-2xx response or an unparseable body throws.
 */
export async function getSeries(
  seriesId: string,
  query: FredSeriesQuery = {},
): Promise<FredObservation[]> {
  const id = seriesId.trim().toUpperCase();
  if (!id) return [];
  const url = new URL(`${fredBaseUrl()}/series/observations`);
  url.searchParams.set("series_id", id);
  url.searchParams.set("api_key", fredApiKey());
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set(
    "limit",
    String(Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)),
  );
  if (query.from) url.searchParams.set("observation_start", query.from);
  if (query.to) url.searchParams.set("observation_end", query.to);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as FredObservationsResponse;
    throw new Error(
      `FRED ${id} ${res.status}${body.error_message ? `: ${body.error_message}` : ""}`,
    );
  }
  const json = (await res.json()) as FredObservationsResponse;
  const rows = Array.isArray(json.observations) ? json.observations : [];
  const out: FredObservation[] = [];
  for (const row of rows) {
    const date = typeof row?.date === "string" ? row.date.trim() : "";
    if (!date) continue;
    // FRED sends every value as a string; "." means the observation is missing.
    const raw = typeof row?.value === "string" ? row.value.trim() : row?.value;
    if (raw === "." || raw === "" || raw === undefined || raw === null) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

/**
 * Series every sector brief carries: the policy rate and headline inflation.
 * These are the two fields every company in every sector sits inside.
 */
const BASE_SERIES: FredSeriesRef[] = [
  { id: "DFF", label: "Federal funds effective rate", unit: "percent" },
  { id: "CPIAUCSL", label: "CPI, all urban consumers (all items)", unit: "index 1982-84=100" },
];

/**
 * Sector-flavored series, keyed by canonical GICS sector (see
 * `packages/finance/src/etf-map.ts`). Only sectors with an obviously
 * representative published series get an extra — Communication Services has no
 * uncontroversial single indicator, so it carries the base pair alone rather
 * than a stretched proxy.
 */
const SECTOR_SERIES: Record<string, FredSeriesRef> = {
  "Information Technology": {
    id: "IPG3344S",
    label: "Industrial production: semiconductors and electronic components",
    unit: "index 2017=100",
  },
  "Consumer Discretionary": {
    id: "UMCSENT",
    label: "University of Michigan consumer sentiment",
    unit: "index 1966Q1=100",
  },
  "Consumer Staples": {
    id: "CPIUFDSL",
    label: "CPI: food",
    unit: "index 1982-84=100",
  },
  Energy: {
    id: "DCOILWTICO",
    label: "Crude oil price, West Texas Intermediate",
    unit: "USD per barrel",
  },
  Financials: {
    id: "T10Y2Y",
    label: "10-year minus 2-year Treasury spread",
    unit: "percent",
  },
  "Health Care": {
    id: "CPIMEDSL",
    label: "CPI: medical care",
    unit: "index 1982-84=100",
  },
  Industrials: {
    id: "INDPRO",
    label: "Industrial production: total index",
    unit: "index 2017=100",
  },
  Materials: {
    id: "PPIACO",
    label: "Producer price index: all commodities",
    unit: "index 1982=100",
  },
  "Real Estate": {
    id: "MORTGAGE30US",
    label: "30-year fixed mortgage average",
    unit: "percent",
  },
  Utilities: {
    id: "CPIENGSL",
    label: "CPI: energy",
    unit: "index 1982-84=100",
  },
};

/**
 * The 2-3 series an environment brief should carry for `sector`: always the
 * rate + inflation base pair, plus the sector's own indicator when one exists.
 * Expects the canonical GICS sector name; an unrecognized label yields the base
 * pair rather than an error, so a brief still gets its macro floor.
 */
export function sectorSeries(sector: string | undefined | null): FredSeriesRef[] {
  const extra = sector ? SECTOR_SERIES[sector.trim()] : undefined;
  return extra ? [...BASE_SERIES, extra] : [...BASE_SERIES];
}
