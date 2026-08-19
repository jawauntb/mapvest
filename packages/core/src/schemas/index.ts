import { z } from "zod";

// -------- primitives --------

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const Source = z.object({
  provider: z.enum(["exa", "openrouter", "gemini", "massive", "yahoo", "polygon", "sec", "manual"]),
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
 * Provider-routed market quote, cached in-process. Attached best-effort by
 * /v1/identify; consumers must treat it as optional and surface the
 * `disclaimer` text verbatim because freshness follows the active subscription.
 */
export const Quote = z.object({
  symbol: z.string(),
  price: z.number(),
  change: z.number(),
  changePct: z.number(),
  currency: z.string(),
  ts: z.string(), // ISO
  disclaimer: z.string(),
  name: z.string().optional(),
  provider: z.enum(["massive", "yahoo"]).optional(),
  freshness: z.enum(["real-time", "delayed", "end-of-day", "unknown"]).optional(),
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

/**
 * One entry in a signed-in user's "finds journal". Recorded server-side after
 * every successful /v1/identify (top investable only); read back newest-first
 * via GET /v1/finds. `ticker` is set for public brands, `comparable` for
 * private brands (closest public comparable's ticker).
 */
export const Find = z.object({
  id: z.string(),
  brand: z.string(),
  ticker: z.string().optional(),
  isPublic: z.boolean().optional(),
  comparable: z.string().optional(),
  confidence: Confidence,
  lat: z.number().optional(),
  lng: z.number().optional(),
  foundPrice: z.number().optional(),
  createdAt: z.string(), // ISO
});
export type Find = z.infer<typeof Find>;

export const FindsResponse = z.object({
  finds: z.array(Find),
  count: z.number(),
});
export type FindsResponse = z.infer<typeof FindsResponse>;

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

// -------- home-screen widgets (iOS WidgetKit / Android App Widget) --------

/**
 * Trimmed nearby item for a home-screen widget tile — a widget refreshes on
 * a timeline (every 15-60 min) so the payload stays tiny and cheap. See
 * `GET /v1/widget/nearby` in apps/api and the widget extension sources under
 * apps/ios/targets/widget (iOS) and apps/ios/widgets (Android).
 */
export const WidgetNearbyItem = z.object({
  name: z.string(),
  ticker: z.string().optional(),
  isPublic: z.boolean().optional(),
  sector: z.string().optional(),
  distanceM: z.number().optional(),
  price: z.number().optional(),
  changePct: z.number().optional(),
  location: LatLng,
});
export type WidgetNearbyItem = z.infer<typeof WidgetNearbyItem>;

export const WidgetNearbyResponse = z.object({
  origin: LatLng,
  items: z.array(WidgetNearbyItem),
  /** URL for `GET /v1/widget/map-snapshot` with the same origin/items baked in. */
  mapSnapshotUrl: z.string().url().optional(),
  generatedAt: z.string(), // ISO
});
export type WidgetNearbyResponse = z.infer<typeof WidgetNearbyResponse>;

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

export const AggregatePoint = z.object({
  ts: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().optional(),
  vwap: z.number().optional(),
  transactions: z.number().optional(),
});
export type AggregatePoint = z.infer<typeof AggregatePoint>;

export const AggregatesResponse = z.object({
  symbol: z.string(),
  from: z.string(),
  to: z.string(),
  multiplier: z.number(),
  timespan: z.string(),
  points: z.array(AggregatePoint),
  nextCursor: z.string().optional(),
  requestId: z.string().optional(),
  sources: z.array(Source),
});
export type AggregatesResponse = z.infer<typeof AggregatesResponse>;

export const OptionContract = z.object({
  ticker: z.string(),
  underlyingTicker: z.string().optional(),
  contractType: z.enum(["call", "put", "other"]).optional(),
  expirationDate: z.string().optional(),
  strikePrice: z.number().optional(),
  exerciseStyle: z.enum(["american", "bermudan", "european"]).optional(),
  sharesPerContract: z.number().optional(),
  primaryExchange: z.string().optional(),
  cfi: z.string().optional(),
});
export type OptionContract = z.infer<typeof OptionContract>;

export const OptionSnapshot = OptionContract.extend({
  breakEvenPrice: z.number().optional(),
  impliedVolatility: z.number().optional(),
  openInterest: z.number().optional(),
  greeks: z
    .object({
      delta: z.number().optional(),
      gamma: z.number().optional(),
      theta: z.number().optional(),
      vega: z.number().optional(),
    })
    .optional(),
  quote: z
    .object({
      bid: z.number().optional(),
      ask: z.number().optional(),
      bidSize: z.number().optional(),
      askSize: z.number().optional(),
      ts: z.number().optional(),
    })
    .optional(),
  trade: z
    .object({
      price: z.number().optional(),
      size: z.number().optional(),
      ts: z.number().optional(),
    })
    .optional(),
  day: z
    .object({
      open: z.number().optional(),
      high: z.number().optional(),
      low: z.number().optional(),
      close: z.number().optional(),
      volume: z.number().optional(),
    })
    .optional(),
});
export type OptionSnapshot = z.infer<typeof OptionSnapshot>;

export const OptionsResponse = z.object({
  underlyingTicker: z.string(),
  contracts: z.array(OptionSnapshot),
  nextCursor: z.string().optional(),
  requestId: z.string().optional(),
  sources: z.array(Source),
});
export type OptionsResponse = z.infer<typeof OptionsResponse>;

export const OptionContractsResponse = z.object({
  contracts: z.array(OptionContract),
  nextCursor: z.string().optional(),
  requestId: z.string().optional(),
  sources: z.array(Source),
});
export type OptionContractsResponse = z.infer<typeof OptionContractsResponse>;

export const CorporateEvent = z.object({
  id: z.string().optional(),
  ticker: z.string(),
  type: z.string(),
  date: z.string().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  provider: z.enum(["massive", "tmx"]).optional(),
  companyName: z.string().optional(),
  isin: z.string().optional(),
  tradingVenue: z.string().optional(),
  tmxRecordId: z.string().optional(),
});
export type CorporateEvent = z.infer<typeof CorporateEvent>;

export const MarketEventsResponse = z.object({
  ticker: z.string().optional(),
  events: z.array(CorporateEvent),
  tmxAvailable: z.boolean().optional(),
  sources: z.array(Source),
});
export type MarketEventsResponse = z.infer<typeof MarketEventsResponse>;

export const MarketDataCapabilities = z.object({
  provider: z.enum(["massive", "yahoo"]),
  configured: z.boolean(),
  freshness: z.enum(["real-time", "delayed", "end-of-day", "unknown"]),
  datasets: z.record(
    z.object({
      supported: z.boolean(),
      access: z.enum(["primary", "fallback", "unconfigured"]),
      note: z.string().optional(),
    }),
  ),
  subscription: z.object({
    stocks: z.string().optional(),
    options: z.string().optional(),
    events: z.string().optional(),
  }),
});
export type MarketDataCapabilities = z.infer<typeof MarketDataCapabilities>;

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

export const CockpitRow = z
  .object({
    rank: z.number().optional(),
    ticker: z.string(),
    score: z.number().optional(),
    lane: z.string().optional(),
    ridge: z.union([z.string(), z.number()]).optional(),
    flow: z.union([z.string(), z.number()]).optional(),
    auction: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
export type CockpitRow = z.infer<typeof CockpitRow>;

export const CockpitResponse = z.object({
  rows: z.array(CockpitRow),
  tickers: z.array(z.string()),
  meta: z.record(z.unknown()).optional(),
  sourceUrl: z.string().url().optional(),
});
export type CockpitResponse = z.infer<typeof CockpitResponse>;

export const AlertItem = z
  .object({
    ticker: z.string().optional(),
    title: z.string().optional(),
    severity: z.union([z.string(), z.number()]).optional(),
    summary: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type AlertItem = z.infer<typeof AlertItem>;

export const AlertsResponse = z.object({
  alerts: z.array(AlertItem),
  tickers: z.array(z.string()),
  meta: z.record(z.unknown()).optional(),
  sourceUrl: z.string().url().optional(),
});
export type AlertsResponse = z.infer<typeof AlertsResponse>;

export const AgentChatRequest = z.object({
  message: z.string().min(1).max(4000),
  ticker: z.string().optional(),
  threadId: z.string().optional(),
});
export type AgentChatRequest = z.infer<typeof AgentChatRequest>;

/** Normalized research turn — article-shaped, not a chat bubble. */
export const ResearchArticle = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
  interesting: z.array(z.string()).default([]),
  ideas: z
    .array(
      z.object({
        title: z.string(),
        thesis: z.string(),
        disposition: z.string().optional(),
        findings: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  toolsUsed: z.array(z.string()).default([]),
  sources: z.array(z.object({ label: z.string(), url: z.string().url().optional() })).default([]),
  chartTickers: z.array(z.string()).default([]),
  mode: z.string().optional(),
  error: z.string().optional(),
});
export type ResearchArticle = z.infer<typeof ResearchArticle>;

export const AgentChatResponse = z.object({
  threadId: z.string().optional(),
  ticker: z.string().optional(),
  article: ResearchArticle,
  userMessage: ResearchArticle.optional(),
  safety: z
    .object({
      liveTradingForbidden: z.boolean(),
      orderSubmissionAllowed: z.boolean(),
    })
    .optional(),
  sourceUrl: z.string().url().optional(),
  provider: z.string().optional(),
});
export type AgentChatResponse = z.infer<typeof AgentChatResponse>;

export const AgentThreadSummary = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  preview: z.string(),
  messages: z.array(ResearchArticle).optional(),
  safety: z
    .object({
      liveTradingForbidden: z.boolean(),
      orderSubmissionAllowed: z.boolean(),
    })
    .optional(),
  sourceUrl: z.string().url().optional(),
});
export type AgentThreadSummary = z.infer<typeof AgentThreadSummary>;

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

// -------- entitlements + billing (Phase 8 Slice C+E) --------

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

/** HTTP 402 body from `requireGenerationQuota` on identify / agent / memo. */
export const QuotaExceeded = z.object({
  error: z.string(),
  code: z.literal("quota_exceeded"),
  remaining: z.number().int().min(0),
  limit: z.number().int().min(0),
  priceUsd: z.number().optional(),
  interval: z.literal("month").optional(),
});
export type QuotaExceeded = z.infer<typeof QuotaExceeded>;

/**
 * Which store the client should charge through. Native IAP/Play Billing is
 * the App Store / Play-compliant path; Stripe Checkout is the web path and
 * the TestFlight fallback until native products are configured.
 */
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

/** StoreKit 2 JWS (`purchase.purchaseToken` on iOS) posted after a native purchase. */
export const BillingAppleRequest = z.object({
  signedTransaction: z.string().min(32).max(16_384),
});
export type BillingAppleRequest = z.infer<typeof BillingAppleRequest>;
