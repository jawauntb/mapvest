/**
 * Daily quests — deterministic generator + server-side checker
 * (Universe Roadmap §1 A5).
 *
 * Everything here is a PURE function over injected data: the caller hands in
 * a user id, a UTC day, the user's finds, and the brand seed, and gets back
 * `Quest[]` from `@mapvest/core`. Nothing touches a store, the network, the
 * clock, or `process.env`, so the unit tests need no database.
 *
 * Two rules the roadmap fixes and this module enforces:
 *
 * 1. **No `Math.random`.** The quest set for a user is a pure function of
 *    `userId + dayUtc`, so refreshing `GET /v1/quests` mid-day can never
 *    reroll a quest the user is halfway through, and no per-day quest
 *    assignment has to be persisted.
 * 2. **No self-reported completion.** Every `QuestKind` is decidable from the
 *    find stream alone — the route splits the journal into "today" and
 *    "before today" and this module decides the rest. The client renders
 *    `progress`/`target`/`completed` exactly as returned.
 *
 * Counting unit: the route feeds this the journal from `listFinds`, which is
 * already unique per company (one row per effective ticker). So "a find
 * today" means "a company newly added to the universe today" — a recatch of
 * something already collected does not tick a quest, matching the dex.
 */
import type { Find, Quest, QuestKind } from "@mapvest/core";
import { type DexSeed, effectiveTicker, seedTickerSectors, tilesVisited } from "./dex.js";
import { utcDay } from "./progress-store.js";

/** A quest template: everything about a quest except the day it belongs to. */
export type QuestDef = {
  kind: QuestKind;
  title: string;
  xp: number;
  target: number;
};

/**
 * The pool `dayQuests` draws from. Every entry is verifiable from the find
 * stream; XP scales with how much moving around the quest actually asks for.
 */
export const QUEST_CATALOG: readonly QuestDef[] = [
  { kind: "catch_any", title: "Catch a company today", xp: 10, target: 1 },
  { kind: "catch_private", title: "Catch a private brand", xp: 20, target: 1 },
  { kind: "new_tile", title: "Catch in a neighborhood you've never caught in", xp: 25, target: 1 },
  { kind: "new_sector", title: "Fill an empty sector in your dex", xp: 25, target: 1 },
];

/** How many quests a day can hold. */
export const MIN_QUESTS_PER_DAY = 2;
export const MAX_QUESTS_PER_DAY = 3;

/**
 * FNV-1a 32-bit. Deterministic across processes and machines (unlike anything
 * seeded from the clock or `Math.random`), which is the whole requirement:
 * two servers must generate the same quest set for the same user and day.
 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619, via shifts to stay in 32-bit unsigned range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic id for a quest: stable per day + kind, so XP grants dedupe. */
export function questId(dayUtc: string, kind: QuestKind): string {
  return `${dayUtc}:${kind}`;
}

/**
 * The quest set for one user on one UTC day: 2–3 of `QUEST_CATALOG`, chosen
 * by a hash of `userId + dayUtc`. Same user + same day → identical set, every
 * time; a different day (or user) generally yields a different set.
 *
 * Returned quests are unstarted (`progress: 0`, `completed: false`) — call
 * `completionFor` to evaluate them against the find stream.
 */
export function dayQuests(userId: string, dayUtc: string): Quest[] {
  const seed = hashString(`${userId}|${dayUtc}`);
  const count = MIN_QUESTS_PER_DAY + (seed % (MAX_QUESTS_PER_DAY - MIN_QUESTS_PER_DAY + 1));

  // Deterministic selection without replacement: walk the catalog and take the
  // entry at a hash-derived offset among those still unpicked.
  const pool = QUEST_CATALOG.map((def, index) => ({ def, index }));
  const picked: Array<{ def: QuestDef; index: number }> = [];
  let cursor = seed;
  while (picked.length < count && pool.length > 0) {
    cursor = hashString(`${cursor}|${picked.length}`);
    const [taken] = pool.splice(cursor % pool.length, 1);
    if (taken) picked.push(taken);
  }

  // Present in catalog order so the list reads the same way every day.
  return picked
    .sort((a, b) => a.index - b.index)
    .map(({ def }) => ({
      id: questId(dayUtc, def.kind),
      kind: def.kind,
      title: def.title,
      xp: def.xp,
      completed: false,
      progress: 0,
      target: def.target,
    }));
}

/**
 * A find counts as "private" when the brand itself is not listed and the
 * universe entry is a public comparable — either flagged explicitly by the
 * identify pipeline or implied by having a comparable and no direct ticker.
 */
export function isPrivateFind(find: Find): boolean {
  if (find.isPublic === false) return true;
  const hasTicker = Boolean(find.ticker?.trim());
  return !hasTicker && Boolean(find.comparable?.trim());
}

/** Canonical seed sectors already represented in a set of finds. */
function sectorsOf(finds: Find[], seed: DexSeed): Set<string> {
  const tickerSectors = seedTickerSectors(seed);
  const sectors = new Set<string>();
  for (const find of finds) {
    const ticker = effectiveTicker(find);
    if (!ticker) continue;
    const sector = tickerSectors.get(ticker);
    if (sector) sectors.add(sector);
  }
  return sectors;
}

/** How many of today's finds satisfy a quest kind, given the prior journal. */
function progressForKind(
  kind: QuestKind,
  todaysFinds: Find[],
  priorFinds: Find[],
  seed: DexSeed,
): number {
  switch (kind) {
    case "catch_any":
      return todaysFinds.length;
    case "catch_private":
      return todaysFinds.filter(isPrivateFind).length;
    case "new_tile": {
      const priorTiles = tilesVisited(priorFinds);
      // Distinct new tiles, so two catches on the same new block count once.
      const fresh = new Set<string>();
      for (const tile of tilesVisited(todaysFinds)) {
        if (!priorTiles.has(tile)) fresh.add(tile);
      }
      return fresh.size;
    }
    case "new_sector": {
      const priorSectors = sectorsOf(priorFinds, seed);
      const fresh = new Set<string>();
      for (const sector of sectorsOf(todaysFinds, seed)) {
        if (!priorSectors.has(sector)) fresh.add(sector);
      }
      return fresh.size;
    }
  }
}

/**
 * Evaluate a day's quests against the find stream. `todaysFinds` are the finds
 * dated to the quest day; `priorFinds` is everything before it (the baseline
 * that makes "new tile" and "new sector" mean something).
 *
 * `progress` is clamped to `target` so the client can render `progress/target`
 * directly; `completed` is the uncapped comparison.
 */
export function completionFor(
  quests: Quest[],
  todaysFinds: Find[],
  priorFinds: Find[],
  seed: DexSeed,
): Quest[] {
  return quests.map((quest) => {
    const raw = progressForKind(quest.kind, todaysFinds, priorFinds, seed);
    return {
      ...quest,
      progress: Math.min(raw, quest.target),
      completed: raw >= quest.target,
    };
  });
}

/**
 * Split a journal into the finds recorded on `dayUtc` and the ones before it.
 * Finds dated after `dayUtc` (device clock skew, a replayed backlog) belong to
 * neither bucket: they must not retroactively satisfy today's quest, and they
 * are not part of the "before today" baseline either.
 */
export function splitFindsByDay(finds: Find[], dayUtc: string): { today: Find[]; prior: Find[] } {
  const today: Find[] = [];
  const prior: Find[] = [];
  for (const find of finds) {
    const day = utcDay(find.createdAt);
    if (day === dayUtc) today.push(find);
    else if (day < dayUtc) prior.push(find);
  }
  return { today, prior };
}
