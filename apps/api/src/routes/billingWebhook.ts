import { Hono } from "hono";
import type Stripe from "stripe";
import {
  clearSubscription,
  findUserIdByStripeCustomerId,
  markSubscribed,
} from "../lib/entitlements.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { stripeConfigured, verifyWebhookSignature } from "../lib/stripe.js";

/**
 * Phase 8 Slice E — Stripe webhook. Mounted at `/v1/billing/webhook`
 * BEFORE the bearer-authed `/v1/billing` router in `index.ts` — Stripe
 * calls this unauthenticated, and signature verification needs the exact
 * raw request body, so this route (deliberately) never runs behind
 * `bearerAuth` or any JSON body-parsing middleware. We read the body with
 * `c.req.text()` ourselves and verify it against `Stripe-Signature`.
 */
const billingWebhook = new Hono();

async function resolveUserId(
  metadataUserId: string | undefined,
  clientReferenceId: string | null | undefined,
  stripeCustomerId: string | null | undefined,
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  if (clientReferenceId) return clientReferenceId;
  if (stripeCustomerId) return findUserIdByStripeCustomerId(stripeCustomerId);
  return null;
}

/** Subscription statuses that count as "actively subscribed" for our purposes. */
const ACTIVE_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing"]);

billingWebhook.post("/", async (c) => {
  return safeExecuteWithSpan("http.billing.webhook", async (span) => {
    if (!stripeConfigured()) {
      return c.json({ error: "billing not configured" }, 503);
    }
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature");
    const event = await verifyWebhookSignature(rawBody, signature);
    if (!event) {
      span.setAttribute("verified", false);
      return c.json({ error: "invalid signature" }, 400);
    }
    span.setAttributes({ verified: true, event_type: event.type, event_id: event.id });

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        const userId = await resolveUserId(
          session.metadata?.userId,
          session.client_reference_id,
          customerId,
        );
        span.setAttributes({
          user_id: userId,
          customer_id: customerId,
          subscription_id: subscriptionId,
        });
        if (userId && customerId && subscriptionId) {
          await markSubscribed(userId, {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
        const userId = await resolveUserId(subscription.metadata?.userId, null, customerId);
        span.setAttributes({
          user_id: userId,
          customer_id: customerId,
          subscription_id: subscription.id,
          status: subscription.status,
        });
        if (!userId || !customerId) break;
        if (ACTIVE_STATUSES.has(subscription.status)) {
          await markSubscribed(userId, {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
          });
        } else {
          await clearSubscription(userId);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer?.id;
        const userId = await resolveUserId(subscription.metadata?.userId, null, customerId);
        span.setAttributes({
          user_id: userId,
          customer_id: customerId,
          subscription_id: subscription.id,
        });
        if (userId) await clearSubscription(userId);
        break;
      }
      default:
        break;
    }

    return c.json({ received: true });
  });
});

export default billingWebhook;
