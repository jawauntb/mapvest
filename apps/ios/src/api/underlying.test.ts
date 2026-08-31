import { describe, expect, test } from "bun:test";

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;

const { formatChartError } = await import("./underlying");

describe("formatChartError", () => {
  test("hides Massive transport details behind generic chart copy", () => {
    expect(formatChartError(new Error("Massive request failed (403): entitlement missing"))).toBe(
      "Chart data unavailable. Try again.",
    );
  });

  test("hides Polygon per-ticker errors behind generic chart copy", () => {
    expect(formatChartError("AAPL: Polygon.io aggregates returned HTTP 429")).toBe(
      "Chart data unavailable. Try again.",
    );
  });

  test("keeps an empty result distinct without exposing upstream detail", () => {
    expect(formatChartError("No data returned")).toBe("No chart data returned.");
    expect(formatChartError("No data")).toBe("No chart data returned.");
    expect(formatChartError(undefined)).toBe("Chart data unavailable. Try again.");
  });
});
