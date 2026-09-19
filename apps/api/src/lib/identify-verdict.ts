/**
 * Snap → investable verdict (Jev).
 *
 * After `/v1/identify` resolves every detection to a ticker / parent /
 * comparables / ETFs, ONE batched `systemone` request asks Jev, per
 * detection, a `choice` over how the brand is investable
 * ({ direct, parent, proxy, none }) and a `noul` "is this worth a closer
 * look?". The answers become an optional `verdict` on each `Investable`:
 *
 *   { exposure, probability, worth_a_look: 0..1, watchlisted?: boolean }
 *
 * Safety contract (mirrors ./headline-materiality.ts):
 *   - Fail OPEN. No key, any Jev failure, a timeout, or a confidence below
 *     {@link JEV_MIN_CONFIDENCE} leaves `verdict` off that investable and the
 *     identify response is byte-for-byte what it was before.
 *   - Bounded: at most {@link VERDICT_MAX_DETECTIONS} detections per request,
 *     one Jev call, one short overall timeout.
 *   - Memoized in-process for {@link VERDICT_CACHE_TTL_MS} keyed by a content
 *     hash of the resolution (brand, ticker, parent, comparables, ETFs, rarity,
 *     watchlisted), so re-snapping the same storefront is free.
 */

import { createHash } from "node:crypto";
import type { Investable, InvestableExposure, InvestableVerdict } from "@mapvest/core";
import { JEV_MIN_CONFIDENCE, type JevBatchResult, type JevQuestion, askJev } from "./jev-client.js";

export const VERDICT_MAX_DETECTIONS = 20;
export const VERDICT_CACHE_TTL_MS = 15 * 60 * 1000;
export const VERDICT_FAILURE_TTL_MS = 60 * 1000;
/** The identify response must not wait on Jev longer than this. */
export const VERDICT_TIMEOUT_MS = 4_000;
/** Clients emphasize the watchlist CTA at or above this. */
export const WORTH_A_LOOK_AT = 0.7;
const CACHE_SWEEP_AT = 2_000;
const MAX_COMPARABLES = 3;
const MAX_ETFS = 3;

const EXPOSURES: readonly InvestableExposure[] = ["direct", "parent", "proxy", "none"];

type CacheEntry = { expiresAt: number; value: InvestableVerdict | null };
const cache = new Map<string, CacheEntry>();
let failedUntil = 0;

/** Exposed for tests — callers should not reach in. */
export function _clearVerdictCache(): void {
  cache.clear();
  failedUntil = 0;
}

export type VerdictOptions = {
  /** Tickers on the caller's watchlist, when cheaply known (signed-in callers). */
  watchlist?: ReadonlySet<string>;
  ask?: typeof askJev;
  timeoutMs?: number;
  now?: number;
};

/** What Jev sees for one detection — the resolution, nothing raw from the photo. */
export function verdictStateFor(
  inv: Investable,
  watchlisted: boolean | undefined,
): Record<string, unknown> {
  const ticker = inv.brand.ticker?.symbol;
  return {
    brand: inv.brand.name,
    ...(inv.brand.parent ? { parent: inv.brand.parent } : {}),
    ...(inv.brand.sector ? { sector: inv.brand.sector } : {}),
    is_public: inv.brand.isPublic,
    ...(ticker ? { ticker } : {}),
    ...(inv.brand.ticker?.parent ? { ticker_parent: inv.brand.ticker.parent } : {}),
    comparables: inv.comparables.slice(0, MAX_COMPARABLES).map((c) => ({
      ticker: c.ticker,
      name: c.name,
      score: Math.round(c.score * 100) / 100,
    })),
    etfs: inv.etfs.slice(0, MAX_ETFS).map((e) => ({
      ticker: e.ticker,
      weight: Math.round(e.weight * 1000) / 1000,
    })),
    identification_confidence: inv.confidence,
    ...(inv.rarity ? { rarity: inv.rarity } : {}),
    ...(watchlisted === undefined ? {} : { on_watchlist: watchlisted }),
  };
}

export function verdictCacheKey(inv: Investable, watchlisted: boolean | undefined): string {
  return createHash("sha1")
    .update(JSON.stringify(verdictStateFor(inv, watchlisted)))
    .digest("hex")
    .slice(0, 20);
}

function isExposure(v: unknown): v is InvestableExposure {
  return typeof v === "string" && (EXPOSURES as readonly string[]).includes(v);
}

function clamp01(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

/**
 * PURE. One detection's `choice` + `noul` answers → a verdict, or `null` when
 * the choice is unusable. `probability` is Jev's probability on the chosen
 * exposure (its confidence when the probabilities are not keyed that way).
 * A missing noul leaves `worth_a_look` at 0.5 (unknown), never at 0.
 */
export function verdictFromAnswers(
  choiceAnswer: unknown,
  noulAnswer: unknown,
  watchlisted: boolean | undefined,
): InvestableVerdict | null {
  const choice = choiceAnswer as
    | { type?: unknown; choice?: unknown; probabilities?: unknown; confidence?: unknown }
    | undefined;
  if (!choice || choice.type !== "choice" || !isExposure(choice.choice)) return null;
  if (typeof choice.confidence !== "number" || !Number.isFinite(choice.confidence)) return null;
  if (choice.confidence < JEV_MIN_CONFIDENCE) return null;
  const probs = choice.probabilities as Record<string, unknown> | undefined;
  const p = probs && typeof probs[choice.choice] === "number" ? probs[choice.choice] : undefined;
  const probability = clamp01(typeof p === "number" && Number.isFinite(p) ? p : choice.confidence);
  const noul = noulAnswer as { type?: unknown; noul?: unknown } | undefined;
  const worth =
    noul?.type === "noul" && typeof noul.noul === "number" && Number.isFinite(noul.noul)
      ? clamp01(noul.noul)
      : 0.5;
  return {
    exposure: choice.choice,
    probability,
    worth_a_look: worth,
    ...(watchlisted === undefined ? {} : { watchlisted }),
  };
}

const EXPOSURE_RUBRIC = [
  "direct = the brand itself is the listed company (its own ticker).",
  "parent = the brand is owned by a listed parent company; the ticker is the parent's.",
  "proxy = the brand is private or unlisted, so exposure is only through a comparable public company or an ETF with real exposure.",
  "none = there is no credible public-market exposure to this brand.",
].join(" ");

function questionsFor(ids: string[]): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  for (const id of ids) {
    questions[`exposure_${id}`] = {
      type: "choice",
      instructions: `Look at state.detections["${id}"] — one brand a user photographed and how it resolved to public markets. How is it investable? ${EXPOSURE_RUBRIC}`,
      criteria: { direct: null, parent: null, proxy: null, none: null },
    };
    questions[`look_${id}`] = {
      type: "noul",
      instructions: `For state.detections["${id}"], is this brand worth a closer look as an investment idea for a retail investor — a real, listed or proxy-listed company that is not already on the user's watchlist and has a clear public-market path? Answer the probability that it is.`,
    };
  }
  return questions;
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

/**
 * Attaches `verdict` to each investable Jev could judge confidently and
 * returns a NEW array in the same order. Cached items are answered from
 * memory; the rest go to Jev in one batched call. Never throws; on any
 * failure the input investables come back untouched.
 */
export async function attachInvestableVerdicts(
  investables: Investable[],
  opts: VerdictOptions = {},
): Promise<Investable[]> {
  if (investables.length === 0) return investables;
  const now = opts.now ?? Date.now();
  const ask = opts.ask ?? askJev;

  const keyed = investables.map((inv) => {
    const ticker = inv.brand.ticker?.symbol?.toUpperCase();
    const watchlisted = opts.watchlist && ticker ? opts.watchlist.has(ticker) : undefined;
    return { inv, watchlisted, key: verdictCacheKey(inv, watchlisted) };
  });

  const resolved = new Map<string, InvestableVerdict | null>();
  const pending: Array<(typeof keyed)[number]> = [];
  for (const entry of keyed) {
    const hit = cache.get(entry.key);
    if (hit && hit.expiresAt > now) {
      resolved.set(entry.key, hit.value);
      continue;
    }
    if (pending.some((p) => p.key === entry.key)) continue;
    if (pending.length >= VERDICT_MAX_DETECTIONS) continue;
    pending.push(entry);
  }

  if (pending.length > 0 && process.env.JEV_API_KEY && failedUntil <= now) {
    const ids = pending.map((_, i) => `d${i}`);
    const state = {
      detections: Object.fromEntries(
        pending.map((p, i) => [ids[i], verdictStateFor(p.inv, p.watchlisted)]),
      ),
    };
    let result: JevBatchResult | null = null;
    try {
      result = await withTimeout(
        ask(state, questionsFor(ids)),
        opts.timeoutMs ?? VERDICT_TIMEOUT_MS,
      );
    } catch {
      result = null;
    }
    if (!result || !result.ok) {
      failedUntil = now + VERDICT_FAILURE_TTL_MS;
    } else {
      if (cache.size >= CACHE_SWEEP_AT) {
        for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
      }
      pending.forEach((p, i) => {
        const value = verdictFromAnswers(
          result?.answers[`exposure_${ids[i]}`],
          result?.answers[`look_${ids[i]}`],
          p.watchlisted,
        );
        resolved.set(p.key, value);
        cache.set(p.key, { value, expiresAt: now + VERDICT_CACHE_TTL_MS });
      });
    }
  }

  return keyed.map(({ inv, key }) => {
    const verdict = resolved.get(key);
    return verdict ? { ...inv, verdict } : inv;
  });
}
