import { describe, expect, test } from "bun:test";
import {
  providerPresentationLabel,
  sourceHostPresentationLabel,
} from "../src/lib/provider-presentation";

describe("provider presentation", () => {
  test("maps exact Massive and Polygon provider tokens to a neutral label", () => {
    for (const token of ["massive", "Massive", "polygon", "Polygon"]) {
      expect(providerPresentationLabel(token)).toBe("Market data");
    }
    for (const token of ["massive.com", "api.massive.com", "polygon.io", "api.polygon.io"]) {
      expect(providerPresentationLabel(token)).toBe("Market data source");
    }

    expect(providerPresentationLabel("TMX")).toBe("TMX");
    expect(providerPresentationLabel("A massive opportunity")).toBe("A massive opportunity");
    expect(providerPresentationLabel("Polygon-shaped demand")).toBe("Polygon-shaped demand");
  });

  test("maps known branded labels and quote disclaimers without rewriting prose", () => {
    expect(providerPresentationLabel("Massive market data")).toBe("Market data");
    expect(providerPresentationLabel("Polygon news")).toBe("Market news");
    expect(providerPresentationLabel("get_massive_quote")).toBe("get Market data quote");
    expect(providerPresentationLabel("fetch-polygon-aggregates")).toBe(
      "fetch Market data aggregates",
    );
    expect(providerPresentationLabel("real-time, source: Massive")).toBe(
      "real-time, source: Market data",
    );
    expect(providerPresentationLabel("delayed by 15 min, source: Polygon.io")).toBe(
      "delayed by 15 min, source: Market data",
    );
    expect(
      providerPresentationLabel("freshness depends on Massive subscription, source: Massive"),
    ).toBe("freshness depends on market data availability");
    expect(providerPresentationLabel("Massive announced a new product.")).toBe(
      "Massive announced a new product.",
    );
  });

  test("hides provider-owned display hosts without changing the citation URL", () => {
    const massiveUrl = "https://api.massive.com/v2/aggs/ticker/AAPL";
    const polygonUrl = "https://polygon.io/docs/stocks";

    expect(sourceHostPresentationLabel(massiveUrl)).toBe("Market data source");
    expect(sourceHostPresentationLabel(polygonUrl)).toBe("Market data source");
    expect(massiveUrl).toBe("https://api.massive.com/v2/aggs/ticker/AAPL");
    expect(polygonUrl).toBe("https://polygon.io/docs/stocks");
    expect(sourceHostPresentationLabel("https://massive.com.example.com/path")).toBe(
      "massive.com.example.com",
    );
    expect(sourceHostPresentationLabel("https://sec.gov/filing")).toBe("sec.gov");
    expect(sourceHostPresentationLabel("not a URL")).toBe("source");
  });
});
