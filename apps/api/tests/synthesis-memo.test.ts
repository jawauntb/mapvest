import { describe, expect, test } from "bun:test";
import type { CompanyEdge, DemandPulse, EnvironmentBrief, Source } from "@mapvest/core";
import type { FinancialRatios } from "@mapvest/finance";
import {
  type SynthesisInputs,
  buildSynthesisPrompt,
  parseSynthesis,
  unionSources,
} from "../src/lib/synthesis-memo.js";

/**
 * Pure-surface coverage for the synthesis memo (Universe Roadmap C5): prompt
 * composition per layer presence, model-output parsing, and the source union.
 * No network, no POSTGRES_URL, no OPENROUTER_API_KEY — `buildSynthesisPrompt`
 * and `parseSynthesis` take plain values, so the whole composable surface runs
 * offline.
 */

const EXA_SOURCE: Source = {
  provider: "exa",
  url: "https://example.com/nvda-10k-customers",
  fetchedAt: "2026-08-20T00:00:00.000Z",
  confidence: "high",
};

const MASSIVE_SOURCE: Source = {
  provider: "massive",
  url: "https://api.massive.com/stocks/financials/v1/income-statements?ticker=MSFT",
  fetchedAt: "2026-08-20T00:00:00.000Z",
  confidence: "high",
};

function edge(partial: Partial<CompanyEdge> & { dstName: string }): CompanyEdge {
  return {
    id: crypto.randomUUID(),
    srcTicker: "NVDA",
    edgeType: "supplies",
    weight: 0.6,
    reasoning: "10-K item 1 customer concentration",
    sources: [EXA_SOURCE],
    asOf: "2026-01-31",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

const PULSE: DemandPulse = {
  ticker: "NVDA",
  buyers: [
    { ticker: "MSFT", name: "Microsoft", revenueYoY: 14.2, capexYoY: 31.5, weight: 0.6 },
    { ticker: "META", name: "Meta Platforms", revenueYoY: 9.1, weight: 0.4 },
  ],
  pulse: 12.1,
  interpretation: "expanding",
  generatedAt: "2026-08-20T00:00:00.000Z",
  sources: [MASSIVE_SOURCE],
};

const BRIEF: EnvironmentBrief = {
  sector: "Information Technology",
  headline: "Rate relief is arriving faster than capex discipline",
  body: "Body paragraph.",
  tailwinds: ["Datacenter buildout budgets are still rising."],
  headwinds: ["Export controls narrow the addressable market."],
  series: [
    {
      id: "FEDFUNDS",
      label: "Federal funds rate",
      latest: 3.75,
      unit: "percent",
      asOf: "2026-07-01",
    },
  ],
  generatedAt: "2026-08-20T00:00:00.000Z",
  sources: [{ ...EXA_SOURCE, url: "https://example.com/tech-policy" }],
};

const RATIOS: FinancialRatios = {
  ticker: "NVDA",
  date: "2026-06-30",
  priceToEarnings: 41.3,
  returnOnEquity: 0.62,
  debtToEquity: 0.14,
};

function inputs(overrides: Partial<SynthesisInputs> = {}): SynthesisInputs {
  return {
    ticker: "NVDA",
    edges: [],
    pulse: null,
    environment: null,
    ratios: null,
    ...overrides,
  };
}

describe("buildSynthesisPrompt", () => {
  test("includes every layer when all four are present", () => {
    const prompt = buildSynthesisPrompt(
      inputs({
        // Edge semantics per valueChain.ts: TSMC SUPPLIES NVDA; MSFT BUYS FROM
        // NVDA. The prompt must group them under the matching human labels.
        edges: [
          edge({ dstName: "TSMC", dstTicker: "TSM", edgeType: "supplies", weight: 0.9 }),
          edge({ dstName: "Microsoft", dstTicker: "MSFT", edgeType: "buys_from" }),
        ],
        pulse: PULSE,
        environment: BRIEF,
        ratios: RATIOS,
      }),
    );

    expect(prompt).toContain("Ticker: NVDA");
    expect(prompt).toContain("Microsoft (MSFT)");
    expect(prompt).toContain("TSMC (TSM)");
    expect(prompt).toContain("Suppliers (this company buys inputs from them)");
    expect(prompt).toContain("Buyers/customers (they buy this company's products)");
    // The TSMC supplier row must land under the Suppliers heading, not Buyers.
    expect(prompt.indexOf("TSMC (TSM)")).toBeGreaterThan(prompt.indexOf("Suppliers ("));
    expect(prompt.indexOf("TSMC (TSM)")).toBeLessThan(prompt.indexOf("Buyers/customers ("));
    expect(prompt).toContain("https://example.com/nvda-10k-customers");
    expect(prompt).toContain("12.1% YoY");
    expect(prompt).toContain("interpretation: expanding");
    expect(prompt).toContain("Federal funds rate");
    expect(prompt).toContain("Rate relief is arriving faster than capex discipline");
    expect(prompt).toContain("P/E: 41.3");
    // No layer is announced as missing when all four resolved.
    expect(prompt).not.toContain("the graph is empty");
    expect(prompt).not.toContain("(no demand pulse available");
    expect(prompt).not.toContain("(no environment brief available");
    expect(prompt).not.toContain("(no financial ratios available");
  });

  test("omits an absent layer and states the gap instead of inventing it", () => {
    const prompt = buildSynthesisPrompt(inputs({ ratios: RATIOS }));

    expect(prompt).toContain("the graph is empty");
    expect(prompt).toContain("(no demand pulse available");
    expect(prompt).toContain("(no environment brief available");
    // The one layer that did resolve is still carried in full.
    expect(prompt).toContain("P/E: 41.3");
    expect(prompt).toContain("Return on equity: 0.62");
    expect(prompt).not.toContain("(no financial ratios available");
    // Nothing about buyers or macro leaks in from the missing layers.
    expect(prompt).not.toContain("Microsoft");
    expect(prompt).not.toContain("FEDFUNDS");
  });

  test("zero layer data still produces a prompt that names all four gaps", () => {
    const prompt = buildSynthesisPrompt(inputs());
    expect(prompt).toContain("the graph is empty");
    expect(prompt).toContain("(no demand pulse available");
    expect(prompt).toContain("(no environment brief available");
    expect(prompt).toContain("(no financial ratios available");
    expect(prompt).toContain("Write the Synthesis Memo for NVDA");
  });

  test("a pulse whose buyers did not resolve reads as unavailable, not as zero", () => {
    const unresolved: DemandPulse = {
      ...PULSE,
      buyers: [],
      pulse: null,
      interpretation: "unknown",
      sources: [],
    };
    const prompt = buildSynthesisPrompt(inputs({ pulse: unresolved }));
    expect(prompt).toContain("(no demand pulse available");
    expect(prompt).not.toContain("0.0% YoY");
  });

  test("private counterparties are labelled, never given a ticker", () => {
    const prompt = buildSynthesisPrompt(
      inputs({ edges: [edge({ dstName: "Foxconn Interconnect", dstTicker: undefined })] }),
    );
    expect(prompt).toContain("Foxconn Interconnect (private)");
  });

  test("ratios with no usable numeric fields read as unavailable", () => {
    const prompt = buildSynthesisPrompt(inputs({ ratios: { ticker: "NVDA", date: "2026-06-30" } }));
    expect(prompt).toContain("(no financial ratios available");
  });

  test("caps the edges handed to the model at 12", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      edge({ dstName: `Counterparty ${i}`, dstTicker: `C${i}` }),
    );
    const prompt = buildSynthesisPrompt(inputs({ edges: many }));
    expect(prompt).toContain("Counterparty 11");
    expect(prompt).not.toContain("Counterparty 12");
  });
});

describe("parseSynthesis", () => {
  test("parses a clean JSON object with all four fields", () => {
    const parsed = parseSynthesis(
      JSON.stringify({
        memo: "NVDA sells into a buyer set whose capex is up 31.5% YoY.",
        bindingConstraint: "Advanced packaging capacity at TSMC.",
        demandDurability: "Durable while hyperscaler capex holds.",
        pricingPower: "Sits with NVDA, not its buyers.",
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.memo).toContain("31.5% YoY");
    expect(parsed?.bindingConstraint).toBe("Advanced packaging capacity at TSMC.");
    expect(parsed?.demandDurability).toBe("Durable while hyperscaler capex holds.");
    expect(parsed?.pricingPower).toBe("Sits with NVDA, not its buyers.");
  });

  test("parses a fenced JSON block with surrounding prose", () => {
    const raw = 'Here you go:\n```json\n{ "memo": "The graph is empty for this ticker." }\n```\n';
    const parsed = parseSynthesis(raw);
    expect(parsed?.memo).toBe("The graph is empty for this ticker.");
    expect(parsed?.bindingConstraint).toBeUndefined();
    expect(parsed?.demandDurability).toBeUndefined();
    expect(parsed?.pricingPower).toBeUndefined();
  });

  test("drops blank optional answers rather than carrying empty strings", () => {
    const parsed = parseSynthesis(
      JSON.stringify({ memo: "Memo text.", bindingConstraint: "   ", pricingPower: "Buyers." }),
    );
    expect(parsed?.bindingConstraint).toBeUndefined();
    expect(parsed?.pricingPower).toBe("Buyers.");
  });

  test("returns null for malformed or unusable output", () => {
    expect(parseSynthesis("not json at all")).toBeNull();
    expect(parseSynthesis('{ "memo": "unterminated')).toBeNull();
    expect(parseSynthesis(JSON.stringify({ bindingConstraint: "no memo here" }))).toBeNull();
    expect(parseSynthesis(JSON.stringify({ memo: "" }))).toBeNull();
    expect(parseSynthesis(JSON.stringify({ memo: 42 }))).toBeNull();
    expect(parseSynthesis(JSON.stringify(["memo"]))).toBeNull();
    expect(parseSynthesis("")).toBeNull();
  });
});

describe("unionSources", () => {
  test("unions the layers, dedupes by url, and never invents a citation", () => {
    const sources = unionSources({
      edges: [edge({ dstName: "Microsoft", dstTicker: "MSFT" }), edge({ dstName: "Meta" })],
      pulse: PULSE,
      environment: BRIEF,
      ratiosSource: MASSIVE_SOURCE,
    });
    // Two edges cite the same url → one entry; pulse and ratios share the
    // massive url → one entry; the environment url is its own.
    expect(sources.map((s) => s.url)).toEqual([
      "https://example.com/nvda-10k-customers",
      "https://api.massive.com/stocks/financials/v1/income-statements?ticker=MSFT",
      "https://example.com/tech-policy",
    ]);
  });

  test("no layers means no sources — not a fabricated one", () => {
    expect(unionSources({ edges: [], pulse: null, environment: null, ratiosSource: null })).toEqual(
      [],
    );
  });

  test("caps the union at 12 sources", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      edge({
        dstName: `C${i}`,
        sources: [{ ...EXA_SOURCE, url: `https://example.com/evidence-${i}` }],
      }),
    );
    const sources = unionSources({
      edges: many,
      pulse: null,
      environment: null,
      ratiosSource: null,
    });
    expect(sources).toHaveLength(12);
  });
});
