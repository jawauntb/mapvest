import {
  SessionPersistenceError,
  type StoredSession,
  type StoredSessionRead,
} from "./sessionController";

export type SessionStorage = {
  getItem: () => Promise<string | null>;
  setItem: (raw: string) => Promise<void>;
  deleteItem: () => Promise<void>;
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

export function createSessionStore(storage: SessionStorage, timeoutMs = 800) {
  function read(): Promise<StoredSessionRead> {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        resolve({ raw: null, timedOut: true, readable: false });
      }, timeoutMs);
      storage
        .getItem()
        .then((raw) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ raw, timedOut: false, readable: true });
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ raw: null, timedOut: false, readable: false });
        });
    });
  }

  async function write(stored: StoredSession): Promise<void> {
    const raw = JSON.stringify(stored);
    let lateWriteNeedsDelete = false;
    const pendingWrite = storage.setItem(raw);
    // Native SecureStore cannot be cancelled. If the timeout wins, a late
    // native completion must delete its value after any controller rollback.
    void pendingWrite.then(
      () => {
        if (lateWriteNeedsDelete) void storage.deleteItem().catch(() => undefined);
      },
      () => undefined,
    );
    try {
      await withTimeout(pendingWrite, timeoutMs, "SecureStore session write timed out");
    } catch {
      lateWriteNeedsDelete = true;
      throw new SessionPersistenceError("write");
    }
    const verify = await read();
    if (!verify.readable || verify.timedOut || verify.raw !== raw) {
      throw new SessionPersistenceError("write");
    }
  }

  async function remove(): Promise<void> {
    try {
      await withTimeout(storage.deleteItem(), timeoutMs, "SecureStore session delete timed out");
      const verify = await read();
      if (!verify.readable || verify.timedOut || verify.raw !== null) {
        throw new Error("SecureStore session delete could not be verified");
      }
    } catch {
      throw new SessionPersistenceError("delete");
    }
  }

  return { read, write, remove };
}
