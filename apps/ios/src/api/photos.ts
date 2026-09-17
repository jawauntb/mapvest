import { z } from "zod";
// Type-only: `./http` pulls in `@/util/deviceId` -> expo-secure-store
// transitively. Every function below defers its `apiFetch` import so a plain
// `bun test` of this file's schemas never has to load that native chain
// (same posture as `./handles.ts`).
import type { FetchOpts } from "./http";
import type { LatLng } from "./types";

/**
 * Global first capture + photo gallery (capture economy Item 3,
 * packages/design/HANDOFF_CAPTURE_ECONOMY.md):
 *
 *   POST /v1/companies/:id/photos  — submit a live-camera capture
 *   GET  /v1/companies/:id/photos  — the gallery, sorted server-side
 *   POST /v1/photos/:id/vote       — up/down a submission
 *
 * Companies are identified with the same key the rest of the client already
 * uses to route to a company's detail sheet (`investableTicker(top) ?? top.brand.name` —
 * see camera.tsx's `openDetail`), so a gallery submitted from the camera and
 * one read back from the detail sheet always land on the same company.
 *
 * Local re-declaration of `@mapvest/core`'s schemas (Metro doesn't need to
 * resolve the workspace package this way) — keep this in lockstep with
 * `packages/core/src/schemas/index.ts`. Source of truth: that file.
 */

export const FirstCapturedBySchema = z.object({
  userId: z.string(),
  handle: z.string().optional(),
  at: z.string(),
  photoId: z.string(),
});

export const PhotoSubmissionSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  userId: z.string(),
  handle: z.string().optional(),
  photoUrl: z.string(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  exifTimestamp: z.string().optional(),
  serverReceivedAt: z.string(),
  score: z.number(),
  isFirstCapture: z.boolean(),
  createdAt: z.string(),
});

export const PhotoCaptureResponseSchema = z.object({
  photo: PhotoSubmissionSchema,
  isFirstCapture: z.boolean(),
  firstCapturedBy: FirstCapturedBySchema.nullable(),
  captureCount: z.number(),
});

export const PhotoGalleryResponseSchema = z.object({
  companyId: z.string(),
  firstCapturedBy: FirstCapturedBySchema.nullable(),
  captureCount: z.number(),
  photos: z.array(PhotoSubmissionSchema),
});

export const PhotoVoteResponseSchema = z.object({
  photo: PhotoSubmissionSchema,
});

export type FirstCapturedBy = z.infer<typeof FirstCapturedBySchema>;
export type PhotoSubmission = z.infer<typeof PhotoSubmissionSchema>;
export type PhotoCaptureResponse = z.infer<typeof PhotoCaptureResponseSchema>;
export type PhotoGalleryResponse = z.infer<typeof PhotoGalleryResponseSchema>;
export type PhotoVoteResponse = z.infer<typeof PhotoVoteResponseSchema>;

/** The gallery for one company. Public — no token required. */
export async function fetchCompanyGallery(
  companyId: string,
  opts: FetchOpts = {},
): Promise<PhotoGalleryResponse> {
  const { apiFetch } = await import("./http");
  const res = await apiFetch<unknown>(
    `/v1/companies/${encodeURIComponent(companyId)}/photos`,
    { method: "GET" },
    opts,
  );
  return PhotoGalleryResponseSchema.parse(res);
}

export async function voteOnCompanyPhoto(
  photoId: string,
  direction: "up" | "down",
  opts: FetchOpts = {},
): Promise<PhotoVoteResponse> {
  const { apiFetch } = await import("./http");
  const res = await apiFetch<unknown>(
    `/v1/photos/${encodeURIComponent(photoId)}/vote`,
    { method: "POST", body: JSON.stringify({ direction }) },
    opts,
  );
  return PhotoVoteResponseSchema.parse(res);
}

const REQUEST_ID_STORAGE_PREFIX = "mapvest.photoCapture.requestId.v1.";

function randomUuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * A stable Idempotency-Key for one submission attempt, keyed by `attemptKey`
 * (the capture's local file URI is a good choice — it is unique per capture
 * and unchanged across a retry of that SAME capture, and stable-yet-distinct
 * from a fresh Retake, which produces a new URI). Persisted so a retry after
 * a dropped connection reuses the SAME id rather than regenerating one —
 * the whole point of the server-side idempotency guarantee.
 */
export async function clientRequestIdFor(attemptKey: string): Promise<string> {
  const storageKey = `${REQUEST_ID_STORAGE_PREFIX}${attemptKey}`;
  // Deferred import: AsyncStorage pulls in native module resolution that a
  // plain `bun test` of this file's schemas doesn't need to load.
  try {
    const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
    const existing = await AsyncStorage.getItem(storageKey);
    if (existing) return existing;
    const next = randomUuid();
    await AsyncStorage.setItem(storageKey, next);
    return next;
  } catch {
    // Storage unavailable — still return a stable-for-this-process id so the
    // caller's request isn't blocked; it just won't survive an app restart.
    return randomUuid();
  }
}

export type SubmitCompanyPhotoInput = {
  /** Local file:// URI of a LIVE-CAMERA capture. Never a library pick — the
   *  server rejects anything else outright. */
  imageUri: string;
  location?: LatLng;
  clientRequestId: string;
};

/**
 * Submit a live-camera photo to a company's gallery. Multipart, mirroring
 * `identifyPhoto` in `./client.ts` (React Native's FormData file value is
 * `{uri, name, type}`; `fetch` sets the multipart boundary itself — never
 * set Content-Type by hand here).
 */
export async function submitCompanyPhoto(
  companyId: string,
  input: SubmitCompanyPhotoInput,
  opts: FetchOpts,
): Promise<PhotoCaptureResponse> {
  const form = new FormData();
  form.append("image", {
    uri: input.imageUri,
    name: "capture.jpg",
    type: "image/jpeg",
    // biome-ignore lint/suspicious/noExplicitAny: React Native FormData file value shape
  } as any);
  form.append("captureSource", "camera");
  if (input.location) {
    form.append("location", JSON.stringify(input.location));
  }

  const { getDeviceId } = await import("@/util/deviceId");
  const { API_URL } = await import("@/util/env");
  const headers = new Headers();
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  headers.set("Accept", "application/json");
  headers.set("Idempotency-Key", input.clientRequestId);
  try {
    headers.set("X-Device-Id", await getDeviceId());
  } catch {
    /* SecureStore unavailable — request proceeds without device id */
  }

  const res = await fetch(`${API_URL}/v1/companies/${encodeURIComponent(companyId)}/photos`, {
    method: "POST",
    body: form,
    headers,
    signal: opts.signal,
  });
  if (!res.ok) {
    const { apiErrorFromResponse } = await import("./errors");
    const text = await res.text().catch(() => "");
    throw apiErrorFromResponse(res.status, text, res.statusText);
  }
  return PhotoCaptureResponseSchema.parse(await res.json());
}
