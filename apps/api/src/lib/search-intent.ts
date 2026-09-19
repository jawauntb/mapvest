/**
 * Search intent routing (`POST /v1/search/intent`).
 *
 * The Home search box used to accept only ticker-shaped input. This decides,
 * for any free-text query, whether the user meant a ticker, a brand, a place,
 * or a question — and where the client should go:
 *
 *   ticker   → detail { id: SYMBOL }
 *   brand    → detail { id: SYMBOL (seed hit) | brand text }
 *   place    → map    { q }
 *   question → research { q }
 *
 * Order of decision (cheap → expensive):
 *   1. Deterministic: question shape; cashtag / ticker shape + a live-quote
 *      check; a `brands.json` seed hit (direct, then longest substring);
 *      obvious place words or geo hints.
 *   2. Jev: ONE `choice` over { ticker, brand, place, question } for the
 *      ambiguous remainder, only with a confident answer (>= 0.55).
 *   3. Fail open: `intent: "ticker"` with today's behavior (open the detail
 *      sheet for the raw text, which resolves brands itself).
 *
 * Results are memoized per normalized query for {@link INTENT_CACHE_TTL_MS}.
 * Never throws.
 */

import type { SearchIntentName, SearchIntentResponse } from "@mapvest/core";
import { getQuote, normalizeBrand, seedBrands } from "@mapvest/finance";
import { JEV_MIN_CONFIDENCE, askJev } from "./jev-client.js";

export const INTENT_CACHE_TTL_MS = 5 * 60 * 1000;
/** A live-quote check is a cheap disambiguator, but never a stall. */
export const INTENT_QUOTE_TIMEOUT_MS = 1_500;
export const INTENT_JEV_TIMEOUT_MS = 3_000;
const MAX_QUERY_CHARS = 200;
const CACHE_SWEEP_AT = 2_000;
/** Seed keys shorter than this are skipped for substring matches ("gap", "bp"). */
const MIN_SUBSTRING_KEY = 4;

const TICKER_RE = /^[A-Z][A-Z0-9.]{0,5}$/;
const QUESTION_LEAD_RE =
  /^(what|what's|whats|why|how|when|where|which|who|should|is|are|can|could|does|do|will|would|explain|compare|tell me|give me)\b/i;
/** An explicit locator wins even over a known brand: "starbucks near me" is a place search. */
const LOCATOR_RE =
  /\b(near me|nearby|around here|around me|close to me|closest|nearest|open now|walking distance)\b/i;
/** Venue categories — only consulted once the brand seed has had its say. */
const PLACE_WORDS_RE =
  /\b(restaurants?|cafes?|caf[eé]s?|diners?|stores?|shops?|malls?|grocery|groceries|supermarkets?|pharmacy|pharmacies|gas stations?|hotels?|motels?|bakery|bakeries|gyms?|downtown|main street|street|avenue|ave\.?|blvd|boulevard|plaza|square|park|airport|station|neighborhood|district)\b/i;
const PLACE_PREPOSITION_RE = /\b(in|near|around|on|at|by)\b/i;

export type SearchIntentInput = { q: string; lat?: number; lng?: number };

export type SearchIntentDeps = {
  /** Live-quote probe: resolves truthy when `symbol` is a real listed ticker. */
  quote?: (symbol: string) => Promise<unknown>;
  ask?: typeof askJev;
  now?: number;
};

type CacheEntry = { expiresAt: number; value: SearchIntentResponse };
const cache = new Map<string, CacheEntry>();

/** Exposed for tests — callers should not reach in. */
export function _clearSearchIntentCache(): void {
  cache.clear();
}

export function normalizeQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
}

/** Typed ticker — MCD, BRK.B, $NVDA — as a symbol, else `undefined`. */
export function tickerShape(q: string): string | undefined {
  const u = q.trim().replace(/^\$/, "").toUpperCase();
  return TICKER_RE.test(u) ? u : undefined;
}

export function isQuestion(q: string): boolean {
  const t = q.trim();
  if (t.endsWith("?")) return true;
  return QUESTION_LEAD_RE.test(t) && t.split(" ").length >= 3;
}

export function hasLocator(q: string): boolean {
  return LOCATOR_RE.test(q);
}

export function looksLikePlace(q: string, hasGeo: boolean): boolean {
  if (LOCATOR_RE.test(q) || PLACE_WORDS_RE.test(q)) return true;
  return hasGeo && q.split(" ").length >= 2 && PLACE_PREPOSITION_RE.test(q);
}

type SeedHit = { key: string; ticker: string };

/** Direct seed-key hit, then the longest substring key (>= 4 chars). */
export function seedLookup(q: string): SeedHit | undefined {
  const key = normalizeBrand(q);
  const direct = seedBrands[key];
  if (direct) return { key, ticker: direct.ticker };
  let bestKey = "";
  let best: SeedHit | undefined;
  for (const [k, entry] of Object.entries(seedBrands)) {
    if (k.length < MIN_SUBSTRING_KEY) continue;
    if (!key.includes(k)) continue;
    if (k.length > bestKey.length) {
      bestKey = k;
      best = { key: k, ticker: entry.ticker };
    }
  }
  return best;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

type Method = SearchIntentResponse["method"];

function tickerIntent(symbol: string, probability: number, method: Method): SearchIntentResponse {
  return {
    intent: "ticker",
    probability: round(probability),
    resolved: { symbol },
    route: { screen: "detail", params: { id: symbol } },
    method,
  };
}

function brandIntent(
  brand: string,
  symbol: string | undefined,
  probability: number,
  method: Method,
): SearchIntentResponse {
  return {
    intent: "brand",
    probability: round(probability),
    resolved: { brand, ...(symbol ? { symbol } : {}) },
    route: { screen: "detail", params: { id: symbol ?? brand } },
    method,
  };
}

function placeIntent(q: string, probability: number, method: Method): SearchIntentResponse {
  return {
    intent: "place",
    probability: round(probability),
    resolved: { placeQuery: q },
    route: { screen: "map", params: { q } },
    method,
  };
}

function questionIntent(q: string, probability: number, method: Method): SearchIntentResponse {
  return {
    intent: "question",
    probability: round(probability),
    resolved: {},
    route: { screen: "research", params: { q } },
    method,
  };
}

/** Today's behavior: treat the text as a ticker/brand and open the detail sheet. */
export function fallbackIntent(q: string): SearchIntentResponse {
  const symbol = tickerShape(q);
  return {
    intent: "ticker",
    probability: 0.5,
    resolved: symbol ? { symbol } : {},
    route: { screen: "detail", params: { id: symbol ?? q } },
    method: "fallback",
  };
}

function isIntent(v: unknown): v is SearchIntentName {
  return v === "ticker" || v === "brand" || v === "place" || v === "question";
}

/** Maps a confident Jev pick onto a response, using only deterministic resolution. */
export function intentFromChoice(
  q: string,
  choice: SearchIntentName,
  probability: number,
): SearchIntentResponse {
  switch (choice) {
    case "ticker": {
      const symbol = tickerShape(q);
      return symbol
        ? tickerIntent(symbol, probability, "jev")
        : brandIntent(q, undefined, probability, "jev");
    }
    case "brand":
      return brandIntent(q, seedLookup(q)?.ticker, probability, "jev");
    case "place":
      return placeIntent(q, probability, "jev");
    case "question":
      return questionIntent(q, probability, "jev");
    default:
      return fallbackIntent(q);
  }
}

/**
 * The deterministic first pass. Returns `null` for the ambiguous remainder.
 * `quoteHit` is the live-quote probe result for a ticker-shaped query.
 */
export function deterministicIntent(
  q: string,
  opts: { hasGeo: boolean; cashtag: boolean; quoteHit: boolean },
): SearchIntentResponse | null {
  const symbol = tickerShape(q);
  if (opts.cashtag && symbol) return tickerIntent(symbol, 0.97, "deterministic");
  if (isQuestion(q)) return questionIntent(q, 0.9, "deterministic");
  if (symbol && opts.quoteHit) return tickerIntent(symbol, 0.95, "deterministic");
  const direct = seedBrands[normalizeBrand(q)];
  if (direct) return brandIntent(q, direct.ticker, 0.95, "deterministic");
  // "starbucks near me" is a place search even though Starbucks is a brand.
  if (hasLocator(q)) return placeIntent(q, 0.9, "deterministic");
  // "burger king drive thru" is the brand even though it mentions a venue.
  const sub = seedLookup(q);
  if (sub) return brandIntent(q, sub.ticker, 0.8, "deterministic");
  if (looksLikePlace(q, opts.hasGeo)) return placeIntent(q, 0.85, "deterministic");
  return null;
}

async function decide(
  input: SearchIntentInput,
  q: string,
  deps: SearchIntentDeps,
): Promise<SearchIntentResponse> {
  const hasGeo = typeof input.lat === "number" && typeof input.lng === "number";
  const cashtag = input.q.trim().startsWith("$");
  const symbol = tickerShape(q);
  let quoteHit = false;
  if (symbol && !cashtag && !isQuestion(q)) {
    const probe = deps.quote ?? getQuote;
    quoteHit = Boolean(await withTimeout(probe(symbol), INTENT_QUOTE_TIMEOUT_MS));
  }
  const bare = q.replace(/^\$/, "");
  const decided = deterministicIntent(bare, { hasGeo, cashtag, quoteHit });
  if (decided) return decided;

  if (!process.env.JEV_API_KEY) return fallbackIntent(bare);
  const ask = deps.ask ?? askJev;
  const result = await withTimeout(
    ask(
      {
        query: bare,
        has_device_location: hasGeo,
        looks_like_ticker: Boolean(symbol),
        listed_ticker_check: symbol ? (quoteHit ? "hit" : "miss") : "n/a",
        known_brand: false,
        word_count: bare.split(" ").length,
      },
      {
        intent: {
          type: "choice",
          instructions:
            "A user typed state.query into the search box of an investing app that can open a company page (ticker or brand), a map of nearby places, or a research chat. Classify what they meant. ticker = a stock symbol. brand = a company or brand name (a store, product, chain). place = a location, neighborhood, or kind of place to find nearby. question = a free-form question or request for analysis.",
          criteria: { ticker: null, brand: null, place: null, question: null },
        },
      },
    ),
    INTENT_JEV_TIMEOUT_MS,
  );
  if (!result || !result.ok) return fallbackIntent(bare);
  const answer = result.answers.intent;
  if (!answer || answer.type !== "choice" || !isIntent(answer.choice)) return fallbackIntent(bare);
  if (answer.confidence < JEV_MIN_CONFIDENCE) return fallbackIntent(bare);
  const p = answer.probabilities?.[answer.choice];
  const probability =
    typeof p === "number" && Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : answer.confidence;
  return intentFromChoice(bare, answer.choice, probability);
}

/**
 * Resolve the intent of `input.q`. Never throws — every failure path lands on
 * {@link fallbackIntent}. Memoized per normalized query (+ whether a device
 * location was supplied, since that changes the place heuristics).
 */
export async function resolveSearchIntent(
  input: SearchIntentInput,
  deps: SearchIntentDeps = {},
): Promise<SearchIntentResponse> {
  const q = normalizeQuery(input.q);
  if (!q) return fallbackIntent("");
  const now = deps.now ?? Date.now();
  const hasGeo = typeof input.lat === "number" && typeof input.lng === "number";
  const key = `${q.toLowerCase()}|${hasGeo ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  let value: SearchIntentResponse;
  try {
    value = await decide(input, q, deps);
  } catch {
    value = fallbackIntent(q.replace(/^\$/, ""));
  }
  if (cache.size >= CACHE_SWEEP_AT) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  }
  // A fail-open fallback is not remembered: the next keystroke should get a
  // real answer once Jev / the quote provider is back.
  if (value.method !== "fallback") cache.set(key, { value, expiresAt: now + INTENT_CACHE_TTL_MS });
  return value;
}
