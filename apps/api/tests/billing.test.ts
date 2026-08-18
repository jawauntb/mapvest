import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";
process.env.ADMIN_EMAILS = "admin@mapvest.dev";
process.env.POSTGRES_URL = undefined;
process.env.STRIPE_SECRET_KEY = undefined;
process.env.STRIPE_PRICE_ID_MONTHLY = undefined;
process.env.APPLE_IAP_PRODUCT_ID = undefined;
process.env.GOOGLE_PLAY_PRODUCT_ID = undefined;

import { app } from "../src/index.js";
import {
  resolveBillingChannel,
  sanitizeReturnUrl,
  stripeSafeReturnUrl,
} from "../src/lib/billing-channel.js";
import { MONTHLY_PRICE_USD } from "../src/lib/entitlements.js";
import { __resetEnvWarnings } from "../src/lib/env.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { __resetStore } from "../src/lib/store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

function url(path: string) {
  return `http://localhost/v1${path}`;
}

async function signIn(email: string): Promise<string> {
  const req = await app.fetch(
    new Request(url("/auth/session"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  const body = (await req.json()) as { devCode?: string };
  expect(body.devCode).toBeDefined();
  const verify = await app.fetch(
    new Request(url("/auth/session/verify"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code: body.devCode }),
    }),
  );
  expect(verify.status).toBe(200);
  const session = (await verify.json()) as { session: { token: string } };
  return session.session.token;
}

beforeEach(() => {
  __resetStore();
  __resetMetrics();
  __resetRateLimit();
  __resetEnvWarnings();
  process.env.APPLE_IAP_PRODUCT_ID = "";
  process.env.GOOGLE_PLAY_PRODUCT_ID = "";
  process.env.STRIPE_SECRET_KEY = "";
  process.env.STRIPE_PRICE_ID_MONTHLY = "";
});

afterEach(() => {
  process.env.APPLE_IAP_PRODUCT_ID = "";
  process.env.GOOGLE_PLAY_PRODUCT_ID = "";
});

describe("resolveBillingChannel", () => {
  test("defaults to stripe on every platform when native products are unset", () => {
    expect(resolveBillingChannel("web")).toBe("stripe");
    expect(resolveBillingChannel("ios")).toBe("stripe");
    expect(resolveBillingChannel("android")).toBe("stripe");
  });

  test("ios uses apple_iap only when APPLE_IAP_PRODUCT_ID is set", () => {
    process.env.APPLE_IAP_PRODUCT_ID = "mapvest_pro_monthly";
    expect(resolveBillingChannel("ios")).toBe("apple_iap");
    expect(resolveBillingChannel("web")).toBe("stripe");
    expect(resolveBillingChannel("android")).toBe("stripe");
  });

  test("android uses google_play only when GOOGLE_PLAY_PRODUCT_ID is set", () => {
    process.env.GOOGLE_PLAY_PRODUCT_ID = "mapvest_pro_monthly";
    expect(resolveBillingChannel("android")).toBe("google_play");
    expect(resolveBillingChannel("ios")).toBe("stripe");
  });
});

describe("sanitizeReturnUrl", () => {
  test("allows Mapvest https and the app billing deep links", () => {
    expect(sanitizeReturnUrl("https://mapvest.app/app?billing=success")).toBe(
      "https://mapvest.app/app?billing=success",
    );
    expect(sanitizeReturnUrl("mapvest://billing/success")).toBe("mapvest://billing/success");
    expect(sanitizeReturnUrl("mapvest://billing/cancel")).toBe("mapvest://billing/cancel");
  });

  test("rejects open redirects", () => {
    expect(sanitizeReturnUrl("https://evil.example/phish")).toBeUndefined();
    expect(sanitizeReturnUrl("mapvest://not-billing")).toBeUndefined();
    expect(sanitizeReturnUrl("javascript:alert(1)")).toBeUndefined();
  });

  test("stripeSafeReturnUrl drops custom schemes", () => {
    expect(stripeSafeReturnUrl("mapvest://billing/success", "https://mapvest.app/app")).toBe(
      "https://mapvest.app/app",
    );
    expect(stripeSafeReturnUrl("https://mapvest.app/app?billing=success", "https://fallback")).toBe(
      "https://mapvest.app/app?billing=success",
    );
  });
});

describe("POST /v1/billing/checkout", () => {
  test("requires a session", async () => {
    const res = await app.fetch(
      new Request(url("/billing/checkout"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "web" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 503 for stripe when keys are unset", async () => {
    const token = await signIn("payer@example.com");
    const res = await app.fetch(
      new Request(url("/billing/checkout"), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ platform: "web" }),
      }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/billing not configured/);
  });

  test("ios + APPLE_IAP_PRODUCT_ID returns apple_iap without Stripe", async () => {
    process.env.APPLE_IAP_PRODUCT_ID = "mapvest_pro_monthly";
    const token = await signIn("iap@example.com");
    const res = await app.fetch(
      new Request(url("/billing/checkout"), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ platform: "ios" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      channel: string;
      productId?: string;
      url?: string;
      priceUsd: number;
      interval: string;
    };
    expect(body.channel).toBe("apple_iap");
    expect(body.productId).toBe("mapvest_pro_monthly");
    expect(body.url).toBeUndefined();
    expect(body.priceUsd).toBe(MONTHLY_PRICE_USD);
    expect(body.interval).toBe("month");
  });
});
