import {
  type CleanupTombstone,
  SessionPersistenceError,
  type StoredSession,
  type StoredSessionEnvelope,
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
    await writeRaw(JSON.stringify(stored), "write");
  }

  async function writeRaw(raw: string, operation: "write" | "delete"): Promise<void> {
    if (!(await waitForPendingMutation())) {
      throw new SessionPersistenceError(operation);
    }
    let pendingWrite: Promise<void>;
    try {
      pendingWrite = storage.setItem(raw);
    } catch {
      throw new SessionPersistenceError(operation);
    }
    trackMutation(pendingWrite);
    try {
      await withTimeout(pendingWrite, timeoutMs, "SecureStore session write timed out");
    } catch {
      throw new SessionPersistenceError(operation);
    }
    const verify = await read();
    if (!verify.readable || verify.timedOut || verify.raw !== raw) {
      throw new SessionPersistenceError(operation);
    }
  }

  /**
   * Journal a cleanup request in the same SecureStore value as the bearer.
   * A force-quit therefore boots into cleanup-only mode instead of treating a
   * still-present active session as authenticated UI.
   */
  async function writeCleanupTombstone(tombstone: CleanupTombstone): Promise<void> {
    const existing = await read();
    if (!existing.readable || existing.timedOut) {
      throw new SessionPersistenceError("write");
    }
    let envelope: StoredSessionEnvelope = { cleanup: tombstone } as StoredSessionEnvelope;
    if (existing.raw) {
      try {
        const parsed: unknown = JSON.parse(existing.raw);
        if (parsed && typeof parsed === "object") {
          const candidate = parsed as Partial<StoredSessionEnvelope>;
          envelope = {
            ...(candidate.session && candidate.user
              ? { session: candidate.session, user: candidate.user }
              : tombstone.session && tombstone.user
                ? { session: tombstone.session, user: tombstone.user }
                : {}),
            cleanup: tombstone,
          } as StoredSessionEnvelope;
        }
      } catch {
        // Replace malformed active data with a valid cleanup journal when the
        // request still carries enough session information to retry.
      }
    }
    if (!envelope.session && tombstone.session && tombstone.user) {
      envelope = { session: tombstone.session, user: tombstone.user, cleanup: tombstone };
    }
    await writeRaw(JSON.stringify(envelope), "write");
  }

  /**
   * The normal delete removes the whole envelope. This method is intentionally
   * conservative: a cleanup marker is never stripped while session data
   * remains in SecureStore.
   */
  async function clearCleanupTombstone(): Promise<void> {
    const current = await read();
    if (!current.readable || current.timedOut) throw new SessionPersistenceError("delete");
    if (!current.raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(current.raw);
    } catch {
      throw new SessionPersistenceError("delete");
    }
    if (!parsed || typeof parsed !== "object" || !("cleanup" in parsed)) return;
    const candidate = parsed as Partial<StoredSessionEnvelope>;
    if (candidate.session || candidate.user) {
      throw new SessionPersistenceError("delete");
    }
    await remove();
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

  return { read, write, remove, writeCleanupTombstone, clearCleanupTombstone };
}
