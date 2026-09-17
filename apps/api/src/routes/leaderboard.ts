import type { LeaderboardResponse, LeaderboardRow } from "@mapvest/core";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { earlyFindScores } from "../lib/progress-store.js";
import { getUserById } from "../lib/store.js";
import { cycleWindow } from "../lib/weeklyCycle.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/**
 * Weekly leaderboard (Universe Roadmap / packages/design/HANDOFF.md Item 3 —
 * "the early spotter"). Ranks finders by **early-find score**
 * (`earlyFindScores`, the Pioneer-bonus XP the server already awards for
 * catching a brand before others do — see `progress-store.ts`), never by raw
 * find count. Resets on the same Saturday-12:00-UTC cycle as
 * `/v1/quests/weekly` (`lib/weeklyCycle.ts`) — this route never recomputes
 * that boundary independently.
 *
 * GET /v1/leaderboard/weekly?limit=50 → LeaderboardResponse
 *
 * The caller's own row is ALWAYS present, even with zero early-find score
 * and even ranked outside `limit` — appended after the top rows so the
 * client can render it as "you, further down" without a second request.
 */
const leaderboard = new Hono<AuthEnv>();
leaderboard.use("*", bearerAuth);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

function parseLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

leaderboard.get("/weekly", async (c) => {
  return safeExecuteWithSpan("http.leaderboard.weekly.get", async (span) => {
    const user = c.get("user");
    const limit = parseLimit(c.req.query("limit"));
    const { cycleStart, cycleEnd } = cycleWindow(new Date());

    const scores = await earlyFindScores(cycleStart, cycleEnd);
    // Deterministic order: score desc, then userId asc as a stable tiebreak
    // (two finders tied on score never reorder between reads).
    scores.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));

    const rankByUserId = new Map<string, number>();
    scores.forEach((row, i) => rankByUserId.set(row.userId, i + 1));

    const top = scores.slice(0, limit);
    const callerRank = rankByUserId.get(user.id);
    const callerInTop = callerRank !== undefined && callerRank <= limit;

    const idsNeeded = new Set(top.map((row) => row.userId));
    if (!callerInTop) idsNeeded.add(user.id);
    const handleById = new Map<string, string | undefined>();
    await Promise.all(
      Array.from(idsNeeded).map(async (id) => {
        const found = await getUserById(id).catch(() => undefined);
        handleById.set(id, found?.handle);
      }),
    );

    // Never fall back to the raw userId — a handle is assigned to every
    // account at creation (foundation work, `lib/handles.ts`); a row whose
    // handle can't be resolved (e.g. a deleted account) is dropped rather
    // than leaking an id.
    const rows: LeaderboardRow[] = [];
    for (const row of top) {
      const handle = handleById.get(row.userId);
      if (!handle) continue;
      rows.push({
        handle,
        earlyFindScore: row.score,
        rank: rankByUserId.get(row.userId) ?? 0,
        isYou: row.userId === user.id,
      });
    }

    if (!callerInTop) {
      const handle = handleById.get(user.id) ?? user.handle;
      if (handle) {
        rows.push({
          handle,
          earlyFindScore: scores.find((row) => row.userId === user.id)?.score ?? 0,
          rank: callerRank ?? scores.length + 1,
          isYou: true,
        });
      }
    }

    span.setAttributes({
      user_id: user.id,
      limit,
      total_ranked: scores.length,
      caller_in_top: callerInTop,
    });

    const resp: LeaderboardResponse = {
      cycleStart: cycleStart.toISOString(),
      cycleEnd: cycleEnd.toISOString(),
      rows,
    };
    return c.json(resp);
  });
});

export default leaderboard;
