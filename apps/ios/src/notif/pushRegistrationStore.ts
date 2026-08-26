export type PushTokenIdStorage = {
  set: (id: string) => Promise<void>;
  delete: () => Promise<void>;
};

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * SecureStore writes cannot be cancelled. Keep a barrier per storage adapter
 * so a timed-out write cannot race a later account's delete or replacement
 * write. The barrier resolves only when the native operation itself settles,
 * not when the caller's timeout expires.
 */
const pendingMutations = new WeakMap<PushTokenIdStorage, Promise<void>>();

function trackMutation(storage: PushTokenIdStorage, mutation: Promise<void>): void {
  const settled = mutation.then(
    () => undefined,
    () => undefined,
  );
  pendingMutations.set(storage, settled);
  void settled.then(() => {
    if (pendingMutations.get(storage) === settled) pendingMutations.delete(storage);
  });
}

export async function waitForPushTokenIdMutation(
  storage: PushTokenIdStorage,
  timeoutMs = 800,
): Promise<boolean> {
  const pending = pendingMutations.get(storage);
  if (!pending) return true;
  try {
    await withTimeout(pending, timeoutMs, "SecureStore mutation still pending");
    return true;
  } catch {
    return false;
  }
}

export async function deletePersistedPushTokenId(
  storage: PushTokenIdStorage,
  timeoutMs = 800,
): Promise<void> {
  if (!(await waitForPushTokenIdMutation(storage, timeoutMs))) {
    throw new Error("SecureStore mutation still pending");
  }
  const deletion = storage.delete();
  trackMutation(storage, deletion);
  await withTimeout(deletion, timeoutMs, "SecureStore delete timed out");
}

/**
 * Persist a server claimant id without allowing a late timed-out native
 * completion to resurrect the id after rollback or account transition.
 */
export async function persistPushTokenId(
  storage: PushTokenIdStorage,
  id: string,
  isCurrent: () => boolean,
  timeoutMs = 800,
): Promise<boolean> {
  if (!(await waitForPushTokenIdMutation(storage, timeoutMs))) return false;

  let write: Promise<void>;
  try {
    write = storage.set(id);
  } catch {
    return false;
  }
  trackMutation(storage, write);
  try {
    await withTimeout(write, timeoutMs, "SecureStore write timed out");
    if (isCurrent()) return true;
    // The write completed, but the account transition won the race. Delete
    // it before another generation can persist a replacement id.
    await deletePersistedPushTokenId(storage, timeoutMs);
    return false;
  } catch {
    return false;
  }
}
