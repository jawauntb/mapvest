import { describe, expect, test } from "bun:test";
import type { Find } from "@mapvest/core";
import { TILE_UNCOVER_THRESHOLD, candidateState, isPioneer, splitTileReward, tileFor } from "./territory.js";

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

describe("splitTileReward (co-op tile uncover — the weekly raid)", () => {
  test("an evenly divisible pool splits equally", () => {
    const split = splitTileReward(100, ["a", "b", "c", "d", "e"]);
    expect([...split.values()]).toEqual([20, 20, 20, 20, 20]);
  });

  test("a pool that does not divide evenly pays its remainder to the earliest contributors, losing nothing", () => {
    // 47 / 5 = 9 base, remainder 2 — "a" and "b" (earliest) get 10, the rest get 9.
    const contributors = ["a", "b", "c", "d", "e"];
    const split = splitTileReward(47, contributors);
    expect(split.get("a")).toBe(10);
    expect(split.get("b")).toBe(10);
    expect(split.get("c")).toBe(9);
    expect(split.get("d")).toBe(9);
    expect(split.get("e")).toBe(9);
    const total = [...split.values()].reduce((sum, xp) => sum + xp, 0);
    expect(total).toBe(47); // exact — no XP lost to rounding
  });

  test("order matters only for who gets the extra point, never for the total", () => {
    const forward = splitTileReward(11, ["a", "b", "c"]);
    const backward = splitTileReward(11, ["c", "b", "a"]);
    // base=3, remainder=2: whoever is earliest gets the +1.
    expect(forward.get("a")).toBe(4);
    expect(forward.get("b")).toBe(4);
    expect(forward.get("c")).toBe(3);
    expect(backward.get("c")).toBe(4);
    expect(backward.get("b")).toBe(4);
    expect(backward.get("a")).toBe(3);
    const total = (split: Map<string, number>) => [...split.values()].reduce((a, b) => a + b, 0);
    expect(total(forward)).toBe(11);
    expect(total(backward)).toBe(11);
  });

  test("a single contributor takes the whole pool", () => {
    expect(splitTileReward(7, ["solo"]).get("solo")).toBe(7);
  });

  test("no contributors splits nothing", () => {
    expect(splitTileReward(100, []).size).toBe(0);
  });

  test("the threshold is exactly 5 distinct Finders", () => {
    expect(TILE_UNCOVER_THRESHOLD).toBe(5);
  });
});
