import type { LatLng } from "@/api/types";
import { API_URL } from "@/util/env";
import { readLastLocationForWidgets } from "./widgetLocation";

/** Mirrors `WidgetNearbyResponse` in packages/core — kept local so the widget
 * task handler doesn't pull in the full `@mapvest/core` zod dependency tree
 * for a couple of fields. */
export type WidgetNearbyItem = {
  name: string;
  ticker?: string;
  isPublic?: boolean;
  sector?: string;
  distanceM?: number;
  price?: number;
  changePct?: number;
  location: LatLng;
};

export type WidgetData = {
  items: WidgetNearbyItem[];
  generatedAt: string;
  error?: string;
};

/** Same default as the Map tab's `FALLBACK_REGION` — San Francisco. */
const FALLBACK_ORIGIN: LatLng = { lat: 37.7749, lng: -122.4194 };

const FETCH_TIMEOUT_MS = 8000;
const WIDGET_LIMIT = 8;
const WIDGET_RADIUS = 1500;

/**
 * Fetches `/v1/widget/nearby` for the Android home-screen widget's headless
 * task handler. Never throws — a failed lookup just renders an error row in
 * the widget rather than crashing the launcher's remote view.
 */
export async function fetchWidgetNearby(): Promise<WidgetData> {
  const origin = (await readLastLocationForWidgets()) ?? FALLBACK_ORIGIN;
  const qs = new URLSearchParams({
    lat: String(origin.lat),
    lng: String(origin.lng),
    radius: String(WIDGET_RADIUS),
    limit: String(WIDGET_LIMIT),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/v1/widget/nearby?${qs.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      return { items: [], generatedAt: new Date().toISOString(), error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { items: WidgetNearbyItem[]; generatedAt: string };
    return { items: body.items ?? [], generatedAt: body.generatedAt };
  } catch (e) {
    return {
      items: [],
      generatedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : "network error",
    };
  } finally {
    clearTimeout(timer);
  }
}
