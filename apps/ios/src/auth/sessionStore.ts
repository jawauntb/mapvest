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
  let pendingMutation: Promise<void> | null = null;

  function trackMutation(mutation: Promise<void>): void {
    const settled = mutation.then(
      () => undefined,
      () => undefined,
    );
    pendingMutation = settled;
    void settled.then(() => {
      if (pendingMutation === settled) pendingMutation = null;
    });
  }

  async function waitForPendingMutation(): Promise<boolean> {
    const pending = pendingMutation;
    if (!pending) return true;
    try {
      await withTimeout(pending, timeoutMs, "SecureStore mutation still pending");
      return true;
    } catch {
      return false;
    }
  }

  async function read(): Promise<StoredSessionRead> {
    // A native write that outlived its caller's timeout must settle before a
    // read can be used to declare the device clean or guest.
    if (!(await waitForPendingMutation())) {
      return { raw: null, timedOut: true, readable: false };
    }
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
    if (!(await waitForPendingMutation())) {
      throw new SessionPersistenceError("write");
    }
    let pendingWrite: Promise<void>;
    try {
      pendingWrite = storage.setItem(raw);
    } catch {
      throw new SessionPersistenceError("write");
    }
    trackMutation(pendingWrite);
    try {
      await withTimeout(pendingWrite, timeoutMs, "SecureStore session write timed out");
    } catch {
      throw new SessionPersistenceError("write");
    }
    const verify = await read();
    if (!verify.readable || verify.timedOut || verify.raw !== raw) {
      throw new SessionPersistenceError("write");
    }
  }

  async function remove(): Promise<void> {
    if (!(await waitForPendingMutation())) {
      throw new SessionPersistenceError("delete");
    }
    let pendingDelete: Promise<void>;
    try {
      pendingDelete = storage.deleteItem();
      trackMutation(pendingDelete);
      await withTimeout(pendingDelete, timeoutMs, "SecureStore session delete timed out");
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
