import { describe, expect, test } from "bun:test";
import type { Find } from "@mapvest/core";
import { candidateState, isPioneer, tileFor } from "./territory.js";

/** A block in lower Manhattan — arbitrary, just needs to be a stable tile. */
const LAT = 40.7128;
const LNG = -74.006;
const TILE = tileFor(LAT, LNG);

function find(overrides: Partial<Find> = {}): Find {
  return {
    id: "find-1",
    brand: "Starbucks",
    ticker: "SBUX",
    confidence: "high",
    lat: LAT,
    lng: LNG,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("candidateState", () => {
  test("a candidate inside a tile with no matching Find is seen", () => {
    const state = candidateState({ brand: "Starbucks", ticker: "SBUX" }, TILE, []);
    expect(state).toBe("seen");
  });

  test("a candidate with a matching Find in the same tile is captured", () => {
    const state = candidateState({ brand: "Starbucks", ticker: "SBUX" }, TILE, [find()]);
    expect(state).toBe("captured");
  });

  test("a matching ticker in a different tile does not count as captured", () => {
    const elsewhere = find({ lat: LAT + 1, lng: LNG + 1 });
    const state = candidateState({ brand: "Starbucks", ticker: "SBUX" }, TILE, [elsewhere]);
    expect(state).toBe("seen");
  });

  test("a Find for a different company in the same tile does not count as captured", () => {
    const other = find({ brand: "Nike", ticker: "NKE" });
    const state = candidateState({ brand: "Starbucks", ticker: "SBUX" }, TILE, [other]);
    expect(state).toBe("seen");
  });

  test("falls back to comparable, then brand name, when there is no ticker", () => {
    const privateBrand = { brand: "Corner Bodega" };
    expect(candidateState(privateBrand, TILE, [])).toBe("seen");
    const matchByBrand = find({ ticker: undefined, brand: "Corner Bodega" });
    expect(candidateState(privateBrand, TILE, [matchByBrand])).toBe("captured");
  });

  test("a Find without coordinates belongs to no tile and never counts", () => {
    const noCoords = find({ lat: undefined, lng: undefined });
    const state = candidateState({ brand: "Starbucks", ticker: "SBUX" }, TILE, [noCoords]);
    expect(state).toBe("seen");
  });

  test("candidateState never grants pioneer credit — orthogonal to isPioneer", () => {
    // A capture flips candidateState to "captured" but says nothing about
    // whether the caller is still the tile's pioneer; that stays isPioneer's
    // job, decided by history, not by this candidate's identity.
    const priorFinds = [find()];
    expect(candidateState({ brand: "Starbucks", ticker: "SBUX" }, TILE, priorFinds)).toBe(
      "captured",
    );
    expect(isPioneer(TILE, priorFinds)).toBe(false);
  });
});
