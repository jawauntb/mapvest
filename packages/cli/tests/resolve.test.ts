import { describe, expect, test } from "bun:test";
import { runResolve } from "../src/commands/resolve.js";

function mockFetch(impl: typeof fetch) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = orig;
  };
}

describe("mapvest resolve", () => {
  test("POSTs to /v1/resolve-comparable and prints brand + comparables + etfs", async () => {
    const captured: { url?: string; method?: string; body?: string; headers?: Headers } = {};
    const restore = mockFetch(async (input, init) => {
      captured.url = typeof input === "string" ? input : (input as Request).url;
      captured.method = init?.method ?? "GET";
      captured.body = init?.body as string;
      captured.headers = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          brand: {
            name: "In-N-Out Burger",
            isPublic: false,
            sector: "Restaurants",
          },
          comparables: [
            {
              ticker: "MCD",
              name: "McDonald's",
              score: 0.7,
              reasoning: "QSR burger chain",
              sources: [],
            },
            {
              ticker: "SHAK",
              name: "Shake Shack",
              score: 0.55,
              reasoning: "Premium burger chain",
              sources: [],
            },
          ],
          etfs: [
            {
              ticker: "PBJ",
              name: "Invesco Food & Beverage",
              weight: 0.04,
              source: { provider: "manual", fetchedAt: "2026-01-01", confidence: "high" },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const out: string[] = [];
    const code = await runResolve(["In-N-Out", "--sector", "Restaurants"], (s) => out.push(s), {
      MAPVEST_API_URL: "http://localhost:1234",
    } as NodeJS.ProcessEnv);
    restore();

    expect(code).toBe(0);
    expect(captured.url).toBe("http://localhost:1234/v1/resolve-comparable");
    expect(captured.method).toBe("POST");
    expect(captured.headers?.get("content-type")).toBe("application/json");
    const parsed = JSON.parse(captured.body ?? "{}") as { brand: string; hintSector?: string };
    expect(parsed.brand).toBe("In-N-Out");
    expect(parsed.hintSector).toBe("Restaurants");

    const joined = out.join("\n");
    expect(joined).toContain("In-N-Out Burger");
    expect(joined).toContain("Restaurants");
    expect(joined).toContain("comparables");
    expect(joined).toContain("MCD");
    expect(joined).toContain("SHAK");
    expect(joined).toContain("ETFs");
    expect(joined).toContain("PBJ");
    expect(joined).toContain("4.00%");
  });

  test("omits hintSector when --sector is not provided", async () => {
    let captured = "";
    const restore = mockFetch(async (_input, init) => {
      captured = init?.body as string;
      return new Response(
        JSON.stringify({ brand: { name: "Foo", isPublic: false }, comparables: [], etfs: [] }),
        { status: 200 },
      );
    });
    await runResolve(["Foo"], () => {});
    restore();
    const parsed = JSON.parse(captured) as { brand: string; hintSector?: string };
    expect(parsed.brand).toBe("Foo");
    expect("hintSector" in parsed).toBe(false);
  });

  test("returns 2 with usage line when brand arg is missing", async () => {
    const out: string[] = [];
    const code = await runResolve([], (s) => out.push(s));
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("usage:");
  });

  test("returns 1 on API error", async () => {
    const restore = mockFetch(
      async () => new Response(JSON.stringify({ error: "brand required" }), { status: 400 }),
    );
    const out: string[] = [];
    const code = await runResolve(["x"], (s) => out.push(s));
    restore();
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("400");
  });
});
