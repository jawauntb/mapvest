import { describe, expect, test } from "bun:test";
import type { IdentifyResponse } from "@/api/types";
import {
  PHOTO_QUEUE_QUARANTINE_STORAGE_KEY,
  PHOTO_QUEUE_STORAGE_KEY,
  type QueueFileAdapter,
  type QueueStorage,
  createPhotoQueue,
  queueScopeForUser,
} from "./photoQueueStore";

function identifyResponse(investableCount = 0): IdentifyResponse {
  return {
    investables: Array.from({ length: investableCount }, () => ({})),
  } as unknown as IdentifyResponse;
}

function memoryStorage(
  initial: string | null = null,
  options: {
    getError?: Error;
    removeError?: Error;
    setFails?: (key: string, value: string) => boolean;
  } = {},
): {
  storage: QueueStorage;
  value: (key: string) => string | null;
  writes: Array<{ key: string; value: string }>;
  removals: string[];
} {
  const values = new Map<string, string>();
  if (initial !== null) values.set(PHOTO_QUEUE_STORAGE_KEY, initial);
  const writes: Array<{ key: string; value: string }> = [];
  const removals: string[] = [];
  return {
    storage: {
      async getItem(key) {
        if (options.getError) throw options.getError;
        return values.get(key) ?? null;
      },
      async setItem(key, value) {
        if (options.setFails?.(key, value)) throw new Error(`set failed for ${key}`);
        values.set(key, value);
        writes.push({ key, value });
      },
      async removeItem(key) {
        if (options.removeError) throw options.removeError;
        values.delete(key);
        removals.push(key);
      },
    },
    value: (key) => values.get(key) ?? null,
    writes,
    removals,
  };
}

function memoryFiles(
  options: {
    copyError?: Error;
    deleteError?: Error;
    sourceAvailable?: () => boolean;
  } = {},
): {
  files: QueueFileAdapter;
  copied: Array<{ sourceUri: string; managedUri: string }>;
  deleted: string[];
} {
  const copied: Array<{ sourceUri: string; managedUri: string }> = [];
  const deleted: string[] = [];
  const managed = new Set<string>();
  const prefix = "file://mapvest-private/photo-queue/";
  return {
    files: {
      isManagedUri: (uri) => uri.startsWith(prefix),
      async copy(sourceUri, itemId) {
        if (options.copyError) throw options.copyError;
        if (options.sourceAvailable && !options.sourceAvailable()) {
          throw new Error("source cache is gone");
        }
        const managedUri = `${prefix}${itemId}.jpg`;
        managed.add(managedUri);
        copied.push({ sourceUri, managedUri });
        return managedUri;
      },
      async delete(managedUri) {
        if (options.deleteError) throw options.deleteError;
        if (!managed.has(managedUri)) throw new Error("managed file is missing");
        managed.delete(managedUri);
        deleted.push(managedUri);
      },
    },
    copied,
    deleted,
  };
}

function makeQueue(
  initial: string | null = null,
  options: {
    storage?: Parameters<typeof memoryStorage>[1];
    files?: Parameters<typeof memoryFiles>[0];
  } = {},
) {
  const memory = memoryStorage(initial, options.storage);
  const fileMemory = memoryFiles(options.files);
  const uploads: Array<{ imageUri: string; token?: string }> = [];
  const refreshMarkers: string[] = [];
  const queue = createPhotoQueue({
    storage: memory.storage,
    files: fileMemory.files,
    upload: async ({ imageUri, token }) => {
      uploads.push({ imageUri, token });
      return identifyResponse();
    },
    isQuotaExceeded: (error) => error === "quota_exceeded",
    markAuthenticatedFindRefresh: (token) => refreshMarkers.push(token),
  });
  return { files: fileMemory, memory, queue, refreshMarkers, uploads };
}

describe("offline photo queue ownership", () => {
  test("keeps a guest capture out of A and uploads it without an accidental bearer", async () => {
    const { queue, uploads } = makeQueue();
    const guest = queueScopeForUser(undefined);
    const accountA = queueScopeForUser("account-a");
    const item = await queue.enqueue({ imageUri: "file://guest.jpg", scope: guest });

    await queue.flush({ scope: accountA, token: "bearer-a" });
    expect(uploads).toEqual([]);
    expect((await queue.status(guest)).pending).toHaveLength(1);

    await queue.flush({ scope: guest, token: "must-not-be-forwarded" });
    expect(uploads).toEqual([{ imageUri: item.imageUri, token: undefined }]);
    expect((await queue.status(guest)).pending).toHaveLength(0);
  });

  test("keeps A's job out of B and resumes it when A returns", async () => {
    const { queue, uploads } = makeQueue();
    const accountA = queueScopeForUser("account-a");
    const accountB = queueScopeForUser("account-b");
    const item = await queue.enqueue({ imageUri: "file://a.jpg", scope: accountA });

    await queue.flush({ scope: accountB, token: "bearer-b" });
    expect(uploads).toEqual([]);
    expect((await queue.status(accountA)).pending).toHaveLength(1);
    expect((await queue.status(accountB)).pending).toHaveLength(0);

    await queue.flush({ scope: accountA, token: "new-bearer-a" });
    expect(uploads).toEqual([{ imageUri: item.imageUri, token: "new-bearer-a" }]);
    expect((await queue.status(accountA)).pending).toHaveLength(0);
  });

  test("migrates valid v1 records to fail-closed legacy state without assigning them", async () => {
    const legacy = JSON.stringify({
      version: 1,
      items: [
        {
          id: "old-job",
          imageUri: "file://old.jpg",
          createdAt: 1,
          attempts: 0,
        },
      ],
    });
    const { memory, queue, uploads } = makeQueue(legacy);
    const accountA = queueScopeForUser("account-a");

    expect(await queue.status(accountA)).toEqual({ pending: [], legacyCount: 1, recovery: null });
    await queue.flush({ scope: accountA, token: "bearer-a" });
    expect(uploads).toEqual([]);

    expect(JSON.parse(memory.value(PHOTO_QUEUE_STORAGE_KEY)!)).toEqual({
      version: 3,
      items: [
        {
          id: "old-job",
          imageUri: "file://old.jpg",
          createdAt: 1,
          attempts: 0,
          scope: { kind: "legacy-unscoped" },
        },
      ],
    });
  });

  test("serializes concurrent enqueue, flush, and removal mutations", async () => {
    const memory = memoryStorage();
    const files = memoryFiles();
    const guest = queueScopeForUser(undefined);
    let uploadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      uploadStarted = resolve;
    });
    let continueFlush = true;
    let finishUpload!: () => void;
    const uploaded = new Promise<IdentifyResponse>((resolve) => {
      finishUpload = () => resolve(identifyResponse());
    });
    const queue = createPhotoQueue({
      storage: memory.storage,
      files: files.files,
      upload: async () => {
        uploadStarted();
        return uploaded;
      },
      isQuotaExceeded: () => false,
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        queue.enqueue({ imageUri: `file://initial-${index}.jpg`, scope: guest }),
      ),
    );
    const before = (await queue.status(guest)).pending;
    expect(before).toHaveLength(20);

    const flushing = queue.flush({ scope: guest, shouldContinue: () => continueFlush });
    await started;
    const concurrent = Promise.all([
      queue.enqueue({ imageUri: "file://late.jpg", scope: guest }),
      queue.remove(before[1]!.id, guest),
    ]);
    continueFlush = false;
    finishUpload();
    await Promise.all([flushing, concurrent]);

    const after = (await queue.status(guest)).pending;
    const lateCopy = files.copied.find((copy) => copy.sourceUri === "file://late.jpg")!;
    expect(after).toHaveLength(19);
    expect(after.some((item) => item.imageUri === lateCopy.managedUri)).toBe(true);
    expect(after.some((item) => item.id === before[0]!.id || item.id === before[1]!.id)).toBe(
      false,
    );
  });

  test("stops at quota and leaves later jobs untouched", async () => {
    const memory = memoryStorage();
    const files = memoryFiles();
    const guest = queueScopeForUser(undefined);
    const attempted: string[] = [];
    const queue = createPhotoQueue({
      storage: memory.storage,
      files: files.files,
      upload: async ({ imageUri }) => {
        attempted.push(imageUri);
        throw "quota_exceeded";
      },
      isQuotaExceeded: (error) => error === "quota_exceeded",
    });
    await queue.enqueue({ imageUri: "file://first.jpg", scope: guest });
    await queue.enqueue({ imageUri: "file://second.jpg", scope: guest });

    expect(await queue.flush({ scope: guest })).toMatchObject([
      { ok: false, error: "quota_exceeded" },
    ]);
    expect(attempted).toHaveLength(1);
    expect((await queue.status(guest)).pending).toMatchObject([
      { attempts: 1, lastError: "quota_exceeded" },
      { attempts: 0 },
    ]);
  });

  test("marks only an authenticated successful identify for focused find refresh", async () => {
    const memory = memoryStorage();
    const files = memoryFiles();
    const accountA = queueScopeForUser("account-a");
    const markers: string[] = [];
    const queue = createPhotoQueue({
      storage: memory.storage,
      files: files.files,
      upload: async () => identifyResponse(1),
      isQuotaExceeded: () => false,
      markAuthenticatedFindRefresh: (token) => markers.push(token),
    });
    await queue.enqueue({ imageUri: "file://a.jpg", scope: accountA });

    await queue.flush({ scope: accountA, token: "bearer-a" });
    expect(markers).toEqual(["bearer-a"]);
    expect(memory.writes.map((write) => write.value).join(" ")).not.toContain("bearer-a");
    expect(memory.writes.map((write) => write.value).join(" ")).toContain('"userId":"account-a"');
  });

  test("stops a switched scope before it can upload the next old-scope job", async () => {
    const memory = memoryStorage();
    const files = memoryFiles();
    const accountA = queueScopeForUser("account-a");
    let active = true;
    let calls = 0;
    const queue = createPhotoQueue({
      storage: memory.storage,
      files: files.files,
      upload: async () => {
        calls += 1;
        active = false;
        return identifyResponse();
      },
      isQuotaExceeded: () => false,
    });
    await queue.enqueue({ imageUri: "file://first.jpg", scope: accountA });
    await queue.enqueue({ imageUri: "file://second.jpg", scope: accountA });

    await queue.flush({ scope: accountA, token: "bearer-a", shouldContinue: () => active });
    expect(calls).toBe(1);
    const secondCopy = files.copied.find((copy) => copy.sourceUri === "file://second.jpg")!;
    expect((await queue.status(accountA)).pending).toMatchObject([
      { imageUri: secondCopy.managedUri },
    ]);
  });
});

describe("offline photo queue durable files", () => {
  test("copies the source before persisting, survives source-cache loss, and cleans after upload", async () => {
    let sourceAvailable = true;
    const memory = memoryStorage();
    const files = memoryFiles({ sourceAvailable: () => sourceAvailable });
    const guest = queueScopeForUser(undefined);
    const firstRun = createPhotoQueue({
      storage: memory.storage,
      files: files.files,
      upload: async () => identifyResponse(),
      isQuotaExceeded: () => false,
    });
    const item = await firstRun.enqueue({ imageUri: "file://camera-cache/snap.jpg", scope: guest });
    sourceAvailable = false;
    const uploads: Array<{ imageUri: string; token?: string }> = [];
    const restarted = createPhotoQueue({
      storage: memory.storage,
      files: files.files,
      upload: async ({ imageUri, token }) => {
        uploads.push({ imageUri, token });
        return identifyResponse();
      },
      isQuotaExceeded: () => false,
    });

    expect(item.imageUri).toContain("file://mapvest-private/photo-queue/");
    expect(files.copied).toEqual([
      { sourceUri: "file://camera-cache/snap.jpg", managedUri: item.imageUri },
    ]);
    expect(memory.value(PHOTO_QUEUE_STORAGE_KEY)!).not.toContain("file://camera-cache/snap.jpg");
    await restarted.flush({ scope: guest });
    expect(uploads).toEqual([{ imageUri: item.imageUri, token: undefined }]);
    expect(files.deleted).toEqual([item.imageUri]);
  });

  test("cleans only the managed copy after an explicit discard", async () => {
    const { files, queue } = makeQueue();
    const guest = queueScopeForUser(undefined);
    const item = await queue.enqueue({ imageUri: "file://camera-cache/snap.jpg", scope: guest });

    await queue.remove(item.id, guest);
    expect(files.deleted).toEqual([item.imageUri]);
    expect(files.deleted).not.toContain("file://camera-cache/snap.jpg");
  });

  test("does not claim a photo queued when the private copy or persistence fails", async () => {
    const guest = queueScopeForUser(undefined);
    const copyFailure = makeQueue(null, { files: { copyError: new Error("copy failed") } });
    await expect(
      copyFailure.queue.enqueue({ imageUri: "file://source.jpg", scope: guest }),
    ).rejects.toThrow("copy failed");
    expect((await copyFailure.queue.status(guest)).pending).toHaveLength(0);

    const persistFailure = makeQueue(null, {
      storage: { setFails: (key) => key === PHOTO_QUEUE_STORAGE_KEY },
    });
    await expect(
      persistFailure.queue.enqueue({ imageUri: "file://source.jpg", scope: guest }),
    ).rejects.toThrow("set failed");
    expect(persistFailure.files.deleted).toHaveLength(1);
  });

  test("removes the queue record after upload even if best-effort file cleanup fails", async () => {
    const { queue } = makeQueue(null, { files: { deleteError: new Error("delete failed") } });
    const guest = queueScopeForUser(undefined);
    await queue.enqueue({ imageUri: "file://source.jpg", scope: guest });

    expect(await queue.flush({ scope: guest })).toMatchObject([{ ok: true }]);
    expect((await queue.status(guest)).pending).toHaveLength(0);
  });
});

describe("offline photo queue recovery", () => {
  test("quarantines truncated data, blocks enqueue, and preserves the active key", async () => {
    const raw = '{"version":3,"items":[';
    const { files, memory, queue } = makeQueue(raw);
    const guest = queueScopeForUser(undefined);

    expect((await queue.status(guest)).recovery).toMatchObject({
      kind: "corrupt",
      quarantined: true,
    });
    expect(memory.value(PHOTO_QUEUE_STORAGE_KEY)).toBe(raw);
    expect(memory.value(PHOTO_QUEUE_QUARANTINE_STORAGE_KEY)).toBe(raw);
    await expect(queue.enqueue({ imageUri: "file://source.jpg", scope: guest })).rejects.toThrow(
      "needs recovery",
    );
    expect(files.copied).toEqual([]);
    expect(memory.value(PHOTO_QUEUE_STORAGE_KEY)).toBe(raw);
  });

  test("quarantines a future queue version and malformed records instead of treating either as empty", async () => {
    const future = makeQueue(JSON.stringify({ version: 99, items: [] }));
    const malformed = makeQueue(
      JSON.stringify({
        version: 3,
        items: [{ id: "bad", imageUri: "file://unknown.jpg", createdAt: 1, attempts: 0 }],
      }),
    );
    const guest = queueScopeForUser(undefined);

    expect((await future.queue.status(guest)).recovery).toMatchObject({
      kind: "unsupported-version",
      quarantined: true,
    });
    expect(future.memory.value(PHOTO_QUEUE_QUARANTINE_STORAGE_KEY)).toBe(
      JSON.stringify({ version: 99, items: [] }),
    );
    expect((await malformed.queue.status(guest)).recovery).toMatchObject({
      kind: "malformed",
      quarantined: true,
    });
    expect(malformed.memory.value(PHOTO_QUEUE_STORAGE_KEY)).toContain("file://unknown.jpg");
  });

  test("quarantines an unowned v3 path instead of ever deleting a Camera source URI", async () => {
    const raw = JSON.stringify({
      version: 3,
      items: [
        {
          id: "unsafe",
          imageUri: "file://camera-cache/not-managed.jpg",
          createdAt: 1,
          attempts: 0,
          scope: { kind: "guest" },
        },
      ],
    });
    const { files, queue } = makeQueue(raw);
    const guest = queueScopeForUser(undefined);

    expect((await queue.status(guest)).recovery).toMatchObject({ kind: "malformed" });
    await queue.resetRecovery();
    expect(files.deleted).toEqual([]);
  });

  test("explicit reset clears only the active unreadable queue and retains the quarantine copy", async () => {
    const raw = "not json";
    const { memory, queue } = makeQueue(raw);
    const guest = queueScopeForUser(undefined);

    expect((await queue.status(guest)).recovery).not.toBeNull();
    await queue.resetRecovery();
    expect(memory.value(PHOTO_QUEUE_STORAGE_KEY)).toBeNull();
    expect(memory.value(PHOTO_QUEUE_QUARANTINE_STORAGE_KEY)).toBe(raw);

    await expect(
      queue.enqueue({ imageUri: "file://source.jpg", scope: guest }),
    ).resolves.toMatchObject({
      scope: guest,
    });
  });

  test("fails closed when queue storage or quarantine storage is unavailable", async () => {
    const guest = queueScopeForUser(undefined);
    const unreadableStorage = makeQueue("not json", {
      storage: { setFails: (key) => key === PHOTO_QUEUE_QUARANTINE_STORAGE_KEY },
    });
    expect((await unreadableStorage.queue.status(guest)).recovery).toMatchObject({
      kind: "corrupt",
      quarantined: false,
    });
    await expect(
      unreadableStorage.queue.enqueue({ imageUri: "file://source.jpg", scope: guest }),
    ).rejects.toThrow("set failed");
    expect(unreadableStorage.memory.value(PHOTO_QUEUE_STORAGE_KEY)).toBe("not json");

    const unavailableStorage = makeQueue(null, { storage: { getError: new Error("read failed") } });
    expect((await unavailableStorage.queue.status(guest)).recovery).toMatchObject({
      kind: "storage-unavailable",
      quarantined: false,
    });
    await expect(
      unavailableStorage.queue.enqueue({ imageUri: "file://source.jpg", scope: guest }),
    ).rejects.toThrow("read failed");
    expect(unavailableStorage.files.copied).toEqual([]);

    const resetFailure = makeQueue("not json", {
      storage: { removeError: new Error("remove failed") },
    });
    await resetFailure.queue.status(guest);
    await expect(resetFailure.queue.resetRecovery()).rejects.toThrow("remove failed");
    expect(resetFailure.memory.value(PHOTO_QUEUE_STORAGE_KEY)).toBe("not json");
  });
});
