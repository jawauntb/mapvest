import type {
  FirstCapturedBy,
  PhotoCaptureResponse,
  PhotoGalleryResponse,
  PhotoSubmission,
} from "@mapvest/core";
import { Hono } from "hono";
import { distanceM } from "../lib/nearby-resolve.js";
import {
  type GalleryPhoto,
  canonicalCompanyId,
  getCompanyCapture,
  listGallery,
  submitPhoto,
  voteOnPhoto,
} from "../lib/photos-store.js";
import { getUserById } from "../lib/store.js";
import { TILE_RADIUS_M } from "../lib/territory.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";
import { requireGenerationQuota } from "../middleware/requireGenerationQuota.js";

/**
 * Global first capture + photo gallery (capture economy Item 3,
 * packages/design/HANDOFF_CAPTURE_ECONOMY.md). Two routers, mounted at
 * different prefixes in index.ts:
 *
 *   POST /v1/companies/:id/photos  — submit a live-camera capture
 *   GET  /v1/companies/:id/photos  — the gallery (public, no auth)
 *   POST /v1/photos/:id/vote       — up/down a submission
 *
 * Anti-fraud floor (non-negotiable, see the handoff doc):
 *   - Live-camera-only. Neither `/v1/identify` nor `apps/ios/src/util/pickImage.ts`
 *     carry any existing signal distinguishing a camera shot from a library
 *     pick, so this is the endpoint that starts requiring one: the client
 *     must send `captureSource=camera` on the multipart body, or the request
 *     is rejected outright (400) before a submission is ever created.
 *   - Geotag/EXIF vs. claimed location. The client sends `location` (the
 *     claimed capture point) and, best-effort, `exifLocation` (the photo's
 *     own embedded GPS, when the device/OS provides one). When both are
 *     present and disagree by more than `TILE_RADIUS_M`, the request is
 *     rejected (422) with no submission created — never silently accepted.
 *     `exifLocation` is honestly best-effort (see PR description / knownGaps
 *     for why): when the client can't supply it, this specific check simply
 *     has nothing to compare and passes on the claimed location alone.
 *   - Race arbitration and idempotency both live in `../lib/photos-store.js` —
 *     this route never computes or forwards a client timestamp for
 *     `serverReceivedAt`, and always requires an `Idempotency-Key` header.
 *   - Credits: metered by the SAME `identify` quota pool `/v1/identify`
 *     already uses (`requireGenerationQuota("identify", ...)`), keyed by the
 *     same Idempotency-Key so a retried upload never spends a second credit —
 *     no second currency, no separate counter.
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // matches identify.ts

/** `{lat,lng}` JSON field, tolerant of absence/garbage — same shape as identify.ts's `location`. */
function parseLatLngField(form: FormData, field: string): { lat: number; lng: number } | undefined {
  const raw = form.get(field);
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown };
    if (
      typeof parsed.lat === "number" &&
      typeof parsed.lng === "number" &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng)
    ) {
      return { lat: parsed.lat, lng: parsed.lng };
    }
  } catch {
    // malformed JSON — treated as absent
  }
  return undefined;
}

async function handleToDisplay(userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  const user = await getUserById(userId).catch(() => undefined);
  return user?.handle;
}

async function firstCapturedByDto(
  firstCapturedBy: Awaited<ReturnType<typeof getCompanyCapture>>["firstCapturedBy"],
): Promise<FirstCapturedBy | null> {
  if (!firstCapturedBy) return null;
  return { ...firstCapturedBy, handle: await handleToDisplay(firstCapturedBy.userId) };
}

async function photoDto(photo: GalleryPhoto): Promise<PhotoSubmission> {
  return {
    id: photo.id,
    companyId: photo.companyId,
    userId: photo.userId,
    handle: await handleToDisplay(photo.userId),
    photoUrl: photo.photoUrl,
    lat: photo.lat,
    lng: photo.lng,
    exifTimestamp: photo.exifTimestamp,
    serverReceivedAt: photo.serverReceivedAt,
    score: photo.score,
    isFirstCapture: photo.isFirstCapture,
    createdAt: photo.createdAt,
  };
}

const companies = new Hono<AuthEnv>();

// Idempotency-keyed quota: reuses the SAME "identify" pool/counter every other
// billable generation draws from (identify, memo, agent chat) — a capture
// attempt is one more generation against that one meter, not a second
// currency. Keying the quota's own dedupe on the Idempotency-Key header means
// a retried upload never spends a second credit even before the store-level
// idempotency check below runs.
const capturePhotoQuota = requireGenerationQuota(
  "identify",
  (c) => c.req.header("Idempotency-Key")?.trim() || undefined,
);

companies.post("/:id/photos", bearerAuth, capturePhotoQuota, async (c) => {
  const user = c.get("user");
  const companyId = canonicalCompanyId(c.req.param("id") ?? "");
  if (!companyId) return c.json({ error: "company id required" }, 400);

  const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return c.json({ error: "Idempotency-Key header required" }, 400);
  }

  const declaredLen = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_IMAGE_BYTES) {
    return c.json({ error: "image too large (max 8MB)" }, 413);
  }

  const form = await c.req.formData();
  const file = form.get("image");
  if (!(file instanceof File)) {
    return c.json({ error: "image required" }, 400);
  }
  if (!file.type || !file.type.startsWith("image/")) {
    return c.json({ error: "unsupported media type (expected image/*)" }, 415);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return c.json({ error: "image too large (max 8MB)" }, 413);
  }

  // Live-camera-only floor. Reject anything else outright — this is not a
  // soft hint, and no submission is created for a rejected request.
  const captureSource = form.get("captureSource");
  if (captureSource !== "camera") {
    return c.json(
      {
        error: "captures must come straight from the live camera, not the photo library",
        code: "library_capture_rejected" as const,
      },
      400,
    );
  }

  const location = parseLatLngField(form, "location");
  if (!location) {
    return c.json({ error: "location required" }, 400);
  }

  // Geotag/EXIF vs. claimed location, within the same TILE_RADIUS_M the rest
  // of the territory system uses. Best-effort on the client's side (see the
  // module doc) — when the client has no EXIF location to offer, there is
  // nothing to cross-check and this specific guard passes.
  const exifLocation = parseLatLngField(form, "exifLocation");
  if (exifLocation) {
    const driftM = distanceM(location.lat, location.lng, exifLocation.lat, exifLocation.lng);
    if (driftM > TILE_RADIUS_M) {
      return c.json(
        {
          error: "this photo's location doesn't match the claimed capture location",
          code: "geotag_mismatch" as const,
        },
        422,
      );
    }
  }

  const exifTimestamp = form.get("exifTimestamp");

  const bytes = new Uint8Array(await file.arrayBuffer());
  // No blob storage exists anywhere in this repo yet (grepped — none), so v1
  // stores the capture inline as a data URL, same 8MB cap as identify.ts.
  // Flagged in the PR description / knownGaps as a deliberate, bounded v1
  // choice rather than new unrelated infra for this one item.
  const photoUrl = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;

  const result = await submitPhoto({
    companyId,
    userId: user.id,
    photoUrl,
    lat: location.lat,
    lng: location.lng,
    exifTimestamp: typeof exifTimestamp === "string" && exifTimestamp ? exifTimestamp : undefined,
    clientRequestId: idempotencyKey,
  });

  const resp: PhotoCaptureResponse = {
    photo: await photoDto({ ...result.photo, isFirstCapture: result.isFirstCapture }),
    isFirstCapture: result.isFirstCapture,
    firstCapturedBy: await firstCapturedByDto(result.firstCapturedBy),
    captureCount: result.captureCount,
  };
  return c.json(resp, result.isFirstCapture && !result.idempotentReplay ? 201 : 200);
});

// Public read — anyone viewing a company's detail sheet sees its gallery,
// signed in or not.
companies.get("/:id/photos", async (c) => {
  const companyId = canonicalCompanyId(c.req.param("id") ?? "");
  if (!companyId) return c.json({ error: "company id required" }, 400);

  const gallery = await listGallery(companyId);
  const resp: PhotoGalleryResponse = {
    companyId: gallery.companyId,
    firstCapturedBy: await firstCapturedByDto(gallery.firstCapturedBy),
    captureCount: gallery.captureCount,
    photos: await Promise.all(gallery.photos.map((p) => photoDto(p))),
  };
  return c.json(resp);
});

const photoVotes = new Hono<AuthEnv>();

photoVotes.post("/:id/vote", bearerAuth, async (c) => {
  const photoId = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as { direction?: unknown } | null;
  const direction = body?.direction;
  if (direction !== "up" && direction !== "down") {
    return c.json({ error: 'direction must be "up" or "down"' }, 400);
  }

  const result = await voteOnPhoto(photoId, direction);
  if (!result) return c.json({ error: "photo not found" }, 404);

  const capture = await getCompanyCapture(result.photo.companyId);
  const isFirstCapture = capture.firstCapturedBy?.photoId === result.photo.id;
  return c.json({ photo: await photoDto({ ...result.photo, isFirstCapture }) });
});

export default companies;
export { photoVotes };
