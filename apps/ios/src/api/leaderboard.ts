import { z } from "zod";
import type { FetchOpts } from "./http";

// Local re-declaration of @mapvest/core's LeaderboardResponse/LeaderboardRow
// so Metro/tsc don't need to resolve the workspace package (apps/ios is
// intentionally not a bun workspace member — see apps/ios/README.md). Keep
// in lockstep with packages/core/src/schemas/index.ts's LeaderboardResponse.

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
export const LeaderboardRowSchema = z.object({
  handle: z.string(),
  earlyFindScore: z.number(),
  rank: z.number(),
  isYou: z.boolean(),
});
export type LeaderboardRow = z.infer<typeof LeaderboardRowSchema>;

export const LeaderboardResponseSchema = z.object({
  cycleStart: z.string().datetime(),
  cycleEnd: z.string().datetime(),
  rows: z.array(LeaderboardRowSchema),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
