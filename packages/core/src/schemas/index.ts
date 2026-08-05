import { z } from "zod";

// -------- primitives --------

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const Source = z.object({
  provider: z.enum(["exa", "openrouter", "gemini", "yahoo", "polygon", "sec", "manual"]),
  url: z.string().url().optional(),
  fetchedAt: z.string(), // ISO
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

/**
 * Delayed market quote — Yahoo v7 chart endpoint, cached in-process. Attached
 * best-effort by /v1/identify; consumers must treat it as optional and must
 * surface the `disclaimer` text verbatim (Yahoo TOS: 15-min delay).
 */
export const Quote = z.object({
  symbol: z.string(),
  price: z.number(),
  change: z.number(),
  changePct: z.number(),
  currency: z.string(),
  ts: z.string(), // ISO
  disclaimer: z.string(),
});
export type Quote = z.infer<typeof Quote>;

export const Investable = z.object({
  brand: Brand,
  comparables: z.array(Comparable).default([]),
  etfs: z.array(EtfExposure).default([]),
  confidence: Confidence,
  sources: z.array(Source),
  quote: Quote.optional(),
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
  // image is transported as multipart in HTTP; not part of the JSON schema
});
export type IdentifyRequest = z.infer<typeof IdentifyRequest>;

export const IdentifyResponse = z.object({
  identification: PhotoIdentification,
  investables: z.array(Investable),
});
export type IdentifyResponse = z.infer<typeof IdentifyResponse>;

export const NearbyRequest = z.object({
  lat: z.number(),
  lng: z.number(),
  radius: z.number().default(500), // meters
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

/**
 * Chart image proxied from underlying-analyzer-reboot
 * (`POST /api/charts/<type>`). `image.data` is raw base64 (no data: prefix).
 */
export const ChartResponse = z.object({
  ticker: z.string(),
  type: z.string().optional(),
  period: z.string(),
  image: z.object({
    mime: z.string(),
    data: z.string(),
    filename: z.string().optional(),
  }),
  levels: z
    .object({
      poc: z.number().optional(),
      vah: z.number().optional(),
      val: z.number().optional(),
    })
    .optional(),
  meta: z.record(z.unknown()).optional(),
  provider: z.string().optional(),
  providerNote: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});
export type ChartResponse = z.infer<typeof ChartResponse>;

/** @deprecated alias — prefer ChartResponse */
export const AuctionChartResponse = ChartResponse;
export type AuctionChartResponse = ChartResponse;

export const AnalysisSnapshot = z.object({
  ticker: z.string(),
  name: z.string().optional(),
  sector: z.string().optional(),
  industry: z.string().optional(),
  price: z.number().optional(),
  change: z.number().optional(),
  changePercent: z.number().optional(),
  marketCap: z.union([z.string(), z.number()]).optional(),
  trailingPe: z.union([z.string(), z.number()]).optional(),
  annualVolatility: z.number().optional(),
  fiftyTwoWeekHigh: z.number().optional(),
  fiftyTwoWeekLow: z.number().optional(),
  brief: z.string().optional(),
  briefProvider: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});
export type AnalysisSnapshot = z.infer<typeof AnalysisSnapshot>;

export const CockpitRow = z.object({
  rank: z.number().optional(),
  ticker: z.string(),
  score: z.number().optional(),
  lane: z.string().optional(),
  ridge: z.union([z.string(), z.number()]).optional(),
  flow: z.union([z.string(), z.number()]).optional(),
  auction: z.union([z.string(), z.number()]).optional(),
}).passthrough();
export type CockpitRow = z.infer<typeof CockpitRow>;

export const CockpitResponse = z.object({
  rows: z.array(CockpitRow),
  tickers: z.array(z.string()),
  meta: z.record(z.unknown()).optional(),
  sourceUrl: z.string().url().optional(),
});
export type CockpitResponse = z.infer<typeof CockpitResponse>;

export const AlertItem = z.object({
  ticker: z.string().optional(),
  title: z.string().optional(),
  severity: z.union([z.string(), z.number()]).optional(),
  summary: z.string().optional(),
  message: z.string().optional(),
}).passthrough();
export type AlertItem = z.infer<typeof AlertItem>;

export const AlertsResponse = z.object({
  alerts: z.array(AlertItem),
  tickers: z.array(z.string()),
  meta: z.record(z.unknown()).optional(),
  sourceUrl: z.string().url().optional(),
});
export type AlertsResponse = z.infer<typeof AlertsResponse>;

// -------- sibling link-outs (v0.1 scaffold, see docs/SYSTEM_DESIGN.md D10) --------

/**
 * v0.1 scaffold response shared by every sibling-repo link-out endpoint
 * (`/v1/options`, `/v1/underlying`, and any future ones). In v0.1 the API
 * returns `{ linkOut, note }` plus whatever request params were echoed;
 * in v0.2 these endpoints will proxy to the deployed sibling service and
 * return the sibling's real payload instead.
 *
 * Keeping this in `packages/core` so the iOS client, the landing page, and
 * the API all agree on the wire shape without redeclaring it inline.
 */
export const LinkOut = z.object({
  linkOut: z.string().url(),
  note: z.string(),
});
export type LinkOut = z.infer<typeof LinkOut>;

export const OptionsLinkOut = LinkOut.extend({
  ticker: z.string(),
});
export type OptionsLinkOut = z.infer<typeof OptionsLinkOut>;

export const UnderlyingLinkOut = LinkOut.extend({
  brand: z.string().optional(),
  sector: z.string().optional(),
});
export type UnderlyingLinkOut = z.infer<typeof UnderlyingLinkOut>;

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
