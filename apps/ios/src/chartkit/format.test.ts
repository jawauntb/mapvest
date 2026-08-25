import { describe, expect, test } from "bun:test";
import { safeFixed, safeUpper } from "./format";

describe("chart formatters", () => {
  test("safeFixed never throws on junk", () => {
    expect(safeFixed(12.345, 2)).toBe("12.35");
    expect(safeFixed(undefined)).toBe("—");
    expect(safeFixed(null)).toBe("—");
    expect(safeFixed(Number.NaN)).toBe("—");
    expect(safeFixed(Number.POSITIVE_INFINITY)).toBe("—");
    expect(safeFixed("12.3")).toBe("—");
  });

  test("safeUpper never throws on junk", () => {
    expect(safeUpper("inside value")).toBe("INSIDE VALUE");
    expect(safeUpper(undefined)).toBe("—");
    expect(safeUpper("")).toBe("—");
    expect(safeUpper(12)).toBe("—");
  });
});
