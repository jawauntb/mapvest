import {
  type WidgetDiscoverySnapshotV1,
  type WidgetSnapshotScope,
  parseWidgetDiscoverySnapshot,
} from "./widgetSnapshot";

export const WIDGET_SNAPSHOT_STORAGE_KEY = "discoverySnapshotV1";
export const WIDGET_SCOPE_STORAGE_KEY = "widgetAccountScopeV1";

export type WidgetSnapshotStorage = {
  get: (key: string) => Promise<string | null | undefined>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  reload: () => Promise<void>;
};

function parseScope(raw: string | null | undefined): WidgetSnapshotScope | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { kind?: unknown; accountId?: unknown; epoch?: unknown };
    if (value.kind === "guest" && value.accountId === undefined && value.epoch === undefined)
      return { kind: "guest" };
    if (
      value.kind === "account" &&
      typeof value.accountId === "string" &&
      value.accountId &&
      typeof value.epoch === "string" &&
      value.epoch
    ) {
      return { kind: "account", accountId: value.accountId, epoch: value.epoch };
    }
    return null;
  } catch {
    return null;
  }
}

function sameScope(left: WidgetSnapshotScope | null, right: WidgetSnapshotScope): boolean {
  if (!left || left.kind !== right.kind) return false;
  if (left.kind === "guest") return true;
  return (
    right.kind === "account" && left.accountId === right.accountId && left.epoch === right.epoch
  );
}

export function createWidgetSnapshotStore(
  storage: WidgetSnapshotStorage,
  createEpoch: () => string,
) {
  let queue: Promise<void> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    activateAccount(accountId: string): Promise<WidgetSnapshotScope> {
      return serialized(async () => {
        const current = parseScope(await storage.get(WIDGET_SCOPE_STORAGE_KEY));
        if (current?.kind === "account" && current.accountId === accountId) return current;
        const next: WidgetSnapshotScope = { kind: "account", accountId, epoch: createEpoch() };
        // Establish the new scope even when old-snapshot removal fails. That
        // leaves the old account snapshot scope-mismatched and therefore
        // hidden by WidgetKit until a new verified snapshot replaces it.
        try {
          await storage.set(WIDGET_SCOPE_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Continue with removal so a failed scope write can still erase the
          // prior account's personal frame.
        }
        try {
          await storage.remove(WIDGET_SNAPSHOT_STORAGE_KEY);
        } catch {
          // Scope verification below decides whether the remaining frame is
          // safely mismatched.
        }
        await storage.reload().catch(() => {});
        const persisted = parseScope(await storage.get(WIDGET_SCOPE_STORAGE_KEY));
        if (!sameScope(persisted, next)) {
          throw new Error("Widget account scope transition could not be verified");
        }
        return next;
      });
    },

    activateGuest(): Promise<WidgetSnapshotScope> {
      return serialized(async () => {
        const rawScope = await storage.get(WIDGET_SCOPE_STORAGE_KEY);
        const current = parseScope(rawScope);
        const rawSnapshot = await storage.get(WIDGET_SNAPSHOT_STORAGE_KEY);
        const snapshot = parseWidgetDiscoverySnapshot(rawSnapshot);
        const unsafeSnapshot = rawSnapshot != null && snapshot?.scope.kind !== "guest";
        if (current?.kind === "account" || rawScope != null || unsafeSnapshot) {
          try {
            await storage.remove(WIDGET_SCOPE_STORAGE_KEY);
          } catch {
            // Still attempt the snapshot removal below.
          }
          try {
            await storage.remove(WIDGET_SNAPSHOT_STORAGE_KEY);
          } catch {
            // A removed scope makes an old account snapshot fail closed.
          }
          await storage.reload().catch(() => {});
          const persisted = parseScope(await storage.get(WIDGET_SCOPE_STORAGE_KEY));
          if (persisted?.kind === "account") {
            throw new Error("Widget guest scope transition could not be verified");
          }
        }
        return { kind: "guest" };
      });
    },

    readScope(): Promise<WidgetSnapshotScope | null> {
      return serialized(async () => parseScope(await storage.get(WIDGET_SCOPE_STORAGE_KEY)));
    },

    readSnapshot(): Promise<WidgetDiscoverySnapshotV1 | null> {
      return serialized(async () =>
        parseWidgetDiscoverySnapshot(await storage.get(WIDGET_SNAPSHOT_STORAGE_KEY)),
      );
    },

    write(
      snapshot: WidgetDiscoverySnapshotV1,
      options: { expectedSnapshotId?: string; canWrite?: () => boolean } = {},
    ): Promise<boolean> {
      return serialized(async () => {
        if (options.canWrite && !options.canWrite()) return false;
        const safeSnapshot = parseWidgetDiscoverySnapshot(snapshot);
        if (!safeSnapshot) return false;
        const activeScope = parseScope(await storage.get(WIDGET_SCOPE_STORAGE_KEY));
        if (safeSnapshot.scope.kind === "account") {
          if (!sameScope(activeScope, safeSnapshot.scope)) return false;
        } else if (activeScope?.kind === "account") {
          return false;
        }
        const previous = await storage.get(WIDGET_SNAPSHOT_STORAGE_KEY);
        if (options.expectedSnapshotId) {
          const current = parseWidgetDiscoverySnapshot(previous);
          if (current?.snapshotId !== options.expectedSnapshotId) return false;
        }
        const serializedSnapshot = JSON.stringify(safeSnapshot);
        try {
          await storage.set(WIDGET_SNAPSHOT_STORAGE_KEY, serializedSnapshot);
        } catch (error) {
          if (previous != null) {
            await storage.set(WIDGET_SNAPSHOT_STORAGE_KEY, previous).catch(() => {});
          }
          throw error;
        }
        const written = await storage.get(WIDGET_SNAPSHOT_STORAGE_KEY);
        const validWrite = written === serializedSnapshot && parseWidgetDiscoverySnapshot(written);
        if (!validWrite || (options.canWrite && !options.canWrite())) {
          if (options.canWrite && !options.canWrite()) {
            await storage.remove(WIDGET_SNAPSHOT_STORAGE_KEY).catch(() => {});
            await storage.reload().catch(() => {});
            return false;
          }
          if (previous == null) {
            await storage.remove(WIDGET_SNAPSHOT_STORAGE_KEY).catch(() => {});
          } else {
            await storage.set(WIDGET_SNAPSHOT_STORAGE_KEY, previous).catch(() => {});
          }
          await storage.reload().catch(() => {});
          throw new Error("Widget discovery snapshot could not be verified");
        }
        await storage.reload();
        return true;
      });
    },

    clear(): Promise<void> {
      return serialized(async () => {
        await storage.remove(WIDGET_SNAPSHOT_STORAGE_KEY);
        await storage.remove(WIDGET_SCOPE_STORAGE_KEY);
        const [snapshot, scope] = await Promise.all([
          storage.get(WIDGET_SNAPSHOT_STORAGE_KEY),
          storage.get(WIDGET_SCOPE_STORAGE_KEY),
        ]);
        if (snapshot != null || scope != null) {
          throw new Error("Widget discovery snapshot cleanup could not be verified");
        }
        await storage.reload();
      });
    },
  };
}

export type WidgetSnapshotSession = {
  accountId: string | null;
  authGeneration: number;
};

/** Prevents an async sync from reactivating a signed-out or newer account. */
export class WidgetSnapshotSessionGate {
  private active: WidgetSnapshotSession | null = null;
  private pending: WidgetSnapshotSession | null = null;
  private blocked: WidgetSnapshotSession | null = null;

  request(session: WidgetSnapshotSession, allowBlockedIdentity = false): boolean {
    if (!allowBlockedIdentity && this.blocked && sameSession(this.blocked, session)) return false;
    if (this.active && session.authGeneration < this.active.authGeneration) return false;
    if (this.pending && session.authGeneration < this.pending.authGeneration) return false;
    if (
      this.active &&
      session.authGeneration === this.active.authGeneration &&
      session.accountId !== this.active.accountId
    )
      return false;
    if (
      this.pending &&
      session.authGeneration === this.pending.authGeneration &&
      session.accountId !== this.pending.accountId
    )
      return false;
    this.pending = session;
    return true;
  }

  commit(session: WidgetSnapshotSession): boolean {
    if (!this.pending || !sameSession(this.pending, session)) return false;
    this.active = session;
    this.pending = null;
    if (this.blocked && sameSession(this.blocked, session)) this.blocked = null;
    return true;
  }

  activate(session: WidgetSnapshotSession): boolean {
    return this.request(session) && this.commit(session);
  }

  invalidate(): void {
    this.blocked = this.active ?? this.pending;
    this.active = null;
    this.pending = null;
  }

  matches(session: WidgetSnapshotSession): boolean {
    return (
      this.active?.authGeneration === session.authGeneration &&
      this.active.accountId === session.accountId
    );
  }
}

function sameSession(left: WidgetSnapshotSession, right: WidgetSnapshotSession): boolean {
  return left.authGeneration === right.authGeneration && left.accountId === right.accountId;
}
