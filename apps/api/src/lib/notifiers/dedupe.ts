/**
 * Shared per-notifier dedupe helpers.
 *
 * We store two things:
 *   1. an in-memory ring so a single-process burst can't spam a user, and
 *   2. a durable `last_sent` map on each push token's `prefs` blob so a
 *      restart never resends today's notification.
 *
 * Both layers are consulted in `shouldSend()`. Callers `commitSend()` after
 * a successful push to update the durable side.
 */
import { type PushToken, updatePrefs } from "../push-tokens-store.js";

const memoryDedupe = new Map<string, number>(); // key → expiresAt (ms epoch)

/** yyyy-mm-dd from a Date, in UTC (server clock). */
export function ymd(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** yyyy-mm-dd HH from a Date, in UTC. Used for hourly dedupe (movers). */
export function ymdh(now: Date = new Date()): string {
  const h = String(now.getUTCHours()).padStart(2, "0");
  return `${ymd(now)}${h}`;
}

function pruneMemory(): void {
  const now = Date.now();
  for (const [k, expiresAt] of memoryDedupe) {
    if (expiresAt <= now) memoryDedupe.delete(k);
  }
}

/**
 * Returns true when the notifier should fire for the given dedupe key.
 * Consults both the in-memory ring and the token's stored `last_sent` map.
 */
export function shouldSend(tokens: PushToken[], dedupeSlot: string, key: string): boolean {
  pruneMemory();
  if (memoryDedupe.has(`${dedupeSlot}::${key}`)) return false;
  // Any token that already recorded this send in prefs is enough to block.
  for (const t of tokens) {
    const stored = t.prefs.last_sent?.[dedupeSlot];
    if (stored === key) return false;
  }
  return true;
}

/**
 * Persist that the given dedupe key was consumed. Updates every token's
 * `prefs.last_sent[dedupeSlot] = key`. Best-effort — a persistence failure
 * still marks the in-memory ring so within-process retries are blocked.
 */
export async function commitSend(
  tokens: PushToken[],
  dedupeSlot: string,
  key: string,
  ttlMs: number = 25 * 60 * 60 * 1000, // slightly over a day
): Promise<void> {
  memoryDedupe.set(`${dedupeSlot}::${key}`, Date.now() + ttlMs);
  const byUser = new Map<string, PushToken[]>();
  for (const t of tokens) {
    const arr = byUser.get(t.userId) ?? [];
    arr.push(t);
    byUser.set(t.userId, arr);
  }
  await Promise.all(
    [...byUser.entries()].flatMap(([userId, list]) =>
      list.map((t) =>
        updatePrefs(userId, t.id, { last_sent: { [dedupeSlot]: key } }).catch(() => null),
      ),
    ),
  );
}

/** Test hook. */
export function _resetDedupe(): void {
  memoryDedupe.clear();
}
