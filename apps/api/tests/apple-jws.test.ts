import { afterEach, describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.APPLE_BUNDLE_ID = "com.mapvest.app";
process.env.APPLE_IAP_PRODUCT_ID = "mapvest_pro_monthly";

import {
  APPLE_ROOT_CA_G3_FINGERPRINT_SHA256,
  APPLE_ROOT_CA_G3_PEM,
  AppleJwsError,
  __setAppleJwsVerifier,
  assertAppleSubscription,
  verifyAppleSignedTransactionLive,
} from "../src/lib/apple-jws.js";

afterEach(() => {
  __setAppleJwsVerifier(undefined);
});

function tx(overrides: Partial<Parameters<typeof assertAppleSubscription>[0]> = {}) {
  return {
    bundleId: "com.mapvest.app",
    productId: "mapvest_pro_monthly",
    transactionId: "txn_1",
    originalTransactionId: "orig_1",
    type: "Auto-Renewable Subscription",
    environment: "Sandbox",
    expiresDate: Date.now() + 86_400_000,
    ...overrides,
  };
}

describe("Apple Root CA pin", () => {
  test("embedded PEM matches the published SHA-256 fingerprint", () => {
    const cert = new X509Certificate(APPLE_ROOT_CA_G3_PEM);
    expect(cert.fingerprint256.toUpperCase()).toBe(APPLE_ROOT_CA_G3_FINGERPRINT_SHA256);
  });
});

describe("verifyAppleSignedTransactionLive", () => {
  test("rejects garbage", () => {
    expect(() => verifyAppleSignedTransactionLive("not-a-jws")).toThrow(AppleJwsError);
  });

  test("rejects a three-part token that is not ES256 with x5c", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ productId: "x" })).toString("base64url");
    expect(() => verifyAppleSignedTransactionLive(`${header}.${payload}.c2ln`)).toThrow(
      /unsupported jws header/,
    );
  });
});

describe("assertAppleSubscription", () => {
  test("accepts a live sandbox auto-renewable for Mapvest Pro", () => {
    const out = assertAppleSubscription(tx());
    expect(out.originalTransactionId).toBe("orig_1");
  });

  test("rejects the wrong bundle or product", () => {
    expect(() => assertAppleSubscription(tx({ bundleId: "com.other.app" }))).toThrow(
      /bundle mismatch/,
    );
    expect(() => assertAppleSubscription(tx({ productId: "other_sku" }))).toThrow(
      /product mismatch/,
    );
  });

  test("rejects expired and revoked transactions", () => {
    expect(() => assertAppleSubscription(tx({ expiresDate: Date.now() - 1000 }))).toThrow(
      /expired/,
    );
    expect(() => assertAppleSubscription(tx({ revocationDate: Date.now() }))).toThrow(/revoked/);
  });

  test("rejects non-subscription types", () => {
    expect(() => assertAppleSubscription(tx({ type: "Consumable" }))).toThrow(/not a subscription/);
  });
});
