import type { Find } from "@/api/finds";
import type { DexResponse, NearbyItem, QuestsResponse, Source } from "@/api/types";
import type { LocationContextState } from "@/location/locationContext";
import { locationContextLabel } from "@/location/locationContext";
import {
  type WidgetDiscoverySnapshotV1,
  type WidgetNearbyCandidate,
  type WidgetSnapshotLocation,
  type WidgetSnapshotScope,
  composeWidgetDiscoverySnapshot,
} from "./widgetSnapshot";
import type { WidgetSnapshotSession } from "./widgetSnapshotStore";

export type WidgetDiscoveryOrigin = { lat: number; lng: number };

export type WidgetPersonalization = {
  finds: Find[];
  dex: DexResponse;
  quests: QuestsResponse;
};

export type WidgetDiscoverySyncArgs = {
  session: WidgetSnapshotSession;
  token?: string;
  context: LocationContextState;
  origin: WidgetDiscoveryOrigin;
  items: NearbyItem[];
};

export type WidgetDiscoverySyncDependencies = {
  activate: (session: WidgetSnapshotSession) => Promise<WidgetSnapshotScope | null>;
  activeScope: (session: WidgetSnapshotSession) => Promise<WidgetSnapshotScope | null>;
  loadPersonalization: (signal: AbortSignal) => Promise<WidgetPersonalization>;
  write: (snapshot: WidgetDiscoverySnapshotV1, session: WidgetSnapshotSession) => Promise<boolean>;
  isLatest: () => boolean;
  timeoutMs?: number;
};

const DEFAULT_PERSONALIZATION_TIMEOUT_MS = 15_000;

function haversineMeters(a: WidgetDiscoveryOrigin, b: WidgetDiscoveryOrigin): number {
  const radius = 6_371_000;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function widgetSnapshotLocation(
  context: LocationContextState,
): WidgetSnapshotLocation | null {
  switch (context.kind) {
    case "loading":
      return null;
    case "device-origin":
      return { status: "fresh", source: "device", label: locationContextLabel(context) };
    case "map-area":
      return { status: "fresh", source: "map", label: locationContextLabel(context) };
    case "fallback":
      return { status: "fresh", source: "demo", label: locationContextLabel(context) };
    case "permission-denied":
      return {
        status: "denied",
        source:
          context.previous === "map" ? "map" : context.previous === "device" ? "device" : "demo",
        label: locationContextLabel(context),
      };
    case "unavailable":
      return {
        status: "unavailable",
        source:
          context.previous === "map" ? "map" : context.previous === "device" ? "device" : "demo",
        label: locationContextLabel(context),
      };
  }
}

function selectedSources(item: NearbyItem): Source[] {
  const investable = item.investable;
  if (!investable) return [];
  if (investable.brand.ticker?.symbol) return investable.sources;
  const comparableSources = investable.comparables[0]?.sources ?? [];
  return comparableSources.length > 0 ? comparableSources : investable.sources;
}

export function widgetNearbyCandidates(
  items: NearbyItem[],
  origin: WidgetDiscoveryOrigin,
): WidgetNearbyCandidate[] {
  return items.map((item) => {
    const investable = item.investable;
    const ownTicker = investable?.brand.ticker?.symbol;
    const ticker = ownTicker ?? investable?.comparables?.[0]?.ticker;
    const sources = selectedSources(item);
    return {
      name: investable?.brand.name ?? item.place.name,
      ...(ticker ? { ticker } : {}),
      ...(investable?.brand.sector ? { sector: investable.brand.sector } : {}),
      isPublic: Boolean(ownTicker && investable?.brand.isPublic),
      confidence: sources.length > 0 ? (investable?.confidence ?? "low") : "low",
      sources,
      distanceM: haversineMeters(origin, item.place.location),
    };
  });
}

function scopeMatchesSession(scope: WidgetSnapshotScope, session: WidgetSnapshotSession): boolean {
  return session.accountId
    ? scope.kind === "account" && scope.accountId === session.accountId
    : scope.kind === "guest";
}

async function loadWithDeadline(
  load: (signal: AbortSignal) => Promise<WidgetPersonalization>,
  timeoutMs: number,
): Promise<WidgetPersonalization> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Widget personalization timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([load(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function synchronizeWidgetDiscovery(
  args: WidgetDiscoverySyncArgs,
  dependencies: WidgetDiscoverySyncDependencies,
): Promise<boolean> {
  const location = widgetSnapshotLocation(args.context);
  if (!location || !dependencies.isLatest()) return false;
  const activated = await dependencies.activate(args.session);
  if (!activated || !scopeMatchesSession(activated, args.session) || !dependencies.isLatest()) {
    return false;
  }

  let personalization: WidgetPersonalization | undefined;
  if (args.session.accountId) {
    if (!args.token) return false;
    try {
      personalization = await loadWithDeadline(
        dependencies.loadPersonalization,
        dependencies.timeoutMs ?? DEFAULT_PERSONALIZATION_TIMEOUT_MS,
      );
    } catch {
      // Keep the last-good personal frame if any account read is unavailable.
      return false;
    }
  }

  const scope = await dependencies.activeScope(args.session);
  if (!scope || !scopeMatchesSession(scope, args.session) || !dependencies.isLatest()) return false;
  const snapshot = composeWidgetDiscoverySnapshot({
    scope,
    location,
    nearby: widgetNearbyCandidates(args.items, args.origin),
    finds: personalization?.finds,
    quests: personalization?.quests.quests,
    dex: personalization?.dex,
  });
  if (!dependencies.isLatest()) return false;
  return dependencies.write(snapshot, args.session);
}
