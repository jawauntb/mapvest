import { describe, expect, test } from "bun:test";
import {
  applyLiveClose,
  clampPeriodForInterval,
  massiveIntervalSpec,
  normalizeHistoryInterval,
  yahooInterval,
} from "../src/marketData/historyIntervals.js";

describe("history intervals", () => {
  test("normalizes 15m / 1d / 1w aliases", () => {
    expect(normalizeHistoryInterval("15min")).toBe("15m");
    expect(normalizeHistoryInterval("daily")).toBe("1d");
    expect(normalizeHistoryInterval("1wk")).toBe("1w");
    expect(normalizeHistoryInterval(undefined)).toBe("1d");
    expect(() => normalizeHistoryInterval("4h")).toThrow("interval must be 15m, 1d, or 1w");
  });

  test("clamps a long 15m lookback to 5d", () => {
    expect(clampPeriodForInterval("1y", "15m")).toBe("5d");
    expect(clampPeriodForInterval("1mo", "15m")).toBe("1mo");
    expect(clampPeriodForInterval("2y", "1w")).toBe("2y");
  });

  test("maps Massive and Yahoo interval specs", () => {
    expect(massiveIntervalSpec("15m")).toEqual({ multiplier: 15, timespan: "minute" });
    expect(massiveIntervalSpec("1d")).toEqual({ multiplier: 1, timespan: "day" });
    expect(massiveIntervalSpec("1w")).toEqual({ multiplier: 1, timespan: "week" });
    expect(yahooInterval("1w")).toBe("1wk");
    expect(yahooInterval("15m")).toBe("15m");
  });

  test("patches the current daily bar from the live quote", () => {
    const last = Math.floor(Date.now() / 1_000);
    const points = [
      { ts: last - 86_400, close: 180 },
      { ts: last, close: 181 },
    ];
    const updated = applyLiveClose(points, { price: 188.25, ts: new Date().toISOString() }, "1d");
    expect(updated).toHaveLength(2);
    expect(updated[1]).toEqual({ ts: last, close: 188.25 });
  });

  test("appends a new 15m bar when the live print is in the next bucket", () => {
    const last = Math.floor(Date.parse("2026-08-19T18:00:00Z") / 1_000);
    const next = Math.floor(Date.parse("2026-08-19T18:20:00Z") / 1_000);
    const updated = applyLiveClose(
      [{ ts: last, close: 181 }],
      { price: 182, ts: "2026-08-19T18:20:00.000Z" },
      "15m",
    );
    expect(updated).toEqual([
      { ts: last, close: 181 },
      { ts: next, close: 182 },
    ]);
  });
});
