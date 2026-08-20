/**
 * Finds journal — every successful identify is recorded server-side for the
 * signed-in user ("things you found, and where"). The server writes finds
 * automatically inside POST /v1/identify; this client only reads them.
 */
import { type FetchOpts, apiFetch } from "./http";

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

export async function listFinds(
  opts: FetchOpts = {},
  limit = 100,
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
