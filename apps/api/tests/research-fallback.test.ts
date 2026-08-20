import { describe, expect, test } from "bun:test";
import { RESEARCH_FALLBACK_MODELS, isMachineErrorText } from "../src/lib/research-fallback.js";

describe("isMachineErrorText", () => {
  test("flags MODEL_BUDGET_EXHAUSTED", () => {
    expect(isMachineErrorText("MODEL_BUDGET_EXHAUSTED")).toBe(true);
  });
  test("leaves a real brief alone", () => {
    expect(isMachineErrorText("SPY is a broad US equity ETF.")).toBe(false);
  });
});

describe("research fallback chain", () => {
  test("tries Grok 4.6, then GPT-5.6 Luna, then Opus 4.8", () => {
    expect([...RESEARCH_FALLBACK_MODELS]).toEqual([
      "x-ai/grok-4.6",
      "openai/gpt-5.6-luna",
      "anthropic/claude-opus-4.8",
    ]);
  });
});
