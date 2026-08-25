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
 * Persist a server claimant id without allowing a late timed-out native
 * completion to resurrect the id after rollback or account transition.
 */
export async function persistPushTokenId(
  storage: PushTokenIdStorage,
  id: string,
  isCurrent: () => boolean,
  timeoutMs = 800,
): Promise<boolean> {
  let lateWriteNeedsDelete = false;
  const write = storage.set(id);
  void write.then(
    () => {
      if (lateWriteNeedsDelete || !isCurrent()) void storage.delete().catch(() => undefined);
    },
    () => undefined,
  );
  try {
    await withTimeout(write, timeoutMs, "SecureStore write timed out");
    return true;
  } catch {
    lateWriteNeedsDelete = true;
    return false;
  }
}
