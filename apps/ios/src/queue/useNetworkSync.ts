import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type QueueRecovery,
  type QueuedPhoto,
  flushQueue,
  queueScopeForUser,
  queueScopeKey,
  queueStatus,
  resetUnrecoverableQueue,
  subscribeToQueue,
} from "./photoQueue";

type ScopedQueueState = {
  scopeKey: string;
  pending: QueuedPhoto[];
  legacyCount: number;
  recovery: QueueRecovery | null;
};

/**
 * Watches connectivity via NetInfo; when the device comes back online it
 * drains the offline photo queue. Also exposes the current queue for
 * on-screen indicators.
 */
export function useNetworkSync(opts: { token?: string | null; userId?: string | null }): {
  online: boolean;
  pending: QueuedPhoto[];
  legacyCount: number;
  recovery: QueueRecovery | null;
  flushNow: () => Promise<void>;
  resetRecovery: () => Promise<void>;
} {
  const [online, setOnline] = useState(true);
  const scope = useMemo(() => queueScopeForUser(opts.userId), [opts.userId]);
  const scopeKey = queueScopeKey(scope);
  const [queueState, setQueueState] = useState<ScopedQueueState>(() => ({
    scopeKey,
    pending: [],
    legacyCount: 0,
    recovery: null,
  }));
  const activeScopeKey = useRef(scopeKey);
  // Update during render so an async completion from the prior account cannot
  // briefly replace this account's pending count before effect cleanup runs.
  activeScopeKey.current = scopeKey;
  const flushing = useRef(new Map<string, AbortController>());
  const retryAfterAbort = useRef(new Set<string>());
  const flushNowRef = useRef<(() => Promise<void>) | null>(null);
  const token = opts.token;

  const refresh = useCallback(async () => {
    const status = await queueStatus(scope);
    if (activeScopeKey.current !== scopeKey) return;
    setQueueState({ scopeKey, ...status });
  }, [scope, scopeKey]);

  const resetRecovery = useCallback(async () => {
    await resetUnrecoverableQueue();
    await refresh();
  }, [refresh]);

  const flushNow = useCallback(async () => {
    const existing = flushing.current.get(scopeKey);
    if (existing) {
      // A→B→A can revisit A while its first request is still unwinding from
      // the abort. Ask the current callback (with the current token) to retry
      // after that old controller releases the scope slot.
      if (existing.signal.aborted) retryAfterAbort.current.add(scopeKey);
      return;
    }
    const controller = new AbortController();
    flushing.current.set(scopeKey, controller);
    try {
      await flushQueue({
        scope,
        token: token ?? undefined,
        signal: controller.signal,
        shouldContinue: () => !controller.signal.aborted && activeScopeKey.current === scopeKey,
      });
      if (activeScopeKey.current === scopeKey) await refresh();
    } finally {
      if (flushing.current.get(scopeKey) === controller) {
        flushing.current.delete(scopeKey);
        if (retryAfterAbort.current.delete(scopeKey) && activeScopeKey.current === scopeKey) {
          void flushNowRef.current?.();
        }
      }
    }
  }, [refresh, scope, scopeKey, token]);
  flushNowRef.current = flushNow;

  useEffect(
    () => () => {
      // Scope transitions and unmounts abort old requests. The queue keeps the
      // old item for a later matching session rather than applying stale UI.
      flushing.current.get(scopeKey)?.abort();
    },
    [scopeKey],
  );

  useEffect(() => subscribeToQueue(() => void refresh()), [refresh]);

  useEffect(() => {
    void refresh();
    const unsub = NetInfo.addEventListener((s) => {
      const isOnline = !!s.isConnected && s.isInternetReachable !== false;
      setOnline(isOnline);
      if (isOnline) void flushNow();
    });
    return unsub;
  }, [flushNow, refresh]);

  useEffect(() => {
    if (online) void flushNow();
  }, [flushNow, online]);

  // The state for A must never paint during B's render, even for one frame
  // before the async status read completes.
  const visibleQueue = queueState.scopeKey === scopeKey ? queueState : null;
  return {
    online,
    pending: visibleQueue?.pending ?? [],
    legacyCount: visibleQueue?.legacyCount ?? 0,
    recovery: visibleQueue?.recovery ?? null,
    flushNow,
    resetRecovery,
  };
}
