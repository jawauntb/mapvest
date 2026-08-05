import type { LatLng, PhotoIdentification } from "@mapvest/core";

/**
 * OpenRouter multimodal client. Prefers google/gemini-2.5-pro; falls back
 * to anthropic/claude-5-sonnet on 5xx or timeout > 8s.
 *
 * Env: OPENROUTER_API_KEY, OPENROUTER_BASE_URL (via Doppler).
 *
 * Two entry points:
 *   - identifyFromImage(bytes, opts)         → PhotoIdentification (legacy)
 *   - identifyFromImageWithUsage(bytes, opts)→ { identification, usage }
 * The plain form remains the primary export for callers that don't need
 * cost telemetry; the "WithUsage" form surfaces model, token counts, and
 * latency so the API layer can wire them into logfire / cost dashboards.
 */

const PRIMARY_MODEL = "google/gemini-2.5-pro";
const FALLBACK_MODEL = "anthropic/claude-5-sonnet";

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
- Sector should follow GICS terminology when possible (e.g. "Consumer Staples", "Consumer Discretionary").`;

export type IdentifyOptions = {
  location?: LatLng;
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

  const body = {
    model,
    response_format: { type: "json_object" as const },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: opts.location
              ? `Location hint: lat=${opts.location.lat}, lng=${opts.location.lng}. Identify.`
              : "Identify the brand or product.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
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
    const content = j.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
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
  try {
    return await callOpenRouter(PRIMARY_MODEL, bytes, opts);
  } catch (err) {
    console.warn("[vision] primary model failed, falling back:", err);
    return await callOpenRouter(FALLBACK_MODEL, bytes, opts);
  }
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
