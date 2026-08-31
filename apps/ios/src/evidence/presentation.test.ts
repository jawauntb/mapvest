import { describe, expect, test } from "bun:test";
import type { Source } from "@/api/types";
import {
  confidenceLabel,
  confidenceMeaning,
  displayEvidenceHost,
  evidenceState,
  formatEvidenceFetchedAt,
  neutralizeProviderMetadata,
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
    expect(providerName("massive")).toBe("Market data");
    expect(providerName("polygon")).toBe("Market data");
    expect(confidenceLabel("medium")).toBe("Medium confidence");
    expect(confidenceMeaning("low")).toContain("not a conclusion");
  });

  test("neutralizes branded provider metadata without touching unrelated labels", () => {
    expect(neutralizeProviderMetadata("Massive")).toBe("Market data");
    expect(neutralizeProviderMetadata("Massive news")).toBe("Market news");
    expect(neutralizeProviderMetadata("Polygon.io")).toBe("Market data source");
    expect(neutralizeProviderMetadata("get_massive_quote")).toBe("get Market data quote");
    expect(neutralizeProviderMetadata("delayed, source: Massive")).toBe("Delayed market data");
    expect(neutralizeProviderMetadata("delayed by 15 min, source: Polygon.io")).toBe(
      "Delayed market data",
    );
    expect(neutralizeProviderMetadata("https://api.massive.com/v2/aggs")).toBe(
      "Market data source",
    );
    expect(neutralizeProviderMetadata("Reuters")).toBe("Reuters");
    expect(neutralizeProviderMetadata("A massive opportunity")).toBe("A massive opportunity");
    expect(neutralizeProviderMetadata("Polygon-shaped demand")).toBe("Polygon-shaped demand");
    expect(neutralizeProviderMetadata("Massive Attack")).toBe("Massive Attack");
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
    expect(safeEvidenceLink("https://api.massive.com/v2/aggs?ticker=AAPL")).toEqual({
      url: "https://api.massive.com/v2/aggs?ticker=AAPL",
      host: "Market data source",
    });
    expect(displayEvidenceHost("reference.polygon.io")).toBe("Market data source");
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
