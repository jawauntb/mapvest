import type { IdentifyResponse, LatLng } from "@/api/types";

export const PHOTO_QUEUE_STORAGE_KEY = "mapvest.photoQueue.v1";

export type GuestQueueScope = { kind: "guest" };
export type AuthenticatedQueueScope = { kind: "authenticated"; userId: string };
export type QueueScope = GuestQueueScope | AuthenticatedQueueScope;

type LegacyQueueScope = { kind: "legacy-unscoped" };
type StoredQueueScope = QueueScope | LegacyQueueScope;

type QueuePhotoFields = {
  id: string;
  imageUri: string;
  location?: LatLng;
  createdAt: number;
  attempts: number;
  lastError?: string;
};

/** A photo visible to, and uploadable by, the current ownership scope. */
export type QueuedPhoto = QueuePhotoFields & { scope: QueueScope };

type StoredQueuedPhoto = QueuePhotoFields & { scope: StoredQueueScope };

export type QueueStatus = {
  /** Only jobs that the active guest/account can upload. */
  pending: QueuedPhoto[];
  /** Old v1 jobs, deliberately excluded from every active scope. */
  legacyCount: number;
};

export type QueueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type QueueUpload = (input: {
  imageUri: string;
  location?: LatLng;
  token?: string;
  signal?: AbortSignal;
}) => Promise<IdentifyResponse>;

export type PhotoQueueDependencies = {
  storage: QueueStorage;
  upload: QueueUpload;
  isQuotaExceeded: (error: unknown) => boolean;
  markAuthenticatedFindRefresh?: (token: string) => void;
  now?: () => number;
  createId?: () => string;
};

export type FlushQueueOptions = {
  scope: QueueScope;
  token?: string;
  signal?: AbortSignal;
  /** Lets a screen stop a stale flush after its active scope changes. */
  shouldContinue?: () => boolean;
};

export type FlushResult =
  | { id: string; ok: true; response: IdentifyResponse }
  | { id: string; ok: false; error: string };

type QueueFileV1 = { version: 1; items: unknown[] };
type QueueFileV2 = { version: 2; items: StoredQueuedPhoto[] };

const GUEST_SCOPE: GuestQueueScope = { kind: "guest" };
const LEGACY_SCOPE: LegacyQueueScope = { kind: "legacy-unscoped" };

/**
 * Queue ownership is deliberately stable and non-secret. Bearer tokens are
 * used only for the transient upload request and never reach AsyncStorage.
 */
export function queueScopeForUser(userId: string | null | undefined): QueueScope {
  const normalized = userId?.trim();
  return normalized ? { kind: "authenticated", userId: normalized } : GUEST_SCOPE;
}

export function queueScopeKey(scope: QueueScope): string {
  return scope.kind === "guest" ? "guest" : `authenticated:${scope.userId}`;
}

function sameScope(left: QueueScope, right: QueueScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "guest") return true;
  return right.kind === "authenticated" && left.userId === right.userId;
}

function cloneScope(scope: QueueScope): QueueScope {
  if (scope.kind === "guest") return GUEST_SCOPE;
  const userId = scope.userId.trim();
  if (!userId) throw new Error("Authenticated queue scope requires a stable user id");
  return { kind: "authenticated", userId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseLocation(value: unknown): LatLng | undefined {
  if (!isRecord(value) || typeof value.lat !== "number" || typeof value.lng !== "number") {
    return undefined;
  }
  return { lat: value.lat, lng: value.lng };
}

function parsePhotoFields(value: unknown): QueuePhotoFields | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.imageUri !== "string") {
    return undefined;
  }
  const createdAt = typeof value.createdAt === "number" ? value.createdAt : 0;
  const attempts = typeof value.attempts === "number" && value.attempts >= 0 ? value.attempts : 0;
  const location = parseLocation(value.location);
  const lastError = typeof value.lastError === "string" ? value.lastError : undefined;
  return { id: value.id, imageUri: value.imageUri, location, createdAt, attempts, lastError };
}

function parseStoredScope(value: unknown): StoredQueueScope | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "guest") return GUEST_SCOPE;
  if (value.kind === "legacy-unscoped") return LEGACY_SCOPE;
  if (value.kind === "authenticated" && typeof value.userId === "string" && value.userId.trim()) {
    return { kind: "authenticated", userId: value.userId.trim() };
  }
  return undefined;
}

function parseV1Item(value: unknown): StoredQueuedPhoto | undefined {
  const fields = parsePhotoFields(value);
  return fields ? { ...fields, scope: LEGACY_SCOPE } : undefined;
}

function parseV2Item(value: unknown): StoredQueuedPhoto | undefined {
  const fields = parsePhotoFields(value);
  if (!fields) return undefined;
  // A malformed v2 item is treated exactly like v1: never infer ownership.
  return {
    ...fields,
    scope: parseStoredScope(isRecord(value) ? value.scope : undefined) ?? LEGACY_SCOPE,
  };
}

function parseQueue(raw: string | null): { file: QueueFileV2; migrated: boolean } {
  if (!raw) return { file: { version: 2, items: [] }, migrated: false };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
      return { file: { version: 2, items: [] }, migrated: false };
    }
    if (parsed.version === 1) {
      const legacy = (parsed as QueueFileV1).items.flatMap((item) => {
        const next = parseV1Item(item);
        return next ? [next] : [];
      });
      return { file: { version: 2, items: legacy }, migrated: true };
    }
    if (parsed.version === 2) {
      const stored = (parsed as { items: unknown[] }).items.flatMap((item) => {
        const next = parseV2Item(item);
        return next ? [next] : [];
      });
      return { file: { version: 2, items: stored }, migrated: false };
    }
  } catch {
    // A corrupt queue cannot safely be attributed to any account.
  }
  return { file: { version: 2, items: [] }, migrated: false };
}

function belongsToScope(item: StoredQueuedPhoto, scope: QueueScope): item is QueuedPhoto {
  return item.scope.kind !== "legacy-unscoped" && sameScope(item.scope, scope);
}

function canContinue(options: FlushQueueOptions): boolean {
  return !options.signal?.aborted && (options.shouldContinue?.() ?? true);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates the serialized queue used by the React Native adapter and unit
 * tests. Every storage read and write shares one critical section, while
 * network uploads run outside it so new captures are never blocked.
 */
export function createPhotoQueue(deps: PhotoQueueDependencies) {
  let storageTail: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const inFlightFlushes = new Map<string, Promise<FlushResult[]>>();
  const now = deps.now ?? (() => Date.now());
  const createId = deps.createId ?? (() => `${now()}-${Math.random().toString(36).slice(2, 8)}`);

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = storageTail.then(operation, operation);
    storageTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A UI listener must not make a persisted queue mutation fail.
      }
    }
  }

  async function load(): Promise<{ file: QueueFileV2; migrated: boolean }> {
    return parseQueue(await deps.storage.getItem(PHOTO_QUEUE_STORAGE_KEY));
  }

  async function persist(file: QueueFileV2): Promise<void> {
    await deps.storage.setItem(PHOTO_QUEUE_STORAGE_KEY, JSON.stringify(file));
  }

  async function status(scope: QueueScope): Promise<QueueStatus> {
    const activeScope = cloneScope(scope);
    return serialized(async () => {
      const loaded = await load();
      if (loaded.migrated) await persist(loaded.file);
      return {
        pending: loaded.file.items.filter((item) => belongsToScope(item, activeScope)),
        legacyCount: loaded.file.items.filter((item) => item.scope.kind === "legacy-unscoped")
          .length,
      };
    });
  }

  async function enqueue(input: {
    imageUri: string;
    location?: LatLng;
    scope: QueueScope;
  }): Promise<QueuedPhoto> {
    const scope = cloneScope(input.scope);
    const item = await serialized(async () => {
      const loaded = await load();
      const next: QueuedPhoto = {
        id: createId(),
        imageUri: input.imageUri,
        location: input.location,
        createdAt: now(),
        attempts: 0,
        scope,
      };
      loaded.file.items.push(next);
      await persist(loaded.file);
      return next;
    });
    notify();
    return item;
  }

  async function remove(id: string, scope: QueueScope): Promise<void> {
    const activeScope = cloneScope(scope);
    let changed = false;
    await serialized(async () => {
      const loaded = await load();
      const items = loaded.file.items.filter((item) => {
        const shouldRemove = item.id === id && belongsToScope(item, activeScope);
        changed ||= shouldRemove;
        return !shouldRemove;
      });
      if (changed || loaded.migrated) await persist({ version: 2, items });
    });
    if (changed) notify();
  }

  async function markAttempt(id: string, scope: QueueScope, error?: string): Promise<void> {
    const activeScope = cloneScope(scope);
    let changed = false;
    await serialized(async () => {
      const loaded = await load();
      const items = loaded.file.items.map((item) => {
        if (item.id !== id || !belongsToScope(item, activeScope)) return item;
        changed = true;
        return { ...item, attempts: item.attempts + 1, lastError: error };
      });
      if (changed || loaded.migrated) await persist({ version: 2, items });
    });
    if (changed) notify();
  }

  async function doFlush(options: FlushQueueOptions): Promise<FlushResult[]> {
    const scope = cloneScope(options.scope);
    const token = options.token?.trim();
    // Never accidentally attach an authenticated bearer to a guest capture.
    const requestToken = scope.kind === "authenticated" ? token : undefined;
    if (scope.kind === "authenticated" && !requestToken) return [];

    const items = (await status(scope)).pending;
    const results: FlushResult[] = [];
    for (const item of items) {
      if (!canContinue(options)) break;
      try {
        const response = await deps.upload({
          imageUri: item.imageUri,
          location: item.location,
          token: requestToken,
          signal: options.signal,
        });
        // The upload can finish after an account switch. Removing this already
        // completed item's old-scope record is safe; the current scope never
        // receives its UI update, and no token is persisted.
        await remove(item.id, scope);
        if (scope.kind === "authenticated" && requestToken && response.investables.length > 0) {
          deps.markAuthenticatedFindRefresh?.(requestToken);
        }
        results.push({ id: item.id, ok: true, response });
      } catch (error) {
        if (!canContinue(options)) break;
        if (deps.isQuotaExceeded(error)) {
          await markAttempt(item.id, scope, "quota_exceeded");
          results.push({ id: item.id, ok: false, error: "quota_exceeded" });
          break;
        }
        const message = errorMessage(error);
        await markAttempt(item.id, scope, message);
        results.push({ id: item.id, ok: false, error: message });
      }
    }
    return results;
  }

  function flush(options: FlushQueueOptions): Promise<FlushResult[]> {
    const key = queueScopeKey(options.scope);
    const existing = inFlightFlushes.get(key);
    if (existing) return existing;

    const run = doFlush(options).finally(() => {
      if (inFlightFlushes.get(key) === run) inFlightFlushes.delete(key);
    });
    inFlightFlushes.set(key, run);
    return run;
  }

  return {
    enqueue,
    flush,
    markAttempt,
    remove,
    status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
