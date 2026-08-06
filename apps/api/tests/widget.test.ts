import { beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";
process.env.MOCK_PLACES = resolve(import.meta.dir, "fixtures/mock-places-widget.json");

import type { WidgetNearbyResponse } from "@mapvest/core";
import { app } from "../src/index.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost${path}`;
}

beforeEach(() => {
  __resetRateLimit();
  __resetMetrics();
});

describe("GET /v1/widget/nearby", () => {
  test("400s without lat/lng", async () => {
    const res = await app.fetch(new Request(url("/v1/widget/nearby")));
    expect(res.status).toBe(400);
  });

  test("returns trimmed nearby items sorted by distance, capped at MAX_LIMIT", async () => {
    const qs = new URLSearchParams({ lat: "37.7749", lng: "-122.4194", limit: "50" });
    const res = await app.fetch(new Request(url(`/v1/widget/nearby?${qs.toString()}`)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as WidgetNearbyResponse;

    expect(body.origin).toEqual({ lat: 37.7749, lng: -122.4194 });
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.length).toBeLessThanOrEqual(12); // MAX_LIMIT even though limit=50 was requested

    // Sorted nearest-first.
    for (let i = 1; i < body.items.length; i++) {
      expect(body.items[i]!.distanceM!).toBeGreaterThanOrEqual(body.items[i - 1]!.distanceM!);
    }

    // Starbucks/McDonald's resolve via first-party seed data, no network.
    const tickers = body.items.map((i) => i.ticker).filter(Boolean);
    expect(tickers).toContain("SBUX");
    expect(tickers).toContain("MCD");

    // Every item carries a raw location for a client-side map fallback.
    for (const item of body.items) {
      expect(typeof item.location.lat).toBe("number");
      expect(typeof item.location.lng).toBe("number");
    }

    expect(body.mapSnapshotUrl).toContain("/v1/widget/map-snapshot");
    expect(typeof body.generatedAt).toBe("string");
  });
});

describe("GET /v1/widget/map-snapshot", () => {
  test("400s without lat/lng", async () => {
    const res = await app.fetch(new Request(url("/v1/widget/map-snapshot")));
    expect(res.status).toBe(400);
  });

  test("501s when GOOGLE_MAPS_API_KEY is not configured", async () => {
    const prevKey = process.env.GOOGLE_MAPS_API_KEY;
    process.env.GOOGLE_MAPS_API_KEY = undefined;
    try {
      const qs = new URLSearchParams({ lat: "37.7749", lng: "-122.4194" });
      const res = await app.fetch(new Request(url(`/v1/widget/map-snapshot?${qs.toString()}`)));
      expect(res.status).toBe(501);
    } finally {
      if (prevKey) process.env.GOOGLE_MAPS_API_KEY = prevKey;
    }
  });
});
