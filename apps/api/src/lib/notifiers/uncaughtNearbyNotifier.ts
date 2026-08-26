/**
 * Uncaught-nearby arrival push (Universe Roadmap §2 B4).
 *
 * The strongest engagement surface in the roadmap and the easiest one to ruin.
 * When a user's heartbeat shows they moved more than 2km (the same trigger the
 * local-brief branch of `scheduler.ts` already computes — this file never does
 * its own movement detection), we look at what is investable within a short
 * walk of the new fix, subtract everything already in their universe (finds +
 * watchlist), score what is left, and push **at most one** of them.
 *
 * Budget is law, not a tuning knob:
 *   - only the single highest-scoring candidate is considered,
 *   - it must clear `MIN_SCORE`, otherwise the arrival is silent,
 *   - at most one push per move event,
 *   - at most `MAX_PUSHES_PER_DAY` per user per day,
 *   - a ticker that was ever pushed to this user is never pushed again.
 * "A mediocre daily ping trains users to swipe away the great ones."
 *
 * Dedupe uses the shared durable `prefs.last_sent` map through the central
 * claim-aware dispatcher, with USER-SCOPED slots:
 *   - `uncaught:{userId}:{TICKER}` → `"1"` once pushed to this user, ever.
 *   - `uncaught_day:{userId}`      → `"{YYYYMMDD}:{count}"`, the day counter.
 * Both survive a process restart, so a redeploy cannot re-spend the budget.
 *
 * Framing (roadmap, non-negotiable): this is a **collection gap, not a buy
 * signal**. No copy in this file says buy / sell / should / hold, and no
 * distance is ever claimed unless a real one was computed from real
 * coordinates on both sides.
 */
import type { Find, NearbyItem } from "@mapvest/core";
import { canonicalSector, seedBrands } from "@mapvest/finance";
import { type DexSeed, seedTickerSectors, tilesVisited } from "../dex.js";
import { listFinds } from "../finds-store.js";
import { encodeGeohash } from "../geohash.js";
import { safeExecuteWithSpan } from "../logfire.js";
import { distanceM, resolveNearbyItems } from "../nearby-resolve.js";
import { deliverPush } from "../push-dispatcher.js";
import {
  type PushEventKey,
  type PushToken,
  listTokensForUserAndEvent,
} from "../push-tokens-store.js";
import { type WatchEntry, listWatchEntries } from "../watchlist-store.js";
import { ymd } from "./dedupe.js";

/** Opt-in pref key for this notifier (member of `PUSH_EVENT_KEYS`). */
export const UNCAUGHT_NEARBY_EVENT_KEY: PushEventKey = "uncaught_nearby";

/** Arrival radius. Deliberately small — "nearby" has to mean walkable. */
export const NEARBY_RADIUS_M = 800;
/** Places resolved per arrival. Modest: one brand→ticker fan-out per move. */
export const NEARBY_LIMIT = 12;
/** Minimum score a candidate must reach to be worth interrupting someone. */
export const MIN_SCORE = 3;
/** Hard ceiling on uncaught pushes per user per calendar day (UTC). */
export const MAX_PUSHES_PER_DAY = 2;
/** Finds pulled per arrival to build the affinity/tile context. */
const MAX_FINDS = 200;
/** Lease/dedupe retention for the once-ever ticker and daily budget claims. */
const DEDUPE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Stored value of a per-ticker slot once it has been pushed. */
export const PUSHED_MARKER = "1";

// ---------------------------------------------------------------------------
// Pure surface — everything below this line is a function of its arguments.
// ---------------------------------------------------------------------------

/**
 * Durable dedupe slot for one ticker FOR ONE USER. Its presence means
 * "pushed to this user, ever". The userId is part of the slot because the
 * claim-aware dispatcher keys leases by the token and slot, so a user-less
 * slot would make ownership and observability ambiguous.
 */
export function uncaughtDedupeSlot(userId: string, ticker: string): string {
  return `uncaught:${userId}:${ticker.trim().toUpperCase()}`;
}

/** Day-budget slot, user-scoped so one user's budget cannot affect another. */
export function uncaughtDaySlot(userId: string): string {
  return `uncaught_day:${userId}`;
}

/** Stored value of the day-budget slot: the day key and the count spent on it. */
export function dayBudgetValue(dayKey: string, count: number): string {
  return `${dayKey}:${count}`;
}

/**
 * How many uncaught pushes this user has already spent on `dayKey`, read from
 * the durable slot across their tokens. A value stored for a different day
 * reads as zero — the budget resets at the UTC date boundary, it is not aged
 * out by a TTL. Pure over its inputs.
 */
export function pushesToday(
  tokens: Array<Pick<PushToken, "prefs">>,
  dayKey: string,
  daySlot: string,
): number {
  let max = 0;
  for (const t of tokens) {
    const stored = t.prefs.last_sent?.[daySlot];
    if (typeof stored !== "string") continue;
    const sep = stored.lastIndexOf(":");
    if (sep < 0) continue;
    if (stored.slice(0, sep) !== dayKey) continue;
    const n = Number.parseInt(stored.slice(sep + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** GICS-canonical sector, falling back to the trimmed input, else undefined. */
function normSector(input: string | undefined | null): string | undefined {
  const canon = canonicalSector(input);
  if (canon) return canon;
  const trimmed = (input ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Uppercase, trimmed symbol — or null when there isn't one. */
function normTicker(input: string | undefined | null): string | null {
  const t = (input ?? "").trim().toUpperCase();
  return t.length > 0 ? t : null;
}

export type UncaughtCandidate = {
  ticker: string;
  brand: string;
  sector?: string;
  lat: number;
  lng: number;
  /** Real haversine metres from the user's fix — omitted when uncomputable. */
  distanceM?: number;
  /** Intraday % change, only when a real quote was attached to the item. */
  changePct?: number;
  /** True when this ticker already consumed its once-ever push for this user. */
  previouslyPushed: boolean;
};

export type UncaughtScoreContext = {
  /** Sectors the user already collects or watchlists. */
  affinitySectors: ReadonlySet<string>;
  /** Sectors in which the user has at least one find. */
  sectorsWithFinds: ReadonlySet<string>;
  /** True when the user already has a find in this geohash-6 tile. */
  tileHasFinds: boolean;
};

export type ScoredCandidate = {
  candidate: UncaughtCandidate;
  score: number;
  reasons: string[];
};

/**
 * Score one uncaught candidate. PURE — no clock, no store, no network, so the
 * whole ranking policy is assertable in tests.
 *
 *   +2  sector matches a sector the user already finds or watchlists
 *   +2  fills a sector in which the user has zero finds
 *   +1  first-ever find opportunity in this geohash-6 tile
 *   +1  |intraday changePct| > 3, and only when a real quote was attached
 * -100  already pushed to this user (a veto, not a penalty)
 *
 * Affinity and empty-sector are deliberately not exclusive: a sector the user
 * watchlists but has never physically caught scores both, and that is the
 * single best push this notifier can send.
 */
export function scoreCandidate(
  candidate: UncaughtCandidate,
  ctx: UncaughtScoreContext,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const sector = normSector(candidate.sector);
  if (sector && ctx.affinitySectors.has(sector)) {
    score += 2;
    reasons.push("sector_affinity");
  }
  if (sector && !ctx.sectorsWithFinds.has(sector)) {
    score += 2;
    reasons.push("empty_sector");
  }
  if (!ctx.tileHasFinds) {
    score += 1;
    reasons.push("first_in_tile");
  }
  const pct = candidate.changePct;
  if (typeof pct === "number" && Number.isFinite(pct) && Math.abs(pct) > 3) {
    score += 1;
    reasons.push("intraday_move");
  }
  if (candidate.previouslyPushed) {
    score -= 100;
    reasons.push("already_pushed");
  }

  return { score, reasons };
}

/**
 * Build the scoring context from the user's journal and watchlist. Pure over
 * injected data (the seed is a parameter so tests can hand in a two-line map).
 */
export function buildScoreContext(args: {
  finds: Find[];
  watchEntries: WatchEntry[];
  seed: DexSeed;
  fix: { lat: number; lng: number };
}): UncaughtScoreContext {
  const { finds, watchEntries, seed, fix } = args;
  const tickerSectors = seedTickerSectors(seed);

  const sectorsWithFinds = new Set<string>();
  for (const find of finds) {
    const ticker = normTicker(find.ticker) ?? normTicker(find.comparable);
    if (!ticker) continue;
    const sector = normSector(tickerSectors.get(ticker));
    if (sector) sectorsWithFinds.add(sector);
  }

  const affinitySectors = new Set<string>(sectorsWithFinds);
  for (const entry of watchEntries) {
    // Watchlist rows carry their own sector; fall back to the seed by ticker.
    const ticker = normTicker(entry.ticker);
    const sector =
      normSector(entry.sector) ?? (ticker ? normSector(tickerSectors.get(ticker)) : undefined);
    if (sector) affinitySectors.add(sector);
  }

  return {
    affinitySectors,
    sectorsWithFinds,
    tileHasFinds: tilesVisited(finds).has(encodeGeohash(fix.lat, fix.lng, 6)),
  };
}

/**
 * Nearby items → uncaught candidates. Pure: the caller supplies the sets of
 * tickers the user already owns (finds ∪ watchlist) and of tickers already
 * pushed. Non-public items and items without a resolved symbol are dropped —
 * a candidate we cannot name with a real ticker is not a candidate.
 *
 * Deduped by ticker, nearest instance of a chain wins.
 */
export function buildCandidates(args: {
  items: NearbyItem[];
  origin: { lat: number; lng: number };
  ownedTickers: ReadonlySet<string>;
  pushedTickers: ReadonlySet<string>;
}): UncaughtCandidate[] {
  const { items, origin, ownedTickers, pushedTickers } = args;
  const byTicker = new Map<string, UncaughtCandidate>();

  for (const item of items) {
    const investable = item.investable;
    if (!investable?.brand.isPublic) continue;
    const ticker = normTicker(investable.brand.ticker?.symbol);
    if (!ticker) continue;
    if (ownedTickers.has(ticker)) continue;

    const { lat, lng } = item.place.location;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const d =
      Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
        ? distanceM(origin.lat, origin.lng, lat, lng)
        : Number.NaN;
    const changePct = investable.quote?.changePct;

    const candidate: UncaughtCandidate = {
      ticker,
      brand: investable.brand.name,
      sector: investable.brand.sector,
      lat,
      lng,
      ...(Number.isFinite(d) ? { distanceM: d } : {}),
      ...(typeof changePct === "number" && Number.isFinite(changePct) ? { changePct } : {}),
      previouslyPushed: pushedTickers.has(ticker),
    };

    const existing = byTicker.get(ticker);
    if (!existing) {
      byTicker.set(ticker, candidate);
      continue;
    }
    const prev = existing.distanceM ?? Number.POSITIVE_INFINITY;
    const next = candidate.distanceM ?? Number.POSITIVE_INFINITY;
    if (next < prev) byTicker.set(ticker, candidate);
  }

  return [...byTicker.values()];
}

/**
 * The single candidate worth a push, or null. Highest score wins; ties break
 * toward the nearer one. Pure, and the `MIN_SCORE` gate lives here so "silent
 * arrival" is the default outcome rather than an afterthought at the call site.
 */
export function pickWinner(
  candidates: UncaughtCandidate[],
  ctx: UncaughtScoreContext,
): ScoredCandidate | null {
  let best: ScoredCandidate | null = null;
  for (const candidate of candidates) {
    const { score, reasons } = scoreCandidate(candidate, ctx);
    if (score < MIN_SCORE) continue;
    if (best === null || score > best.score) {
      best = { candidate, score, reasons };
      continue;
    }
    if (score === best.score) {
      const bestD = best.candidate.distanceM ?? Number.POSITIVE_INFINITY;
      const thisD = candidate.distanceM ?? Number.POSITIVE_INFINITY;
      if (thisD < bestD) best = { candidate, score, reasons };
    }
  }
  return best;
}

/** Human distance, only ever called with a real measured value. */
function humanDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Push body. Collection framing only — never buy/sell/should language, and
 * never a distance claim unless a real distance was measured from real
 * coordinates. Pure, so the copy is assertable in tests.
 */
export function uncaughtBody(brand: string, ticker: string, meters?: number): string {
  const symbol = ticker.trim().toUpperCase();
  if (typeof meters === "number" && Number.isFinite(meters) && meters >= 0) {
    return `${brand} (${symbol}) is ${humanDistance(meters)} away and isn't in your universe yet`;
  }
  return `${brand} (${symbol}) is nearby and isn't in your universe yet`;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type UncaughtNearbyResult = {
  /** True when the user has at least one token opted into this event. */
  eligible: boolean;
  candidates: number;
  pushed: boolean;
  ticker?: string;
  score?: number;
  reason:
    | "pushed"
    | "no_tokens"
    | "day_budget"
    | "nearby_failed"
    | "no_candidates"
    | "below_threshold"
    | "delivery_failed";
};

/**
 * Arrival handler. Called by the scheduler for a user whose heartbeat moved
 * past the >2km threshold — this function does not decide *that* a user moved,
 * only what (if anything) to say about where they landed.
 *
 * The data fan-out (finds, watchlist, nearby cascade) degrades to a silent
 * arrival on failure. A store or dispatcher failure propagates so the span is
 * recorded as an error — the scheduler isolates it per user, exactly as it
 * already does for the local-brief branch.
 */
export async function onUserMovedFar(
  userId: string,
  fix: { lat: number; lng: number },
): Promise<UncaughtNearbyResult> {
  return safeExecuteWithSpan("notifier.uncaught_nearby", async (span) => {
    span.setAttributes({ user_id: userId });

    const tokens = await listTokensForUserAndEvent(userId, UNCAUGHT_NEARBY_EVENT_KEY);
    if (tokens.length === 0) {
      return { eligible: false, candidates: 0, pushed: false, reason: "no_tokens" as const };
    }

    // Day budget first — it is the cheapest gate and it short-circuits the
    // whole places/ticker fan-out for a user who is already at their cap.
    const dayKey = ymd();
    const spent = pushesToday(tokens, dayKey, uncaughtDaySlot(userId));
    span.setAttributes({ day_key: dayKey, pushes_today: spent });
    if (spent >= MAX_PUSHES_PER_DAY) {
      return { eligible: true, candidates: 0, pushed: false, reason: "day_budget" as const };
    }

    const [finds, watchEntries, nearby] = await Promise.all([
      listFinds(userId, MAX_FINDS).catch(() => [] as Find[]),
      listWatchEntries(userId).catch(() => [] as WatchEntry[]),
      resolveNearbyItems({
        lat: fix.lat,
        lng: fix.lng,
        radius: NEARBY_RADIUS_M,
        limit: NEARBY_LIMIT,
        span,
      }).catch(() => null),
    ]);

    if (!nearby) {
      return { eligible: true, candidates: 0, pushed: false, reason: "nearby_failed" as const };
    }

    const ownedTickers = new Set<string>();
    for (const find of finds) {
      const ticker = normTicker(find.ticker) ?? normTicker(find.comparable);
      if (ticker) ownedTickers.add(ticker);
    }
    for (const entry of watchEntries) {
      const ticker = normTicker(entry.ticker);
      if (ticker) ownedTickers.add(ticker);
    }

    // Which of the surviving tickers already spent their once-ever push.
    const seen = new Set<string>();
    for (const item of nearby.items) {
      const ticker = normTicker(item.investable?.brand.ticker?.symbol);
      if (ticker && !ownedTickers.has(ticker)) seen.add(ticker);
    }
    const pushedTickers = new Set<string>();
    for (const ticker of seen) {
      if (
        tokens.some(
          (token) => token.prefs.last_sent?.[uncaughtDedupeSlot(userId, ticker)] === PUSHED_MARKER,
        )
      )
        pushedTickers.add(ticker);
    }

    const candidates = buildCandidates({
      items: nearby.items,
      origin: fix,
      ownedTickers,
      pushedTickers,
    });
    span.setAttributes({ candidate_count: candidates.length, places_source: nearby.placesSource });
    if (candidates.length === 0) {
      return { eligible: true, candidates: 0, pushed: false, reason: "no_candidates" as const };
    }

    const ctx = buildScoreContext({ finds, watchEntries, seed: seedBrands, fix });
    const winner = pickWinner(candidates, ctx);
    if (!winner) {
      return {
        eligible: true,
        candidates: candidates.length,
        pushed: false,
        reason: "below_threshold" as const,
      };
    }

    const { candidate, score, reasons } = winner;
    span.setAttributes({
      winner_ticker: candidate.ticker,
      winner_score: score,
      winner_reasons: reasons.join(","),
    });

    const result = await deliverPush({
      tokens,
      dedupe: [
        {
          slot: uncaughtDedupeSlot(userId, candidate.ticker),
          key: PUSHED_MARKER,
          ttlMs: DEDUPE_TTL_MS,
        },
        {
          slot: uncaughtDaySlot(userId),
          key: dayBudgetValue(dayKey, spent + 1),
          ttlMs: DEDUPE_TTL_MS,
        },
      ],
      eventKey: UNCAUGHT_NEARBY_EVENT_KEY,
      title: `Uncaught nearby — ${candidate.brand}`,
      body: uncaughtBody(candidate.brand, candidate.ticker, candidate.distanceM),
      data: {
        kind: "uncaught_nearby",
        ticker: candidate.ticker,
        lat: candidate.lat,
        lng: candidate.lng,
      },
    });
    if (result.successes === 0) {
      return {
        eligible: true,
        candidates: candidates.length,
        pushed: false,
        ticker: candidate.ticker,
        score,
        reason: "delivery_failed" as const,
      };
    }

    return {
      eligible: true,
      candidates: candidates.length,
      pushed: true,
      ticker: candidate.ticker,
      score,
      reason: "pushed" as const,
    };
  });
}
