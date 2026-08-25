import { getDeviceId } from "@/util/deviceId";
import { API_URL } from "@/util/env";
import { ApiError, apiErrorFromResponse } from "./errors";
import type {
  BillingCheckoutResponse,
  BillingPlatform,
  BillingPortalResponse,
  DexResponse,
  EntitlementState,
  FinancialRatiosResponse,
  IdentifyResponse,
  LatLng,
  NearbyResponse,
  OptionContractsResponse,
  OptionsResponse,
  ProgressResponse,
  QuestsResponse,
  QuoteHistoryResponse,
  ResolveComparableResponse,
  Session,
  UniverseSummary,
  User,
} from "./types";

export { ApiError, isQuotaExceeded } from "./errors";

type FetchOpts = {
  token?: string;
  signal?: AbortSignal;
};

async function jsonFetch<T>(path: string, init: RequestInit, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  // Anonymous device id — lets guest usage be metered without a session
  // (Phase 8 Slice C). Best-effort: never block a request on it.
  try {
    headers.set("X-Device-Id", await getDeviceId());
  } catch {
    /* SecureStore unavailable — request proceeds without device id */
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw apiErrorFromResponse(res.status, text, res.statusText);
  }
  return (await res.json()) as T;
}

// -------- auth --------

export function requestMagicLink(email: string): Promise<{ sent: true; devCode?: string }> {
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
 *
 * Optional `roi` (normalized image-space circle) and `hint` (short text
 * note) are attached as extra multipart fields for the server to consume
 * once ROI-aware identify is wired up. They are safe to omit — the server
 * treats absence as "identify the whole frame".
 */
export async function identifyPhoto(
  args: {
    imageUri: string;
    location?: LatLng;
    roi?: { xN: number; yN: number; rN: number };
    hint?: string;
  },
  opts: FetchOpts = {},
): Promise<IdentifyResponse> {
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } as the file value.
  form.append("image", {
    uri: args.imageUri,
    name: "capture.jpg",
    type: "image/jpeg",
    // biome-ignore lint/suspicious/noExplicitAny: React Native FormData file value shape
  } as any);
  if (args.location) {
    form.append("location", JSON.stringify(args.location));
  }
  if (args.roi) {
    form.append("roi", JSON.stringify(args.roi));
  }
  if (args.hint?.trim()) {
    form.append("hint", args.hint.trim());
  }
  const headers = new Headers();
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  headers.set("Accept", "application/json");
  try {
    headers.set("X-Device-Id", await getDeviceId());
  } catch {
    /* SecureStore unavailable — request proceeds without device id */
  }
  // Let fetch set the multipart boundary itself; do NOT set Content-Type.

  const res = await fetch(`${API_URL}/v1/identify`, {
    method: "POST",
    body: form,
    headers,
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw apiErrorFromResponse(res.status, text, res.statusText);
  }
  return (await res.json()) as IdentifyResponse;
}

export function resolveComparable(
  args: { brand: string; hintSector?: string },
  opts: FetchOpts = {},
): Promise<ResolveComparableResponse> {
  return jsonFetch("/v1/resolve-comparable", { method: "POST", body: JSON.stringify(args) }, opts);
}

// -------- memo + watchlist --------

export type WatchEntry = {
  ticker: string;
  name?: string;
  sector?: string;
  source: "camera" | "map" | "list" | "manual" | "detail" | "live" | "web";
  memo?: string;
  memoProvider?: string;
  createdAt: string;
  listId?: string;
};

export function generateMemo(
  ticker: string,
  opts: FetchOpts = {},
): Promise<{ ticker: string; provider: string; memo: string }> {
  return jsonFetch("/v1/memo", { method: "POST", body: JSON.stringify({ ticker }) }, opts);
}

export type Quote = {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  currency: string;
  ts: string;
  disclaimer: string;
  name?: string;
};

/** Company line for list rows. Never invents a name; never repeats the ticker. */
export function companyLabel(
  ticker: string,
  name?: string,
  quoteName?: string,
): string | undefined {
  const sym = ticker.trim().toUpperCase();
  for (const raw of [quoteName, name]) {
    const n = raw?.trim();
    if (n && n.toUpperCase() !== sym) return n;
  }
  return undefined;
}

export function fetchQuote(
  symbol: string,
  opts: FetchOpts = {},
): Promise<{ quote?: Quote; error?: string }> {
  return jsonFetch(`/v1/quote?symbol=${encodeURIComponent(symbol)}`, { method: "GET" }, opts);
}

export type QuoteHistoryPeriod = QuoteHistoryResponse["period"];
export type QuoteHistoryInterval = QuoteHistoryResponse["interval"];

/** Provider-routed closes for the native Overview price chart. Last bar is live. */
export function fetchQuoteHistory(
  symbol: string,
  query: { period?: QuoteHistoryPeriod; interval?: QuoteHistoryInterval } = {},
  opts: FetchOpts = {},
): Promise<QuoteHistoryResponse> {
  const interval = query.interval ?? "1d";
  const period = query.period ?? (interval === "15m" ? "5d" : interval === "1w" ? "2y" : "1y");
  const qs = new URLSearchParams({ symbol, period, interval });
  return jsonFetch(`/v1/quote-history?${qs.toString()}`, { method: "GET" }, opts);
}

export function fetchFinancialRatios(
  ticker: string,
  opts: FetchOpts = {},
): Promise<FinancialRatiosResponse> {
  return jsonFetch(
    `/v1/financials/ratios?ticker=${encodeURIComponent(ticker.toUpperCase())}&limit=1`,
    { method: "GET" },
    opts,
  );
}

export function fetchOptionContracts(
  underlyingTicker: string,
  args: {
    expirationDate?: string;
    contractType?: "call" | "put";
    limit?: number;
    cursor?: string;
  } = {},
  opts: FetchOpts = {},
): Promise<OptionContractsResponse> {
  const qs = new URLSearchParams({
    underlying: underlyingTicker.toUpperCase(),
    expired: "false",
    limit: String(Math.min(args.limit ?? 250, 250)),
  });
  if (args.expirationDate) qs.set("expiration_date", args.expirationDate);
  if (args.contractType) qs.set("contract_type", args.contractType);
  if (args.cursor) qs.set("cursor", args.cursor);
  return jsonFetch(`/v1/options/contracts?${qs.toString()}`, { method: "GET" }, opts);
}

export function fetchOptionsChain(
  underlyingTicker: string,
  args: {
    expirationDate?: string;
    contractType?: "call" | "put";
    strikePrice?: number;
    limit?: number;
    cursor?: string;
  } = {},
  opts: FetchOpts = {},
): Promise<OptionsResponse> {
  const qs = new URLSearchParams({
    underlying: underlyingTicker.toUpperCase(),
    limit: String(Math.min(args.limit ?? 250, 250)),
  });
  if (args.expirationDate) qs.set("expiration_date", args.expirationDate);
  if (args.contractType) qs.set("contract_type", args.contractType);
  if (args.strikePrice != null) qs.set("strike_price", String(args.strikePrice));
  if (args.cursor) qs.set("cursor", args.cursor);
  return jsonFetch(`/v1/options/chain?${qs.toString()}`, { method: "GET" }, opts);
}

/** Best-effort parallel quotes for list/map pins (cap 24). */
export async function fetchQuotesMap(
  symbols: string[],
  opts: FetchOpts = {},
): Promise<Record<string, Quote>> {
  const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))].slice(0, 24);
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
    "/v1/underlying-alerts",
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
  error?: string;
};

export type ResearchDepth = "auto" | "instant" | "standard" | "deep" | "max";

export type ResearchConversationStatus =
  | "queued"
  | "running"
  | "conclusive"
  | "exhausted"
  | "blocked"
  | "error";

export type ResearchConversationReference = {
  id: string;
  status: ResearchConversationStatus;
  deliverable: "ideas" | "memo";
  href: string;
  pdf_url?: string | null;
  schema_version?: "research_conversation_ref_v1";
  conversation_id?: string;
  stream_href?: string;
};

export type AgentThread = {
  id: string;
  conversationId?: string;
  title: string;
  preview: string;
  status?: ResearchConversationStatus;
  messages?: ResearchArticle[];
};

export type AgentChatResponse = {
  conversationId?: string;
  /** Compatibility alias retained while released clients still call these threads. */
  threadId: string;
  clientMessageId?: string;
  status?: ResearchConversationStatus;
  conversation?: ResearchConversationReference;
  article: ResearchArticle;
  userMessage?: ResearchArticle;
};

export function createResearchClientMessageId(): string {
  const random = Math.random().toString(36).slice(2, 12);
  return `ios_${Date.now().toString(36)}_${random}`;
}

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
  args: {
    ticker?: string;
    conversationId?: string;
    threadId?: string;
    clientMessageId?: string;
    researchDepth?: ResearchDepth;
  } = {},
  opts: FetchOpts = {},
) {
  const conversationId = args.conversationId ?? args.threadId;
  const clientMessageId = args.clientMessageId ?? createResearchClientMessageId();
  return jsonFetch<AgentChatResponse>(
    "/v1/agent/chat",
    {
      method: "POST",
      body: JSON.stringify({
        message,
        ticker: args.ticker,
        conversationId,
        clientMessageId,
        researchDepth: args.researchDepth ?? "auto",
      }),
    },
    opts,
  );
}

/**
 * Streaming counterpart to `agentChat`. POSTs to /v1/agent/stream and consumes
 * the SSE response line-by-line via fetch + ReadableStream — EventSource is
 * intentionally avoided because RN's built-in fetch doesn't ship it and the
 * common polyfills break Reanimated worklets.
 *
 * The callback receives every parsed SSE event as `{ type, data }`. The
 * returned promise resolves with the final article (from `event: article`,
 * or synthesized from `token` text if the stream closes early). It rejects
 * on `event: error` / transport failure / empty stream so ResearchSheet can
 * fall back to the blocking /chat call. `ping` keepalives are ignored.
 */
export type AgentStreamEvent =
  | { type: "ping"; data: { ts?: number } }
  | { type: "tool"; data: { name: string; arg?: string } }
  | { type: "tool_end"; data: { name: string; ok: boolean } }
  | {
      type: "reasoning";
      data: { text: string; conversationId?: string; progress?: unknown };
    }
  | { type: "token"; data: { text: string } }
  | { type: "article"; data: ResearchArticle }
  | {
      type: "done";
      data: {
        conversationId: string;
        threadId: string;
        clientMessageId: string;
        status: ResearchConversationStatus;
      };
    }
  | { type: "error"; data: { message: string } }
  | { type: string; data: unknown };

function nextSseBoundary(buf: string): { idx: number; sep: number } {
  const crlf = buf.indexOf("\r\n\r\n");
  const lf = buf.indexOf("\n\n");
  if (crlf === -1 && lf === -1) return { idx: -1, sep: 0 };
  if (crlf === -1) return { idx: lf, sep: 2 };
  if (lf === -1) return { idx: crlf, sep: 4 };
  return crlf < lf ? { idx: crlf, sep: 4 } : { idx: lf, sep: 2 };
}

export async function agentChatStream(
  message: string,
  args: {
    ticker?: string;
    conversationId?: string;
    threadId?: string;
    clientMessageId?: string;
    researchDepth?: ResearchDepth;
  },
  onEvent: (event: AgentStreamEvent) => void,
  opts: FetchOpts = {},
): Promise<{
  article: ResearchArticle;
  conversationId: string;
  threadId: string;
  clientMessageId: string;
  status: ResearchConversationStatus;
}> {
  const conversationId = args.conversationId ?? args.threadId;
  const clientMessageId = args.clientMessageId ?? createResearchClientMessageId();
  const headers = new Headers();
  headers.set("Accept", "text/event-stream");
  headers.set("Content-Type", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  try {
    headers.set("X-Device-Id", await getDeviceId());
  } catch {
    /* SecureStore unavailable — request proceeds without device id */
  }

  const res = await fetch(`${API_URL}/v1/agent/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      ticker: args.ticker,
      conversationId,
      clientMessageId,
      researchDepth: args.researchDepth ?? "auto",
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw apiErrorFromResponse(res.status, text, res.statusText);
  }

  // React Native's fetch exposes the body as a ReadableStream on iOS 18 / RN 0.76+.
  // If the polyfill hides it (older Expo Go builds), fall back to res.text() which
  // still lets us fire the terminal events even without token-by-token motion.
  const body = res.body as ReadableStream<Uint8Array> | null;
  const decoder = new TextDecoder("utf-8");

  let finalArticle: ResearchArticle | undefined;
  let finalConversationId = conversationId;
  let finalClientMessageId = clientMessageId;
  let finalStatus: ResearchConversationStatus | undefined;
  let errored: string | undefined;
  let tokenText = "";

  const dispatch = (rawBlock: string) => {
    const lines = rawBlock.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return;
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let data: unknown;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (eventName === "ping") return;
    const evt = { type: eventName, data } as AgentStreamEvent;
    onEvent(evt);
    if (eventName === "article") {
      finalArticle = data as ResearchArticle;
    } else if (eventName === "reasoning") {
      const d = data as { conversationId?: string };
      finalConversationId = d?.conversationId ?? finalConversationId;
    } else if (eventName === "token") {
      const d = data as { text?: string };
      if (typeof d?.text === "string") tokenText += d.text;
    } else if (eventName === "done") {
      const d = data as {
        conversationId?: string;
        threadId?: string;
        clientMessageId?: string;
        status?: ResearchConversationStatus;
      };
      finalConversationId = d?.conversationId ?? d?.threadId ?? finalConversationId;
      finalClientMessageId = d?.clientMessageId ?? finalClientMessageId;
      finalStatus = d?.status;
    } else if (eventName === "error") {
      const d = data as { message?: string };
      errored = d?.message || "stream error";
    }
  };

  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let { idx, sep } = nextSseBoundary(buf);
      while (idx !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + sep);
        dispatch(block);
        ({ idx, sep } = nextSseBoundary(buf));
      }
      if (errored) break;
    }
    if (!errored && buf.trim()) dispatch(buf);
  } else {
    // Whole-body fallback for RN builds without a streaming fetch.
    const text = await res.text();
    const parts = text.split(/\r?\n\r?\n/);
    for (const block of parts) {
      dispatch(block);
      if (errored) break;
    }
  }

  if (errored) throw new ApiError(500, errored);
  if (!finalArticle && tokenText.trim()) {
    finalArticle = {
      id: `stream-${Date.now()}`,
      role: "assistant",
      content: tokenText.trim(),
      createdAt: new Date().toISOString(),
      interesting: [],
      ideas: [],
      toolsUsed: [],
      sources: [],
      chartTickers: args.ticker ? [args.ticker] : [],
    };
  }
  if (!finalArticle) throw new ApiError(500, "stream ended without an article");
  if (!finalConversationId) throw new ApiError(500, "stream ended without a conversation id");
  return {
    article: finalArticle,
    conversationId: finalConversationId,
    threadId: finalConversationId,
    clientMessageId: finalClientMessageId,
    status: finalStatus ?? "conclusive",
  };
}

export function secFilings(
  ticker: string,
  opts: FetchOpts = {},
): Promise<{ CIK: string; Citations: Array<{ Form: string; Label: string; URL: string }> }> {
  return jsonFetch(`/v1/memo/sec/${ticker}`, { method: "GET" }, opts);
}

export function listWatchlist(
  opts: FetchOpts,
  args: { listId?: string } = {},
): Promise<{ items: WatchEntry[] }> {
  const qs = args.listId ? `?listId=${encodeURIComponent(args.listId)}` : "";
  return jsonFetch(`/v1/watchlist${qs}`, { method: "GET" }, opts);
}

export function fetchWatchlistBrief(
  opts: FetchOpts,
): Promise<{ headline: string; body: string; generatedAt: string }> {
  return jsonFetch("/v1/watchlist/brief", { method: "GET" }, opts);
}

export function addToWatchlist(
  entry: Partial<WatchEntry> & { ticker: string; listId?: string },
  opts: FetchOpts,
): Promise<{ entry: WatchEntry; unresolved?: boolean }> {
  return jsonFetch("/v1/watchlist/add", { method: "POST", body: JSON.stringify(entry) }, opts);
}

export function removeFromWatchlist(
  ticker: string,
  opts: FetchOpts,
): Promise<{ ok: true; removed: boolean }> {
  return jsonFetch(`/v1/watchlist/${ticker}`, { method: "DELETE" }, opts);
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

export function fetchEntitlements(opts: FetchOpts = {}): Promise<EntitlementState> {
  return jsonFetch("/v1/entitlements", { method: "GET" }, opts);
}

export function startCheckout(
  args: { platform: BillingPlatform; successUrl?: string; cancelUrl?: string },
  opts: FetchOpts,
): Promise<BillingCheckoutResponse> {
  return jsonFetch("/v1/billing/checkout", { method: "POST", body: JSON.stringify(args) }, opts);
}

export function startPortal(opts: FetchOpts): Promise<BillingPortalResponse> {
  return jsonFetch("/v1/billing/portal", { method: "POST", body: JSON.stringify({}) }, opts);
}

export function confirmApplePurchase(
  args: { signedTransaction: string },
  opts: FetchOpts,
): Promise<EntitlementState> {
  return jsonFetch("/v1/billing/apple", { method: "POST", body: JSON.stringify(args) }, opts);
}

// -------- settings --------

export type SettingsResponse = {
  user: { id: string; email: string; scopes: string[] };
  robinhoodMcp:
    | { configured: true; fingerprint: string; last4: string; updatedAt: string }
    | { configured: false };
  note?: string;
};

export function fetchSettings(opts: FetchOpts): Promise<SettingsResponse> {
  return jsonFetch("/v1/settings", { method: "GET" }, opts);
}

export function saveRobinhoodMcp(
  token: string,
  opts: FetchOpts,
): Promise<{ ok: true; robinhoodMcp: SettingsResponse["robinhoodMcp"] }> {
  return jsonFetch(
    "/v1/settings/robinhood-mcp",
    { method: "POST", body: JSON.stringify({ token }) },
    opts,
  );
}

export function clearRobinhoodMcp(
  opts: FetchOpts,
): Promise<{ ok: true; robinhoodMcp: { configured: false } }> {
  return jsonFetch("/v1/settings/robinhood-mcp", { method: "DELETE" }, opts);
}

export function openInRobinhood(
  ticker: string,
  opts: FetchOpts,
): Promise<{
  ticker: string;
  configured: true;
  linkOut: string;
  note?: string;
}> {
  return jsonFetch(`/v1/robinhood?ticker=${encodeURIComponent(ticker)}`, { method: "GET" }, opts);
}

// -------- admin --------

export function adminMetrics(opts: FetchOpts): Promise<{
  requests24h: number;
  identify24h: number;
  activeUsers: number;
}> {
  return jsonFetch("/v1/admin/metrics", { method: "GET" }, opts);
}

// -------- multiple watchlists --------
// Server endpoints under /v1/watchlist/lists and /list-summary — see
// apps/api/src/routes/watchlist.ts. Types kept plain so the same shapes can
// flow through useQuery cache keys without a schema roundtrip.

export type WatchlistSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  tickerCount: number;
  createdAt?: string;
};

export type ListSummaryResponse = {
  sectors: Array<{ sector: string; count: number; pct: number }>;
  backtestReady: boolean;
  tickerCount: number;
  updatedAt: string;
};

export function listWatchlists(opts: FetchOpts): Promise<{ lists: WatchlistSummary[] }> {
  return jsonFetch("/v1/watchlist/lists", { method: "GET" }, opts);
}

export function createWatchlist(
  name: string,
  opts: FetchOpts,
): Promise<{ list: WatchlistSummary }> {
  return jsonFetch("/v1/watchlist/lists", { method: "POST", body: JSON.stringify({ name }) }, opts);
}

export function renameWatchlist(
  id: string,
  name: string,
  opts: FetchOpts,
): Promise<{ list: WatchlistSummary }> {
  return jsonFetch(
    `/v1/watchlist/lists/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
    opts,
  );
}

export async function deleteWatchlist(id: string, opts: FetchOpts): Promise<void> {
  // 204 No Content — jsonFetch expects JSON, so we skip it and fetch directly.
  const headers = new Headers();
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  headers.set("Accept", "application/json");
  try {
    headers.set("X-Device-Id", await getDeviceId());
  } catch {
    /* SecureStore unavailable */
  }
  const res = await fetch(`${API_URL}/v1/watchlist/lists/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers,
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw apiErrorFromResponse(res.status, text, res.statusText);
  }
}

export async function moveTicker(
  args: { ticker: string; toListId: string; fromListId?: string },
  opts: FetchOpts,
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "application/json" });
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  try {
    headers.set("X-Device-Id", await getDeviceId());
  } catch {
    /* SecureStore unavailable */
  }
  const res = await fetch(`${API_URL}/v1/watchlist/move`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw apiErrorFromResponse(res.status, text, res.statusText);
  }
}

export function getListSummary(listId: string, opts: FetchOpts): Promise<ListSummaryResponse> {
  return jsonFetch(
    `/v1/watchlist/list-summary?listId=${encodeURIComponent(listId)}`,
    { method: "GET" },
    opts,
  );
}

// -------- universe progression (Universe Roadmap A1/A3/A4/A5) --------
// The shapes themselves live in ./types.ts (the zod mirror of
// packages/core/src/schemas/index.ts) and are re-exported here so existing
// screen imports keep working. Every endpoint below is additive: the screens
// that read them must render unchanged when the server 404s.

export type {
  DexRarity,
  DexRarityCounts,
  DexResponse,
  DexSector,
  ProgressResponse,
  Quest,
  QuestKind,
  QuestsResponse,
  UniverseSummary,
  UserProgress,
} from "./types";

/** Server-side XP/level/streak. The streak lives here so it survives reinstall. */
export function fetchProgress(opts: FetchOpts = {}): Promise<ProgressResponse> {
  return jsonFetch("/v1/progress", { method: "GET" }, opts);
}

/** The counterfactual universe portfolio — "$100 into every find when found". */
export function fetchUniverseSummary(opts: FetchOpts = {}): Promise<UniverseSummary> {
  return jsonFetch("/v1/universe/summary", { method: "GET" }, opts);
}

/** Collection progress: sector dexes, tiles visited, per-find rarity histogram. */
export function fetchDex(opts: FetchOpts = {}): Promise<DexResponse> {
  return jsonFetch("/v1/dex", { method: "GET" }, opts);
}

/**
 * Today's quest board. Completion is decided server-side from the find stream
 * (roadmap A5) — this is a pure read; the client never posts a completion.
 */
export function fetchQuests(opts: FetchOpts = {}): Promise<QuestsResponse> {
  return jsonFetch("/v1/quests", { method: "GET" }, opts);
}
