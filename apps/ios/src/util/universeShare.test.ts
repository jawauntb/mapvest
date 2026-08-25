import { describe, expect, test } from "bun:test";
import { formatUniverseShareText, universeShareCopy } from "@/util/universeShare";

const summary = {
  findCount: 4,
  valuedFinds: 3,
  hypotheticalBasis: 100,
  hypotheticalValue: 127.4,
  changePct: 27.4,
};

describe("Universe share copy", () => {
  test("includes the hypothetical framing, complete metrics, brand, and URL", () => {
    const copy = universeShareCopy(summary);

    expect(copy.message).toContain("HYPOTHETICAL UNIVERSE");
    expect(copy.message).toContain("Hypothetical basis $100.00");
    expect(copy.message).toContain("$127.40");
    expect(copy.message).toContain("+27.4%");
    expect(copy.message).toContain("3 of 4 finds priced when found");
    expect(copy.message).toContain("My Mapvest universe");
    expect(copy.message).toContain("https://mapvest.app");
  });

  test("uses the server basis as a total instead of hardcoding a per-find amount", () => {
    const copy = universeShareCopy({ ...summary, hypotheticalBasis: 275 });

    expect(copy.basis).toBe("Hypothetical basis $275.00");
    expect(copy.message).not.toContain("$100 PER FIND");
  });

  test("has no private find fields or precise location data", () => {
    const message = formatUniverseShareText(summary);

    expect(message).not.toMatch(/photo|image|email|latitude|longitude|\blat\b|\blng\b|street/i);
    expect(message).not.toContain("@example");
  });

  test("does not stringify invalid numeric values as invented data", () => {
    const message = formatUniverseShareText({
      findCount: Number.NaN,
      valuedFinds: Number.POSITIVE_INFINITY,
      hypotheticalValue: Number.NaN,
      changePct: Number.POSITIVE_INFINITY,
    });

    expect(message).not.toContain("NaN");
    expect(message).not.toContain("Infinity");
    expect(message).toContain("Value unavailable");
    expect(message).toContain("Change unavailable");
    expect(message).toContain("Find count unavailable");
  });
});
