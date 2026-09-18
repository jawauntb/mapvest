/**
 * Jev / Typesafe "System 1" client.
 *
 * A thin fetch wrapper around `POST https://api.typesafe.ai/v1/systemone`.
 * Jev is a fast, cheap classifier model — good at calibrated yes/no
 * (`noul`), single-choice (`choice`), and rubric-score (`score`) decisions
 * over a chunk of already-gathered context. It is NOT a reasoning or prose
 * model: nothing in this codebase should route open-ended generation,
 * multi-step reasoning, or math to it.
 *
 * Every helper here returns a typed `JevResult<...>` instead of throwing, so
 * every call site can pattern-match on `ok` and fall back to its existing
 * behavior. Per the safety contract for this integration, a Jev result is
 * only ever used to SKIP or SHORT-CIRCUIT optional work — it must never be
 * the sole path to a response a caller can't otherwise produce.
 *
 * Auth: reads `JEV_API_KEY` from the environment at CALL time (never cached
 * at module load), so a missing key fails closed — `no_api_key` — instead of
 * throwing. There is no key in local/dev/test; production supplies it via
 * the existing Doppler → Railway secret sync.
 */

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

/** Wall-clock cap per HTTP attempt. Jev is documented at ~70-500ms latency. */
const JEV_TIMEOUT_MS = 8_000;
/** Total attempts (1 initial + up to 2 retries) on a 429/529. */
const MAX_ATTEMPTS = 3;
/** Exponential backoff base — never retry immediately on rate limit. */
const BACKOFF_BASE_MS = 250;

/** Below this, a choice/score answer is treated as unusable (safety rule 1). */
export const JEV_MIN_CONFIDENCE = 0.55;

// ---------------- Wire types (JEV_SPEC) ----------------

export type JevState = string | Record<string, unknown> | unknown[];

export type JevNoulQuestion = { type: "noul"; instructions: string };
export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, null>;
};
export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};
export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export type JevNoulAnswer = { type: "noul"; noul: number };
export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, unknown>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export type JevUsage = { inputTokens: number; outputTokens: number };

// ---------------- Result types ----------------

export type JevFailureReason =
  | "no_api_key"
  | "network_error"
  | "timeout"
  | "http_error"
  | "rate_limited"
  | "invalid_response"
  | "low_confidence";

export type JevFailure = { ok: false; reason: JevFailureReason; detail?: string };
export type JevSuccess<A> = { ok: true; answer: A; usage: JevUsage };
export type JevResult<A> = JevSuccess<A> | JevFailure;

export type JevBatchSuccess = {
  ok: true;
  answers: Record<string, JevAnswer>;
  usage: JevUsage;
};
export type JevBatchResult = JevBatchSuccess | JevFailure;

function fail(reason: JevFailureReason, detail?: string): JevFailure {
  return detail ? { ok: false, reason, detail } : { ok: false, reason };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SystemOneResponseBody = {
  model?: string;
  answers?: Record<string, unknown>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseAnswer(raw: unknown): JevAnswer | null {
  if (!isPlainObject(raw)) return null;
  const type = raw.type;
  if (type === "noul") {
    const noul = raw.noul;
    if (typeof noul !== "number" || !Number.isFinite(noul)) return null;
    return { type: "noul", noul };
  }
  if (type === "choice") {
    const choice = raw.choice;
    const probabilities = raw.probabilities;
    const confidence = raw.confidence;
    if (typeof choice !== "string") return null;
    if (!isPlainObject(probabilities)) return null;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
    return {
      type: "choice",
      choice,
      probabilities: probabilities as Record<string, number>,
      confidence,
    };
  }
  if (type === "score") {
    const score = raw.score;
    const probabilities = raw.probabilities;
    const confidence = raw.confidence;
    if (typeof score !== "number" || !Number.isFinite(score)) return null;
    if (!isPlainObject(probabilities)) return null;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
    return {
      type: "score",
      score,
      legend: isPlainObject(raw.legend) ? raw.legend : {},
      probabilities: probabilities as Record<string, number>,
      confidence,
    };
  }
  return null;
}

/**
 * One `systemone` request carrying one or more questions. Retries on 429/529
 * with exponential backoff (never immediately, per JEV_SPEC); every other
 * failure mode (missing key, network error, timeout, other non-2xx,
 * unparseable body) fails closed with a typed reason instead of throwing.
 */
export async function askJev(
  state: JevState,
  questions: Record<string, JevQuestion>,
): Promise<JevBatchResult> {
  const apiKey = process.env.JEV_API_KEY;
  if (!apiKey) return fail("no_api_key");

  let lastFailure: JevFailure = fail("network_error");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
    try {
      const res = await fetch(JEV_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state, model: JEV_MODEL, questions }),
        signal: controller.signal,
      });

      if (res.status === 429 || res.status === 529) {
        lastFailure = fail("rate_limited", `jev systemone ${res.status}`);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
          continue;
        }
        return lastFailure;
      }
      if (!res.ok) {
        return fail("http_error", `jev systemone ${res.status}`);
      }

      let body: SystemOneResponseBody;
      try {
        body = (await res.json()) as SystemOneResponseBody;
      } catch (err) {
        return fail("invalid_response", err instanceof Error ? err.message : String(err));
      }
      if (!isPlainObject(body.answers)) {
        return fail("invalid_response", "missing answers object");
      }
      const answers: Record<string, JevAnswer> = {};
      for (const [id, raw] of Object.entries(body.answers)) {
        const parsed = parseAnswer(raw);
        if (!parsed) return fail("invalid_response", `unparseable answer for "${id}"`);
        answers[id] = parsed;
      }
      const usage: JevUsage = {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
      return { ok: true, answers, usage };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      lastFailure = isAbort
        ? fail("timeout")
        : fail("network_error", err instanceof Error ? err.message : String(err));
      // Only 429/529 are retried per JEV_SPEC — a network error or timeout
      // is not retried here; the caller's existing fallback path handles it.
      return lastFailure;
    } finally {
      clearTimeout(timer);
    }
  }
  return lastFailure;
}

const SOLE_QUESTION_ID = "q";

/** Ask one `noul` (calibrated yes/no probability) question. */
export async function noul(
  state: JevState,
  instructions: string,
): Promise<JevResult<JevNoulAnswer>> {
  const result = await askJev(state, {
    [SOLE_QUESTION_ID]: { type: "noul", instructions },
  });
  if (!result.ok) return result;
  const answer = result.answers[SOLE_QUESTION_ID];
  if (!answer || answer.type !== "noul") return fail("invalid_response", "expected a noul answer");
  return { ok: true, answer, usage: result.usage };
}

/**
 * Ask one `choice` (categorical) question. An answer with `confidence` below
 * `JEV_MIN_CONFIDENCE` is treated as a failure (`low_confidence`) so every
 * call site automatically falls back on an unreliable pick, per safety rule 1.
 */
export async function choice(
  state: JevState,
  instructions: string,
  criteria: Record<string, null>,
): Promise<JevResult<JevChoiceAnswer>> {
  const result = await askJev(state, {
    [SOLE_QUESTION_ID]: { type: "choice", instructions, criteria },
  });
  if (!result.ok) return result;
  const answer = result.answers[SOLE_QUESTION_ID];
  if (!answer || answer.type !== "choice") {
    return fail("invalid_response", "expected a choice answer");
  }
  if (answer.confidence < JEV_MIN_CONFIDENCE) return fail("low_confidence");
  return { ok: true, answer, usage: result.usage };
}

/**
 * Ask one `score` (ordered rubric) question. Same low-confidence gate as
 * `choice()`.
 */
export async function score(
  state: JevState,
  instructions: string,
  criteria: string[],
): Promise<JevResult<JevScoreAnswer>> {
  const result = await askJev(state, {
    [SOLE_QUESTION_ID]: { type: "score", instructions, criteria },
  });
  if (!result.ok) return result;
  const answer = result.answers[SOLE_QUESTION_ID];
  if (!answer || answer.type !== "score") {
    return fail("invalid_response", "expected a score answer");
  }
  if (answer.confidence < JEV_MIN_CONFIDENCE) return fail("low_confidence");
  return { ok: true, answer, usage: result.usage };
}
