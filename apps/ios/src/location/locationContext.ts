import type { LatLng } from "@/api/types";

/** The map viewport shape shared by MapView and the location-context model. */
export type LocationRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type LocationContextSource = "device" | "map";
export type PermissionDeniedOrigin = "demo" | "map" | "device";

export type PersistedLocation = LatLng & {
  capturedAt?: number;
  source?: LocationContextSource;
};

export type LocationContextState =
  | { kind: "loading"; region: LocationRegion }
  | {
      kind: "permission-denied";
      region: LocationRegion;
      previous: PermissionDeniedOrigin;
    }
  | {
      kind: "unavailable";
      region: LocationRegion;
      previous: PermissionDeniedOrigin;
    }
  | { kind: "fallback"; region: LocationRegion; source: "demo" }
  | {
      kind: "map-area";
      region: LocationRegion;
      source: "map";
      capturedAt?: number;
    }
  | {
      kind: "device-origin";
      region: LocationRegion;
      source: "device";
      capturedAt?: number;
    };

export type LocationContextEvent =
  | { type: "device-fix"; region: LocationRegion; capturedAt?: number }
  | { type: "map-pan"; region: LocationRegion; capturedAt?: number }
  | { type: "permission-denied" }
  | { type: "location-unavailable" };

export const LOCATION_CONTEXT_QUERY_KEY = ["tab-state", "location-context"] as const;
export const MAP_REGION_QUERY_KEY = ["tab-state", "map-region"] as const;

/**
 * A neutral exploration viewport used only while location is loading or
 * unavailable. It must always be paired with explicit demo/explore copy.
 */
export const DEMO_EXPLORE_REGION: LocationRegion = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};

const LOCATION_CONTEXT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function locationRegionFromLatLng(location: LatLng, delta = 0.02): LocationRegion | null {
  if (
    !Number.isFinite(location.lat) ||
    !Number.isFinite(location.lng) ||
    Math.abs(location.lat) > 90 ||
    Math.abs(location.lng) > 180 ||
    (location.lat === 0 && location.lng === 0)
  ) {
    return null;
  }
  return {
    latitude: location.lat,
    longitude: location.lng,
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

export function mapAreaContext(
  region: LocationRegion,
  capturedAt = Date.now(),
): LocationContextState {
  return { kind: "map-area", region, source: "map", capturedAt };
}

export function deviceOriginContext(
  region: LocationRegion,
  capturedAt = Date.now(),
): LocationContextState {
  return { kind: "device-origin", region, source: "device", capturedAt };
}

export function fallbackContext(
  region: LocationRegion = DEMO_EXPLORE_REGION,
): LocationContextState {
  return { kind: "fallback", region, source: "demo" };
}

export function loadingContext(region: LocationRegion = DEMO_EXPLORE_REGION): LocationContextState {
  return { kind: "loading", region };
}

/** Convert the widget's persisted Map/device origin into app context. */
export function contextFromPersistedLocation(
  location: PersistedLocation | null | undefined,
): LocationContextState | null {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  const region = locationRegionFromLatLng(location);
  if (!region || (location.source !== "device" && location.source !== "map")) return null;
  if (location.source === "device") {
    return {
      kind: "device-origin",
      region,
      source: "device",
      ...(typeof location.capturedAt === "number" ? { capturedAt: location.capturedAt } : {}),
    };
  }
  return {
    kind: "map-area",
    region,
    source: "map",
    ...(typeof location.capturedAt === "number" ? { capturedAt: location.capturedAt } : {}),
  };
}

/**
 * Resolve the first useful origin without allowing a legacy/default coordinate
 * to masquerade as the user's current location.
 */
export function resolveInitialLocationContext(input: {
  linkedRegion?: LocationRegion | null;
  cachedContext?: LocationContextState | null;
  cachedRegion?: LocationRegion | null;
  persistedLocation?: PersistedLocation | null;
}): LocationContextState {
  if (input.linkedRegion) return mapAreaContext(input.linkedRegion);
  if (input.cachedContext && input.cachedContext.kind !== "loading") return input.cachedContext;
  if (input.cachedRegion) return mapAreaContext(input.cachedRegion);
  return contextFromPersistedLocation(input.persistedLocation) ?? loadingContext();
}

export function permissionDeniedContext(state: LocationContextState): LocationContextState {
  const previous = previousOrigin(state);
  return { kind: "permission-denied", region: state.region, previous };
}

export function locationUnavailableContext(state: LocationContextState): LocationContextState {
  return { kind: "unavailable", region: state.region, previous: previousOrigin(state) };
}

function previousOrigin(state: LocationContextState): PermissionDeniedOrigin {
  return state.kind === "map-area"
    ? "map"
    : state.kind === "device-origin"
      ? "device"
      : state.kind === "permission-denied" || state.kind === "unavailable"
        ? state.previous
        : "demo";
}

export function transitionLocationContext(
  state: LocationContextState,
  event: LocationContextEvent,
): LocationContextState {
  switch (event.type) {
    case "device-fix":
      return deviceOriginContext(event.region, event.capturedAt);
    case "map-pan":
      return mapAreaContext(event.region, event.capturedAt);
    case "permission-denied":
      return permissionDeniedContext(state);
    case "location-unavailable":
      return locationUnavailableContext(state);
  }
}

/** A user-selected map area captured after a GPS request must win that race. */
export function shouldApplyDeviceFix(
  sharedContext: LocationContextState | null | undefined,
  requestStartedAt: number,
): boolean {
  return !(
    sharedContext?.kind === "map-area" &&
    typeof sharedContext.capturedAt === "number" &&
    sharedContext.capturedAt >= requestStartedAt
  );
}

/** Map providers can round a camera region slightly between callbacks. */
export function sameLocationRegion(
  left: LocationRegion | null | undefined,
  right: LocationRegion | null | undefined,
  epsilon = 0.00001,
): boolean {
  return Boolean(
    left &&
      right &&
      Math.abs(left.latitude - right.latitude) <= epsilon &&
      Math.abs(left.longitude - right.longitude) <= epsilon &&
      Math.abs(left.latitudeDelta - right.latitudeDelta) <= epsilon &&
      Math.abs(left.longitudeDelta - right.longitudeDelta) <= epsilon,
  );
}

export function isRecentDeviceOrigin(state: LocationContextState, now = Date.now()): boolean {
  return (
    state.kind === "device-origin" &&
    typeof state.capturedAt === "number" &&
    Number.isFinite(state.capturedAt) &&
    now - state.capturedAt >= 0 &&
    now - state.capturedAt <= LOCATION_CONTEXT_MAX_AGE_MS
  );
}

export function locationContextLabel(state: LocationContextState, now = Date.now()): string {
  switch (state.kind) {
    case "loading":
      return "Finding your location…";
    case "permission-denied":
      return state.previous === "demo"
        ? "Explore demo area"
        : state.previous === "map"
          ? "Map area"
          : "Last known location";
    case "unavailable":
      return state.previous === "demo" ? "Explore demo area" : "Location unavailable";
    case "fallback":
      return "Explore demo area";
    case "map-area":
      return "Map area";
    case "device-origin":
      return isRecentDeviceOrigin(state, now) ? "Your location" : "Last known location";
  }
}

export function locationContextDescription(state: LocationContextState, now = Date.now()): string {
  switch (state.kind) {
    case "loading":
      return "Checking permission before showing nearby brands.";
    case "permission-denied":
      return state.previous === "demo"
        ? "Location access is off. Demo data is shown until you enable it."
        : state.previous === "map"
          ? "Location access is off. The selected map area remains available."
          : "Location access is off. The last known location remains available.";
    case "unavailable":
      return state.previous === "demo"
        ? "We could not get a fix. Demo data stays available while you try again."
        : "We could not get a fix. The current context stays available while you try again.";
    case "fallback":
      return "Demo data · choose Use my location to center on you.";
    case "map-area":
      return "Showing the area you chose on the map.";
    case "device-origin":
      return isRecentDeviceOrigin(state, now)
        ? "Using your device location."
        : "Last known device location · refresh to recenter.";
  }
}

export function locationContextHeading(
  state: LocationContextState,
  count: number,
  loading = false,
  now = Date.now(),
): string {
  if (loading || state.kind === "loading") return "Finding your location…";
  const base =
    state.kind === "device-origin" && isRecentDeviceOrigin(state, now)
      ? "Nearby"
      : locationContextLabel(state, now);
  return count > 0 ? `${base} · ${count}` : base;
}

export function shouldShowLocationContextNotice(
  state: LocationContextState,
  now = Date.now(),
): boolean {
  return state.kind !== "device-origin" || !isRecentDeviceOrigin(state, now);
}
