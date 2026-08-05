import type { LatLng, PhotoIdentification } from "@mapvest/core";

/**
 * OpenRouter multimodal client. Prefers google/gemini-2.5-pro; falls back
 * to anthropic/claude-5-sonnet on 5xx or timeout > 8s.
 *
 * Env: OPENROUTER_API_KEY, OPENROUTER_BASE_URL (via Doppler).
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

export async function identifyFromImage(
  bytes: Uint8Array,
  opts: IdentifyOptions = {},
): Promise<PhotoIdentification> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing (Doppler)");

  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:image/jpeg;base64,${b64}`;

  const body = (model: string) => ({
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
  });

  const call = async (model: string) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://mapvest.app",
          "X-Title": "Mapvest",
        },
        body: JSON.stringify(body(model)),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter ${model} ${res.status}`);
      const j = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = j.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content);
      return { ...parsed, modelUsed: model } as PhotoIdentification;
    } finally {
      clearTimeout(t);
    }
  };

  try {
    return await call(PRIMARY_MODEL);
  } catch (err) {
    console.warn("[vision] primary model failed, falling back:", err);
    return await call(FALLBACK_MODEL);
  }
}
