/**
 * Serializes push registration and account revocation on one installation.
 *
 * Registration is cancellable at the fetch/native boundary. Cancellation is
 * advisory for a request already accepted by the API, so callers still run
 * the identity-based server revocation after the queue drains.
 */
export type PushOperationContext = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

let generation = 0;
let activeAbort: AbortController | null = null;
let queue: Promise<void> = Promise.resolve();

export function isPushOperationCurrent(operationGeneration: number): boolean {
  return operationGeneration === generation;
}

export function runPushOperation<T>(
  operation: (context: PushOperationContext) => Promise<T>,
): Promise<T> {
  const run = queue.then(async () => {
    const operationGeneration = generation;
    const controller = new AbortController();
    activeAbort = controller;
    try {
      return await operation({
        signal: controller.signal,
        isCurrent: () => isPushOperationCurrent(operationGeneration) && !controller.signal.aborted,
      });
    } finally {
      if (activeAbort === controller) activeAbort = null;
    }
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Cancel a registration and wait until its cleanup/fallback path is done. */
export async function cancelPushOperationsAndWait(): Promise<void> {
  generation += 1;
  activeAbort?.abort();
  await queue;
}

/**
 * Serialize a server/native revocation after cancelling registration. Session
 * transitions use this instead of doing cleanup outside the registration queue.
 */
export function runPushRevocation<T>(operation: () => Promise<T>): Promise<T> {
  generation += 1;
  activeAbort?.abort();
  return runPushOperation(async () => operation());
}

/** Test hook. */
export function _resetPushLifecycle(): void {
  generation += 1;
  activeAbort?.abort();
  activeAbort = null;
  queue = Promise.resolve();
}
