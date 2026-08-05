import { Hono } from "hono";
import { getStripeCustomerId } from "../lib/entitlements.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { createCheckoutSession, createPortalSession } from "../lib/stripe.js";
import { stripeConfigured } from "../lib/env.js";
import { type AuthEnv, bearerAuth } from "../middleware/bearerAuth.js";

/**
 * Phase 8 Slice E — Stripe $20/mo subscription (checkout + portal only;
 * the webhook lives in `billingWebhook.ts` and is mounted separately so it
 * never sits behind `bearerAuth` or any body-consuming middleware).
 */
const billing = new Hono<AuthEnv>();
billing.use("*", bearerAuth);

/**
 * POST /v1/billing/checkout
 * Creates a Stripe Checkout Session (mode=subscription, $20/mo price) for
 * the signed-in user and returns its redirect URL. Reuses the existing
 * Stripe customer if the user already has one (e.g. a lapsed subscriber
 * resubscribing) so Stripe doesn't fork a second customer record.
 */
billing.post("/checkout", async (c) => {
  return safeExecuteWithSpan("http.billing.checkout", async (span) => {
    if (!stripeConfigured()) {
      return c.json({ error: "billing not configured" }, 503);
    }
    const user = c.get("user");
    const existingCustomerId = await getStripeCustomerId(user.id);
    span.setAttributes({ user_id: user.id, has_existing_customer: !!existingCustomerId });
    const url = await createCheckoutSession({
      userId: user.id,
      email: user.email,
      existingCustomerId,
    });
    if (!url) return c.json({ error: "billing not configured" }, 503);
    return c.json({ url });
  });
});

/**
 * POST /v1/billing/portal
 * Creates a Stripe Billing Portal session so the user can manage/cancel
 * their subscription. Requires a Stripe customer id on file — i.e. the user
 * must have checked out at least once.
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
