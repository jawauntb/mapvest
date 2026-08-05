import NetInfo from "@react-native-community/netinfo";
import { useEffect, useRef, useState } from "react";
import { flushQueue, listQueue, type QueuedPhoto } from "./photoQueue";

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

  const refresh = async () => {
    setPending(await listQueue());
  };

  const flushNow = async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      await flushQueue({ token: opts.token ?? undefined });
      await refresh();
    } finally {
      flushing.current = false;
    }
  };

  useEffect(() => {
    refresh();
    const unsub = NetInfo.addEventListener((s) => {
      const isOnline = !!s.isConnected && s.isInternetReachable !== false;
      setOnline(isOnline);
      if (isOnline) void flushNow();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.token]);

  return { online, pending, flushNow };
}
