/**
 * Browser client for the Mapvest API. Runs entirely client-side; the session
 * token lives in localStorage. CORS is open on the API (see apps/api).
 */

export const API_URL =
  process.env.NEXT_PUBLIC_MAPVEST_API_URL ??
  "https://api-production-4b27.up.railway.app";

const TOKEN_KEY = "mapvest.session.token";
const USER_KEY = "mapvest.session.user";

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
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(
  path: string,
  init: RequestInit = {},
  needsAuth = false,
): Promise<T> {
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
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) message = j.error;
    } catch {
      /* plain-text body */
    }
    throw new ApiError(res.status, message);
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
  return req<{ quote?: Quote; error?: string }>(
    `/v1/quote?symbol=${encodeURIComponent(symbol)}`,
  );
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
  const res = await fetch(`${API_URL}/v1/identify`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    let message = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) message = j.error;
    } catch {
      /* plain-text body */
    }
    throw new ApiError(res.status, message);
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
  return req<{ ok: true; removed: boolean }>(
    `/v1/watchlist/${ticker}`,
    { method: "DELETE" },
    true,
  );
}

export function saveMemoToWatchlist(ticker: string, memo: string, provider: string | undefined) {
  return req<{ entry: WatchEntry }>(
    `/v1/watchlist/${ticker}/memo`,
    { method: "POST", body: JSON.stringify({ memo, provider }) },
    true,
  );
}
