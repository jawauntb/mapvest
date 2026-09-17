import { describe, expect, test } from "bun:test";
import {
  PHOTO_DOWNVOTE_XP_COST,
  canonicalCompanyId,
  getCompanyCapture,
  listGallery,
  submitPhoto,
  voteOnPhoto,
  winsCapture,
} from "./photos-store.js";
import { awardXp, getProgress } from "./progress-store.js";

/** Unique per test so no `__reset*` for progress-store is needed. */
function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

describe("canonicalCompanyId", () => {
  test("matches findIdentityKey's convention: trim + uppercase", () => {
    expect(canonicalCompanyId(" sbux ")).toBe("SBUX");
    expect(canonicalCompanyId("some private brand")).toBe("SOME PRIVATE BRAND");
  });
});

describe("winsCapture", () => {
  test("anything wins against no existing claim", () => {
    expect(winsCapture("2026-01-01T00:00:00.000Z", undefined)).toBe(true);
    expect(winsCapture("2026-01-01T00:00:00.000Z", null)).toBe(true);
  });

  test("an earlier timestamp wins; a later or equal one does not", () => {
    expect(winsCapture("2026-01-01T00:00:01.000Z", "2026-01-01T00:00:05.000Z")).toBe(true);
    expect(winsCapture("2026-01-01T00:00:05.000Z", "2026-01-01T00:00:01.000Z")).toBe(false);
    expect(winsCapture("2026-01-01T00:00:01.000Z", "2026-01-01T00:00:01.000Z")).toBe(false);
  });
});

describe("submitPhoto — race arbitration (non-negotiable)", () => {
  test("the earlier serverReceivedAt wins regardless of submission/call order", async () => {
    const companyId = uid("RACE");
    // Submitted FIRST in call order, but its own server-clock reading is
    // LATER — it should win only until the truly-earlier one lands.
    const later = await submitPhoto({
      companyId,
      userId: uid("user-later"),
      photoUrl: "data:image/jpeg;base64,AAAA",
      clientRequestId: uid("req"),
      serverReceivedAt: "2026-01-01T00:00:05.000Z",
    });
    expect(later.isFirstCapture).toBe(true); // true at the moment it was processed

    // Submitted SECOND in call order, but its server-clock reading is
    // EARLIER — this is the one that must end up crowned.
    const earlier = await submitPhoto({
      companyId,
      userId: uid("user-earlier"),
      photoUrl: "data:image/jpeg;base64,BBBB",
      clientRequestId: uid("req"),
      serverReceivedAt: "2026-01-01T00:00:01.000Z",
    });
    expect(earlier.isFirstCapture).toBe(true);
    expect(earlier.firstCapturedBy?.userId).toBe(earlier.photo.userId);

    const capture = await getCompanyCapture(companyId);
    expect(capture.firstCapturedBy?.userId).toBe(earlier.photo.userId);
    expect(capture.firstCapturedBy?.photoId).toBe(earlier.photo.id);
    expect(capture.captureCount).toBe(2);
  });

  test("once the true-earliest submission has landed, a later one never overrides it", async () => {
    const companyId = uid("RACE2");
    const first = await submitPhoto({
      companyId,
      userId: uid("user-first"),
      photoUrl: "data:image/jpeg;base64,AAAA",
      clientRequestId: uid("req"),
      serverReceivedAt: "2026-01-01T00:00:01.000Z",
    });
    expect(first.isFirstCapture).toBe(true);

    const second = await submitPhoto({
      companyId,
      userId: uid("user-second"),
      photoUrl: "data:image/jpeg;base64,BBBB",
      clientRequestId: uid("req"),
      serverReceivedAt: "2026-01-01T00:00:05.000Z",
    });
    expect(second.isFirstCapture).toBe(false);

    const capture = await getCompanyCapture(companyId);
    expect(capture.firstCapturedBy?.userId).toBe(first.photo.userId);
    expect(capture.captureCount).toBe(2);
  });
});

describe("submitPhoto — idempotent retry", () => {
  test("the same clientRequestId returns the ORIGINAL result: no second row, no re-arbitration", async () => {
    const companyId = uid("IDEMP");
    const userId = uid("user");
    const clientRequestId = uid("retry-key");

    const first = await submitPhoto({
      companyId,
      userId,
      photoUrl: "data:image/jpeg;base64,AAAA",
      clientRequestId,
    });
    const retry = await submitPhoto({
      companyId,
      userId,
      // Different bytes / metadata on the retry attempt — still the SAME
      // logical attempt because the Idempotency-Key is identical.
      photoUrl: "data:image/jpeg;base64,ZZZZ",
      lat: 1,
      lng: 2,
      clientRequestId,
    });

    expect(retry.photo.id).toBe(first.photo.id);
    expect(retry.photo.photoUrl).toBe(first.photo.photoUrl); // original wins, not the retry's payload
    expect(retry.idempotentReplay).toBe(true);
    expect(first.idempotentReplay).toBe(false);

    const capture = await getCompanyCapture(companyId);
    expect(capture.captureCount).toBe(1); // not double-counted

    const gallery = await listGallery(companyId);
    expect(gallery.photos.length).toBe(1); // no second row
  });

  test("a different user retrying with the same key text does not collide (idempotency is per-user)", async () => {
    const companyId = uid("IDEMP2");
    const sameKey = "shared-literal-key";
    const a = await submitPhoto({
      companyId,
      userId: uid("user-a"),
      photoUrl: "x",
      clientRequestId: sameKey,
    });
    const b = await submitPhoto({
      companyId,
      userId: uid("user-b"),
      photoUrl: "y",
      clientRequestId: sameKey,
    });
    expect(b.photo.id).not.toBe(a.photo.id);
    expect(b.idempotentReplay).toBe(false);
  });
});

describe("voteOnPhoto — downvote never touches firstCapturedBy", () => {
  test("downvoting the FIRST-CAPTURE submission lowers score and debits the submitter's XP, but leaves firstCapturedBy untouched", async () => {
    const companyId = uid("DOWNVOTE");
    const submitterId = uid("submitter");
    await awardXp(submitterId, 100, uid("seed-grant"));
    const before = await getProgress(submitterId);

    const captured = await submitPhoto({
      companyId,
      userId: submitterId,
      photoUrl: "data:image/jpeg;base64,AAAA",
      clientRequestId: uid("req"),
    });
    expect(captured.isFirstCapture).toBe(true);

    // Downvote it heavily.
    for (let i = 0; i < 3; i++) {
      await voteOnPhoto(captured.photo.id, "down");
    }

    const voted = await voteOnPhoto(captured.photo.id, "down");
    expect(voted?.photo.score).toBe(-4);

    const after = await getProgress(submitterId);
    expect(after.xp).toBe(before.xp - 4 * PHOTO_DOWNVOTE_XP_COST);

    const capture = await getCompanyCapture(companyId);
    expect(capture.firstCapturedBy?.userId).toBe(submitterId);
    expect(capture.firstCapturedBy?.photoId).toBe(captured.photo.id);
  });

  test("an upvote raises score and never debits XP", async () => {
    const companyId = uid("UPVOTE");
    const submitterId = uid("submitter");
    await awardXp(submitterId, 50, uid("seed-grant"));
    const before = await getProgress(submitterId);

    const submitted = await submitPhoto({
      companyId,
      userId: submitterId,
      photoUrl: "x",
      clientRequestId: uid("req"),
    });
    const voted = await voteOnPhoto(submitted.photo.id, "up");
    expect(voted?.photo.score).toBe(1);

    const after = await getProgress(submitterId);
    expect(after.xp).toBe(before.xp);
  });

  test("voting on a photo that doesn't exist returns null", async () => {
    const result = await voteOnPhoto(uid("nope"), "down");
    expect(result).toBeNull();
  });
});

describe("listGallery — sort order and empty state", () => {
  test("zero submissions is a clean empty gallery, not an error", async () => {
    const gallery = await listGallery(uid("EMPTY"));
    expect(gallery.photos).toEqual([]);
    expect(gallery.firstCapturedBy).toBeNull();
    expect(gallery.captureCount).toBe(0);
  });

  test("sorted: isFirstCapture first, then score DESC, then createdAt ASC as tiebreak", async () => {
    const companyId = uid("SORT");

    const first = await submitPhoto({
      companyId,
      userId: uid("u1"),
      photoUrl: "a",
      clientRequestId: uid("req"),
      serverReceivedAt: "2026-01-01T00:00:01.000Z",
    });
    const low = await submitPhoto({
      companyId,
      userId: uid("u2"),
      photoUrl: "b",
      clientRequestId: uid("req"),
      serverReceivedAt: "2026-01-01T00:00:02.000Z",
    });
    const highEarlier = await submitPhoto({
      companyId,
      userId: uid("u3"),
      photoUrl: "c",
      clientRequestId: uid("req"),
      serverReceivedAt: "2026-01-01T00:00:03.000Z",
    });
    const highLater = await submitPhoto({
      companyId,
      userId: uid("u4"),
      photoUrl: "d",
      clientRequestId: uid("req"),
      serverReceivedAt: "2026-01-01T00:00:04.000Z",
    });

    // Give highEarlier and highLater the same score so createdAt breaks the tie.
    await voteOnPhoto(highEarlier.photo.id, "up");
    await voteOnPhoto(highEarlier.photo.id, "up");
    await voteOnPhoto(highLater.photo.id, "up");
    await voteOnPhoto(highLater.photo.id, "up");
    await voteOnPhoto(low.photo.id, "up");

    const gallery = await listGallery(companyId);
    expect(gallery.photos.map((p) => p.id)).toEqual([
      first.photo.id, // first capture always leads, regardless of score
      highEarlier.photo.id, // score 2, earlier createdAt
      highLater.photo.id, // score 2, later createdAt
      low.photo.id, // score 1
    ]);
    expect(gallery.photos[0]?.isFirstCapture).toBe(true);
    expect(gallery.photos.slice(1).every((p) => !p.isFirstCapture)).toBe(true);
  });
});
