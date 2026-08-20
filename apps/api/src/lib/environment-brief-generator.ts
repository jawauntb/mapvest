/**
 * Environment brief (Universe Roadmap §3 C4).
 *
 * The local-brief generator's shape — gather evidence → OpenRouter model
 * cascade → Tailwinds/Headwinds → 24h cache — lifted from neighborhood scale to
 * sector scale. Where the Local Economy Brief asks "what does this block do for
 * a living", this asks "what field is this sector sitting in right now".
 *
 * Gather:
 *   1. FRED series for the sector (`sectorSeries` in packages/finance) — the
 *      quantitative floor: policy rate, headline CPI, and the sector's own
 *      indicator. Omitted gracefully when `FRED_API_KEY` is unset.
 *   2. Two recency-filtered Exa queries — policy/regulatory, and the demand
 *      narrative. Qualitative color only; never promoted into `series`.
 *
 * Degradation ladder (deliberately prefers a thinner brief over a 503):
 *   - FRED key set, Exa key unset  → series + no web color.
 *   - FRED key unset, Exa key set  → web color + `series: []`.
 *   - neither set                  → `environmentBriefAvailability()` reports
 *     unavailable and the route 503s; we do not synthesize macro data.
 *
 * Sourcing (AGENTS.md §6): each FRED observation is cited under the core
 * enum's `fred` provider with its fred.stlouisfed.org landing page, alongside
 * the real Exa hits. `series[]` additionally carries per-entry id/asOf.
 */
import type { EnvironmentBrief, EnvironmentSeries, Source } from "@mapvest/core";
import {
  canonicalSector,
  fredConfigured,
  fredSeriesUrl,
  getSeries,
  sectorSeries,
} from "@mapvest/finance";
import { enrichTicker, toSource } from "@mapvest/search";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Hard wall-clock cap on the whole Exa fanout. */
const EXA_FANOUT_TIMEOUT_MS = 5_000;
/** Hard wall-clock cap on the whole FRED fanout. */
const FRED_FANOUT_TIMEOUT_MS = 6_000;
/** Exa hits kept per query. */
const HITS_PER_QUERY = 3;
/** Max sources on the response. */
const MAX_SOURCES = 8;
/** Max tailwind/headwind bullets kept from the model. */
const MAX_FORCES = 4;

const PRIMARY_MODEL = "anthropic/claude-opus-4.8";
const FALLBACK_MODELS = ["openai/gpt-5.6-terra", "x-ai/grok-4.6"] as const;
const OPENROUTER_TIMEOUT_MS = 25_000;

// ---------------- Availability ----------------

export type EnvironmentBriefAvailability = { ok: true } | { ok: false; error: string };

/**
 * Whether a brief can be produced at all. The route turns a `false` into a 503
 * rather than inventing a macro read; a partially-configured environment still
 * returns `ok` and degrades inside the generator.
 */
export function environmentBriefAvailability(): EnvironmentBriefAvailability {
  if (!fredConfigured() && !process.env.EXA_API_KEY) {
    return {
      ok: false,
      error: "environment briefs need FRED_API_KEY or EXA_API_KEY; neither is configured",
    };
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return { ok: false, error: "environment briefs need OPENROUTER_API_KEY" };
  }
  return { ok: true };
}

/** Canonical GICS sector for a free-form label, or null when unrecognized. */
export function resolveSector(input: string): string | null {
  return canonicalSector(input);
}

// ---------------- Cache ----------------

type CacheEntry = { expiresAt: number; brief: EnvironmentBrief };
const briefCache = new Map<string, CacheEntry>();

/** Test-only. Public callers should not reach in. */
export function _clearEnvironmentBriefCache(): void {
  briefCache.clear();
}

function yyyymmdd(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// The 24h `expiresAt` bounds freshness on its own; embedding the day in the
// key would leave one never-read, never-evicted entry per sector per day.
function cacheKey(sector: string): string {
  return `v1:${sector.toLowerCase()}`;
}

/**
 * Cached brief for `sector`, or null. The route uses this to decide whether a
 * request is free (cache hit) or billable (miss) — same posture as
 * `GET /v1/graph/:ticker`.
 */
export function readEnvironmentBriefCache(
  sector: string,
  _now = new Date(),
): EnvironmentBrief | null {
  const hit = briefCache.get(cacheKey(sector));
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    briefCache.delete(cacheKey(sector));
    return null;
  }
  return hit.brief;
}

// ---------------- FRED gather ----------------

/**
 * Latest observation per sector series. A series with no usable observation is
 * dropped rather than carried with a placeholder (core-schema contract).
 * Failures are silent — the brief degrades to fewer series, never to fake ones.
 */
async function fetchSeries(sector: string): Promise<EnvironmentSeries[]> {
  if (!fredConfigured()) return [];
  const refs = sectorSeries(sector);
  const perSeries = refs.map(async (ref): Promise<EnvironmentSeries[]> => {
    try {
      // limit 8, not 2: business-day series pad market holidays with "." rows
      // that getSeries drops, so a narrow window can come back empty and the
      // series would be wrongly treated as "FRED had nothing".
      const observations = await getSeries(ref.id, { limit: 8 });
      const latest = observations[0];
      if (!latest) return [];
      const entry: EnvironmentSeries = {
        id: ref.id,
        label: ref.label,
        latest: latest.value,
        asOf: latest.date,
      };
      if (ref.unit) entry.unit = ref.unit;
      return [entry];
    } catch (err) {
      console.warn(`[environment-brief] FRED series ${ref.id} failed:`, err);
      return [];
    }
  });
  const deadline = new Promise<EnvironmentSeries[][]>((resolve) => {
    setTimeout(() => resolve(refs.map(() => [])), FRED_FANOUT_TIMEOUT_MS);
  });
  const winner = await Promise.race([Promise.all(perSeries), deadline]);
  return winner.flat();
}

// ---------------- Exa gather ----------------

type ExaSnippet = { title: string; url: string; snippet: string; bucket: string };
type ExaHit = { snippet: ExaSnippet; source: Source };

/**
 * Two recency-filtered queries. Recency is expressed the same way the Local
 * Economy Brief expresses it — explicit current/previous year terms in the query
 * text — so the Exa wrapper stays a thin shared client.
 */
function exaQueriesFor(sector: string, now: Date): { bucket: string; query: string }[] {
  const year = now.getUTCFullYear();
  const window = `${year - 1} ${year}`;
  return [
    {
      bucket: "policy",
      query: `${sector} sector policy regulation tariffs legislation outlook ${window}`,
    },
    {
      bucket: "demand",
      query: `${sector} sector demand spending capex order backlog trend ${window}`,
    },
  ];
}

async function fetchExaHits(sector: string, now: Date): Promise<ExaHit[]> {
  if (!process.env.EXA_API_KEY) return [];
  const queries = exaQueriesFor(sector, now);
  const perQuery = queries.map(async (q): Promise<ExaHit[]> => {
    try {
      const results = await enrichTicker(q.query);
      return results.slice(0, HITS_PER_QUERY).map((r) => ({
        snippet: {
          title: r.title,
          url: r.url,
          snippet: (r.snippet ?? "").slice(0, 280),
          bucket: q.bucket,
        },
        source: toSource(r),
      }));
    } catch (err) {
      console.warn(`[environment-brief] exa ${q.bucket} query failed:`, err);
      return [];
    }
  });
  const deadline = new Promise<ExaHit[][]>((resolve) => {
    setTimeout(() => resolve(queries.map(() => [])), EXA_FANOUT_TIMEOUT_MS);
  });
  const winner = await Promise.race([Promise.all(perQuery), deadline]);
  const seen = new Set<string>();
  const out: ExaHit[] = [];
  for (const hit of winner.flat()) {
    if (!hit.snippet.url || seen.has(hit.snippet.url)) continue;
    seen.add(hit.snippet.url);
    out.push(hit);
  }
  return out;
}

// ---------------- LLM ----------------

const SYSTEM_PROMPT = `You are a macro analyst writing the "Environment Brief" for one market sector for a private investor.
This is the FIELD a sector sits in — monetary conditions, fiscal and regulatory policy, and the demand narrative — not a stock pitch and not a recommendation.

Style: authoritative, plain-spoken, third-person, no hype, no exclamation marks, no emojis. The body is short markdown (2-3 paragraphs, no headings).

Return STRICT JSON only:
  { "headline": string, "body": string, "tailwinds": string[], "headwinds": string[] }
No prose outside the JSON.

"headline" — one clause, at most 12 words, naming the dominant condition (e.g. "Rate relief is arriving faster than demand is recovering").
"body" — 2-3 markdown paragraphs. Paragraph 1 reads the supplied macro series and says what those levels mean for this sector. Paragraph 2 covers policy and regulation from the supplied excerpts. Paragraph 3 (optional) covers the demand narrative.
"tailwinds" / "headwinds" — 2 to 4 items each, one specific sentence per item, each naming a concrete force. No bullet symbols inside the strings.

Rules:
- Use ONLY the supplied macro series values and search excerpts. NEVER invent a statistic, a rate, an index level, or a date.
- If the macro series block is empty, say plainly that quantitative macro series were unavailable for this brief and reason from the qualitative excerpts alone. Do not estimate the missing numbers.
- Treat the search excerpts as qualitative color, never as data.
- Name no price targets and give no buy/sell advice.`;

type LLMOutput = {
  headline: string;
  body: string;
  tailwinds: string[];
  headwinds: string[];
};

function buildUserContent(input: {
  sector: string;
  series: EnvironmentSeries[];
  hits: ExaHit[];
}): string {
  const seriesBlock = input.series.length
    ? input.series
        .map(
          (s) =>
            `- ${s.label} (FRED ${s.id}): ${s.latest}${s.unit ? ` ${s.unit}` : ""} as of ${s.asOf}`,
        )
        .join("\n")
    : "(no macro series available for this brief)";
  const exaBlock = input.hits.length
    ? input.hits
        .map(
          (h, i) =>
            `[${i + 1}] (${h.snippet.bucket}) ${h.snippet.title}\n${h.snippet.snippet}\n(source: ${h.snippet.url})`,
        )
        .join("\n\n")
    : "(no search excerpts)";
  return [
    `Sector: ${input.sector}`,
    "",
    `Macro series (latest observations):\n${seriesBlock}`,
    "",
    `Search excerpts:\n${exaBlock}`,
    "",
    `Write the Environment Brief for the ${input.sector} sector.`,
  ].join("\n");
}

function cleanStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.replace(/^\s*[-•*]\s*/, "").trim() : ""))
    .filter((v) => v.length > 0)
    .slice(0, max);
}

async function requestOpenRouter(
  model: string,
  apiKey: string,
  baseUrl: string,
  userContent: string,
): Promise<LLMOutput> {
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
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${model} ${res.status}`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    const stripped = raw
      .replace(/^\s*```(?:json|JSON)?\s*/, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    const slice = first !== -1 && last > first ? stripped.slice(first, last + 1) : stripped;
    const parsed = JSON.parse(slice) as Partial<LLMOutput>;
    const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "";
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!headline || !body) {
      throw new Error("LLM returned unexpected shape (headline and body are required)");
    }
    return {
      headline,
      body,
      tailwinds: cleanStrings(parsed.tailwinds, MAX_FORCES),
      headwinds: cleanStrings(parsed.headwinds, MAX_FORCES),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenRouter(userContent: string): Promise<LLMOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing (Doppler)");
  let lastErr: unknown;
  for (const model of [PRIMARY_MODEL, ...FALLBACK_MODELS]) {
    try {
      return await requestOpenRouter(model, apiKey, baseUrl, userContent);
    } catch (err) {
      lastErr = err;
      console.warn(`[environment-brief] model ${model} failed, trying next:`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------- Public API ----------------

/**
 * Produce (or serve from the 24h cache) the environment brief for a canonical
 * GICS `sector`.
 *
 * Unlike the Local Economy Brief this THROWS on model failure instead of
 * returning a canned stub — a sector-scale macro read with nothing behind it is
 * worse than no read, so the route surfaces a 502. Only successful briefs are
 * cached.
 */
export async function generateEnvironmentBrief(
  sector: string,
  opts?: { now?: Date },
): Promise<EnvironmentBrief> {
  const now = opts?.now ?? new Date();
  const key = cacheKey(sector);
  const cached = readEnvironmentBriefCache(sector, now);
  if (cached) return cached;

  const [series, hits] = await Promise.all([fetchSeries(sector), fetchExaHits(sector, now)]);
  const output = await callOpenRouter(buildUserContent({ sector, series, hits }));

  const brief: EnvironmentBrief = {
    sector,
    headline: output.headline,
    body: output.body,
    tailwinds: output.tailwinds,
    headwinds: output.headwinds,
    series,
    generatedAt: now.toISOString(),
    // Every quantitative FRED observation is cited with its landing page under
    // the enum's `fred` provider, alongside the real Exa hits — downstream
    // consumers (e.g. the synthesis memo) union these, so a macro number never
    // ships without reachable provenance (AGENTS.md §6).
    sources: [
      ...series.map(
        (s): Source => ({
          provider: "fred",
          url: fredSeriesUrl(s.id),
          fetchedAt: now.toISOString(),
          confidence: "high",
        }),
      ),
      ...hits.map((h) => h.source),
    ].slice(0, MAX_SOURCES),
  };
  briefCache.set(key, { brief, expiresAt: Date.now() + CACHE_TTL_MS });
  return brief;
}
