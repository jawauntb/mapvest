import type { LatLng } from "@/api/types";

/**
 * A widget must not describe an unknown or old coordinate as "nearby".
 * Widgets refresh on a roughly 30-minute cadence, so six hours is a generous
 * window for a useful neighborhood context while still preventing an
 * indefinitely stale home-screen card from pretending to be live.
 */
export const WIDGET_LOCATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type WidgetLocationSource = "device" | "map";

export type WidgetLocation = LatLng & {
  /** Epoch milliseconds, captured by Core Location or the map screen. */
  capturedAt: number;
  /** `map` means the user chose a map center; it is not a GPS claim. */
  source: WidgetLocationSource;
};

export type WidgetLocationState =
  | { kind: "setup" }
  | { kind: "stale"; capturedAt?: number; source?: WidgetLocationSource }
  | { kind: "fresh"; location: WidgetLocation };

function isValidCoordinate(location: Pick<LatLng, "lat" | "lng">): boolean {
  return (
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng) &&
    Math.abs(location.lat) <= 90 &&
    Math.abs(location.lng) <= 180 &&
    !(location.lat === 0 && location.lng === 0)
  );
}

/** Classify persisted widget origin data without inventing a fallback city. */
export function widgetLocationState(
  location: Partial<WidgetLocation> | null | undefined,
  now = Date.now(),
): WidgetLocationState {
  if (
    !location ||
    typeof location.lat !== "number" ||
    typeof location.lng !== "number" ||
    !isValidCoordinate({ lat: location.lat, lng: location.lng }) ||
    typeof location.capturedAt !== "number" ||
    !Number.isFinite(location.capturedAt) ||
    (location.source !== "device" && location.source !== "map")
  ) {
    return location && typeof location.capturedAt === "number"
      ? { kind: "stale", capturedAt: location.capturedAt, source: location.source }
      : { kind: "setup" };
  }

  const age = now - location.capturedAt;
  if (age < 0 || age > WIDGET_LOCATION_MAX_AGE_MS) {
    return {
      kind: "stale",
      capturedAt: location.capturedAt,
      source: location.source,
    };
  }

  return {
    kind: "fresh",
    location: {
      lat: location.lat,
      lng: location.lng,
      capturedAt: location.capturedAt,
      source: location.source,
    },
  };
}
