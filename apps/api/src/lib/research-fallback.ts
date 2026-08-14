/**
 * Derivation Research Console is a separate service (finance-agent tools).
 * When it returns MODEL_BUDGET_EXHAUSTED we still owe the user a brief.
 * Chain: Grok 4.6 → GPT-5.6 Luna → Claude Opus 4.8. No invented prices.
 */

export const RESEARCH_FALLBACK_MODELS = [
  "x-ai/grok-4.6",
  "openai/gpt-5.6-luna",
  "anthropic/claude-opus-4.8",
] as const;
const TIMEOUT_MS = 25_000;

export function isMachineErrorText(s: string | undefined | null): boolean {
  const t = (s ?? "").trim();
  if (!t) return false;
  if (/^[A-Z][A-Z0-9_]{5,}$/.test(t)) return true;
  return /BUDGET_EXHAUSTED|RATE_LIMIT|INSUFFICIENT_QUOTA|MODEL_/.test(t);
}

export function friendlyResearchPreview(): string {
  return "Research is temporarily unavailable. Try again in a moment.";
}

export async function openRouterResearchBrief(message: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing (Doppler)");

  const models = RESEARCH_FALLBACK_MODELS;
  let lastErr: unknown;
  for (const model of models) {
    try {
      return await requestBrief(model, apiKey, baseUrl, message);
    } catch (err) {
      lastErr = err;
      console.warn(`[research-fallback] ${model} failed:`, err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function requestBrief(
  model: string,
  apiKey: string,
  baseUrl: string,
  message: string,
): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You write short financial research briefs. Lede first, then evidence. Cite public sources by name when you rely on them. Never invent prices, tickers, or statistics. If you are unsure, say so and set a cautious tone. Research only — no trades, no broker orders. Plain text, no markdown headers.",
          },
          { role: "user", content: message.slice(0, 4000) },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 402 || res.status === 429 || isMachineErrorText(body)) {
        throw new Error(`MODEL_BUDGET_EXHAUSTED (${model} ${res.status})`);
      }
      throw new Error(`OpenRouter ${model} ${res.status}`);
    }
    const j = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = j.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text || isMachineErrorText(text)) {
      throw new Error("empty or machine-error brief");
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}
