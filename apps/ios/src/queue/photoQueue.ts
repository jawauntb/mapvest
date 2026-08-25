// React Native adapter for the account-isolated offline photo queue.
// Tokens are passed only to a live identify request; persisted records contain
// an ownership scope (guest or stable user id), never a bearer token.

import { identifyPhoto } from "@/api/client";
import { isQuotaExceeded } from "@/api/errors";
import { markFindRefreshPending } from "@/finds/focusRefresh";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { photoQueueFiles } from "./photoQueueFiles";
import {
  type FlushQueueOptions,
  type FlushResult,
  type QueueRecovery,
  type QueueScope,
  type QueueStatus,
  type QueuedPhoto,
  createPhotoQueue,
} from "./photoQueueStore";

export {
  PHOTO_QUEUE_QUARANTINE_STORAGE_KEY,
  PHOTO_QUEUE_STORAGE_KEY,
  type FlushQueueOptions,
  type FlushResult,
  type QueueRecovery,
  type QueueScope,
  type QueueStatus,
  type QueuedPhoto,
  queueScopeForUser,
  queueScopeKey,
} from "./photoQueueStore";

const queue = createPhotoQueue({
  storage: AsyncStorage,
  files: photoQueueFiles,
  upload: (input) =>
    identifyPhoto(
      { imageUri: input.imageUri, location: input.location },
      { token: input.token, signal: input.signal },
    ),
  isQuotaExceeded,
  markAuthenticatedFindRefresh: markFindRefreshPending,
});

export function listQueue(scope: QueueScope): Promise<QueuedPhoto[]> {
  return queue.status(scope).then((result) => result.pending);
}

export function queueStatus(scope: QueueScope): Promise<QueueStatus> {
  return queue.status(scope);
}

/** Explicitly discard unreadable active queue data; its quarantine copy remains private. */
export function resetUnrecoverableQueue(): Promise<void> {
  return queue.resetRecovery();
}

export function enqueuePhoto(input: {
  imageUri: string;
  location?: import("@/api/types").LatLng;
  scope: QueueScope;
}): Promise<QueuedPhoto> {
  return queue.enqueue(input);
}

export function removeFromQueue(id: string, scope: QueueScope): Promise<void> {
  return queue.remove(id, scope);
}

export function markAttempt(id: string, scope: QueueScope, error?: string): Promise<void> {
  return queue.markAttempt(id, scope, error);
}

export function flushQueue(options: FlushQueueOptions): Promise<FlushResult[]> {
  return queue.flush(options);
}

export function subscribeToQueue(listener: () => void): () => void {
  return queue.subscribe(listener);
}
