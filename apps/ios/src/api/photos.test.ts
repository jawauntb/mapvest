import { describe, expect, test } from "bun:test";
import {
  PhotoCaptureResponseSchema,
  PhotoGalleryResponseSchema,
  PhotoVoteResponseSchema,
} from "./photos";

function photo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "photo-1",
    companyId: "SBUX",
    userId: "usr_1",
    handle: "finder-abc123",
    photoUrl: "data:image/jpeg;base64,AAAA",
    lat: 40.7128,
    lng: -74.006,
    serverReceivedAt: "2026-09-17T00:00:00.000Z",
    score: 0,
    isFirstCapture: true,
    createdAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("PhotoCaptureResponseSchema", () => {
  test("parses a first-capture response", () => {
    const parsed = PhotoCaptureResponseSchema.parse({
      photo: photo(),
      isFirstCapture: true,
      firstCapturedBy: {
        userId: "usr_1",
        handle: "finder-abc123",
        at: "2026-09-17T00:00:00.000Z",
        photoId: "photo-1",
      },
      captureCount: 1,
    });
    expect(parsed.isFirstCapture).toBe(true);
    expect(parsed.firstCapturedBy?.handle).toBe("finder-abc123");
  });

  test("parses a non-first-capture response (firstCapturedBy belongs to someone else)", () => {
    const parsed = PhotoCaptureResponseSchema.parse({
      photo: photo({ id: "photo-2", isFirstCapture: false }),
      isFirstCapture: false,
      firstCapturedBy: { userId: "usr_0", at: "2026-09-01T00:00:00.000Z", photoId: "photo-0" },
      captureCount: 2,
    });
    expect(parsed.isFirstCapture).toBe(false);
    expect(parsed.captureCount).toBe(2);
  });
});

describe("PhotoGalleryResponseSchema", () => {
  test("happy path: sorted, non-empty gallery", () => {
    const parsed = PhotoGalleryResponseSchema.parse({
      companyId: "SBUX",
      firstCapturedBy: { userId: "usr_1", at: "2026-09-17T00:00:00.000Z", photoId: "photo-1" },
      captureCount: 2,
      photos: [
        photo({ isFirstCapture: true }),
        photo({ id: "photo-2", score: -1, isFirstCapture: false }),
      ],
    });
    expect(parsed.photos).toHaveLength(2);
    expect(parsed.photos[0]?.isFirstCapture).toBe(true);
  });

  test("empty-gallery case: zero submissions is a valid, well-formed response", () => {
    const parsed = PhotoGalleryResponseSchema.parse({
      companyId: "NEVER-CAPTURED",
      firstCapturedBy: null,
      captureCount: 0,
      photos: [],
    });
    expect(parsed.photos).toEqual([]);
    expect(parsed.firstCapturedBy).toBeNull();
    expect(parsed.captureCount).toBe(0);
  });
});

describe("PhotoVoteResponseSchema", () => {
  test("parses a vote response", () => {
    const parsed = PhotoVoteResponseSchema.parse({ photo: photo({ score: -1 }) });
    expect(parsed.photo.score).toBe(-1);
  });
});
