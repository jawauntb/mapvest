#!/usr/bin/env bun
/**
 * scripts/jev-candidate-scan.ts
 *
 * Reusable tool: classifies a list of LLM call sites as good/maybe/bad
 * candidates for being replaced or gated by Jev — the cheap "System 1"
 * classifier client at `apps/api/src/lib/jev-client.ts` — using Jev's own
 * `choice` primitive. All candidates are judged in ONE BATCHED `systemone`
 * request (one `choice` question per candidate id, one HTTP call total),
 * exactly the pattern a real call site would use to classify several things
 * at once cheaply.
 *
 * Usage:
 *   JEV_API_KEY=... bun run scripts/jev-candidate-scan.ts
 *
 * Without JEV_API_KEY set, this exits cleanly (code 0) with a message
 * instead of crashing or making a network call — same fail-closed contract
 * as the main client.
 *
 * To classify a different or future set of call sites, edit the
 * `CANDIDATES` array below with `{ id, description }` entries — nothing
 * about `scanCandidates()` or `printTable()` is specific to today's four
 * generators. A good `description` names: what the call site's job actually
 * is, what kind of input it has available, and what kind of output it
 * produces — Jev is judging fit from that text alone, the same way a human
 * reviewer would from a one-line summary of the code.
 *
 * Jev is System 1 (see apps/api/src/lib/jev-client.ts's module doc):
 * excellent at calibrated yes/no, single-choice, and rubric-score decisions
 * over given context; bad at open-ended prose generation, multi-step
 * reasoning, or math. A "good_candidate" here means "this call site's job
 * IS one of those bounded decisions", not "swap the whole feature to Jev".
 */

import { type JevChoiceAnswer, type JevQuestion, askJev } from "../apps/api/src/lib/jev-client.js";

type Candidate = { id: string; description: string };

/**
 * Known LLM call sites as of the Jev integration (2026-09). The four prose
 * generators and the vision classifier are the call sites that existed when
 * this script was written; the watchlist pre-filter and the headline
 * materiality scorer are the Jev call sites the integration has added since.
 * (Memo `citation_type` badges are NOT a Mapvest call site: the sibling
 * underlying-analyzer-reboot engine classifies citations and Mapvest only
 * passes the annotation through — see docs/PRISM.md "Citation types".)
 * Extend this list as new call sites appear.
 */
const CANDIDATES: Candidate[] = [
  {
    id: "headline-materiality",
    description:
      "apps/api/src/lib/headline-materiality.ts — for a page of headlines (GET /v1/news for one ticker, GET /v1/watchlist/headlines across a watchlist) asks ONE batched systemone request with one `choice` question per headline over {noise, minor, material}, given the headline title/source/ticker and the watchlist tickers as state. Emits an optional per-item jev_materiality {level, score, confidence} tag, omitted below 0.55 confidence or on any failure, memoized 15 minutes per headline. A bounded three-way classification over already-gathered context.",
  },
  {
    id: "environment-brief-generator",
    description:
      "apps/api/src/lib/environment-brief-generator.ts — an OpenRouter model cascade writes a 2-3 paragraph macro/sector narrative (headline, body, tailwinds, headwinds) from FRED series values and Exa search excerpts. The job is open-ended prose composition over qualitative and quantitative context, not picking among a fixed small set of labels.",
  },
  {
    id: "local-brief-generator",
    description:
      "apps/api/src/lib/local-brief-generator.ts — an OpenRouter model cascade writes a 3-4 paragraph neighborhood economic profile (area character, employment, policy outlook, tailwinds/headwinds) from nearby-brand and Exa search data. Open-ended prose composition, not a classification.",
  },
  {
    id: "synthesis-memo",
    description:
      "apps/api/src/lib/synthesis-memo.ts — an OpenRouter model cascade reads up to four already-gathered data layers (value-chain graph, demand pulse, environment brief, financial ratios) and writes a multi-paragraph memo answering three open analytical questions (binding constraint, demand durability, pricing power). This requires synthesizing several layers of numeric and qualitative evidence into free-form written analysis — open-ended reasoning and prose, not a bounded pick.",
  },
  {
    id: "watchlist-brief",
    description:
      "apps/api/src/lib/watchlist-brief.ts — an OpenRouter model cascade writes a short Financial-Times-style daily market column from ticker quotes and headlines. The column itself is open-ended prose generation. A pre-filter step now sits in front of it and asks a single calibrated yes/no question — 'does this headline batch carry enough new signal to justify a fresh column?' — over the already-gathered headline batch, purely to gate whether the expensive prose step runs at all.",
  },
  {
    id: "vision-classification",
    description:
      "packages/vision/src/index.ts — sends a photo plus a short list of candidate brand names to a vision-capable OpenRouter model and asks which brand (if any) the photo shows. Choosing one of a bounded set of brand labels is exactly the shape of decision Jev's `choice` primitive is built for, but Jev's systemone endpoint takes a text/JSON `state` with no documented image input, so it cannot yet take this call site's actual input (an image) — a fit blocked on missing multimodal support, not on the decision shape.",
  },
];

const JEV_FIT_CRITERIA = { good_candidate: null, maybe: null, bad_candidate: null } as const;

function questionFor(candidate: Candidate): JevQuestion {
  return {
    type: "choice",
    instructions: `An LLM call site in a codebase is described below. Classify how good a fit it is for being replaced or gated by Jev, a fast/cheap "System 1" model that is excellent at calibrated yes/no, single-choice, and rubric-score decisions over given context, but bad at open-ended prose generation, multi-step reasoning, or math.

Call site: ${candidate.description}

good_candidate = the call site's actual job is a classification, gating, or scoring decision that one of Jev's primitives (noul/choice/score) could make directly.
maybe = part of the call site is Jev-shaped (e.g. a gate placed in front of it) but its core job is not, or Jev cannot yet take the input this call site needs.
bad_candidate = the call site's job is open-ended generation, multi-step reasoning, or math — exactly what Jev is documented to be bad at.`,
    criteria: JEV_FIT_CRITERIA,
  };
}

/** One batched systemone request: one `choice` question per candidate id. */
async function scanCandidates(candidates: Candidate[]) {
  const questions: Record<string, JevQuestion> = {};
  for (const c of candidates) questions[c.id] = questionFor(c);
  return askJev(
    { candidates: candidates.map((c) => ({ id: c.id, description: c.description })) },
    questions,
  );
}

type ResultRow = { id: string; choice: string; confidence: string };

function printTable(rows: ResultRow[]): void {
  const idWidth = Math.max(2, ...rows.map((r) => r.id.length));
  const choiceWidth = Math.max(6, ...rows.map((r) => r.choice.length));
  const pad = (s: string, w: number) => s.padEnd(w, " ");
  console.log(`${pad("id", idWidth)}  ${pad("choice", choiceWidth)}  confidence`);
  console.log(`${"-".repeat(idWidth)}  ${"-".repeat(choiceWidth)}  ----------`);
  for (const r of rows) {
    console.log(`${pad(r.id, idWidth)}  ${pad(r.choice, choiceWidth)}  ${r.confidence}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.JEV_API_KEY) {
    console.log(
      "JEV_API_KEY is not set — nothing to scan against.\n" +
        "Set it and re-run: JEV_API_KEY=... bun run scripts/jev-candidate-scan.ts",
    );
    return;
  }

  const result = await scanCandidates(CANDIDATES);
  if (!result.ok) {
    console.log(
      `Jev request failed (${result.reason}${result.detail ? `: ${result.detail}` : ""}) — nothing to print.`,
    );
    return;
  }

  const rows: ResultRow[] = CANDIDATES.map((c) => {
    const answer = result.answers[c.id];
    if (!answer || answer.type !== "choice") {
      return { id: c.id, choice: "(no answer)", confidence: "-" };
    }
    const choiceAnswer = answer as JevChoiceAnswer;
    return {
      id: c.id,
      choice: choiceAnswer.choice,
      confidence: choiceAnswer.confidence.toFixed(2),
    };
  });
  printTable(rows);
  console.log(
    `\n(${result.usage.inputTokens} input tokens, ${result.usage.outputTokens} output tokens)`,
  );
}

main();
