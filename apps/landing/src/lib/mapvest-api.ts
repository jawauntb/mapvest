/**
 * Browser client for the Mapvest API. Runs entirely client-side; the session
 * token lives in localStorage. CORS is open on the API (see apps/api).
 */

export const API_URL =
  process.env.NEXT_PUBLIC_MAPVEST_API_URL ?? "https://api-production-4b27.up.railway.app";

const TOKEN_KEY = "mapvest.session.token";
const USER_KEY = "mapvest.session.user";
const DEVICE_ID_KEY = "mapvest.deviceId.v1";

export type User = {
  id: string;
  email: string;
  createdAt: string;
  scopes: Array<"user" | "admin">;
};

export type Session = { token: string; userId: string; expiresAt: string };

export type NearbyItem = {
  place: {
    id: string;
    name: string;
    location: { lat: number; lng: number };
    types: string[];
  };
  investable?: {
    brand: {
      name: string;
      isPublic: boolean;
      ticker?: { symbol: string; exchange?: string };
      sector?: string;
    };
    confidence: "high" | "medium" | "low";
  };
};

export type WatchEntry = {
  ticker: string;
  name?: string;
  sector?: string;
  source: "camera" | "map" | "list" | "manual" | "detail" | "web";
  memo?: string;
  memoProvider?: string;
  createdAt: string;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public remaining?: number,
    public limit?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isQuotaExceeded(): boolean {
    return this.status === 402 && this.code === "quota_exceeded";
  }
}

export function isQuotaExceeded(err: unknown): err is ApiError {
  return err instanceof ApiError && err.isQuotaExceeded;
}

function apiErrorFromBody(status: number, text: string, fallback: string): ApiError {
  let message = text || fallback;
  let code: string | undefined;
  let remaining: number | undefined;
  let limit: number | undefined;
  try {
    const j = JSON.parse(text) as {
      error?: string;
      code?: string;
      remaining?: number;
      limit?: number;
    };
    if (typeof j.error === "string" && j.error.trim()) message = j.error;
    if (typeof j.code === "string") code = j.code;
    if (typeof j.remaining === "number") remaining = j.remaining;
    if (typeof j.limit === "number") limit = j.limit;
  } catch {
    /* plain-text body */
  }
  return new ApiError(status, message, code, remaining, limit);
}

async function req<T>(path: string, init: RequestInit = {}, needsAuth = false): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (needsAuth) {
    if (!token) throw new ApiError(401, "not signed in");
    headers.set("Authorization", `Bearer ${token}`);
  } else if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const deviceId = getDeviceId();
  if (deviceId) headers.set("X-Device-Id", deviceId);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw apiErrorFromBody(res.status, text, res.statusText);
  }
  return (await res.json()) as T;
}

// ---- storage ----

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setSession(session: Session, user: User) {
  window.localStorage.setItem(TOKEN_KEY, session.token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

/**
 * Stable per-browser device id, generated once and persisted in
 * localStorage. Sent as `X-Device-Id` so anonymous (guest) usage can be
 * metered without requiring sign-in (Phase 8 Slice C). Never blocks a
 * request — returns null during SSR or if storage is unavailable.
 */
export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const next =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, next);
    return next;
  } catch {
    return null;
  }
}

// ---- auth ----

export function requestCode(email: string) {
  return req<{ sent: true; devCode?: string }>("/v1/auth/session", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyCode(email: string, code: string) {
  return req<{ session: Session; user: User }>("/v1/auth/session/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

// ---- nearby / resolve ----

export function fetchNearby(lat: number, lng: number, radius = 500, limit = 25) {
  return req<{ items: NearbyItem[] }>(
    `/v1/nearby?lat=${lat}&lng=${lng}&radius=${radius}&limit=${limit}`,
  );
}

export type ResolvedBrand = {
  name: string;
  isPublic: boolean;
  ticker?: { symbol: string; exchange?: string };
  sector?: string;
};

export function resolveComparable(brand: string, hintSector?: string) {
  return req<{
    brand: ResolvedBrand;
    comparables: Array<{
      ticker: string;
      name: string;
      score: number;
      reasoning: string;
      sources: Array<{ provider: string; url?: string; confidence: string }>;
    }>;
    etfs: Array<{
      ticker: string;
      name: string;
      weight: number;
      source: { provider: string; url?: string };
    }>;
  }>("/v1/resolve-comparable", {
    method: "POST",
    body: JSON.stringify({ brand, hintSector }),
  });
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

export function getQuote(symbol: string) {
  return req<{ quote?: Quote; error?: string }>(`/v1/quote?symbol=${encodeURIComponent(symbol)}`);
}

export type NewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
};

export type MarketEvent = {
  ticker: string;
  type: string;
  date?: string;
  status?: string;
  description?: string;
  sourceUrl?: string;
  provider?: "massive" | "tmx";
  companyName?: string;
};

export function getTickerNews(symbol: string, limit = 6) {
  return req<{ items: NewsItem[]; provider: string; ts: string }>(
    `/v1/news?ticker=${encodeURIComponent(symbol)}&limit=${Math.min(25, Math.max(1, limit))}`,
  );
}

export function getMarketEvents(symbol: string, limit = 8) {
  return req<{
    ticker?: string;
    events: MarketEvent[];
    tmxAvailable?: boolean;
  }>(
    `/v1/market-events?ticker=${encodeURIComponent(symbol)}&limit=${Math.min(25, Math.max(1, limit))}`,
  );
}

export type OptionContract = {
  ticker: string;
  underlyingTicker?: string;
  contractType?: "call" | "put" | "other";
  expirationDate?: string;
  strikePrice?: number;
  exerciseStyle?: "american" | "bermudan" | "european";
  sharesPerContract?: number;
  primaryExchange?: string;
  cfi?: string;
};

export type OptionSnapshot = OptionContract & {
  breakEvenPrice?: number;
  impliedVolatility?: number;
  openInterest?: number;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
  quote?: { bid?: number; ask?: number; bidSize?: number; askSize?: number; ts?: number };
  trade?: { price?: number; size?: number; ts?: number };
  day?: { open?: number; high?: number; low?: number; close?: number; volume?: number };
};

export type FinancialRatio = {
  ticker: string;
  date?: string;
  averageVolume?: number;
  cash?: number;
  current?: number;
  debtToEquity?: number;
  dividendYield?: number;
  earningsPerShare?: number;
  enterpriseValue?: number;
  evToEbitda?: number;
  evToSales?: number;
  freeCashFlow?: number;
  marketCap?: number;
  price?: number;
  priceToBook?: number;
  priceToCashFlow?: number;
  priceToEarnings?: number;
  priceToFreeCashFlow?: number;
  priceToSales?: number;
  quick?: number;
  returnOnAssets?: number;
  returnOnEquity?: number;
};

export function getFinancialRatios(symbol: string, limit = 1) {
  const qs = new URLSearchParams({
    ticker: symbol.toUpperCase(),
    limit: String(Math.min(Math.max(1, limit), 50)),
  });
  return req<{
    ticker: string;
    ratios: FinancialRatio[];
    nextCursor?: string;
    requestId?: string;
    sources: Array<{ provider: string; url?: string; fetchedAt: string; confidence: string }>;
  }>(`/v1/financials/ratios?${qs.toString()}`);
}

export function getOptionContracts(
  symbol: string,
  args: {
    expirationDate?: string;
    contractType?: "call" | "put";
    limit?: number;
    cursor?: string;
  } = {},
) {
  const qs = new URLSearchParams({
    underlying: symbol.toUpperCase(),
    expired: "false",
    limit: String(Math.min(args.limit ?? 250, 250)),
  });
  if (args.expirationDate) qs.set("expiration_date", args.expirationDate);
  if (args.contractType) qs.set("contract_type", args.contractType);
  if (args.cursor) qs.set("cursor", args.cursor);
  return req<{
    contracts: OptionContract[];
    nextCursor?: string;
    requestId?: string;
    sources: Array<{ provider: string; url?: string; fetchedAt: string; confidence: string }>;
  }>(`/v1/options/contracts?${qs.toString()}`);
}

export function getOptionsChain(
  symbol: string,
  args: {
    expirationDate?: string;
    contractType?: "call" | "put";
    strikePrice?: number;
    limit?: number;
    cursor?: string;
  } = {},
) {
  const qs = new URLSearchParams({
    underlying: symbol.toUpperCase(),
    limit: String(Math.min(args.limit ?? 250, 250)),
  });
  if (args.expirationDate) qs.set("expiration_date", args.expirationDate);
  if (args.contractType) qs.set("contract_type", args.contractType);
  if (args.strikePrice != null) qs.set("strike_price", String(args.strikePrice));
  if (args.cursor) qs.set("cursor", args.cursor);
  return req<{
    underlyingTicker: string;
    contracts: OptionSnapshot[];
    nextCursor?: string;
    requestId?: string;
    sources: Array<{ provider: string; url?: string; fetchedAt: string; confidence: string }>;
  }>(`/v1/options/chain?${qs.toString()}`);
}

/** Best-effort parallel quotes for list/saved (cap 10). */
export async function getQuotesMap(symbols: string[]): Promise<Record<string, Quote>> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 10);
  const entries = await Promise.all(
    uniq.map(async (sym) => {
      try {
        const r = await getQuote(sym);
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

/** Chart PNG via Underlying Analyzer (proxied). Default period 1mo. */
export function getChart(
  type: string,
  ticker: string,
  opts: { period?: string; month?: number } = {},
) {
  const qs = new URLSearchParams({
    ticker,
    period: opts.period ?? "1mo",
  });
  if (opts.month != null) qs.set("month", String(opts.month));
  return req<ChartImage>(`/v1/chart/${encodeURIComponent(type)}?${qs.toString()}`);
}

export function getAuctionChart(ticker: string, period = "1mo") {
  return getChart("auction", ticker, { period });
}

export type AnalysisSnapshot = {
  ticker: string;
  name?: string;
  sector?: string;
  industry?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  marketCap?: string | number;
  trailingPe?: string | number;
  annualVolatility?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  brief?: string;
  briefProvider?: string;
  sourceUrl?: string;
};

export function getAnalysis(ticker: string) {
  return req<AnalysisSnapshot>(`/v1/analysis/${encodeURIComponent(ticker)}`);
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

export function fetchCockpit(tickers: string[]) {
  return req<{ rows: CockpitRow[]; tickers: string[]; sourceUrl?: string }>(
    "/v1/cockpit",
    { method: "POST", body: JSON.stringify({ tickers: tickers.slice(0, 10) }) },
    true,
  );
}

export type AlertItem = {
  ticker?: string;
  title?: string;
  severity?: string | number;
  summary?: string;
  message?: string;
};

export function fetchAlerts(tickers: string[]) {
  return req<{ alerts: AlertItem[]; tickers: string[]; sourceUrl?: string }>(
    "/v1/alerts",
    { method: "POST", body: JSON.stringify({ tickers: tickers.slice(0, 10) }) },
    true,
  );
}

export type ResearchArticle = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  interesting: string[];
  ideas: Array<{
    title: string;
    thesis: string;
    disposition?: string;
    findings: string[];
  }>;
  toolsUsed: string[];
  sources: Array<{ label: string; url?: string }>;
  chartTickers: string[];
  mode?: string;
  error?: string;
};

export type AgentThread = {
  id: string;
  title: string;
  preview: string;
  createdAt?: string;
  updatedAt?: string;
  messages?: ResearchArticle[];
};

export function listAgentThreads() {
  return req<{ threads: AgentThread[]; count: number }>("/v1/agent/threads");
}

export function getAgentThread(id: string) {
  return req<{ thread: AgentThread }>(`/v1/agent/threads/${encodeURIComponent(id)}`);
}

/** Context-bound research brief (Derivation idea-chats under the hood). */
export function agentChat(message: string, opts?: { ticker?: string; threadId?: string }) {
  return req<{
    threadId?: string;
    ticker?: string;
    article: ResearchArticle;
    userMessage?: ResearchArticle;
    provider?: string;
    sourceUrl?: string;
  }>("/v1/agent/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      ticker: opts?.ticker,
      threadId: opts?.threadId,
    }),
  });
}

// ---- settings ----

export type SettingsResponse = {
  user: { id: string; email: string; scopes: string[] };
  robinhoodMcp:
    | { configured: true; fingerprint: string; last4: string; updatedAt: string }
    | { configured: false };
  note?: string;
};

export function fetchSettings() {
  return req<SettingsResponse>("/v1/settings", {}, true);
}

export function saveRobinhoodMcp(token: string) {
  return req<{ ok: true; robinhoodMcp: SettingsResponse["robinhoodMcp"] }>(
    "/v1/settings/robinhood-mcp",
    { method: "POST", body: JSON.stringify({ token }) },
    true,
  );
}

export function clearRobinhoodMcp() {
  return req<{ ok: true; robinhoodMcp: { configured: false } }>(
    "/v1/settings/robinhood-mcp",
    { method: "DELETE" },
    true,
  );
}

export function getMe() {
  return req<{ user: User }>("/v1/auth/me", {}, true);
}

/** Deep-link to Robinhood stock page when user MCP key is configured. */
export function openInRobinhood(ticker: string) {
  return req<{
    ticker: string;
    configured: true;
    linkOut: string;
    note?: string;
  }>(`/v1/robinhood?ticker=${encodeURIComponent(ticker)}`, {}, true);
}

// ---- identify ----

export async function identifyImage(file: File, location?: { lat: number; lng: number }) {
  const form = new FormData();
  form.append("image", file);
  if (location) {
    form.append("lat", String(location.lat));
    form.append("lng", String(location.lng));
  }
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const deviceId = getDeviceId();
  if (deviceId) headers.set("X-Device-Id", deviceId);
  const res = await fetch(`${API_URL}/v1/identify`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw apiErrorFromBody(res.status, text, res.statusText);
  }
  return (await res.json()) as {
    identification: {
      visibleText: string[];
      detected: Array<{
        brand?: string;
        product?: string;
        sector?: string;
        confidence: "high" | "medium" | "low";
      }>;
      modelUsed: string;
    };
    investables: Array<{
      brand: {
        name: string;
        isPublic: boolean;
        ticker?: { symbol: string; exchange?: string };
        sector?: string;
      };
      comparables?: Array<{ ticker: string; name?: string; score?: number }>;
      confidence: "high" | "medium" | "low";
    }>;
  };
}

// ---- memo + watchlist ----

export function generateMemo(ticker: string) {
  return req<{ ticker: string; provider: string; memo: string }>("/v1/memo", {
    method: "POST",
    body: JSON.stringify({ ticker }),
  });
}

export type EntitlementState = {
  plan: "none" | "free_trial" | "free_forever" | "subscribed";
  remaining: number;
  limit: number;
  freeForever: boolean;
  subscribed: boolean;
  canGenerate: boolean;
  canPersist: boolean;
};

export function fetchEntitlements() {
  return req<EntitlementState>("/v1/entitlements");
}

export type BillingCheckout = {
  channel: "stripe" | "apple_iap" | "google_play";
  url?: string;
  productId?: string;
  priceUsd: number;
  interval: "month";
};

export function startCheckout(platform: "web" | "ios" | "android" = "web") {
  return req<BillingCheckout>(
    "/v1/billing/checkout",
    { method: "POST", body: JSON.stringify({ platform }) },
    true,
  );
}

export function startPortal() {
  return req<{ url: string }>("/v1/billing/portal", { method: "POST", body: "{}" }, true);
}

export function listWatchlist() {
  return req<{ items: WatchEntry[] }>("/v1/watchlist", {}, true);
}

export function addToWatchlist(entry: Partial<WatchEntry> & { ticker: string }) {
  return req<{ entry: WatchEntry }>(
    "/v1/watchlist/add",
    { method: "POST", body: JSON.stringify(entry) },
    true,
  );
}

export function removeFromWatchlist(ticker: string) {
  return req<{ ok: true; removed: boolean }>(`/v1/watchlist/${ticker}`, { method: "DELETE" }, true);
}

export function saveMemoToWatchlist(ticker: string, memo: string, provider: string | undefined) {
  return req<{ entry: WatchEntry }>(
    `/v1/watchlist/${ticker}/memo`,
    { method: "POST", body: JSON.stringify({ memo, provider }) },
    true,
  );
}
