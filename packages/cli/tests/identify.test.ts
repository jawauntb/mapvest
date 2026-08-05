import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIdentify } from "../src/commands/identify.js";

/**
 * Sets globalThis.fetch to `impl` and returns a restore function. Every
 * command test uses the same shape — we mock at the global level so the
 * command exercises the same code path it does in production.
 */
function mockFetch(impl: typeof fetch) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = orig;
  };
}

let tmpDir = "";
let imagePath = "";

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mapvest-cli-"));
  imagePath = join(tmpDir, "sample.jpg");
  await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // tiny JPEG header/footer
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("mapvest identify", () => {
  test("prints top brand + ticker + comparables + top ETF on success", async () => {
    const captured: { url?: string; method?: string; body?: unknown } = {};
    const restore = mockFetch(async (input, init) => {
      captured.url = typeof input === "string" ? input : (input as Request).url;
      captured.method = init?.method ?? "GET";
      captured.body = init?.body;
      return new Response(
        JSON.stringify({
          identification: { visibleText: [], detected: [], modelUsed: "gpt-x" },
          investables: [
            {
              brand: {
                name: "Hershey's",
                parent: "The Hershey Company",
                sector: "Consumer Staples",
                isPublic: true,
                ticker: { symbol: "HSY", exchange: "NYSE" },
              },
              comparables: [
                { ticker: "MDLZ", name: "Mondelez", score: 0.82, reasoning: "snacks", sources: [] },
                { ticker: "NSRGY", name: "Nestle", score: 0.71, reasoning: "candy", sources: [] },
              ],
              etfs: [
                {
                  ticker: "XLP",
                  name: "Consumer Staples SPDR",
                  weight: 0.0123,
                  source: { provider: "manual", fetchedAt: "2026-01-01", confidence: "high" },
                },
              ],
              confidence: "high",
              sources: [],
              quote: {
                symbol: "HSY",
                price: 190.12,
                change: -1.23,
                changePct: -0.64,
                currency: "USD",
                ts: "2026-01-01T00:00:00Z",
                disclaimer: "Delayed 15 min",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const out: string[] = [];
    const code = await runIdentify([imagePath], (s) => out.push(s), {
      MAPVEST_API_URL: "http://localhost:1234",
    } as NodeJS.ProcessEnv);
    restore();

    expect(code).toBe(0);
    expect(captured.url).toBe("http://localhost:1234/v1/identify");
    expect(captured.method).toBe("POST");
    // Body should be multipart FormData.
    expect(captured.body instanceof FormData).toBe(true);
    const joined = out.join("\n");
    expect(joined).toContain("Hershey's");
    expect(joined).toContain("HSY");
    expect(joined).toContain("NYSE");
    expect(joined).toContain("comparables");
    expect(joined).toContain("MDLZ");
    expect(joined).toContain("top ETF");
    expect(joined).toContain("XLP");
    expect(joined).toContain("190.12");
    expect(joined).toContain("-1.23");
  });

  test("prints 'no investable brand' when the API returns an empty list", async () => {
    const restore = mockFetch(async () =>
      new Response(
        JSON.stringify({
          identification: { visibleText: [], detected: [], modelUsed: "gpt-x" },
          investables: [],
        }),
        { status: 200 },
      ),
    );
    const out: string[] = [];
    const code = await runIdentify([imagePath], (s) => out.push(s));
    restore();
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("no investable brand");
  });

  test("returns 1 with a formatted error line on API error", async () => {
    const restore = mockFetch(async () =>
      new Response(JSON.stringify({ error: "image too large (max 8MB)" }), { status: 413 }),
    );
    const out: string[] = [];
    const code = await runIdentify([imagePath], (s) => out.push(s));
    restore();
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("413");
    expect(out.join("\n")).toContain("image too large");
  });

  test("returns 2 when no image path is given", async () => {
    const out: string[] = [];
    const code = await runIdentify([], (s) => out.push(s));
    expect(code).toBe(2);
    expect(out.join("\n")).toContain("usage:");
  });

  test("returns 1 when the local file cannot be read", async () => {
    const out: string[] = [];
    const code = await runIdentify(["/nonexistent/mapvest-cli-does-not-exist.jpg"], (s) => out.push(s));
    expect(code).toBe(1);
    expect(out.join("\n")).toContain("cannot read");
  });
});
