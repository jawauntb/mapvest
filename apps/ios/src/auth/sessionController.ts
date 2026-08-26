import type { Session, User } from "@/api/types";
import { sessionExpired } from "./sessionPolicy";

export type StoredSession = { session: Session; user: User };

/**
 * The minimum physical claimant proof needed to replay push cleanup after a
 * force-quit.  The Expo token is not a secret; the bearer remains in the
 * SecureStore session envelope and is never copied into this value.
 */
export type CleanupPushSnapshot = {
  expoToken: string;
  deviceId?: string;
  tokenId?: string;
  ownerUserId?: string;
  /** Conservative evidence that a server row may exist. */
  mayExist?: boolean;
};

export type CleanupTombstone = {
  version: 1;
  kind: "cleanup";
  reason: CleanupReason;
  ownerUserId?: string;
  session?: Session;
  user?: User;
  push?: CleanupPushSnapshot;
  authenticatedBearer: boolean;
  recoverySession: boolean;
};

export type StoredSessionEnvelope = StoredSession & { cleanup?: CleanupTombstone };

export type StoredSessionRead = {
  raw: string | null;
  timedOut: boolean;
  /** False means SecureStore failed, so null cannot be trusted as "guest". */
  readable: boolean;
};

export type CleanupReason =
  | "secure-store-unreadable"
  | "malformed-session"
  | "expired-session"
  | "invalid-session"
  | "push-revocation-failed"
  | "sign-out"
  | "session-store-write-failed"
  | "session-store-delete-failed";

export type SessionPhase = "booting" | "authenticated" | "guest" | "cleanup-required";

export type SessionSnapshot = {
  phase: SessionPhase;
  ready: boolean;
  session: Session | null;
  user: User | null;
  cleanupRequired: boolean;
  cleanupReason: CleanupReason | null;
  /** Changes synchronously when an auth transition begins. */
  authGeneration: number;
};

export type SessionControllerDeps = {
  readStoredSession: () => Promise<StoredSessionRead>;
  getMe: (token: string, signal: AbortSignal) => Promise<{ user: User }>;
  revokePush: (
    session?: Session,
    options?: {
      authenticatedBearer: boolean;
      recoverySession?: boolean;
      ownerUserId?: string;
      pushSnapshot?: CleanupPushSnapshot;
    },
  ) => Promise<void>;
  cancelPush: () => Promise<void>;
  writeStoredSession: (stored: StoredSession) => Promise<void>;
  deleteStoredSession: () => Promise<void>;
  /** Durable same-key journal. Cleanup must be written before revocation. */
  writeCleanupTombstone?: (tombstone: CleanupTombstone) => Promise<void>;
  /** Optional explicit verification hook after the session envelope is gone. */
  clearCleanupTombstone?: () => Promise<void>;
  /** Read the persisted push identity without consulting OS permission state. */
  readPushCleanupSnapshot?: () => Promise<{
    snapshot: CleanupPushSnapshot | null;
    readable: boolean;
  }>;
};

export type CleanupRequest = {
  reason: CleanupReason;
  session?: Session;
  user?: User;
  ownerUserId?: string;
  pushSnapshot?: CleanupPushSnapshot;
  revocationComplete: boolean;
  authenticatedBearer: boolean;
  recoverySession?: boolean;
};

export class SessionTransitionCancelledError extends Error {
  constructor() {
    super("The session changed before this operation completed.");
    this.name = "SessionTransitionCancelledError";
  }
}

export class SessionCleanupRequiredError extends Error {
  constructor() {
    super("Mapvest must finish device cleanup before another account can sign in.");
    this.name = "SessionCleanupRequiredError";
  }
}

export class SessionPersistenceError extends Error {
  constructor(operation: "write" | "delete") {
    super(
      operation === "write"
        ? "Mapvest could not verify this sign-in on the device. Please retry."
        : "Mapvest could not finish sign-out on the device. Please retry.",
    );
    this.name = "SessionPersistenceError";
  }
}

function initialSnapshot(): SessionSnapshot {
  return {
    phase: "booting",
    ready: false,
    session: null,
    user: null,
    cleanupRequired: false,
    cleanupReason: null,
    authGeneration: 0,
  };
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredSession>;
  return Boolean(
    candidate.session &&
      typeof candidate.session.token === "string" &&
      candidate.session.token.length > 0 &&
      typeof candidate.session.userId === "string" &&
      typeof candidate.session.expiresAt === "string" &&
      candidate.user &&
      typeof candidate.user.id === "string" &&
      candidate.user.id.length > 0,
  );
}

function isCleanupTombstone(value: unknown): value is CleanupTombstone {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CleanupTombstone>;
  const knownReasons: CleanupReason[] = [
    "secure-store-unreadable",
    "malformed-session",
    "expired-session",
    "invalid-session",
    "push-revocation-failed",
    "sign-out",
    "session-store-write-failed",
    "session-store-delete-failed",
  ];
  if (
    candidate.kind !== "cleanup" ||
    candidate.version !== 1 ||
    typeof candidate.reason !== "string" ||
    !knownReasons.includes(candidate.reason as CleanupReason) ||
    typeof candidate.authenticatedBearer !== "boolean" ||
    typeof candidate.recoverySession !== "boolean"
  ) {
    return false;
  }
  if (candidate.session && !isStoredSession({ session: candidate.session, user: candidate.user })) {
    return false;
  }
  if (candidate.push) {
    if (
      typeof candidate.push !== "object" ||
      typeof candidate.push.expoToken !== "string" ||
      (candidate.push.deviceId !== undefined && typeof candidate.push.deviceId !== "string") ||
      (candidate.push.tokenId !== undefined && typeof candidate.push.tokenId !== "string") ||
      (candidate.push.ownerUserId !== undefined &&
        typeof candidate.push.ownerUserId !== "string") ||
      (candidate.push.mayExist !== undefined && typeof candidate.push.mayExist !== "boolean")
    ) {
      return false;
    }
  }
  return true;
}

function cleanupRequestToTombstone(request: CleanupRequest): CleanupTombstone {
  return {
    version: 1,
    kind: "cleanup",
    reason: request.reason,
    ...(request.ownerUserId ? { ownerUserId: request.ownerUserId } : {}),
    ...(request.session ? { session: request.session } : {}),
    ...(request.user ? { user: request.user } : {}),
    ...(request.pushSnapshot ? { push: request.pushSnapshot } : {}),
    authenticatedBearer: request.authenticatedBearer,
    recoverySession: request.recoverySession ?? false,
  };
}

function tombstoneToCleanupRequest(tombstone: CleanupTombstone): CleanupRequest {
  return {
    reason: tombstone.reason,
    ...(tombstone.session ? { session: tombstone.session } : {}),
    ...(tombstone.user ? { user: tombstone.user } : {}),
    ...(tombstone.ownerUserId ? { ownerUserId: tombstone.ownerUserId } : {}),
    ...(tombstone.push ? { pushSnapshot: tombstone.push } : {}),
    revocationComplete: false,
    authenticatedBearer: tombstone.authenticatedBearer,
    recoverySession: tombstone.recoverySession,
  };
}

/**
 * Async auth state machine used by SessionProvider. It deliberately owns the
 * generation and transition queue so a delayed boot request cannot mutate a
 * newer account or delete its SecureStore record.
 */
export class SessionController {
  private readonly deps: SessionControllerDeps;
  private readonly onChange: (snapshot: SessionSnapshot) => void;
  private snapshot = initialSnapshot();
  private currentStored: StoredSession | null = null;
  private cleanup: CleanupRequest | null = null;
  private generation = 0;
  private bootAbort: AbortController | null = null;
  private bootPromise: Promise<void> | null = null;
  private transitionQueue: Promise<void> = Promise.resolve();
  private disposed = false;
  private transitionPending = false;

  constructor(deps: SessionControllerDeps, onChange: (snapshot: SessionSnapshot) => void) {
    this.deps = deps;
    this.onChange = onChange;
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  /** Imperative guard for native callbacks that can fire before React rerenders. */
  isAuthGenerationCurrent(generation: number): boolean {
    return this.isCurrent(generation);
  }

  isActiveSession(generation: number, token: string): boolean {
    return (
      this.isCurrent(generation) &&
      this.snapshot.phase === "authenticated" &&
      this.snapshot.session?.token === token
    );
  }

  startBoot(): Promise<void> {
    if (!this.bootPromise) this.bootPromise = this.boot();
    return this.bootPromise;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.bootAbort?.abort();
    this.bootAbort = null;
  }

  async retryCleanup(): Promise<void> {
    const generation = this.beginTransition();
    return this.enqueue(() => this.retryCleanupNow(generation));
  }

  async signIn(session: Session, user: User): Promise<void> {
    const generation = this.beginTransition();
    return this.enqueue(() => this.signInNow(generation, session, user));
  }

  async signOut(): Promise<void> {
    const generation = this.beginTransition();
    return this.enqueue(() => this.signOutNow(generation));
  }

  private emit(next: SessionSnapshot): void {
    if (this.disposed) return;
    this.snapshot = next;
    this.onChange(next);
  }

  private beginTransition(): number {
    this.generation += 1;
    this.transitionPending = true;
    this.bootAbort?.abort();
    // Clear the old account synchronously. React may not have committed the
    // next render yet, so imperative consumers also receive a non-active
    // generation immediately and the provider can unmount account UI.
    this.emit({
      ...this.snapshot,
      phase: "booting",
      ready: false,
      session: null,
      user: null,
      cleanupRequired: false,
      cleanupReason: null,
      authGeneration: this.generation,
    });
    return this.generation;
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.transitionQueue.then(operation, operation);
    this.transitionQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async boot(): Promise<void> {
    const generation = this.generation;
    const suppressAuthCommit = this.transitionPending;
    this.transitionPending = false;
    const controller = new AbortController();
    this.bootAbort = controller;
    let loaded: StoredSessionRead;
    try {
      loaded = await this.deps.readStoredSession();
    } catch {
      loaded = { raw: null, timedOut: false, readable: false };
    }
    if (!this.isCurrent(generation)) return;

    if (!loaded.readable || loaded.timedOut) {
      await this.enterCleanup(
        {
          reason: "secure-store-unreadable",
          revocationComplete: false,
          authenticatedBearer: false,
          recoverySession: false,
        },
        generation,
      );
      return;
    }
    if (!loaded.raw) {
      this.currentStored = null;
      if (suppressAuthCommit) return;
      this.emit({
        ...this.snapshot,
        phase: "guest",
        ready: true,
        session: null,
        user: null,
        cleanupRequired: false,
        cleanupReason: null,
      });
      return;
    }

    let parsed: StoredSession;
    try {
      const value: unknown = JSON.parse(loaded.raw);
      if (
        value &&
        typeof value === "object" &&
        "cleanup" in value &&
        (value as { cleanup?: unknown }).cleanup !== undefined
      ) {
        const tombstone = (value as { cleanup?: unknown }).cleanup;
        if (!isCleanupTombstone(tombstone)) throw new Error("invalid cleanup journal");
        await this.enterCleanup(tombstoneToCleanupRequest(tombstone), generation);
        return;
      }
      // Accept the tagged-root form as well so a future/native migration can
      // replay a cleanup envelope written by an intermediate build.
      if (isCleanupTombstone(value)) {
        await this.enterCleanup(tombstoneToCleanupRequest(value), generation);
        return;
      }
      if (!isStoredSession(value)) throw new Error("invalid stored session");
      parsed = value;
    } catch {
      await this.enterCleanup(
        {
          reason: "malformed-session",
          revocationComplete: false,
          authenticatedBearer: false,
          recoverySession: false,
        },
        generation,
      );
      return;
    }

    if (sessionExpired(parsed.session.expiresAt)) {
      await this.enterCleanup(
        {
          reason: "expired-session",
          session: parsed.session,
          user: parsed.user,
          ownerUserId: parsed.user.id,
          revocationComplete: false,
          authenticatedBearer: false,
          recoverySession: true,
        },
        generation,
      );
      return;
    }

    if (suppressAuthCommit) {
      this.currentStored = parsed;
      return;
    }

    this.currentStored = parsed;
    this.emit({
      ...this.snapshot,
      phase: "authenticated",
      ready: true,
      session: parsed.session,
      user: parsed.user,
      cleanupRequired: false,
      cleanupReason: null,
    });

    try {
      const { user } = await this.deps.getMe(parsed.session.token, controller.signal);
      if (!this.isCurrent(generation)) return;
      if (user.id !== parsed.user.id || user.id !== parsed.session.userId) {
        await this.enterCleanup(
          {
            reason: "invalid-session",
            session: parsed.session,
            user: parsed.user,
            ownerUserId: parsed.user.id,
            revocationComplete: false,
            authenticatedBearer: false,
            recoverySession: true,
          },
          generation,
        );
        return;
      }
      this.currentStored = { session: parsed.session, user };
      this.emit({ ...this.snapshot, session: parsed.session, user });
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      if (errorStatus(error) === 401) {
        await this.enterCleanup(
          {
            reason: "invalid-session",
            session: parsed.session,
            user: parsed.user,
            ownerUserId: parsed.user.id,
            revocationComplete: false,
            authenticatedBearer: false,
            recoverySession: true,
          },
          generation,
        );
      }
      // Network/5xx errors leave the cached authenticated session visible.
    } finally {
      if (this.bootAbort === controller) this.bootAbort = null;
    }
  }

  private async enterCleanup(request: CleanupRequest, generation: number): Promise<boolean> {
    if (!this.isCurrent(generation)) return false;
    this.cleanup = request;
    this.currentStored = null;
    await this.attachPushSnapshot(request);
    if (!this.isCurrent(generation)) return false;
    if (this.deps.writeCleanupTombstone) {
      try {
        await this.deps.writeCleanupTombstone(cleanupRequestToTombstone(request));
      } catch {
        // Keep the in-memory blocker, but do not perform any destructive
        // server/native operation until the replay journal is durable.
        this.emit({
          ...this.snapshot,
          phase: "cleanup-required",
          ready: true,
          session: null,
          user: null,
          cleanupRequired: true,
          cleanupReason: request.reason,
        });
        return false;
      }
    }
    this.emit({
      ...this.snapshot,
      phase: "cleanup-required",
      ready: true,
      session: null,
      user: null,
      cleanupRequired: true,
      cleanupReason: request.reason,
    });
    return this.attemptCleanup(generation);
  }

  private async attachPushSnapshot(request: CleanupRequest): Promise<void> {
    if (request.pushSnapshot || !this.deps.readPushCleanupSnapshot) return;
    try {
      const result = await this.deps.readPushCleanupSnapshot();
      if (result.readable && result.snapshot) {
        request.pushSnapshot = result.snapshot;
        // A guest-to-B transition must not let B's bearer stand in for a
        // persisted claimant owned by A. Preserve the durable owner as the
        // authority for route selection.
        if (result.snapshot.ownerUserId) {
          const incomingOwner = request.session?.userId;
          request.ownerUserId = result.snapshot.ownerUserId;
          if (
            incomingOwner &&
            incomingOwner !== result.snapshot.ownerUserId &&
            !result.snapshot.tokenId
          ) {
            // No exact claimant proof means B must not be sent to any
            // current-device/expired-session route for A's record.
            request.session = undefined;
            request.authenticatedBearer = false;
            request.recoverySession = false;
          }
        }
      }
    } catch {
      // The revocation adapter will independently fail closed if the push
      // record cannot be read. The tombstone still preserves the session.
    }
  }

  private async attemptCleanup(generation: number): Promise<boolean> {
    const request = this.cleanup;
    if (!request || !this.isCurrent(generation)) return false;

    if (!request.revocationComplete) {
      try {
        await this.deps.revokePush(request.session, {
          authenticatedBearer: request.authenticatedBearer,
          recoverySession: request.recoverySession,
          ownerUserId: request.ownerUserId,
          pushSnapshot: request.pushSnapshot,
        });
      } catch {
        return false;
      }
      if (!this.isCurrent(generation)) return false;
      request.revocationComplete = true;
    }

    try {
      await this.deps.deleteStoredSession();
      await this.deps.clearCleanupTombstone?.();
    } catch {
      return false;
    }
    if (!this.isCurrent(generation)) return false;
    this.cleanup = null;
    this.currentStored = null;
    this.emit({
      ...this.snapshot,
      phase: "guest",
      ready: true,
      session: null,
      user: null,
      cleanupRequired: false,
      cleanupReason: null,
    });
    return true;
  }

  private async retryCleanupNow(generation: number): Promise<void> {
    await this.startBoot();
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();
    if (!this.cleanup) return;
    if (!(await this.rejournalCleanup(generation))) throw new SessionCleanupRequiredError();
    if (!(await this.attemptCleanup(generation))) throw new SessionCleanupRequiredError();
  }

  private async signInNow(generation: number, session: Session, user: User): Promise<void> {
    await this.startBoot();
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();

    let cleanupCompleted = false;
    if (this.cleanup) {
      const cleanupOwner =
        this.cleanup.ownerUserId ??
        this.cleanup.pushSnapshot?.ownerUserId ??
        this.cleanup.session?.userId;
      if (cleanupOwner && cleanupOwner !== user.id) {
        // Incoming B is never allowed to substitute for an unresolved A.
        if (!(await this.rejournalCleanup(generation))) throw new SessionCleanupRequiredError();
        if (!(await this.attemptCleanup(generation))) throw new SessionCleanupRequiredError();
        cleanupCompleted = true;
      } else {
        this.cleanup.session = session;
        this.cleanup.user = user;
        this.cleanup.ownerUserId = cleanupOwner ?? user.id;
        this.cleanup.authenticatedBearer = true;
        this.cleanup.recoverySession = false;
        if (!(await this.rejournalCleanup(generation))) throw new SessionCleanupRequiredError();
        if (!(await this.attemptCleanup(generation))) throw new SessionCleanupRequiredError();
        cleanupCompleted = true;
      }
    }
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();

    const previous = this.currentStored;
    let serverCleanupComplete = cleanupCompleted;
    try {
      if (previous?.user.id === user.id) {
        // Token rotation for the same account must cancel stale registration,
        // but must not revoke the account's current push claim.
        await this.deps.cancelPush();
      } else if (!cleanupCompleted) {
        const request: CleanupRequest = {
          reason: "push-revocation-failed",
          session: previous?.session ?? session,
          user: previous?.user ?? user,
          ownerUserId: previous?.user.id ?? user.id,
          revocationComplete: false,
          authenticatedBearer: true,
          recoverySession: false,
        };
        if (!(await this.enterCleanup(request, generation))) {
          throw new SessionCleanupRequiredError();
        }
        serverCleanupComplete = true;
      }
    } catch (error) {
      await this.setCleanupAfterFailure(
        {
          reason: "push-revocation-failed",
          session: previous?.session ?? session,
          user: previous?.user ?? user,
          ownerUserId: previous?.user.id ?? user.id,
          revocationComplete: false,
          authenticatedBearer: true,
          recoverySession: false,
        },
        generation,
      );
      throw error;
    }
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();

    const next = { session, user };
    try {
      await this.deps.writeStoredSession(next);
    } catch (error) {
      const revocationDone = serverCleanupComplete || this.cleanup?.revocationComplete === true;
      const request: CleanupRequest = {
        reason: "session-store-write-failed",
        session: previous?.session ?? session,
        user: previous?.user ?? user,
        ownerUserId: previous?.user.id ?? user.id,
        revocationComplete: revocationDone,
        authenticatedBearer: true,
        recoverySession: false,
      };
      await this.setCleanupAfterFailure(request, generation);
      await this.attemptCleanup(generation);
      throw error instanceof SessionPersistenceError ? error : new SessionPersistenceError("write");
    }
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();
    this.currentStored = next;
    this.cleanup = null;
    this.emit({
      ...this.snapshot,
      phase: "authenticated",
      ready: true,
      session,
      user,
      cleanupRequired: false,
      cleanupReason: null,
    });
  }

  private async signOutNow(generation: number): Promise<void> {
    await this.startBoot();
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();

    if (this.cleanup) {
      if (!(await this.rejournalCleanup(generation))) throw new SessionCleanupRequiredError();
      if (!(await this.attemptCleanup(generation))) throw new SessionCleanupRequiredError();
      return;
    }

    const previous = this.currentStored;
    const request: CleanupRequest = {
      reason: "sign-out",
      session: previous?.session,
      user: previous?.user,
      ownerUserId: previous?.user.id,
      revocationComplete: false,
      authenticatedBearer: true,
      recoverySession: false,
    };
    if (!(await this.enterCleanup(request, generation))) {
      if ((this.cleanup as CleanupRequest | null)?.revocationComplete) {
        throw new SessionPersistenceError("delete");
      }
      throw new SessionCleanupRequiredError();
    }
  }

  private async rejournalCleanup(generation: number): Promise<boolean> {
    const request = this.cleanup;
    if (!request || !this.isCurrent(generation)) return false;
    await this.attachPushSnapshot(request);
    if (!this.isCurrent(generation)) return false;
    if (!this.deps.writeCleanupTombstone) return true;
    try {
      await this.deps.writeCleanupTombstone(cleanupRequestToTombstone(request));
      return this.isCurrent(generation);
    } catch {
      return false;
    }
  }

  private async setCleanupAfterFailure(request: CleanupRequest, generation: number): Promise<void> {
    if (!this.isCurrent(generation)) return;
    this.cleanup = request;
    this.currentStored = null;
    await this.rejournalCleanup(generation);
    this.emit({
      ...this.snapshot,
      phase: "cleanup-required",
      ready: true,
      session: null,
      user: null,
      cleanupRequired: true,
      cleanupReason: request.reason,
    });
  }
}
