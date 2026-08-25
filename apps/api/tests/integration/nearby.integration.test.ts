import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

// Env must be set BEFORE the app module is imported so middleware picks it up.
process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY =
  process.env.SESSION_SIGNING_KEY ?? "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY =
  process.env.IOS_MAPS_TOKEN_SIGNING_KEY ?? "test-maps-signing-key-32bytes___";

// Make absolutely sure the mock-places fallback is NOT active — this suite
// must exercise the real Google Places code path.
Reflect.deleteProperty(process.env, "MOCK_PLACES");

import type { NearbyResponse } from "@mapvest/core";
import { app } from "../../src/index.js";
import { __resetMetrics } from "../../src/lib/metrics.js";
import { __resetRateLimit } from "../../src/middleware/rateLimit.js";

const INTEGRATION = process.env.INTEGRATION === "1";
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
const runOrSkip = INTEGRATION && GOOGLE_KEY ? describe : describe.skip;

function url(path: string) {
  return `http://localhost${path}`;
}

beforeAll(() => {
  if (!INTEGRATION) {
    console.log("[integration] skipping /v1/nearby — set INTEGRATION=1 to enable");
  } else if (!GOOGLE_KEY) {
    console.log(
      "[integration] skipping /v1/nearby — GOOGLE_MAPS_API_KEY not set (use `doppler run -- bun test`)",
    );
  }
});

beforeEach(() => {
  __resetRateLimit();
  __resetMetrics();
});

runOrSkip("/v1/nearby (real Google Places)", () => {
  test("returns >=5 items and at least one investable ticker for downtown SF", async () => {
    const qs = new URLSearchParams({ lat: "37.77", lng: "-122.42", radius: "1000" });
    const res = await app.fetch(new Request(url(`/v1/nearby?${qs.toString()}`)));
    expect(res.status).toBe(200);

    const body = (await res.json()) as NearbyResponse;
    expect(Array.isArray(body.items)).toBe(true);

    // Google Places around Market/Van Ness returns a dense list; assert the
    // route is actually calling Places and joining, not returning [].
    expect(body.items.length).toBeGreaterThanOrEqual(5);

    const investableTickers = body.items
      .map((it) => it.investable?.brand?.ticker?.symbol)
      .filter((sym): sym is string => Boolean(sym));

    expect(investableTickers.length).toBeGreaterThanOrEqual(1);
    // Tickers are 1–5 uppercase letters (occasionally with a dot for share
    // class); the assertion just guards against garbage strings.
    for (const sym of investableTickers) {
      expect(sym).toMatch(/^[A-Z][A-Z0-9.]{0,5}$/);
    }
  }, 30_000);
});
