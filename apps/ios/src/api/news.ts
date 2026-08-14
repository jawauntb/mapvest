import { getDeviceId } from "@/util/deviceId";
import { API_URL } from "@/util/env";

/**
 * Per-ticker news feed. Intentionally standalone — does NOT import from
 * `./client` because the news feature is a slice-owned module and I want
 * the two paths independently changeable during the news iteration.
 * When the shared `jsonFetch` in client.ts moves to a shared `http.ts`,
 * this file will switch to that import in a single line.
 */

export type NewsItem = {
  title: string;
  url: string;
  source: string;
  /** ISO 8601 timestamp. */
  publishedAt: string;
};

export type NewsResponse = {
  items: NewsItem[];
  provider: string;
  ts: string;
};

type FetchOpts = {
  token?: string;
  signal?: AbortSignal;
};

class NewsFetchError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "NewsFetchError";
  }
}

async function jsonGet<T>(path: string, opts: FetchOpts): Promise<T> {
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  try {
    headers.set("X-Device-Id", await getDeviceId());
  } catch {
    /* SecureStore unavailable — request proceeds without device id */
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: "GET",
    headers,
    signal: opts.signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string" && j.error.trim()) msg = j.error;
    } catch {
      /* plain-text body */
    }
    throw new NewsFetchError(res.status, msg);
  }
  return (await res.json()) as T;
}

/**
 * Fetch a list of recent headlines for `ticker`. The API caches per-ticker
 * results for ~10 minutes; a 200 response with an empty `items` array
 * indicates the upstream provider errored or returned nothing — callers
 * should render an empty state, not an error.
 */
export type NewsRead = {
  title?: string;
  url: string;
  text: string;
  source: "exa";
  fetchedAt: string;
  error?: "unavailable";
};

export function fetchNewsRead(url: string, opts: FetchOpts = {}): Promise<NewsRead> {
  const params = new URLSearchParams({ url });
  return jsonGet<NewsRead>(`/v1/news/read?${params.toString()}`, opts);
}

export function fetchTickerNews(
  ticker: string,
  opts: FetchOpts & { limit?: number } = {},
): Promise<NewsResponse> {
  const params = new URLSearchParams({ ticker });
  if (typeof opts.limit === "number" && opts.limit > 0) {
    params.set("limit", String(Math.min(25, Math.floor(opts.limit))));
  }
  return jsonGet<NewsResponse>(`/v1/news?${params.toString()}`, {
    token: opts.token,
    signal: opts.signal,
  });
}
