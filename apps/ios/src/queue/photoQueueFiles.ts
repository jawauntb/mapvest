import * as FileSystem from "expo-file-system/legacy";
import type { QueueFileAdapter } from "./photoQueueStore";

const QUEUE_DIRECTORY_NAME = "mapvest-photo-queue/";

function queueDirectory(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error("Private offline photo storage is unavailable on this device");
  }
  return `${FileSystem.documentDirectory}${QUEUE_DIRECTORY_NAME}`;
}

function queueDestination(itemId: string): string {
  return `${queueDirectory()}${encodeURIComponent(itemId)}.jpg`;
}

function isManagedQueueUri(uri: string): boolean {
  try {
    const directory = queueDirectory();
    if (!uri.startsWith(directory)) return false;
    const filename = uri.slice(directory.length);
    // Generated ids are URI-encoded and filenames never contain a path
    // separator. Rejecting any nested/traversal-looking path keeps deletion
    // confined to this exact private directory.
    return /^[A-Za-z0-9%._-]+\.jpg$/.test(filename);
  } catch {
    return false;
  }
}

/** Only this adapter may delete files, and only from its private queue folder. */
export const photoQueueFiles: QueueFileAdapter = {
  isManagedUri: isManagedQueueUri,

  async copy(sourceUri, itemId) {
    const destination = queueDestination(itemId);
    await FileSystem.makeDirectoryAsync(queueDirectory(), { intermediates: true });
    await FileSystem.copyAsync({ from: sourceUri, to: destination });
    return destination;
  },

  async delete(managedUri) {
    if (!isManagedQueueUri(managedUri)) {
      throw new Error("Refusing to delete a photo outside Mapvest's private queue folder");
    }
    await FileSystem.deleteAsync(managedUri, { idempotent: true });
  },
};
