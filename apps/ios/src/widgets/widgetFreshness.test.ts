import { describe, expect, test } from "bun:test";
import { WIDGET_LOCATION_MAX_AGE_MS, widgetLocationState } from "./widgetFreshness";

const now = Date.parse("2026-08-25T12:00:00.000Z");

describe("widgetLocationState", () => {
  test("requires a captured location instead of inventing San Francisco", () => {
    expect(widgetLocationState(null, now)).toEqual({ kind: "setup" });
    expect(widgetLocationState({ lat: 37.7749, lng: -122.4194 }, now)).toEqual({ kind: "setup" });
  });

  test("accepts a recent device fix", () => {
    expect(
      widgetLocationState(
        {
          lat: 40.7128,
          lng: -74.006,
          capturedAt: now - 60_000,
          source: "device",
        },
        now,
      ),
    ).toEqual({
      kind: "fresh",
      location: {
        lat: 40.7128,
        lng: -74.006,
        capturedAt: now - 60_000,
        source: "device",
      },
    });
  });

  test("rejects stale, future, invalid, and legacy coordinates", () => {
    expect(
      widgetLocationState(
        {
          lat: 40.7128,
          lng: -74.006,
          capturedAt: now - WIDGET_LOCATION_MAX_AGE_MS - 1,
          source: "map",
        },
        now,
      ),
    ).toEqual({
      kind: "stale",
      capturedAt: now - WIDGET_LOCATION_MAX_AGE_MS - 1,
      source: "map",
    });
    expect(
      widgetLocationState(
        { lat: 40.7128, lng: -74.006, capturedAt: now + 1, source: "device" },
        now,
      ).kind,
    ).toBe("stale");
    expect(
      widgetLocationState({ lat: 91, lng: -74.006, capturedAt: now, source: "device" }, now).kind,
    ).toBe("stale");
    expect(widgetLocationState({ lat: 40.7128, lng: -74.006 }, now)).toEqual({ kind: "setup" });
  });
});
