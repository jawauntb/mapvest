/**
 * Phase 8 Slice E — Stripe $20/mo subscription.
 *
 * Thin wrapper around the official `stripe` npm package (works fine on Bun —
 * no need to hand-roll the REST calls over fetch). Every export degrades
 * gracefully to `null`/`false` when Stripe env vars are unset so local dev
 * and unit tests don't need real Stripe keys; callers turn that into a 503.
 */
import Stripe from "stripe";
import {
  stripeCancelUrl,
  stripeConfigured,
  stripePriceIdMonthly,
  stripeSecretKey,
  stripeSuccessUrl,
  stripeWebhookSecret,
} from "./env.js";

let client: Stripe | null = null;

/** Lazily-constructed singleton; `undefined` until first call after env is set. */
export function getStripeClient(): Stripe | null {
  if (!stripeConfigured()) return null;
  if (!client) {
    client = new Stripe(stripeSecretKey() as string, {
      appInfo: { name: "mapvest-api", version: "0.1.0-alpha.0" },
    });
  }
  return client;
}

export { stripeConfigured };

/**
 * Creates a Checkout Session (mode=subscription) for the $20/mo price.
 * `client_reference_id` + `metadata.userId` both carry the Mapvest user id so
 * the webhook can resolve the subscriber even if `customer_email` changes.
 */
export async function createCheckoutSession(params: {
  userId: string;
  email: string;
  existingCustomerId?: string | null;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<string | null> {
  const stripe = getStripeClient();
  const priceId = stripePriceIdMonthly();
  if (!stripe || !priceId) return null;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: params.userId,
    customer: params.existingCustomerId ?? undefined,
    customer_email: params.existingCustomerId ? undefined : params.email,
    metadata: { userId: params.userId },
    subscription_data: { metadata: { userId: params.userId } },
    success_url: params.successUrl ?? stripeSuccessUrl(),
    cancel_url: params.cancelUrl ?? stripeCancelUrl(),
  });
  return session.url;
}

/** Creates a Billing Portal session for an existing Stripe customer. */
export async function createPortalSession(customerId: string): Promise<string | null> {
  const stripe = getStripeClient();
  if (!stripe) return null;
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: stripeSuccessUrl(),
  });
  return session.url;
}

/**
 * Verifies the `Stripe-Signature` header against the raw request body.
 * Returns `null` on any failure (missing secret, bad signature, tampered
 * body) — callers must treat `null` as "reject the webhook".
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
): Promise<Stripe.Event | null> {
  const stripe = getStripeClient();
  const secret = stripeWebhookSecret();
  if (!stripe || !secret || !signature) return null;
  try {
    return await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    return null;
  }
}

/** Test-only helper to force a fresh client (e.g. after mutating env vars). */
export function __resetStripeClient(): void {
  client = null;
}
