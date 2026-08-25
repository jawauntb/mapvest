import { describe, expect, test } from "bun:test";
import { runNearby } from "../src/commands/nearby.js";

function mockFetch(impl: typeof fetch) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = orig;
  };
}

describe("mapvest nearby", () => {
  test("hits /v1/nearby with lat/lng and prints a table of places + tickers", async () => {
    let seen = "";
    const restore = mockFetch(async (input) => {
      seen = typeof input === "string" ? input : (input as Request).url;
      return new Response(
        JSON.stringify({
          items: [
            {
              place: {
                id: "p1",
                name: "Starbucks",
                location: { lat: 37.77, lng: -122.42 },
                types: ["cafe"],
              },
              investable: {
                brand: {
                  name: "Starbucks",
                  isPublic: true,
                  sector: "Restaurants",
                  ticker: { symbol: "SBUX", exchange: "NASDAQ" },
                },
                comparables: [],
                etfs: [],
                confidence: "high",
                sources: [],
              },
            },
            {
              place: {
                id: "p2",
                name: "Local Coffee Co",
                location: { lat: 37.77, lng: -122.42 },
                types: ["cafe"],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const out: string[] = [];
    const code = await runNearby(
      ["--lat", "37.77", "--lng", "-122.42", "--radius", "500", "--limit", "10"],
      (s) => out.push(s),
      { MAPVEST_API_URL: "http://api.local" } as NodeJS.ProcessEnv,
    );
    restore();

    expect(code).toBe(0);
    expect(seen).toContain("http://api.local/v1/nearby?");
    expect(seen).toContain("lat=37.77");
    expect(seen).toContain("lng=-122.42");
    expect(seen).toContain("radius=500");
    expect(seen).toContain("limit=10");

    const joined = out.join("\n");
    expect(joined).toContain("Starbucks");
    expect(joined).toContain("SBUX");
    expect(joined).toContain("Local Coffee Co");
    expect(joined).toContain("—"); // em dash for missing ticker
  });

  test("accepts --lat=... = form", async () => {
    let seen = "";
    const restore = mockFetch(async (input) => {
      seen = typeof input === "string" ? input : (input as Request).url;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    const out: string[] = [];
    const code = await runNearby(["--lat=1.0", "--lng=2.0"], (s) => out.push(s));
    restore();
    expect(code).toBe(0);
    expect(seen).toContain("lat=1");
    expect(seen).toContain("lng=2");
    expect(out.join("\n")).toContain("no nearby places");
  });

  test("returns 2 with usage line when --lat/--lng missing", async () => {
    const out: string[] = [];
    const code = await runNearby([], (s) => out.push(s));
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("usage:");
  });

  test("returns 2 when coords are not numbers", async () => {
    const out: string[] = [];
    const code = await runNearby(["--lat", "hello", "--lng", "world"], (s) => out.push(s));
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("must be numbers");
  });

  test("returns 1 on API error", async () => {
    const restore = mockFetch(
      async () => new Response(JSON.stringify({ error: "lat/lng required" }), { status: 400 }),
    );
    const out: string[] = [];
    const code = await runNearby(["--lat", "1", "--lng", "2"], (s) => out.push(s));
    restore();
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("400");
  });
});
