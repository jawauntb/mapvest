import { z } from "zod";
import { type FetchOpts, apiFetch } from "./http";
import type { WeeklyQuestsResponse } from "@mapvest/core";

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
export const WeeklyQuestsResponseSchema = z.object({
  cycleStart: z.string().datetime(),
  cycleEnd: z.string().datetime(),
  quests: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["catch_any", "catch_private", "new_tile", "new_sector"]),
      title: z.string(),
      xp: z.number(),
      completed: z.boolean(),
      progress: z.number(),
      target: z.number(),
    }),
  ),
});
