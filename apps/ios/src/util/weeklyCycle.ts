/**
 * Shared weekly-cycle boundary math — client mirror.
 *
 * Every weekly mechanic — quests, the leaderboard, and the co-op tile raid —
 * resets on the same clock: **Saturday 12:00 UTC**. This is the one place
 * that boundary is computed on the client; screens never recompute it
 * independently. It mirrors `apps/api/src/lib/weeklyCycle.ts` exactly (same
 * constants, same math) so a "Closes in Nd Nh" countdown never drifts from
 * when the server actually closes the round — keep the two in sync if this
 * boundary ever changes.
 *
 * The boundary is anchored to UTC, never device-local time, so a user in any
 * timezone sees the same close as everyone else.
 */

/** UTC day-of-week the cycle closes on (0=Sun … 6=Sat). */
export const CYCLE_CLOSE_UTC_DAY = 6;
/** UTC hour the cycle closes at (24h, minute/second always :00:00). */
export const CYCLE_CLOSE_UTC_HOUR = 12;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The Saturday-12:00-UTC instant at or after `now`. Pure.
 *
 * At the boundary instant itself this returns `now` unchanged — the closing
 * tick is treated as the last instant of the cycle it closes, not the first
 * instant of the next one, so `msUntilClose` never goes negative.
 */
function nextCloseAtOrAfter(now: Date): Date {
  const close = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      CYCLE_CLOSE_UTC_HOUR,
      0,
      0,
      0,
    ),
  );
  const daysUntilSaturday = (CYCLE_CLOSE_UTC_DAY - close.getUTCDay() + 7) % 7;
  close.setUTCDate(close.getUTCDate() + daysUntilSaturday);
  if (close.getTime() < now.getTime()) {
    close.setUTCDate(close.getUTCDate() + 7);
  }
  return close;
}

/**
 * The current weekly cycle containing `now`: a 7-day window ending at the
 * next Saturday-12:00-UTC boundary (inclusive of `now` when `now` lands
 * exactly on that boundary). Pure — same `now` always yields the same
 * window, regardless of server or device timezone.
 */
export function cycleWindow(now: Date = new Date()): { cycleStart: Date; cycleEnd: Date } {
  const cycleEnd = nextCloseAtOrAfter(now);
  const cycleStart = new Date(cycleEnd.getTime() - WEEK_MS);
  return { cycleStart, cycleEnd };
}

/** Milliseconds from `now` until the current cycle closes. Never negative. */
export function msUntilClose(now: Date = new Date()): number {
  return cycleWindow(now).cycleEnd.getTime() - now.getTime();
}

/**
 * True exactly on the Saturday-12:00-UTC minute. Mirrors the server's tick
 * predicate; the client has no scheduler to gate, but keeping the function
 * identical keeps the two files a byte-for-byte mirror of the same boundary.
 */
export function isCycleCloseTick(now: Date = new Date()): boolean {
  return (
    now.getUTCDay() === CYCLE_CLOSE_UTC_DAY &&
    now.getUTCHours() === CYCLE_CLOSE_UTC_HOUR &&
    now.getUTCMinutes() === 0
  );
}

/**
 * "Closes in Nd Nh" countdown copy for a weekly-cycle card. `msRemaining`
 * should come from `msUntilClose(now)`. Negative/NaN input clamps to zero
 * rather than printing a negative countdown. Canon language only — this is a
 * cycle boundary, never a deadline to act on a position.
 */
export function formatCloseCountdown(msRemaining: number): string {
  const ms = Number.isFinite(msRemaining) ? Math.max(0, msRemaining) : 0;
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  return `Closes in ${days}d ${hours}h`;
}
