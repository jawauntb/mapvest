import type { Source } from "@mapvest/core";

/**
 * Exa search wrapper. Env: EXA_API_KEY.
 */

const BASE = "https://api.exa.ai";

export type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
};

async function exa<T>(path: string, body: unknown): Promise<T> {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY missing (Doppler)");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Exa ${path} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function searchBrand(brand: string): Promise<SearchResult[]> {
  const j = await exa<{ results: SearchResult[] }>("/search", {
    query: `${brand} parent company ticker stock symbol`,
    numResults: 8,
    useAutoprompt: true,
    contents: { snippets: { numSnippets: 2 } },
  });
  return j.results ?? [];
}

export async function enrichTicker(query: string): Promise<SearchResult[]> {
  const j = await exa<{ results: SearchResult[] }>("/search", {
    query,
    numResults: 5,
    useAutoprompt: true,
    contents: { snippets: { numSnippets: 1 } },
  });
  return j.results ?? [];
}

export function toSource(r: SearchResult, confidence: "high" | "medium" | "low" = "medium"): Source {
  return {
    provider: "exa",
    url: r.url,
    fetchedAt: new Date().toISOString(),
    confidence,
  };
}
