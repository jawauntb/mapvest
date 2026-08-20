/**
 * Events — global quest/find XP modifiers (Universe Roadmap §1 A7).
 *
 * Routes (no auth — the event schedule is global, not per-user):
 *   GET /current → EventsResponse { active: ActiveEvent | null }
 *
 * Mounted by the integrator at /v1/events.
 *
 * Derived on read from the clock alone (`lib/events.ts`): there is no events
 * table and no scheduler row, so this handler cannot serve a window that a
 * background job forgot to close. `active` is explicitly `null` when nothing
 * is open, so the client can tell "no event" from a failed fetch.
 */
import type { EventsResponse } from "@mapvest/core";
import { Hono } from "hono";
import { activeEvent } from "../lib/events.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";

const events = new Hono();

events.get("/current", async (c) => {
  return safeExecuteWithSpan("http.events.current", async (span) => {
    const active = activeEvent(new Date());
    span.setAttributes({
      event_key: active?.key,
      event_sector: active?.sector,
      event_multiplier: active?.multiplier,
      active: Boolean(active),
    });
    const resp: EventsResponse = { active };
    // The window only changes at a UTC day boundary; a short cache absorbs
    // the client polling it on every app foreground.
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.json(resp);
  });
});

export default events;
