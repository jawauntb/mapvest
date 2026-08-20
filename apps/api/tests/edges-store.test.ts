import { describe, expect, test } from "bun:test";
import { CompanyEdge } from "@mapvest/core";
import type { CompanyEdgeInput } from "@mapvest/finance";
import { listEdges, replaceEdges } from "../src/lib/edges-store.js";

/**
 * In-memory path only (POSTGRES_URL unset in test env). Covers the
 * replace → list contract the value-chain graph depends on: delete-then-insert
 * semantics, supplied ordering, the 200-ticker memory cap, and core-schema
 * shape (every edge carries sources — AGENTS.md §6).
 */

const src = () => `T${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

function edge(over: Partial<CompanyEdgeInput> = {}): CompanyEdgeInput {
  return {
    dstTicker: "TSM",
    dstName: "Taiwan Semiconductor Manufacturing",
    edgeType: "supplies",
    weight: 0.9,
    reasoning: "Leading-edge foundry named in the 10-K.",
    sources: [
      {
        provider: "sec",
        url: "https://www.sec.gov/example-10k",
        fetchedAt: new Date().toISOString(),
        confidence: "high",
      },
    ],
    ...over,
  };
}

describe("edges-store (in-memory)", () => {
  test("replaceEdges stores schema-valid edges and listEdges keeps supplied order", async () => {
    const ticker = src();
    const stored = await replaceEdges(ticker, [
      edge(),
      edge({
        dstTicker: "MSFT",
        dstName: "Microsoft",
        edgeType: "buys_from",
        weight: 0.8,
        reasoning: ">10% customer disclosed in item 1.",
        asOf: "FY2025",
      }),
      edge({
        dstTicker: undefined,
        dstName: "A privately held contract manufacturer",
        edgeType: "complements",
        weight: 0.3,
        sources: [
          { provider: "openrouter", fetchedAt: new Date().toISOString(), confidence: "medium" },
        ],
      }),
    ]);

    expect(stored.length).toBe(3);
    for (const e of stored) {
      const parsed = CompanyEdge.parse(e);
      expect(parsed.srcTicker).toBe(ticker);
      expect(parsed.sources.length).toBeGreaterThan(0);
      expect(parsed.id.length).toBeGreaterThan(0);
    }

    const listed = await listEdges(ticker);
    expect(listed.map((e) => e.dstName)).toEqual(stored.map((e) => e.dstName));
    expect(listed.map((e) => e.edgeType)).toEqual(["supplies", "buys_from", "complements"]);
    expect(listed[1]?.asOf).toBe("FY2025");
    const priv = listed[2]!;
    expect(priv.dstTicker).toBeUndefined();
    expect(priv.dstName).toBe("A privately held contract manufacturer");
  });

  test("replaceEdges overwrites the previous set rather than appending", async () => {
    const ticker = src();
    await replaceEdges(ticker, [edge(), edge({ dstTicker: "AMD", dstName: "AMD" })]);
    expect((await listEdges(ticker)).length).toBe(2);

    await replaceEdges(ticker, [
      edge({ dstTicker: "INTC", dstName: "Intel", edgeType: "competes_with", weight: 0.5 }),
    ]);
    const listed = await listEdges(ticker);
    expect(listed.length).toBe(1);
    expect(listed[0]?.dstTicker).toBe("INTC");
    expect(listed[0]?.srcTicker).toBe(ticker);
  });

  test("replaceEdges with an empty array clears the ticker", async () => {
    const ticker = src();
    await replaceEdges(ticker, [edge()]);
    await replaceEdges(ticker, []);
    expect(await listEdges(ticker)).toEqual([]);
  });

  test("lookup is case-insensitive on the source ticker", async () => {
    const ticker = src();
    await replaceEdges(ticker.toLowerCase(), [edge()]);
    const listed = await listEdges(ticker);
    expect(listed.length).toBe(1);
    expect(listed[0]?.srcTicker).toBe(ticker);
  });

  test("memory fallback keeps at most 200 tickers, evicting the oldest-inserted", async () => {
    const tickers = Array.from({ length: 205 }, (_, i) => `CAP${i}`);
    for (const t of tickers) {
      await replaceEdges(t, [edge({ dstName: t })]);
    }
    // The first inserts fell out of the cap; the most recent survive.
    expect(await listEdges(tickers[0]!)).toEqual([]);
    const last = await listEdges(tickers.at(-1)!);
    expect(last.length).toBe(1);
    expect(last[0]?.dstName).toBe(tickers.at(-1));
  });

  test("mutating a returned list does not corrupt the store", async () => {
    const ticker = src();
    await replaceEdges(ticker, [edge()]);
    const listed = await listEdges(ticker);
    listed.pop();
    expect((await listEdges(ticker)).length).toBe(1);
  });
});
