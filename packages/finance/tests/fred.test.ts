import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fredConfigured, fredSeriesUrl, getSeries, sectorSeries } from "../src/index.js";

/**
 * Offline only — `globalThis.fetch` is stubbed for every case that would touch
 * the network, so no FRED call ever leaves the machine. Covers URL construction
 * (the exact query the provider builds), response parsing (including FRED's "."
 * missing-value sentinel), the missing-key guard, and the sector series map.
 */

const realFetch = globalThis.fetch;
const savedEnv = { key: process.env.FRED_API_KEY, base: process.env.FRED_BASE_URL };

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Fixture shaped like a real FRED /series/observations payload. */
const OBSERVATIONS_FIXTURE = {
  realtime_start: "2026-08-20",
  realtime_end: "2026-08-20",
  observation_start: "1600-01-01",
  observation_end: "9999-12-31",
  units: "lin",
  count: 5,
  observations: [
    { realtime_start: "2026-08-20", realtime_end: "2026-08-20", date: "2026-07-01", value: "4.33" },
    { realtime_start: "2026-08-20", realtime_end: "2026-08-20", date: "2026-06-01", value: "." },
    { realtime_start: "2026-08-20", realtime_end: "2026-08-20", date: "2026-05-01", value: "4.58" },
    { realtime_start: "2026-08-20", realtime_end: "2026-08-20", date: "2026-04-01", value: "" },
    { realtime_start: "2026-08-20", realtime_end: "2026-08-20", date: "", value: "4.61" },
  ],
};

beforeEach(() => {
  process.env.FRED_API_KEY = "test-fred-key";
  process.env.FRED_BASE_URL = "https://fred.test/fred";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries({
    FRED_API_KEY: savedEnv.key,
    FRED_BASE_URL: savedEnv.base,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("FRED provider", () => {
  test("builds the documented observations URL", async () => {
    const calls = installFetch(() => json(OBSERVATIONS_FIXTURE));
    await getSeries("dff", { limit: 12 });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://fred.test/fred/series/observations");
    expect(url.searchParams.get("series_id")).toBe("DFF");
    expect(url.searchParams.get("api_key")).toBe("test-fred-key");
    expect(url.searchParams.get("file_type")).toBe("json");
    expect(url.searchParams.get("sort_order")).toBe("desc");
    expect(url.searchParams.get("limit")).toBe("12");
    expect(url.searchParams.get("observation_start")).toBeNull();
  });

  test("passes the observation window through when supplied", async () => {
    const calls = installFetch(() => json(OBSERVATIONS_FIXTURE));
    await getSeries("CPIAUCSL", { from: "2025-01-01", to: "2026-01-01" });

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("observation_start")).toBe("2025-01-01");
    expect(url.searchParams.get("observation_end")).toBe("2026-01-01");
    // Default limit applies when the caller does not supply one.
    expect(url.searchParams.get("limit")).toBe("24");
  });

  test("parses observations newest-first and drops missing values", async () => {
    installFetch(() => json(OBSERVATIONS_FIXTURE));
    const observations = await getSeries("DFF");

    // "." and "" are FRED's missing sentinels; the undated row is unusable.
    expect(observations).toEqual([
      { date: "2026-07-01", value: 4.33 },
      { date: "2026-05-01", value: 4.58 },
    ]);
    expect(observations[0]!.value).not.toBe(0);
  });

  test("clamps an absurd limit rather than forwarding it", async () => {
    const calls = installFetch(() => json({ observations: [] }));
    await getSeries("DFF", { limit: 10_000 });
    expect(new URL(calls[0]!.url).searchParams.get("limit")).toBe("1000");

    await getSeries("DFF", { limit: 0 });
    expect(new URL(calls[1]!.url).searchParams.get("limit")).toBe("1");
  });

  test("throws with the FRED error message on a non-2xx response", async () => {
    installFetch(() => json({ error_message: "Bad Request. The series does not exist." }, 400));
    await expect(getSeries("NOPE")).rejects.toThrow(/FRED NOPE 400.*does not exist/);
  });

  test("returns an empty array for a blank series id without calling out", async () => {
    const calls = installFetch(() => json(OBSERVATIONS_FIXTURE));
    expect(await getSeries("   ")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("throws the standard missing-env error when FRED_API_KEY is unset", async () => {
    const calls = installFetch(() => json(OBSERVATIONS_FIXTURE));
    // Genuinely absent, not the string "undefined" that a plain assignment
    // would leave behind — `fredConfigured` must see no key at all.
    const envKey = "FRED_API_KEY";
    delete process.env[envKey];

    expect(fredConfigured()).toBe(false);
    await expect(getSeries("DFF")).rejects.toThrow("FRED_API_KEY missing (Doppler)");
    expect(calls).toHaveLength(0);
  });

  test("fredConfigured tracks the env var", () => {
    expect(fredConfigured()).toBe(true);
    process.env.FRED_API_KEY = "   ";
    expect(fredConfigured()).toBe(false);
  });

  test("fredSeriesUrl points at the public, key-free landing page", () => {
    expect(fredSeriesUrl("dff")).toBe("https://fred.stlouisfed.org/series/DFF");
  });
});

describe("sector series map", () => {
  test("always carries the policy rate and headline CPI", () => {
    for (const sector of [
      "Information Technology",
      "Energy",
      "Communication Services",
      "Not A Sector",
    ]) {
      const ids = sectorSeries(sector).map((s) => s.id);
      expect(ids).toContain("DFF");
      expect(ids).toContain("CPIAUCSL");
    }
  });

  test("adds one sector-flavored series for sectors that have an obvious one", () => {
    expect(sectorSeries("Information Technology").map((s) => s.id)).toEqual([
      "DFF",
      "CPIAUCSL",
      "IPG3344S",
    ]);
    expect(sectorSeries("Consumer Discretionary").map((s) => s.id)).toContain("UMCSENT");
    expect(sectorSeries("Energy").map((s) => s.id)).toContain("DCOILWTICO");
    expect(sectorSeries("Real Estate").map((s) => s.id)).toContain("MORTGAGE30US");
  });

  test("falls back to the base pair for sectors and labels with no obvious series", () => {
    expect(sectorSeries("Communication Services").map((s) => s.id)).toEqual(["DFF", "CPIAUCSL"]);
    expect(sectorSeries(null).map((s) => s.id)).toEqual(["DFF", "CPIAUCSL"]);
    expect(sectorSeries("wat").map((s) => s.id)).toEqual(["DFF", "CPIAUCSL"]);
  });

  test("every series carries a human label and never exceeds three entries", () => {
    for (const sector of ["Financials", "Health Care", "Utilities", "Materials", "Industrials"]) {
      const refs = sectorSeries(sector);
      expect(refs.length).toBeLessThanOrEqual(3);
      expect(refs.length).toBeGreaterThanOrEqual(2);
      for (const ref of refs) {
        expect(ref.label.length).toBeGreaterThan(0);
        expect(ref.id).toMatch(/^[A-Z0-9]+$/);
      }
    }
  });
});
