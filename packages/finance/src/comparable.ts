import type { Comparable, Source } from "@mapvest/core";
import { enrichTicker, searchBrand, toSource, type SearchResult } from "@mapvest/search";
import { extractListedTicker, isPlausibleTicker } from "./tickerSymbol.js";

type AgentPick = {
  ticker: string;
  name: string;
  score: number;
  reasoning: string;
  sourceUrl?: string;
};

/**
 * Given a private brand / IP / place name, return public comparables.
 *
 * Pipeline:
 *   1. Parallel Exa searches ("competitors", "parent ticker", "comps").
 *   2. Heuristic extract of exchange-cited symbols from hits.
 *   3. OpenRouter agent judges the Exa evidence and picks up to 3 real
 *      listed tickers (must be plausible; never invents NYP/MOUNT-style junk).
 */
export async function resolveComparable(brand: string, hintSector?: string): Promise<Comparable[]> {
  const sector = (hintSector ?? "").trim();
  const queries = [
    `${brand} closest publicly traded competitor stock ticker NYSE NASDAQ`,
    `${brand} parent company public stock symbol`,
    `comparable public companies to ${brand} ${sector} ticker`,
  ];

  const settled = await Promise.all(
    queries.map(async (q, i) => {
      try {
        return i === 1 ? await searchBrand(brand) : await enrichTicker(q);
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
  const hits = [...byUrl.values()];
  if (hits.length === 0) return [];

  // Heuristic pass — keep as fallback if agent is unavailable.
  const heuristic = heuristicFromHits(hits);

  let agentPicks: AgentPick[] = [];
  try {
    agentPicks = await agentPickComparables(brand, sector, hits);
  } catch (err) {
    console.warn("[finance] comparable agent failed, using heuristic:", err);
  }

  const picks = agentPicks.length > 0 ? agentPicks : heuristic;
  const out: Comparable[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const ticker = p.ticker.toUpperCase();
    if (!isPlausibleTicker(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    const hit = p.sourceUrl ? byUrl.get(p.sourceUrl) : undefined;
    const source: Source = hit
      ? toSource(hit, p.score >= 0.7 ? "high" : "medium")
      : {
          provider: "openrouter",
          fetchedAt: new Date().toISOString(),
          confidence: p.score >= 0.7 ? "high" : "medium",
        };
    out.push({
      ticker,
      name: p.name,
      score: Math.min(1, Math.max(0.3, p.score)),
      reasoning: p.reasoning,
      sources: [source],
    });
    if (out.length >= 3) break;
  }
  return out;
}

function heuristicFromHits(hits: SearchResult[]): AgentPick[] {
  const seen = new Set<string>();
  const out: AgentPick[] = [];
  for (const h of hits) {
    const ticker = extractListedTicker(`${h.title} ${h.snippet ?? ""}`);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({
      ticker,
      name: h.title,
      score: Math.max(0.3, 0.85 - out.length * 0.15),
      reasoning: (h.snippet ?? "").trim() || `Cited via ${h.url}`,
      sourceUrl: h.url,
    });
    if (out.length >= 3) break;
  }
  return out;
}

async function agentPickComparables(
  brand: string,
  sector: string,
  hits: SearchResult[],
): Promise<AgentPick[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing (Doppler)");

  const evidence = hits.slice(0, 8).map((h, i) => ({
    i,
    title: h.title,
    url: h.url,
    snippet: h.snippet ?? "",
  }));

  const body = {
    model: "anthropic/claude-sonnet-5",
    response_format: { type: "json_object" as const },
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: `You pick publicly traded comparable companies for Mapvest.
Return JSON: { "picks": [{ "ticker": "MCD", "name": "McDonald's Corp", "score": 0.0-1.0, "reasoning": "...", "sourceUrl": "https://..." }] }
Rules:
- Only real exchange-listed tickers (NYSE/NASDAQ/etc). 1-5 uppercase letters.
- Never invent tickers from abbreviations, nonprofits, hospitals, 401k plan names, or GuideStar pages.
- Prefer the closest public competitor or parent / IP licensor (e.g. Pokémon → Nintendo NTDOY or Hasbro HAS).
- Max 3 picks. Empty picks array if nothing is defensible from the evidence.
- sourceUrl must be one of the provided evidence URLs when possible.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          brand,
          sector: sector || null,
          evidence,
          task: `Find comparable publicly traded companies for "${brand}".`,
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
    if (!res.ok) throw new Error(`OpenRouter comparable agent ${res.status}`);
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    const stripped = raw
      .replace(/^\s*```(?:json|JSON)?\s*/, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    const slice = first !== -1 && last > first ? stripped.slice(first, last + 1) : stripped;
    const parsed = JSON.parse(slice) as { picks?: AgentPick[] };
    return Array.isArray(parsed.picks) ? parsed.picks : [];
  } finally {
    clearTimeout(t);
  }
}
