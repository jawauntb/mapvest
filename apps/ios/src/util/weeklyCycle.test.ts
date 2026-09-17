import { describe, expect, test } from "bun:test";
import {
  cycleWindow,
  formatCloseCountdown,
  formatCycleHeader,
  isCycleCloseTick,
  msUntilClose,
} from "./weeklyCycle";

/** `2026-09-19` is a Saturday — the anchor used throughout these cases. */
const SATURDAY_NOON_UTC = "2026-09-19T12:00:00.000Z";
const PREV_SATURDAY_NOON_UTC = "2026-09-12T12:00:00.000Z";
const NEXT_SATURDAY_NOON_UTC = "2026-09-26T12:00:00.000Z";

describe("cycleWindow", () => {
  test("mid-week instant falls inside the cycle ending this Saturday noon UTC", () => {
    const now = new Date("2026-09-16T03:00:00.000Z"); // Wednesday
    const { cycleStart, cycleEnd } = cycleWindow(now);
    expect(cycleEnd.toISOString()).toBe(SATURDAY_NOON_UTC);
    expect(cycleStart.toISOString()).toBe(PREV_SATURDAY_NOON_UTC);
  });

  test("exactly on the boundary, the closing instant is the end of the cycle it closes", () => {
    const now = new Date(SATURDAY_NOON_UTC);
    const { cycleStart, cycleEnd } = cycleWindow(now);
    expect(cycleEnd.getTime()).toBe(now.getTime());
    expect(cycleStart.toISOString()).toBe(PREV_SATURDAY_NOON_UTC);
  });

  test("one minute after the boundary rolls into the next cycle", () => {
    const now = new Date("2026-09-19T12:01:00.000Z");
    const { cycleStart, cycleEnd } = cycleWindow(now);
    expect(cycleEnd.toISOString()).toBe(NEXT_SATURDAY_NOON_UTC);
    expect(cycleStart.toISOString()).toBe(SATURDAY_NOON_UTC);
  });

  /**
   * Timezone invariance: the same absolute instant, expressed via three
   * different UTC offsets, must classify identically — the boundary is a
   * property of the instant, never of the timezone used to name it.
   */
  test("timezone invariance — America/New_York (UTC-4, EDT) Saturday 07:00 local is still inside the current cycle", () => {
    // 07:00 EDT == 11:00 UTC, one hour before this Saturday's noon-UTC close.
    const now = new Date("2026-09-19T07:00:00.000-04:00");
    expect(now.toISOString()).toBe("2026-09-19T11:00:00.000Z");
    const { cycleStart, cycleEnd } = cycleWindow(now);
    expect(cycleEnd.toISOString()).toBe(SATURDAY_NOON_UTC);
    expect(cycleStart.toISOString()).toBe(PREV_SATURDAY_NOON_UTC);
    expect(msUntilClose(now)).toBe(60 * 60 * 1000);
  });

  test("timezone invariance — Asia/Tokyo (UTC+9) Saturday 22:00 local has already crossed into the next cycle", () => {
    // 22:00 JST Saturday == 13:00 UTC Saturday, one hour PAST this week's close.
    const now = new Date("2026-09-19T22:00:00.000+09:00");
    expect(now.toISOString()).toBe("2026-09-19T13:00:00.000Z");
    const { cycleStart, cycleEnd } = cycleWindow(now);
    expect(cycleEnd.toISOString()).toBe(NEXT_SATURDAY_NOON_UTC);
    expect(cycleStart.toISOString()).toBe(SATURDAY_NOON_UTC);
  });

  test("timezone invariance — Pacific/Auckland (UTC+13) Friday 21:00 local is well inside the current cycle", () => {
    // 21:00 NZDT Friday == 08:00 UTC Saturday, four hours before this week's close.
    const now = new Date("2026-09-19T21:00:00.000+13:00");
    expect(now.toISOString()).toBe("2026-09-19T08:00:00.000Z");
    const { cycleEnd } = cycleWindow(now);
    expect(cycleEnd.toISOString()).toBe(SATURDAY_NOON_UTC);
    expect(msUntilClose(now)).toBe(4 * 60 * 60 * 1000);
  });
});

describe("msUntilClose", () => {
  test("is zero exactly at the boundary and never negative", () => {
    expect(msUntilClose(new Date(SATURDAY_NOON_UTC))).toBe(0);
    expect(msUntilClose(new Date("2026-09-19T11:59:00.000Z"))).toBe(60_000);
  });
});

describe("isCycleCloseTick", () => {
  test("true only at Saturday 12:00 UTC, on the minute", () => {
    expect(isCycleCloseTick(new Date(SATURDAY_NOON_UTC))).toBe(true);
    expect(isCycleCloseTick(new Date("2026-09-19T11:59:00.000Z"))).toBe(false);
    expect(isCycleCloseTick(new Date("2026-09-18T12:00:00.000Z"))).toBe(false); // Friday
  });
});

describe("formatCloseCountdown", () => {
  test("renders whole days and hours", () => {
    expect(formatCloseCountdown(2 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000)).toBe(
      "Closes in 2d 5h",
    );
  });

  test("under a day still prints 0d", () => {
    expect(formatCloseCountdown(3 * 60 * 60 * 1000)).toBe("Closes in 0d 3h");
  });

  test("clamps negative or non-finite input to zero rather than a negative countdown", () => {
    expect(formatCloseCountdown(-1000)).toBe("Closes in 0d 0h");
    expect(formatCloseCountdown(Number.NaN)).toBe("Closes in 0d 0h");
  });
});

describe("formatCycleHeader", () => {
  test("renders 'Sun MM/DD – Sat MM/DD' from a cycle window's Saturday-noon boundaries", () => {
    const { cycleStart, cycleEnd } = cycleWindow(new Date("2026-09-16T03:00:00.000Z")); // Wednesday
    expect(cycleStart.toISOString()).toBe(PREV_SATURDAY_NOON_UTC); // 2026-09-12 (Sat)
    expect(cycleEnd.toISOString()).toBe(SATURDAY_NOON_UTC); // 2026-09-19 (Sat)
    expect(formatCycleHeader(cycleStart, cycleEnd)).toBe("Sun 09/13 – Sat 09/19");
  });

  test("shifts the display start to the calendar day after cycleStart's Saturday-noon close", () => {
    const cycleStart = new Date("2026-01-03T12:00:00.000Z"); // Saturday
    const cycleEnd = new Date("2026-01-10T12:00:00.000Z"); // next Saturday
    expect(formatCycleHeader(cycleStart, cycleEnd)).toBe("Sun 01/04 – Sat 01/10");
  });
});
