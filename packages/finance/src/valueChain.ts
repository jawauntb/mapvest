/**
 * Value-chain extraction (Universe Roadmap §3 C1).
 *
 * Given a listed ticker, gather open-web evidence (Exa) plus any SEC filing
 * citations the caller already resolved, then let the same OpenRouter judge
 * cascade used by `comparable.ts` propose *cited* company-to-company edges:
 * suppliers, buyers, competitors, complements.
 *
 * Hard rules (AGENTS.md §4 / §6):
 *   - never invent a ticker — implausible symbols are dropped and the edge
 *     keeps only `dstName` (private / unlisted counterparty);
 *   - every edge carries `sources: Source[]`; no evidence → no edge;
 *   - judge failure returns [] — we do not fabricate a heuristic value chain.
 */
import { type CompanyEdge, CompanyEdgeType, type Source } from "@mapvest/core";
import { type SearchResult, enrichTicker, toSource } from "@mapvest/search";
import { isPlausibleTicker } from "./tickerSymbol.js";

const PRIMARY_MODEL = "openai/gpt-5.6-terra";
const FALLBACK_MODELS = ["anthropic/claude-opus-4.8", "x-ai/grok-4.6"] as const;

/** Max edges we accept from one extraction pass. */
const MAX_EDGES = 12;
/** Max Exa hits handed to the judge as evidence. */
const MAX_WEB_EVIDENCE = 12;

/**
 * Loose URL key for matching the judge's cited `sourceUrl` back to evidence.
 * Models routinely echo a URL without its tracking params, trailing slash,
 * `www.`, or protocol — none of which changes which document the edge cites,
 * but an exact-string lookup dropped every such edge and left graphs with a
 * single lane. Only ever used for matching; the emitted source keeps the
 * evidence's canonical URL.
 */
export function evidenceUrlKey(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");
  const noFragment = s.split("#")[0] ?? s;
  const noQuery = noFragment.split("?")[0] ?? noFragment;
  return noQuery.replace(/^www\./, "").replace(/\/+$/, "");
}

/** A `CompanyEdge` before the store assigns identity / provenance columns. */
export type CompanyEdgeInput = Omit<CompanyEdge, "id" | "createdAt" | "srcTicker">;

/** One filing citation (label + URL) used as extra evidence. */
export type FilingRef = { label: string; url: string };

/** Raw, unvalidated judge output. `relation` is checked against the enum later. */
export type EdgePick = {
  counterparty: string;
  ticker?: string;
  relation: string;
  weight: number;
  reasoning: string;
  sourceUrl?: string;
};

type EvidenceItem = {
  i: number;
  kind: "web" | "filing";
  title: string;
  url: string;
  snippet: string;
};

/**
 * Pure parser for the judge's JSON payload — exported so the wire contract can
 * be tested offline. Tolerates ```json fences and prose around the object.
 * Anything unparseable (or structurally wrong) yields [] rather than throwing.
 */
export function parseEdgePicks(raw: string): EdgePick[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
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
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const edges = (parsed as { edges?: unknown }).edges;
  if (!Array.isArray(edges)) return [];

  const out: EdgePick[] = [];
  for (const e of edges) {
    if (!e || typeof e !== "object") continue;
    const row = e as Record<string, unknown>;
    const counterparty = typeof row.counterparty === "string" ? row.counterparty.trim() : "";
    const relation = typeof row.relation === "string" ? row.relation.trim() : "";
    if (!counterparty || !relation) continue;
    const rawWeight = typeof row.weight === "number" ? row.weight : Number(row.weight);
    const weight = Number.isFinite(rawWeight) ? Math.min(1, Math.max(0, rawWeight)) : 0.5;
    out.push({
      counterparty,
      ticker: typeof row.ticker === "string" && row.ticker.trim() ? row.ticker.trim() : undefined,
      relation,
      weight,
      reasoning: typeof row.reasoning === "string" ? row.reasoning.trim() : "",
      sourceUrl:
        typeof row.sourceUrl === "string" && row.sourceUrl.trim() ? row.sourceUrl : undefined,
    });
    if (out.length >= MAX_EDGES) break;
  }
  return out;
}

/**
 * Extract a ticker's value chain as cited edges.
 *
 * Pipeline: four Exa queries (one per lane: suppliers / customers /
 * competitors / complements), deduped by URL, plus `opts.filings` appended as
 * evidence → OpenRouter judge cascade → enum + plausible-ticker validation →
 * `CompanyEdgeInput[]`.
 */
export async function extractValueChain(
  ticker: string,
  opts?: { filings?: FilingRef[] },
): Promise<CompanyEdgeInput[]> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return [];

  const filings = (opts?.filings ?? []).filter((f) => f?.url);
  // One query per lane — competitors and complements used to share a query,
  // which is why graphs came back with whole lanes missing.
  const queries = [
    `${symbol} key suppliers single source components 10-K`,
    `${symbol} largest customers revenue concentration 10-K`,
    `${symbol} main competitors rivalry market share`,
    `${symbol} ecosystem partners complementary products integrations`,
  ];

  const settled = await Promise.all(
    queries.map(async (q) => {
      try {
        return await enrichTicker(q);
      } catch {
        return [] as SearchResult[];
      }
    }),
  );

  const byUrl = new Map<string, SearchResult>();
  for (const batch of settled) {
    for (const h of batch) {
      if (!h.url || byUrl.has(h.url)) continue;
      byUrl.set(h.url, h);
    }
  }
  const hits = [...byUrl.values()].slice(0, MAX_WEB_EVIDENCE);
  if (hits.length === 0 && filings.length === 0) return [];

  const filingUrls = new Set(filings.map((f) => f.url));
  const webByKey = new Map<string, SearchResult>();
  for (const h of byUrl.values()) webByKey.set(evidenceUrlKey(h.url), h);
  const filingByKey = new Map<string, string>();
  for (const f of filings) filingByKey.set(evidenceUrlKey(f.url), f.url);
  const evidence: EvidenceItem[] = [
    ...hits.map((h, i) => ({
      i,
      kind: "web" as const,
      title: h.title,
      url: h.url,
      snippet: h.snippet ?? "",
    })),
    ...filings.map((f, k) => ({
      i: hits.length + k,
      kind: "filing" as const,
      title: f.label,
      url: f.url,
      snippet:
        "SEC filing citation (items 1 / 1A disclose supplier concentration and >10% customers).",
    })),
  ];

  let picks: EdgePick[] = [];
  try {
    picks = await judgeValueChain(symbol, evidence);
  } catch (err) {
    console.warn("[finance] value-chain judge failed, returning no edges:", err);
    return [];
  }

  const now = new Date().toISOString();
  const out: CompanyEdgeInput[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const parsedType = CompanyEdgeType.safeParse(p.relation);
    if (!parsedType.success) continue;
    const edgeType = parsedType.data;

    const dstName = p.counterparty.trim();
    if (!dstName) continue;

    const candidate = p.ticker?.toUpperCase();
    const dstTicker = candidate && isPlausibleTicker(candidate) ? candidate : undefined;
    if (dstTicker && dstTicker === symbol) continue;

    const key = `${edgeType}:${dstTicker ?? dstName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Contract (core schema + AGENTS.md §6): an edge that cannot be tied to a
    // real evidence URL is not emitted — never synthesize a judge-only source.
    // Matching is loose (see evidenceUrlKey); the emitted source is canonical.
    const hit = p.sourceUrl
      ? (byUrl.get(p.sourceUrl) ?? webByKey.get(evidenceUrlKey(p.sourceUrl)))
      : undefined;
    let source: Source;
    if (hit) {
      source = toSource(hit);
    } else {
      const filingUrl = p.sourceUrl
        ? filingUrls.has(p.sourceUrl)
          ? p.sourceUrl
          : filingByKey.get(evidenceUrlKey(p.sourceUrl))
        : undefined;
      if (!filingUrl) continue;
      source = {
        provider: "sec",
        url: filingUrl,
        fetchedAt: now,
        confidence: "high",
      };
    }

    out.push({
      dstTicker,
      dstName,
      edgeType,
      weight: Math.min(1, Math.max(0, p.weight)),
      reasoning: p.reasoning || `Cited via ${p.sourceUrl ?? "OpenRouter judge"}`,
      sources: [source],
    });
    if (out.length >= MAX_EDGES) break;
  }
  return out;
}

const SYSTEM_PROMPT = (symbol: string) => `You map the value chain of a public company for Mapvest.
Return JSON: { "edges": [{ "counterparty": "Taiwan Semiconductor Manufacturing", "ticker": "TSM", "relation": "supplies", "weight": 0.0-1.0, "reasoning": "...", "sourceUrl": "https://..." }] }
Rules:
- "relation" is the relationship FROM the counterparty TOWARD ${symbol}:
  - "supplies" — the counterparty sells components/services TO ${symbol} (it is a supplier/vendor).
  - "buys_from" — the counterparty BUYS ${symbol}'s products (it is a buyer/customer of ${symbol}).
  - "competes_with" — the counterparty competes with ${symbol}.
  - "complements" — the counterparty's products make ${symbol}'s products more valuable (partner/ecosystem).
  Do not flip these: a supplier is "supplies"; labelling a customer "supplies" is WRONG, and a customer is "buys_from".
- "ticker" only for real exchange-listed companies (1-5 uppercase letters). Omit "ticker" entirely for private, state-owned, or unlisted counterparties. NEVER invent, guess, or abbreviate a ticker.
- "weight" is how material the relationship is to ${symbol} (0.9 = single-source supplier or >10% customer, 0.3 = minor).
- Max ${MAX_EDGES} edges. Only edges defensible from the provided evidence — return an empty array if the evidence supports none.
- Cover EVERY relation type the evidence supports: if the evidence names suppliers, customers, competitors, and complements, return edges for all four — do not stop after one category.
- Every edge MUST set "sourceUrl" to one of the provided evidence URLs. An edge you cannot tie to a specific evidence URL must be omitted, not guessed.`;

async function callValueChainJudge(
  model: string,
  apiKey: string,
  baseUrl: string,
  symbol: string,
  evidence: EvidenceItem[],
): Promise<EdgePick[]> {
  const body = {
    model,
    response_format: { type: "json_object" as const },
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT(symbol) },
      {
        role: "user",
        content: JSON.stringify({
          ticker: symbol,
          evidence,
          task: `Map the suppliers, customers, competitors and complements of ${symbol} from this evidence.`,
        }),
      },
    ],
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mapvest.app",
        "X-Title": "Mapvest",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter value-chain agent ${model} ${res.status}`);
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseEdgePicks(j.choices?.[0]?.message?.content ?? "{}");
  } finally {
    clearTimeout(t);
  }
}

async function judgeValueChain(symbol: string, evidence: EvidenceItem[]): Promise<EdgePick[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing (Doppler)");

  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr: unknown;
  for (const model of models) {
    try {
      return await callValueChainJudge(model, apiKey, baseUrl, symbol, evidence);
    } catch (err) {
      lastErr = err;
      console.warn(`[finance] value-chain model ${model} failed, trying next:`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
