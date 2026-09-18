/**
 * Shared OpenRouter chat-completion client.
 *
 * Four call sites (`environment-brief-generator.ts`, `local-brief-generator.ts`,
 * `synthesis-memo.ts`, `watchlist-brief.ts`) each hand-rolled the same four
 * things: the Bearer/HTTP-Referer/X-Title auth header, an AbortController
 * timeout, JSON-fence-stripped parsing of the model's content string, and a
 * try-next-model cascade loop over `[primary, ...fallbacks]`. This module is
 * the one place that logic lives now; each call site keeps its own model
 * list, system prompt, and (site-specific) output validation.
 *
 * `packages/vision/src/index.ts` has its own, differently-shaped OpenRouter
 * call (vision/classification, not chat-completion JSON) and is intentionally
 * left alone — out of scope here.
 */

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_TEMPERATURE = 0.3;

export class OpenRouterConfigError extends Error {}

/**
 * Strips a leading/trailing ```json fence (models wrap JSON in one even when
 * asked for `response_format: json_object`) and then slices from the first
 * `{` to the last `}` so any stray prose around the object is dropped. Safe
 * to call on already-clean JSON.
 */
export function stripToJsonObject(raw: string): string {
  const stripped = raw
    .replace(/^\s*```(?:json|JSON)?\s*/, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  return first !== -1 && last > first ? stripped.slice(first, last + 1) : stripped;
}

type ChatMessage = { role: "system" | "user"; content: string };

/** One `/chat/completions` call to a single model. Throws on any failure —
 * non-2xx, timeout, or a body with no message content. */
async function requestOnce(opts: {
  model: string;
  apiKey: string;
  baseUrl: string;
  messages: ChatMessage[];
  temperature: number;
  timeoutMs: number;
}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mapvest.app",
        "X-Title": "Mapvest",
      },
      body: JSON.stringify({
        model: opts.model,
        response_format: { type: "json_object" as const },
        temperature: opts.temperature,
        messages: opts.messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter ${opts.model} ${res.status}`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error(`OpenRouter ${opts.model} returned no content`);
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export type OpenRouterCascadeOptions<T> = {
  /** Tried in order; the first to produce a valid `T` wins. */
  models: readonly string[];
  systemPrompt: string;
  userContent: string;
  temperature?: number;
  timeoutMs?: number;
  /**
   * Parses one model's raw completion content into `T`. Throw (or let
   * `stripToJsonObject` + `JSON.parse` throw) to signal "this model's output
   * doesn't count — try the next one in the cascade".
   */
  parse: (raw: string) => T;
  /** Prefixes the per-model `console.warn` on fallthrough, e.g. `"[watchlist-brief]"`. */
  logPrefix: string;
};

/**
 * Runs the shared cascade: try `models[0]`, and on ANY failure (non-2xx,
 * timeout, unparseable/invalid output) fall through to the next model,
 * logging each fallthrough. Throws the last error only if every model in the
 * cascade fails — callers already treat that throw as "the model layer is
 * down" and take their own fallback (a cached/canned response, or a 502).
 */
export async function callOpenRouterCascade<T>(opts: OpenRouterCascadeOptions<T>): Promise<T> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL;
  if (!apiKey) throw new OpenRouterConfigError("OPENROUTER_API_KEY missing (Doppler)");

  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userContent },
  ];
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastErr: unknown;
  for (const model of opts.models) {
    try {
      const raw = await requestOnce({ model, apiKey, baseUrl, messages, temperature, timeoutMs });
      return opts.parse(raw);
    } catch (err) {
      lastErr = err;
      console.warn(`${opts.logPrefix} model ${model} failed, trying next:`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
