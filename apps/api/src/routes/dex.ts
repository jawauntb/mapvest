/**
 * The Dex — collection progress (Universe Roadmap §1 A4).
 *
 * Routes (bearer-required):
 *   GET /v1/dex → DexResponse { sectors, tilesVisited, totalFinds }
 *
 * Derived on read: the caller's finds journal is reconciled against the
 * `brands.json` seed in `packages/finance` on every request. Nothing is
 * persisted, so the dex can never drift from `user_finds`.
 */
import type { DexResponse } from "@mapvest/core";
import { seedBrands } from "@mapvest/finance";
import { Hono } from "hono";
import { computeDex } from "../lib/dex.js";
import { listFinds } from "../lib/finds-store.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/** The dex reads the caller's whole journal, capped at the finds-store max. */
const FINDS_LIMIT = 200;

const dex = new Hono<AuthEnv>();
dex.use("*", bearerAuth);

dex.get("/", async (c) => {
  return safeExecuteWithSpan("http.dex.get", async (span) => {
    const user = c.get("user");
    const finds = await listFinds(user.id, FINDS_LIMIT);
    const resp: DexResponse = computeDex(finds, seedBrands);
    span.setAttributes({
      user_id: user.id,
      total_finds: resp.totalFinds,
      tiles_visited: resp.tilesVisited,
      sectors: resp.sectors.length,
    });
    return c.json(resp);
  });
});

export default dex;
