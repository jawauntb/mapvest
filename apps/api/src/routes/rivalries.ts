/**
 * Rivalries — solo weekly matchups (Universe Roadmap §3 C6).
 *
 * Routes (bearer-required):
 *   GET  /v1/rivalries            → RivalriesResponse
 *   POST /v1/rivalries            { ticker, rivalTicker? } → RivalriesResponse (201)
 *   POST /v1/rivalries/:id/pick   { pick: "ticker" | "rival" | null } → RivalriesResponse
 *   DELETE /v1/rivalries/:id      → 204
 *
 * Every success response is `RivalriesResponse` from `@mapvest/core` — the
 * whole list, newest-first, so the created/updated row is the caller's first
 * element and no new wire shape is invented at the call site (AGENTS.md §3).
 * The list is capped at 10 per user, so returning it is always cheap.
 *
 * `rivalTicker` is optional. Omitted, the server resolves the opponent through
 * the EXISTING comparables pipeline (`resolveComparable` in
 * `@mapvest/finance`: Exa evidence → OpenRouter judge) and takes its top pick.
 * The client must never invent a rival, and neither does this route: if the
 * pipeline returns nothing plausible, the request is refused (422) rather than
 * matched against a guessed symbol. The comparable's own citation — provider,
 * url, fetchedAt, confidence — is recorded on the creation span, because the
 * stored row holds tickers only and must not restate a source it did not fetch
 * (AGENTS.md §6).
 *
 * Both symbols must pass `isPlausibleTicker`, the same guard the comparables
 * and value-chain paths use, so junk like "MOUNT" never becomes a matchup.
 *
 * This is single-player. There is no opponent user and no position: the round
 * produces a wins/losses/draws record and an optional pre-registered pick worth
 * XP. Copy and payloads never instruct a trade.
 */
import { CreateRivalryRequest, type RivalriesResponse } from "@mapvest/core";
import { isPlausibleTicker, resolveComparable } from "@mapvest/finance";
import { Hono } from "hono";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import {
  MAX_RIVALRIES_PER_USER,
  type RivalryPick,
  createRivalry,
  deleteRivalry,
  listRivalries,
  normalizeSymbol,
  setPick,
} from "../lib/rivalries-store.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/** Ceiling on the comparables resolve so a slow judge can't hold the request. */
const RESOLVE_TIMEOUT_MS = 12_000;

const rivalries = new Hono<AuthEnv>();
rivalries.use("*", bearerAuth);

async function respondWithList(userId: string): Promise<RivalriesResponse> {
  const items = await listRivalries(userId);
  return { rivalries: items, count: items.length };
}

/** GET /v1/rivalries → every matchup the caller owns, newest first. */
rivalries.get("/", async (c) => {
  return safeExecuteWithSpan("http.rivalries.list", async (span) => {
    const user = c.get("user");
    const resp = await respondWithList(user.id);
    span.setAttributes({ user_id: user.id, count: resp.count });
    return c.json(resp);
  });
});

/**
 * POST /v1/rivalries { ticker, rivalTicker? }
 *
 * 201 → RivalriesResponse (new row first)
 * 400 → unusable body / implausible symbol / self-matchup
 * 409 → this exact matchup already exists
 * 422 → no plausible comparable could be resolved for the opponent
 * 429 → per-user cap reached
 */
rivalries.post("/", async (c) => {
  return safeExecuteWithSpan("http.rivalries.create", async (span) => {
    const user = c.get("user");
    const raw = await c.req.json().catch(() => null);
    const parsed = CreateRivalryRequest.safeParse(raw);
    if (!parsed.success) return c.json({ error: "ticker required" }, 400);

    const ticker = normalizeSymbol(parsed.data.ticker);
    if (!isPlausibleTicker(ticker)) {
      span.setAttributes({ user_id: user.id, ticker, rejected: "implausible_ticker" });
      return c.json({ error: "ticker is not a plausible listed symbol" }, 400);
    }

    let rivalTicker = normalizeSymbol(parsed.data.rivalTicker);
    let resolvedRival = false;
    if (rivalTicker) {
      if (!isPlausibleTicker(rivalTicker)) {
        span.setAttributes({ user_id: user.id, ticker, rejected: "implausible_rival" });
        return c.json({ error: "rivalTicker is not a plausible listed symbol" }, 400);
      }
    } else {
      // Server-side opponent selection: top comparable from the existing
      // pipeline. Never invented — an empty or implausible result is a 422.
      const comps = await Promise.race([
        resolveComparable(ticker).catch(() => []),
        new Promise<[]>((r) => setTimeout(() => r([]), RESOLVE_TIMEOUT_MS)),
      ]);
      const top = (Array.isArray(comps) ? comps : []).find(
        (comp) =>
          isPlausibleTicker(normalizeSymbol(comp.ticker)) &&
          normalizeSymbol(comp.ticker) !== ticker,
      );
      if (!top) {
        span.setAttributes({ user_id: user.id, ticker, rejected: "no_comparable" });
        return c.json(
          { error: "no plausible comparable found — pass rivalTicker explicitly" },
          422,
        );
      }
      rivalTicker = normalizeSymbol(top.ticker);
      resolvedRival = true;
      // Cite the resolution on the span. The row stores tickers only, so this
      // is where the provenance of a server-chosen opponent lives.
      const cite = top.sources[0];
      span.setAttributes({
        rival_resolved_by: "resolveComparable",
        rival_score: top.score,
        rival_source_provider: cite?.provider ?? "none",
        rival_source_url: cite?.url ?? "",
        rival_source_fetched_at: cite?.fetchedAt ?? "",
        rival_source_confidence: cite?.confidence ?? "low",
        rival_source_count: top.sources.length,
      });
    }

    const created = await createRivalry(user.id, { ticker, rivalTicker });
    span.setAttributes({
      user_id: user.id,
      ticker,
      rival_ticker: rivalTicker,
      resolved_rival: resolvedRival,
      ok: created.ok,
    });
    if (!created.ok) {
      if (created.reason === "duplicate") {
        return c.json({ error: "rivalry already exists", rivalryId: created.rivalry?.id }, 409);
      }
      if (created.reason === "same_ticker") {
        return c.json({ error: "a ticker cannot be its own rival" }, 400);
      }
      return c.json({ error: `at most ${MAX_RIVALRIES_PER_USER} rivalries per user` }, 429);
    }
    return c.json(await respondWithList(user.id), 201);
  });
});

/**
 * POST /v1/rivalries/:id/pick { pick: "ticker" | "rival" | null }
 *
 * Pre-registers (or clears) the conviction pick for the OPEN round. A correct
 * pick earns XP at the weekly close; the close then clears it, so a pick is
 * never carried into a round it wasn't registered for. Picks are deliberately
 * a separate route rather than a field on the create body, because
 * `CreateRivalryRequest` in `@mapvest/core` is the authoritative POST shape.
 *
 * 200 → RivalriesResponse; 400 → bad pick value; 404 → not the caller's row.
 */
rivalries.post("/:id/pick", async (c) => {
  return safeExecuteWithSpan("http.rivalries.pick", async (span) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { pick?: unknown };
    const value = body.pick;
    // `null` clears the pick; anything else that isn't a side is a 400 — an
    // unrecognized value must never silently clear a registered pick.
    const valid = value === "ticker" || value === "rival" || value === null;
    if (!valid) {
      return c.json({ error: 'pick must be "ticker", "rival", or null' }, 400);
    }
    const pick: RivalryPick | null = value;
    const updated = await setPick(user.id, id, pick);
    span.setAttributes({
      user_id: user.id,
      rivalry_id: id,
      pick: pick ?? "none",
      ok: Boolean(updated),
    });
    if (!updated) return c.json({ error: "rivalry not found" }, 404);
    return c.json(await respondWithList(user.id));
  });
});

/** DELETE /v1/rivalries/:id — 204; 404 when it isn't the caller's row. */
rivalries.delete("/:id", async (c) => {
  return safeExecuteWithSpan("http.rivalries.delete", async (span) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const removed = await deleteRivalry(user.id, id);
    span.setAttributes({ user_id: user.id, rivalry_id: id, removed });
    if (!removed) return c.json({ error: "rivalry not found" }, 404);
    return c.body(null, 204);
  });
});

export default rivalries;
