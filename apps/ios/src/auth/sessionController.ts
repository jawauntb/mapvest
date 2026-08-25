import type { Session, User } from "@/api/types";
import { sessionExpired } from "./sessionPolicy";

export type StoredSession = { session: Session; user: User };

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
    options?: { authenticatedBearer: boolean; allowNativeOnlyFallback: boolean },
  ) => Promise<void>;
  cancelPush: () => Promise<void>;
  writeStoredSession: (stored: StoredSession) => Promise<void>;
  deleteStoredSession: () => Promise<void>;
};

type CleanupRequest = {
  reason: CleanupReason;
  session?: Session;
  revocationComplete: boolean;
  authenticatedBearer: boolean;
  allowNativeOnlyFallback: boolean;
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
    return this.isCurrent(generation) && this.snapshot.session?.token === token;
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
    this.bootAbort?.abort();
    this.emit({ ...this.snapshot, authGeneration: this.generation });
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
          allowNativeOnlyFallback: true,
        },
        generation,
      );
      return;
    }
    if (!loaded.raw) {
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
      return;
    }

    let parsed: StoredSession;
    try {
      const value: unknown = JSON.parse(loaded.raw);
      if (!isStoredSession(value)) throw new Error("invalid stored session");
      parsed = value;
    } catch {
      await this.enterCleanup(
        {
          reason: "malformed-session",
          revocationComplete: false,
          authenticatedBearer: false,
          allowNativeOnlyFallback: true,
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
          revocationComplete: false,
          authenticatedBearer: false,
          allowNativeOnlyFallback: true,
        },
        generation,
      );
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
            revocationComplete: false,
            authenticatedBearer: false,
            allowNativeOnlyFallback: true,
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
            revocationComplete: false,
            authenticatedBearer: false,
            allowNativeOnlyFallback: true,
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

  private async attemptCleanup(generation: number): Promise<boolean> {
    const request = this.cleanup;
    if (!request || !this.isCurrent(generation)) return false;

    if (!request.revocationComplete) {
      try {
        await this.deps.revokePush(request.session, {
          authenticatedBearer: request.authenticatedBearer,
          allowNativeOnlyFallback: request.allowNativeOnlyFallback,
        });
      } catch {
        return false;
      }
      if (!this.isCurrent(generation)) return false;
      request.revocationComplete = true;
    }

    try {
      await this.deps.deleteStoredSession();
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
    if (!(await this.attemptCleanup(generation))) throw new SessionCleanupRequiredError();
  }

  private async signInNow(generation: number, session: Session, user: User): Promise<void> {
    await this.startBoot();
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();

    if (this.cleanup) {
      if (!(await this.attemptCleanup(generation))) throw new SessionCleanupRequiredError();
    }
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();

    const previous = this.currentStored;
    let previousRevoked = false;
    try {
      if (previous?.user.id === user.id) {
        // Token rotation for the same account must cancel stale registration,
        // but must not revoke the account's current push claim.
        await this.deps.cancelPush();
      } else {
        await this.deps.revokePush(previous?.session, {
          authenticatedBearer: true,
          allowNativeOnlyFallback: false,
        });
        previousRevoked = true;
      }
    } catch (error) {
      this.setCleanupAfterFailure(
        {
          reason: "push-revocation-failed",
          session: previous?.session,
          revocationComplete: false,
          authenticatedBearer: true,
          allowNativeOnlyFallback: false,
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
      const request: CleanupRequest = {
        reason: "session-store-write-failed",
        session: previous?.session,
        revocationComplete: previousRevoked,
        authenticatedBearer: true,
        allowNativeOnlyFallback: false,
      };
      this.setCleanupAfterFailure(request, generation);
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
      if (!(await this.attemptCleanup(generation))) throw new SessionCleanupRequiredError();
      return;
    }

    const previous = this.currentStored;
    try {
      await this.deps.revokePush(previous?.session, {
        authenticatedBearer: true,
        allowNativeOnlyFallback: false,
      });
    } catch (error) {
      this.setCleanupAfterFailure(
        {
          reason: "push-revocation-failed",
          session: previous?.session,
          revocationComplete: false,
          authenticatedBearer: true,
          allowNativeOnlyFallback: false,
        },
        generation,
      );
      throw error;
    }
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();

    try {
      await this.deps.deleteStoredSession();
    } catch (error) {
      this.setCleanupAfterFailure(
        {
          reason: "session-store-delete-failed",
          session: previous?.session,
          revocationComplete: true,
          authenticatedBearer: true,
          allowNativeOnlyFallback: false,
        },
        generation,
      );
      throw error instanceof SessionPersistenceError
        ? error
        : new SessionPersistenceError("delete");
    }
    if (!this.isCurrent(generation)) throw new SessionTransitionCancelledError();
    this.currentStored = null;
    this.cleanup = null;
    this.emit({
      ...this.snapshot,
      phase: "guest",
      ready: true,
      session: null,
      user: null,
      cleanupRequired: false,
      cleanupReason: null,
    });
  }

  private setCleanupAfterFailure(request: CleanupRequest, generation: number): void {
    if (!this.isCurrent(generation)) return;
    this.cleanup = request;
    this.currentStored = null;
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
