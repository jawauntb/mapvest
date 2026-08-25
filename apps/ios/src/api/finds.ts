import { DEFAULT_FINDS_LIMIT } from "@/finds/queryKeys";
import { type FetchOpts, apiFetch } from "./http";

export { DEFAULT_FINDS_LIMIT, findsQueryKey, findsQueryKeyPrefix } from "@/finds/queryKeys";

/**
 * Finds journal — every successful identify is recorded server-side for the
 * signed-in user ("things you found, and where"). The server writes finds
 * automatically inside POST /v1/identify; this client only reads them.
 */

export type Find = {
  id: string;
  brand: string;
  /** Public ticker when the brand is listed. */
  ticker?: string;
  isPublic?: boolean;
  /** Closest public cousin when the brand is private. */
  comparable?: string;
  confidence: "high" | "medium" | "low";
  lat?: number;
  lng?: number;
  /** Quote price at the moment of the find, when one was available. */
  foundPrice?: number;
  createdAt: string;
};

/** Ticker, else comparable, else brand — same key the server journal uses. */
export function findIdentityKey(find: Pick<Find, "brand" | "ticker" | "comparable">): string {
  const symbol = (find.ticker ?? find.comparable ?? "").trim().toUpperCase();
  return symbol || find.brand.trim().toUpperCase();
}

/** Newest-first, one card per company. Hides duplicates from older builds. */
export function uniqueFindsNewestFirst(finds: Find[]): Find[] {
  const seen = new Set<string>();
  const out: Find[] = [];
  for (const find of finds) {
    const key = findIdentityKey(find);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(find);
  }
  return out;
}

/**
 * Evolution tiers (Universe Roadmap A2). A find "evolves" as it appreciates
 * since the price it was found at: +10% bronze, +25% silver, +50% gold, +100%
 * gold+. Same thresholds the server notifier uses
 * (`apps/api/src/lib/notifiers/findEvolutionNotifier.ts` — `EVOLUTION_TIERS`),
 * kept as a pure client function so the journal and the map can tint a find
 * without waiting for a push.
 *
 * Framing rule (roadmap, non-negotiable): an evolution is a **collection
 * event, not a buy signal** — tier chrome never implies an action.
 */
export type EvolutionTier = "bronze" | "silver" | "gold" | "gold-plus";

/** Ordered high → low so the first match is the highest tier reached. */
const EVOLUTION_TIER_STEPS: { tier: EvolutionTier; min: number }[] = [
  { tier: "gold-plus", min: 100 },
  { tier: "gold", min: 50 },
  { tier: "silver", min: 25 },
  { tier: "bronze", min: 10 },
];

/**
 * Metal ink for a tier ring. These are deliberately not Atlas Signal tokens —
 * Atlas has no metal ramp, and a bronze/silver/gold ladder has to read as a
 * ladder. Used only as a hairline ring/border, never as a fill.
 */
export const EVOLUTION_TIER_COLORS: Record<EvolutionTier, string> = {
  bronze: "#B87333",
  silver: "#C3CAD2",
  gold: "#E8B94A",
  "gold-plus": "#FFD873",
};

export const EVOLUTION_TIER_LABELS: Record<EvolutionTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  "gold-plus": "Gold+",
};

/** Highest tier reached by a percentage change since found price; null below +10%. */
export function evolutionTierForChange(pct: number | undefined): EvolutionTier | null {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return null;
  for (const step of EVOLUTION_TIER_STEPS) {
    if (pct >= step.min) return step.tier;
  }
  return null;
}

/**
 * Percent change since the find was recorded, or undefined when either side is
 * missing. Finds without a `foundPrice` are never estimated (AGENTS.md §2.4) —
 * they simply have no delta and therefore no tier.
 */
export function changeSinceFoundPct(
  find: Pick<Find, "foundPrice">,
  currentPrice: number | undefined,
): number | undefined {
  const basis = find.foundPrice;
  if (!basis || basis <= 0) return undefined;
  if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice)) return undefined;
  return ((currentPrice - basis) / basis) * 100;
}

export async function listFinds(
  opts: FetchOpts = {},
  limit = DEFAULT_FINDS_LIMIT,
): Promise<{ finds: Find[]; count: number }> {
  const res = await apiFetch<{ finds: Find[]; count: number }>(
    `/v1/finds?limit=${limit}`,
    { method: "GET" },
    opts,
  );
  const finds = uniqueFindsNewestFirst(res.finds);
  return { finds, count: finds.length };
}

/**
 * The streak to render. `GET /v1/progress` is the source of truth (it survives
 * reinstall and counts days in UTC), but it may 404 while the progression
 * store is still shipping — in that case we fall back to the local derivation
 * below so the journal header never goes blank.
 */
export function resolveStreakDays(
  serverStreakDays: number | undefined,
  finds: Find[],
  now = new Date(),
): number {
  return typeof serverStreakDays === "number" ? serverStreakDays : findStreakDays(finds, now);
}

/** Consecutive-day find streak ending today or yesterday, from newest-first finds. */
export function findStreakDays(finds: Find[], now = new Date()): number {
  if (finds.length === 0) return 0;
  const days = new Set(finds.map((f) => new Date(f.createdAt).toDateString()));
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
