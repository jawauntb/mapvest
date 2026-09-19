import { describe, expect, test } from "bun:test";
import { citationTypeDetail, citationTypeLabel, citationTypeOf } from "./citationType";

describe("citationTypeOf", () => {
  test("accepts the engine's vocabulary and rejects anything else", () => {
    expect(
      citationTypeOf({ citation_type: { type: "sec_xbrl", source: "jev", confidence: 0.82 } }),
    ).toEqual({ type: "sec_xbrl", source: "jev", confidence: 0.82 });
    expect(citationTypeOf({})).toBeNull();
    expect(citationTypeOf({ citation_type: null })).toBeNull();
    expect(
      citationTypeOf({ citation_type: { type: "unknown", source: "regex" } as never }),
    ).toBeNull();
    expect(
      citationTypeOf({ citation_type: { type: "exa", source: "oracle" } as never }),
    ).toBeNull();
  });
});

describe("labels", () => {
  test("badge copy is short and the detail line names the source and confidence", () => {
    expect(citationTypeLabel({ type: "sec_filing", source: "regex", confidence: null })).toBe(
      "SEC filing",
    );
    expect(citationTypeDetail({ type: "sec_filing", source: "regex", confidence: null })).toBe(
      "Matched by rule (regex)",
    );
    expect(citationTypeDetail({ type: "sec_xbrl", source: "jev", confidence: 0.82 })).toBe(
      "Classified by Jev · 82% confidence",
    );
    expect(citationTypeDetail({ type: "exa", source: "jev" })).toBe("Classified by Jev");
  });
});
