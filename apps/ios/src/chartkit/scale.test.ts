import { describe, expect, test } from "bun:test";
import { isSafeSvgPoints, linearScale, polylinePoints } from "./scale.ts";

describe("polylinePoints", () => {
  const idx = new Map([
    ["2026-01-01", 0],
    ["2026-01-02", 1],
  ]);
  const x = linearScale([0, 1], [0, 100]);
  const y = linearScale([0, 10], [100, 0]);

  test("emits finite pairs", () => {
    const pts = polylinePoints(
      [
        { date: "2026-01-01", value: 0 },
        { date: "2026-01-02", value: 10 },
      ],
      idx,
      x,
      y,
    );
    expect(isSafeSvgPoints(pts)).toBe(true);
    expect(pts).toBe("0.0,100.0 100.0,0.0");
  });

  test("drops NaN values instead of writing NaN into points", () => {
    const pts = polylinePoints(
      [
        { date: "2026-01-01", value: Number.NaN },
        { date: "2026-01-02", value: 10 },
      ],
      idx,
      x,
      y,
    );
    expect(pts.includes("NaN")).toBe(false);
    expect(isSafeSvgPoints(pts)).toBe(true);
  });

  test("empty series is not safe to mount", () => {
    expect(isSafeSvgPoints(polylinePoints([], idx, x, y))).toBe(false);
    expect(isSafeSvgPoints("")).toBe(false);
    expect(isSafeSvgPoints("10.0,NaN")).toBe(false);
  });
});
