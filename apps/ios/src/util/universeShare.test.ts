import { describe, expect, test } from "bun:test";
import { formatUniverseShareText, universeShareCopy } from "@/util/universeShare";

const summary = {
  findCount: 4,
  valuedFinds: 3,
  hypotheticalBasis: 100,
  hypotheticalValue: 127.4,
  changePct: 27.4,
  generatedAt: "2026-08-25T12:00:00.000Z",
  sources: [
    {
      provider: "massive" as const,
      fetchedAt: "2026-08-25T11:59:00.000Z",
      confidence: "high" as const,
    },
  ],
};

describe("Universe share copy", () => {
  test("includes the hypothetical framing, complete metrics, brand, and URL", () => {
    const copy = universeShareCopy(summary);

    expect(copy.message).toContain("HYPOTHETICAL UNIVERSE");
    expect(copy.message).toContain("Hypothetical basis $100.00");
    expect(copy.message).toContain("$127.40");
    expect(copy.message).toContain("+27.4%");
    expect(copy.message).toContain("3 of 4 finds priced when found");
    expect(copy.message).toContain(
      "Sources: Market data · high confidence · Calculated Aug 25, 2026",
    );
    expect(copy.message).not.toMatch(/massive|polygon/i);
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

  test("labels an empty source set as uncited and low confidence", () => {
    const copy = universeShareCopy({ ...summary, sources: [] });

    expect(copy.provenance).toContain("No source citations returned");
    expect(copy.provenance).toContain("low confidence");
    expect(copy.message).toContain(copy.provenance);
  });

  test("surfaces the lowest returned source confidence", () => {
    const copy = universeShareCopy({
      ...summary,
      sources: [
        {
          provider: "massive",
          fetchedAt: "2026-08-25T11:59:00.000Z",
          confidence: "high",
        },
        {
          provider: "sec",
          fetchedAt: "2026-08-25T11:59:00.000Z",
          confidence: "medium",
        },
      ],
    });

    expect(copy.provenance).toContain("medium confidence");
    expect(copy.provenance).not.toContain("high confidence");
  });

  test("deduplicates legacy provider names behind the neutral market-data label", () => {
    const copy = universeShareCopy({
      ...summary,
      sources: [
        ...summary.sources,
        {
          provider: "polygon" as const,
          fetchedAt: "2026-08-25T11:58:00.000Z",
          confidence: "high" as const,
        },
      ],
    });

    expect(copy.provenance).toContain("Sources: Market data · high confidence");
    expect(copy.provenance).not.toContain("Market data, Market data");
    expect(copy.provenance).not.toMatch(/massive|polygon/i);
  });

  test("does not invent a calculated date when the server date is malformed", () => {
    const copy = universeShareCopy({ ...summary, generatedAt: "not-a-date" });

    expect(copy.provenance).toContain("Calculated time unavailable");
    expect(copy.provenance).not.toContain("Invalid Date");
    expect(copy.message).not.toContain("not-a-date");
  });

  test("does not stringify invalid numeric values as invented data", () => {
    const message = formatUniverseShareText({
      findCount: Number.NaN,
      valuedFinds: Number.POSITIVE_INFINITY,
      hypotheticalValue: Number.NaN,
      changePct: Number.POSITIVE_INFINITY,
      generatedAt: "not-a-date",
      sources: [],
    });

    expect(message).not.toContain("NaN");
    expect(message).not.toContain("Infinity");
    expect(message).toContain("Value unavailable");
    expect(message).toContain("Change unavailable");
    expect(message).toContain("Find count unavailable");
  });
});
