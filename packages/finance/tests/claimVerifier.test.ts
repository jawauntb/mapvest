import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ClaimCheck, ClaimVerifier } from "../src/claimVerifier.js";

/**
 * The verifier is a second reading on a finance agent's claim. Its contract (AGENTS.md §2.4): it can only
 * REMOVE a claim the verifier calls unsupported. No verifier, a throw, a missing id, a malformed answer and a claim
 * with nothing to check against all keep the claim exactly as before. Offline: Exa and the model are stubbed at `fetch`, so no module is replaced and nothing leaks into other test files.
 */

const SNIPPET_TSMC =
  "We utilize industry-leading suppliers, such as Taiwan Semiconductor Manufacturing Company Limited and Samsung Electronics Co. Ltd., to manufacture our wafers.";
const SNIPPET_OTHER =
  "Dividend history and payout ratio for a consumer staples company over the last ten fiscal years, with quarterly figures.";

const { checkable, comparableStatement, edgeStatement, keepSupported, verifyClaims } = await import(
  "../src/claimVerifier.js"
);
const { extractValueChain } = await import("../src/valueChain.js");
const { resolveComparable } = await import("../src/comparable.js");

const claim = (id: string, snippet = SNIPPET_TSMC): ClaimCheck => ({
  id,
  statement: `${id} supplies components or services to NVDA.`,
  evidence: { title: "t", url: "https://example.com/a", snippet },
});

describe("verifyClaims", () => {
  test("no verifier, no claims, or a throw: every claim is unknown", async () => {
    expect(await verifyClaims([claim("a")], undefined)).toEqual({ a: "unknown" });
    expect(await verifyClaims([], async () => ({ a: "unsupported" }))).toEqual({});
    const boom: ClaimVerifier = async () => {
      throw new Error("jev down");
    };
    expect(await verifyClaims([claim("a"), claim("b")], boom)).toEqual({
      a: "unknown",
      b: "unknown",
    });
  });

  test("only a clean supported or unsupported is taken; anything else is unknown", async () => {
    const v: ClaimVerifier = async () =>
      ({ a: "unsupported", b: "supported", c: "maybe", d: 3, zzz: "unsupported" }) as never;
    expect(
      await verifyClaims([claim("a"), claim("b"), claim("c"), claim("d"), claim("e")], v),
    ).toEqual({
      a: "unsupported",
      b: "supported",
      c: "unknown",
      d: "unknown",
      e: "unknown",
    });
  });
});

describe("keepSupported", () => {
  test("drops only what the verifier calls unsupported; unchecked items always stay", async () => {
    const staged = [
      { item: "kept-supported", check: claim("c0") },
      { item: "dropped", check: claim("c1") },
      { item: "kept-unknown", check: claim("c2") },
      { item: "kept-nothing-to-check" },
    ];
    const v: ClaimVerifier = async () => ({ c0: "supported", c1: "unsupported" });
    expect(await keepSupported(staged, v)).toEqual([
      "kept-supported",
      "kept-unknown",
      "kept-nothing-to-check",
    ]);
    expect(await keepSupported(staged, undefined)).toHaveLength(4);
  });
});

describe("statements and checkable", () => {
  test("each relation reads FROM the counterparty TOWARD the symbol, as the judge prompt defines it", () => {
    expect(edgeStatement("NVDA", "TSMC", "supplies")).toMatch(/TSMC supplies .* NVDA/);
    expect(edgeStatement("NVDA", "Dell", "buys_from")).toMatch(/Dell is a customer of NVDA/);
    expect(edgeStatement("NVDA", "AMD", "competes_with")).toBe("AMD competes with NVDA.");
    expect(edgeStatement("NVDA", "SAP", "complements")).toMatch(/SAP is a partner/);
    expect(edgeStatement("NVDA", "X", "owns")).toBeNull();
    expect(comparableStatement("Lego", "Mattel, Inc.", "MAT")).toMatch(
      /Mattel, Inc. \(MAT\).*Lego/,
    );
  });

  test("a snippet too short to check a claim against is not checkable", () => {
    expect(checkable(undefined)).toBe(false);
    expect(checkable({ title: "t", url: "u", snippet: "too short" })).toBe(false);
    expect(checkable({ title: "t", url: "u", snippet: SNIPPET_TSMC })).toBe(true);
  });
});

const originalFetch = globalThis.fetch;
const originalEnv = { exa: process.env.EXA_API_KEY, or: process.env.OPENROUTER_API_KEY };
const EXA_HITS = [
  { title: "10-K excerpt", url: "https://example.com/a", highlights: [SNIPPET_TSMC] },
  { title: "Dividends", url: "https://example.com/b", highlights: [SNIPPET_OTHER] },
];
/** Exa returns two fixed hits; the OpenRouter judge returns `content`. */
const judge = (content: unknown) => {
  globalThis.fetch = (async (input: URL | Request | string) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.exa.ai"))
      return new Response(JSON.stringify({ results: EXA_HITS }), { status: 200 });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
};
const restore = (name: "EXA_API_KEY" | "OPENROUTER_API_KEY", v: string | undefined) => {
  if (v === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = v;
};
beforeEach(() => {
  process.env.EXA_API_KEY = "test-exa";
  process.env.OPENROUTER_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  restore("EXA_API_KEY", originalEnv.exa);
  restore("OPENROUTER_API_KEY", originalEnv.or);
});

describe("extractValueChain with a verifier", () => {
  const edges = {
    edges: [
      {
        counterparty: "Taiwan Semiconductor Manufacturing",
        ticker: "TSM",
        relation: "supplies",
        weight: 0.9,
        reasoning: "foundry",
        sourceUrl: "https://example.com/a",
      },
      {
        counterparty: "GlobalFoundries",
        ticker: "GFS",
        relation: "supplies",
        weight: 0.5,
        reasoning: "foundry",
        sourceUrl: "https://example.com/b",
      },
    ],
  };

  test("an edge whose cited snippet is called unsupported is dropped; the rest stay", async () => {
    judge(edges);
    const asked: ClaimCheck[] = [];
    const verify: ClaimVerifier = async (claims) => {
      asked.push(...claims);
      return Object.fromEntries(
        claims.map((c) => [
          c.id,
          /GlobalFoundries/.test(c.statement) ? "unsupported" : "supported",
        ]),
      );
    };
    const out = await extractValueChain("NVDA", { verify });
    expect(out.map((e) => e.dstTicker)).toEqual(["TSM"]);
    expect(asked).toHaveLength(2);
    // The verifier is shown the edge's own cited snippet, and the relation in the direction the prompt defines.
    expect(asked[0]?.evidence.snippet).toBe(SNIPPET_TSMC);
    expect(asked[0]?.statement).toMatch(/supplies components or services to NVDA/);
  });

  test("no verifier, a throwing verifier and an all-unknown verifier return the same edges as before", async () => {
    judge(edges);
    // fetchedAt is stamped per call, so it is left out of the comparison.
    const same = (edges: Awaited<ReturnType<typeof extractValueChain>>) =>
      edges.map((e) => ({ ...e, sources: e.sources.map(({ fetchedAt: _t, ...rest }) => rest) }));
    const base = await extractValueChain("NVDA");
    expect(base.map((e) => e.dstTicker)).toEqual(["TSM", "GFS"]);
    const boom: ClaimVerifier = async () => {
      throw new Error("jev down");
    };
    expect(same(await extractValueChain("NVDA", { verify: boom }))).toEqual(same(base));
    expect(same(await extractValueChain("NVDA", { verify: async () => ({}) }))).toEqual(same(base));
  });

  test("a filing citation carries no text, so it is never sent to the verifier and never dropped", async () => {
    judge({
      edges: [
        {
          counterparty: "Taiwan Semiconductor Manufacturing",
          ticker: "TSM",
          relation: "supplies",
          weight: 0.9,
          reasoning: "10-K item 1",
          sourceUrl: "https://sec.example/10k",
        },
      ],
    });
    const asked: ClaimCheck[] = [];
    const out = await extractValueChain("NVDA", {
      filings: [{ url: "https://sec.example/10k", label: "10-K" }],
      verify: async (claims) => {
        asked.push(...claims);
        return Object.fromEntries(claims.map((c) => [c.id, "unsupported"]));
      },
    });
    expect(asked).toHaveLength(0);
    expect(out).toHaveLength(1);
    expect(out[0]?.sources[0]?.provider).toBe("sec");
  });
});

describe("resolveComparable with a verifier", () => {
  const picks = {
    picks: [
      {
        ticker: "TSM",
        name: "Taiwan Semiconductor",
        score: 0.9,
        reasoning: "x",
        sourceUrl: "https://example.com/a",
      },
      {
        ticker: "KO",
        name: "Coca-Cola",
        score: 0.8,
        reasoning: "x",
        sourceUrl: "https://example.com/b",
      },
      { ticker: "PEP", name: "PepsiCo", score: 0.7, reasoning: "no citation" },
    ],
  };

  test("a pick whose cited snippet is called unsupported is dropped; an uncited pick is never checked", async () => {
    judge(picks);
    const asked: ClaimCheck[] = [];
    const out = await resolveComparable("Some Brand", undefined, {
      verify: async (claims) => {
        asked.push(...claims);
        return Object.fromEntries(
          claims.map((c) => [c.id, /Coca-Cola/.test(c.statement) ? "unsupported" : "supported"]),
        );
      },
    });
    expect(out.map((c) => c.ticker)).toEqual(["TSM", "PEP"]);
    expect(asked).toHaveLength(2);
  });

  test("the call keeps its old two-argument form and result without a verifier", async () => {
    judge(picks);
    const out = await resolveComparable("Some Brand");
    expect(out.map((c) => c.ticker)).toEqual(["TSM", "KO", "PEP"]);
  });
});
