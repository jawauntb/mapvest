/**
 * Visit monitoring — roadmap §2 B5, "Always-permission visit monitoring".
 *
 * Home→work-grade arrival detection at near-zero battery, so the B4 arrival
 * push can fire with the app killed. On iOS, `expo-location`'s background task
 * always pairs `startUpdatingLocation` with
 * `startMonitoringSignificantLocationChanges` (see
 * expo-location/ios/TaskConsumers/EXLocationTaskConsumer.m), which is the
 * CLVisit-class behavior the roadmap asks for: the OS wakes the app only when
 * the user has actually moved somewhere, not on a timer.
 *
 * Product rules encoded here:
 *
 * - **Never nag.** `enableVisitMonitoring()` asks once, per the call site's
 *   choosing, and returns false when either permission is denied. It does not
 *   re-prompt, deep-link to Settings, or show anything. Per the roadmap, this
 *   is only ever offered *after* the user has felt B4's value from the free
 *   widget path (B3) — never at onboarding.
 * - **Cheapest possible fix.** Lowest accuracy (~3km), a 500m distance floor,
 *   batched deferred updates, and `pausesUpdatesAutomatically` so iOS can
 *   power the radios down when the user is sitting still.
 * - **The server does the thinking.** The task's only job is to forward the
 *   fix to the existing heartbeat; scoring, dedupe, and the notification
 *   budget all live server-side (B4).
 *
 * DEFERRED ACCEPTANCE: background location needs `UIBackgroundModes: location`
 * and the Always usage string from app.json, which only take effect after the
 * user's next `expo prebuild` + device build — the same gate as the Phase 9
 * widget work. `expo-task-manager` also isn't a declared dependency yet; until
 * `bunx expo install expo-task-manager` runs, `loadTaskManager()` returns null
 * and every function here is a no-op (Metro treats a `require` inside a
 * try/catch as an optional dependency — `allowOptionalDependencies` is on in
 * Expo's default config — so the bundle still builds). Nothing in Expo Go or
 * the simulator can crash on this path.
 */
import * as Location from "expo-location";
import { Platform } from "react-native";
import { postHeartbeat } from "./heartbeat";

/** Versioned: changing the shape of the task means registering a new name. */
const VISIT_TASK_NAME = "mapvest.visit-monitoring.v1";

/** Minimal shape of `expo-task-manager` this module uses. */
type TaskManagerModule = {
  defineTask: (
    taskName: string,
    executor: (body: { data?: unknown; error?: unknown }) => void,
  ) => void;
};

type LocationTaskData = {
  locations?: Array<{ coords?: { latitude?: number; longitude?: number } }>;
};

function loadTaskManager(): TaskManagerModule | null {
  if (Platform.OS === "web") return null;
  try {
    // Optional by design — see the DEFERRED ACCEPTANCE note above. The
    // try/catch is what marks this dependency optional to Metro; do not
    // hoist it into a static import.
    return require("expo-task-manager") as TaskManagerModule;
  } catch {
    return null;
  }
}

const taskManager = loadTaskManager();

/**
 * Defined at module top level: iOS relaunches the app into the background to
 * deliver a location event, and the task must already be registered by the
 * time the JS bundle finishes evaluating or the event is dropped.
 */
try {
  taskManager?.defineTask(VISIT_TASK_NAME, ({ data, error }) => {
    if (error) return;
    const locations = (data as LocationTaskData | undefined)?.locations;
    if (!locations?.length) return;
    // Deferred updates arrive batched; only the newest fix is interesting.
    const latest = locations[locations.length - 1];
    const lat = latest?.coords?.latitude;
    const lng = latest?.coords?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") return;
    // Fire-and-forget: `postHeartbeat` never throws and the background
    // execution window is too short to be worth blocking on.
    void postHeartbeat({ lat, lng });
  });
} catch {
  /* task already defined (fast refresh) or module half-linked — harmless */
}

/**
 * Requests Always permission and starts background visit monitoring.
 *
 * Foreground first, then background — the order expo-location documents, and
 * the order iOS requires (Always is only offered as an upgrade after
 * When-In-Use is granted). Returns false, silently, on any denial or when the
 * native pieces aren't in the build yet. Never prompts twice, never nags.
 */
export async function enableVisitMonitoring(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (!taskManager) return false;
  try {
    if (await isVisitMonitoringEnabled()) return true;

    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== "granted") return false;

    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== "granted") return false;

    await Location.startLocationUpdatesAsync(VISIT_TASK_NAME, {
      // ~3km — a heartbeat only needs to know which part of town you're in,
      // and the server's move trigger is 2km.
      accuracy: Location.Accuracy.Lowest,
      distanceInterval: 500,
      pausesUpdatesAutomatically: true,
      activityType: Location.ActivityType.Other,
      // Batch: don't wake JS more than once every 15 minutes / 500m.
      deferredUpdatesInterval: 15 * 60 * 1000,
      deferredUpdatesDistance: 500,
      // This is passive background awareness, not a tracked activity — no
      // blue status bar pill.
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        // Android only; iOS ignores it. Honest copy, same promise as the
        // Always usage string in app.json.
        notificationTitle: "Mapvest",
        notificationBody: "Watching for investable brands near you.",
      },
    });
    return true;
  } catch {
    // Missing background mode, unlinked native module, location services off
    // at the OS level — all of them mean "not available", not "crash".
    return false;
  }
}

/** Stops background updates. Safe to call when monitoring was never started. */
export async function disableVisitMonitoring(): Promise<void> {
  if (Platform.OS === "web") return;
  if (!taskManager) return;
  try {
    if (!(await Location.hasStartedLocationUpdatesAsync(VISIT_TASK_NAME))) return;
    await Location.stopLocationUpdatesAsync(VISIT_TASK_NAME);
  } catch {
    /* nothing registered, or native module unavailable */
  }
}

/**
 * Whether background updates are currently registered for this device.
 * Asks the native task registry rather than a local flag, so it stays
 * truthful across reinstalls and permission changes made in Settings.
 */
export async function isVisitMonitoringEnabled(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (!taskManager) return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(VISIT_TASK_NAME);
  } catch {
    return false;
  }
}
