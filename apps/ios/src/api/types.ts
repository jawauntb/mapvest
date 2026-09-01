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
  provider: z.enum([
    "exa",
    "openrouter",
    "gemini",
    "massive",
    "yahoo",
    "polygon",
    "sec",
    "fred",
    "manual",
  ]),
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

/** Daily provider-routed close for the native Overview price chart. `ts` is unix seconds. */
export const QuoteHistoryPoint = z.object({
  ts: z.number(),
  close: z.number(),
});
export type QuoteHistoryPoint = z.infer<typeof QuoteHistoryPoint>;

export const QuoteHistoryResponse = z.object({
  ticker: z.string(),
  period: z.enum(["5d", "1mo", "3mo", "6mo", "1y", "2y"]),
  interval: z.enum(["15m", "1d", "1w"]).default("1d"),
  points: z.array(QuoteHistoryPoint),
  sources: z.array(Source),
});
export type QuoteHistoryResponse = z.infer<typeof QuoteHistoryResponse>;

// -------- Massive options market data --------

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

export const FinancialRatio = z.object({
  ticker: z.string(),
  date: z.string().optional(),
  averageVolume: z.number().optional(),
  cash: z.number().optional(),
  current: z.number().optional(),
  debtToEquity: z.number().optional(),
  dividendYield: z.number().optional(),
  earningsPerShare: z.number().optional(),
  enterpriseValue: z.number().optional(),
  evToEbitda: z.number().optional(),
  evToSales: z.number().optional(),
  freeCashFlow: z.number().optional(),
  marketCap: z.number().optional(),
  price: z.number().optional(),
  priceToBook: z.number().optional(),
  priceToCashFlow: z.number().optional(),
  priceToEarnings: z.number().optional(),
  priceToFreeCashFlow: z.number().optional(),
  priceToSales: z.number().optional(),
  quick: z.number().optional(),
  returnOnAssets: z.number().optional(),
  returnOnEquity: z.number().optional(),
});
export type FinancialRatio = z.infer<typeof FinancialRatio>;

export const FinancialRatiosResponse = z.object({
  ticker: z.string(),
  ratios: z.array(FinancialRatio),
  nextCursor: z.string().optional(),
  requestId: z.string().optional(),
  sources: z.array(Source),
});
export type FinancialRatiosResponse = z.infer<typeof FinancialRatiosResponse>;

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

export const BillingAppleRequest = z.object({
  signedTransaction: z.string().min(32).max(16_384),
});
export type BillingAppleRequest = z.infer<typeof BillingAppleRequest>;

// -------- universe progression (Universe Roadmap A1/A3/A4) --------
// Every endpoint behind these shapes is additive: the screens that read them
// must render unchanged when the server 404s, and a server that predates a
// field (e.g. `rarityCounts`) must not crash a render — read defensively.

/**
 * Server-side XP/level/streak from `GET /v1/progress`. The streak lives here so
 * it survives reinstall. `lastFindDay` is a UTC calendar day (`YYYY-MM-DD`),
 * not an ISO timestamp — the day boundary must not move with the device
 * timezone. `badges` keys are opaque strings; unknown keys render generically.
 */
export const UserProgress = z.object({
  xp: z.number(),
  level: z.number(),
  streakDays: z.number(),
  streakFreezes: z.number(),
  lastFindDay: z.string().optional(), // YYYY-MM-DD (UTC)
  badges: z.array(z.string()).default([]),
  updatedAt: z.string(), // ISO
});
export type UserProgress = z.infer<typeof UserProgress>;

export const ProgressResponse = z.object({
  progress: UserProgress,
});
export type ProgressResponse = z.infer<typeof ProgressResponse>;

/**
 * The counterfactual universe portfolio from `GET /v1/universe/summary`: "$100
 * into every find at the moment you found it." Finds without a `foundPrice`
 * are excluded server-side rather than estimated, so `valuedFinds` can be lower
 * than `findCount` — never render a value when `valuedFinds` is 0.
 */
export const UniverseSummary = z.object({
  findCount: z.number(),
  valuedFinds: z.number(),
  hypotheticalBasis: z.number(),
  hypotheticalValue: z.number(),
  changePct: z.number(),
  generatedAt: z.string(), // ISO
  sources: z.array(Source),
});
export type UniverseSummary = z.infer<typeof UniverseSummary>;

/**
 * Rarity tier of a caught brand: public mega-cap = `common`, small-cap =
 * `uncommon`, private-resolved-via-comparable = `rare`, resolved by the vision
 * pipeline but absent from the `brands.json` seed = `legendary`.
 */
export const DexRarity = z.enum(["common", "uncommon", "rare", "legendary"]);
export type DexRarity = z.infer<typeof DexRarity>;

/** One sector row of the dex: how many of that sector's seed brands are caught. */
export const DexSector = z.object({
  sector: z.string(),
  found: z.number(),
  total: z.number(),
});
export type DexSector = z.infer<typeof DexSector>;

/** Per-find rarity histogram — the four counts sum to `totalFinds`. */
export const DexRarityCounts = z.object({
  common: z.number(),
  uncommon: z.number(),
  rare: z.number(),
  legendary: z.number(),
});
export type DexRarityCounts = z.infer<typeof DexRarityCounts>;

/**
 * Collection progress from `GET /v1/dex`, derived on read. `tilesVisited` is
 * the regional dex: distinct geohash-6 tiles with at least one find.
 */
export const DexResponse = z.object({
  sectors: z.array(DexSector),
  tilesVisited: z.number(),
  totalFinds: z.number(),
  rarityCounts: DexRarityCounts,
});
export type DexResponse = z.infer<typeof DexResponse>;

// -------- daily quests (Universe Roadmap A5) --------

/** Verifiable quest actions — every kind is decidable from the find stream alone. */
export const QuestKind = z.enum(["catch_any", "catch_private", "new_tile", "new_sector"]);
export type QuestKind = z.infer<typeof QuestKind>;

/**
 * One daily quest. Completion is never self-reported: the client renders
 * `progress`/`target` and `completed` exactly as returned. `id` is
 * deterministic per day and kind (`"{YYYY-MM-DD}:{kind}"`).
 */
export const Quest = z.object({
  id: z.string(), // "{YYYY-MM-DD}:{kind}"
  kind: QuestKind,
  title: z.string(),
  xp: z.number(),
  completed: z.boolean(),
  progress: z.number(),
  target: z.number(),
});
export type Quest = z.infer<typeof Quest>;

/**
 * `GET /v1/quests` payload. `day` is the UTC calendar day the set belongs to,
 * matching `UserProgress.lastFindDay`. `xpGrantedToday` is XP already written
 * server-side for quests completed on `day` — the client displays it, never
 * adds to it.
 */
export const QuestsResponse = z.object({
  quests: z.array(Quest),
  day: z.string(), // YYYY-MM-DD (UTC)
  xpGrantedToday: z.number(),
});
export type QuestsResponse = z.infer<typeof QuestsResponse>;

// -------- company graph + orbit (Universe Roadmap C1–C3) --------

export const CompanyEdgeType = z.enum(["supplies", "buys_from", "competes_with", "complements"]);
export type CompanyEdgeType = z.infer<typeof CompanyEdgeType>;

export const CompanyEdge = z.object({
  id: z.string(),
  srcTicker: z.string(),
  dstTicker: z.string().optional(),
  dstName: z.string(),
  edgeType: CompanyEdgeType,
  weight: z.number().min(0).max(1),
  reasoning: z.string(),
  sources: z.array(Source),
  asOf: z.string().optional(),
  createdAt: z.string(),
});
export type CompanyEdge = z.infer<typeof CompanyEdge>;

export const CompanyGraphResponse = z.object({
  ticker: z.string(),
  edges: z.array(CompanyEdge),
  count: z.number(),
  generatedAt: z.string(),
  sources: z.array(Source),
});
export type CompanyGraphResponse = z.infer<typeof CompanyGraphResponse>;

export const DemandPulseBuyer = z.object({
  ticker: z.string(),
  name: z.string().optional(),
  revenueYoY: z.number().optional(),
  capexYoY: z.number().optional(),
  weight: z.number().min(0).max(1),
});
export type DemandPulseBuyer = z.infer<typeof DemandPulseBuyer>;

export const DemandPulse = z.object({
  ticker: z.string(),
  buyers: z.array(DemandPulseBuyer),
  pulse: z.number().nullable(),
  interpretation: z.enum(["expanding", "contracting", "mixed", "unknown"]),
  generatedAt: z.string(),
  sources: z.array(Source),
});
export type DemandPulse = z.infer<typeof DemandPulse>;
export type DemandPulseInterpretation = DemandPulse["interpretation"];

// -------- territory / events / rivalries / environment / synthesis --------

export const TerritoryResponse = z.object({
  tile: z.string(),
  investablesTotal: z.number(),
  found: z.number(),
  pioneer: z.boolean(),
  sources: z.array(Source),
});
export type TerritoryResponse = z.infer<typeof TerritoryResponse>;

export const ActiveEvent = z.object({
  key: z.string(),
  title: z.string(),
  sector: z.string().optional(),
  multiplier: z.number(),
  startsAt: z.string(),
  endsAt: z.string(),
});
export type ActiveEvent = z.infer<typeof ActiveEvent>;

export const EventsResponse = z.object({
  active: ActiveEvent.nullable(),
});
export type EventsResponse = z.infer<typeof EventsResponse>;

export const Rivalry = z.object({
  id: z.string(),
  ticker: z.string(),
  rivalTicker: z.string(),
  wins: z.number(),
  losses: z.number(),
  draws: z.number(),
  currentPick: z.enum(["ticker", "rival"]).optional(),
  weekStart: z.string(),
  createdAt: z.string(),
});
export type Rivalry = z.infer<typeof Rivalry>;

export const RivalriesResponse = z.object({
  rivalries: z.array(Rivalry),
  count: z.number(),
});
export type RivalriesResponse = z.infer<typeof RivalriesResponse>;

export const CreateRivalryRequest = z.object({
  ticker: z.string(),
  rivalTicker: z.string().optional(),
});
export type CreateRivalryRequest = z.infer<typeof CreateRivalryRequest>;

export const EnvironmentSeries = z.object({
  id: z.string(),
  label: z.string(),
  latest: z.number(),
  unit: z.string().optional(),
  asOf: z.string(),
});
export type EnvironmentSeries = z.infer<typeof EnvironmentSeries>;

export const EnvironmentBrief = z.object({
  sector: z.string(),
  headline: z.string(),
  body: z.string(),
  tailwinds: z.array(z.string()),
  headwinds: z.array(z.string()),
  series: z.array(EnvironmentSeries),
  generatedAt: z.string(),
  sources: z.array(Source),
});
export type EnvironmentBrief = z.infer<typeof EnvironmentBrief>;

export const SynthesisMemoResponse = z.object({
  ticker: z.string(),
  memo: z.string(),
  bindingConstraint: z.string().optional(),
  demandDurability: z.string().optional(),
  pricingPower: z.string().optional(),
  generatedAt: z.string(),
  sources: z.array(Source),
});
export type SynthesisMemoResponse = z.infer<typeof SynthesisMemoResponse>;

// -------- account-scoped push delivery --------

export const PushNotificationTarget = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("home"),
      section: z.enum(["daily-brief", "local-brief"]).optional(),
    }),
    z.object({
      type: z.literal("map"),
      placeId: z.string().trim().min(1).max(256).optional(),
      ticker: z.string().trim().min(1).max(24).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      label: z.string().trim().min(1).max(160).optional(),
      reason: z.string().trim().min(1).max(240).optional(),
    }),
    z.object({ type: z.literal("company"), ticker: z.string().trim().min(1).max(24) }),
    z.object({
      type: z.literal("research"),
      threadId: z.string().trim().min(1).max(256).optional(),
    }),
    z.object({ type: z.literal("alerts") }),
    z.object({ type: z.literal("camera") }),
    z.object({ type: z.literal("universe") }),
    z.object({ type: z.literal("settings") }),
  ])
  .superRefine((target, ctx) => {
    if (target.type !== "map") return;
    if ((target.lat === undefined) !== (target.lng === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "map coordinates must be paired" });
    }
    if (!target.placeId && !target.ticker && target.lat === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "map target requires an identity" });
    }
  });
export type PushNotificationTarget = z.infer<typeof PushNotificationTarget>;

export const PushNotificationDelivery = z.object({
  schemaVersion: z.literal(1),
  deliveryId: z.string().trim().min(1).max(128),
  installationId: z.string().trim().min(1).max(128),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  eventKind: z.string().trim().min(1).max(64),
  target: PushNotificationTarget,
});
export type PushNotificationDelivery = z.infer<typeof PushNotificationDelivery>;
