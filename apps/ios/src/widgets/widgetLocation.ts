import type { LatLng } from "@/api/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  type WidgetLocation,
  type WidgetLocationSource,
  widgetLocationState,
} from "./widgetFreshness";

/**
 * Home-screen widgets can't get a fresh GPS fix themselves (no foreground
 * permission prompt, and iOS WidgetKit extensions run as a separate native
 * process with no access to the RN bridge at all). Instead, whenever the
 * main app gets a location fix on the Map or List tab, it stashes it here so
 * a widget's next timeline refresh has *something* recent to center on.
 *
 * - Android: the widget's headless task handler (`widget-task-handler.tsx`)
 *   runs in the same JS engine, so it just reads this back via AsyncStorage.
 * - iOS: the WidgetKit extension is pure Swift with zero JS access, so we
 *   also mirror the value into the shared App Group container via
 *   `@bacons/apple-targets`' `ExtensionStorage` — see targets/widget/ for
 *   the Swift side that reads it back.
 *
 * Every persisted origin includes a capture time and source. A widget that
 * never sees a location must show setup copy instead of inventing a city.
 */

const ASYNC_STORAGE_KEY = "mapvest.widget.lastLocation.v1";
const IOS_APP_GROUP = "group.com.mapvest.app.widget";
const IOS_LOCATION_KEY = "lastLocation";
/**
 * Written by the *widget* (not the app) when a timeline refresh captures a
 * Core Location fix — roadmap §2 B3. Must match `widgetFixKey` in
 * targets/widget/WidgetLocationHeartbeat.swift.
 */
const IOS_WIDGET_FIX_KEY = "widgetLocationFix";

/** Minimal shape of `@bacons/apple-targets`' `ExtensionStorage` we use. */
interface IosExtensionStorage {
  set(key: string, value: Record<string, string | number>): void;
  get(key: string): string | null;
}
type ExtensionStorageModule = {
  ExtensionStorage: new (appGroup: string) => IosExtensionStorage;
} & { ExtensionStorage: { reloadWidget: (name?: string) => void } };

let iosExtensionStorage: IosExtensionStorage | null = null;

function loadExtensionStorageModule(): ExtensionStorageModule["ExtensionStorage"] | null {
  if (Platform.OS !== "ios") return null;
  try {
    // Lazy + try/catch: on a JS bundle built before `expo prebuild` links
    // the native module, importing/constructing this would throw. Widgets
    // are inert until then anyway, so silently skipping is correct.
    return (require("@bacons/apple-targets") as ExtensionStorageModule).ExtensionStorage;
  } catch {
    return null;
  }
}

function getIosStorage(): IosExtensionStorage | null {
  if (iosExtensionStorage) return iosExtensionStorage;
  const ExtensionStorage = loadExtensionStorageModule();
  if (!ExtensionStorage) return null;
  iosExtensionStorage = new ExtensionStorage(IOS_APP_GROUP);
  return iosExtensionStorage;
}

export type StoredWidgetLocation = Omit<WidgetLocation, "capturedAt" | "source"> &
  Partial<Pick<WidgetLocation, "capturedAt" | "source">>;

export async function saveLastLocationForWidgets(
  loc: LatLng,
  options: { capturedAt?: number; source: WidgetLocationSource },
): Promise<void> {
  const value: WidgetLocation = {
    lat: loc.lat,
    lng: loc.lng,
    capturedAt: options.capturedAt ?? Date.now(),
    source: options.source,
  };
  try {
    await AsyncStorage.setItem(ASYNC_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* best-effort — the Android widget shows setup/stale state on failure */
  }
  try {
    const storage = getIosStorage();
    if (!storage) return;
    storage.set(IOS_LOCATION_KEY, value);
    // Reload both widget kinds (Nearby list + Nearby map) — cheap, and
    // simpler than tracking which kinds are actually on a home screen.
    (require("@bacons/apple-targets") as ExtensionStorageModule).ExtensionStorage.reloadWidget();
  } catch {
    /* extension module not linked yet — no-op until next native build */
  }
}

/** A location fix the *widget extension* captured, with its capture time. */
export type WidgetCapturedFix = LatLng & {
  /** Epoch ms, directly comparable to `Date.now()`. */
  capturedAt: number;
};

/**
 * Reads the last fix the WidgetKit extension captured on a timeline refresh
 * (roadmap §2 B3). The widget can't POST it itself — no session token, tiny
 * execution budget — so the app relays it on foreground via
 * `syncWidgetFixIfFresh()` in src/location/heartbeat.ts.
 *
 * Returns null on Android, in Expo Go, in a simulator, and on any build made
 * before `expo prebuild` links the extension — i.e. everywhere the widget
 * hasn't actually run. Never throws.
 */
export async function readWidgetCapturedFix(): Promise<WidgetCapturedFix | null> {
  if (Platform.OS !== "ios") return null;
  try {
    const storage = getIosStorage();
    if (!storage) return null;
    // `ExtensionStorage.get` re-serializes the App Group's stored JSON Data
    // back into a string — see the native module's `get` in
    // @bacons/apple-targets/ios/ExtensionStorageModule.swift.
    const raw = storage.get(IOS_WIDGET_FIX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WidgetCapturedFix>;
    if (
      typeof parsed?.lat !== "number" ||
      typeof parsed?.lng !== "number" ||
      typeof parsed?.capturedAt !== "number" ||
      !Number.isFinite(parsed.lat) ||
      !Number.isFinite(parsed.lng) ||
      !Number.isFinite(parsed.capturedAt)
    ) {
      return null;
    }
    return { lat: parsed.lat, lng: parsed.lng, capturedAt: parsed.capturedAt };
  } catch {
    /* extension module not linked yet, or malformed payload */
    return null;
  }
}

export async function readLastLocationForWidgets(): Promise<StoredWidgetLocation | null> {
  try {
    const raw = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredWidgetLocation>;
    if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") {
      return parsed as StoredWidgetLocation;
    }
    return null;
  } catch {
    return null;
  }
}
