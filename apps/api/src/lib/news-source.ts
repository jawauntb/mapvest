import { massiveBaseUrl } from "@mapvest/finance";

/**
 * Per-ticker news source with Massive as the primary provider. Yahoo RSS and
 * Finnhub remain explicit legacy fallbacks while provider parity is proven.
 *
 * The Yahoo endpoint is public XML at
 *   https://finance.yahoo.com/rss/headline?s=<TICKER>
 * so this module works with zero configuration. It is best-effort: on any
 * network / parse failure we return an empty list rather than throwing, so
 * the calling route (or the daily-brief enrichment path) can degrade
 * gracefully.
 *
 * Results are cached in-process for 10 minutes keyed by uppercased ticker,
 * mirroring the pattern in `watchlist-brief.ts`.
 */
export type NewsItem = {
  title: string;
  url: string;
  source: string;
  /** ISO 8601 timestamp. */
  publishedAt: string;
};

export type NewsFetchResult = {
  items: NewsItem[];
  provider: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_UA = "Mozilla/5.0 (compatible; MapvestNewsBot/1.0; +https://mapvest.app)";

type CacheEntry = { expiresAt: number; result: NewsFetchResult };
const cache = new Map<string, CacheEntry>();

/** Exposed for tests — callers should not reach in. */
export function _clearNewsCache(): void {
  cache.clear();
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}

function readCache(ticker: string): NewsFetchResult | null {
  const hit = cache.get(ticker);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(ticker);
    return null;
  }
  return hit.result;
}

function writeCache(ticker: string, result: NewsFetchResult): void {
  cache.set(ticker, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// -------- Yahoo RSS --------

// Very small tag-scoped extractor. We deliberately avoid a general XML parser
// dependency; Yahoo's RSS format is stable and shallow (channel > item*).
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripCdata(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return m?.[1] !== undefined ? m[1] : trimmed;
}

function pickTag(itemXml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = itemXml.match(re);
  if (!m || m[1] === undefined) return undefined;
  const raw = stripCdata(m[1]);
  return decodeXmlEntities(raw).trim() || undefined;
}

function parseYahooRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m = itemRe.exec(xml);
  while (m !== null) {
    const inner = m[1];
    m = itemRe.exec(xml);
    if (!inner) continue;
    const title = pickTag(inner, "title");
    const url = pickTag(inner, "link");
    const pubDate = pickTag(inner, "pubDate");
    if (!title || !url) continue;
    let iso: string;
    if (pubDate) {
      const d = new Date(pubDate);
      iso = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    } else {
      iso = new Date().toISOString();
    }
    items.push({
      title,
      url,
      source: "Yahoo Finance",
      publishedAt: iso,
    });
  }
  return items;
}

async function fetchYahoo(ticker: string): Promise<NewsItem[]> {
  const url = `https://finance.yahoo.com/rss/headline?s=${encodeURIComponent(ticker)}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "User-Agent": DEFAULT_UA,
      },
    },
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`yahoo rss ${res.status}`);
  const xml = await res.text();
  return parseYahooRss(xml);
}

// -------- Finnhub (optional) --------

type FinnhubItem = {
  category?: string;
  datetime?: number; // unix seconds
  headline?: string;
  id?: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
};

async function fetchFinnhub(ticker: string, apiKey: string): Promise<NewsItem[]> {
  // Company news requires a date window. 14-day trailing keeps the list
  // fresh without overloading the response.
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url =
    `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}` +
    `&from=${fmt(from)}&to=${fmt(to)}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(
    url,
    { method: "GET", headers: { Accept: "application/json" } },
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`finnhub ${res.status}`);
  const arr = (await res.json()) as FinnhubItem[];
  if (!Array.isArray(arr)) return [];
  const items: NewsItem[] = [];
  for (const it of arr) {
    if (!it.headline || !it.url) continue;
    const iso =
      typeof it.datetime === "number" && it.datetime > 0
        ? new Date(it.datetime * 1000).toISOString()
        : new Date().toISOString();
    items.push({
      title: it.headline,
      url: it.url,
      source: it.source?.trim() || "Finnhub",
      publishedAt: iso,
    });
  }
  return items;
}

// -------- Massive news --------

type MassiveNewsItem = {
  title?: string;
  article_url?: string;
  publisher?: { name?: string };
  published_utc?: string;
};

async function fetchMassive(ticker: string, apiKey: string): Promise<NewsItem[]> {
  const base = massiveBaseUrl();
  const url = new URL(`${base}/v2/reference/news`);
  url.searchParams.set("ticker", ticker);
  url.searchParams.set("limit", "25");
  url.searchParams.set("order", "desc");
  url.searchParams.set("sort", "published_utc");
  const response = await fetchWithTimeout(
    url.toString(),
    { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` } },
    FETCH_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`massive news ${response.status}`);
  const body = (await response.json()) as {
    status?: string;
    error?: string;
    results?: MassiveNewsItem[];
  };
  if (body.status === "ERROR") throw new Error(body.error || "massive news error");
  if (!Array.isArray(body.results)) return [];
  return body.results.flatMap((item) => {
    if (!item.title || !item.article_url) return [];
    const publishedAt =
      item.published_utc && !Number.isNaN(Date.parse(item.published_utc))
        ? new Date(item.published_utc).toISOString()
        : new Date().toISOString();
    return [
      {
        title: item.title,
        url: item.article_url,
        source: item.publisher?.name?.trim() || "Massive",
        publishedAt,
      },
    ];
  });
}

// -------- Public API --------

/**
 * Fetch recent news for `ticker`. Returns an in-process cached result when
 * fresh (<10 min old). On any provider error, returns `{ items: [], provider }`
 * rather than throwing — callers should treat news as best-effort.
 *
 * @param ticker Case-insensitive ticker; normalized to upper case.
 * @param limit  Max items to return (default 6, cap 25).
 */
export async function fetchTickerNews(ticker: string, limit = 6): Promise<NewsFetchResult> {
  const norm = ticker.trim().toUpperCase();
  if (!norm) return { items: [], provider: "none" };
  const cap = Math.max(1, Math.min(25, Math.floor(limit) || 6));

  pruneExpired();
  const cached = readCache(norm);
  if (cached) {
    return { items: cached.items.slice(0, cap), provider: cached.provider };
  }

  const massiveKey = process.env.MASSIVE_API_KEY?.trim();
  const finnhubKey = process.env.FINNHUB_API_KEY?.trim();
  const primary = (
    process.env.MARKET_DATA_PRIMARY?.trim() || process.env.MARKET_DATA_PROVIDER?.trim()
  )?.toLowerCase();
  let items: NewsItem[] = [];
  let provider = "massive";

  try {
    if (massiveKey && primary !== "yahoo") {
      try {
        items = await fetchMassive(norm, massiveKey);
        provider = "massive";
      } catch {
        if (process.env.MARKET_DATA_FALLBACK_PROVIDER === "finnhub" && finnhubKey) {
          items = await fetchFinnhub(norm, finnhubKey);
          provider = "finnhub";
        } else if (process.env.MARKET_DATA_FALLBACK_PROVIDER === "yahoo") {
          items = await fetchYahoo(norm);
          provider = "yahoo-rss";
        } else {
          throw new Error("massive news unavailable");
        }
      }
    } else if (primary === "yahoo" || process.env.MARKET_DATA_FALLBACK_PROVIDER === "yahoo") {
      items = await fetchYahoo(norm);
      provider = "yahoo-rss";
    } else if (finnhubKey && process.env.MARKET_DATA_FALLBACK_PROVIDER === "finnhub") {
      try {
        items = await fetchFinnhub(norm, finnhubKey);
        provider = "finnhub";
      } catch {
        throw new Error("finnhub news unavailable");
      }
    } else {
      throw new Error("massive news not configured");
    }
  } catch {
    // Silent failure — best-effort. Cache the empty result briefly so we
    // don't hammer a flaky upstream on every request.
    items = [];
    provider = "error";
  }

  // Newest first, defensive sort in case upstream is unordered.
  items.sort((a, b) => {
    const ta = Date.parse(a.publishedAt);
    const tb = Date.parse(b.publishedAt);
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });

  const full: NewsFetchResult = { items, provider };
  if (provider !== "error") writeCache(norm, full);
  return { items: items.slice(0, cap), provider };
}
