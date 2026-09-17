import { describe, expect, test } from "bun:test";
import { TerritoryResponse } from "./types";

describe("TerritoryResponse schema parse (co-op tile uncover)", () => {
  test("parses a tile with in-progress co-op state", () => {
    const parsed = TerritoryResponse.parse({
      tile: "dr5reg",
      investablesTotal: 6,
      found: 2,
      pioneer: false,
      sources: [],
      coop: { contributors: 3, threshold: 5, uncovered: false },
    });
    expect(parsed.coop).toEqual({ contributors: 3, threshold: 5, uncovered: false });
  });

  test("parses an uncovered tile", () => {
    const parsed = TerritoryResponse.parse({
      tile: "dr5reg",
      investablesTotal: 6,
      found: 2,
      pioneer: false,
      sources: [],
      coop: { contributors: 5, threshold: 5, uncovered: true },
    });
    expect(parsed.coop.uncovered).toBe(true);
  });

  test("rejects a response missing coop", () => {
    expect(() =>
      TerritoryResponse.parse({
        tile: "dr5reg",
        investablesTotal: 6,
        found: 2,
        pioneer: false,
        sources: [],
      }),
    ).toThrow();
  });
});
