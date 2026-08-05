/**
 * Per-request cost telemetry: OpenRouter tokens + Exa search hits.
 *
 * Records land in a fixed-size ring so /v1/admin/metrics can summarize them
 * without any external store. Every record is also emitted as a logfire
 * counter so it flows to the OTel pipeline.
 */

import { recordCounter } from "./logfire.js";

export type OpenRouterUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
  latencyMs?: number;
};

export type CostRecord = {
  ts: string; // ISO
  path: string;
  openrouter?: OpenRouterUsage;
  exaHits?: number;
  requestId?: string;
};

const CAPACITY = 500;
const ring: CostRecord[] = [];
let cursor = 0;

/** Totals kept incrementally so aggregate reads are O(1). */
const modelTokens: Map<string, { prompt: number; completion: number; calls: number }> =
  new Map();
let totalExaHits = 0;
let totalExaCalls = 0;

export function recordCost(rec: CostRecord): void {
  ring[cursor % CAPACITY] = rec;
  cursor += 1;

  if (rec.openrouter) {
    const { model, promptTokens, completionTokens } = rec.openrouter;
    const cur = modelTokens.get(model) ?? { prompt: 0, completion: 0, calls: 0 };
    cur.prompt += promptTokens;
    cur.completion += completionTokens;
    cur.calls += 1;
    modelTokens.set(model, cur);
    recordCounter("openrouter.tokens.prompt", promptTokens, { model, path: rec.path });
    recordCounter("openrouter.tokens.completion", completionTokens, {
      model,
      path: rec.path,
    });
    recordCounter("openrouter.calls", 1, { model, path: rec.path });
  }

  if (typeof rec.exaHits === "number") {
    totalExaHits += rec.exaHits;
    totalExaCalls += 1;
    recordCounter("exa.hits", rec.exaHits, { path: rec.path });
    recordCounter("exa.calls", 1, { path: rec.path });
  }
}

/** Bump the aggregate Exa counters without a per-request record — for background jobs. */
export function noteExaHits(hits: number): void {
  totalExaHits += hits;
  totalExaCalls += 1;
  recordCounter("exa.hits", hits, {});
  recordCounter("exa.calls", 1, {});
}

export function costTail(limit = 100): CostRecord[] {
  const clamped = Math.max(1, Math.min(limit, CAPACITY));
  const out: CostRecord[] = [];
  const count = Math.min(cursor, CAPACITY);
  const start = cursor > CAPACITY ? cursor - CAPACITY : 0;
  for (let i = 0; i < count; i++) {
    const idx = (start + i) % CAPACITY;
    const r = ring[idx];
    if (r) out.push(r);
  }
  return out.slice(-clamped);
}

export function costSummary() {
  const models: Record<
    string,
    { promptTokens: number; completionTokens: number; totalTokens: number; calls: number }
  > = {};
  for (const [m, v] of modelTokens) {
    models[m] = {
      promptTokens: v.prompt,
      completionTokens: v.completion,
      totalTokens: v.prompt + v.completion,
      calls: v.calls,
    };
  }
  return {
    openrouter: {
      models,
      totalCalls: Object.values(models).reduce((a, b) => a + b.calls, 0),
      totalPromptTokens: Object.values(models).reduce((a, b) => a + b.promptTokens, 0),
      totalCompletionTokens: Object.values(models).reduce(
        (a, b) => a + b.completionTokens,
        0,
      ),
    },
    exa: {
      totalCalls: totalExaCalls,
      totalHits: totalExaHits,
      avgHitsPerCall: totalExaCalls ? totalExaHits / totalExaCalls : 0,
    },
    windowSize: Math.min(cursor, CAPACITY),
  };
}

/** Test-only reset. */
export function __resetCostTelemetry(): void {
  ring.length = 0;
  cursor = 0;
  modelTokens.clear();
  totalExaHits = 0;
  totalExaCalls = 0;
}
