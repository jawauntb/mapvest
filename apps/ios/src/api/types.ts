// Local re-declaration of @mapvest/core schemas so Metro doesn't need to
// resolve the workspace package. Keep this in exact lockstep with
// packages/core/src/schemas/index.ts — if you touch either file, touch both.
//
// Source of truth: /packages/core/src/schemas/index.ts

import { z } from "zod";

// -------- primitives --------

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const Source = z.object({
  provider: z.enum(["exa", "openrouter", "gemini", "yahoo", "polygon", "sec", "manual"]),
  url: z.string().url().optional(),
  fetchedAt: z.string(),
  confidence: Confidence,
});
export type Source = z.infer<typeof Source>;

export const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type LatLng = z.infer<typeof LatLng>;

// -------- domain --------

export const Ticker = z.object({
  symbol: z.string(),
  exchange: z.string().optional(),
  parent: z.string().optional(),
});
export type Ticker = z.infer<typeof Ticker>;

export const Brand = z.object({
  name: z.string(),
  parent: z.string().optional(),
  isPublic: z.boolean(),
  ticker: Ticker.optional(),
  sector: z.string().optional(),
  logo: z.string().url().optional(),
});
export type Brand = z.infer<typeof Brand>;

export const EtfExposure = z.object({
  ticker: z.string(),
  name: z.string(),
  weight: z.number().min(0).max(1),
  source: Source,
});
export type EtfExposure = z.infer<typeof EtfExposure>;

export const Comparable = z.object({
  ticker: z.string(),
  name: z.string(),
  score: z.number().min(0).max(1),
  reasoning: z.string(),
  sources: z.array(Source),
});
export type Comparable = z.infer<typeof Comparable>;

export const Investable = z.object({
  brand: Brand,
  comparables: z.array(Comparable).default([]),
  etfs: z.array(EtfExposure).default([]),
  confidence: Confidence,
  sources: z.array(Source),
});
export type Investable = z.infer<typeof Investable>;

export const PhotoIdentification = z.object({
  visibleText: z.array(z.string()).default([]),
  detected: z.array(
    z.object({
      brand: z.string().optional(),
      product: z.string().optional(),
      sector: z.string().optional(),
      confidence: Confidence,
    }),
  ),
  location: LatLng.optional(),
  modelUsed: z.string(),
});
export type PhotoIdentification = z.infer<typeof PhotoIdentification>;

// -------- API DTOs --------

export const IdentifyRequest = z.object({
  location: LatLng.optional(),
});
export type IdentifyRequest = z.infer<typeof IdentifyRequest>;

// Image-space bounding box for a locked-on detection. Coordinates are
// normalized to [0,1] against the *displayed* preview frame so the overlay
// can position pills without knowing the original image resolution.
export const DetectionBox = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type DetectionBox = z.infer<typeof DetectionBox>;

export const Detection = z.object({
  box: DetectionBox,
  ticker: z.string(),
  name: z.string().optional(),
  // Numeric confidence in [0,1]. Distinct from the categorical `Confidence`
  // enum used elsewhere — this lets the overlay scale glow intensity smoothly.
  confidence: z.number().min(0).max(1),
});
export type Detection = z.infer<typeof Detection>;

// Note: `detections` is CLIENT-SIDE forward-compat only. The current
// /v1/identify response does not include it; when absent, the camera screen
// synthesizes a single detection from `investables[0]`.
export const IdentifyResponse = z.object({
  identification: PhotoIdentification,
  investables: z.array(Investable),
  detections: z.array(Detection).optional(),
});
export type IdentifyResponse = z.infer<typeof IdentifyResponse>;

export const NearbyRequest = z.object({
  lat: z.number(),
  lng: z.number(),
  radius: z.number().default(500),
  limit: z.number().default(25),
});
export type NearbyRequest = z.infer<typeof NearbyRequest>;

export const NearbyItem = z.object({
  place: z.object({
    id: z.string(),
    name: z.string(),
    location: LatLng,
    types: z.array(z.string()).default([]),
  }),
  investable: Investable.optional(),
});
export type NearbyItem = z.infer<typeof NearbyItem>;

export const NearbyResponse = z.object({
  items: z.array(NearbyItem),
});
export type NearbyResponse = z.infer<typeof NearbyResponse>;

export const ResolveComparableRequest = z.object({
  brand: z.string(),
  hintSector: z.string().optional(),
});
export type ResolveComparableRequest = z.infer<typeof ResolveComparableRequest>;

export const ResolveComparableResponse = z.object({
  brand: Brand,
  comparables: z.array(Comparable),
  etfs: z.array(EtfExposure),
});
export type ResolveComparableResponse = z.infer<typeof ResolveComparableResponse>;

/** Daily Yahoo close for the native Overview price chart. `ts` is unix seconds. */
export const QuoteHistoryPoint = z.object({
  ts: z.number(),
  close: z.number(),
});
export type QuoteHistoryPoint = z.infer<typeof QuoteHistoryPoint>;

export const QuoteHistoryResponse = z.object({
  ticker: z.string(),
  period: z.enum(["1mo", "3mo", "6mo", "1y"]),
  points: z.array(QuoteHistoryPoint),
  sources: z.array(Source),
});
export type QuoteHistoryResponse = z.infer<typeof QuoteHistoryResponse>;

// -------- auth --------

export const User = z.object({
  id: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
  scopes: z.array(z.enum(["user", "admin"])).default(["user"]),
});
export type User = z.infer<typeof User>;

export const Session = z.object({
  token: z.string(),
  userId: z.string(),
  expiresAt: z.string(),
});
export type Session = z.infer<typeof Session>;

// -------- entitlements + billing (keep lockstep with packages/core) --------

export const Plan = z.enum(["none", "free_trial", "free_forever", "subscribed"]);
export type Plan = z.infer<typeof Plan>;

export const EntitlementState = z.object({
  plan: Plan,
  remaining: z.number().int().min(0),
  limit: z.number().int().min(0),
  freeForever: z.boolean(),
  subscribed: z.boolean(),
  canGenerate: z.boolean(),
  canPersist: z.boolean(),
});
export type EntitlementState = z.infer<typeof EntitlementState>;

export const QuotaExceeded = z.object({
  error: z.string(),
  code: z.literal("quota_exceeded"),
  remaining: z.number().int().min(0),
  limit: z.number().int().min(0),
  priceUsd: z.number().optional(),
  interval: z.literal("month").optional(),
});
export type QuotaExceeded = z.infer<typeof QuotaExceeded>;

export const BillingPlatform = z.enum(["web", "ios", "android"]);
export type BillingPlatform = z.infer<typeof BillingPlatform>;

export const BillingChannel = z.enum(["stripe", "apple_iap", "google_play"]);
export type BillingChannel = z.infer<typeof BillingChannel>;

export const BillingCheckoutRequest = z.object({
  platform: BillingPlatform.default("web"),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
});
export type BillingCheckoutRequest = z.infer<typeof BillingCheckoutRequest>;

export const BillingCheckoutResponse = z.object({
  channel: BillingChannel,
  url: z.string().url().optional(),
  productId: z.string().optional(),
  priceUsd: z.number(),
  interval: z.literal("month"),
});
export type BillingCheckoutResponse = z.infer<typeof BillingCheckoutResponse>;

export const BillingPortalResponse = z.object({
  url: z.string().url(),
});
export type BillingPortalResponse = z.infer<typeof BillingPortalResponse>;
