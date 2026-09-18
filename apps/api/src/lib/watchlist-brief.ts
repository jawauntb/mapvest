/**
 * FT-style daily watchlist briefing.
 *
 * Pulls quotes for every ticker on the user's watchlist, builds a compact
 * price/change context string, and asks OpenRouter (gpt-5.6-terra, then
 * claude-opus-4.8, then grok-4.6; see packages/vision and
 * packages/finance/comparable) to produce a Financial Times-style column.
 *
 * Results are cached in-process for 24h keyed by
 *   `${userId}::${yyyymmdd}::${sortedTickersHash}`
 * so the same watchlist on the same UTC day is a single LLM call. Persistent
 * cache is a follow-up (Postgres).
 *
 * Jev pre-filter: before paying for the OpenRouter cascade, a cheap `noul`
 * question asks whether the day's headline batch carries enough new
 * investment-relevant signal to justify a fresh column. When Jev is
 * CONFIDENT there is nothing new (and a previous brief for this exact
 * watchlist exists to reuse), we skip generation and hand back that previous
 * brief instead. Any Jev error, timeout, low-confidence read, or missing
 * previous brief falls through to the existing behavior — always generate.
 * This is a pure cost optimization; it must never be the reason a brief
 * fails to appear.
 */

import { getQuote } from "@mapvest/finance";
import { noul } from "./jev-client.js";
import { type NewsItem, fetchTickerNews } from "./news-source.js";
import { onDailyBriefGenerated } from "./notifiers/dailyBriefNotifier.js";
import { callOpenRouterCascade, stripToJsonObject } from "./openrouter-client.js";
import type { WatchEntry } from "./watchlist-store.js";

export type DailyBrief = {
  headline: string;
  body: string;
  generatedAt: string; // ISO
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PRIMARY_MODEL = "openai/gpt-5.6-terra";
const FALLBACK_MODELS = ["anthropic/claude-opus-4.8", "x-ai/grok-4.6"] as const;
const OPENROUTER_TIMEOUT_MS = 20_000;

type CacheEntry = { expiresAt: number; brief: DailyBrief };
const briefCache = new Map<string, CacheEntry>();

/**
 * Last successfully GENERATED (never a Jev-reused) brief per watchlist,
 * independent of the day it was made — what the Jev pre-filter reuses when
 * it confidently finds no new signal. Not day-scoped like `briefCache`: it
 * has to survive across the UTC-day boundary that invalidates the main cache.
 */
const lastGeneratedBrief = new Map<string, DailyBrief>();

/** Exposed for tests — callers should not reach in. */
export function _clearBriefCache(): void {
  briefCache.clear();
  lastGeneratedBrief.clear();
}

/** Models wrap headlines in **bold** even when we ask for plain text. */
export function stripMdMarks(s: string): string {
  return s
    .trim()
    .replace(/^\*\*(.+)\*\*$/s, "$1")
    .replace(/^__(.+)__$/s, "$1")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .trim();
}

function yyyymmdd(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function tickersHash(tickers: string[]): string {
  return [...tickers]
    .map((t) => t.toUpperCase())
    .sort()
    .join(",");
}

export function briefCacheKey(userId: string, tickers: string[], now: Date): string {
  return `${userId}::${yyyymmdd(now)}::${tickersHash(tickers)}`;
}

/** Day-independent identity for a watchlist — the key `lastGeneratedBrief` uses. */
function watchlistKey(userId: string, tickers: string[]): string {
  return `${userId}::${tickersHash(tickers)}`;
}

function readCache(key: string): DailyBrief | null {
  const hit = briefCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    briefCache.delete(key);
    return null;
  }
  return {
    ...hit.brief,
    headline: stripMdMarks(hit.brief.headline),
    body: stripMdMarks(hit.brief.body),
  };
}

function writeCache(key: string, brief: DailyBrief): void {
  briefCache.set(key, { brief, expiresAt: Date.now() + CACHE_TTL_MS });
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [k, v] of briefCache) {
    if (v.expiresAt <= now) briefCache.delete(k);
  }
}

type QuoteRow = {
  ticker: string;
  name?: string;
  price?: number;
  changePct?: number;
};

async function collectQuoteRows(entries: WatchEntry[]): Promise<QuoteRow[]> {
  return Promise.all(
    entries.map(async (e): Promise<QuoteRow> => {
      const q = await getQuote(e.ticker).catch(() => null);
      const row: QuoteRow = { ticker: e.ticker };
      if (e.name) row.name = e.name;
      if (q) {
        row.price = q.price;
        row.changePct = q.changePct;
      }
      return row;
    }),
  );
}

function contextString(rows: QuoteRow[]): string {
  return rows
    .map((r) => {
      const parts: string[] = [`$${r.ticker}`];
      if (r.name) parts.push(`(${r.name})`);
      if (typeof r.price === "number") parts.push(`$${r.price.toFixed(2)}`);
      if (typeof r.changePct === "number") {
        const sign = r.changePct >= 0 ? "+" : "";
        parts.push(`${sign}${r.changePct.toFixed(2)}%`);
      }
      return parts.join(" ");
    })
    .join("; ");
}

/** Per-ticker news enrichment for the LLM prompt. Best-effort with a hard
 * 2s timeout per ticker; any error or timeout is swallowed silently — a
 * failing news lookup must NEVER break the brief. Caps total headlines at
 * 8 across the whole watchlist so we don't blow up the prompt for a big
 * list. */
const NEWS_PER_TICKER_LIMIT = 2;
const NEWS_TOTAL_LIMIT = 8;
const NEWS_TIMEOUT_MS = 2_000;

async function fetchTopHeadlinesForTicker(ticker: string): Promise<NewsItem[]> {
  try {
    const result = await Promise.race<{ items: NewsItem[] } | null>([
      fetchTickerNews(ticker, NEWS_PER_TICKER_LIMIT),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), NEWS_TIMEOUT_MS)),
    ]);
    if (!result) return [];
    return result.items.slice(0, NEWS_PER_TICKER_LIMIT);
  } catch {
    return [];
  }
}

async function collectHeadlines(
  tickers: string[],
): Promise<Array<{ ticker: string; items: NewsItem[] }>> {
  const results = await Promise.all(
    tickers.map(async (ticker) => ({
      ticker,
      items: await fetchTopHeadlinesForTicker(ticker),
    })),
  );
  // Cap total headlines at NEWS_TOTAL_LIMIT, distributed round-robin so
  // each ticker gets at least one before any second headline is added.
  let total = 0;
  const capped: Array<{ ticker: string; items: NewsItem[] }> = [];
  for (let pass = 0; pass < NEWS_PER_TICKER_LIMIT && total < NEWS_TOTAL_LIMIT; pass++) {
    for (const row of results) {
      if (total >= NEWS_TOTAL_LIMIT) break;
      const item = row.items[pass];
      if (!item) continue;
      const bucket = capped.find((b) => b.ticker === row.ticker);
      if (bucket) {
        bucket.items.push(item);
      } else {
        capped.push({ ticker: row.ticker, items: [item] });
      }
      total++;
    }
  }
  return capped;
}

function headlinesContext(rows: Array<{ ticker: string; items: NewsItem[] }>): string {
  const lines: string[] = [];
  for (const r of rows) {
    if (!r.items.length) continue;
    for (const it of r.items) {
      const when = (() => {
        const t = Date.parse(it.publishedAt);
        if (!Number.isFinite(t)) return "";
        const hoursAgo = Math.max(0, Math.round((Date.now() - t) / (60 * 60 * 1000)));
        if (hoursAgo < 1) return " (just now)";
        if (hoursAgo < 48) return ` (${hoursAgo}h ago)`;
        return ` (${Math.round(hoursAgo / 24)}d ago)`;
      })();
      lines.push(`- $${r.ticker}: ${it.title}${when} [${it.source}]`);
    }
  }
  return lines.join("\n");
}

/**
 * Jev is confident there is no new signal in this headline batch (either
 * direction — see the band below) AND that confident read says "no". Any
 * Jev failure, or an unconfident (middling) read, returns `false` so the
 * caller always falls through to generating — the pre-filter only ever
 * SKIPS work, it never blocks the only path to a brief.
 */
const NO_SIGNAL_MAX = 0.25;
const YES_SIGNAL_MIN = 0.75;

async function hasNoNewSignal(headlineBatch: string): Promise<boolean> {
  const result = await noul(
    headlineBatch,
    "This is a batch of recent headlines for tickers on an investor's watchlist. " +
      "Does this batch contain enough new, investment-relevant signal since the last " +
      "daily briefing to justify writing a fresh one? Answer no if the headlines are " +
      "stale, routine, or immaterial.",
  );
  if (!result.ok) return false;
  const p = result.answer.noul;
  const confident = p <= NO_SIGNAL_MAX || p >= YES_SIGNAL_MIN;
  return confident && p <= NO_SIGNAL_MAX;
}

const SYSTEM_PROMPT = `You are a Financial Times market columnist writing a compact daily briefing for a private investor.
Style: authoritative, third-person, hedged language ("appears to", "traders suggest", "the tape hints"), no exclamation marks, no emojis, no bullet lists.
Structure: one headline (10 words max, plain text — no markdown, no asterisks) and one single paragraph body of 120-180 words.
Reference each ticker as "$SYM" inline (e.g. "$AAPL"). Prefer commentary anchored in the provided price/change data AND the provided headlines. You may cite a headline's angle when relevant, but do not invent facts beyond what is supplied. Write about the tape: dispersion, sector rotation, relative strength, notable moves — and let the headlines shape the narrative when they exist.
Return STRICT JSON only, matching: { "headline": string, "body": string }. No prose outside the JSON. Headline and body are plain text — never wrap them in ** or other markdown.`;

type LLMOutput = { headline: string; body: string };

function parseLLMOutput(raw: string): LLMOutput {
  const parsed = JSON.parse(stripToJsonObject(raw)) as Partial<LLMOutput>;
  const headline = typeof parsed.headline === "string" ? stripMdMarks(parsed.headline) : "";
  const paragraph = typeof parsed.body === "string" ? stripMdMarks(parsed.body) : "";
  if (!headline || !paragraph) {
    throw new Error("LLM returned unexpected shape (missing headline/body)");
  }
  return { headline, body: paragraph };
}

async function callOpenRouter(userContext: string, headlinesBlock: string): Promise<LLMOutput> {
  const userContent = `Watchlist snapshot (provider-routed quotes; freshness is subscription-dependent):\n${userContext}\n\n${
    headlinesBlock ? `Recent headlines (best-effort, may be empty):\n${headlinesBlock}\n\n` : ""
  }Write the daily briefing.`;
  return callOpenRouterCascade({
    models: [PRIMARY_MODEL, ...FALLBACK_MODELS],
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    temperature: 0.4,
    timeoutMs: OPENROUTER_TIMEOUT_MS,
    parse: parseLLMOutput,
    logPrefix: "[watchlist-brief]",
  });
}

/** Canned fallback shapes exported for consistent messaging + tests. */
export const EMPTY_WATCHLIST_BRIEF: Omit<DailyBrief, "generatedAt"> = {
  headline: "Nothing on your watchlist yet.",
  body: "Add a ticker via Save on any detail page to unlock your daily briefing.",
};

export const OUTAGE_BRIEF: Omit<DailyBrief, "generatedAt"> = {
  headline: "Daily briefing offline.",
  body: "The market-commentary service is temporarily unavailable. Your saved tickers and delayed quotes remain accessible on individual detail pages; we'll retry generating your column on your next visit.",
};

/**
 * Produce a fresh (or cached) daily brief for `entries` on behalf of `userId`.
 *
 * Guarantees:
 * - Empty entries → a canned empty-watchlist brief (no LLM call).
 * - Cache hit for `${userId}::${yyyymmdd}::${sortedTickersHash}` → returned as-is.
 * - Cache miss → quotes + LLM call, memoized for 24h.
 *
 * Throws on LLM failure; the caller (route) is expected to catch and return
 * OUTAGE_BRIEF so the endpoint stays 200.
 */
export async function generateWatchlistBrief(params: {
  userId: string;
  entries: WatchEntry[];
  now?: Date;
  /**
   * When false, generation never fires the daily-brief push. Used for
   * on-demand per-list briefs (a user browsing a non-default list) — only
   * the default list's brief may notify. Defaults to true.
   */
  notify?: boolean;
}): Promise<DailyBrief> {
  const now = params.now ?? new Date();
  pruneExpired();

  if (params.entries.length === 0) {
    return { ...EMPTY_WATCHLIST_BRIEF, generatedAt: now.toISOString() };
  }

  const key = briefCacheKey(
    params.userId,
    params.entries.map((e) => e.ticker),
    now,
  );
  const cached = readCache(key);
  if (cached) return cached;

  const rows = await collectQuoteRows(params.entries);
  const context = contextString(rows);
  // Best-effort news enrichment — collectHeadlines already swallows any
  // error per ticker, but wrap the whole call defensively too so a bug
  // in the news module can never break the brief.
  let headlinesBlock = "";
  try {
    const headlineRows = await collectHeadlines(params.entries.map((e) => e.ticker));
    headlinesBlock = headlinesContext(headlineRows);
  } catch {
    headlinesBlock = "";
  }

  const wlKey = watchlistKey(
    params.userId,
    params.entries.map((e) => e.ticker),
  );
  const previous = lastGeneratedBrief.get(wlKey);
  // Only worth asking Jev when there's both a headline batch to judge AND a
  // previous brief to fall back to reusing — with neither, there is nothing
  // to skip generation in favor of.
  if (headlinesBlock && previous && (await hasNoNewSignal(headlinesBlock))) {
    const reused: DailyBrief = { ...previous, generatedAt: now.toISOString() };
    writeCache(key, reused);
    // No push here: nothing new happened since the last briefing, so there
    // is nothing worth notifying the user about.
    return reused;
  }

  const output = await callOpenRouter(context, headlinesBlock);
  const brief: DailyBrief = {
    headline: output.headline,
    body: output.body,
    generatedAt: now.toISOString(),
  };
  writeCache(key, brief);
  lastGeneratedBrief.set(wlKey, brief);
  // Fire-and-forget push. Opted-in tokens receive the brief; dedupe key
  // ensures a same-day cache-hit path doesn't re-notify. Never blocks the
  // primary response — a push failure must never break the brief endpoint.
  if (params.notify !== false) {
    onDailyBriefGenerated(params.userId, brief).catch(() => {
      /* silent — see push-dispatcher for logging */
    });
  }
  return brief;
}
