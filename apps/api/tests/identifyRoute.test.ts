import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { app } from "../src/index.js";
import { __resetEntitlements } from "../src/lib/entitlements.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { __resetIdentifyGuards } from "../src/middleware/identifyGuards.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost/v1${path}`;
}

// requireGenerationQuota (Phase 8 Slice C) requires either a session or an
// X-Device-Id header on every /v1/identify call — these guard tests are
// anonymous, so they all need a device id to get past the quota check.
const DEVICE_ID = "test-device-identify-guards";

beforeEach(() => {
  __resetRateLimit();
  __resetIdentifyGuards();
  __resetMetrics();
  __resetEntitlements();
});

describe("POST /v1/identify validation guards", () => {
  test("returns 400 when no image field is present", async () => {
    const form = new FormData();
    form.set("lat", "37.77");
    form.set("lng", "-122.42");
    const res = await app.fetch(
      new Request(url("/identify"), {
        method: "POST",
        headers: { "X-Device-Id": DEVICE_ID },
        body: form,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("image required");
  });

  test("returns 415 when the uploaded file is not image/*", async () => {
    const form = new FormData();
    form.set(
      "image",
      new File(["hello, this is not an image"], "notes.txt", {
        type: "text/plain",
      }),
    );
    const res = await app.fetch(
      new Request(url("/identify"), {
        method: "POST",
        headers: { "X-Device-Id": DEVICE_ID },
        body: form,
      }),
    );
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("unsupported media type");
  });

  test("returns 413 when the uploaded image exceeds the 8 MB cap", async () => {
    // 9 MB of zero bytes — over the 8 MB limit.
    const oversized = new Uint8Array(9 * 1024 * 1024);
    const form = new FormData();
    form.set("image", new File([oversized], "big.jpg", { type: "image/jpeg" }));
    const res = await app.fetch(
      new Request(url("/identify"), {
        method: "POST",
        headers: { "X-Device-Id": DEVICE_ID },
        body: form,
      }),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("image too large");
  });
});
