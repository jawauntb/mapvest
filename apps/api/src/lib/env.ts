/**
 * Env accessors with dev-safe defaults so the API boots without Doppler in local tests.
 * In production these MUST be supplied via Doppler (`mapvest/prd`) or Railway.
 */

const DEV_DEFAULT_WARNING = (name: string) =>
  `[env] ${name} not set — using dev default. DO NOT ship this to prod.`;

let warned = new Set<string>();
function warnOnce(name: string) {
  if (warned.has(name)) return;
  warned.add(name);
  if (process.env.NODE_ENV !== "test") console.warn(DEV_DEFAULT_WARNING(name));
}

export function sessionSigningKey(): string {
  const v = process.env.SESSION_SIGNING_KEY;
  if (v && v.length >= 16) return v;
  warnOnce("SESSION_SIGNING_KEY");
  return "dev-session-signing-key-change-me";
}

export function mapsSigningKey(): string {
  const v = process.env.IOS_MAPS_TOKEN_SIGNING_KEY;
  if (v && v.length >= 16) return v;
  warnOnce("IOS_MAPS_TOKEN_SIGNING_KEY");
  return "dev-maps-signing-key-change-me";
}

export function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function googleMapsKey(): string | undefined {
  return process.env.GOOGLE_MAPS_API_KEY;
}

export function postgresUrl(): string | undefined {
  return process.env.POSTGRES_URL || undefined;
}

// ---- Stripe (Phase 8 Slice E — $19.99/mo subscription) ----

const LANDING_APP_URL = "https://mapvest.app/app";

export function stripeSecretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY || undefined;
}

export function stripeWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET || undefined;
}

export function stripePriceIdMonthly(): string | undefined {
  return process.env.STRIPE_PRICE_ID_MONTHLY || undefined;
}

/** True once the minimum Stripe env is present; checkout/portal 503 otherwise. */
export function stripeConfigured(): boolean {
  return Boolean(stripeSecretKey() && stripePriceIdMonthly());
}

export function stripeSuccessUrl(): string {
  return process.env.STRIPE_SUCCESS_URL || LANDING_APP_URL;
}

export function stripeCancelUrl(): string {
  return process.env.STRIPE_CANCEL_URL || LANDING_APP_URL;
}

/**
 * App Store Connect product id for Mapvest Pro. When set, iOS checkout
 * returns `channel: "apple_iap"` instead of a Stripe URL (Guideline 3.1.1).
 * Leave unset on Railway until the StoreKit client build is on TestFlight
 * so older builds keep Stripe Safari.
 */
export function appleIapProductId(): string | undefined {
  const v = process.env.APPLE_IAP_PRODUCT_ID?.trim();
  return v || undefined;
}

/** Bundle id the StoreKit JWS must carry. Defaults to the shipped iOS id. */
export function appleBundleId(): string {
  const v = process.env.APPLE_BUNDLE_ID?.trim();
  return v || "com.mapvest.app";
}

/**
 * Play Billing product id. Unset until the Android v0.2 store listing exists.
 * Do not treat this as permission to ship a Play build.
 */
export function googlePlayProductId(): string | undefined {
  const v = process.env.GOOGLE_PLAY_PRODUCT_ID?.trim();
  return v || undefined;
}

/** Test-only helper — resets the once-warned set. */
export function __resetEnvWarnings() {
  warned = new Set<string>();
}
