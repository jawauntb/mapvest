/**
 * Local Economy Brief.
 *
 * Given a lat/lng, produces a three-paragraph read describing the economic
 * character of the area:
 *   ¶1 area character + demographics/vibe
 *   ¶2 employment + industries + major private employers
 *   ¶3 investable public-market exposure this area gives
 *
 * Pipeline:
 *   1. Reverse-geocode (Nominatim) if city/state/zip aren't provided.
 *   2. Pull nearby brands via Overpass (mirrors of the /v1/nearby helper).
 *   3. Ask Exa for area context — 3 targeted queries.
 *   4. Compose an OpenRouter prompt (claude-opus-4.8 → gpt-5.6-terra →
 *      grok-4.6) and parse JSON output. Opus first — neighborhood prose
 *      needs the slower, better writer.
 *
 * Caching: in-memory, keyed by (v2 + rounded lat/lng to 3 decimals + UTC date).
 * TTL 24h. Same cache pattern used by `watchlist-brief.ts`.
 *
 * Never throws to the caller: on any downstream failure we return
 * `OUTAGE_LOCAL_BRIEF` so the endpoint stays 200 (per contract).
 */

import { enrichTicker } from "@mapvest/search";

export type LocalBrief = {
  /**
   * 3 or 4 paragraphs. Paragraph 3 always closes with a compact
   * Tailwinds/Headwinds/Opportunities/Challenges block (four labeled lines,
   * no bullets, no markdown) — the RichText renderer picks them up as inline
   * labels. An optional paragraph 4 is a single closing sentence that names
   * which nearby brands most benefit or suffer from those forces.
   */
  paragraphs: string[];
  place: GeoPlace;
  nearbyCount: number;
  generatedAt: string; // ISO
};

// ---------------- Cache ----------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
type CacheEntry = { expiresAt: number; brief: LocalBrief };
const briefCache = new Map<string, CacheEntry>();

/** Test-only. Public callers should not reach in. */
export function _clearLocalBriefCache(): void {
  briefCache.clear();
}

function yyyymmdd(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function cacheKey(lat: number, lng: number, now: Date): string {
  return `v2:${lat.toFixed(3)},${lng.toFixed(3)}::${yyyymmdd(now)}`;
}

function readCache(key: string): LocalBrief | null {
  const hit = briefCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    briefCache.delete(key);
    return null;
  }
  return hit.brief;
}

function writeCache(key: string, brief: LocalBrief): void {
  briefCache.set(key, { brief, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------- Reverse geocode (Nominatim) ----------------

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  suburb?: string;
  neighbourhood?: string;
  city_district?: string;
  borough?: string;
  state?: string;
  postcode?: string;
  county?: string;
  country?: string;
};

export type GeoPlace = {
  neighborhood?: string;
  city?: string;
  state?: string;
  zip?: string;
};

/** Prefer the neighborhood (Astoria) over the city (New York). */
export function placeFromNominatim(a: NominatimAddress): GeoPlace {
  const neighborhood =
    a.neighbourhood || a.suburb || a.city_district || a.borough || a.hamlet || undefined;
  const city = a.city || a.town || a.village || a.county || undefined;
  return {
    neighborhood: neighborhood && neighborhood !== city ? neighborhood : neighborhood || undefined,
    city: city || undefined,
    state: a.state || undefined,
    zip: a.postcode || undefined,
  };
}

type NominatimResponse = {
  display_name?: string;
  address?: NominatimAddress;
};

// 24h in-memory reverse-geocode cache.
const REV_GEO_TTL_MS = 24 * 60 * 60 * 1000;
const revGeoCache = new Map<string, { expiresAt: number; place: GeoPlace }>();

function revGeoKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

async function reverseGeocode(lat: number, lng: number): Promise<GeoPlace> {
  const key = revGeoKey(lat, lng);
  const cached = revGeoCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.place;
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "json");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "16");
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(url, {
        // Nominatim policy: a real User-Agent identifying the app is required.
        headers: { "User-Agent": "mapvest/0.1 (support@mapvest.app)" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const j = (await res.json()) as NominatimResponse;
    const place = placeFromNominatim(j.address ?? {});
    revGeoCache.set(key, { expiresAt: Date.now() + REV_GEO_TTL_MS, place });
    return place;
  } catch {
    // Silent — the LLM prompt can still run against lat/lng alone.
    return {};
  }
}

// ---------------- Nearby brands (Overpass mirrors) ----------------

// Kept in sync with `apps/api/src/routes/nearby.ts` — the helper is not exported
// from that file, so we duplicate the mirror list here (deliberate; see the
// note in nearby.ts about which mirrors are currently reliable from Railway).
const OVERPASS_MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const OVERPASS_TIMEOUT_MS = 7000;

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};
type OverpassResponse = { elements: OverpassElement[] };

export type NearbyBrand = { name: string; sector?: string };

function overpassQuery(lat: number, lng: number, radius: number): string {
  return `
    [out:json][timeout:8];
    (
      node["brand"](around:${radius},${lat},${lng});
      node["shop"](around:${radius},${lat},${lng});
      node["amenity"~"^(restaurant|cafe|fast_food|bank|pharmacy|fuel|cinema|gym)$"](around:${radius},${lat},${lng});
    );
    out center 40;
  `;
}

function elementToBrand(el: OverpassElement): NearbyBrand | null {
  const name = el.tags?.brand ?? el.tags?.name;
  if (!name) return null;
  const sector = el.tags?.shop ?? el.tags?.amenity ?? el.tags?.cuisine;
  const brand: NearbyBrand = { name };
  if (sector) brand.sector = sector;
  return brand;
}

async function tryOverpassMirror(
  mirror: string,
  lat: number,
  lng: number,
  radius: number,
): Promise<NearbyBrand[]> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const res = await fetch(mirror, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "mapvest/0.1 (support@mapvest.app)",
      },
      body: `data=${encodeURIComponent(overpassQuery(lat, lng, radius))}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const j = (await res.json()) as OverpassResponse;
    const seen = new Set<string>();
    const out: NearbyBrand[] = [];
    for (const el of j.elements ?? []) {
      const b = elementToBrand(el);
      if (!b) continue;
      const k = b.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(b);
    }
    return out;
  } finally {
    clearTimeout(t);
  }
}

async function fetchNearbyBrands(lat: number, lng: number, radius = 800): Promise<NearbyBrand[]> {
  const settled = await Promise.allSettled(
    OVERPASS_MIRRORS.map((mirror) => tryOverpassMirror(mirror, lat, lng, radius)),
  );
  for (const outcome of settled) {
    if (outcome.status === "fulfilled" && outcome.value.length > 0) {
      return outcome.value.slice(0, 20);
    }
  }
  return [];
}

// ---------------- Exa area context ----------------

/**
 * Hard wall-clock cap on the entire Exa fanout. The Local Brief lives on the
 * Home tab critical path, so no single slow query is allowed to hold the
 * response — anything not settled by the deadline is silently dropped.
 */
const EXA_FANOUT_TIMEOUT_MS = 4_000;
/** Max queries we ever fire — keeps Exa spend bounded per lat/lng cell. */
const EXA_MAX_QUERIES = 5;

type ExaSnippet = { title: string; url: string; snippet: string; bucket: string };

/**
 * Five targeted Exa queries. Order matters — earlier ones ground the
 * cheaper Paragraph-1 material; the last two are the newer municipal-policy
 * and employment-number queries that back Paragraph 2 and 3.
 */
function exaQueriesFor(place: GeoPlace): { bucket: string; query: string }[] {
  const hood = place.neighborhood;
  const city = place.city ?? "";
  const state = place.state ?? "";
  const local = hood ? `${hood} ${city} ${state}`.trim() : `${city} ${state}`.trim();
  const metro = `${city} ${state}`.trim();
  return [
    { bucket: "overview", query: `${local} neighborhood economy retail 2024 2025` },
    { bucket: "employers", query: `largest employers ${local}` },
    { bucket: "employment", query: `${metro} unemployment rate labor force 2024 2025` },
    { bucket: "policy", query: `${local} zoning small business ${metro} incentives 2024 2025` },
    { bucket: "regulation", query: `${local} development retail mix ${state}` },
  ].slice(0, EXA_MAX_QUERIES);
}

async function fetchExaSnippets(place: GeoPlace): Promise<ExaSnippet[]> {
  if (!process.env.EXA_API_KEY) return [];
  const queries = exaQueriesFor(place);

  const perQuery = queries.map(async (q): Promise<ExaSnippet[]> => {
    try {
      const results = await enrichTicker(q.query);
      return results.slice(0, 2).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: (r.snippet ?? "").slice(0, 260),
        bucket: q.bucket,
      }));
    } catch {
      return [];
    }
  });

  // Race the whole fanout against a single wall-clock deadline. Any promise
  // that hasn't resolved by then contributes an empty array — we never wait
  // past `EXA_FANOUT_TIMEOUT_MS` even if a mirror is stuck.
  const deadline = new Promise<ExaSnippet[][]>((resolve) => {
    setTimeout(() => resolve(queries.map(() => [])), EXA_FANOUT_TIMEOUT_MS);
  });
  const winner = await Promise.race([Promise.all(perQuery), deadline]);
  return winner.flat();
}

// ---------------- LLM prompt (OpenRouter SOTA chain) ----------------

const PRIMARY_MODEL = "anthropic/claude-opus-4.8";
const FALLBACK_MODELS = ["openai/gpt-5.6-terra", "x-ai/grok-4.6"] as const;
const OPENROUTER_TIMEOUT_MS = 25_000;

const SYSTEM_PROMPT = `You are a financial-geography writer producing a "Local Economy Brief" for a private investor.
Style: authoritative, plain-spoken, third-person, no hype, no exclamation marks, no emojis, no bullet symbols, no markdown headers.
Reference tickers inline as "$SYM" (e.g. "$SBUX", "$MCD", "$WMT", "$TGT", "$CVS", "$JPM", "$BAC", "$CMG", "$HD").

Return STRICT JSON only:
  { "paragraphs": string[] }
The array MUST contain 3 items, or 4 if paragraph 4 adds real value. No prose outside the JSON. Each paragraph is plain text — line breaks INSIDE a paragraph are permitted ONLY for the four T/H/O/C label lines described in paragraph 3.

Paragraph 1 — Area character. Name the NEIGHBORHOOD first (e.g. "Astoria, Queens"), not just the city. Write about this stretch of blocks — the brand mix you can see from the nearby list — not a city-wide essay. Name 2-4 nearby PUBLIC brands by ticker and 1-2 named private/local businesses. Anchor every claim in the provided nearby list — do not invent brands or facts.

Paragraph 2 — Employment data. Lead with the unemployment rate if the search excerpts contain one (e.g. "Unemployment stands at 3.8% as of..."). Include labor-force size, dominant industries, and 1-3 named major private employers when they appear in the excerpts. If a hard figure is not surfaced, say so honestly (e.g. "current unemployment figures were not in the surfaced sources") — DO NOT invent numbers.

Paragraph 3 — Municipal policy landscape AND outlook. First 2-3 sentences: what the city (or state) government is doing OR failing to do for businesses — name specific tax credits, incentive programs, opportunity zones, permitting reforms, or, on the other side, rising costs, regulatory friction, or restrictive zoning. Then, on new lines within this same paragraph, close with EXACTLY these four lines in this order:
Tailwinds: <one sentence naming a specific positive force>
Headwinds: <one sentence naming a specific negative force>
Opportunities: <one sentence naming a specific investable/actionable opening>
Challenges: <one sentence naming a specific structural obstacle>
Each label starts a new line. Do NOT prefix any of the four with a bullet, dash, or heading marker — just the label, a colon, and one sentence.

Paragraph 4 (optional, at most ONE sentence) — Name which nearby public brands most benefit from, or are most exposed to, the forces you just listed.

Rules: never invent statistics; prefer named specifics over adjectives; no bullet symbols anywhere; no markdown; no emojis.`;

type LLMOutput = { paragraphs: string[] };

function buildUserContent(input: {
  place: GeoPlace;
  brands: NearbyBrand[];
  exa: ExaSnippet[];
}): string {
  const { place, brands, exa } = input;
  const brandLine = brands.length
    ? brands
        .slice(0, 20)
        .map((b) => (b.sector ? `${b.name} [${b.sector}]` : b.name))
        .join(", ")
    : "(no brand data returned)";
  const exaBlock = exa.length
    ? exa
        .map((s, i) => `[${i + 1}] (${s.bucket}) ${s.title}\n${s.snippet}\n(source: ${s.url})`)
        .join("\n\n")
    : "(no exa snippets)";
  return [
    `Place: ${place.neighborhood ? `${place.neighborhood}, ` : ""}${place.city ?? "unknown city"}, ${place.state ?? "unknown state"}${place.zip ? ` ${place.zip}` : ""}`,
    "Write about THIS neighborhood / these blocks. Do not open with the city name alone.",
    "",
    `Nearby brands within ~800m (max 20):\n${brandLine}`,
    "",
    `Exa research snippets:\n${exaBlock}`,
    "",
    "Write the Local Economy Brief.",
  ].join("\n");
}

async function requestOpenRouter(
  model: string,
  apiKey: string,
  baseUrl: string,
  userContent: string,
): Promise<LLMOutput> {
  const body = {
    model,
    response_format: { type: "json_object" as const },
    temperature: 0.4,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
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
    if (!res.ok) throw new Error(`OpenRouter ${model} ${res.status}`);
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
    const parsed = JSON.parse(slice) as Partial<LLMOutput>;
    const parsedParas = parsed.paragraphs;
    if (!Array.isArray(parsedParas)) {
      throw new Error("LLM returned unexpected shape (paragraphs must be an array)");
    }
    const cleaned = parsedParas
      .map((p) => (typeof p === "string" ? p.trim() : ""))
      .filter((p) => p.length > 0);
    if (cleaned.length < 3) {
      throw new Error(`LLM returned ${cleaned.length} non-empty paragraph(s); need at least 3`);
    }
    // Cap at 4 — the schema allows an optional closing sentence but nothing beyond.
    return { paragraphs: cleaned.slice(0, 4) };
  } finally {
    clearTimeout(t);
  }
}

async function callOpenRouter(userContent: string): Promise<LLMOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing (Doppler)");

  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr: unknown;
  for (const model of models) {
    try {
      return await requestOpenRouter(model, apiKey, baseUrl, userContent);
    } catch (err) {
      lastErr = err;
      console.warn(`[local-brief] model ${model} failed, trying next:`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------- Outage fallback ----------------

/** Canned stub used when the LLM call fails. Endpoint stays 200. */
export const OUTAGE_LOCAL_BRIEF: Omit<LocalBrief, "generatedAt" | "place" | "nearbyCount"> = {
  paragraphs: [
    "The Local Economy Brief service is temporarily unavailable. We could not generate the area profile just now.",
    "Employment and industry commentary requires a live research call that failed on this attempt. Nearby brand data may still be visible in the Map or List tabs.",
    "Investable public-market exposure for this area will refresh on your next visit. Meanwhile, tap any nearby brand pin to open its ticker directly.",
  ],
};

// ---------------- Public API ----------------

/**
 * Produce a fresh (or cached) Local Economy Brief for `lat`/`lng`.
 *
 * Guarantees:
 * - Caches per (rounded lat/lng to 3 decimals + UTC date) for 24h.
 * - Never throws — LLM outages return `OUTAGE_LOCAL_BRIEF` with the
 *   resolved place echoed back and `nearbyCount: 0`.
 */
export async function generateLocalBrief(input: {
  lat: number;
  lng: number;
  neighborhood?: string;
  city?: string;
  state?: string;
  zip?: string;
  now?: Date;
}): Promise<LocalBrief> {
  const now = input.now ?? new Date();
  const key = cacheKey(input.lat, input.lng, now);
  const cached = readCache(key);
  if (cached) return cached;

  let place: GeoPlace = {
    neighborhood: input.neighborhood,
    city: input.city,
    state: input.state,
    zip: input.zip,
  };
  if (!place.neighborhood || !place.city || !place.state) {
    const geo = await reverseGeocode(input.lat, input.lng);
    place = {
      neighborhood: place.neighborhood ?? geo.neighborhood,
      city: place.city ?? geo.city,
      state: place.state ?? geo.state,
      zip: place.zip ?? geo.zip,
    };
  }

  const brands = await fetchNearbyBrands(input.lat, input.lng, 800);

  const exa = place.city || place.neighborhood ? await fetchExaSnippets(place) : [];

  try {
    const output = await callOpenRouter(buildUserContent({ place, brands, exa }));
    const brief: LocalBrief = {
      paragraphs: output.paragraphs,
      place,
      nearbyCount: brands.length,
      generatedAt: now.toISOString(),
    };
    writeCache(key, brief);
    return brief;
  } catch {
    // Never propagate — the endpoint contract says stay 200 with a stub.
    const brief: LocalBrief = {
      paragraphs: OUTAGE_LOCAL_BRIEF.paragraphs,
      place,
      nearbyCount: brands.length,
      generatedAt: now.toISOString(),
    };
    // Do NOT cache outage output — retry on next visit.
    return brief;
  }
}
