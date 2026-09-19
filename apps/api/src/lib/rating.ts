/**
 * Rating signal — the "BUY · 72%" hero chip (`GET /v1/rating/:ticker`).
 *
 * Assembles an evidence packet for one ticker from sources that are either
 * cheap and live (quote + recent history, financial ratios, the headline
 * batch, the underlying peer forecast, a stored Prism/Situate packet) or
 * already cached in-process (synthesis memo, demand pulse, environment brief),
 * then asks Jev ONE batched `systemone` request:
 *
 *   - a `score` over strong_sell < sell < hold < buy < strong_buy,
 *   - a `choice` for the primary driver among the drivers that resolved,
 *   - one `noul` per resolved driver: "does this evidence argue UP?".
 *
 * The rating is `PrismRecommendation`-shaped so the same chip renders both:
 * `conviction` is Jev's confidence, `strength` comes from the probability
 * margin, and `one_line` is composed DETERMINISTICALLY from the drivers
 * ("Buy · momentum + fundamentals; macro headwind") — never model prose.
 *
 * Hard rules:
 *   - Never trigger an expensive build synchronously. Synthesis / pulse /
 *     environment are read from their caches only; Prism / Situate are read
 *     from stored packets (the engine 404s when none exists). Only the cheap
 *     sources hit the network, each behind its own short timeout.
 *   - Fail OPEN per source: a source that errors or times out is simply absent
 *     from the packet. Fail open overall: fewer than two sources, a Jev
 *     failure, or confidence below {@link JEV_MIN_CONFIDENCE} yields
 *     `status: "insufficient_signal"` with `rating: null` — same shape, never a
 *     5xx because an optional signal was unavailable.
 *   - Memoized in-process per ticker: {@link RATING_CACHE_TTL_MS} for an `ok`
 *     rating, {@link RATING_INSUFFICIENT_TTL_MS} for an insufficient one so a
 *     Jev outage does not stick for an hour.
 *   - Every context is bounded (see the caps below).
 */

import type {
  DemandPulse,
  EnvironmentBrief,
  PrismRecommendation,
  RatingDriver,
  RatingDriverDirection,
  RatingDriverName,
  RatingEvidence,
  RatingProbabilities,
  RatingResponse,
  SynthesisMemoResponse,
} from "@mapvest/core";
import { RATING_DISCLAIMER } from "@mapvest/core";
import { getFinancialRatios, getHistoricalCloses, getQuote } from "@mapvest/finance";
import { readSynthesisMemoCache } from "../routes/memo.js";
import { readDemandPulseCache } from "./demand-pulse.js";
import { readEnvironmentBriefCache } from "./environment-brief-generator.js";
import { scoreHeadlineMateriality } from "./headline-materiality.js";
import { JEV_MIN_CONFIDENCE, type JevBatchResult, type JevQuestion, askJev } from "./jev-client.js";
import { fetchTickerNews } from "./news-source.js";
import { getPrismSummary } from "./prism.js";
import { getSituateSummary } from "./situate.js";
import { sectorForTicker } from "./synthesis-memo.js";
import { UNDERLYING_URL, upstreamFetch } from "./underlying.js";

// ---------------- Constants / caps ----------------

export const RATING_ACTIONS = ["strong_sell", "sell", "hold", "buy", "strong_buy"] as const;
export type RatingAction = (typeof RATING_ACTIONS)[number];

export const RATING_DRIVERS: readonly RatingDriverName[] = [
  "valuation",
  "momentum",
  "fundamentals",
  "narrative",
  "macro",
  "local_demand",
  "peer_forecast",
];

export const RATING_CACHE_TTL_MS = 60 * 60 * 1000;
export const RATING_INSUFFICIENT_TTL_MS = 5 * 60 * 1000;
/** Each evidence source gets this long; a slow source is simply absent. */
export const RATING_SOURCE_TIMEOUT_MS = 3_000;
/** Minimum resolved sources before Jev is asked at all. */
export const RATING_MIN_SOURCES = 2;
/** Probability margin (top − second) at which a rating is "strong" / "normal". */
export const STRONG_MARGIN = 0.25;
export const NORMAL_MARGIN = 0.1;
/** noul thresholds for a driver direction. */
export const DRIVER_UP_AT = 0.6;
export const DRIVER_DOWN_AT = 0.4;

const MAX_SUMMARY_CHARS = 300;
const MAX_MEMO_FIELD_CHARS = 280;
const MAX_HEADLINES = 6;
const MAX_HEADLINE_CHARS = 140;
const MAX_FORCES = 3;
const MAX_BUYERS = 4;
const MAX_PEERS = 3;
const HISTORY_PERIOD = "3mo";
const PEER_FORECAST_HORIZON = 3;

// ---------------- Types ----------------

export type RatingSourceId =
  | "quote"
  | "ratios"
  | "synthesis"
  | "pulse"
  | "environment"
  | "prism"
  | "situate"
  | "headlines"
  | "peer_forecast";

export const RATING_SOURCE_IDS: readonly RatingSourceId[] = [
  "quote",
  "ratios",
  "synthesis",
  "pulse",
  "environment",
  "prism",
  "situate",
  "headlines",
  "peer_forecast",
];

/** One resolved evidence source: what Jev sees (`facts`) and what the user sees (`evidence`). */
export type EvidenceItem = {
  id: RatingSourceId;
  driver: RatingDriverName;
  facts: Record<string, unknown>;
  evidence: RatingEvidence;
};

export type RatingSourceFn = (ticker: string, now: Date) => Promise<EvidenceItem | null>;
export type RatingSources = Record<RatingSourceId, RatingSourceFn>;

export type BuildRatingOptions = {
  /** Override any evidence source (tests inject fakes here). */
  sources?: Partial<RatingSources>;
  /** Override the Jev transport (tests inject a fake). */
  ask?: typeof askJev;
  now?: Date;
  sourceTimeoutMs?: number;
};

// ---------------- Small helpers ----------------

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function clamp01(n: number): number {
  return round(Math.min(1, Math.max(0, n)));
}

function pct(n: number, digits = 1): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

// ---------------- Evidence sources ----------------

const quoteSource: RatingSourceFn = async (ticker) => {
  const [q, closes] = await Promise.all([
    getQuote(ticker).catch(() => null),
    getHistoricalCloses(ticker, HISTORY_PERIOD, "1d").catch(() => null),
  ]);
  if (!q && !(closes && closes.length > 1)) return null;
  const facts: Record<string, unknown> = {};
  const bits: string[] = [];
  if (q) {
    facts.price = q.price;
    facts.change_pct_today = round(q.changePct, 2);
    bits.push(`Price $${q.price.toFixed(2)} (${pct(q.changePct)} today)`);
  }
  if (closes && closes.length > 1) {
    const last = closes[closes.length - 1]?.close;
    const first = closes[0]?.close;
    const monthAgo = closes[Math.max(0, closes.length - 22)]?.close;
    const high = Math.max(...closes.map((c) => c.close));
    if (typeof last === "number" && last > 0) {
      const moves: string[] = [];
      if (typeof monthAgo === "number" && monthAgo > 0) {
        const r1 = ((last - monthAgo) / monthAgo) * 100;
        facts.return_1m_pct = round(r1, 2);
        moves.push(`1m ${pct(r1)}`);
      }
      if (typeof first === "number" && first > 0) {
        const r3 = ((last - first) / first) * 100;
        facts.return_3m_pct = round(r3, 2);
        moves.push(`3m ${pct(r3)}`);
      }
      if (Number.isFinite(high) && high > 0) {
        const below = ((high - last) / high) * 100;
        facts.pct_below_3m_high = round(below, 2);
        moves.push(`${below.toFixed(1)}% below 3-month high`);
      }
      if (moves.length) bits.push(moves.join(", "));
    }
  }
  return {
    id: "quote",
    driver: "momentum",
    facts,
    evidence: { source: "quote", summary: clip(bits.join("; "), MAX_SUMMARY_CHARS) },
  };
};

const RATIO_FIELDS: Array<[string, string, (n: number) => string]> = [
  ["priceToEarnings", "P/E", (n) => n.toFixed(1)],
  ["priceToSales", "P/S", (n) => n.toFixed(1)],
  ["priceToBook", "P/B", (n) => n.toFixed(1)],
  ["evToEbitda", "EV/EBITDA", (n) => n.toFixed(1)],
  ["returnOnEquity", "ROE", (n) => `${(Math.abs(n) <= 1.5 ? n * 100 : n).toFixed(0)}%`],
  ["debtToEquity", "D/E", (n) => n.toFixed(2)],
  ["dividendYield", "Div yield", (n) => `${(Math.abs(n) <= 1 ? n * 100 : n).toFixed(1)}%`],
];

const ratiosSource: RatingSourceFn = async (ticker) => {
  const page = await getFinancialRatios({ ticker, limit: 1 });
  const row = page.results?.[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const facts: Record<string, unknown> = {};
  const bits: string[] = [];
  for (const [field, label, fmt] of RATIO_FIELDS) {
    const v = num(row[field]);
    if (v === undefined) continue;
    facts[field] = round(v, 4);
    bits.push(`${label} ${fmt(v)}`);
  }
  if (bits.length === 0) return null;
  if (text(row.date)) facts.as_of = text(row.date);
  return {
    id: "ratios",
    driver: "valuation",
    facts,
    evidence: { source: "ratios", summary: clip(bits.join(", "), MAX_SUMMARY_CHARS) },
  };
};

function synthesisItem(memo: SynthesisMemoResponse): EvidenceItem | null {
  const facts: Record<string, unknown> = {};
  if (memo.bindingConstraint)
    facts.binding_constraint = clip(memo.bindingConstraint, MAX_MEMO_FIELD_CHARS);
  if (memo.demandDurability)
    facts.demand_durability = clip(memo.demandDurability, MAX_MEMO_FIELD_CHARS);
  if (memo.pricingPower) facts.pricing_power = clip(memo.pricingPower, MAX_MEMO_FIELD_CHARS);
  if (Object.keys(facts).length === 0) return null;
  const summary = memo.pricingPower ?? memo.bindingConstraint ?? memo.demandDurability ?? "";
  return {
    id: "synthesis",
    driver: "fundamentals",
    facts,
    evidence: { source: "synthesis_memo", summary: clip(summary, MAX_SUMMARY_CHARS) },
  };
}

const synthesisSource: RatingSourceFn = async (ticker) => {
  const memo = readSynthesisMemoCache(ticker);
  return memo ? synthesisItem(memo) : null;
};

function pulseItem(pulse: DemandPulse): EvidenceItem | null {
  if (pulse.pulse === null && pulse.buyers.length === 0) return null;
  if (pulse.interpretation === "unknown" && pulse.pulse === null) return null;
  const buyers = pulse.buyers.slice(0, MAX_BUYERS).map((b) => ({
    ticker: b.ticker,
    ...(b.revenueYoY === undefined ? {} : { revenue_yoy_pct: round(b.revenueYoY, 1) }),
    ...(b.capexYoY === undefined ? {} : { capex_yoy_pct: round(b.capexYoY, 1) }),
  }));
  const head =
    pulse.pulse === null
      ? `Buyer demand ${pulse.interpretation}`
      : `Buyers' revenue ${pct(pulse.pulse)} YoY (${pulse.interpretation})`;
  const tail = buyers
    .filter((b) => b.revenue_yoy_pct !== undefined)
    .map((b) => `${b.ticker} ${pct(b.revenue_yoy_pct as number, 0)}`)
    .join(", ");
  return {
    id: "pulse",
    driver: "local_demand",
    facts: {
      pulse_pct: pulse.pulse === null ? null : round(pulse.pulse, 1),
      interpretation: pulse.interpretation,
      buyers,
    },
    evidence: {
      source: "demand_pulse",
      summary: clip(tail ? `${head}; ${tail}` : head, MAX_SUMMARY_CHARS),
    },
  };
}

const pulseSource: RatingSourceFn = async (ticker) => {
  const pulse = readDemandPulseCache(ticker);
  return pulse ? pulseItem(pulse) : null;
};

function environmentItem(brief: EnvironmentBrief): EvidenceItem {
  return {
    id: "environment",
    driver: "macro",
    facts: {
      sector: brief.sector,
      headline: clip(brief.headline, MAX_MEMO_FIELD_CHARS),
      tailwinds: brief.tailwinds.slice(0, MAX_FORCES).map((t) => clip(t, MAX_HEADLINE_CHARS)),
      headwinds: brief.headwinds.slice(0, MAX_FORCES).map((h) => clip(h, MAX_HEADLINE_CHARS)),
    },
    evidence: {
      source: "environment_brief",
      summary: clip(`${brief.sector}: ${brief.headline}`, MAX_SUMMARY_CHARS),
    },
  };
}

const environmentSource: RatingSourceFn = async (ticker) => {
  const sector = sectorForTicker(ticker);
  if (!sector) return null;
  const brief = readEnvironmentBriefCache(sector);
  return brief ? environmentItem(brief) : null;
};

/** Prism's stored recommendation + scenario split; `null` when the engine has no packet. */
export function prismItem(raw: unknown, ticker: string): EvidenceItem | null {
  const body = obj(raw);
  if (!body) return null;
  const rec = obj(body.recommendation);
  const facts: Record<string, unknown> = {};
  const bits: string[] = [];
  if (rec) {
    const action = text(rec.action);
    const strength = text(rec.strength);
    const conviction = num(rec.conviction);
    if (action) {
      facts.recommendation = action;
      if (strength) facts.strength = strength;
      if (conviction !== undefined) facts.conviction = round(conviction);
      bits.push(
        `Prism: ${action.replace("_", " ")}${strength ? ` (${strength})` : ""}${
          conviction !== undefined ? `, conviction ${Math.round(conviction * 100)}%` : ""
        }`,
      );
    }
  }
  const cases = obj(obj(body.scenarios)?.cases);
  if (cases) {
    const split: Record<string, number> = {};
    for (const name of ["bull", "neutral", "bear"]) {
      const p = num(obj(cases[name])?.probability);
      if (p !== undefined) split[name] = round(p);
    }
    if (Object.keys(split).length) {
      facts.scenarios = split;
      bits.push(
        Object.entries(split)
          .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
          .join(" / "),
      );
    }
  }
  const regime = text(obj(body.regime)?.label);
  if (regime) {
    facts.regime = regime;
    bits.push(`regime ${regime}`);
  }
  if (bits.length === 0) return null;
  return {
    id: "prism",
    driver: "fundamentals",
    facts,
    evidence: {
      source: "prism",
      summary: clip(bits.join("; "), MAX_SUMMARY_CHARS),
      ref: `${UNDERLYING_URL}/api/prism/${encodeURIComponent(ticker)}/summary`,
    },
  };
}

const prismSource: RatingSourceFn = async (ticker) => {
  const raw = await getPrismSummary(ticker, RATING_SOURCE_TIMEOUT_MS);
  return prismItem(raw, ticker);
};

const STANCE_LABEL: Record<string, string> = {
  odds_favorable: "odds favorable",
  balanced: "balanced",
  odds_unfavorable: "odds unfavorable",
};

/** Situate's stored posture; `null` when the engine has no packet or no memo. */
export function situateItem(raw: unknown, ticker: string): EvidenceItem | null {
  const body = obj(raw);
  const posture = obj(body?.posture);
  const stance = text(posture?.stance);
  if (!posture || !stance) return null;
  const horizon = text(posture.horizon);
  const conviction = num(posture.conviction);
  const facts: Record<string, unknown> = { stance };
  if (horizon) facts.horizon = horizon;
  if (conviction !== undefined) facts.conviction = round(conviction);
  return {
    id: "situate",
    driver: "fundamentals",
    facts,
    evidence: {
      source: "situate",
      summary: clip(
        `Situate: ${STANCE_LABEL[stance] ?? stance}${horizon ? ` at ${horizon}` : ""}${
          conviction !== undefined ? `, conviction ${Math.round(conviction * 100)}%` : ""
        }`,
        MAX_SUMMARY_CHARS,
      ),
      ref: `${UNDERLYING_URL}/api/situate/${encodeURIComponent(ticker)}/summary`,
    },
  };
}

const situateSource: RatingSourceFn = async (ticker) => {
  const raw = await getSituateSummary(ticker, RATING_SOURCE_TIMEOUT_MS);
  return situateItem(raw, ticker);
};

const headlinesSource: RatingSourceFn = async (ticker) => {
  const { items } = await fetchTickerNews(ticker, 10);
  if (items.length === 0) return null;
  const tags = await scoreHeadlineMateriality(
    items.map((it) => ({
      id: it.url,
      ticker,
      title: it.title,
      source: it.source,
      publishedAt: it.publishedAt,
    })),
    [ticker],
  );
  const material = items
    .filter((it) => tags[it.url]?.level === "material")
    .slice(0, MAX_HEADLINES)
    .map((it) => clip(it.title, MAX_HEADLINE_CHARS));
  if (material.length === 0) return null;
  return {
    id: "headlines",
    driver: "narrative",
    facts: { material_headlines: material },
    evidence: {
      source: "headlines",
      summary: clip(material.join(" · "), MAX_SUMMARY_CHARS),
      ref: `/v1/news?ticker=${encodeURIComponent(ticker)}&materiality=material`,
    },
  };
};

/** Maps the SHARED CONTRACT peer-forecast body to an evidence item; `null` unless `available: true`. */
export function peerForecastItem(raw: unknown, ticker: string): EvidenceItem | null {
  const body = obj(raw);
  if (!body || body.available !== true) return null;
  const bucket = text(body.bucket);
  if (!bucket) return null;
  const probs = obj(body.probabilities);
  const p = probs ? num(probs[bucket]) : undefined;
  const excess = num(body.expected_excess_return);
  const confidence = num(body.confidence);
  const etf = text(body.sector_etf);
  const horizon = num(body.horizon_months) ?? PEER_FORECAST_HORIZON;
  const peers = Array.isArray(body.peers)
    ? body.peers
        .map((row) => obj(row))
        .filter((row): row is Record<string, unknown> => Boolean(row))
        .slice(0, MAX_PEERS)
        .map((row) => ({
          symbol: text(row.symbol) ?? "",
          bucket: text(row.bucket) ?? "",
          ...(num(row.expected_excess_return) === undefined
            ? {}
            : { expected_excess_return: round(num(row.expected_excess_return) as number, 4) }),
        }))
        .filter((row) => row.symbol)
    : [];
  const facts: Record<string, unknown> = { bucket, horizon_months: horizon };
  if (probs) {
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(probs)) {
      const n = num(v);
      if (n !== undefined) clean[k] = round(n);
    }
    facts.probabilities = clean;
  }
  if (excess !== undefined) facts.expected_excess_return = round(excess, 4);
  if (confidence !== undefined) facts.confidence = round(confidence);
  if (etf) facts.sector_etf = etf;
  if (peers.length) facts.peers = peers;
  const summary = [
    `Peer forecast: ${bucket.replace("_", " ")}${p !== undefined ? ` (${Math.round(p * 100)}%)` : ""}`,
    etf ? `vs ${etf} over ${horizon}m` : `over ${horizon}m`,
    excess !== undefined ? `expected excess ${pct(excess * 100)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: "peer_forecast",
    driver: "peer_forecast",
    facts,
    evidence: {
      source: "peer_forecast",
      summary: clip(summary, MAX_SUMMARY_CHARS),
      ref: `${UNDERLYING_URL}/api/tabular/peer-forecast/${encodeURIComponent(ticker)}`,
    },
  };
}

const peerForecastSource: RatingSourceFn = async (ticker) => {
  const res = await upstreamFetch(
    `/api/tabular/peer-forecast/${encodeURIComponent(ticker)}?horizon=${PEER_FORECAST_HORIZON}`,
    { method: "GET", timeoutMs: RATING_SOURCE_TIMEOUT_MS },
  );
  // Non-200 (503 = model not installed / no data, 404 = no route yet) → absent.
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return peerForecastItem(body, ticker);
};

export const DEFAULT_RATING_SOURCES: RatingSources = {
  quote: quoteSource,
  ratios: ratiosSource,
  synthesis: synthesisSource,
  pulse: pulseSource,
  environment: environmentSource,
  prism: prismSource,
  situate: situateSource,
  headlines: headlinesSource,
  peer_forecast: peerForecastSource,
};

/**
 * Runs every source in parallel behind its own timeout. A source that throws,
 * rejects, times out, or returns `null` is absent; order is the fixed
 * {@link RATING_SOURCE_IDS} order so the packet is stable across runs.
 */
export async function gatherRatingEvidence(
  ticker: string,
  sources: RatingSources,
  now: Date,
  timeoutMs: number = RATING_SOURCE_TIMEOUT_MS,
): Promise<EvidenceItem[]> {
  const settled = await Promise.all(
    RATING_SOURCE_IDS.map(async (id) => {
      try {
        return await withTimeout(sources[id](ticker, now), timeoutMs);
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((item): item is EvidenceItem => Boolean(item));
}

// ---------------- Pure: Jev questions ----------------

export const RATING_QUESTION_ID = "rating";
export const PRIMARY_DRIVER_QUESTION_ID = "primary_driver";
export const driverQuestionId = (driver: RatingDriverName): string => `up_${driver}`;

/** Distinct drivers present in the packet, in {@link RATING_DRIVERS} order. */
export function driversPresent(evidence: EvidenceItem[]): RatingDriverName[] {
  const present = new Set(evidence.map((e) => e.driver));
  return RATING_DRIVERS.filter((d) => present.has(d));
}

/** The Jev `state`: one keyed block per resolved source, each tagged with its driver. */
export function buildRatingState(
  ticker: string,
  evidence: EvidenceItem[],
  now: Date,
): Record<string, unknown> {
  const packet: Record<string, unknown> = {};
  for (const item of evidence) packet[item.id] = { driver: item.driver, ...item.facts };
  return { ticker, as_of: now.toISOString(), evidence: packet };
}

export function buildRatingQuestions(
  ticker: string,
  evidence: EvidenceItem[],
): Record<string, JevQuestion> {
  const drivers = driversPresent(evidence);
  const questions: Record<string, JevQuestion> = {
    [RATING_QUESTION_ID]: {
      type: "score",
      instructions: `state.evidence holds every evidence source that resolved for $${ticker}, keyed by source id and tagged with the driver family it informs. Weigh them together and rate $${ticker} as a 3-month research signal (not advice) on the ordered scale strong_sell < sell < hold < buy < strong_buy. Choose hold when the evidence is thin, stale, or mixed.`,
      criteria: [...RATING_ACTIONS],
    },
    [PRIMARY_DRIVER_QUESTION_ID]: {
      type: "choice",
      instructions: `Which driver family in state.evidence is the single most decisive input to the rating of $${ticker}? Pick only among the drivers present.`,
      criteria: Object.fromEntries(drivers.map((d) => [d, null])),
    },
  };
  for (const driver of drivers) {
    questions[driverQuestionId(driver)] = {
      type: "noul",
      instructions: `Consider ONLY the state.evidence entries whose driver is "${driver}". Does that evidence argue UP (bullish) for $${ticker} over the next 3 months? Answer with the probability that it argues up.`,
    };
  }
  return questions;
}

// ---------------- Pure: answers → rating ----------------

const ACTION_LABEL: Record<RatingAction, string> = {
  strong_buy: "Strong buy",
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
  strong_sell: "Strong sell",
};

export const DRIVER_LABEL: Record<RatingDriverName, string> = {
  valuation: "valuation",
  momentum: "momentum",
  fundamentals: "fundamentals",
  narrative: "news flow",
  macro: "macro",
  local_demand: "demand pulse",
  peer_forecast: "peer forecast",
};

function isAction(v: unknown): v is RatingAction {
  return typeof v === "string" && (RATING_ACTIONS as readonly string[]).includes(v);
}

/**
 * Normalizes Jev's `score` probabilities onto the five actions. Accepts keys by
 * action name or by criteria index ("0".."4"); returns `null` when there is no
 * usable mass (nothing is fabricated in that case).
 */
export function normalizeProbabilities(raw: unknown): RatingProbabilities | null {
  const probs = obj(raw);
  if (!probs) return null;
  const out: Record<RatingAction, number> = {
    strong_sell: 0,
    sell: 0,
    hold: 0,
    buy: 0,
    strong_buy: 0,
  };
  let mass = 0;
  for (const [key, value] of Object.entries(probs)) {
    const p = num(value);
    if (p === undefined || p < 0) continue;
    const action = isAction(key) ? key : RATING_ACTIONS[Number(key)];
    if (!action) continue;
    out[action] += p;
    mass += p;
  }
  if (mass <= 0) return null;
  for (const action of RATING_ACTIONS) out[action] = round(out[action] / mass);
  return out;
}

/** Action from probabilities (argmax), else from an integer `score` index into the criteria. */
export function actionFromScore(
  probabilities: RatingProbabilities | null,
  score: number | undefined,
): RatingAction | null {
  if (probabilities) {
    let best: RatingAction = "hold";
    for (const action of RATING_ACTIONS) {
      if (probabilities[action] > probabilities[best]) best = action;
    }
    return best;
  }
  if (
    score !== undefined &&
    Number.isInteger(score) &&
    score >= 0 &&
    score < RATING_ACTIONS.length
  ) {
    return RATING_ACTIONS[score] ?? null;
  }
  return null;
}

export function strengthFromProbabilities(
  probabilities: RatingProbabilities | null,
): PrismRecommendation["strength"] {
  if (!probabilities) return "normal";
  const sorted = RATING_ACTIONS.map((a) => probabilities[a]).sort((a, b) => b - a);
  const margin = (sorted[0] ?? 0) - (sorted[1] ?? 0);
  if (margin >= STRONG_MARGIN) return "strong";
  if (margin >= NORMAL_MARGIN) return "normal";
  return "weak";
}

export function directionFromNoul(p: number): RatingDriverDirection {
  if (p >= DRIVER_UP_AT) return "up";
  if (p <= DRIVER_DOWN_AT) return "down";
  return "flat";
}

/**
 * Drivers from the per-driver nouls, primary first (Jev's confident `choice`,
 * else the heaviest), then by weight. A driver whose noul is missing is kept
 * as `flat` with weight 0 so the list still names every evidence family used.
 */
export function driversFromAnswers(
  evidence: EvidenceItem[],
  answers: Record<string, { type: string; [k: string]: unknown }>,
): RatingDriver[] {
  const drivers: RatingDriver[] = driversPresent(evidence).map((name) => {
    const answer = answers[driverQuestionId(name)];
    const p = answer?.type === "noul" ? num(answer.noul) : undefined;
    if (p === undefined) return { name, direction: "flat", weight: 0 };
    return { name, direction: directionFromNoul(p), weight: clamp01(Math.abs(2 * p - 1)) };
  });
  const choice = answers[PRIMARY_DRIVER_QUESTION_ID];
  const primary =
    choice?.type === "choice" &&
    typeof choice.choice === "string" &&
    (num(choice.confidence) ?? 0) >= JEV_MIN_CONFIDENCE
      ? choice.choice
      : undefined;
  const order = new Map(RATING_DRIVERS.map((d, i) => [d, i]));
  drivers.sort((a, b) => {
    if (a.name === primary) return -1;
    if (b.name === primary) return 1;
    if (b.weight !== a.weight) return b.weight - a.weight;
    return (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0);
  });
  return drivers;
}

/**
 * DETERMINISTIC one-liner: action label, then up to two supporting drivers,
 * then up to two opposing drivers as headwinds. No model prose.
 *
 *   "Buy · momentum + fundamentals; macro headwind"
 *   "Hold · mixed signals"
 */
export function oneLineFor(action: RatingAction, drivers: RatingDriver[]): string {
  const ups = drivers
    .filter((d) => d.direction === "up")
    .slice(0, 2)
    .map((d) => DRIVER_LABEL[d.name]);
  const downs = drivers
    .filter((d) => d.direction === "down")
    .slice(0, 2)
    .map((d) => DRIVER_LABEL[d.name]);
  const head = ACTION_LABEL[action];
  if (ups.length === 0 && downs.length === 0) return `${head} · mixed signals`;
  const parts: string[] = [];
  if (ups.length) parts.push(ups.join(" + "));
  if (downs.length) parts.push(`${downs.join(" + ")} headwind${downs.length > 1 ? "s" : ""}`);
  return `${head} · ${parts.join("; ")}`;
}

function insufficient(
  ticker: string,
  evidence: EvidenceItem[],
  drivers: RatingDriver[],
  now: Date,
): RatingResponse {
  return {
    ticker,
    status: "insufficient_signal",
    rating: null,
    probabilities: null,
    confidence: 0,
    drivers,
    evidence: evidence.map((e) => e.evidence),
    inputs_used: evidence.map((e) => e.id),
    as_of: now.toISOString(),
    disclaimer: RATING_DISCLAIMER,
  };
}

/**
 * PURE. Turns one batched Jev result into the response. Any unusable or
 * low-confidence score answer yields `insufficient_signal` (with whatever
 * drivers the nouls still support), never a throw.
 */
export function ratingFromAnswers(
  ticker: string,
  evidence: EvidenceItem[],
  result: JevBatchResult,
  now: Date,
): RatingResponse {
  if (!result.ok) return insufficient(ticker, evidence, [], now);
  const answers = result.answers as Record<string, { type: string; [k: string]: unknown }>;
  const drivers = driversFromAnswers(evidence, answers);
  const scored = answers[RATING_QUESTION_ID];
  if (!scored || scored.type !== "score") return insufficient(ticker, evidence, drivers, now);
  const confidence = num(scored.confidence);
  if (confidence === undefined || confidence < JEV_MIN_CONFIDENCE) {
    return insufficient(ticker, evidence, drivers, now);
  }
  const probabilities = normalizeProbabilities(scored.probabilities);
  const action = actionFromScore(probabilities, num(scored.score));
  if (!action) return insufficient(ticker, evidence, drivers, now);
  const rating: PrismRecommendation = {
    action,
    strength: strengthFromProbabilities(probabilities),
    conviction: clamp01(confidence),
    one_line: oneLineFor(action, drivers),
  };
  return {
    ticker,
    status: "ok",
    rating,
    probabilities,
    confidence: clamp01(confidence),
    drivers,
    evidence: evidence.map((e) => e.evidence),
    inputs_used: evidence.map((e) => e.id),
    as_of: now.toISOString(),
    disclaimer: RATING_DISCLAIMER,
  };
}

// ---------------- Cache + public API ----------------

type CacheEntry = { expiresAt: number; value: RatingResponse };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<RatingResponse>>();
const CACHE_SWEEP_AT = 512;

/** Test-only. Public callers should not reach in. */
export function _clearRatingCache(): void {
  cache.clear();
  inFlight.clear();
}

export function readRatingCache(ticker: string, now: number = Date.now()): RatingResponse | null {
  const key = ticker.trim().toUpperCase();
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key: string, value: RatingResponse, now: number): void {
  if (cache.size >= CACHE_SWEEP_AT) {
    for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  }
  const ttl = value.status === "ok" ? RATING_CACHE_TTL_MS : RATING_INSUFFICIENT_TTL_MS;
  cache.set(key, { value, expiresAt: now + ttl });
}

async function computeRating(ticker: string, opts: BuildRatingOptions): Promise<RatingResponse> {
  const now = opts.now ?? new Date();
  const sources: RatingSources = { ...DEFAULT_RATING_SOURCES, ...(opts.sources ?? {}) };
  const ask = opts.ask ?? askJev;
  const evidence = await gatherRatingEvidence(
    ticker,
    sources,
    now,
    opts.sourceTimeoutMs ?? RATING_SOURCE_TIMEOUT_MS,
  );
  if (evidence.length < RATING_MIN_SOURCES) return insufficient(ticker, evidence, [], now);
  let result: JevBatchResult;
  try {
    result = await ask(
      buildRatingState(ticker, evidence, now),
      buildRatingQuestions(ticker, evidence),
    );
  } catch (err) {
    result = {
      ok: false,
      reason: "network_error",
      detail: err instanceof Error ? err.message : "",
    };
  }
  return ratingFromAnswers(ticker, evidence, result, now);
}

/**
 * The rating for `ticker`, from cache when fresh. Never throws; never spends
 * a generation. Concurrent callers for one ticker share a single computation.
 */
export async function buildRating(
  ticker: string,
  opts: BuildRatingOptions = {},
): Promise<RatingResponse> {
  const key = ticker.trim().toUpperCase();
  const nowMs = (opts.now ?? new Date()).getTime();
  const cached = readRatingCache(key, nowMs);
  if (cached) return cached;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = computeRating(key, opts)
      .catch(() => insufficient(key, [], [], opts.now ?? new Date()))
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const value = await pending;
  writeCache(key, value, nowMs);
  return value;
}
