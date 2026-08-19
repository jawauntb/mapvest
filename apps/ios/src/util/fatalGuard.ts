import { DeviceEventEmitter } from "react-native";

/**
 * Last line of defense against hard crashes. In release builds React Native's
 * default global handler forwards every uncaught ("fatal") JS error to the
 * native ExceptionsManager, which raises RCTFatalException and abort()s the
 * process — that is exactly the SIGABRT-on-ExceptionsManagerQueue signature
 * TestFlight builds 64–86 kept dying with on the Investable screen.
 *
 * Error boundaries cannot catch errors thrown outside React's render phase
 * (event handlers, timers, emitter callbacks, Reanimated worklets rethrown on
 * the JS thread), so this guard replaces the release-mode handler: log the
 * error, remember it, and hand it to the UI to show a recovery screen instead
 * of killing the app. Dev builds keep the default RedBox behavior.
 */

export const FATAL_JS_EVENT = "mapvest:fatal-js-error";

export type FatalReport = { message: string; stack: string; at: string };

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

type RNGlobal = typeof globalThis & {
  ErrorUtils?: {
    getGlobalHandler(): GlobalHandler;
    setGlobalHandler(handler: GlobalHandler): void;
  };
};

let installed = false;
let pendingFatal: FatalReport | null = null;

/** Fatal captured before the root layout mounted (listener not yet attached). */
export function getPendingFatal(): FatalReport | null {
  return pendingFatal;
}

export function clearPendingFatal(): void {
  pendingFatal = null;
}

export function installFatalGuard(): void {
  if (installed) return;
  const errorUtils = (globalThis as RNGlobal).ErrorUtils;
  if (!errorUtils) return;
  installed = true;

  const defaultHandler = errorUtils.getGlobalHandler();

  errorUtils.setGlobalHandler((error, isFatal) => {
    if (__DEV__) {
      defaultHandler(error, isFatal);
      return;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    console.error(
      `[fatal-guard] ${isFatal ? "fatal" : "non-fatal"} JS error:`,
      err.message,
      err.stack ?? "(no stack)",
    );

    if (!isFatal) {
      // Non-fatal errors only log in release; keep the default behavior.
      try {
        defaultHandler(error, isFatal);
      } catch {
        /* never let the handler itself throw */
      }
      return;
    }

    const report: FatalReport = {
      message: err.message || "Unknown error",
      stack: err.stack ?? "",
      at: new Date().toISOString(),
    };
    pendingFatal = report;
    // Swallow the abort: notify the UI so it can show the recovery screen.
    DeviceEventEmitter.emit(FATAL_JS_EVENT, report);
  });
}
