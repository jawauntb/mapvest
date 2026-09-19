/**
 * Jev-scored materiality tags for headlines.
 *
 * Given a page of headlines (a watchlist feed, or one ticker's `/v1/news`
 * list), asks Jev ONE batched `choice` question per headline — all in a single
 * `systemone` request per chunk of {@link MATERIALITY_BATCH_SIZE} — and turns
 * each answer into an optional `jev_materiality` tag:
 *
 *   { level: "noise" | "minor" | "material", score: 0..1, confidence: 0..1 }
 *
 * `level` is Jev's pick, `confidence` is Jev's own calibration on that pick,
 * and `score` is the probability-weighted position of the headline on the
 * noise → material axis (0 = certainly noise, 1 = certainly material), so a
 * client can sort by it without re-deriving anything from `probabilities`.
 *
 * Safety contract (mirrors the watchlist pre-filter in ./watchlist-brief.ts):
 *   - Fail OPEN. A missing `JEV_API_KEY`, any network/HTTP error, a timeout,
 *     an unparseable answer, or a confidence below {@link JEV_MIN_CONFIDENCE}
 *     simply leaves the tag off that headline. Nothing here throws, and a
 *     Jev failure can never remove a headline from a response.
 *   - A materiality FILTER keeps unscored headlines: "no score" means "we do
 *     not know", never "noise".
 *   - Results are memoized in-process for {@link MATERIALITY_CACHE_TTL_MS}
 *     keyed by the headline's url + a content hash, so list polling does not
 *     re-score identical headlines; a failed batch is remembered for
 *     {@link MATERIALITY_FAILURE_TTL_MS} so a Jev outage is not re-tried on
 *     every poll.
 */

import { createHash } from "node:crypto";
import { JEV_MIN_CONFIDENCE, type JevQuestion, askJev } from "./jev-client.js";

export const MATERIALITY_LEVELS = ["noise", "minor", "material"] as const;
export type MaterialityLevel = (typeof MATERIALITY_LEVELS)[number];

export type JevMateriality = {
  level: MaterialityLevel;
  /** Probability-weighted position on the noise→material axis, 0..1. */
  score: number;
  /** Jev's confidence in `level`; always >= JEV_MIN_CONFIDENCE when present. */
  confidence: number;
};

/** The minimum a headline needs for scoring. `id` must be unique in the page. */
export type ScorableHeadline = {
  id: string;
  title: string;
  ticker?: string;
  source?: string;
  publishedAt?: string;
};

/** Keep one `state` well under ~20k tokens (JEV_SPEC). */
export const MATERIALITY_BATCH_SIZE = 50;
export const MATERIALITY_CACHE_TTL_MS = 15 * 60 * 1000;
export const MATERIALITY_FAILURE_TTL_MS = 60 * 1000;
/** Prune the memo once it grows past this, before any new insert. */
const CACHE_SWEEP_AT = 2_000;

/** `null` = scored and unusable (low confidence) — cached so it is not re-asked. */
type CacheEntry = { expiresAt: number; value: JevMateriality | null };
const cache = new Map<string, CacheEntry>();
let failedUntil = 0;

/** Exposed for tests — callers should not reach in. */
export function _clearMaterialityCache(): void {
  cache.clear();
  failedUntil = 0;
}

function contentHash(h: ScorableHeadline): string {
  return createHash("sha1")
    .update(`${h.ticker ?? ""}|${h.title}|${h.source ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/** Stable per-headline memo key: the id (normally the url) + a content hash. */
export function materialityCacheKey(h: ScorableHeadline): string {
  return `${h.id}::${contentHash(h)}`;
}

function readCache(key: string, now: number): CacheEntry | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return hit;
}

function writeCache(key: string, value: JevMateriality | null, now: number): void {
  if (cache.size >= CACHE_SWEEP_AT) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  }
  cache.set(key, { value, expiresAt: now + MATERIALITY_CACHE_TTL_MS });
}

const LEVEL_POSITION: Record<MaterialityLevel, number> = { noise: 0, minor: 0.5, material: 1 };

function isLevel(v: unknown): v is MaterialityLevel {
  return typeof v === "string" && (MATERIALITY_LEVELS as readonly string[]).includes(v);
}

/** Clamp to [0,1] and round to 3 places — a wire field, not a float dump. */
function clamp01(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

/**
 * Turns one Jev `choice` answer into a tag, or `null` when it is unusable.
 * `score` prefers the probability-weighted position when Jev's probabilities
 * are keyed by level name; otherwise it falls back to the chosen level's own
 * position so the field is always populated alongside `level`.
 */
export function materialityFromAnswer(answer: unknown): JevMateriality | null {
  if (!answer || typeof answer !== "object") return null;
  const a = answer as {
    type?: unknown;
    choice?: unknown;
    probabilities?: unknown;
    confidence?: unknown;
  };
  if (a.type !== "choice" || !isLevel(a.choice)) return null;
  if (typeof a.confidence !== "number" || !Number.isFinite(a.confidence)) return null;
  if (a.confidence < JEV_MIN_CONFIDENCE) return null;

  let score = LEVEL_POSITION[a.choice];
  const probs = a.probabilities;
  if (probs && typeof probs === "object") {
    let mass = 0;
    let weighted = 0;
    for (const level of MATERIALITY_LEVELS) {
      const p = (probs as Record<string, unknown>)[level];
      if (typeof p === "number" && Number.isFinite(p) && p >= 0) {
        mass += p;
        weighted += p * LEVEL_POSITION[level];
      }
    }
    if (mass > 0) score = weighted / mass;
  }
  return { level: a.choice, score: clamp01(score), confidence: clamp01(a.confidence) };
}

const MATERIALITY_RUBRIC = [
  "material = a specific, new development that could plausibly move the position (earnings, guidance,",
  "M&A, regulatory action, major contract, management change, product recall, analyst re-rating).",
  "minor = related to the company but incremental, routine, or already known.",
  "noise = listicles, generic market recaps, opinion pieces, promotional or unrelated content.",
].join(" ");

/** The headline itself lives in `state.headlines[qid]`; the question only points at it. */
function questionFor(qid: string, tickers: string[]): JevQuestion {
  const who = tickers.length
    ? `an investor whose watchlist holds ${tickers.map((t) => `$${t}`).join(", ")}`
    : "an investor tracking this company";
  return {
    type: "choice",
    instructions: `Look at the headline with id "${qid}" in state.headlines. For ${who}, how material is it? ${MATERIALITY_RUBRIC}`,
    criteria: { noise: null, minor: null, material: null },
  };
}

/**
 * One batched `systemone` call for up to {@link MATERIALITY_BATCH_SIZE}
 * headlines. Returns a map keyed by cache key; a failed call returns an empty
 * map (fail open). Never throws.
 */
async function scoreChunk(
  chunk: ScorableHeadline[],
  tickers: string[],
): Promise<{ ok: boolean; results: Map<string, JevMateriality | null> }> {
  const results = new Map<string, JevMateriality | null>();
  if (chunk.length === 0) return { ok: true, results };
  const questions: Record<string, JevQuestion> = {};
  const state = {
    tickers,
    headlines: chunk.map((h, i) => ({
      id: `h${i}`,
      ...(h.ticker ? { ticker: h.ticker } : {}),
      title: h.title,
      ...(h.source ? { source: h.source } : {}),
      ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}),
    })),
  };
  for (let i = 0; i < chunk.length; i++) questions[`h${i}`] = questionFor(`h${i}`, tickers);

  let batch: Awaited<ReturnType<typeof askJev>>;
  try {
    batch = await askJev(state, questions);
  } catch {
    return { ok: false, results };
  }
  if (!batch.ok) return { ok: false, results };
  for (const [i, h] of chunk.entries()) {
    results.set(materialityCacheKey(h), materialityFromAnswer(batch.answers[`h${i}`]));
  }
  return { ok: true, results };
}

/**
 * Scores `headlines` and returns `{ [headline.id]: JevMateriality }` for the
 * ones Jev could tag confidently. Ids absent from the result are unscored —
 * the caller leaves `jev_materiality` off those items and keeps them.
 *
 * Cached headlines are answered from memory; only uncached ones go to Jev,
 * in chunks of {@link MATERIALITY_BATCH_SIZE}. Never throws.
 */
export async function scoreHeadlineMateriality(
  headlines: ScorableHeadline[],
  tickers: string[] = [],
  now: number = Date.now(),
): Promise<Record<string, JevMateriality>> {
  const out: Record<string, JevMateriality> = {};
  if (headlines.length === 0) return out;

  const pending: ScorableHeadline[] = [];
  const seen = new Set<string>();
  for (const h of headlines) {
    if (!h.id || !h.title) continue;
    const key = materialityCacheKey(h);
    const hit = readCache(key, now);
    if (hit) {
      if (hit.value) out[h.id] = hit.value;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(h);
  }
  if (pending.length === 0) return out;
  // No key at all → nothing to ask; leave every item unscored (rule 1).
  if (!process.env.JEV_API_KEY) return out;
  if (failedUntil > now) return out;

  const uniqueTickers = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const scored = new Map<string, JevMateriality | null>();
  for (let i = 0; i < pending.length; i += MATERIALITY_BATCH_SIZE) {
    const chunk = pending.slice(i, i + MATERIALITY_BATCH_SIZE);
    const { ok, results } = await scoreChunk(chunk, uniqueTickers);
    if (!ok) {
      failedUntil = now + MATERIALITY_FAILURE_TTL_MS;
      break;
    }
    for (const [k, v] of results) scored.set(k, v);
  }
  for (const [k, v] of scored) writeCache(k, v, now);
  for (const h of headlines) {
    if (h.id in out) continue;
    const v = scored.get(materialityCacheKey(h));
    if (v) out[h.id] = v;
  }
  return out;
}

/** `?materiality=` values a client may send; anything else is ignored. */
export function parseMaterialityFloor(raw: string | undefined | null): MaterialityLevel | null {
  const value = (raw ?? "").trim().toLowerCase();
  return isLevel(value) ? value : null;
}

/**
 * Keeps items whose KNOWN level is at or above `floor`, and every item with
 * no `jev_materiality` at all (rule 1: an unscored item is never filtered
 * out). `floor === null` returns the list untouched.
 */
export function filterByMateriality<T extends { jev_materiality?: JevMateriality }>(
  items: T[],
  floor: MaterialityLevel | null,
): T[] {
  if (!floor) return items;
  const min = MATERIALITY_LEVELS.indexOf(floor);
  return items.filter((it) => {
    const level = it.jev_materiality?.level;
    if (!level) return true;
    return MATERIALITY_LEVELS.indexOf(level) >= min;
  });
}
