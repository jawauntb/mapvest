import { describe, expect, test } from "bun:test";
import {
  dashFrames,
  lineFrames,
  normalizeRect,
  parseDasharray,
  parsePoints,
  pointsAttr,
  polygonFillStrips,
  segmentFrame,
  sparklinePoints,
} from "./draw.ts";

describe("segmentFrame", () => {
  test("centers the bar on the true midpoint so rotation covers A→B", () => {
    const f = segmentFrame({ x: 0, y: 10 }, { x: 40, y: 10 }, 2);
    expect(f).not.toBeNull();
    if (!f) return;
    expect(f.rotateDeg).toBeCloseTo(0, 5);
    expect(f.height).toBe(2);
    expect(f.left + f.width / 2).toBeCloseTo(20, 5);
    expect(f.top + f.height / 2).toBeCloseTo(10, 5);
  });

  test("diagonal segment rotates to the slope", () => {
    const f = segmentFrame({ x: 0, y: 0 }, { x: 10, y: 10 }, 2);
    expect(f).not.toBeNull();
    if (!f) return;
    expect(f.rotateDeg).toBeCloseTo(45, 5);
    expect(f.left + f.width / 2).toBeCloseTo(5, 5);
    expect(f.top + f.height / 2).toBeCloseTo(5, 1);
  });

  test("rejects NaN and zero-length", () => {
    expect(segmentFrame({ x: Number.NaN, y: 0 }, { x: 1, y: 1 }, 2)).toBeNull();
    expect(segmentFrame({ x: 3, y: 3 }, { x: 3, y: 3 }, 2)).toBeNull();
  });
});

describe("parsePoints", () => {
  test("reads space-separated pairs", () => {
    expect(parsePoints("0.0,100.0 100.0,0.0")).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 0 },
    ]);
  });

  test("drops NaN/Infinity instead of mounting crashy coords", () => {
    expect(parsePoints("10.0,NaN 4,5 Infinity,1")).toEqual([{ x: 4, y: 5 }]);
  });
});

describe("dash + rect", () => {
  test("parseDasharray reads SVG lists", () => {
    expect(parseDasharray("6 4")).toEqual([6, 4]);
    expect(parseDasharray("8 3 2 3")).toEqual([8, 3, 2, 3]);
    expect(parseDasharray(4)).toEqual([4, 4]);
  });

  test("dashFrames emits on-dash pieces only", () => {
    const frames = dashFrames({ x: 0, y: 0 }, { x: 20, y: 0 }, 2, [6, 4]);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames.every((f) => f.rotateDeg === 0)).toBe(true);
  });

  test("lineFrames without dash is a single segment", () => {
    expect(lineFrames({ x: 0, y: 0 }, { x: 8, y: 0 }, 2)).toHaveLength(1);
  });

  test("normalizeRect flips negative size", () => {
    expect(normalizeRect(10, 10, -4, -2)).toEqual({ x: 6, y: 8, width: 4, height: 2 });
    expect(normalizeRect(Number.NaN, 0, 1, 1)).toBeNull();
  });
});

describe("polygonFillStrips", () => {
  test("fills a unit square", () => {
    const strips = polygonFillStrips(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      2,
    );
    expect(strips.length).toBeGreaterThan(0);
    const area = strips.reduce((s, r) => s + r.width * r.height, 0);
    expect(area).toBeCloseTo(100, 0);
  });

  test("triangle has positive area", () => {
    const strips = polygonFillStrips(
      [
        { x: 5, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
      1,
    );
    const area = strips.reduce((s, r) => s + r.width * r.height, 0);
    expect(area).toBeGreaterThan(20);
    expect(area).toBeLessThan(60);
  });
});

describe("sparklinePoints", () => {
  test("maps min to the bottom pad and max to the top pad", () => {
    const pts = sparklinePoints([1, 2, 3], 100, 50, 5);
    expect(pts).toHaveLength(3);
    expect(pts[0]?.y).toBeCloseTo(45, 5);
    expect(pts[2]?.y).toBeCloseTo(5, 5);
    expect(pts[0]?.x).toBeCloseTo(5, 5);
    expect(pts[2]?.x).toBeCloseTo(95, 5);
    expect(pointsAttr(pts).includes("NaN")).toBe(false);
  });

  test("flat series still produces a line", () => {
    const pts = sparklinePoints([4, 4, 4], 80, 40, 4);
    expect(pts).toHaveLength(3);
    expect(pts[0]?.y).toBe(pts[1]?.y);
  });
});
