import { Platform } from "react-native";
import type { WidgetDiscoverySnapshotV1, WidgetSnapshotScope } from "./widgetSnapshot";
import {
  type WidgetSnapshotSession,
  WidgetSnapshotSessionGate,
  createWidgetSnapshotStore,
} from "./widgetSnapshotStore";

const IOS_APP_GROUP = "group.com.mapvest.app.widget";

type ExtensionStorageInstance = {
  get(key: string): string | null | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
};

type ExtensionStorageConstructor = {
  new (appGroup: string): ExtensionStorageInstance;
  reloadWidget(name?: string): void;
};

let extensionStorage: ExtensionStorageInstance | null = null;
let extensionStorageType: ExtensionStorageConstructor | null = null;
const sessionGate = new WidgetSnapshotSessionGate();

function loadStorage(): ExtensionStorageInstance | null {
  if (Platform.OS !== "ios") return null;
  if (extensionStorage) return extensionStorage;
  try {
    const ExtensionStorage = (
      require("@bacons/apple-targets") as { ExtensionStorage: ExtensionStorageConstructor }
    ).ExtensionStorage;
    extensionStorageType = ExtensionStorage;
    extensionStorage = new ExtensionStorage(IOS_APP_GROUP);
    return extensionStorage;
  } catch {
    return null;
  }
}

const nativeStorage = loadStorage();
const snapshotStore = nativeStorage
  ? createWidgetSnapshotStore(
      {
        get: async (key) => nativeStorage.get(key),
        set: async (key, value) => nativeStorage.set(key, value),
        remove: async (key) => nativeStorage.remove(key),
        reload: async () => extensionStorageType?.reloadWidget(),
      },
      () => {
        const uuid =
          typeof globalThis.crypto?.randomUUID === "function"
            ? globalThis.crypto.randomUUID()
            : Math.random().toString(36).slice(2);
        return `${Date.now()}-${uuid}`;
      },
    )
  : null;

export async function activateWidgetSnapshotSession(
  session: WidgetSnapshotSession,
  options: { allowBlockedIdentity?: boolean } = {},
): Promise<WidgetSnapshotScope | null> {
  if (!snapshotStore || !sessionGate.request(session, options.allowBlockedIdentity)) return null;
  try {
    const scope = session.accountId
      ? await snapshotStore.activateAccount(session.accountId)
      : await snapshotStore.activateGuest();
    if (!scopeMatchesSession(scope, session) || !sessionGate.commit(session)) return null;
    return scope;
  } catch {
    return null;
  }
}

export async function activeWidgetSnapshotScope(
  session: WidgetSnapshotSession,
): Promise<WidgetSnapshotScope | null> {
  if (!sessionGate.matches(session) || !snapshotStore) return null;
  try {
    const scope = session.accountId ? await snapshotStore.readScope() : { kind: "guest" as const };
    return scope && scopeMatchesSession(scope, session) && sessionGate.matches(session)
      ? scope
      : null;
  } catch {
    return null;
  }
}

export async function writeWidgetDiscoverySnapshot(
  snapshot: WidgetDiscoverySnapshotV1,
  session: WidgetSnapshotSession,
  options: { expectedSnapshotId?: string } = {},
): Promise<boolean> {
  if (
    !sessionGate.matches(session) ||
    !snapshotStore ||
    !scopeMatchesSession(snapshot.scope, session)
  )
    return false;
  try {
    return await snapshotStore.write(snapshot, {
      ...options,
      canWrite: () => sessionGate.matches(session),
    });
  } catch {
    return false;
  }
}

export async function readWidgetDiscoverySnapshot(
  session: WidgetSnapshotSession,
): Promise<WidgetDiscoverySnapshotV1 | null> {
  if (!sessionGate.matches(session) || !snapshotStore) return null;
  try {
    const scope = session.accountId ? await snapshotStore.readScope() : { kind: "guest" as const };
    if (!scope || !scopeMatchesSession(scope, session)) return null;
    const snapshot = await snapshotStore.readSnapshot();
    if (
      !snapshot ||
      !sessionGate.matches(session) ||
      !scopeMatchesSession(snapshot.scope, session) ||
      !sameScope(scope, snapshot.scope)
    ) {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function invalidateWidgetSnapshotSession(): void {
  sessionGate.invalidate();
}

/** Sign-out invalidates the in-memory generation before queued storage cleanup. */
export async function clearWidgetDiscoverySnapshotState(): Promise<void> {
  invalidateWidgetSnapshotSession();
  if (!snapshotStore) return;
  await snapshotStore.clear();
}

function scopeMatchesSession(scope: WidgetSnapshotScope, session: WidgetSnapshotSession): boolean {
  return session.accountId
    ? scope.kind === "account" && scope.accountId === session.accountId
    : scope.kind === "guest";
}

function sameScope(left: WidgetSnapshotScope, right: WidgetSnapshotScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "guest") return true;
  return (
    right.kind === "account" && left.accountId === right.accountId && left.epoch === right.epoch
  );
}
