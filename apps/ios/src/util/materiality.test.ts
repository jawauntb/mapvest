import { describe, expect, test } from "bun:test";
import {
  type JevMateriality,
  hasAnyScored,
  isMaterialOrUnscored,
  materialityLabel,
  materialityOf,
} from "./materiality";

type Item = { title?: string; jev_materiality?: JevMateriality | null };

const material: Item = {
  jev_materiality: { level: "material", score: 0.9, confidence: 0.82 },
};
const noise: Item = { jev_materiality: { level: "noise", score: 0.05, confidence: 0.95 } };
const unscored: Item = { title: "no tag" };

describe("materialityOf", () => {
  test("reads a well-formed tag and rejects anything else", () => {
    expect(materialityOf(material)).toEqual(material.jev_materiality ?? null);
    expect(materialityOf(unscored)).toBeNull();
    expect(materialityOf({ jev_materiality: null })).toBeNull();
    expect(
      materialityOf({
        jev_materiality: { level: "urgent", score: 1, confidence: 0.9 } as never,
      }),
    ).toBeNull();
    expect(
      materialityOf({ jev_materiality: { level: "minor", score: 0.5, confidence: Number.NaN } }),
    ).toBeNull();
  });
});

describe("materialityLabel", () => {
  test("shows level and rounded confidence", () => {
    expect(materialityLabel(material.jev_materiality!)).toBe("Material · 82%");
    expect(materialityLabel({ level: "minor", score: 0.5, confidence: 0.555 })).toBe("Minor · 56%");
  });
});

describe("isMaterialOrUnscored / hasAnyScored", () => {
  test("a material-only filter keeps material AND unscored items, drops known-lower", () => {
    expect([material, noise, unscored].filter(isMaterialOrUnscored)).toEqual([material, unscored]);
  });

  test("the toggle only exists when something is scored", () => {
    expect(hasAnyScored([unscored, unscored])).toBe(false);
    expect(hasAnyScored([unscored, noise])).toBe(true);
    expect(hasAnyScored([])).toBe(false);
  });
});
