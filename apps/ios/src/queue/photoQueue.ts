// Offline photo queue. Persists pending capture jobs to AsyncStorage; a
// network listener drains the queue whenever connectivity returns.
//
// Storage shape:
//   { version: 1, items: QueuedPhoto[] }

import { identifyPhoto } from "@/api/client";
import { isQuotaExceeded } from "@/api/errors";
import type { IdentifyResponse, LatLng } from "@/api/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "mapvest.photoQueue.v1";

export type QueuedPhoto = {
  id: string;
  imageUri: string;
  location?: LatLng;
  createdAt: number;
  attempts: number;
  lastError?: string;
};

type QueueFile = { version: 1; items: QueuedPhoto[] };

async function readAll(): Promise<QueuedPhoto[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as QueueFile;
    return parsed?.items ?? [];
  } catch {
    return [];
  }
}

async function writeAll(items: QueuedPhoto[]): Promise<void> {
  const payload: QueueFile = { version: 1, items };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export async function listQueue(): Promise<QueuedPhoto[]> {
  return readAll();
}

export async function enqueuePhoto(input: {
  imageUri: string;
  location?: LatLng;
}): Promise<QueuedPhoto> {
  const items = await readAll();
  const item: QueuedPhoto = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    imageUri: input.imageUri,
    location: input.location,
    createdAt: Date.now(),
    attempts: 0,
  };
  items.push(item);
  await writeAll(items);
  return item;
}

export async function removeFromQueue(id: string): Promise<void> {
  const items = await readAll();
  await writeAll(items.filter((i) => i.id !== id));
}

export async function markAttempt(id: string, error?: string): Promise<void> {
  const items = await readAll();
  const next = items.map((i) =>
    i.id === id ? { ...i, attempts: i.attempts + 1, lastError: error } : i,
  );
  await writeAll(next);
}

/**
 * Attempt to upload every queued photo. Returns per-item results.
 * On success the item is removed from the queue; on failure attempts++ and
 * the item stays queued for the next flush.
 */
export async function flushQueue(
  opts: { token?: string } = {},
): Promise<
  Array<
    { id: string; ok: true; response: IdentifyResponse } | { id: string; ok: false; error: string }
  >
> {
  const items = await readAll();
  const out: Array<
    { id: string; ok: true; response: IdentifyResponse } | { id: string; ok: false; error: string }
  > = [];
  for (const item of items) {
    try {
      const response = await identifyPhoto(
        { imageUri: item.imageUri, location: item.location },
        { token: opts.token },
      );
      await removeFromQueue(item.id);
      out.push({ id: item.id, ok: true, response });
    } catch (err) {
      if (isQuotaExceeded(err)) {
        await markAttempt(item.id, "quota_exceeded");
        out.push({ id: item.id, ok: false, error: "quota_exceeded" });
        break;
      }
      const msg = err instanceof Error ? err.message : String(err);
      await markAttempt(item.id, msg);
      out.push({ id: item.id, ok: false, error: msg });
    }
  }
  return out;
}
