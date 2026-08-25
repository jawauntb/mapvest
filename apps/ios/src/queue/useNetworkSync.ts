import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useRef, useState } from "react";
import { type QueuedPhoto, flushQueue, listQueue } from "./photoQueue";

/**
 * Watches connectivity via NetInfo; when the device comes back online it
 * drains the offline photo queue. Also exposes the current queue for
 * on-screen indicators.
 */
export function useNetworkSync(opts: { token?: string | null }): {
  online: boolean;
  pending: QueuedPhoto[];
  flushNow: () => Promise<void>;
} {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<QueuedPhoto[]>([]);
  const flushing = useRef(false);
  const token = opts.token;

  const refresh = useCallback(async () => {
    setPending(await listQueue());
  }, []);

  const flushNow = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      await flushQueue({ token: token ?? undefined });
      await refresh();
    } finally {
      flushing.current = false;
    }
  }, [refresh, token]);

  useEffect(() => {
    refresh();
    const unsub = NetInfo.addEventListener((s) => {
      const isOnline = !!s.isConnected && s.isInternetReachable !== false;
      setOnline(isOnline);
      if (isOnline) void flushNow();
    });
    return unsub;
  }, [flushNow, refresh]);

  return { online, pending, flushNow };
}
