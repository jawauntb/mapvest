/**
 * Shared date-key helpers for notifiers. Delivery dedupe and ownership are
 * centralized in `push-tokens-store.ts`/`push-dispatcher.ts`; keeping the
 * old per-notifier memory ring here would re-open cross-notifier races.
 */

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
