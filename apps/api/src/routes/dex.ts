/**
 * The Dex — collection progress (Universe Roadmap §1 A4).
 *
 * Routes (bearer-required):
 *   GET /v1/dex → DexResponse { sectors, tilesVisited, totalFinds, rarityCounts }
 *
 * Derived on read: the caller's finds journal is reconciled against the
 * `brands.json` seed in `packages/finance` on every request. The response
 * itself is persisted nowhere, so the dex can never drift from `user_finds`.
 *
 * The one write is the A4 completion badge: a sector whose ring is full earns
 * `"sector:{name}"` once, via the idempotent `awardBadge` ledger. Recomputing
 * the dex on the next read re-offers the same badge and the ledger declines
 * it, so the XP is granted exactly once without storing dex state.
 */
import type { DexResponse } from "@mapvest/core";
import { seedBrands } from "@mapvest/finance";
import { Hono } from "hono";
import { computeDex } from "../lib/dex.js";
import { listFinds } from "../lib/finds-store.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { awardBadge } from "../lib/progress-store.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/** The dex reads the caller's whole journal, capped at the finds-store max. */
const FINDS_LIMIT = 200;
/** XP for completing a sector dex. */
export const SECTOR_BADGE_XP = 50;

const dex = new Hono<AuthEnv>();
dex.use("*", bearerAuth);

dex.get("/", async (c) => {
  return safeExecuteWithSpan("http.dex.get", async (span) => {
    const user = c.get("user");
    const finds = await listFinds(user.id, FINDS_LIMIT);
    const resp: DexResponse = computeDex(finds, seedBrands);

    // Completion badges (A4). Awarding is idempotent, so this runs on every
    // read and only the read that first completes a sector writes anything.
    // A badge write must never fail a dex read.
    let badgesAwarded = 0;
    for (const sector of resp.sectors) {
      if (sector.total <= 0 || sector.found < sector.total) continue;
      const granted = await awardBadge(user.id, `sector:${sector.sector}`, SECTOR_BADGE_XP).catch(
        () => false,
      );
      if (granted) badgesAwarded += 1;
    }

    span.setAttributes({
      user_id: user.id,
      total_finds: resp.totalFinds,
      tiles_visited: resp.tilesVisited,
      sectors: resp.sectors.length,
      legendary: resp.rarityCounts.legendary,
      badges_awarded: badgesAwarded,
    });
    return c.json(resp);
  });
});

export default dex;
