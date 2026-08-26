/**
 * Pure state and enrollment helpers for the Camera Find evolution offer.
 * Native storage, notification permission, and HTTP bindings live in
 * `findEvolutionOptInNative.ts` so this behavior stays directly testable.
 */
import { type DevicePushPrefsDependencies, getStoredDevicePushPrefs } from "./devicePrefs";

export type NotificationSession = { token: string; userId: string; authGeneration: number };

export type FindEvolutionPrefs = {
  notifications_enabled?: boolean;
  find_evolution?: boolean;
};

export const FIND_EVOLUTION_OPT_IN_PREFS = {
  notifications_enabled: true,
  find_evolution: true,
} as const satisfies FindEvolutionPrefs;

const DISMISSAL_KEY_PREFIX = "mapvest.findEvolutionNudge.v1";

export type FindEvolutionNudgeCandidate = {
  userId?: string | null;
  isPublic: boolean;
  ticker?: string | null;
  foundPrice?: number | null;
  dismissed: boolean;
  /** A true or false value means the user already chose this event in Settings. */
  existingFindEvolutionPreference?: boolean;
};

export type FindEvolutionDevicePrefs = {
  prefs: FindEvolutionPrefs;
  tokenId: string | null;
};

export type FindEvolutionDevicePrefsDependencies = DevicePushPrefsDependencies<
  NotificationSession,
  FindEvolutionPrefs
>;

/** A local dismissal belongs to one signed-in account on one device. */
export function findEvolutionNudgeDismissalKey(userId: string): string {
  return `${DISMISSAL_KEY_PREFIX}.${encodeURIComponent(userId.trim())}`;
}

/**
 * Offer only when the identify response has the same ingredients the server
 * needs for an evolution: a signed-in owner, public ticker, and real positive
 * price basis. Private/no-price results never get a misleading offer.
 */
export function shouldOfferFindEvolutionNudge(candidate: FindEvolutionNudgeCandidate): boolean {
  const ticker = candidate.ticker?.trim();
  return Boolean(
    candidate.userId?.trim() &&
      candidate.isPublic &&
      ticker &&
      typeof candidate.foundPrice === "number" &&
      Number.isFinite(candidate.foundPrice) &&
      candidate.foundPrice > 0 &&
      !candidate.dismissed &&
      typeof candidate.existingFindEvolutionPreference !== "boolean",
  );
}

/**
 * Read preferences for this device's stored token only. A missing or stale
 * id is intentionally not retried without an id: that API path selects an
 * arbitrary token from another device on the same account.
 */
export async function getFindEvolutionDevicePrefs(
  session: NotificationSession,
  dependencies: FindEvolutionDevicePrefsDependencies,
): Promise<FindEvolutionDevicePrefs> {
  return (
    (await getStoredDevicePushPrefs(session, dependencies)) ?? {
      prefs: {},
      tokenId: null,
    }
  );
}

export type FindEvolutionOptInResult =
  | { status: "enabled" }
  | { status: "permission-denied" }
  | { status: "permission-unavailable" }
  | { status: "registration-failed" }
  | { status: "persistence-failed" }
  | { status: "cancelled" };

export type FindEvolutionEnrollmentContext = {
  userId: string;
  sessionToken: string;
  authGeneration: number;
  candidate: object;
};

export type FindEvolutionEnrollmentCompletion =
  | "enabled"
  | "hidden"
  | "denied"
  | "error"
  | "ignore";

/**
 * Map an async enrollment result to the currently visible Camera candidate.
 * A completed enrollment belongs to the account/device, not just the captured
 * brand, so a newer candidate for the same account hides rather than offering
 * an already-enabled event again. A different account/session sees no update.
 */
export function resolveFindEvolutionEnrollmentCompletion(
  result: FindEvolutionOptInResult,
  action: FindEvolutionEnrollmentContext,
  current: FindEvolutionEnrollmentContext | null,
): FindEvolutionEnrollmentCompletion {
  if (
    !current ||
    current.userId !== action.userId ||
    current.sessionToken !== action.sessionToken ||
    current.authGeneration !== action.authGeneration
  ) {
    return "ignore";
  }

  if (result.status === "cancelled") return "ignore";

  if (result.status === "enabled") {
    return current.candidate === action.candidate ? "enabled" : "hidden";
  }
  if (current.candidate !== action.candidate) return "ignore";
  return result.status === "permission-denied" ? "denied" : "error";
}

export type FindEvolutionOptInDependencies = {
  requestPermission: () => Promise<boolean>;
  register: (session: NotificationSession) => Promise<{ tokenId: string } | null>;
  persist: (
    tokenId: string,
    prefs: typeof FIND_EVOLUTION_OPT_IN_PREFS,
    session: NotificationSession,
  ) => Promise<FindEvolutionPrefs>;
  /** Reads one exact device record to reconcile a lost POST response. */
  readPrefs: (tokenId: string, session: NotificationSession) => Promise<FindEvolutionPrefs>;
  /** Stops post-permission enrollment after a same-user session transition. */
  isCurrent?: () => boolean;
};

/**
 * Requests permission only after an explicit CTA, registers the device, and
 * confirms the server persisted exactly the two preferences this nudge owns.
 */
export async function enableFindEvolutionOptIn(
  session: NotificationSession,
  dependencies: FindEvolutionOptInDependencies,
): Promise<FindEvolutionOptInResult> {
  const isCurrent = dependencies.isCurrent ?? (() => true);
  if (!isCurrent()) return { status: "cancelled" };
  let granted: boolean;
  try {
    granted = await dependencies.requestPermission();
  } catch {
    return { status: "permission-unavailable" };
  }
  if (!granted) return { status: "permission-denied" };
  if (!isCurrent()) return { status: "cancelled" };

  let registration: { tokenId: string } | null;
  try {
    registration = await dependencies.register(session);
  } catch {
    return { status: "registration-failed" };
  }
  if (!registration) return { status: "registration-failed" };
  if (!isCurrent()) return { status: "cancelled" };

  let saved: FindEvolutionPrefs;
  let reconciled = false;
  try {
    saved = await dependencies.persist(registration.tokenId, FIND_EVOLUTION_OPT_IN_PREFS, session);
  } catch {
    // The server can commit the merge then lose the response. Re-read only
    // this device's opaque token id rather than selecting another device.
    try {
      saved = await dependencies.readPrefs(registration.tokenId, session);
      reconciled = true;
    } catch {
      return { status: "persistence-failed" };
    }
  }
  if (!isCurrent()) return { status: "cancelled" };
  if (!reconciled) {
    try {
      // The GET is also the authoritative confirmation when POST replied but a
      // proxy/body parser lost part of the response.
      saved = await dependencies.readPrefs(registration.tokenId, session);
    } catch {
      return { status: "persistence-failed" };
    }
  }
  if (!isCurrent()) return { status: "cancelled" };
  if (saved.notifications_enabled !== true || saved.find_evolution !== true) {
    return { status: "persistence-failed" };
  }
  return { status: "enabled" };
}

/**
 * Gives a UI instance one in-flight enrollment promise. The Camera also
 * disables its CTA, but this closes the render-before-disable double-tap gap.
 */
export function serializeFindEvolutionOptIn(
  session: NotificationSession,
  dependencies: FindEvolutionOptInDependencies,
): () => Promise<FindEvolutionOptInResult> {
  let inFlight: Promise<FindEvolutionOptInResult> | null = null;

  return () => {
    if (inFlight) return inFlight;
    const run = enableFindEvolutionOptIn(session, dependencies);
    inFlight = run;
    void run.finally(() => {
      if (inFlight === run) inFlight = null;
    });
    return run;
  };
}
