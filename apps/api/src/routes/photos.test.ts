import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { sign } from "hono/jwt";
import { app } from "../index.js";
import { __resetEntitlements } from "../lib/entitlements.js";
import { __resetMetrics } from "../lib/metrics.js";
import { __resetPhotosStore } from "../lib/photos-store.js";
import { ensureUser } from "../lib/store.js";
import { __resetRateLimit } from "../middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost${path}`;
}

async function sessionFor(id: string, email: string): Promise<string> {
  await ensureUser(id, email);
  const now = Math.floor(Date.now() / 1000);
  return sign(
    { purpose: "session", sub: id, email, iat: now, exp: now + 3600 },
    process.env.SESSION_SIGNING_KEY!,
  );
}

const ONE_PX_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // minimal fake JPEG bytes

function photoForm(
  overrides: Partial<{ captureSource: string; location: unknown; exifLocation: unknown }> = {},
) {
  const form = new FormData();
  form.set("image", new File([ONE_PX_JPEG], "capture.jpg", { type: "image/jpeg" }));
  form.set("captureSource", overrides.captureSource ?? "camera");
  form.set("location", JSON.stringify(overrides.location ?? { lat: 40.7128, lng: -74.006 }));
  if (overrides.exifLocation !== undefined) {
    form.set("exifLocation", JSON.stringify(overrides.exifLocation));
  }
  return form;
}

function postPhoto(companyId: string, token: string, idempotencyKey: string, form: FormData) {
  return app.fetch(
    new Request(url(`/v1/companies/${encodeURIComponent(companyId)}/photos`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey },
      body: form,
    }),
  );
}

function getGallery(companyId: string) {
  return app.fetch(new Request(url(`/v1/companies/${encodeURIComponent(companyId)}/photos`)));
}

function vote(photoId: string, token: string, direction: "up" | "down") {
  return app.fetch(
    new Request(url(`/v1/photos/${encodeURIComponent(photoId)}/vote`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ direction }),
    }),
  );
}

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

beforeEach(() => {
  __resetRateLimit();
  __resetMetrics();
  __resetEntitlements();
  __resetPhotosStore();
});

describe("POST /v1/companies/:id/photos", () => {
  test("requires auth", async () => {
    const res = await app.fetch(
      new Request(url("/v1/companies/SBUX/photos"), {
        method: "POST",
        headers: { "Idempotency-Key": "x" },
        body: photoForm(),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("requires an Idempotency-Key header", async () => {
    const token = await sessionFor(unique("u"), `${unique("idem")}@mapvest.dev`);
    const res = await app.fetch(
      new Request(url("/v1/companies/SBUX/photos"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: photoForm(),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("rejects a submission that doesn't claim to be a live camera capture — no submission is created", async () => {
    const companyId = unique("LIBCO");
    const token = await sessionFor(unique("u"), `${unique("lib")}@mapvest.dev`);
    const res = await postPhoto(
      companyId,
      token,
      unique("key"),
      photoForm({ captureSource: "library" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("library_capture_rejected");

    const galleryRes = await getGallery(companyId);
    const gallery = (await galleryRes.json()) as { photos: unknown[] };
    expect(gallery.photos.length).toBe(0);
  });

  test("rejects a missing captureSource the same way (no soft default to camera)", async () => {
    const companyId = unique("NOSRC");
    const token = await sessionFor(unique("u"), `${unique("nosrc")}@mapvest.dev`);
    const form = photoForm();
    form.delete("captureSource");
    const res = await postPhoto(companyId, token, unique("key"), form);
    expect(res.status).toBe(400);
  });

  test("rejects a geotag mismatch between the claimed location and EXIF — no submission is created", async () => {
    const companyId = unique("GEOCO");
    const token = await sessionFor(unique("u"), `${unique("geo")}@mapvest.dev`);
    const res = await postPhoto(
      companyId,
      token,
      unique("key"),
      photoForm({
        location: { lat: 40.7128, lng: -74.006 }, // NYC
        exifLocation: { lat: 34.0522, lng: -118.2437 }, // LA — miles away
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("geotag_mismatch");

    const galleryRes = await getGallery(companyId);
    const gallery = (await galleryRes.json()) as { photos: unknown[] };
    expect(gallery.photos.length).toBe(0);
  });

  test("accepts a matching EXIF location within TILE_RADIUS_M", async () => {
    const companyId = unique("GEOOK");
    const token = await sessionFor(unique("u"), `${unique("geook")}@mapvest.dev`);
    const res = await postPhoto(
      companyId,
      token,
      unique("key"),
      photoForm({
        location: { lat: 40.7128, lng: -74.006 },
        exifLocation: { lat: 40.713, lng: -74.0062 }, // a few meters away
      }),
    );
    expect(res.status).toBe(201);
  });

  test("first-ever submission for a company sets firstCapturedBy and captureCount=1", async () => {
    const companyId = unique("FIRSTCO");
    const token = await sessionFor(unique("u"), `${unique("first")}@mapvest.dev`);
    const res = await postPhoto(companyId, token, unique("key"), photoForm());
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      isFirstCapture: boolean;
      captureCount: number;
      firstCapturedBy: { userId: string } | null;
    };
    expect(body.isFirstCapture).toBe(true);
    expect(body.captureCount).toBe(1);
    expect(body.firstCapturedBy).not.toBeNull();
  });

  test("idempotent retry with the same Idempotency-Key returns the original result and spends no second credit", async () => {
    const companyId = unique("RETRYCO");
    const token = await sessionFor(unique("u"), `${unique("retry")}@mapvest.dev`);
    const key = unique("retry-key");

    const first = await postPhoto(companyId, token, key, photoForm());
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { photo: { id: string } };

    const retry = await postPhoto(companyId, token, key, photoForm());
    expect(retry.status).toBe(200); // not 201 — this is a replay, not a fresh first capture
    const retryBody = (await retry.json()) as { photo: { id: string } };
    expect(retryBody.photo.id).toBe(firstBody.photo.id);

    const galleryRes = await getGallery(companyId);
    const gallery = (await galleryRes.json()) as { photos: unknown[]; captureCount: number };
    expect(gallery.photos.length).toBe(1);
    expect(gallery.captureCount).toBe(1);
  });
});

describe("GET /v1/companies/:id/photos", () => {
  test("a company with zero submissions returns a clean empty gallery, not an error", async () => {
    const res = await getGallery(unique("EMPTYCO"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      photos: unknown[];
      firstCapturedBy: unknown;
      captureCount: number;
    };
    expect(body.photos).toEqual([]);
    expect(body.firstCapturedBy).toBeNull();
    expect(body.captureCount).toBe(0);
  });

  test("is public — no auth required", async () => {
    const res = await getGallery(unique("PUBLICCO"));
    expect(res.status).toBe(200);
  });
});

describe("POST /v1/photos/:id/vote", () => {
  test("requires auth", async () => {
    const res = await app.fetch(
      new Request(url("/v1/photos/whatever/vote"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction: "down" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("a downvote lowers score and never touches firstCapturedBy, even for the first-capture photo itself", async () => {
    const companyId = unique("VOTECO");
    const submitterToken = await sessionFor(unique("submitter"), `${unique("sub")}@mapvest.dev`);
    const voterToken = await sessionFor(unique("voter"), `${unique("voter")}@mapvest.dev`);

    const captureRes = await postPhoto(companyId, submitterToken, unique("key"), photoForm());
    const captured = (await captureRes.json()) as {
      isFirstCapture: boolean;
      photo: { id: string };
      firstCapturedBy: { userId: string; photoId: string };
    };
    expect(captured.isFirstCapture).toBe(true);

    const voteRes = await vote(captured.photo.id, voterToken, "down");
    expect(voteRes.status).toBe(200);
    const voted = (await voteRes.json()) as { photo: { score: number; isFirstCapture: boolean } };
    expect(voted.photo.score).toBe(-1);
    expect(voted.photo.isFirstCapture).toBe(true); // still the first capture — just downvoted

    const galleryRes = await getGallery(companyId);
    const gallery = (await galleryRes.json()) as {
      firstCapturedBy: { userId: string; photoId: string } | null;
    };
    expect(gallery.firstCapturedBy?.userId).toBe(captured.firstCapturedBy.userId);
    expect(gallery.firstCapturedBy?.photoId).toBe(captured.photo.id);
  });

  test("voting on an unknown photo id is a 404", async () => {
    const token = await sessionFor(unique("u"), `${unique("nf")}@mapvest.dev`);
    const res = await vote(unique("nope"), token, "up");
    expect(res.status).toBe(404);
  });
});
