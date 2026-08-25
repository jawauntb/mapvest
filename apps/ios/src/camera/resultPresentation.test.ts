import { describe, expect, test } from "bun:test";
import type { Investable } from "@/api/types";
import {
  identifyProgressCopy,
  investableLabel,
  splitInvestableResults,
} from "./resultPresentation";

function investable(name: string, ticker?: string): Investable {
  return {
    brand: { name, isPublic: Boolean(ticker), ticker: ticker ? { symbol: ticker } : undefined },
    comparables: [],
    etfs: [],
    confidence: "high",
    sources: [],
  };
}

describe("splitInvestableResults", () => {
  test("keeps the first result primary and exposes every additional result", () => {
    const first = investable("Acme", "ACME");
    const second = investable("Bravo", "BRAV");
    const third = investable("Cedar");

    expect(splitInvestableResults([first, second, third])).toEqual({
      primary: first,
      additional: [second, third],
    });
  });

  test("represents a zero-investable response without inventing a match", () => {
    expect(splitInvestableResults([])).toEqual({ primary: undefined, additional: [] });
  });
});

describe("identifyProgressCopy", () => {
  test("only marks client-observable stages complete", () => {
    expect(identifyProgressCopy("preparing").completedSteps).toBe(0);
    expect(identifyProgressCopy("identifying").completedSteps).toBe(1);
  });
});

describe("investableLabel", () => {
  test("does not make up a ticker for a private result", () => {
    expect(investableLabel(investable("Cedar"))).toBe("Private · no public match yet");
  });
});
