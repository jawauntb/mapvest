import { API_URL } from "@/util/env";
import type {
  IdentifyResponse,
  NearbyResponse,
  ResolveComparableResponse,
  Session,
  User,
  LatLng,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type FetchOpts = {
  token?: string;
  signal?: AbortSignal;
};

async function jsonFetch<T>(
  path: string,
  init: RequestInit,
  opts: FetchOpts = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as T;
}

// -------- auth --------

export function requestMagicLink(
  email: string,
): Promise<{ sent: true; devCode?: string }> {
  // v0.1: no SMTP wired, so the API returns { devCode } inline when
  // AUTH_RETURN_CODE=1. The auth screen surfaces it for demo submissions.
  return jsonFetch("/v1/auth/session", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyMagicLink(
  email: string,
  code: string,
): Promise<{ session: Session; user: User }> {
  return jsonFetch("/v1/auth/session/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export function getMe(token: string): Promise<{ user: User }> {
  return jsonFetch("/v1/auth/me", { method: "GET" }, { token });
}

// -------- nearby / identify / resolve --------

export function fetchNearby(
  args: { lat: number; lng: number; radius?: number; limit?: number },
  opts: FetchOpts = {},
): Promise<NearbyResponse> {
  const params = new URLSearchParams({
    lat: String(args.lat),
    lng: String(args.lng),
    radius: String(args.radius ?? 500),
    limit: String(args.limit ?? 25),
  });
  return jsonFetch(`/v1/nearby?${params.toString()}`, { method: "GET" }, opts);
}

/**
 * POST a captured photo to /v1/identify. `imageUri` is a local file:// URI
 * from expo-camera. We upload as multipart/form-data.
 */
export async function identifyPhoto(
  args: { imageUri: string; location?: LatLng },
  opts: FetchOpts = {},
): Promise<IdentifyResponse> {
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } as the file value.
  form.append("image", {
    // biome-ignore lint/suspicious/noExplicitAny: RN FormData file value shape
    uri: args.imageUri,
    name: "capture.jpg",
    type: "image/jpeg",
    // biome-ignore lint/suspicious/noExplicitAny: same
  } as any);
  if (args.location) {
    form.append("location", JSON.stringify(args.location));
  }
  const headers = new Headers();
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  headers.set("Accept", "application/json");
  // Let fetch set the multipart boundary itself; do NOT set Content-Type.

  const res = await fetch(`${API_URL}/v1/identify`, {
    method: "POST",
    body: form,
    headers,
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }
  return (await res.json()) as IdentifyResponse;
}

export function resolveComparable(
  args: { brand: string; hintSector?: string },
  opts: FetchOpts = {},
): Promise<ResolveComparableResponse> {
  return jsonFetch(
    "/v1/resolve-comparable",
    { method: "POST", body: JSON.stringify(args) },
    opts,
  );
}

// -------- memo + watchlist --------

export type WatchEntry = {
  ticker: string;
  name?: string;
  sector?: string;
  source: "camera" | "map" | "list" | "manual" | "detail";
  memo?: string;
  memoProvider?: string;
  createdAt: string;
};

export function generateMemo(
  ticker: string,
  opts: FetchOpts = {},
): Promise<{ ticker: string; provider: string; memo: string }> {
  return jsonFetch(
    "/v1/memo",
    { method: "POST", body: JSON.stringify({ ticker }) },
    opts,
  );
}

export type Quote = {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  currency: string;
  ts: string;
  disclaimer: string;
};

export function fetchQuote(
  symbol: string,
  opts: FetchOpts = {},
): Promise<{ quote?: Quote; error?: string }> {
  return jsonFetch(
    `/v1/quote?symbol=${encodeURIComponent(symbol)}`,
    { method: "GET" },
    opts,
  );
}

/** Best-effort parallel quotes for list/saved rows (cap 10). */
export async function fetchQuotesMap(
  symbols: string[],
  opts: FetchOpts = {},
): Promise<Record<string, Quote>> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 10);
  const entries = await Promise.all(
    uniq.map(async (sym) => {
      try {
        const r = await fetchQuote(sym, opts);
        return r.quote ? ([sym, r.quote] as const) : null;
      } catch {
        return null;
      }
    }),
  );
  const out: Record<string, Quote> = {};
  for (const e of entries) {
    if (e) out[e[0]] = e[1];
  }
  return out;
}

export type ChartImage = {
  ticker: string;
  type?: string;
  period: string;
  image: { mime: string; data: string; filename?: string };
  levels?: { poc?: number; vah?: number; val?: number };
  provider?: string;
  sourceUrl?: string;
};

/** @deprecated alias */
export type AuctionChart = ChartImage;

/** Chart PNG via Underlying Analyzer proxy. Default period 1mo. */
export function fetchChart(
  type: string,
  ticker: string,
  period = "1mo",
  opts: FetchOpts = {},
): Promise<ChartImage> {
  const qs = new URLSearchParams({ ticker, period });
  return jsonFetch(
    `/v1/chart/${encodeURIComponent(type)}?${qs.toString()}`,
    { method: "GET" },
    opts,
  );
}

export function fetchAuctionChart(
  ticker: string,
  period = "1mo",
  opts: FetchOpts = {},
): Promise<ChartImage> {
  return fetchChart("auction", ticker, period, opts);
}

export type AnalysisSnapshot = {
  ticker: string;
  name?: string;
  sector?: string;
  industry?: string;
  price?: number;
  annualVolatility?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  trailingPe?: string | number;
  marketCap?: string | number;
  brief?: string;
  briefProvider?: string;
};

export function fetchAnalysis(ticker: string, opts: FetchOpts = {}): Promise<AnalysisSnapshot> {
  return jsonFetch(`/v1/analysis/${encodeURIComponent(ticker)}`, { method: "GET" }, opts);
}

export type CockpitRow = {
  rank?: number;
  ticker: string;
  score?: number;
  lane?: string;
  ridge?: string | number;
  flow?: string | number;
  auction?: string | number;
};

export function fetchCockpit(
  tickers: string[],
  opts: FetchOpts = {},
): Promise<{ rows: CockpitRow[]; tickers: string[] }> {
  return jsonFetch(
    "/v1/cockpit",
    { method: "POST", body: JSON.stringify({ tickers: tickers.slice(0, 10) }) },
    opts,
  );
}

export type AlertItem = {
  ticker?: string;
  title?: string;
  severity?: string | number;
  summary?: string;
  message?: string;
};

export function fetchAlerts(
  tickers: string[],
  opts: FetchOpts = {},
): Promise<{ alerts: AlertItem[]; tickers: string[] }> {
  return jsonFetch(
    "/v1/alerts",
    { method: "POST", body: JSON.stringify({ tickers: tickers.slice(0, 10) }) },
    opts,
  );
}

export type ResearchArticle = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  interesting: string[];
  ideas: Array<{ title: string; thesis: string; disposition?: string }>;
  toolsUsed: string[];
  sources: Array<{ label: string; url?: string }>;
  chartTickers: string[];
};

export type AgentThread = {
  id: string;
  title: string;
  preview: string;
  messages?: ResearchArticle[];
};

export function listAgentThreads(opts: FetchOpts = {}) {
  return jsonFetch<{ threads: AgentThread[]; count: number }>(
    "/v1/agent/threads",
    { method: "GET" },
    opts,
  );
}

export function getAgentThread(id: string, opts: FetchOpts = {}) {
  return jsonFetch<{ thread: AgentThread }>(
    `/v1/agent/threads/${encodeURIComponent(id)}`,
    { method: "GET" },
    opts,
  );
}

export function agentChat(
  message: string,
  args: { ticker?: string; threadId?: string } = {},
  opts: FetchOpts = {},
) {
  return jsonFetch<{
    threadId?: string;
    article: ResearchArticle;
    userMessage?: ResearchArticle;
  }>(
    "/v1/agent/chat",
    {
      method: "POST",
      body: JSON.stringify({
        message,
        ticker: args.ticker,
        threadId: args.threadId,
      }),
    },
    opts,
  );
}

export function secFilings(
  ticker: string,
  opts: FetchOpts = {},
): Promise<{ CIK: string; Citations: Array<{ Form: string; Label: string; URL: string }> }> {
  return jsonFetch(`/v1/memo/sec/${ticker}`, { method: "GET" }, opts);
}

export function listWatchlist(opts: FetchOpts): Promise<{ items: WatchEntry[] }> {
  return jsonFetch("/v1/watchlist", { method: "GET" }, opts);
}

export function addToWatchlist(
  entry: Partial<WatchEntry> & { ticker: string },
  opts: FetchOpts,
): Promise<{ entry: WatchEntry }> {
  return jsonFetch(
    "/v1/watchlist/add",
    { method: "POST", body: JSON.stringify(entry) },
    opts,
  );
}

export function removeFromWatchlist(
  ticker: string,
  opts: FetchOpts,
): Promise<{ ok: true; removed: boolean }> {
  return jsonFetch(
    `/v1/watchlist/${ticker}`,
    { method: "DELETE" },
    opts,
  );
}

export function saveMemoToWatchlist(
  ticker: string,
  memo: string,
  provider: string | undefined,
  opts: FetchOpts,
): Promise<{ entry: WatchEntry }> {
  return jsonFetch(
    `/v1/watchlist/${ticker}/memo`,
    { method: "POST", body: JSON.stringify({ memo, provider }) },
    opts,
  );
}

// -------- admin --------

export function adminMetrics(opts: FetchOpts): Promise<{
  requests24h: number;
  identify24h: number;
  activeUsers: number;
}> {
  return jsonFetch("/v1/admin/metrics", { method: "GET" }, opts);
}
