/**
 * Progression — server-side XP / level / streak for the signed-in user
 * (Universe Roadmap §1 A1). The client renders this; it never derives a streak
 * locally, so the streak survives reinstall.
 *
 * Routes (bearer-required):
 *   GET / → { progress: UserProgress }
 *
 * Mounted by the integrator at /v1/progress.
 */
import type { ProgressResponse } from "@mapvest/core";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { getProgress } from "../lib/progress-store.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

const progress = new Hono<AuthEnv>();
progress.use("*", bearerAuth);

progress.get("/", async (c) => {
  return safeExecuteWithSpan("http.progress.get", async (span) => {
    const user = c.get("user");
    const row = await getProgress(user.id);
    span.setAttributes({
      user_id: user.id,
      xp: row.xp,
      level: row.level,
      streak_days: row.streakDays,
      streak_freezes: row.streakFreezes,
    });
    const resp: ProgressResponse = { progress: row };
    return c.json(resp);
  });
});

export default progress;
