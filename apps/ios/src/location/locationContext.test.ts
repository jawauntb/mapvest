import { describe, expect, test } from "bun:test";
import {
  DEMO_EXPLORE_REGION,
  deviceOriginContext,
  fallbackContext,
  isRecentDeviceOrigin,
  locationContextDescription,
  locationContextHeading,
  locationContextLabel,
  locationUnavailableContext,
  mapAreaContext,
  permissionDeniedContext,
  resolveInitialLocationContext,
  sameLocationRegion,
  shouldApplyDeviceFix,
  transitionLocationContext,
} from "./locationContext";

const now = Date.parse("2026-08-25T12:00:00.000Z");
const mapRegion = {
  latitude: 40.7128,
  longitude: -74.006,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

describe("location context precedence", () => {
  test("prefers a linked map origin over active and persisted context", () => {
    const cached = deviceOriginContext(mapRegion, now - 1_000);
    expect(
      resolveInitialLocationContext({
        linkedRegion: mapRegion,
        cachedContext: cached,
        cachedRegion: mapRegion,
        persistedLocation: { lat: 34.05, lng: -118.24, source: "device" },
      }),
    ).toEqual({
      kind: "map-area",
      region: mapRegion,
      source: "map",
      capturedAt: expect.any(Number),
    });
  });

  test("uses active context, then cached map region, then persisted origin", () => {
    const cached = deviceOriginContext(mapRegion, now - 1_000);
    expect(resolveInitialLocationContext({ cachedContext: cached })).toEqual(cached);
    expect(resolveInitialLocationContext({ cachedRegion: mapRegion })).toEqual({
      kind: "map-area",
      region: mapRegion,
      source: "map",
      capturedAt: expect.any(Number),
    });
    expect(
      resolveInitialLocationContext({
        persistedLocation: { lat: 34.05, lng: -118.24, source: "map" },
      }),
    ).toMatchObject({ kind: "map-area", region: expect.objectContaining({ latitude: 34.05 }) });
  });

  test("starts loading around an explicit demo viewport when no origin exists", () => {
    expect(resolveInitialLocationContext({})).toEqual({
      kind: "loading",
      region: DEMO_EXPLORE_REGION,
    });
  });
});

describe("location context labels", () => {
  test("keeps demo, map, device, and denied copy distinct", () => {
    const device = deviceOriginContext(mapRegion, now - 1_000);
    const oldDevice = deviceOriginContext(mapRegion, now - 7 * 60 * 60 * 1000);
    expect(locationContextLabel(fallbackContext(), now)).toBe("Explore demo area");
    expect(locationContextLabel(mapAreaContext(mapRegion, now), now)).toBe("Map area");
    expect(locationContextLabel(device, now)).toBe("Your location");
    expect(locationContextLabel(oldDevice, now)).toBe("Last known location");
    expect(isRecentDeviceOrigin(device, now)).toBe(true);
    expect(isRecentDeviceOrigin(oldDevice, now)).toBe(false);
    expect(locationContextHeading(device, 3, false, now)).toBe("Nearby · 3");
    expect(locationContextHeading(oldDevice, 3, false, now)).toBe("Last known location · 3");
    expect(locationContextLabel(permissionDeniedContext(fallbackContext()), now)).toBe(
      "Explore demo area",
    );
    expect(locationContextDescription(permissionDeniedContext(fallbackContext()), now)).toContain(
      "Demo data",
    );
  });
});

describe("location context transitions", () => {
  test("turns a map gesture into map-area context and a device fix into device-origin context", () => {
    const fallback = fallbackContext();
    const map = transitionLocationContext(fallback, {
      type: "map-pan",
      region: mapRegion,
      capturedAt: now,
    });
    expect(map).toEqual({ kind: "map-area", region: mapRegion, source: "map", capturedAt: now });
    expect(
      transitionLocationContext(map, {
        type: "device-fix",
        region: mapRegion,
        capturedAt: now + 1_000,
      }),
    ).toEqual({
      kind: "device-origin",
      region: mapRegion,
      source: "device",
      capturedAt: now + 1_000,
    });
  });

  test("permission denial preserves the area being shown", () => {
    const map = mapAreaContext(mapRegion, now);
    expect(transitionLocationContext(map, { type: "permission-denied" })).toEqual({
      kind: "permission-denied",
      region: mapRegion,
      previous: "map",
    });
    expect(transitionLocationContext(fallbackContext(), { type: "permission-denied" })).toEqual({
      kind: "permission-denied",
      region: DEMO_EXPLORE_REGION,
      previous: "demo",
    });
  });

  test("keeps a failed fix retryable instead of presenting it as permission denial", () => {
    const unavailable = transitionLocationContext(fallbackContext(), {
      type: "location-unavailable",
    });
    expect(unavailable).toEqual({
      kind: "unavailable",
      region: DEMO_EXPLORE_REGION,
      previous: "demo",
    });
    expect(locationContextLabel(unavailable)).toBe("Explore demo area");
    expect(locationUnavailableContext(mapAreaContext(mapRegion, now))).toEqual({
      kind: "unavailable",
      region: mapRegion,
      previous: "map",
    });
  });

  test("lets a newer map choice win an in-flight device-fix race", () => {
    expect(shouldApplyDeviceFix(mapAreaContext(mapRegion, now + 1), now)).toBe(false);
    expect(shouldApplyDeviceFix(mapAreaContext(mapRegion, now - 1), now)).toBe(true);
    expect(shouldApplyDeviceFix(deviceOriginContext(mapRegion, now + 1), now)).toBe(true);
  });

  test("matches provider-rounded camera regions without hiding real camera changes", () => {
    expect(
      sameLocationRegion(mapRegion, {
        ...mapRegion,
        latitude: mapRegion.latitude + 0.000001,
        longitudeDelta: mapRegion.longitudeDelta - 0.000001,
      }),
    ).toBe(true);
    expect(
      sameLocationRegion(mapRegion, {
        ...mapRegion,
        longitudeDelta: mapRegion.longitudeDelta + 0.001,
      }),
    ).toBe(false);
    expect(sameLocationRegion(mapRegion, null)).toBe(false);
  });
});
