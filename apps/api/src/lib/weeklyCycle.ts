/**
 * Shared weekly-cycle boundary math.
 *
 * Every weekly mechanic — quests, the leaderboard, the co-op tile raid, and
 * the (currently unwired) Rivalries scheduler — resets on the same clock:
 * **Saturday 12:00 UTC**. This is the one place that boundary is computed.
 * Importers never recompute it independently; two implementations of "is it
 * Saturday noon UTC yet" is exactly the bug this file exists to prevent.
 *
 * The boundary is anchored to UTC, never server-local or device-local time,
 * so a user in any timezone and a server deployed in any region agree on
 * when a cycle closes. `apps/ios/src/util/weeklyCycle.ts` mirrors this file
 * exactly (same constants, same math) for the client-side "Closes in Nd Nh"
 * countdown — keep the two in sync if this boundary ever changes.
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
 * True exactly on the Saturday-12:00-UTC minute — the one scheduler tick per
 * week that should run the weekly close. Shared so a cron/tick loop never
 * grows its own copy of "is it Saturday noon UTC" next to this file's.
 */
export function isCycleCloseTick(now: Date = new Date()): boolean {
  return (
    now.getUTCDay() === CYCLE_CLOSE_UTC_DAY &&
    now.getUTCHours() === CYCLE_CLOSE_UTC_HOUR &&
    now.getUTCMinutes() === 0
  );
}
