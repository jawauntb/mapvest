import { describe, expect, test } from "bun:test";
import type { IdentifyResponse } from "@/api/types";
import {
  PHOTO_QUEUE_STORAGE_KEY,
  type QueueStorage,
  createPhotoQueue,
  queueScopeForUser,
} from "./photoQueueStore";

function identifyResponse(investableCount = 0): IdentifyResponse {
  return {
    investables: Array.from({ length: investableCount }, () => ({})),
  } as unknown as IdentifyResponse;
}

function memoryStorage(initial: string | null = null): {
  storage: QueueStorage;
  snapshot: () => string | null;
  writes: string[];
} {
  let value = initial;
  const writes: string[] = [];
  return {
    storage: {
      async getItem(key) {
        expect(key).toBe(PHOTO_QUEUE_STORAGE_KEY);
        return value;
      },
      async setItem(key, next) {
        expect(key).toBe(PHOTO_QUEUE_STORAGE_KEY);
        value = next;
        writes.push(next);
      },
    },
    snapshot: () => value,
    writes,
  };
}

function makeQueue(initial: string | null = null) {
  const memory = memoryStorage(initial);
  const uploads: Array<{ imageUri: string; token?: string }> = [];
  const refreshMarkers: string[] = [];
  const queue = createPhotoQueue({
    storage: memory.storage,
    upload: async ({ imageUri, token }) => {
      uploads.push({ imageUri, token });
      return identifyResponse();
    },
    isQuotaExceeded: (error) => error === "quota_exceeded",
    markAuthenticatedFindRefresh: (token) => refreshMarkers.push(token),
  });
  return { memory, queue, refreshMarkers, uploads };
}

describe("offline photo queue ownership", () => {
  test("keeps a guest capture out of A and uploads it without an accidental bearer", async () => {
    const { queue, uploads } = makeQueue();
    const guest = queueScopeForUser(undefined);
    const accountA = queueScopeForUser("account-a");
    await queue.enqueue({ imageUri: "file://guest.jpg", scope: guest });

    await queue.flush({ scope: accountA, token: "bearer-a" });
    expect(uploads).toEqual([]);
    expect((await queue.status(guest)).pending).toHaveLength(1);

    await queue.flush({ scope: guest, token: "must-not-be-forwarded" });
    expect(uploads).toEqual([{ imageUri: "file://guest.jpg", token: undefined }]);
    expect((await queue.status(guest)).pending).toHaveLength(0);
  });

  test("keeps A's job out of B and resumes it when A returns", async () => {
    const { queue, uploads } = makeQueue();
    const accountA = queueScopeForUser("account-a");
    const accountB = queueScopeForUser("account-b");
    await queue.enqueue({ imageUri: "file://a.jpg", scope: accountA });

    await queue.flush({ scope: accountB, token: "bearer-b" });
    expect(uploads).toEqual([]);
    expect((await queue.status(accountA)).pending).toHaveLength(1);
    expect((await queue.status(accountB)).pending).toHaveLength(0);

    await queue.flush({ scope: accountA, token: "new-bearer-a" });
    expect(uploads).toEqual([{ imageUri: "file://a.jpg", token: "new-bearer-a" }]);
    expect((await queue.status(accountA)).pending).toHaveLength(0);
  });

  test("migrates v1 records to fail-closed legacy state without assigning them", async () => {
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

    expect(await queue.status(accountA)).toEqual({ pending: [], legacyCount: 1 });
    await queue.flush({ scope: accountA, token: "bearer-a" });
    expect(uploads).toEqual([]);

    expect(JSON.parse(memory.snapshot()!)).toEqual({
      version: 2,
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
    expect(after).toHaveLength(19);
    expect(after.some((item) => item.imageUri === "file://late.jpg")).toBe(true);
    expect(after.some((item) => item.id === before[0]!.id || item.id === before[1]!.id)).toBe(
      false,
    );
  });

  test("stops at quota and leaves later jobs untouched", async () => {
    const memory = memoryStorage();
    const guest = queueScopeForUser(undefined);
    const attempted: string[] = [];
    const queue = createPhotoQueue({
      storage: memory.storage,
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
    expect(attempted).toEqual(["file://first.jpg"]);
    expect((await queue.status(guest)).pending).toMatchObject([
      { imageUri: "file://first.jpg", attempts: 1, lastError: "quota_exceeded" },
      { imageUri: "file://second.jpg", attempts: 0 },
    ]);
  });

  test("marks only an authenticated successful identify for focused find refresh", async () => {
    const memory = memoryStorage();
    const accountA = queueScopeForUser("account-a");
    const markers: string[] = [];
    const queue = createPhotoQueue({
      storage: memory.storage,
      upload: async () => identifyResponse(1),
      isQuotaExceeded: () => false,
      markAuthenticatedFindRefresh: (token) => markers.push(token),
    });
    await queue.enqueue({ imageUri: "file://a.jpg", scope: accountA });

    await queue.flush({ scope: accountA, token: "bearer-a" });
    expect(markers).toEqual(["bearer-a"]);
    expect(memory.writes.join(" ")).not.toContain("bearer-a");
    expect(memory.writes.join(" ")).toContain('"userId":"account-a"');
  });

  test("stops a switched scope before it can upload the next old-scope job", async () => {
    const memory = memoryStorage();
    const accountA = queueScopeForUser("account-a");
    let active = true;
    let calls = 0;
    const queue = createPhotoQueue({
      storage: memory.storage,
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
    expect((await queue.status(accountA)).pending).toMatchObject([
      { imageUri: "file://second.jpg" },
    ]);
  });
});
