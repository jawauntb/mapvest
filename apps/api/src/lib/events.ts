/**
 * Events — global, zero-config quest/find XP modifiers (Universe Roadmap §1 A7).
 *
 * `activeEvent` is a PURE function of the clock instant handed to it. There is
 * no events table, no scheduler row, no admin toggle: the schedule is derived
 * arithmetic, so every server process (and the client, if it ever wants to
 * predict) agrees on which event is open without coordinating. Nothing here
 * touches a store, the network, `Date.now()`, or `process.env`.
 *
 * The one event shipped today:
 *
 *   **Sector Saturday** — every Saturday, 00:00Z to 24:00Z, finds in one
 *   sector earn 2× XP. The sector rotates deterministically by ISO week
 *   number over the canonical GICS sector list from `@mapvest/finance`
 *   (`sectorEtfMap`), so consecutive Saturdays walk the list and the same
 *   Saturday always resolves to the same sector no matter which process asks.
 *
 * The window is a real instant range (`startsAt`/`endsAt` are ISO instants,
 * half-open `[startsAt, endsAt)`), unlike the UTC calendar days used for
 * streaks and quests — an event either is or is not open right now.
 */
import type { ActiveEvent } from "@mapvest/core";
import { sectorEtfMap } from "@mapvest/finance";

/** XP multiplier applied to a matching find while Sector Saturday is open. */
export const SECTOR_SATURDAY_MULTIPLIER = 2;

/** `Date#getUTCDay()` value for Saturday. */
const SATURDAY = 6;

const MS_PER_DAY = 86_400_000;

/**
 * The canonical sector list the rotation walks: the GICS sector keys of
 * `sectorEtfMap`, sorted so the order is a property of the names themselves
 * and not of the literal's authoring order. Adding a sector to the map
 * re-phases the rotation from that point on, which is fine — the guarantee is
 * "same week → same sector", not "this week is Energy forever".
 */
export const CANONICAL_SECTORS: readonly string[] = Object.keys(sectorEtfMap).sort();

/**
 * ISO-8601 week number (1–53) for a date, in UTC. Weeks start Monday and week
 * 1 is the one containing the first Thursday of the year — the standard
 * algorithm, so a Saturday and the Monday before it share a week number.
 */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Shift to the Thursday of this ISO week; the year of that Thursday is the
  // ISO year, and week 1 always contains January 4th.
  const dayNum = d.getUTCDay() || 7; // Sunday (0) is ISO day 7.
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - isoYearStart) / MS_PER_DAY / 7) + 1;
}

/** The sector Sector Saturday features in a given ISO week. */
export function sectorForWeek(week: number): string {
  const list = CANONICAL_SECTORS;
  if (list.length === 0) return "";
  const index = (((Math.trunc(week) - 1) % list.length) + list.length) % list.length;
  return list[index] as string;
}

/** Midnight UTC of the day containing `now`. */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The event open at `now`, or null when none is. Deterministic and total: the
 * same instant always yields the same answer, and a non-Saturday always yields
 * null.
 *
 * `key` embeds the UTC day so downstream XP-grant keys (`event:{key}:…`)
 * dedupe per occurrence rather than across all Saturdays forever.
 */
export function activeEvent(now: Date): ActiveEvent | null {
  if (Number.isNaN(now.getTime())) return null;
  if (now.getUTCDay() !== SATURDAY) return null;

  const start = startOfUtcDay(now);
  const end = new Date(start.getTime() + MS_PER_DAY);
  const sector = sectorForWeek(isoWeekNumber(now));
  if (!sector) return null;
  const day = start.toISOString().slice(0, 10);

  return {
    key: `sector-saturday:${day}`,
    title: `Sector Saturday — ${sector}`,
    sector,
    multiplier: SECTOR_SATURDAY_MULTIPLIER,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

/**
 * The XP multiplier a find in `sector` earns under `event`. Pure branch, kept
 * beside the schedule so the call site in `progress-store` stays arithmetic-free:
 *
 * - no event open → 1
 * - event with no `sector` (all-sector window) → the event's multiplier
 * - event scoped to a sector → its multiplier only on an exact match
 *
 * `sector` is expected to be already canonicalized (`canonicalSector`); an
 * unknown or missing sector never multiplies, it just earns the base rate.
 */
export function multiplierForSector(
  sector: string | null | undefined,
  event: ActiveEvent | null,
): number {
  if (!event) return 1;
  const multiplier = Number.isFinite(event.multiplier) ? event.multiplier : 1;
  if (!event.sector) return multiplier;
  if (!sector) return 1;
  return sector === event.sector ? multiplier : 1;
}
