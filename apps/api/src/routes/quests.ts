/**
 * Daily quests (Universe Roadmap §1 A5).
 *
 * Routes (bearer-required):
 *   GET / → QuestsResponse { quests, day, xpGrantedToday }
 *
 * Mounted by the integrator at /v1/quests.
 *
 * Derived on read, exactly like the dex: the quest set is a pure function of
 * (user, UTC day) and completion is decided by reconciling the caller's finds
 * journal against it. Nothing about a quest is persisted except the XP it
 * earned — `awardXp` writes one `user_xp_grants` row per quest id, so the
 * first read after completion grants XP and every read after that is free.
 * The client never posts a completion (roadmap A5 acceptance: verified
 * server-side from the find stream).
 */
import type { QuestsResponse } from "@mapvest/core";
import { seedBrands } from "@mapvest/finance";
import { Hono } from "hono";
import { listFinds } from "../lib/finds-store.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { awardXp, utcDay } from "../lib/progress-store.js";
import { completionFor, dayQuests, splitFindsByDay } from "../lib/quests.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/** Quests read the caller's whole journal, capped at the finds-store max. */
const FINDS_LIMIT = 200;

const quests = new Hono<AuthEnv>();
quests.use("*", bearerAuth);

quests.get("/", async (c) => {
  return safeExecuteWithSpan("http.quests.get", async (span) => {
    const user = c.get("user");
    const day = utcDay(new Date().toISOString());
    const finds = await listFinds(user.id, FINDS_LIMIT);
    const { today, prior } = splitFindsByDay(finds, day);
    const evaluated = completionFor(dayQuests(user.id, day), today, prior, seedBrands);

    let xpGrantedToday = 0;
    for (const quest of evaluated) {
      if (!quest.completed) continue;
      xpGrantedToday += quest.xp;
      // Idempotent: true only the first time this quest id completes. A
      // progression write must never fail a read of the quest board.
      await awardXp(user.id, quest.xp, `quest:${quest.id}`).catch(() => false);
    }

    span.setAttributes({
      user_id: user.id,
      day,
      quests: evaluated.length,
      completed: evaluated.filter((q) => q.completed).length,
      finds_today: today.length,
      xp_granted_today: xpGrantedToday,
    });

    const resp: QuestsResponse = { quests: evaluated, day, xpGrantedToday };
    return c.json(resp);
  });
});

export default quests;
