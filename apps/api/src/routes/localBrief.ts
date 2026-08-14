/**
 * Local Economy Brief — three-paragraph read describing the economic character
 * of a lat/lng, plus persistence for "Location folder" saves.
 *
 * Routes (all bearer-required):
 *   POST   /v1/local-brief             { lat, lng, city?, state?, zip? }
 *     → { paragraphs, place, nearbyCount, generatedAt }
 *   POST   /v1/local-brief/save        { label, lat, lng, brief, place }
 *     → { id }
 *   GET    /v1/local-brief/saved
 *     → { items: SavedLocalBrief[] }
 *   DELETE /v1/local-brief/saved/:id
 *     → 204
 *
 * On any LLM error the generator returns a stub (never 500); the endpoint
 * therefore always responds 200 with a payload the client can render.
 */

import { Hono } from "hono";
import { bearerAuth, type AuthEnv } from "../middleware/bearerAuth.js";
import {
  generateLocalBrief,
  OUTAGE_LOCAL_BRIEF,
} from "../lib/local-brief-generator.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { onLocalBriefGenerated } from "../lib/notifiers/localBriefNotifier.js";
import {
  deleteSavedLocalBrief,
  listSavedLocalBriefs,
  saveLocalBrief as persistSaveLocalBrief,
} from "../lib/saved-locations-store.js";

const localBrief = new Hono<AuthEnv>();
localBrief.use("*", bearerAuth);

// ---- POST /v1/local-brief ----
localBrief.post("/", async (c) => {
  return safeExecuteWithSpan("http.local_brief.generate", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      lat?: number;
      lng?: number;
      neighborhood?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ error: "lat/lng required" }, 400);
    }
    const user = c.get("user");
    span.setAttributes({
      user_id: user.id,
      lat,
      lng,
      supplied_city: Boolean(body.city),
    });

    try {
      const brief = await generateLocalBrief({
        lat,
        lng,
        neighborhood: body.neighborhood,
        city: body.city,
        state: body.state,
        zip: body.zip,
      });
      span.setAttributes({
        nearby_count: brief.nearbyCount,
        has_place: Boolean(brief.place.city),
      });
      // Fire-and-forget push. Opted-in users see a "Local economy — <city>"
      // notification; dedupe ensures a rapid re-open path doesn't spam. A push
      // failure MUST NEVER block the primary response.
      onLocalBriefGenerated(user.id, brief, { lat, lng }).catch(() => {});
      return c.json(brief);
    } catch (err) {
      // Belt-and-suspenders: the generator already swallows LLM errors, but
      // any *other* throw (e.g. unhandled network) still needs to return 200.
      span.recordException(err);
      return c.json({
        paragraphs: OUTAGE_LOCAL_BRIEF.paragraphs,
        place: { city: body.city, state: body.state, zip: body.zip },
        nearbyCount: 0,
        generatedAt: new Date().toISOString(),
      });
    }
  });
});

// ---- POST /v1/local-brief/save ----
localBrief.post("/save", async (c) => {
  return safeExecuteWithSpan("http.local_brief.save", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      label?: string;
      lat?: number;
      lng?: number;
      brief?: string;
      place?: { city?: string; state?: string; zip?: string };
    };
    const label = (body.label ?? "").toString().trim();
    const brief = (body.brief ?? "").toString();
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!label) return c.json({ error: "label required" }, 400);
    if (!brief || brief.length < 20) {
      return c.json({ error: "brief text required (min 20 chars)" }, 400);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return c.json({ error: "lat/lng required" }, 400);
    }
    const user = c.get("user");
    const entry = await persistSaveLocalBrief(user.id, {
      label,
      lat,
      lng,
      brief,
      city: body.place?.city,
      state: body.place?.state,
      zip: body.place?.zip,
    });
    span.setAttributes({
      user_id: user.id,
      id: entry.id,
      label_len: label.length,
      brief_len: brief.length,
    });
    return c.json({ id: entry.id });
  });
});

// ---- GET /v1/local-brief/saved ----
localBrief.get("/saved", async (c) => {
  return safeExecuteWithSpan("http.local_brief.list", async (span) => {
    const user = c.get("user");
    const items = await listSavedLocalBriefs(user.id);
    span.setAttributes({ user_id: user.id, items_count: items.length });
    return c.json({ items });
  });
});

// ---- DELETE /v1/local-brief/saved/:id ----
localBrief.delete("/saved/:id", async (c) => {
  return safeExecuteWithSpan("http.local_brief.delete", async (span) => {
    const id = c.req.param("id");
    const user = c.get("user");
    const removed = await deleteSavedLocalBrief(user.id, id);
    span.setAttributes({ user_id: user.id, id, removed });
    // 204 No Content per contract.
    return new Response(null, { status: 204 });
  });
});

export default localBrief;
