import { z } from "zod";
import { type FetchOpts, apiFetch } from "./http";

// Local re-declaration of @mapvest/core's WeeklyQuestsResponse so Metro/tsc
// don't need to resolve the workspace package (apps/ios is intentionally not
// a bun workspace member — see apps/ios/README.md). Keep in lockstep with
// packages/core/src/schemas/index.ts's WeeklyQuestsResponse/Quest.

/**
 * Weekly quests for the current cycle (Saturday 12:00 UTC boundary).
 * Completion is verified server-side from the find stream — the client never
 * posts a completion. `cycleStart` and `cycleEnd` bound the 7-day window.
 */
export function fetchWeeklyQuests(opts: FetchOpts = {}): Promise<WeeklyQuestsResponse> {
  return apiFetch("/v1/quests/weekly", { method: "GET" }, opts);
}

/**
 * Schema for testing weekly quests response parsing. Validates cycleStart and
 * cycleEnd are valid ISO timestamps, and quests array is present.
 */
export const WeeklyQuestSchema = z.object({
  id: z.string(),
  kind: z.enum(["catch_any", "catch_private", "new_tile", "new_sector"]),
  title: z.string(),
  xp: z.number(),
  completed: z.boolean(),
  progress: z.number(),
  target: z.number(),
});

export const WeeklyQuestsResponseSchema = z.object({
  cycleStart: z.string().datetime(),
  cycleEnd: z.string().datetime(),
  quests: z.array(WeeklyQuestSchema),
});
export type WeeklyQuestsResponse = z.infer<typeof WeeklyQuestsResponseSchema>;
export type WeeklyQuest = z.infer<typeof WeeklyQuestSchema>;
