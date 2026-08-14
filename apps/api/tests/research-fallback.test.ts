import { describe, expect, test } from "bun:test";
import { isMachineErrorText } from "../src/lib/research-fallback.js";

describe("isMachineErrorText", () => {
  test("flags MODEL_BUDGET_EXHAUSTED", () => {
    expect(isMachineErrorText("MODEL_BUDGET_EXHAUSTED")).toBe(true);
  });
  test("leaves a real brief alone", () => {
    expect(isMachineErrorText("SPY is a broad US equity ETF.")).toBe(false);
  });
});
