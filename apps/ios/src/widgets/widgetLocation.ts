import type { LatLng } from "@/api/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

/**
 * Home-screen widgets can't get a fresh GPS fix themselves (no foreground
 * permission prompt, and iOS WidgetKit extensions run as a separate native
 * process with no access to the RN bridge at all). Instead, whenever the
 * main app gets a location fix — Map tab, List tab — it stashes it here so
 * a widget's next timeline refresh has *something* recent to center on.
 *
 * - Android: the widget's headless task handler (`widget-task-handler.tsx`)
 *   runs in the same JS engine, so it just reads this back via AsyncStorage.
 * - iOS: the WidgetKit extension is pure Swift with zero JS access, so we
 *   also mirror the value into the shared App Group container via
 *   `@bacons/apple-targets`' `ExtensionStorage` — see targets/widget/ for
 *   the Swift side that reads it back.
 *
 * Everything here is best-effort: a widget that never sees a location falls
 * back to San Francisco, same as the Map tab's `FALLBACK_REGION`.
 */

const ASYNC_STORAGE_KEY = "mapvest.widget.lastLocation.v1";
const IOS_APP_GROUP = "group.com.mapvest.app.widget";
const IOS_LOCATION_KEY = "lastLocation";

/** Minimal shape of `@bacons/apple-targets`' `ExtensionStorage` we use. */
interface IosExtensionStorage {
  set(key: string, value: Record<string, string | number>): void;
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

export async function saveLastLocationForWidgets(loc: LatLng): Promise<void> {
  try {
    await AsyncStorage.setItem(ASYNC_STORAGE_KEY, JSON.stringify(loc));
  } catch {
    /* best-effort — Android widget just falls back to SF next refresh */
  }
  try {
    const storage = getIosStorage();
    if (!storage) return;
    storage.set(IOS_LOCATION_KEY, { lat: loc.lat, lng: loc.lng });
    // Reload both widget kinds (Nearby list + Nearby map) — cheap, and
    // simpler than tracking which kinds are actually on a home screen.
    (require("@bacons/apple-targets") as ExtensionStorageModule).ExtensionStorage.reloadWidget();
  } catch {
    /* extension module not linked yet — no-op until next native build */
  }
}

export async function readLastLocationForWidgets(): Promise<LatLng | null> {
  try {
    const raw = await AsyncStorage.getItem(ASYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LatLng;
    if (typeof parsed?.lat === "number" && typeof parsed?.lng === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}
