import type { LeaderboardResponse, LeaderboardRow } from "@mapvest/core";
import { z } from "zod";
import type { FetchOpts } from "./http";

export type { LeaderboardResponse, LeaderboardRow };

/**
 * Weekly leaderboard (packages/design/HANDOFF.md Item 3 — "the early
 * spotter"). Ranks finders by early-find score (the Pioneer-bonus XP the
 * server awards for catching a brand before others do), never by raw find
 * count. Same Saturday-12:00-UTC cycle as `fetchWeeklyQuests`
 * (`@/util/weeklyCycle`). The caller's own row is always present, even with
 * a zero score and even below the requested `limit`.
 */
export async function fetchWeeklyLeaderboard(
  opts: FetchOpts = {},
  limit = 50,
): Promise<LeaderboardResponse> {
  // Deferred import: this module's pure schema export is exercised in plain
  // `bun test` with no RN runtime, and `./http` pulls in expo-secure-store
  // transitively — keeping that import lazy means a schema parse test never
  // has to load the native module chain (mirrors `./handles.ts`).
  const { apiFetch } = await import("./http");
  return apiFetch(`/v1/leaderboard/weekly?limit=${limit}`, { method: "GET" }, opts);
}

/** Schema for testing leaderboard response parsing. */
export const LeaderboardResponseSchema = z.object({
  cycleStart: z.string().datetime(),
  cycleEnd: z.string().datetime(),
  rows: z.array(
    z.object({
      handle: z.string(),
      earlyFindScore: z.number(),
      rank: z.number(),
      isYou: z.boolean(),
    }),
  ),
});
