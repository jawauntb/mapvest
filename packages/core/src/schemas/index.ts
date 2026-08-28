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

// -------- provider integration contracts --------

/**
 * Internal Google Interactions request used to generate a Lyria soundtrack.
 * This is a provider boundary, not a Mapvest HTTP endpoint, so it is exported
 * for runtime validation without being registered in the OpenAPI generator.
 */
export const LyriaInteractionRequest = z.object({
  model: z.string().min(1),
  input: z.string().min(1),
  store: z.literal(false),
});
export type LyriaInteractionRequest = z.infer<typeof LyriaInteractionRequest>;

export const LyriaInteractionContent = z.object({
  type: z.string().optional(),
  data: z.string().min(1).optional(),
  mime_type: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
});
export type LyriaInteractionContent = z.infer<typeof LyriaInteractionContent>;

export const LyriaInteractionResponse = z.object({
  steps: z.array(
    z.object({
      type: z.string().optional(),
      content: z.array(LyriaInteractionContent).optional(),
      model_output: z
        .object({
          content: z.array(LyriaInteractionContent).optional(),
        })
        .optional(),
    }),
  ),
});
export type LyriaInteractionResponse = z.infer<typeof LyriaInteractionResponse>;

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
 * via GET /v1/finds, unique by effective ticker. `ticker` is set for public
 * brands, `comparable` for private brands (closest public comparable's ticker).
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
  period: z.enum(["5d", "1mo", "3mo", "6mo", "1y", "2y"]),
  interval: z.enum(["15m", "1d", "1w"]).default("1d"),
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

const MarketTicker = z.string().regex(/^[A-Z][A-Z0-9._-]{0,14}$/);
const OptionTicker = z.string().regex(/^O:[A-Z0-9._-]{1,48}$/);
const OpaqueCursor = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^[^\s]+$/);
const QueryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const FinancialRatiosRequest = z.object({
  ticker: MarketTicker,
  limit: z.coerce.number().int().min(1).max(500).default(1),
  cursor: OpaqueCursor.optional(),
});
export type FinancialRatiosRequest = z.infer<typeof FinancialRatiosRequest>;

export const FinancialRatio = z.object({
  ticker: z.string(),
  date: z.string().optional(),
  averageVolume: z.number().optional(),
  cash: z.number().optional(),
  cik: z.string().optional(),
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

export const OptionSummaryRequest = z.object({
  underlying: MarketTicker,
  contract: OptionTicker,
});
export type OptionSummaryRequest = z.infer<typeof OptionSummaryRequest>;

export const OptionSummary = OptionSnapshot.extend({
  underlyingPrice: z.number().optional(),
  change: z.number().optional(),
  changePct: z.number().optional(),
  fmv: z.number().optional(),
  fmvLastUpdated: z.number().optional(),
});
export type OptionSummary = z.infer<typeof OptionSummary>;

export const OptionSummaryResponse = z.object({
  underlyingTicker: z.string(),
  contractTicker: z.string(),
  summary: OptionSummary,
  requestId: z.string().optional(),
  sources: z.array(Source),
});
export type OptionSummaryResponse = z.infer<typeof OptionSummaryResponse>;

export const OptionBarsRequest = z.object({
  ticker: OptionTicker,
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  multiplier: z.coerce.number().int().min(1).max(1_000).default(1),
  timespan: z.enum(["minute", "hour", "day", "week", "month", "quarter", "year"]).default("day"),
  adjusted: QueryBoolean.default(true),
  cursor: OpaqueCursor.optional(),
});
export type OptionBarsRequest = z.infer<typeof OptionBarsRequest>;

export const OptionBarsResponse = z.object({
  contractTicker: z.string(),
  from: z.string(),
  to: z.string(),
  multiplier: z.number(),
  timespan: z.string(),
  points: z.array(AggregatePoint),
  nextCursor: z.string().optional(),
  requestId: z.string().optional(),
  sources: z.array(Source),
});
export type OptionBarsResponse = z.infer<typeof OptionBarsResponse>;

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

// -------- push device ownership --------

const ExpoPushToken = z
  .string()
  .trim()
  .regex(
    /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$/,
    "valid ExponentPushToken required",
  );

// This can rotate after a reinstall or SecureStore failure. It is retained for
// client telemetry only; ownership authorization is the opaque token id (or
// authenticated user) plus the Expo token.
const PushDeviceId = z.string().trim().max(128);
const PushTokenId = z.string().trim().min(1).max(128);

export const PushPlatform = z.enum(["ios", "android"]);
export type PushPlatform = z.infer<typeof PushPlatform>;

export const PushEventKey = z.enum([
  "daily_brief",
  "local_brief",
  "price_alerts",
  "memo_finished",
  "agent_response",
  "identify_done",
  "watchlist_mover",
  "find_evolution",
  "uncaught_nearby",
]);
export type PushEventKey = z.infer<typeof PushEventKey>;

/**
 * Per-installation notification state. `last_sent` is server-owned dedupe
 * bookkeeping that may appear in reads for an existing installation; clients
 * cannot change it through `PushPreferencesUpdateRequest`.
 */
export const PushPreferences = z
  .object({
    notifications_enabled: z.boolean().optional(),
    daily_brief: z.boolean().optional(),
    local_brief: z.boolean().optional(),
    price_alerts: z.boolean().optional(),
    memo_finished: z.boolean().optional(),
    agent_response: z.boolean().optional(),
    identify_done: z.boolean().optional(),
    watchlist_mover: z.boolean().optional(),
    find_evolution: z.boolean().optional(),
    uncaught_nearby: z.boolean().optional(),
    last_lat: z.number().optional(),
    last_lng: z.number().optional(),
    last_location_at: z.string().optional(),
    last_sent: z.record(z.string()).optional(),
  })
  .passthrough();
export type PushPreferences = z.infer<typeof PushPreferences>;

/**
 * Product preference patch. Unknown fields remain accepted and ignored by the
 * server so newer clients can roll out opt-ins without breaking older APIs.
 */
export const PushPreferencesPatch = PushPreferences.omit({ last_sent: true }).passthrough();
export type PushPreferencesPatch = z.infer<typeof PushPreferencesPatch>;

/** Register or re-claim the current installation's physical Expo token. */
export const PushRegistrationRequest = z.object({
  token: ExpoPushToken,
  platform: PushPlatform.optional(),
  deviceId: PushDeviceId.optional(),
});
export type PushRegistrationRequest = z.infer<typeof PushRegistrationRequest>;

export const PushRegistrationResponse = z.object({
  id: PushTokenId,
  prefs: PushPreferences,
});
export type PushRegistrationResponse = z.infer<typeof PushRegistrationResponse>;

/** Merge a patch into one registered installation's preferences. */
export const PushPreferencesUpdateRequest = z.object({
  tokenId: PushTokenId,
  prefs: PushPreferencesPatch,
});
export type PushPreferencesUpdateRequest = z.infer<typeof PushPreferencesUpdateRequest>;

export const PushPreferencesUpdateResponse = z.object({
  prefs: PushPreferences,
});
export type PushPreferencesUpdateResponse = z.infer<typeof PushPreferencesUpdateResponse>;

/**
 * Exact installation selection for a preference read. Omitting the id is an
 * explicit no-selection result; it never falls back to another device.
 */
export const PushPreferencesReadQuery = z.object({
  tokenId: PushTokenId.optional(),
});
export type PushPreferencesReadQuery = z.infer<typeof PushPreferencesReadQuery>;

export const PushPreferencesReadResponse = z.object({
  prefs: PushPreferences,
  tokenId: PushTokenId.nullable(),
});
export type PushPreferencesReadResponse = z.infer<typeof PushPreferencesReadResponse>;

/** The opaque registration id in `DELETE /v1/push/token/:id`. */
export const PushTokenDeleteParams = z.object({
  id: PushTokenId,
});
export type PushTokenDeleteParams = z.infer<typeof PushTokenDeleteParams>;

/**
 * Public, idempotent fallback for an installation that still holds the opaque
 * server id issued at registration but no longer has a valid bearer session.
 * Both identities are required so a stale installation cannot revoke a later
 * account owner of the same physical Expo token.
 */
export const PushDeviceRevocationRequest = z.object({
  token: ExpoPushToken,
  tokenId: PushTokenId,
  deviceId: PushDeviceId.optional(),
});
export type PushDeviceRevocationRequest = z.infer<typeof PushDeviceRevocationRequest>;

/** Authenticated recovery when the client lost its opaque push token id. */
export const PushCurrentDeviceRevocationRequest = z.object({
  token: ExpoPushToken,
  deviceId: PushDeviceId.optional(),
});
export type PushCurrentDeviceRevocationRequest = z.infer<typeof PushCurrentDeviceRevocationRequest>;

/**
 * Expired-session recovery supports either a live Expo identity (limited to
 * 90 days after session expiry) or the opaque id retained from registration
 * when iOS has confirmed it cannot obtain an Expo token (for example after
 * notification permission is denied). The opaque id identifies one
 * historical row and is safe for longer-lived cleanup because a transferred
 * claim fails closed rather than affecting its new owner.
 */
export const PushExpiredSessionDeviceRevocationRequest = z.union([
  z.object({
    token: ExpoPushToken,
    tokenId: PushTokenId.optional(),
    deviceId: PushDeviceId.optional(),
  }),
  z.object({
    token: ExpoPushToken.optional(),
    tokenId: PushTokenId,
    deviceId: PushDeviceId.optional(),
  }),
]);
export type PushExpiredSessionDeviceRevocationRequest = z.infer<
  typeof PushExpiredSessionDeviceRevocationRequest
>;

export const PushDeviceRevocationOutcome = z.enum(["revoked", "already-revoked", "claim-mismatch"]);
export type PushDeviceRevocationOutcome = z.infer<typeof PushDeviceRevocationOutcome>;

/**
 * `already-revoked` accepts an idempotent retry after a completed unlink;
 * `claim-mismatch` is deliberately fail-closed because another active owner
 * now holds the physical Expo token. `matched` is retained for old clients
 * and is true only when this call removed the exact current claim.
 */
export const PushDeviceRevocationResponse = z.union([
  z.object({
    revoked: z.literal(true),
    matched: z.literal(true),
    outcome: z.literal("revoked"),
  }),
  z.object({
    revoked: z.literal(true),
    matched: z.literal(false),
    outcome: z.literal("already-revoked"),
  }),
  z.object({
    revoked: z.literal(false),
    matched: z.literal(false),
    outcome: z.literal("claim-mismatch"),
  }),
]);
export type PushDeviceRevocationResponse = z.infer<typeof PushDeviceRevocationResponse>;

export const ResearchDepth = z.enum(["auto", "instant", "standard", "deep", "max"]);
export type ResearchDepth = z.infer<typeof ResearchDepth>;

export const ResearchConversationStatus = z.enum([
  "queued",
  "running",
  "conclusive",
  "exhausted",
  "blocked",
  "error",
]);
export type ResearchConversationStatus = z.infer<typeof ResearchConversationStatus>;

export const ResearchConversationReference = z.object({
  schema_version: z.literal("research_conversation_ref_v1"),
  id: z.string(),
  conversation_id: z.string(),
  status: ResearchConversationStatus,
  deliverable: z.enum(["ideas", "memo"]),
  href: z.string(),
  stream_href: z.string(),
  pdf_url: z.string().nullable(),
});
export type ResearchConversationReference = z.infer<typeof ResearchConversationReference>;

export const LegacyResearchConversationReference = z
  .object({
    id: z.string(),
    status: ResearchConversationStatus,
    deliverable: z.enum(["ideas", "memo"]),
    href: z.string(),
    pdf_url: z.string().nullable().optional(),
  })
  .passthrough();
export type LegacyResearchConversationReference = z.infer<
  typeof LegacyResearchConversationReference
>;

export const ResearchConversation = z.union([
  ResearchConversationReference,
  LegacyResearchConversationReference,
]);
export type ResearchConversation = z.infer<typeof ResearchConversation>;

export const AgentChatRequest = z.object({
  message: z.string().min(1).max(4000),
  ticker: z.string().optional(),
  conversationId: z.string().optional(),
  /** Compatibility alias for clients released before the conversation migration. */
  threadId: z.string().optional(),
  clientMessageId: z.string().min(1).max(128).optional(),
  researchDepth: ResearchDepth.optional(),
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
  status: ResearchConversationStatus.optional(),
  phase: z.string().optional(),
  progress: z
    .object({
      completedIterations: z.number().optional(),
      maxIterations: z.number().optional(),
      completedTasks: z.number().optional(),
      totalTasks: z.number().optional(),
      evidenceReady: z.boolean().optional(),
      essentialClaimsReady: z.number().optional(),
      essentialClaimsTotal: z.number().optional(),
    })
    .optional(),
  evidence: z
    .array(
      z.object({
        summary: z.string(),
        source: z.string().optional(),
        freshness: z.string().optional(),
        artifactRefs: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  context: z
    .array(
      z.object({
        summary: z.string(),
        reason: z.string().optional(),
        source: z.string().optional(),
      }),
    )
    .optional(),
  blocker: z.string().optional(),
  specialists: z
    .array(
      z.object({
        role: z.string(),
        status: z.string().optional(),
        analysis: z.string().optional(),
      }),
    )
    .optional(),
  memo: z
    .object({
      title: z.string().optional(),
      executiveSummary: z.string().optional(),
      verdict: z.string().optional(),
      rationale: z.string().optional(),
      bullCase: z.string().optional(),
      baseCase: z.string().optional(),
      bearCase: z.string().optional(),
    })
    .optional(),
  mode: z.string().optional(),
  error: z.string().optional(),
});
export type ResearchArticle = z.infer<typeof ResearchArticle>;

export const AgentChatResponse = z.object({
  conversationId: z.string(),
  /** Compatibility alias; new clients use conversationId. */
  threadId: z.string(),
  clientMessageId: z.string(),
  status: ResearchConversationStatus,
  conversation: ResearchConversation,
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
  memoUrl: z.string().optional(),
  provider: z.string().optional(),
  pending: z.boolean().optional(),
});
export type AgentChatResponse = z.infer<typeof AgentChatResponse>;

export const AgentThreadSummary = z.object({
  id: z.string(),
  conversationId: z.string(),
  title: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  preview: z.string(),
  status: ResearchConversationStatus,
  phase: z.string().optional(),
  memoUrl: z.string().optional(),
  conversation: ResearchConversation.optional(),
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

export const AgentConversationStatus = z.object({
  conversationId: z.string(),
  status: ResearchConversationStatus,
  phase: z.string().optional(),
  active: z.boolean().optional(),
  completedIterations: z.number().optional(),
  maxIterations: z.number().optional(),
  preview: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type AgentConversationStatus = z.infer<typeof AgentConversationStatus>;

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

// -------- universe progression (Universe Roadmap A1/A3/A4) --------

/**
 * Server-side progression for one signed-in user — the single source of truth
 * for XP, level, and streak. Written by `recordFind` on every successful
 * `/v1/identify` (the same hook that appends to the finds journal); read back
 * by `GET /v1/progress`. The client renders this, it never derives a streak
 * locally, so the streak survives reinstall.
 *
 * `lastFindDay` is a UTC calendar day (`YYYY-MM-DD`), not an ISO timestamp:
 * streaks are counted in days, and the day boundary must not move with the
 * device timezone.
 *
 * `badges` holds earned badge keys (e.g. `"sector:Consumer Staples"` for a
 * completed sector dex). Written server-side by the same progression writer
 * that awards XP — the client never posts a badge it thinks it earned; read
 * back on `GET /v1/progress`. Keys are opaque strings so a new badge family
 * ships without a schema change; unknown keys must render generically rather
 * than crash.
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
 * The counterfactual universe portfolio from `GET /v1/universe/summary`:
 * "if you'd put $100 into every find at the moment you found it, your universe
 * would be worth $X." Computed server-side from each find's `foundPrice`
 * against the current quote — finds without a `foundPrice` are excluded from
 * `valuedFinds` / `hypotheticalBasis` / `hypotheticalValue` rather than
 * estimated (AGENTS.md §2.4: never fake financial data). It is a
 * hypothetical aggregate, not a holdings statement, and it carries
 * `sources: Source[]` for the quotes behind it (AGENTS.md §6).
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
 * Rarity tier of a caught brand, derived from data already on the find:
 * public mega-cap = `common`, small-cap = `uncommon`, private-resolved-via-
 * comparable = `rare`, and resolved by the vision pipeline but absent from the
 * `brands.json` seed = `legendary` (that catch feeds the seed table).
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

/**
 * Per-find rarity histogram: how many of the caller's finds landed in each
 * `DexRarity` tier. Derived on read alongside the rest of the dex — every find
 * is classified into exactly one tier, so the four counts sum to `totalFinds`.
 */
export const DexRarityCounts = z.object({
  common: z.number(),
  uncommon: z.number(),
  rare: z.number(),
  legendary: z.number(),
});
export type DexRarityCounts = z.infer<typeof DexRarityCounts>;

/**
 * Collection progress from `GET /v1/dex`. Written by nothing — it is derived
 * on read by reconciling the caller's `user_finds` against the `brands.json`
 * seed in `packages/finance`. `tilesVisited` is the regional dex: distinct
 * geohash-6 tiles with at least one find. `rarityCounts` is the per-find
 * rarity histogram over the same finds (see `DexRarity`).
 */
export const DexResponse = z.object({
  sectors: z.array(DexSector),
  tilesVisited: z.number(),
  totalFinds: z.number(),
  rarityCounts: DexRarityCounts,
});
export type DexResponse = z.infer<typeof DexResponse>;

// -------- company graph (Universe Roadmap C1) --------

/**
 * Direction of a company-to-company relationship. `supplies` / `buys_from` are
 * the vertical value chain; `competes_with` / `complements` are lateral.
 */
export const CompanyEdgeType = z.enum(["supplies", "buys_from", "competes_with", "complements"]);
export type CompanyEdgeType = z.infer<typeof CompanyEdgeType>;

/**
 * One cited edge in a company's value chain, persisted in the `company_edges`
 * store and refreshed when a new 10-K lands (not on a short TTL). Written by
 * the extraction pipeline in `packages/finance/src/valueChain.ts` — 10-K items
 * 1/1A evidence (supplier concentration and >10% customers are disclosed
 * there) plus Exa open-web results, judged by the same LLM cascade and
 * plausible-ticker rules as `comparable.ts`; read by `GET /v1/graph/{ticker}`.
 *
 * Private counterparties keep `dstName` with **no** `dstTicker` — never invent
 * one. Every edge carries `sources: Source[]` (AGENTS.md §6); an edge that
 * cannot be cited is not emitted. `asOf` is the filing period the evidence
 * came from, when known.
 */
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
  createdAt: z.string(), // ISO
});
export type CompanyEdge = z.infer<typeof CompanyEdge>;

export const CompanyGraphResponse = z.object({
  ticker: z.string(),
  edges: z.array(CompanyEdge),
  count: z.number(),
  generatedAt: z.string(), // ISO
  sources: z.array(Source),
});
export type CompanyGraphResponse = z.infer<typeof CompanyGraphResponse>;

// -------- daily quests (Universe Roadmap A5) --------

/**
 * The verifiable actions a daily quest can ask for. Every kind is decidable
 * from the find stream alone — `catch_any` (any find today), `catch_private`
 * (a find whose brand resolved through a comparable rather than a direct
 * ticker), `new_tile` (a find in a geohash-6 tile the user has never found in),
 * `new_sector` (a find in a sector with no prior finds). No kind may require
 * the client to report anything.
 */
export const QuestKind = z.enum(["catch_any", "catch_private", "new_tile", "new_sector"]);
export type QuestKind = z.infer<typeof QuestKind>;

/**
 * One daily quest for the signed-in user. Generated per UTC day and evaluated
 * server-side against the find stream by the quests store; read back via
 * `GET /v1/quests`. Completion is never self-reported — the client renders
 * `progress`/`target` and `completed` exactly as returned.
 *
 * `id` is deterministic per day and kind (`"{YYYY-MM-DD}:{kind}"`) so the same
 * quest is stable across refreshes and XP is granted at most once per id.
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
 * `GET /v1/quests` payload. `day` is the UTC calendar day the quest set belongs
 * to (`YYYY-MM-DD`), matching the `lastFindDay` convention on `UserProgress`,
 * so the daily reset does not move with the device timezone.
 * `xpGrantedToday` is the XP already written to `user_progress` for completed
 * quests on `day` — the client displays it, it never adds to it.
 */
export const QuestsResponse = z.object({
  quests: z.array(Quest),
  day: z.string(), // YYYY-MM-DD (UTC)
  xpGrantedToday: z.number(),
});
export type QuestsResponse = z.infer<typeof QuestsResponse>;

// -------- territory (Universe Roadmap A6) --------

/**
 * Tile completion for the geohash-6 cell containing a lat/lng, from
 * `GET /v1/territory`. Derived on read: `investablesTotal` is how many
 * investable brands the nearby cascade resolves inside the tile, `found` is how
 * many of those the caller has already caught, and `pioneer` is true when the
 * caller has NOT yet recorded a find in this tile — i.e. the pioneer XP bonus
 * (granted at write time on their first find here) is still available.
 *
 * The counts come from a live places + brand join, which is a finance-shaped
 * answer, so it carries `sources: Source[]` (AGENTS.md §6) — an uncitable
 * lookup returns fewer sources, never an invented one.
 */
export const TerritoryResponse = z.object({
  tile: z.string(), // geohash-6
  investablesTotal: z.number(),
  found: z.number(),
  pioneer: z.boolean(),
  sources: z.array(Source),
});
export type TerritoryResponse = z.infer<typeof TerritoryResponse>;

// -------- events (Universe Roadmap A7) --------

/**
 * A scheduler-driven quest modifier that is open right now — e.g. Sector
 * Saturday doubling XP for one sector, or an earnings-week window. Written by
 * the events schedule (global, not per-user), read by `GET /v1/events/current`.
 *
 * `multiplier` applies to find XP only, inside `[startsAt, endsAt)` (quest XP
 * is awarded at face value — a quest multiplier is future work);
 * `sector` scopes it when present and is absent for an all-sector event.
 * Timestamps are ISO instants because an event window is a real instant range,
 * unlike the UTC calendar days used for streaks and quests.
 */
export const ActiveEvent = z.object({
  key: z.string(),
  title: z.string(),
  sector: z.string().optional(),
  multiplier: z.number(),
  startsAt: z.string(), // ISO
  endsAt: z.string(), // ISO
});
export type ActiveEvent = z.infer<typeof ActiveEvent>;

/**
 * `GET /v1/events/current`. `active` is explicitly `null` — not omitted — when
 * no window is open, so the client can distinguish "no event" from a failed
 * fetch. Unauthenticated: the event schedule is global.
 */
export const EventsResponse = z.object({
  active: ActiveEvent.nullable(),
});
export type EventsResponse = z.infer<typeof EventsResponse>;

// -------- rivalries (Universe Roadmap C6) --------

/**
 * A solo weekly matchup between one of the caller's finds and a comparable
 * (e.g. NVDA vs AMD). Written by the rivalries store on `POST /v1/rivalries`
 * and updated at each weekly close from provider quotes; read by
 * `GET /v1/rivalries`.
 *
 * This is a collection and comprehension mechanic, not advice and not a
 * position: `currentPick` is an optional pre-registered guess for XP, and the
 * running `wins`/`losses`/`draws` record is the only outcome. `weekStart` is
 * the Monday of the current round as a UTC calendar day (`YYYY-MM-DD`), so the
 * round boundary does not move with the device timezone.
 */
export const Rivalry = z.object({
  id: z.string(),
  ticker: z.string(),
  rivalTicker: z.string(),
  wins: z.number(),
  losses: z.number(),
  draws: z.number(),
  currentPick: z.enum(["ticker", "rival"]).optional(),
  weekStart: z.string(), // YYYY-MM-DD (Monday, UTC)
  createdAt: z.string(), // ISO
});
export type Rivalry = z.infer<typeof Rivalry>;

export const RivalriesResponse = z.object({
  rivalries: z.array(Rivalry),
  count: z.number(),
});
export type RivalriesResponse = z.infer<typeof RivalriesResponse>;

/**
 * `POST /v1/rivalries` body. Omit `rivalTicker` to let the server pick the
 * opponent from the existing comparables pipeline in `packages/finance` — the
 * client must not invent a rival.
 */
export const CreateRivalryRequest = z.object({
  ticker: z.string(),
  rivalTicker: z.string().optional(),
});
export type CreateRivalryRequest = z.infer<typeof CreateRivalryRequest>;

// -------- demand pulse (Universe Roadmap C3) --------

/**
 * One buyer contributing to a demand pulse: a counterparty on the subject
 * ticker's `buys_from` edges, joined to provider fundamentals. `revenueYoY` and
 * `capexYoY` are percent changes and are **omitted** when the provider returned
 * no usable series — never zero-filled (AGENTS.md §2.4). `weight` is the
 * originating `CompanyEdge.weight`, normalized across resolved buyers.
 */
export const DemandPulseBuyer = z.object({
  ticker: z.string(),
  name: z.string().optional(),
  revenueYoY: z.number().optional(),
  capexYoY: z.number().optional(),
  weight: z.number().min(0).max(1),
});
export type DemandPulseBuyer = z.infer<typeof DemandPulseBuyer>;

/**
 * `GET /v1/pulse/{ticker}`: is the money upstream of this company growing or
 * shrinking. Computed by `packages/finance/src/demandPulse.ts` (pure math)
 * and assembled in `apps/api/src/lib/demand-pulse.ts` from the ticker's `buys_from` edges
 * (see `CompanyEdge`) joined to provider income-statement / cash-flow data
 * fetched via `packages/finance`.
 *
 * `pulse` is the weighted average buyer YoY percent and is `null` — not 0 —
 * when no buyer fundamentals resolved; `interpretation` is then `"unknown"`.
 * Metered like `/v1/graph`: cache hits are free, a miss spends provider money.
 * Carries `sources: Source[]` per buyer series actually fetched (AGENTS.md §6).
 */
export const DemandPulse = z.object({
  ticker: z.string(),
  buyers: z.array(DemandPulseBuyer),
  pulse: z.number().nullable(),
  interpretation: z.enum(["expanding", "contracting", "mixed", "unknown"]),
  generatedAt: z.string(), // ISO
  sources: z.array(Source),
});
export type DemandPulse = z.infer<typeof DemandPulse>;

// -------- environment layer (Universe Roadmap C4) --------

/**
 * One macro series cited by an environment brief (FRED id, e.g. `"FEDFUNDS"`).
 * `latest` is the most recent observation and `asOf` its observation date —
 * a series with no observation is dropped from the brief rather than carried
 * with a placeholder value.
 */
export const EnvironmentSeries = z.object({
  id: z.string(),
  label: z.string(),
  latest: z.number(),
  unit: z.string().optional(),
  asOf: z.string(),
});
export type EnvironmentSeries = z.infer<typeof EnvironmentSeries>;

/**
 * `GET /v1/environment/{sector}`: the gather → LLM → tailwinds/headwinds brief
 * at sector scale, cached 24h. Written by the environment generator in
 * `apps/api/src/lib/environment-brief-generator.ts` (same placement precedent
 * as the local-brief generator), read by the sector sheet in the client.
 *
 * `series` are the quantitative FRED observations behind the brief; the
 * policy/culture color gathered via Exa is qualitative and is cited in
 * `sources` alongside them, never promoted into `series`. Metered like
 * `/v1/graph`. Degrades honestly: with `FRED_API_KEY` unset the brief ships
 * with `series: []` and Exa color only; 503 only when neither FRED nor Exa
 * (nor the LLM) is configured. Macro numbers are never synthesized.
 */
export const EnvironmentBrief = z.object({
  sector: z.string(),
  headline: z.string(),
  body: z.string(), // markdown
  tailwinds: z.array(z.string()),
  headwinds: z.array(z.string()),
  series: z.array(EnvironmentSeries),
  generatedAt: z.string(), // ISO
  sources: z.array(Source),
});
export type EnvironmentBrief = z.infer<typeof EnvironmentBrief>;

// -------- synthesis memo (Universe Roadmap C5) --------

/**
 * `POST /v1/memo/synthesis`: the layered memo. The prompt receives the three
 * layer briefs — upstream (`CompanyGraphResponse`), demand (`DemandPulse`), and
 * environment (`EnvironmentBrief`) — plus ratios, and is asked exactly three
 * questions, which come back as the three optional fields.
 *
 * Those fields are optional because the memo **degrades to a plain memo** when
 * the layer data is empty: no graph, no pulse, and no environment brief means
 * `memo` alone, with the layer answers omitted rather than guessed. Every layer
 * fact carried into the answer is cited in `sources` (AGENTS.md §6). Metered
 * like `/v1/graph`.
 */
export const SynthesisMemoResponse = z.object({
  ticker: z.string(),
  memo: z.string(),
  bindingConstraint: z.string().optional(),
  demandDurability: z.string().optional(),
  pricingPower: z.string().optional(),
  generatedAt: z.string(), // ISO
  sources: z.array(Source),
});
export type SynthesisMemoResponse = z.infer<typeof SynthesisMemoResponse>;
