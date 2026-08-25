import { describe, expect, test } from "bun:test";
import {
  authSavePath,
  parseSaveContinuation,
  saveContinuationDestination,
} from "./saveContinuation";

describe("save auth continuation", () => {
  test("round-trips the save action and exact ticker context", () => {
    const path = authSavePath({
      ticker: "brk.b",
      name: "Berkshire Hathaway",
      sector: "Financials",
      source: "camera",
    });
    const params = Object.fromEntries(new URL(path, "https://mapvest.app").searchParams);

    expect(parseSaveContinuation(params)).toEqual({
      ticker: "BRK.B",
      name: "Berkshire Hathaway",
      sector: "Financials",
      source: "camera",
    });
    expect(saveContinuationDestination(parseSaveContinuation(params)!)).toBe("/detail/BRK.B");
  });

  test("rejects malformed and unrelated continuation parameters", () => {
    expect(
      parseSaveContinuation({ intent: "save", ticker: "not a ticker", source: "camera" }),
    ).toBe(null);
    expect(parseSaveContinuation({ intent: "view", ticker: "MCD", source: "detail" })).toBe(null);
    expect(parseSaveContinuation({ intent: "save", ticker: "MCD", source: "map" })).toBe(null);
  });
});
