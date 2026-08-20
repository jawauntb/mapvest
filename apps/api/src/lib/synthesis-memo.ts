/**
 * Synthesis memo (Universe Roadmap §3 C5).
 *
 * The memo that reads the layers. C1 gave us the value chain, C3 the demand
 * pulse sitting above it, C4 the field the sector sits in; this asks one model,
 * once, the three questions those layers exist to answer:
 *
 *   1. What is the binding constraint on this business?
 *   2. How durable is the demand above it?
 *   3. Where in the chain does pricing power sit?
 *
 * Shape mirrors `demand-pulse.ts`: the I/O (`buildSynthesisMemo`) is separated
 * from the pure surface (`buildSynthesisPrompt` / `parseSynthesis`), so prompt
 * composition and model-output parsing are fully testable offline.
 *
 * Hard rules:
 *   - Reading edges NEVER triggers graph generation (`listEdges` only).
 *     `GET /v1/graph/:ticker` remains the sole path that spends judge money.
 *   - Every layer is gathered best-effort behind its own try/catch. A layer
 *     that fails is ABSENT from the prompt and the prompt says so explicitly;
 *     the model is instructed to name the gap rather than fill it. With zero
 *     layers the memo still generates from ratios alone and states that the
 *     graph is empty.
 *   - `sources` is the union of the layers' real citations, deduped by url and
 *     capped (AGENTS.md §6). Nothing is synthesized into a citation; a memo
 *     built from no layer data returns few sources, not invented ones.
 *   - No buy/sell advice, no price targets — enforced in the system prompt.
 */
import type {
  CompanyEdge,
  DemandPulse,
  EnvironmentBrief,
  Source,
  SynthesisMemoResponse,
} from "@mapvest/core";
import {
  type FinancialRatios,
  canonicalSector,
  getFinancialRatios,
  seedBrands,
} from "@mapvest/finance";
import { buildDemandPulse } from "./demand-pulse.js";
import { listEdges } from "./edges-store.js";
import {
  environmentBriefAvailability,
  generateEnvironmentBrief,
} from "./environment-brief-generator.js";
import { marketDataSource } from "./marketDataSource.js";

/** Max edges handed to the model as value-chain evidence. */
const MAX_EDGES = 12;
/** Max buyers listed in the demand block. */
const MAX_BUYERS = 6;
/** Max tailwind/headwind bullets carried from the environment brief. */
const MAX_FORCES = 4;
/** Max top-level sources on the response (roadmap C5). */
const MAX_SOURCES = 12;

const PRIMARY_MODEL = "anthropic/claude-opus-4.8";
const FALLBACK_MODELS = ["openai/gpt-5.6-terra", "x-ai/grok-4.6"] as const;
const OPENROUTER_TIMEOUT_MS = 30_000;

// ---------------- Types ----------------

/** Everything the prompt builder reads. A `null` layer means "not available". */
export type SynthesisInputs = {
  ticker: string;
  edges: CompanyEdge[];
  pulse: DemandPulse | null;
  environment: EnvironmentBrief | null;
  ratios: FinancialRatios | null;
};

/** The model's answer, after parsing. `memo` is required; the rest degrade. */
export type ParsedSynthesis = {
  memo: string;
  bindingConstraint?: string;
  demandDurability?: string;
  pricingPower?: string;
};

// ---------------- Sector resolution (best-effort) ----------------

let tickerSectorIndex: Map<string, string> | null = null;

/**
 * Ticker → canonical GICS sector, built once from the seed brand map. Purely a
 * convenience index: a ticker that is not in the seed map has no sector here,
 * and the environment layer is simply skipped rather than guessed.
 */
export function sectorForTicker(ticker: string): string | null {
  const key = ticker.trim().toUpperCase();
  if (!key) return null;
  if (!tickerSectorIndex) {
    const index = new Map<string, string>();
    for (const entry of Object.values(seedBrands)) {
      const sector = entry.sector ? canonicalSector(entry.sector) : null;
      if (!sector) continue;
      const t = entry.ticker.trim().toUpperCase();
      if (!t || index.has(t)) continue;
      index.set(t, sector);
    }
    tickerSectorIndex = index;
  }
  return tickerSectorIndex.get(key) ?? null;
}

// ---------------- Pure: prompt ----------------

export const SYNTHESIS_SYSTEM_PROMPT = `You are writing the "Synthesis Memo" for one public company for a private investor.

You are handed up to four layers of already-gathered data: the company's value-chain graph (who it supplies and buys from), the demand pulse above it (how the revenue and capex of its buyers are trending), the environment brief for its sector (macro and policy field), and its financial ratios. Your job is to READ THOSE LAYERS TOGETHER, not to recite them.

Answer exactly three questions:
  1. What is the binding constraint on this business — the thing that actually caps it right now?
  2. How durable is the demand sitting above it?
  3. Where in the chain does pricing power sit — with this company, with its suppliers, or with its buyers?

Return STRICT JSON only:
  { "memo": string, "bindingConstraint": string, "demandDurability": string, "pricingPower": string }
No prose outside the JSON.

"memo" — short markdown, 3 to 5 paragraphs, no headings. It must explicitly cite the layer facts it uses (name the counterparty, the YoY figure, the macro series, or the ratio you are reasoning from). Where a layer is empty, say so in the memo in one clause and reason from what remains.
"bindingConstraint" / "demandDurability" / "pricingPower" — one to three sentences each, direct answers to questions 1-3.

Rules:
- Answer ONLY from the layer data provided below. NEVER invent a supplier, a customer, a statistic, a rate, a ratio, or a date.
- Where a layer is marked unavailable or empty, SAY SO plainly instead of inventing its content. An honest gap beats a confident guess.
- Do not give buy/sell/hold advice, do not name a price target, and do not predict a share price.
- Plain-spoken, third-person, no hype, no exclamation marks, no emojis.`;

function fmtEdgeLine(e: CompanyEdge): string {
  const who = e.dstTicker ? `${e.dstName} (${e.dstTicker})` : `${e.dstName} (private)`;
  const url = e.sources.find((s) => s.url)?.url;
  const parts = [
    `- ${who} — weight ${e.weight.toFixed(2)}${e.asOf ? `, as of ${e.asOf}` : ""}`,
    e.reasoning ? `  ${e.reasoning}` : "",
    url ? `  (source: ${url})` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

function edgesBlock(edges: CompanyEdge[]): string {
  if (edges.length === 0) {
    return "(no value-chain graph stored for this ticker — the graph is empty)";
  }
  // Edge semantics (valueChain.ts): "supplies" = the counterparty sells TO
  // this company (a supplier); "buys_from" = the counterparty BUYS this
  // company's products (a buyer/customer).
  const groups: Array<[CompanyEdge["edgeType"], string]> = [
    ["supplies", "Suppliers (this company buys inputs from them)"],
    ["buys_from", "Buyers/customers (they buy this company's products)"],
    ["competes_with", "Competes with"],
    ["complements", "Complements"],
  ];
  const out: string[] = [];
  for (const [type, label] of groups) {
    const rows = edges.filter((e) => e.edgeType === type);
    if (rows.length === 0) continue;
    out.push(`${label}:\n${rows.map(fmtEdgeLine).join("\n")}`);
  }
  return out.length > 0 ? out.join("\n\n") : "(no value-chain graph stored for this ticker)";
}

function pulseBlock(pulse: DemandPulse | null): string {
  if (!pulse || (pulse.pulse === null && pulse.buyers.length === 0)) {
    return "(no demand pulse available — the buyers above this company did not resolve)";
  }
  const head =
    pulse.pulse === null
      ? `Weighted buyer trend: unavailable (interpretation: ${pulse.interpretation})`
      : `Weighted buyer trend: ${pulse.pulse.toFixed(1)}% YoY (interpretation: ${pulse.interpretation})`;
  const rows = pulse.buyers.slice(0, MAX_BUYERS).map((b) => {
    const bits = [
      b.revenueYoY === undefined ? null : `revenue ${b.revenueYoY.toFixed(1)}% YoY`,
      b.capexYoY === undefined ? null : `capex ${b.capexYoY.toFixed(1)}% YoY`,
      `weight ${b.weight.toFixed(2)}`,
    ].filter(Boolean);
    return `- ${b.name ? `${b.name} (${b.ticker})` : b.ticker}: ${bits.join(", ")}`;
  });
  return rows.length > 0 ? `${head}\n${rows.join("\n")}` : head;
}

function environmentBlock(brief: EnvironmentBrief | null): string {
  if (!brief) return "(no environment brief available for this sector)";
  const series = brief.series.length
    ? brief.series
        .map(
          (s) => `- ${s.label} (${s.id}): ${s.latest}${s.unit ? ` ${s.unit}` : ""} as of ${s.asOf}`,
        )
        .join("\n")
    : "- (no macro series)";
  const tail = brief.tailwinds.slice(0, MAX_FORCES).map((t) => `- ${t}`);
  const head = brief.headwinds.slice(0, MAX_FORCES).map((h) => `- ${h}`);
  return [
    `Sector: ${brief.sector}`,
    `Headline: ${brief.headline}`,
    `Macro series:\n${series}`,
    tail.length ? `Tailwinds:\n${tail.join("\n")}` : "",
    head.length ? `Headwinds:\n${head.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const RATIO_FIELDS: Array<[keyof FinancialRatios, string]> = [
  ["priceToEarnings", "P/E"],
  ["priceToSales", "P/S"],
  ["priceToBook", "P/B"],
  ["priceToFreeCashFlow", "P/FCF"],
  ["evToEbitda", "EV/EBITDA"],
  ["evToSales", "EV/Sales"],
  ["returnOnEquity", "Return on equity"],
  ["returnOnAssets", "Return on assets"],
  ["debtToEquity", "Debt/equity"],
  ["current", "Current ratio"],
  ["quick", "Quick ratio"],
  ["dividendYield", "Dividend yield"],
  ["freeCashFlow", "Free cash flow"],
  ["marketCap", "Market cap"],
];

function ratiosBlock(ratios: FinancialRatios | null): string {
  if (!ratios) return "(no financial ratios available for this ticker)";
  const rows: string[] = [];
  for (const [field, label] of RATIO_FIELDS) {
    const v = ratios[field];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    rows.push(`- ${label}: ${v}`);
  }
  if (rows.length === 0) return "(no financial ratios available for this ticker)";
  return [ratios.date ? `As of ${ratios.date}` : "", ...rows].filter(Boolean).join("\n");
}

/**
 * PURE. Compose the user turn from whichever layers resolved. Every layer gets
 * a section whether or not it has data — an absent layer is stated as absent so
 * the model names the gap instead of hallucinating into it.
 */
export function buildSynthesisPrompt(inputs: SynthesisInputs): string {
  const ticker = inputs.ticker.trim().toUpperCase();
  const edges = inputs.edges.slice(0, MAX_EDGES);
  return [
    `Ticker: ${ticker}`,
    "",
    `LAYER 1 — Value chain (from the company graph):\n${edgesBlock(edges)}`,
    "",
    `LAYER 2 — Demand pulse (trajectory of this company's buyers):\n${pulseBlock(inputs.pulse)}`,
    "",
    `LAYER 3 — Environment (sector macro field):\n${environmentBlock(inputs.environment)}`,
    "",
    `LAYER 4 — Financial ratios:\n${ratiosBlock(inputs.ratios)}`,
    "",
    `Write the Synthesis Memo for ${ticker}. Use only the layers above; name any layer that is empty rather than inventing its content.`,
  ].join("\n");
}

// ---------------- Pure: parsing ----------------

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * PURE. Parse one model completion into a `ParsedSynthesis`, tolerating code
 * fences and prose either side of the JSON object. Returns `null` for anything
 * unusable (bad JSON, wrong shape, empty memo) — the caller then falls through
 * to the next model in the cascade rather than shipping a half-memo.
 */
export function parseSynthesis(raw: string): ParsedSynthesis | null {
  if (typeof raw !== "string") return null;
  const stripped = raw
    .replace(/^\s*```(?:json|JSON)?\s*/, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  const slice = first !== -1 && last > first ? stripped.slice(first, last + 1) : stripped;
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const memo = optionalText(obj.memo);
  if (!memo) return null;
  const out: ParsedSynthesis = { memo };
  const bindingConstraint = optionalText(obj.bindingConstraint);
  const demandDurability = optionalText(obj.demandDurability);
  const pricingPower = optionalText(obj.pricingPower);
  if (bindingConstraint) out.bindingConstraint = bindingConstraint;
  if (demandDurability) out.demandDurability = demandDurability;
  if (pricingPower) out.pricingPower = pricingPower;
  return out;
}

/**
 * PURE. Union of the layers' citations, deduped by url (sourceless entries
 * dedupe on provider+confidence) and capped at 12. Never fabricates: a memo
 * with no cited layer returns fewer sources, not invented ones.
 */
export function unionSources(inputs: {
  edges: CompanyEdge[];
  pulse: DemandPulse | null;
  environment: EnvironmentBrief | null;
  ratiosSource: Source | null;
}): Source[] {
  const all: Source[] = [];
  for (const e of inputs.edges) all.push(...e.sources);
  if (inputs.pulse) all.push(...inputs.pulse.sources);
  if (inputs.environment) all.push(...inputs.environment.sources);
  if (inputs.ratiosSource) all.push(inputs.ratiosSource);

  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of all) {
    const key = s.url ?? `${s.provider}:${s.confidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

// ---------------- I/O: gather ----------------

/** Stored edges only — never triggers extraction. Failure yields []. */
async function gatherEdges(ticker: string): Promise<CompanyEdge[]> {
  try {
    return await listEdges(ticker);
  } catch (err) {
    console.warn(`[synthesis-memo] edges unavailable for ${ticker}:`, err);
    return [];
  }
}

async function gatherPulse(ticker: string, now: Date): Promise<DemandPulse | null> {
  try {
    return await buildDemandPulse(ticker, { now });
  } catch (err) {
    console.warn(`[synthesis-memo] demand pulse unavailable for ${ticker}:`, err);
    return null;
  }
}

async function gatherEnvironment(ticker: string, now: Date): Promise<EnvironmentBrief | null> {
  try {
    const sector = sectorForTicker(ticker);
    if (!sector) return null;
    if (!environmentBriefAvailability().ok) return null;
    return await generateEnvironmentBrief(sector, { now });
  } catch (err) {
    console.warn(`[synthesis-memo] environment brief unavailable for ${ticker}:`, err);
    return null;
  }
}

async function gatherRatios(
  ticker: string,
): Promise<{ ratios: FinancialRatios | null; source: Source | null }> {
  try {
    const page = await getFinancialRatios({ ticker, limit: 1 });
    const row = page.results?.[0];
    if (!row) return { ratios: null, source: null };
    return { ratios: row, source: marketDataSource() };
  } catch (err) {
    console.warn(`[synthesis-memo] ratios unavailable for ${ticker}:`, err);
    return { ratios: null, source: null };
  }
}

// ---------------- I/O: model ----------------

async function requestOpenRouter(
  model: string,
  apiKey: string,
  baseUrl: string,
  userContent: string,
): Promise<ParsedSynthesis> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mapvest.app",
        "X-Title": "Mapvest",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" as const },
        temperature: 0.2,
        messages: [
          { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${model} ${res.status}`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = parseSynthesis(j.choices?.[0]?.message?.content ?? "");
    if (!parsed) throw new Error(`OpenRouter ${model} returned an unparseable synthesis memo`);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(userContent: string): Promise<ParsedSynthesis> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing (Doppler)");
  let lastErr: unknown;
  for (const model of [PRIMARY_MODEL, ...FALLBACK_MODELS]) {
    try {
      return await requestOpenRouter(model, apiKey, baseUrl, userContent);
    } catch (err) {
      lastErr = err;
      console.warn(`[synthesis-memo] model ${model} failed, trying next:`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------- Public API ----------------

/**
 * Gather every layer best-effort, then compose ONE model call over them.
 *
 * Throws only when the model cascade itself fails (the route surfaces a 502) —
 * a missing layer is never an error, it is a stated gap inside the memo. With
 * no graph, no pulse, and no environment brief the memo is still written from
 * ratios alone and says the graph is empty.
 */
export async function buildSynthesisMemo(
  ticker: string,
  opts?: { now?: Date },
): Promise<SynthesisMemoResponse> {
  const key = ticker.trim().toUpperCase();
  const now = opts?.now ?? new Date();

  const [edges, pulse, environment, ratiosResult] = await Promise.all([
    gatherEdges(key),
    gatherPulse(key, now),
    gatherEnvironment(key, now),
    gatherRatios(key),
  ]);

  const prompt = buildSynthesisPrompt({
    ticker: key,
    edges,
    pulse,
    environment,
    ratios: ratiosResult.ratios,
  });
  const parsed = await callOpenRouter(prompt);

  const response: SynthesisMemoResponse = {
    ticker: key,
    memo: parsed.memo,
    generatedAt: now.toISOString(),
    sources: unionSources({
      edges: edges.slice(0, MAX_EDGES),
      pulse,
      environment,
      ratiosSource: ratiosResult.source,
    }),
  };
  if (parsed.bindingConstraint) response.bindingConstraint = parsed.bindingConstraint;
  if (parsed.demandDurability) response.demandDurability = parsed.demandDurability;
  if (parsed.pricingPower) response.pricingPower = parsed.pricingPower;
  return response;
}
