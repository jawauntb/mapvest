import { fetchDex, fetchQuests } from "@/api/client";
import { type Find, listFinds } from "@/api/finds";
import type { DexResponse, NearbyItem, QuestsResponse } from "@/api/types";
import { useSession } from "@/auth/session";
import { findsQueryKey } from "@/finds/queryKeys";
import type { LocationContextState } from "@/location/locationContext";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { synchronizeWidgetDiscovery } from "./widgetDiscoverySyncCore";
import { personalizeWidgetDiscoverySnapshot } from "./widgetSnapshot";
import {
  activateWidgetSnapshotSession,
  activeWidgetSnapshotScope,
  readWidgetDiscoverySnapshot,
  writeWidgetDiscoverySnapshot,
} from "./widgetSnapshotStorage";

type Origin = { lat: number; lng: number };
type WidgetSession = { accountId: string | null; authGeneration: number };

const completedSyncs = new Map<string, number>();
const inFlightSyncs = new Map<string, { revision: number; task: Promise<boolean> }>();
const latestSessionRevision = new Map<string, number>();
const lastSessionSync = new Map<string, number>();
let nextSyncRevision = 0;
const SYNC_DEDUPE_MS = 30_000;
const MAX_COMPLETED_SYNCS = 64;

function sessionSyncKey(session: WidgetSession): string {
  return `${session.authGeneration}:${session.accountId ?? "guest"}`;
}

function beginSessionSync(sessionKey: string): number {
  const revision = ++nextSyncRevision;
  latestSessionRevision.set(sessionKey, revision);
  return revision;
}

type SynchronizeArgs = {
  session: WidgetSession;
  token?: string;
  context: LocationContextState;
  origin: Origin;
  items: NearbyItem[];
  finds?: Find[];
};

function synchronizeOnce(
  args: SynchronizeArgs,
  key: string,
  sessionKey: string,
  revision: number,
  loadPersonalization: (signal: AbortSignal) => Promise<{
    finds: Find[];
    dex: DexResponse;
    quests: QuestsResponse;
  }>,
): Promise<boolean> {
  const lastCompleted = completedSyncs.get(key) ?? 0;
  if (Date.now() - lastCompleted < SYNC_DEDUPE_MS) return Promise.resolve(true);
  const existing = inFlightSyncs.get(key);
  if (existing?.revision === revision) return existing.task;
  const task = synchronizeWidgetDiscovery(args, {
    activate: activateWidgetSnapshotSession,
    activeScope: activeWidgetSnapshotScope,
    loadPersonalization,
    write: (snapshot, session) => writeWidgetDiscoverySnapshot(snapshot, session),
    isLatest: () => latestSessionRevision.get(sessionKey) === revision,
  })
    .then((success) => {
      if (success) {
        lastSessionSync.delete(sessionKey);
        lastSessionSync.set(sessionKey, Date.now());
        while (lastSessionSync.size > MAX_COMPLETED_SYNCS) {
          const oldestSession = lastSessionSync.keys().next().value;
          if (oldestSession === undefined) break;
          lastSessionSync.delete(oldestSession);
        }
        completedSyncs.delete(key);
        completedSyncs.set(key, Date.now());
        while (completedSyncs.size > MAX_COMPLETED_SYNCS) {
          const oldest = completedSyncs.keys().next().value;
          if (oldest === undefined) break;
          completedSyncs.delete(oldest);
        }
      }
      return success;
    })
    .finally(() => {
      if (inFlightSyncs.get(key)?.revision === revision) inFlightSyncs.delete(key);
    });
  inFlightSyncs.set(key, { revision, task });
  return task;
}

export function useWidgetDiscoverySync(args: {
  context: LocationContextState;
  origin: Origin;
  items: NearbyItem[];
  settled: boolean;
  enabled?: boolean;
  finds?: Find[];
}): void {
  const { session, user, authGeneration } = useSession();
  const queryClient = useQueryClient();
  const key = useMemo(() => {
    const tickers = args.items
      .map(
        (item) =>
          item.investable?.brand.ticker?.symbol ?? item.investable?.comparables?.[0]?.ticker ?? "",
      )
      .filter(Boolean)
      .slice(0, 8)
      .join(",");
    const finds = (args.finds ?? [])
      .map((find) => find.ticker ?? find.comparable ?? "")
      .filter(Boolean)
      .join(",");
    return [
      authGeneration,
      user?.id ?? "guest",
      args.context.kind,
      args.origin.lat.toFixed(3),
      args.origin.lng.toFixed(3),
      tickers,
      finds,
    ].join(":");
  }, [
    args.context.kind,
    args.finds,
    args.items,
    args.origin.lat,
    args.origin.lng,
    authGeneration,
    user?.id,
  ]);

  useEffect(() => {
    if (args.enabled === false || !args.settled) return;
    const widgetSession = { accountId: user?.id ?? null, authGeneration };
    const sessionKey = sessionSyncKey(widgetSession);
    const revision = beginSessionSync(sessionKey);
    const lastCompleted = lastSessionSync.get(sessionKey) ?? 0;
    const delayMs = Math.max(0, SYNC_DEDUPE_MS - (Date.now() - lastCompleted));
    const timer = setTimeout(() => {
      void synchronizeOnce(
        {
          session: widgetSession,
          token: session?.token,
          context: args.context,
          origin: args.origin,
          items: args.items,
          finds: args.finds,
        },
        key,
        sessionKey,
        revision,
        async (signal) => {
          if (!session?.token) throw new Error("Widget personalization requires a session");
          const [findResult, dex, quests] = await Promise.all([
            args.finds
              ? Promise.resolve({ finds: args.finds })
              : queryClient.fetchQuery({
                  queryKey: findsQueryKey(session.token, 200),
                  queryFn: () => listFinds({ token: session.token, signal }, 200),
                  staleTime: 60_000,
                }),
            queryClient.fetchQuery({
              queryKey: ["dex", session.token],
              queryFn: () => fetchDex({ token: session.token, signal }),
              staleTime: 5 * 60_000,
            }),
            queryClient.fetchQuery({
              queryKey: ["quests", session.token],
              queryFn: () => fetchQuests({ token: session.token, signal }),
              staleTime: 60_000,
            }),
          ]);
          return { finds: findResult.finds, dex, quests };
        },
      );
    }, delayMs);
    return () => {
      clearTimeout(timer);
      if (latestSessionRevision.get(sessionKey) === revision) {
        latestSessionRevision.delete(sessionKey);
      }
    };
  }, [
    args.context,
    args.enabled,
    args.finds,
    args.items,
    args.origin,
    args.settled,
    authGeneration,
    key,
    queryClient,
    session?.token,
    user?.id,
  ]);
}

export async function refreshWidgetDiscoveryPersonalization(args: {
  accountId: string;
  authGeneration: number;
  finds: Find[];
  quests: QuestsResponse;
  dex: DexResponse;
}): Promise<boolean> {
  const session = { accountId: args.accountId, authGeneration: args.authGeneration };
  const scope = await activeWidgetSnapshotScope(session);
  const current = await readWidgetDiscoverySnapshot(session);
  if (!scope || !current) return false;
  const personalized = personalizeWidgetDiscoverySnapshot({
    snapshot: current,
    scope,
    finds: args.finds,
    quests: args.quests.quests,
    dex: args.dex,
  });
  return personalized
    ? writeWidgetDiscoverySnapshot(personalized, session, {
        expectedSnapshotId: current.snapshotId,
      })
    : false;
}
