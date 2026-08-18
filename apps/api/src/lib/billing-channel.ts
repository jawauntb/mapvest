/**
 * Maps a client platform to a charge channel.
 *
 * App Store 3.1.1 and Play's digital-goods rule both require the native store
 * kit once those products exist. Until `APPLE_IAP_PRODUCT_ID` /
 * `GOOGLE_PLAY_PRODUCT_ID` are set, checkout falls through to Stripe so the
 * web app (and older TestFlight builds) can take payment. New iOS builds
 * purchase through StoreKit regardless and redeem via `POST /v1/billing/apple`.
 */
import type { BillingChannel, BillingPlatform } from "@mapvest/core";
import { appleIapProductId, googlePlayProductId } from "./env.js";

export function resolveBillingChannel(platform: BillingPlatform): BillingChannel {
  if (platform === "ios" && appleIapProductId()) return "apple_iap";
  if (platform === "android" && googlePlayProductId()) return "google_play";
  return "stripe";
}

/**
 * Checkout return URLs must stay on Mapvest surfaces. Reject anything else
 * so a crafted body cannot bounce a paid session through an attacker origin.
 */
const ALLOWED_RETURN = [
  /^https:\/\/mapvest\.app(?:\/[\w./-]*)?(?:\?[\w=&.-]*)?$/,
  /^https:\/\/www\.mapvest\.app(?:\/[\w./-]*)?(?:\?[\w=&.-]*)?$/,
  /^mapvest:\/\/billing\/(?:success|cancel)$/,
];

export function sanitizeReturnUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return ALLOWED_RETURN.some((re) => re.test(trimmed)) ? trimmed : undefined;
}

/** Stripe Checkout only accepts https return URLs. Drop custom schemes. */
export function stripeSafeReturnUrl(url: string | undefined, fallback: string): string {
  if (url && /^https:\/\//i.test(url) && sanitizeReturnUrl(url)) return url;
  return fallback;
}
