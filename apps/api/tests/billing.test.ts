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
import { __setAppleJwsVerifier } from "../src/lib/apple-jws.js";
import {
  resolveBillingChannel,
  sanitizeReturnUrl,
  stripeSafeReturnUrl,
} from "../src/lib/billing-channel.js";
import { MONTHLY_PRICE_USD, __resetEntitlements } from "../src/lib/entitlements.js";
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
  __resetEntitlements();
  __setAppleJwsVerifier(undefined);
  process.env.APPLE_IAP_PRODUCT_ID = "";
  process.env.GOOGLE_PLAY_PRODUCT_ID = "";
  process.env.STRIPE_SECRET_KEY = "";
  process.env.STRIPE_PRICE_ID_MONTHLY = "";
  process.env.APPLE_BUNDLE_ID = "com.mapvest.app";
});

afterEach(() => {
  process.env.APPLE_IAP_PRODUCT_ID = "";
  process.env.GOOGLE_PLAY_PRODUCT_ID = "";
  __setAppleJwsVerifier(undefined);
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

describe("POST /v1/billing/apple", () => {
  test("requires a session", async () => {
    const res = await app.fetch(
      new Request(url("/billing/apple"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedTransaction: "a".repeat(40) }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("rejects an untrusted JWS", async () => {
    const token = await signIn("apple-bad@example.com");
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ productId: "x" })).toString("base64url");
    const res = await app.fetch(
      new Request(url("/billing/apple"), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ signedTransaction: `${header}.${payload}.${"c".repeat(40)}` }),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("a verified sandbox subscription marks the user subscribed", async () => {
    process.env.APPLE_IAP_PRODUCT_ID = "mapvest_pro_monthly";
    __setAppleJwsVerifier(async () => ({
      bundleId: "com.mapvest.app",
      productId: "mapvest_pro_monthly",
      transactionId: "1000000123456789",
      originalTransactionId: "1000000000000001",
      type: "Auto-Renewable Subscription",
      environment: "Sandbox",
      expiresDate: Date.now() + 30 * 86_400_000,
    }));
    const token = await signIn("apple-ok@example.com");
    const res = await app.fetch(
      new Request(url("/billing/apple"), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ signedTransaction: "a".repeat(40) }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subscribed: boolean; plan: string; canGenerate: boolean };
    expect(body.subscribed).toBe(true);
    expect(body.plan).toBe("subscribed");
    expect(body.canGenerate).toBe(true);

    const ent = await app.fetch(
      new Request(url("/entitlements"), { headers: { authorization: `Bearer ${token}` } }),
    );
    const state = (await ent.json()) as { subscribed: boolean };
    expect(state.subscribed).toBe(true);
  });

  test("does not let a second account steal an originalTransactionId", async () => {
    process.env.APPLE_IAP_PRODUCT_ID = "mapvest_pro_monthly";
    __setAppleJwsVerifier(async () => ({
      bundleId: "com.mapvest.app",
      productId: "mapvest_pro_monthly",
      transactionId: "2000000123456789",
      originalTransactionId: "shared-orig-txn",
      type: "Auto-Renewable Subscription",
      environment: "Sandbox",
      expiresDate: Date.now() + 86_400_000,
    }));
    const a = await signIn("apple-a@example.com");
    const first = await app.fetch(
      new Request(url("/billing/apple"), {
        method: "POST",
        headers: { authorization: `Bearer ${a}`, "content-type": "application/json" },
        body: JSON.stringify({ signedTransaction: "a".repeat(40) }),
      }),
    );
    expect(first.status).toBe(200);
    const b = await signIn("apple-b@example.com");
    const second = await app.fetch(
      new Request(url("/billing/apple"), {
        method: "POST",
        headers: { authorization: `Bearer ${b}`, "content-type": "application/json" },
        body: JSON.stringify({ signedTransaction: "b".repeat(40) }),
      }),
    );
    expect(second.status).toBe(409);
  });
});
