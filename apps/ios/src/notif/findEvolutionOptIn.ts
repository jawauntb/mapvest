/**
 * Pure state and enrollment helpers for the Camera Find evolution offer.
 * Native storage, notification permission, and HTTP bindings live in
 * `findEvolutionOptInNative.ts` so this behavior stays directly testable.
 */

export type NotificationSession = { token: string };

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

export type FindEvolutionDevicePrefsDependencies = {
  readStoredTokenId: () => Promise<string | null>;
  readPushPrefs: (
    session: NotificationSession,
    tokenId?: string | null,
  ) => Promise<FindEvolutionDevicePrefs>;
};

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
 * Read preferences for this device's stored token, never an arbitrary token
 * from the user's other devices. A stale stored id is retried once without an
 * id so a reinstalled/rotated device can recover its current server record.
 */
export async function getFindEvolutionDevicePrefs(
  session: NotificationSession,
  dependencies: FindEvolutionDevicePrefsDependencies,
): Promise<FindEvolutionDevicePrefs> {
  const storedTokenId = await dependencies.readStoredTokenId();
  let remote = await dependencies.readPushPrefs(session, storedTokenId);
  if (storedTokenId && remote.tokenId === null) {
    remote = await dependencies.readPushPrefs(session);
  }
  return remote;
}

export type FindEvolutionOptInResult =
  | { status: "enabled" }
  | { status: "permission-denied" }
  | { status: "permission-unavailable" }
  | { status: "registration-failed" }
  | { status: "persistence-failed" };

export type FindEvolutionEnrollmentContext = {
  userId: string;
  sessionToken: string;
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
    current.sessionToken !== action.sessionToken
  ) {
    return "ignore";
  }

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
};

/**
 * Requests permission only after an explicit CTA, registers the device, and
 * confirms the server persisted exactly the two preferences this nudge owns.
 */
export async function enableFindEvolutionOptIn(
  session: NotificationSession,
  dependencies: FindEvolutionOptInDependencies,
): Promise<FindEvolutionOptInResult> {
  let granted: boolean;
  try {
    granted = await dependencies.requestPermission();
  } catch {
    return { status: "permission-unavailable" };
  }
  if (!granted) return { status: "permission-denied" };

  let registration: { tokenId: string } | null;
  try {
    registration = await dependencies.register(session);
  } catch {
    return { status: "registration-failed" };
  }
  if (!registration) return { status: "registration-failed" };

  try {
    const saved = await dependencies.persist(
      registration.tokenId,
      FIND_EVOLUTION_OPT_IN_PREFS,
      session,
    );
    if (saved.notifications_enabled !== true || saved.find_evolution !== true) {
      return { status: "persistence-failed" };
    }
    return { status: "enabled" };
  } catch {
    return { status: "persistence-failed" };
  }
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
