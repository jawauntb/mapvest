import type { IdentifyResponse, LatLng } from "@/api/types";

export const PHOTO_QUEUE_STORAGE_KEY = "mapvest.photoQueue.v1";
export const PHOTO_QUEUE_QUARANTINE_STORAGE_KEY = "mapvest.photoQueue.quarantine.v1";

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

export type QueueRecovery = {
  kind: "corrupt" | "malformed" | "unsupported-version" | "storage-unavailable";
  message: string;
  /** Whether the exact unreadable payload was copied to the private quarantine key. */
  quarantined: boolean;
};

export type QueueStatus = {
  /** Only jobs that the active guest/account can upload. */
  pending: QueuedPhoto[];
  /** Old v1 jobs, deliberately excluded from every active scope. */
  legacyCount: number;
  /** Queue changes are blocked until the person explicitly discards unreadable data. */
  recovery: QueueRecovery | null;
};

export type QueueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Keeps queue image bytes in a private, durable app directory. */
export type QueueFileAdapter = {
  copy(sourceUri: string, itemId: string): Promise<string>;
  delete(managedUri: string): Promise<void>;
  isManagedUri(uri: string): boolean;
};

export type QueueUpload = (input: {
  imageUri: string;
  location?: LatLng;
  token?: string;
  signal?: AbortSignal;
}) => Promise<IdentifyResponse>;

export type PhotoQueueDependencies = {
  storage: QueueStorage;
  files: QueueFileAdapter;
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
type QueueFileV3 = { version: 3; items: StoredQueuedPhoto[] };
type ParsedQueue =
  | { kind: "ok"; file: QueueFileV3; migrated: boolean }
  | { kind: "recovery"; raw: string; recoveryKind: QueueRecovery["kind"] };

const GUEST_SCOPE: GuestQueueScope = { kind: "guest" };
const LEGACY_SCOPE: LegacyQueueScope = { kind: "legacy-unscoped" };
const RECOVERY_MESSAGE =
  "Offline queue data needs recovery before another photo can be queued or uploaded.";

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
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.imageUri !== "string" ||
    !value.imageUri ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    typeof value.attempts !== "number" ||
    !Number.isInteger(value.attempts) ||
    value.attempts < 0
  ) {
    return undefined;
  }
  if (value.location !== undefined && !parseLocation(value.location)) return undefined;
  if (value.lastError !== undefined && typeof value.lastError !== "string") return undefined;
  return {
    id: value.id,
    imageUri: value.imageUri,
    location: parseLocation(value.location),
    createdAt: value.createdAt,
    attempts: value.attempts,
    lastError: typeof value.lastError === "string" ? value.lastError : undefined,
  };
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

function parseV3Item(value: unknown, files: QueueFileAdapter): StoredQueuedPhoto | undefined {
  const fields = parsePhotoFields(value);
  const scope = parseStoredScope(isRecord(value) ? value.scope : undefined);
  if (!fields || !scope) return undefined;
  // Legacy v1 records are never uploaded or deleted. Every usable v3 job must
  // name a path our file adapter recognizes as queue-owned.
  if (scope.kind !== "legacy-unscoped" && !files.isManagedUri(fields.imageUri)) return undefined;
  return { ...fields, scope };
}

function parseQueue(raw: string | null, files: QueueFileAdapter): ParsedQueue {
  if (!raw) return { kind: "ok", file: { version: 3, items: [] }, migrated: false };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
      return { kind: "recovery", raw, recoveryKind: "malformed" };
    }
    if (parsed.version === 1) {
      const items: StoredQueuedPhoto[] = [];
      for (const value of (parsed as QueueFileV1).items) {
        const item = parseV1Item(value);
        if (!item) return { kind: "recovery", raw, recoveryKind: "malformed" };
        items.push(item);
      }
      return { kind: "ok", file: { version: 3, items }, migrated: true };
    }
    if (parsed.version === 3) {
      const items: StoredQueuedPhoto[] = [];
      for (const value of parsed.items) {
        const item = parseV3Item(value, files);
        if (!item) return { kind: "recovery", raw, recoveryKind: "malformed" };
        items.push(item);
      }
      return { kind: "ok", file: { version: 3, items }, migrated: false };
    }
    return { kind: "recovery", raw, recoveryKind: "unsupported-version" };
  } catch {
    return { kind: "recovery", raw, recoveryKind: "corrupt" };
  }
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

function recoveryMessage(kind: QueueRecovery["kind"]): string {
  if (kind === "unsupported-version") {
    return "This offline queue was created by a newer app version and is protected until you discard it.";
  }
  if (kind === "storage-unavailable") {
    return "Offline queue storage is unavailable, so no photo can be queued safely right now.";
  }
  return "Offline queue data is unreadable and is protected until you discard it.";
}

function recoveryError(recovery: QueueRecovery): Error {
  return new Error(`${RECOVERY_MESSAGE} ${recovery.message}`);
}

/**
 * Creates the serialized queue used by the React Native adapter and unit
 * tests. Every storage read and write shares one critical section, while
 * network uploads and durable file copies run outside it.
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

  async function load(): Promise<ParsedQueue> {
    return parseQueue(await deps.storage.getItem(PHOTO_QUEUE_STORAGE_KEY), deps.files);
  }

  async function persist(file: QueueFileV3): Promise<void> {
    await deps.storage.setItem(PHOTO_QUEUE_STORAGE_KEY, JSON.stringify(file));
  }

  async function quarantine(loaded: Extract<ParsedQueue, { kind: "recovery" }>): Promise<void> {
    // Keep the raw source key untouched. This copy is intentionally exact so
    // diagnostics can distinguish a corrupt record from an empty queue.
    await deps.storage.setItem(PHOTO_QUEUE_QUARANTINE_STORAGE_KEY, loaded.raw);
  }

  async function status(scope: QueueScope): Promise<QueueStatus> {
    const activeScope = cloneScope(scope);
    return serialized(async () => {
      try {
        const loaded = await load();
        if (loaded.kind === "recovery") {
          let quarantined = false;
          try {
            await quarantine(loaded);
            quarantined = true;
          } catch {
            // The original raw value remains in place; never replace it with
            // an empty queue when a recovery copy cannot be written.
          }
          return {
            pending: [],
            legacyCount: 0,
            recovery: {
              kind: loaded.recoveryKind,
              message: recoveryMessage(loaded.recoveryKind),
              quarantined,
            },
          };
        }
        if (loaded.migrated) await persist(loaded.file);
        return {
          pending: loaded.file.items.filter((item) => belongsToScope(item, activeScope)),
          legacyCount: loaded.file.items.filter((item) => item.scope.kind === "legacy-unscoped")
            .length,
          recovery: null,
        };
      } catch {
        return {
          pending: [],
          legacyCount: 0,
          recovery: {
            kind: "storage-unavailable",
            message: recoveryMessage("storage-unavailable"),
            quarantined: false,
          },
        };
      }
    });
  }

  async function writableFile(): Promise<QueueFileV3> {
    const loaded = await load();
    if (loaded.kind === "recovery") {
      await quarantine(loaded);
      throw recoveryError({
        kind: loaded.recoveryKind,
        message: recoveryMessage(loaded.recoveryKind),
        quarantined: true,
      });
    }
    if (loaded.migrated) await persist(loaded.file);
    return loaded.file;
  }

  async function deleteManaged(uri: string): Promise<void> {
    if (!deps.files.isManagedUri(uri)) {
      throw new Error("Refusing to delete a photo outside Mapvest's private queue folder");
    }
    await deps.files.delete(uri);
  }

  async function cleanupFailedEnqueue(uri: string, error: unknown): Promise<never> {
    try {
      await deleteManaged(uri);
    } catch (cleanupError) {
      throw new Error(
        `${errorMessage(error)} The private queue copy could not be removed: ${errorMessage(cleanupError)}`,
      );
    }
    throw error;
  }

  async function enqueue(input: {
    imageUri: string;
    location?: LatLng;
    scope: QueueScope;
  }): Promise<QueuedPhoto> {
    const scope = cloneScope(input.scope);
    // Fail before creating a durable copy when recovery is required.
    await serialized(writableFile);

    const id = createId();
    const imageUri = await deps.files.copy(input.imageUri, id);
    if (!deps.files.isManagedUri(imageUri)) {
      throw new Error("Offline photo copy did not land in Mapvest's private queue folder");
    }

    try {
      const item = await serialized(async () => {
        const file = await writableFile();
        const next: QueuedPhoto = {
          id,
          imageUri,
          location: input.location,
          createdAt: now(),
          attempts: 0,
          scope,
        };
        file.items.push(next);
        await persist(file);
        return next;
      });
      notify();
      return item;
    } catch (error) {
      return cleanupFailedEnqueue(imageUri, error);
    }
  }

  async function removeRecord(id: string, scope: QueueScope): Promise<QueuedPhoto | undefined> {
    const activeScope = cloneScope(scope);
    let removed: QueuedPhoto | undefined;
    await serialized(async () => {
      const file = await writableFile();
      const items = file.items.filter((item) => {
        const shouldRemove = item.id === id && belongsToScope(item, activeScope);
        if (shouldRemove) removed = item;
        return !shouldRemove;
      });
      if (removed) await persist({ version: 3, items });
    });
    return removed;
  }

  async function remove(id: string, scope: QueueScope): Promise<void> {
    const removed = await removeRecord(id, scope);
    if (!removed) return;
    try {
      await deleteManaged(removed.imageUri);
    } finally {
      notify();
    }
  }

  async function markAttempt(id: string, scope: QueueScope, error?: string): Promise<void> {
    const activeScope = cloneScope(scope);
    let changed = false;
    await serialized(async () => {
      const file = await writableFile();
      const items = file.items.map((item) => {
        if (item.id !== id || !belongsToScope(item, activeScope)) return item;
        changed = true;
        return { ...item, attempts: item.attempts + 1, lastError: error };
      });
      if (changed) await persist({ version: 3, items });
    });
    if (changed) notify();
  }

  async function resetRecovery(): Promise<void> {
    let reset = false;
    await serialized(async () => {
      const loaded = await load();
      if (loaded.kind === "ok") return;
      // Retain the exact quarantine payload for diagnostics. The person has
      // explicitly chosen to discard it from uploads by clearing only the
      // active queue key.
      await quarantine(loaded);
      await deps.storage.removeItem(PHOTO_QUEUE_STORAGE_KEY);
      reset = true;
    });
    if (reset) notify();
  }

  async function doFlush(options: FlushQueueOptions): Promise<FlushResult[]> {
    const scope = cloneScope(options.scope);
    const token = options.token?.trim();
    // Never accidentally attach an authenticated bearer to a guest capture.
    const requestToken = scope.kind === "authenticated" ? token : undefined;
    if (scope.kind === "authenticated" && !requestToken) return [];

    const queueStatus = await status(scope);
    if (queueStatus.recovery) return [];
    const results: FlushResult[] = [];
    for (const item of queueStatus.pending) {
      if (!canContinue(options)) break;
      try {
        const response = await deps.upload({
          imageUri: item.imageUri,
          location: item.location,
          token: requestToken,
          signal: options.signal,
        });
        if (scope.kind === "authenticated" && requestToken && response.investables.length > 0) {
          deps.markAuthenticatedFindRefresh?.(requestToken);
        }
        const removed = await removeRecord(item.id, scope);
        if (removed) {
          try {
            await deleteManaged(removed.imageUri);
          } catch (cleanupError) {
            // The queue record is gone, so this will not re-upload. Report the
            // cleanup miss for diagnostics without pretending the photo queued.
            console.warn("[photo-queue] completed copy cleanup failed:", cleanupError);
          }
          notify();
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
    resetRecovery,
    status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
