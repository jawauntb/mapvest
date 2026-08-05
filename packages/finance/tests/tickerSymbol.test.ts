import { describe, expect, test } from "bun:test";
import { extractListedTicker } from "../src/tickerSymbol.js";

describe("extractListedTicker", () => {
  test("rejects nonprofit title abbreviations (no exchange citation)", () => {
    expect(extractListedTicker("NYP · Newyork-Presbyterianqueens - GuideStar Profile")).toBeNull();
    expect(extractListedTicker("MSHS · 401k Plan data: MSHS 403(B) PLAN")).toBeNull();
    expect(extractListedTicker("MOUNT · Ownership Information: MOUNT SINAI HOSPITALS")).toBeNull();
    expect(extractListedTicker("NY · Newyork-Presbyterian Queens | Cause IQ")).toBeNull();
  });

  test("accepts NYSE / NASDAQ / $ citations", () => {
    expect(extractListedTicker("McDonald's (NYSE: MCD) restaurant chain")).toBe("MCD");
    expect(extractListedTicker("$SBUX Starbucks Corp shares")).toBe("SBUX");
    expect(extractListedTicker("Ticker: PLNT — Planet Fitness Inc")).toBe("PLNT");
    expect(extractListedTicker("Wyndham Hotels NASDAQ: WH overview")).toBe("WH");
  });
});
