import { describe, expect, test } from "bun:test";
import { runQuote } from "../src/commands/quote.js";

function mockFetch(impl: typeof fetch) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = orig;
  };
}

describe("mapvest quote", () => {
  test("prints price and change with disclaimer", async () => {
    let seen = "";
    const restore = mockFetch(async (input) => {
      seen = typeof input === "string" ? input : (input as Request).url;
      return new Response(
        JSON.stringify({
          quote: {
            symbol: "HSY",
            price: 190.12,
            change: 1.23,
            changePct: 0.65,
            currency: "USD",
            ts: "2026-01-01T00:00:00Z",
            disclaimer: "Yahoo Finance — delayed 15 min",
          },
        }),
        { status: 200 },
      );
    });
    const out: string[] = [];
    const code = await runQuote(["HSY"], (s) => out.push(s), {
      MAPVEST_API_URL: "http://api.local",
    } as NodeJS.ProcessEnv);
    restore();

    expect(code).toBe(0);
    expect(seen).toBe("http://api.local/v1/quote?symbol=HSY");
    const joined = out.join("\n");
    expect(joined).toContain("HSY");
    expect(joined).toContain("190.12");
    expect(joined).toContain("+1.23");
    expect(joined).toContain("+0.65%");
    expect(joined).toContain("Yahoo Finance");
  });

  test("URL-encodes symbol with special chars", async () => {
    let seen = "";
    const restore = mockFetch(async (input) => {
      seen = typeof input === "string" ? input : (input as Request).url;
      return new Response(
        JSON.stringify({
          quote: {
            symbol: "BRK.B",
            price: 400,
            change: 0,
            changePct: 0,
            currency: "USD",
            ts: "2026-01-01T00:00:00Z",
            disclaimer: "d",
          },
        }),
        { status: 200 },
      );
    });
    await runQuote(["BRK.B"], () => {}, { MAPVEST_API_URL: "http://x" } as NodeJS.ProcessEnv);
    restore();
    expect(seen).toContain("symbol=BRK.B");
  });

  test("returns 1 on 502 error", async () => {
    const restore = mockFetch(async () =>
      new Response(JSON.stringify({ error: "quote unavailable" }), { status: 502 }),
    );
    const out: string[] = [];
    const code = await runQuote(["ZZZZ"], (s) => out.push(s));
    restore();
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("502");
    expect(out.join("\n")).toContain("quote unavailable");
  });

  test("returns 2 with usage line when no symbol given", async () => {
    const out: string[] = [];
    const code = await runQuote([], (s) => out.push(s));
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("usage:");
  });
});
