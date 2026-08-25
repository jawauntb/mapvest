import { describe, expect, test } from "bun:test";
import type { Source } from "@/api/types";
import {
  confidenceLabel,
  confidenceMeaning,
  evidenceState,
  formatEvidenceFetchedAt,
  providerName,
  safeEvidenceLink,
} from "./presentation";

const source: Source = {
  provider: "sec",
  url: "https://www.sec.gov/edgar/browse/",
  fetchedAt: "2026-08-25T14:30:00.000Z",
  confidence: "medium",
};

describe("evidence presentation", () => {
  test("uses human provider names and explains returned confidence", () => {
    expect(providerName("sec")).toBe("U.S. SEC");
    expect(confidenceLabel("medium")).toBe("Medium confidence");
    expect(confidenceMeaning("low")).toContain("not a conclusion");
  });

  test("formats a source fetch date without claiming an update", () => {
    expect(formatEvidenceFetchedAt(source.fetchedAt)).toBe("Fetched Aug 25, 2026");
    expect(formatEvidenceFetchedAt("not-a-date")).toBeUndefined();
  });

  test("only permits valid credential-free HTTP(S) source links", () => {
    expect(safeEvidenceLink(source.url)).toEqual({
      url: source.url!,
      host: "sec.gov",
    });
    expect(safeEvidenceLink("http://example.com/filing")).toEqual({
      url: "http://example.com/filing",
      host: "example.com",
    });
    expect(safeEvidenceLink("javascript:alert(1)")).toBeUndefined();
    expect(safeEvidenceLink("ftp://example.com/filing")).toBeUndefined();
    expect(safeEvidenceLink("mailto:filings@example.com")).toBeUndefined();
    expect(safeEvidenceLink("file:///private/source.pdf")).toBeUndefined();
    expect(safeEvidenceLink("https://user:pass@example.com/source")).toBeUndefined();
    expect(safeEvidenceLink("not a url")).toBeUndefined();
  });

  test("describes absent citations as an honest low-confidence state", () => {
    expect(evidenceState([])).toEqual({
      kind: "uncited",
      summary:
        "No citations returned. Treat this match as low confidence until evidence is available.",
    });
    expect(evidenceState([source])).toEqual({ kind: "cited", summary: "1 returned source" });
  });
});
