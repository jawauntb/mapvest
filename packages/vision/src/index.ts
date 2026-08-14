import type { LatLng, PhotoIdentification } from "@mapvest/core";

/**
 * OpenRouter multimodal client. Prefers openai/gpt-5.6-terra (image + text);
 * falls back to anthropic/claude-opus-4.8, then x-ai/grok-4.6, on 4xx/5xx
 * or timeout. Claude via OpenRouter is OK on the user path.
 * ANTHROPIC_API_KEY stays agent-ops only.
 *
 * Env: OPENROUTER_API_KEY, OPENROUTER_BASE_URL (via Doppler).
 *
 * Two entry points:
 *   - identifyFromImage(bytes, opts)         → PhotoIdentification (legacy)
 *   - identifyFromImageWithUsage(bytes, opts)→ { identification, usage }
 */

const PRIMARY_MODEL = "openai/gpt-5.6-terra";
const FALLBACK_MODELS = ["anthropic/claude-opus-4.8", "x-ai/grok-4.6"] as const;

const SYSTEM_PROMPT = `You identify investable brands and products from an image.
Return strict JSON matching:
{
  "visibleText": string[],
  "detected": [{ "brand": string?, "product": string?, "sector": string?, "confidence": "high"|"medium"|"low" }],
  "modelUsed": string
}

Rules:
- Only include brands you can see or infer from clearly visible text/logo.
- Never fabricate a brand. If uncertain, return an empty "detected" array.
- For characters / IP / toys, name the franchise or rights-holder brand when visible (e.g. "Pokémon", "Nintendo").
- Sector should follow GICS terminology when possible (e.g. "Consumer Staples", "Consumer Discretionary").`;

export type IdentifyOptions = {
  location?: LatLng;
  /** Free-text user hint about the photographed subject (≤140 chars, pre-trimmed by the API). */
  hint?: string;
  timeoutMs?: number;
};

export type IdentifyUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
};

export type IdentifyWithUsageResult = {
  identification: PhotoIdentification;
  usage: IdentifyUsage;
};

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
};

async function callOpenRouter(
  model: string,
  bytes: Uint8Array,
  opts: IdentifyOptions,
): Promise<{ identification: PhotoIdentification; usage: IdentifyUsage }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing (Doppler)");

  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:image/jpeg;base64,${b64}`;

  const promptLines = [
    opts.location
      ? `Location hint: lat=${opts.location.lat}, lng=${opts.location.lng}. Identify.`
      : "Identify the brand or product.",
  ];
  if (opts.hint) promptLines.push(`User hint about the subject: "${opts.hint}"`);

  const body = {
    model,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: promptLines.join("\n") },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  const controller = new AbortController();
  // Multimodal identify routinely needs >8s; 25s default.
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);
  const started = performance.now();
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
    const j = (await res.json()) as OpenRouterResponse;
    const rawContent = j.choices?.[0]?.message?.content ?? "{}";
    const stripped = rawContent
      .replace(/^\s*```(?:json|JSON)?\s*/, "")
      .replace(/\s*```\s*$/, "")
      .trim();
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    const jsonSlice =
      firstBrace !== -1 && lastBrace > firstBrace
        ? stripped.slice(firstBrace, lastBrace + 1)
        : stripped;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonSlice);
    } catch {
      parsed = { detected: [], visibleText: [] };
    }
    const identification = { ...parsed, modelUsed: model } as PhotoIdentification;
    const latencyMs = Math.round(performance.now() - started);
    const promptTokens = j.usage?.prompt_tokens ?? 0;
    const completionTokens = j.usage?.completion_tokens ?? 0;
    const totalTokens = j.usage?.total_tokens ?? promptTokens + completionTokens;
    const usage: IdentifyUsage = {
      model: j.model ?? model,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
    };
    return { identification, usage };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Full result including usage/latency — call this from routes that want to
 * record cost telemetry.
 */
export async function identifyFromImageWithUsage(
  bytes: Uint8Array,
  opts: IdentifyOptions = {},
): Promise<IdentifyWithUsageResult> {
  const models = [PRIMARY_MODEL, ...FALLBACK_MODELS];
  let lastErr: unknown;
  for (const model of models) {
    try {
      return await callOpenRouter(model, bytes, opts);
    } catch (err) {
      lastErr = err;
      console.warn(`[vision] model ${model} failed, trying next:`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Primary export — kept as-is so existing callers don't need to change.
 * Callers that need token/latency should use `identifyFromImageWithUsage`.
 */
export async function identifyFromImage(
  bytes: Uint8Array,
  opts: IdentifyOptions = {},
): Promise<PhotoIdentification> {
  const { identification } = await identifyFromImageWithUsage(bytes, opts);
  return identification;
}
