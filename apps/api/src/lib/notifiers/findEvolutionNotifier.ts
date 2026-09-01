/**
 * Find-evolution push notifier (Universe Roadmap §1 A2).
 *
 * A find "evolves" when its effective ticker is up +10% / +25% / +50% / +100%
 * versus the `found_price` recorded at catch time. That is the return loop
 * that needs no new catch: you reopen the app because something you physically
 * discovered got more valuable on its own.
 *
 * Runs from the scheduler on the same cadence class as `moverNotifier`
 * (quarter-hourly). For each opted-in user we load their finds, keep the ones
 * with both a `foundPrice` and an effective ticker (`ticker ?? comparable`),
 * fetch one quote per distinct ticker (capped per tick), and push on the
 * highest tier crossed.
 *
 * Dedupe: evolutions are strictly monotonic — a find pushes only when it
 * crosses a tier HIGHER than any tier already pushed for it. One durable slot
 * per find (`evo:{findId}`) stores the highest tier sent, so the shared
 * `prefs.last_sent` map grows by at most one entry per find (not one per
 * find×tier), re-crossing a lower tier after a drawdown fires nothing, and a
 * process restart changes nothing. At most 4 pushes per find, ever.
 *
 * Copy (roadmap A2): personal, spatial, time-anchored — "The Chipotle you
 * spotted near Valencia St is up 26% since you found it". The place clause is
 * best-effort: finds carrying lat/lng get one reverse-geocode lookup (bounded
 * at `MAX_GEOCODES_PER_USER_PER_TICK` uncached requests per user per tick,
 * cache hits free) and anything that fails degrades to the non-spatial line.
 * A place is never invented.
 *
 * Framing (roadmap, non-negotiable): an evolution is a **collection event, not
 * a buy signal**. No copy in this file ever says buy / sell / should / hold.
 */
import type { Find } from "@mapvest/core";
import { getQuote } from "@mapvest/finance";
import { listFinds } from "../finds-store.js";
import { deliverPush } from "../push-dispatcher.js";
import { type PushEventKey, type PushToken, listTokensForEvent } from "../push-tokens-store.js";
import { cachedPlaceLabel, reverseGeocodePlaceLabel } from "../reverse-geocode.js";

/** Opt-in pref key for this notifier (member of `PUSH_EVENT_KEYS`). */
export const FIND_EVOLUTION_EVENT_KEY: PushEventKey = "find_evolution";

/** Ordered high → low so the first match is the highest tier crossed. */
export const EVOLUTION_TIERS = [100, 50, 25, 10] as const;
export type EvolutionTier = (typeof EVOLUTION_TIERS)[number];

/** Most finds we pull per user per tick (newest-first). */
const MAX_FINDS_PER_USER = 200;
/** Most distinct tickers we quote per user per tick — mirrors the mover scan's
 * one-quote-per-distinct-ticker shape, with an explicit ceiling on fan-out. */
const MAX_TICKERS_PER_USER = 50;
/** Most evolution pushes a single user can receive in one tick. Overflow is
 * not dropped — dedupe is only committed on a real send, so an un-pushed tier
 * is picked up on the next tick. */
const MAX_PUSHES_PER_USER_PER_TICK = 3;
/** In-memory dedupe TTL. The durable `prefs.last_sent` entry is what makes the
 * "once ever" guarantee; this just keeps the process-local ring alive long
 * enough that it never expires during a normal uptime window. */
const DEDUPE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Most *uncached* reverse-geocode requests we make per user per tick. The
 * label is a nicety on top of the push, so it gets a hard, small budget —
 * the 24h cache in `reverse-geocode.ts` serves everything else for free. */
const MAX_GEOCODES_PER_USER_PER_TICK = 3;

/**
 * Highest evolution tier crossed by a percentage change since found price.
 * Pure — no I/O, no clock, no state. Returns `null` below +10%, for negative
 * or zero changes, and for any non-finite input.
 */
export function tierForChange(pct: number): EvolutionTier | null {
  if (!Number.isFinite(pct)) return null;
  for (const tier of EVOLUTION_TIERS) {
    if (pct >= tier) return tier;
  }
  return null;
}

/**
 * Percentage change from found price to current price. Pure. Returns `null`
 * when either side is missing, non-finite, or the basis is not positive
 * (AGENTS.md §2.4 — we never invent a basis to make a number appear).
 */
export function pctSinceFound(foundPrice: number, price: number): number | null {
  if (!Number.isFinite(foundPrice) || !Number.isFinite(price)) return null;
  if (foundPrice <= 0) return null;
  return ((price - foundPrice) / foundPrice) * 100;
}

/** Durable dedupe slot for one find. Its stored value is the highest tier sent. */
export function evolutionDedupeKey(findId: string): string {
  return `evo:${findId}`;
}

/**
 * Highest tier already pushed for a slot across the user's tokens, from the
 * durable `prefs.last_sent` map. 0 when nothing was ever sent. Pure over its
 * inputs, so the monotonicity rule is assertable in tests.
 */
export function highestTierRecorded(tokens: Array<Pick<PushToken, "prefs">>, slot: string): number {
  let max = 0;
  for (const t of tokens) {
    const stored = t.prefs.last_sent?.[slot];
    const n = stored === undefined ? Number.NaN : Number.parseInt(stored, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** The effective ticker for a find: its own, else its private→public comparable. */
export function effectiveTicker(find: Pick<Find, "ticker" | "comparable">): string | null {
  const t = (find.ticker ?? find.comparable ?? "").trim();
  return t.length > 0 ? t.toUpperCase() : null;
}

/**
 * Push body. Collection framing only — never buy/sell/should language.
 * Pure so the copy is assertable in tests.
 *
 * With a resolved `place` the copy is personal, spatial and time-anchored —
 * "The Chipotle you spotted near Valencia St is up 26% since you found it".
 * Without one (no coordinates on the find, or the geocode failed) it falls
 * back to the non-spatial line. We never invent a place to make the sentence
 * read better.
 */
export function evolutionBody(brand: string, pct: number, place?: string | null): string {
  const rounded = Math.round(pct);
  const where = typeof place === "string" ? place.trim() : "";
  if (where.length > 0) {
    return `The ${brand} you spotted near ${where} is up ${rounded}% since you found it`;
  }
  return `${brand} evolved — up ${rounded}% since you found it`;
}

/**
 * Finds eligible for an evolution check: a positive basis and a ticker.
 * `foundPrice` is narrowed out of the optional here so the scan never has to
 * re-assert it — a find without a recorded basis is dropped, never estimated.
 */
export function eligibleFinds(
  finds: Find[],
): Array<{ find: Find; ticker: string; foundPrice: number }> {
  const out: Array<{ find: Find; ticker: string; foundPrice: number }> = [];
  for (const find of finds) {
    const foundPrice = find.foundPrice;
    if (typeof foundPrice !== "number" || !Number.isFinite(foundPrice)) continue;
    if (foundPrice <= 0) continue;
    const ticker = effectiveTicker(find);
    if (!ticker) continue;
    out.push({ find, ticker, foundPrice });
  }
  return out;
}

/**
 * Best-effort place label for a find, under a per-user network budget.
 *
 * Cache hits are free — only an uncached cell spends budget, and once the
 * budget is gone the remaining finds simply push without a place clause.
 * Returns the (possibly decremented) budget alongside the label so the caller
 * keeps a single source of truth for it.
 */
async function placeForFind(
  find: Pick<Find, "lat" | "lng">,
  budget: number,
): Promise<{ place: string | null; budget: number }> {
  const { lat, lng } = find;
  if (typeof lat !== "number" || typeof lng !== "number") return { place: null, budget };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { place: null, budget };

  const cached = cachedPlaceLabel(lat, lng);
  if (cached !== undefined) return { place: cached, budget };
  if (budget <= 0) return { place: null, budget };

  const place = await reverseGeocodePlaceLabel(lat, lng);
  return { place, budget: budget - 1 };
}

/**
 * Fan-out scan across every opted-in user. Called from the scheduler.
 * Per-user failures are isolated — one user's bad row never sinks the scan.
 */
export async function runFindEvolutionScan(): Promise<{
  usersScanned: number;
  evolutionsPushed: number;
}> {
  const tokens = await listTokensForEvent(FIND_EVOLUTION_EVENT_KEY);
  if (tokens.length === 0) return { usersScanned: 0, evolutionsPushed: 0 };

  const byUser = new Map<string, PushToken[]>();
  for (const t of tokens) {
    const arr = byUser.get(t.userId) ?? [];
    arr.push(t);
    byUser.set(t.userId, arr);
  }

  let evolutionsPushed = 0;
  for (const [userId, userTokens] of byUser) {
    try {
      const finds = await listFinds(userId, MAX_FINDS_PER_USER);
      const candidates = eligibleFinds(finds);
      if (candidates.length === 0) continue;

      // One quote per distinct ticker, capped. Finds whose ticker falls past
      // the cap this tick are simply re-evaluated on the next tick.
      const uniqueTickers = [...new Set(candidates.map((c) => c.ticker))].slice(
        0,
        MAX_TICKERS_PER_USER,
      );
      const quotes = new Map<string, number>();
      await Promise.all(
        uniqueTickers.map(async (ticker) => {
          const q = await getQuote(ticker).catch(() => null);
          const price = q ? Number(q.price) : Number.NaN;
          if (Number.isFinite(price)) quotes.set(ticker, price);
        }),
      );

      let pushedForUser = 0;
      let geocodeBudget = MAX_GEOCODES_PER_USER_PER_TICK;
      for (const { find, ticker, foundPrice } of candidates) {
        if (pushedForUser >= MAX_PUSHES_PER_USER_PER_TICK) break;
        const price = quotes.get(ticker);
        if (price === undefined) continue;
        const pct = pctSinceFound(foundPrice, price);
        if (pct === null) continue;
        const tier = tierForChange(pct);
        if (tier === null) continue;

        const slot = evolutionDedupeKey(find.id);
        // Monotonic: only a tier strictly above the highest ever pushed fires.
        if (tier <= highestTierRecorded(userTokens, slot)) continue;

        // Geocode only for a find that is actually about to push, so the
        // budget is never burned on finds blocked by dedupe or by tier.
        // eslint-disable-next-line no-await-in-loop
        const geo = await placeForFind(find, geocodeBudget);
        geocodeBudget = geo.budget;

        // eslint-disable-next-line no-await-in-loop
        const result = await deliverPush({
          tokens: userTokens,
          dedupe: [{ slot, key: String(tier), ttlMs: DEDUPE_TTL_MS }],
          eventKey: FIND_EVOLUTION_EVENT_KEY,
          title: `${find.brand} evolved`,
          body: evolutionBody(find.brand, pct, geo.place),
          data: {
            kind: "find_evolution",
            findId: find.id,
            brand: find.brand,
            ticker,
            tier,
            changePct: pct,
            ...(geo.place ? { place: geo.place } : {}),
          },
          target: { type: "company", ticker },
        });
        if (result.successes > 0) {
          pushedForUser += 1;
          evolutionsPushed += 1;
        }
      }
    } catch {
      // Per-user error must not sink other users.
    }
  }

  return { usersScanned: byUser.size, evolutionsPushed };
}
