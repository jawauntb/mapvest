import type { Confidence, Source } from "@/api/types";

export const WIDGET_DISCOVERY_SNAPSHOT_VERSION = 1 as const;
export const WIDGET_DISCOVERY_MAX_CARDS = 6;
export const WIDGET_DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;
export const WIDGET_DISCOVERY_MAX_SOURCES_PER_CARD = 3;

export type WidgetSnapshotScope =
  | { kind: "guest" }
  | { kind: "account"; accountId: string; epoch: string };

export type WidgetSnapshotLocation = {
  status: "fresh" | "denied" | "unavailable";
  source: "device" | "map" | "demo";
  label: string;
};

export type WidgetDiscoveryCard = {
  id: string;
  name: string;
  ticker: string;
  sector?: string;
  distanceM?: number;
  isPublic: boolean;
  caught: boolean;
  confidence: Confidence;
  sources: Source[];
  relevance: string;
  deepLink: string;
};

export type WidgetQuestSnapshot = {
  id: string;
  title: string;
  progress: number;
  target: number;
  completed: boolean;
  xp: number;
  deepLink: string;
};

export type WidgetDexSnapshot = {
  found: number;
  total: number;
  tilesVisited: number;
  deepLink: string;
};

export type WidgetDiscoverySnapshotV1 = {
  schemaVersion: typeof WIDGET_DISCOVERY_SNAPSHOT_VERSION;
  snapshotId: string;
  scope: WidgetSnapshotScope;
  generatedAt: string;
  expiresAt: string;
  location: WidgetSnapshotLocation;
  cards: WidgetDiscoveryCard[];
  quest?: WidgetQuestSnapshot;
  dex?: WidgetDexSnapshot;
  mapDeepLink: string;
};

export type WidgetNearbyCandidate = {
  name: string;
  ticker?: string;
  sector?: string;
  distanceM?: number;
  isPublic?: boolean;
  confidence?: Confidence;
  sources?: Source[];
};

export type WidgetFindIdentity = { ticker?: string; comparable?: string };

export type WidgetQuestInput = {
  id: string;
  title: string;
  progress: number;
  target: number;
  completed: boolean;
  xp: number;
};

export type WidgetDexInput = {
  sectors: Array<{ found: number; total: number }>;
  tilesVisited: number;
};

export type WidgetSnapshotSelection =
  | { kind: "setup"; reason: "missing" | "corrupt" | "scope-mismatch" }
  | { kind: "fresh"; snapshot: WidgetDiscoverySnapshotV1 }
  | {
      kind: "stale";
      reason: "expired" | "denied" | "unavailable";
      snapshot: WidgetDiscoverySnapshotV1;
    };

function normalizedTicker(value: string | undefined): string | undefined {
  const ticker = value?.trim().toUpperCase();
  return ticker && /^[A-Z][A-Z0-9.-]{0,23}$/.test(ticker) ? ticker : undefined;
}

function safeNumber(value: number | undefined, minimum = 0): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : undefined;
}

function snapshotId(nowMs: number): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${nowMs}-${uuid}`;
}

function findTickerSet(finds: WidgetFindIdentity[]): Set<string> {
  return new Set(
    finds
      .map((find) => normalizedTicker(find.ticker ?? find.comparable))
      .filter((ticker): ticker is string => Boolean(ticker)),
  );
}

function relevanceFor(candidate: WidgetNearbyCandidate, caught: boolean): string {
  if (caught) return "Caught in your Universe";
  if (candidate.isPublic === false) return "Private brand with a public comparable";
  if (candidate.sector) return `Uncovered ${candidate.sector} company`;
  return "Uncovered nearby company";
}

function widgetSources(sources: Source[] | undefined): Source[] {
  const seen = new Set<string>();
  const selected: Source[] = [];
  for (const source of sources ?? []) {
    const fetchedAtMs = Date.parse(source.fetchedAt);
    const url = source.url?.trim();
    if (
      !Number.isFinite(fetchedAtMs) ||
      (url !== undefined && (!/^https?:\/\//i.test(url) || url.length > 800))
    )
      continue;
    const fetchedAt = new Date(fetchedAtMs).toISOString();
    const key = `${source.provider}:${url ?? ""}:${fetchedAt}:${source.confidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({
      provider: source.provider,
      fetchedAt,
      confidence: source.confidence,
      ...(url ? { url } : {}),
    });
    if (selected.length >= WIDGET_DISCOVERY_MAX_SOURCES_PER_CARD) break;
  }
  return selected;
}

function rankedCards(
  candidates: WidgetNearbyCandidate[],
  finds: WidgetFindIdentity[],
): WidgetDiscoveryCard[] {
  const caughtTickers = findTickerSet(finds);
  const seen = new Set<string>();
  const cards: WidgetDiscoveryCard[] = [];
  for (const candidate of candidates) {
    const ticker = normalizedTicker(candidate.ticker);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const caught = caughtTickers.has(ticker);
    const distanceM = safeNumber(candidate.distanceM);
    const sources = widgetSources(candidate.sources);
    const name = candidate.name.trim().slice(0, 120);
    if (!name) continue;
    cards.push({
      id: ticker,
      name,
      ticker,
      ...(candidate.sector?.trim() ? { sector: candidate.sector.trim().slice(0, 80) } : {}),
      ...(distanceM !== undefined ? { distanceM: Math.round(distanceM) } : {}),
      isPublic: candidate.isPublic !== false,
      caught,
      confidence: sources.length === 0 ? "low" : (candidate.confidence ?? "low"),
      sources,
      relevance: relevanceFor(candidate, caught),
      deepLink: `mapvest:///detail/${encodeURIComponent(ticker)}`,
    });
  }
  return cards
    .sort((left, right) => {
      if (left.caught !== right.caught) return left.caught ? 1 : -1;
      return (
        (left.distanceM ?? Number.POSITIVE_INFINITY) - (right.distanceM ?? Number.POSITIVE_INFINITY)
      );
    })
    .slice(0, WIDGET_DISCOVERY_MAX_CARDS);
}

function questSnapshot(quests: WidgetQuestInput[]): WidgetQuestSnapshot | undefined {
  const quest = [...quests].sort(
    (left, right) => Number(left.completed) - Number(right.completed),
  )[0];
  if (!quest) return undefined;
  return {
    id: quest.id.slice(0, 160),
    title: quest.title.trim().slice(0, 120),
    progress: Math.max(0, Math.floor(quest.progress)),
    target: Math.max(1, Math.floor(quest.target)),
    completed: quest.completed,
    xp: Math.max(0, Math.floor(quest.xp)),
    deepLink: "mapvest:///universe",
  };
}

function dexSnapshot(dex: WidgetDexInput | undefined): WidgetDexSnapshot | undefined {
  if (!dex) return undefined;
  const found = dex.sectors.reduce((sum, sector) => sum + Math.max(0, sector.found), 0);
  const total = dex.sectors.reduce((sum, sector) => sum + Math.max(0, sector.total), 0);
  return {
    found: Math.min(found, total),
    total,
    tilesVisited: Math.max(0, Math.floor(dex.tilesVisited)),
    deepLink: "mapvest:///universe",
  };
}

export function composeWidgetDiscoverySnapshot(args: {
  scope: WidgetSnapshotScope;
  location: WidgetSnapshotLocation;
  nearby: WidgetNearbyCandidate[];
  finds?: WidgetFindIdentity[];
  quests?: WidgetQuestInput[];
  dex?: WidgetDexInput;
  nowMs?: number;
}): WidgetDiscoverySnapshotV1 {
  const nowMs = args.nowMs ?? Date.now();
  const personal = args.scope.kind === "account";
  return {
    schemaVersion: WIDGET_DISCOVERY_SNAPSHOT_VERSION,
    snapshotId: snapshotId(nowMs),
    scope: args.scope,
    generatedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + WIDGET_DISCOVERY_TTL_MS).toISOString(),
    location: args.location,
    cards: rankedCards(args.nearby, personal ? (args.finds ?? []) : []),
    ...(personal ? { quest: questSnapshot(args.quests ?? []), dex: dexSnapshot(args.dex) } : {}),
    mapDeepLink: "mapvest:///map",
  };
}

export function personalizeWidgetDiscoverySnapshot(args: {
  snapshot: WidgetDiscoverySnapshotV1;
  scope: Extract<WidgetSnapshotScope, { kind: "account" }> | WidgetSnapshotScope;
  finds: WidgetFindIdentity[];
  quests: WidgetQuestInput[];
  dex: WidgetDexInput;
}): WidgetDiscoverySnapshotV1 | null {
  if (
    args.snapshot.scope.kind !== "account" ||
    args.scope.kind !== "account" ||
    args.snapshot.scope.accountId !== args.scope.accountId ||
    args.snapshot.scope.epoch !== args.scope.epoch
  ) {
    return null;
  }
  const caught = findTickerSet(args.finds);
  const cards = args.snapshot.cards
    .map((card) => {
      const isCaught = caught.has(card.ticker);
      return {
        ...card,
        caught: isCaught,
        relevance: relevanceFor(card, isCaught),
      };
    })
    .sort((left, right) => {
      if (left.caught !== right.caught) return left.caught ? 1 : -1;
      return (
        (left.distanceM ?? Number.POSITIVE_INFINITY) - (right.distanceM ?? Number.POSITIVE_INFINITY)
      );
    });
  return {
    ...args.snapshot,
    snapshotId: snapshotId(Date.now()),
    cards,
    quest: questSnapshot(args.quests),
    dex: dexSnapshot(args.dex),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : undefined;
}

function finiteNumber(value: unknown, minimum = 0): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? value
    : undefined;
}

function mapvestLink(value: unknown): string | undefined {
  const link = stringValue(value, 500);
  return link?.startsWith("mapvest:///") ? link : undefined;
}

const WIDGET_SOURCE_PROVIDERS = new Set([
  "exa",
  "openrouter",
  "gemini",
  "massive",
  "yahoo",
  "polygon",
  "sec",
  "fred",
  "manual",
]);

function sourceSnapshot(value: unknown): Source | null {
  const source = record(value);
  const provider = stringValue(source?.provider, 32);
  const fetchedAt = isoDate(source?.fetchedAt);
  const confidence = source?.confidence;
  const url = source?.url === undefined ? undefined : stringValue(source.url, 800);
  if (
    !provider ||
    !WIDGET_SOURCE_PROVIDERS.has(provider) ||
    !fetchedAt ||
    (confidence !== "high" && confidence !== "medium" && confidence !== "low") ||
    (source?.url !== undefined && (!url || !/^https?:\/\//i.test(url)))
  ) {
    return null;
  }
  return {
    provider: provider as Source["provider"],
    fetchedAt,
    confidence,
    ...(url ? { url } : {}),
  };
}

export function parseWidgetDiscoverySnapshot(
  raw: string | unknown,
): WidgetDiscoverySnapshotV1 | null {
  let decoded: unknown = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const value = record(decoded);
  if (!value || value.schemaVersion !== 1) return null;
  const scopeValue = record(value.scope);
  const scopeKind = scopeValue?.kind;
  let scope: WidgetSnapshotScope;
  if (scopeKind === "guest") {
    if (scopeValue?.accountId !== undefined || scopeValue?.epoch !== undefined) return null;
    scope = { kind: "guest" };
  } else if (scopeKind === "account") {
    const accountId = stringValue(scopeValue?.accountId, 256);
    const epoch = stringValue(scopeValue?.epoch, 256);
    if (!accountId || !epoch) return null;
    scope = { kind: "account", accountId, epoch };
  } else {
    return null;
  }
  const locationValue = record(value.location);
  const status = locationValue?.status;
  const source = locationValue?.source;
  const label = stringValue(locationValue?.label, 120);
  if (
    (status !== "fresh" && status !== "denied" && status !== "unavailable") ||
    (source !== "device" && source !== "map" && source !== "demo") ||
    !label
  ) {
    return null;
  }
  if (!Array.isArray(value.cards) || value.cards.length > WIDGET_DISCOVERY_MAX_CARDS) return null;
  const cards: WidgetDiscoveryCard[] = [];
  const cardTickers = new Set<string>();
  for (const rawCard of value.cards) {
    const card = record(rawCard);
    const id = stringValue(card?.id, 64);
    const name = stringValue(card?.name, 120);
    const ticker = normalizedTicker(typeof card?.ticker === "string" ? card.ticker : undefined);
    const relevance = stringValue(card?.relevance, 160);
    const deepLink = mapvestLink(card?.deepLink);
    const confidence = card?.confidence;
    if (
      !Array.isArray(card?.sources) ||
      card.sources.length > WIDGET_DISCOVERY_MAX_SOURCES_PER_CARD
    )
      return null;
    const sources = card.sources.map(sourceSnapshot);
    if (
      !id ||
      !name ||
      !ticker ||
      id !== ticker ||
      cardTickers.has(ticker) ||
      !relevance ||
      !deepLink ||
      deepLink !== `mapvest:///detail/${encodeURIComponent(ticker)}` ||
      typeof card?.caught !== "boolean" ||
      typeof card.isPublic !== "boolean" ||
      (confidence !== "high" && confidence !== "medium" && confidence !== "low") ||
      sources.some((source) => source === null) ||
      (sources.length === 0 && confidence !== "low")
    ) {
      return null;
    }
    cardTickers.add(ticker);
    const sector = card.sector === undefined ? undefined : stringValue(card.sector, 80);
    const distanceM = card.distanceM === undefined ? undefined : finiteNumber(card.distanceM);
    if (
      (card.sector !== undefined && !sector) ||
      (card.distanceM !== undefined && distanceM === undefined)
    )
      return null;
    cards.push({
      id,
      name,
      ticker,
      relevance,
      deepLink,
      caught: card.caught,
      isPublic: card.isPublic,
      confidence,
      sources: sources as Source[],
      ...(sector ? { sector } : {}),
      ...(distanceM !== undefined ? { distanceM } : {}),
    });
  }
  const snapshotIdValue = stringValue(value.snapshotId, 256);
  const generatedAt = isoDate(value.generatedAt);
  const expiresAt = isoDate(value.expiresAt);
  const mapDeepLink = mapvestLink(value.mapDeepLink);
  if (
    !snapshotIdValue ||
    !generatedAt ||
    !expiresAt ||
    Date.parse(expiresAt) < Date.parse(generatedAt) ||
    mapDeepLink !== "mapvest:///map"
  )
    return null;
  const questValue = value.quest === undefined ? undefined : record(value.quest);
  let quest: WidgetQuestSnapshot | undefined;
  if (value.quest !== undefined) {
    const id = stringValue(questValue?.id, 160);
    const title = stringValue(questValue?.title, 120);
    const progress = finiteNumber(questValue?.progress);
    const target = finiteNumber(questValue?.target, 1);
    const xp = finiteNumber(questValue?.xp);
    const deepLink = mapvestLink(questValue?.deepLink);
    if (
      !id ||
      !title ||
      progress === undefined ||
      target === undefined ||
      xp === undefined ||
      deepLink !== "mapvest:///universe" ||
      typeof questValue?.completed !== "boolean"
    )
      return null;
    quest = { id, title, progress, target, xp, deepLink, completed: questValue.completed };
  }
  const dexValue = value.dex === undefined ? undefined : record(value.dex);
  let dex: WidgetDexSnapshot | undefined;
  if (value.dex !== undefined) {
    const found = finiteNumber(dexValue?.found);
    const total = finiteNumber(dexValue?.total);
    const tilesVisited = finiteNumber(dexValue?.tilesVisited);
    const deepLink = mapvestLink(dexValue?.deepLink);
    if (
      found === undefined ||
      total === undefined ||
      tilesVisited === undefined ||
      deepLink !== "mapvest:///universe" ||
      found > total
    )
      return null;
    dex = { found, total, tilesVisited, deepLink };
  }
  if (scope.kind === "guest" && (quest || dex || cards.some((card) => card.caught))) return null;
  return {
    schemaVersion: 1,
    snapshotId: snapshotIdValue,
    scope,
    generatedAt,
    expiresAt,
    location: { status, source, label },
    cards,
    ...(quest ? { quest } : {}),
    ...(dex ? { dex } : {}),
    mapDeepLink,
  };
}

export function selectWidgetDiscoverySnapshot(args: {
  raw: string | null | undefined;
  activeScope: WidgetSnapshotScope | null;
  nowMs?: number;
}): WidgetSnapshotSelection {
  if (!args.raw) return { kind: "setup", reason: "missing" };
  const snapshot = parseWidgetDiscoverySnapshot(args.raw);
  if (!snapshot) return { kind: "setup", reason: "corrupt" };
  if (snapshot.scope.kind === "account") {
    if (
      args.activeScope?.kind !== "account" ||
      args.activeScope.accountId !== snapshot.scope.accountId ||
      args.activeScope.epoch !== snapshot.scope.epoch
    ) {
      return { kind: "setup", reason: "scope-mismatch" };
    }
  } else if (args.activeScope?.kind === "account") {
    return { kind: "setup", reason: "scope-mismatch" };
  }
  if (snapshot.location.status === "denied") return { kind: "stale", reason: "denied", snapshot };
  if (snapshot.location.status === "unavailable")
    return { kind: "stale", reason: "unavailable", snapshot };
  if (Date.parse(snapshot.expiresAt) < (args.nowMs ?? Date.now())) {
    return { kind: "stale", reason: "expired", snapshot };
  }
  return { kind: "fresh", snapshot };
}
