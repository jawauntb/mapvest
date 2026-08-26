import { redirectMapvestWebPath } from "@/util/shareLinks";

/**
 * Rewrites system-delivered URLs before Expo Router routes them.
 *
 * Two cases:
 * 1. Share-extension handoff — expo-share-intent opens
 *    `mapvest://dataUrl=<key>#media`. Route it straight to the share-intent
 *    screen; without this the router tries to match the raw URL, lands on the
 *    Unmatched screen, and then fights ShareIntentListener's own push.
 * 2. Recipient-facing web links — keep them aligned with the native detail
 *    route via redirectMapvestWebPath.
 *
 * Never throw from here: a bad URL must degrade to home, not take down the
 * launch sequence.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes("dataUrl=")) return "/share-intent";
    return redirectMapvestWebPath(path);
  } catch {
    return "/";
  }
}
