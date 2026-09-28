/**
 * Mapvest's MCP server (constellation member `mapvest`; contract: the lattice
 * animals' docs/constellation.md). `createMcp` from the vendored `mcp-lite`
 * supplies the transport, the peer registry and the hop rule; this module is
 * the tools, and the one function that assembles them (`buildMapvestMcp`).
 *
 * Four tools, all read-only, all public, none takes a URL or an identity:
 *
 *   search_intent        what a person typed -> ticker | brand | place | question
 *   brand_lookup         a public brand -> ticker, from the curated seed (no network)
 *   rating               the research-signal rating for a ticker (never advice)
 *   ask_lattice_animals  ask the lattice animals (relays to the hub)
 *
 * They call the same in-process functions the HTTP routes call
 * (`resolveSearchIntent`, `seedLookup`, `buildRating`); there is no HTTP
 * self-call and no second implementation. Arguments and results are the zod
 * schemas in `@mapvest/core` (`Mcp*`): arguments are `.strict()`, results are
 * parsed before they go out.
 *
 * What is left out on purpose, and why:
 *   - quote, quote history, financials, options, market data, market events:
 *     licensed upstream data whose redistribution terms are unverified. For
 *     the same reason `rating` lists its `quote` and `ratios` evidence by
 *     name but withholds the summaries, which restate prices and ratios.
 *   - every bearer, optional-auth or metered route (identify, memo, graph,
 *     pulse, environment, agent, finds, watchlist, settings, robinhood,
 *     billing, push, alerts, photos), and anything that carries a user id.
 *   - resolve-comparable (always calls Exa and OpenRouter) and Prism/Situate
 *     generation: a public tool must not be able to spend on a model.
 *   - image or binary data.
 *
 * Every result that names a ticker or a brand says what it rests on
 * (`sources`, AGENTS.md section 6) and is `confidence: "low"` when it cannot
 * cite one. Nothing here invents a price, a rating or a ticker.
 */

import {
  type Confidence,
  MCP_QUESTION_MAX_CHARS,
  MCP_TEXT_MAX_CHARS,
  MCP_TICKER_MAX_CHARS,
  McpAskLatticeArgs,
  McpBrandLookupArgs,
  McpBrandLookupResult,
  McpRatingArgs,
  McpRatingResult,
  McpSearchIntentArgs,
  McpSearchIntentResult,
  type RatingResponse,
  type SearchIntentResponse,
  type Source,
} from "@mapvest/core";
import { type Quote, getQuote, normalizeBrand, seedBrands } from "@mapvest/finance";
import type { ZodIssue } from "zod";
import { type Span, safeExecuteWithSpan } from "./logfire.js";
// The vendored library: `mcp-lite.mjs`, with its types in `mcp-lite.d.mts`
// beside it (tsc reads that name for an `.mjs` import and ignores a `.d.ts`).
import {
  HUB_URL,
  type Mcp,
  type Post,
  type ToolContext,
  type ToolResult,
  type ToolSpec,
  createMcp,
  latticeTool,
} from "./mcp-lite.mjs";
import { buildRating, readRatingCache } from "./rating.js";
import {
  INTENT_CACHE_TTL_MS,
  type SearchIntentDeps,
  type SearchIntentInput,
  normalizeQuery,
  resolveSearchIntent,
  seedLookup,
} from "./search-intent.js";
import { isTicker } from "./underlying.js";

export const MCP_SERVER_NAME = "mapvest";
/** Bump when a tool's name, arguments or result shape changes. */
export const MCP_SERVER_VERSION = "0.1.0";
/** Where the manifest says this server is, unless `MCP_PUBLIC_ORIGIN` says otherwise. */
export const MCP_DEFAULT_ORIGIN = "https://api-production-4b27.up.railway.app";

/**
 * Bun closes a connection that has been silent for 10 s (`idleTimeout`'s
 * default) and a JSON-RPC reply is silent until its tool is done, so every
 * tool answers inside this budget whatever it is waiting on. `rating` can run
 * past it (nine sources at 3 s each, then a Jev call of up to 8 s): it is cut
 * off here with an error result, while the computation carries on and lands in
 * its one-hour cache, so the retry is instant. A call to another site
 * (`ask_lattice_animals`, `/mcp/<peer>`) is capped at `MCP_PEER_TIMEOUT_MS`
 * for the same reason; the library's own default there is 25 s.
 */
export const MCP_TOOL_DEADLINE_MS = 7_000;
export const MCP_PEER_TIMEOUT_MS = 8_000;

/**
 * Ratings this process will compute per UTC day for MCP callers. A rating is
 * the one tool that can spend money upstream (up to two Jev calls plus the
 * market-data reads), so it has a cap of its own beside the per-address rate
 * limit; a rating already in the one-hour cache is free and never counts.
 */
export const MCP_RATING_DAILY_CAP = 200;

/** Evidence whose free-text summary restates licensed market data (a price, a ratio). */
const LICENSED_EVIDENCE = new Set(["quote", "ratios"]);
export const WITHHELD_SUMMARY =
  "withheld: restates licensed market data, which is not redistributed here";
const MAX_EVIDENCE_SUMMARY_CHARS = 200;

/** What the tools call. Tests replace any of these; nothing else is injectable. */
export type McpToolDeps = {
  resolveSearchIntent: (
    input: SearchIntentInput,
    deps?: SearchIntentDeps,
  ) => Promise<SearchIntentResponse>;
  buildRating: (ticker: string) => Promise<RatingResponse>;
  readRatingCache: (ticker: string) => RatingResponse | null;
  seedLookup: (q: string) => ReturnType<typeof seedLookup>;
  /** The live-listing probe behind a typed ticker; only its provider and time are used, never a price. */
  quote: (symbol: string) => Promise<Pick<Quote, "provider" | "ts"> | null>;
  now: () => number;
  deadlineMs: number;
  ratingDailyCap: number;
};

const defaultDeps: McpToolDeps = {
  resolveSearchIntent,
  buildRating: (ticker) => buildRating(ticker),
  readRatingCache: (ticker) => readRatingCache(ticker),
  seedLookup,
  quote: getQuote,
  now: Date.now,
  deadlineMs: MCP_TOOL_DEADLINE_MS,
  ratingDailyCap: MCP_RATING_DAILY_CAP,
};

// ---------------- small helpers ----------------

type Refusal = { text: string; isError: true };

/** A tool that could not do its job: an error result the caller's model can read, not a JSON-RPC error. */
const refuse = (text: string): Refusal => ({ text, isError: true });

/** Which argument was wrong and how, never the value itself. */
function badArgs(tool: string, issues: ZodIssue[]): Refusal {
  const why = issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
    .join("; ");
  return refuse(`invalid arguments for ${tool}: ${why}`.slice(0, 300));
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const LATE = Symbol("late");

/** `p`, or `LATE` once `ms` have passed. `p` is left running; a later rejection is not unhandled. */
async function within<T>(p: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms);
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A per-UTC-day allowance: `take()` is true while there is some left. */
function dailyAllowance(cap: number, now: () => number): () => boolean {
  const day = { d: "", n: 0 };
  return () => {
    const d = new Date(now()).toISOString().slice(0, 10);
    if (day.d !== d) {
      day.d = d;
      day.n = 0;
    }
    if (day.n >= cap) return false;
    day.n += 1;
    return true;
  };
}

function seedSource(confidence: Confidence, now: number): Source {
  return { provider: "manual", fetchedAt: new Date(now).toISOString(), confidence };
}

// ---------------- search_intent ----------------

/** `high` at 0.9+, `medium` at 0.7+, else `low`; a ticker or brand with no cited source, or a fail-open guess, is `low`. */
function intentConfidence(r: SearchIntentResponse, sources: Source[]): Confidence {
  if (r.method === "fallback") return "low";
  if ((r.intent === "ticker" || r.intent === "brand") && sources.length === 0) return "low";
  if (r.probability >= 0.9) return "high";
  if (r.probability >= 0.7) return "medium";
  return "low";
}

function intentNote(r: SearchIntentResponse, sources: Source[]): string | undefined {
  if (r.method === "fallback") {
    return "No decision was made: the text matched no rule and the classifier was unavailable or unsure, so this is Mapvest's default reading of it as a ticker or brand to open, not a finding.";
  }
  if (r.intent === "brand" && !r.resolved.symbol) {
    return "A brand name that is not in the curated seed. That does not mean it is private or unlisted; it only means there is no ticker to give.";
  }
  if ((r.intent === "ticker" || r.intent === "brand") && sources.length === 0) {
    return "Nothing is cited for this reading: no listing check or seed entry is on record for the symbol, so it rests on the shape of the text alone.";
  }
  return undefined;
}

// ---------------- rating ----------------

/** The rating as the HTTP route returns it, minus the summaries that restate licensed data. */
function ratingForMcp(r: RatingResponse): { body: RatingResponse; withheld: boolean } {
  let withheld = false;
  const evidence = r.evidence.map((e) => {
    if (LICENSED_EVIDENCE.has(e.source)) {
      withheld = true;
      return { source: e.source, summary: WITHHELD_SUMMARY };
    }
    return { ...e, summary: clip(e.summary, MAX_EVIDENCE_SUMMARY_CHARS) };
  });
  return { body: { ...r, evidence }, withheld };
}

function ratingNote(r: RatingResponse, withheld: boolean): string | undefined {
  const notes: string[] = [];
  if (r.status === "insufficient_signal") {
    notes.push(
      "No rating was produced: fewer than two evidence sources resolved, the scoring service was unavailable, or its confidence was under 0.55. That is not a hold, and not a signal in either direction.",
    );
  }
  if (withheld) {
    notes.push(
      "Evidence from quote and ratios is listed by name only: those figures come from licensed market data and are not redistributed here.",
    );
  }
  return notes.length ? notes.join(" ") : undefined;
}

// ---------------- the tools ----------------

/** The four tools, in the order `tools/list` shows them. */
export function mapvestTools(overrides: Partial<McpToolDeps> = {}): ToolSpec[] {
  const deps: McpToolDeps = { ...defaultDeps, ...overrides };
  const takeRating = dailyAllowance(deps.ratingDailyCap, deps.now);

  // Which provider confirmed that a typed symbol is listed, for as long as the
  // intent memo keeps the answer, so a memoized reading cites what the first
  // one did. Only the provider and the time are kept: never a price.
  const listed = new Map<string, { source: Source; at: number }>();
  const probe = async (symbol: string): Promise<true | null> => {
    const q = await deps.quote(symbol);
    if (!q) {
      listed.delete(symbol);
      return null;
    }
    if (listed.size >= 512) listed.clear();
    listed.set(symbol, {
      source: {
        provider: q.provider ?? "yahoo",
        fetchedAt: q.ts || new Date(deps.now()).toISOString(),
        confidence: "high",
      },
      at: deps.now(),
    });
    return true;
  };

  /** What the reading rests on: the seed for a brand's ticker, the listing check for a typed one. */
  function cite(r: SearchIntentResponse, text: string): Source[] {
    const symbol = r.resolved.symbol;
    if (!symbol) return [];
    if (r.intent === "brand") {
      // A brand's ticker only ever comes from the seed; check the seed still says so.
      const hit = deps.seedLookup(text);
      if (!hit || hit.ticker !== symbol) return [];
      const exact = hit.key === normalizeBrand(text);
      return [seedSource(exact ? "high" : "medium", deps.now())];
    }
    if (r.intent === "ticker") {
      const seen = listed.get(symbol);
      if (seen && deps.now() - seen.at <= INTENT_CACHE_TTL_MS) return [seen.source];
    }
    return [];
  }

  const searchIntent: ToolSpec = {
    name: "search_intent",
    description:
      "Read what a person typed or pointed at (a ticker, a brand, a place, a question) as Mapvest's search box does, and the ticker or brand it resolves to. Rules and a curated brand seed decide most; one small classifier call handles the ambiguous rest. Cites sources; without one, confidence is low.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: MCP_TEXT_MAX_CHARS,
          description: `What the person typed or described, 1 to ${MCP_TEXT_MAX_CHARS} characters. A name, a ticker, "coffee near me", a question.`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    readOnly: true,
    run: (args: unknown, ctx: ToolContext) =>
      safeExecuteWithSpan("mcp.search_intent", async (span: Span): Promise<ToolResult> => {
        span.setAttribute("hop", ctx.hop);
        const parsed = McpSearchIntentArgs.safeParse(args);
        if (!parsed.success) {
          span.setAttribute("error.kind", "invalid_args");
          return badArgs("search_intent", parsed.error.issues);
        }
        const started = performance.now();
        const text = normalizeQuery(parsed.data.query);
        const decided = await within(
          deps.resolveSearchIntent({ q: text }, { quote: probe }),
          deps.deadlineMs,
        );
        if (decided === LATE) {
          span.setAttribute("error.kind", "deadline");
          return refuse(
            `search_intent did not finish within ${Math.round(deps.deadlineMs / 1000)} s; try again shortly`,
          );
        }
        const sources = cite(decided, text.replace(/^\$/, ""));
        const note = intentNote(decided, sources);
        const result = McpSearchIntentResult.parse({
          query: text,
          intent: decided.intent,
          probability: decided.probability,
          method: decided.method,
          resolved: decided.resolved,
          sources,
          confidence: intentConfidence(decided, sources),
          ...(note ? { note } : {}),
        });
        span.setAttributes({
          q_len: text.length,
          intent: result.intent,
          method: result.method,
          confidence: result.confidence,
          sources: result.sources.length,
          latency_ms: Math.round(performance.now() - started),
        });
        return JSON.stringify(result);
      }),
  };

  const brandLookup: ToolSpec = {
    name: "brand_lookup",
    description:
      "Look a brand up in Mapvest's curated seed of public brands: name to ticker, exchange, parent and sector. No network, instant. found false means only that the brand is not in the seed, not that it is private or unlisted. A seed name found inside longer text is marked contained, confidence medium.",
    inputSchema: {
      type: "object",
      properties: {
        brand: {
          type: "string",
          minLength: 1,
          maxLength: MCP_TEXT_MAX_CHARS,
          description: `A brand or product name, 1 to ${MCP_TEXT_MAX_CHARS} characters, such as "McDonald's" or "burger king".`,
        },
      },
      required: ["brand"],
      additionalProperties: false,
    },
    readOnly: true,
    run: (args: unknown, ctx: ToolContext) =>
      safeExecuteWithSpan("mcp.brand_lookup", async (span: Span): Promise<ToolResult> => {
        span.setAttribute("hop", ctx.hop);
        const parsed = McpBrandLookupArgs.safeParse(args);
        if (!parsed.success) {
          span.setAttribute("error.kind", "invalid_args");
          return badArgs("brand_lookup", parsed.error.issues);
        }
        const text = normalizeQuery(parsed.data.brand);
        const hit = deps.seedLookup(text);
        const entry = hit ? seedBrands[hit.key] : undefined;
        if (!hit || !entry) {
          span.setAttributes({ q_len: text.length, found: false });
          return JSON.stringify(
            McpBrandLookupResult.parse({
              query: text,
              found: false,
              match: null,
              sources: [],
              confidence: "low",
              note: "Not in the curated brand seed. That does not mean the brand is private or unlisted; the seed is a starting table, not a census.",
            }),
          );
        }
        const kind = hit.key === normalizeBrand(text) ? "exact" : "contained";
        const confidence: Confidence = kind === "exact" ? "high" : "medium";
        span.setAttributes({ q_len: text.length, found: true, kind });
        return JSON.stringify(
          McpBrandLookupResult.parse({
            query: text,
            found: true,
            match: {
              kind,
              key: hit.key,
              ticker: entry.ticker,
              exchange: entry.exchange,
              parent: entry.parent,
              ...(entry.sector ? { sector: entry.sector } : {}),
            },
            sources: [seedSource(confidence, deps.now())],
            confidence,
            ...(kind === "contained"
              ? {
                  note: "A seed brand name appears inside your text; check it is the brand you meant.",
                }
              : {}),
          }),
        );
      }),
  };

  const rating: ToolSpec = {
    name: "rating",
    description:
      "Mapvest's research-signal rating for one listed ticker: strong_sell to strong_buy with probabilities, drivers and evidence. AI-generated research signal, not investment advice (disclaimer in every result). insufficient_signal means no rating, not a hold. Cached an hour; a fresh one takes seconds.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          minLength: 1,
          maxLength: MCP_TICKER_MAX_CHARS,
          description: 'A listed ticker symbol such as "MCD" or "BRK.B"; a leading $ is fine.',
        },
      },
      required: ["ticker"],
      additionalProperties: false,
    },
    readOnly: true,
    run: (args: unknown, ctx: ToolContext) =>
      safeExecuteWithSpan("mcp.rating", async (span: Span): Promise<ToolResult> => {
        span.setAttribute("hop", ctx.hop);
        const parsed = McpRatingArgs.safeParse(args);
        if (!parsed.success) {
          span.setAttribute("error.kind", "invalid_args");
          return badArgs("rating", parsed.error.issues);
        }
        const ticker = parsed.data.ticker.replace(/^\$/, "").toUpperCase();
        if (!isTicker(ticker)) {
          span.setAttribute("error.kind", "invalid_ticker");
          return refuse('invalid ticker: give a listed symbol such as "MCD" or "BRK.B"');
        }
        const cached = deps.readRatingCache(ticker) !== null;
        span.setAttributes({ ticker, cache: cached ? "hit" : "miss" });
        if (!cached && !takeRating()) {
          span.setAttribute("error.kind", "daily_cap");
          return refuse(
            `rating budget for today is used (${deps.ratingDailyCap} fresh ratings a day); a rating computed in the last hour is still served, and the budget resets at 00:00 UTC`,
          );
        }
        const started = performance.now();
        const built = await within(deps.buildRating(ticker), deps.deadlineMs);
        if (built === LATE) {
          span.setAttribute("error.kind", "deadline");
          return refuse(
            `rating for ${ticker} did not finish within ${Math.round(deps.deadlineMs / 1000)} s; it keeps computing and is cached once done, so try again shortly`,
          );
        }
        const { body, withheld } = ratingForMcp(built);
        const note = ratingNote(built, withheld);
        const result = McpRatingResult.parse({ ...body, ...(note ? { note } : {}) });
        span.setAttributes({
          status: result.status,
          action: result.rating?.action ?? "none",
          confidence: result.confidence,
          inputs: result.inputs_used.join(","),
          latency_ms: Math.round(performance.now() - started),
        });
        return JSON.stringify(result);
      }),
  };

  // The library's own tool, with the arguments checked here first: an empty
  // question or a stray key is refused before anything goes out to the hub.
  const lattice = latticeTool();
  const askLattice: ToolSpec = {
    ...lattice,
    run: (args: unknown, ctx: ToolContext) =>
      safeExecuteWithSpan("mcp.ask_lattice_animals", async (span: Span): Promise<ToolResult> => {
        span.setAttributes({ hop: ctx.hop, path: ctx.path.join(">") });
        const parsed = McpAskLatticeArgs.safeParse(args);
        if (!parsed.success) {
          span.setAttribute("error.kind", "invalid_args");
          return badArgs(lattice.name, parsed.error.issues);
        }
        span.setAttribute("q_len", parsed.data.question.length);
        const out = await lattice.run(parsed.data, ctx);
        const failed = typeof out === "object" && out !== null && "isError" in out && out.isError;
        span.setAttribute("outcome", failed ? "error" : "ok");
        return out;
      }),
  };

  return [searchIntent, rating, brandLookup, askLattice];
}

// ---------------- the server ----------------

type Env = Record<string, string | undefined>;

/** An env var that is set to something, else `undefined`: an empty `LATTICE_MCP_URL=` is "unset". */
function setting(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

/** `MCP_PUBLIC_ORIGIN` reduced to scheme, host and port; a value that is not a URL falls back to the default. */
function publicOrigin(env: Env): string {
  const raw = setting(env, "MCP_PUBLIC_ORIGIN");
  if (!raw) return MCP_DEFAULT_ORIGIN;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : MCP_DEFAULT_ORIGIN;
  } catch {
    return MCP_DEFAULT_ORIGIN;
  }
}

/**
 * The Mapvest MCP: `POST /mcp`, `POST /mcp/lattice`, `GET /.well-known/mcp.json`.
 * Configuration is the operator's, from the environment (never a caller's):
 *   MCP_PUBLIC_ORIGIN  the origin the manifest advertises (default: production)
 *   LATTICE_MCP_URL    the lattice hub's MCP (default: the hub's public address)
 *   MCP_ALLOW_LOCAL    "1" lets a peer be plain http on loopback (a laptop, a test)
 */
export function buildMapvestMcp(
  opts: { env?: Env; deps?: Partial<McpToolDeps>; post?: Post } = {},
): Mcp {
  const env = opts.env ?? process.env;
  return createMcp({
    name: MCP_SERVER_NAME,
    title: "Mapvest",
    description:
      "Mapvest turns places and objects into investable tickers. Read-only tools: read what someone typed (search_intent), look a public brand up in the curated seed (brand_lookup), get the research-signal rating for a ticker (rating), and ask the lattice animals (ask_lattice_animals).",
    instructions:
      "Mapvest turns places and objects into investable tickers. Every tool here is read-only and public. Results say what they rest on (sources); one that cannot cite a source is confidence low. rating is an AI-generated research signal, not investment advice, and insufficient_signal means no rating was produced, not a hold. Quotes, prices and financial statements are not offered.",
    version: MCP_SERVER_VERSION,
    origin: publicOrigin(env),
    peers: {
      lattice: {
        url: setting(env, "LATTICE_MCP_URL") ?? HUB_URL,
        about: "the lattice animals, the constellation's hub",
      },
    },
    allowLocal: env.MCP_ALLOW_LOCAL === "1",
    timeoutMs: MCP_PEER_TIMEOUT_MS,
    ...(opts.post ? { post: opts.post } : {}),
    tools: mapvestTools(opts.deps),
  });
}

export type { Mcp };
