import { BillingCheckoutRequest } from "@mapvest/core";
import { Hono } from "hono";
import {
  resolveBillingChannel,
  sanitizeReturnUrl,
  stripeSafeReturnUrl,
} from "../lib/billing-channel.js";
import { MONTHLY_PRICE_USD, getStripeCustomerId } from "../lib/entitlements.js";
import {
  appleIapProductId,
  googlePlayProductId,
  stripeCancelUrl,
  stripeConfigured,
  stripeSuccessUrl,
} from "../lib/env.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { createCheckoutSession, createPortalSession } from "../lib/stripe.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/**
 * Phase 8 Slice E — $20/mo subscription (checkout + portal only;
 * the webhook lives in `billingWebhook.ts` and is mounted separately so it
 * never sits behind `bearerAuth` or any body-consuming middleware).
 *
 * Checkout is platform-aware: iOS/Android return a native store channel once
 * those product ids are configured; otherwise Stripe Checkout (web + current
 * TestFlight). Clients must not invent a payment URL.
 */
const billing = new Hono<AuthEnv>();
billing.use("*", bearerAuth);

/**
 * POST /v1/billing/checkout
 * Body: { platform?: "web"|"ios"|"android", successUrl?, cancelUrl? }
 * Signed-in only. Native channels return a product id; Stripe returns a
 * hosted Checkout URL.
 */
billing.post("/checkout", async (c) => {
  return safeExecuteWithSpan("http.billing.checkout", async (span) => {
    const user = c.get("user");
    const raw = await c.req.json().catch(() => ({}));
    const parsed = BillingCheckoutRequest.safeParse(raw ?? {});
    const platform = parsed.success ? parsed.data.platform : "web";
    const channel = resolveBillingChannel(platform);
    span.setAttributes({ user_id: user.id, platform, channel });

    if (channel === "apple_iap") {
      const productId = appleIapProductId();
      if (!productId) return c.json({ error: "billing not configured" }, 503);
      return c.json({
        channel,
        productId,
        priceUsd: MONTHLY_PRICE_USD,
        interval: "month" as const,
      });
    }

    if (channel === "google_play") {
      const productId = googlePlayProductId();
      if (!productId) return c.json({ error: "billing not configured" }, 503);
      return c.json({
        channel,
        productId,
        priceUsd: MONTHLY_PRICE_USD,
        interval: "month" as const,
      });
    }

    if (!stripeConfigured()) {
      return c.json({ error: "billing not configured" }, 503);
    }
    const existingCustomerId = await getStripeCustomerId(user.id);
    span.setAttribute("has_existing_customer", !!existingCustomerId);
    const successUrl = stripeSafeReturnUrl(
      sanitizeReturnUrl(parsed.success ? parsed.data.successUrl : undefined),
      stripeSuccessUrl(),
    );
    const cancelUrl = stripeSafeReturnUrl(
      sanitizeReturnUrl(parsed.success ? parsed.data.cancelUrl : undefined),
      stripeCancelUrl(),
    );
    const url = await createCheckoutSession({
      userId: user.id,
      email: user.email,
      existingCustomerId,
      successUrl,
      cancelUrl,
    });
    if (!url) return c.json({ error: "billing not configured" }, 503);
    return c.json({
      channel: "stripe" as const,
      url,
      priceUsd: MONTHLY_PRICE_USD,
      interval: "month" as const,
    });
  });
});

/**
 * POST /v1/billing/portal
 * Creates a Stripe Billing Portal session so the user can manage/cancel
 * their subscription. Requires a Stripe customer id on file — i.e. the user
 * must have checked out at least once. Native-store subscribers manage
 * billing in App Store / Play, not here.
 */
billing.post("/portal", async (c) => {
  return safeExecuteWithSpan("http.billing.portal", async (span) => {
    if (!stripeConfigured()) {
      return c.json({ error: "billing not configured" }, 503);
    }
    const user = c.get("user");
    const customerId = await getStripeCustomerId(user.id);
    span.setAttributes({ user_id: user.id, has_customer: !!customerId });
    if (!customerId) {
      return c.json({ error: "no stripe customer on file — subscribe first" }, 400);
    }
    const url = await createPortalSession(customerId);
    if (!url) return c.json({ error: "billing not configured" }, 503);
    return c.json({ url });
  });
});

export default billing;
