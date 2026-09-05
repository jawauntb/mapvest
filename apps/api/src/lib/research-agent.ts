import type {
  AgentConversationStatus,
  AgentThreadSummary,
  ResearchArticle,
  ResearchConversation,
  ResearchConversationStatus,
} from "@mapvest/core";
import {
  type DerivationAutoresearchResponse,
  DerivationUpstreamError,
  getDerivationAutoresearch,
  getDerivationOrigin,
} from "./derivation.js";
import type { ResearchConversation as StoredResearchConversation } from "./research-conversation-store.js";

const TERMINAL_STATUSES = new Set<ResearchConversationStatus>([
  "conclusive",
  "exhausted",
  "blocked",
  "error",
]);
const STATUS_VALUES = new Set<ResearchConversationStatus>([
  "queued",
  "running",
  "conclusive",
  "exhausted",
  "blocked",
  "error",
]);

type LooseObject = Record<string, unknown>;
const USER_PROMPT_MARKER = "\n\nUser: ";

function object(value: unknown): LooseObject | undefined {
  return value && typeof value === "object" ? (value as LooseObject) : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = nonEmptyString(item);
        return text ? [text] : [];
      })
    : [];
}

function status(value: unknown, fallback: ResearchConversationStatus = "error") {
  return typeof value === "string" && STATUS_VALUES.has(value as ResearchConversationStatus)
    ? (value as ResearchConversationStatus)
    : fallback;
}

export function isResearchConversationTerminal(value: unknown): boolean {
  return typeof value === "string" && TERMINAL_STATUSES.has(value as ResearchConversationStatus);
}

/** Hard cap on injected Prism context so one packet cannot crowd out the turn. */
export const RESEARCH_PRISM_CONTEXT_MAX_CHARS = 6_000;

/**
 * Builds the upstream research prompt.
 *
 * `prismSummary` and `situateSummary` are the optional bounded projections of a
 * packet for `ticker` (see `lib/prism.ts` / `lib/situate.ts`). They are
 * *context*, never a requirement: callers fetch them best-effort and pass
 * `undefined` when missing. When both are absent the prompt is byte-identical
 * to the pre-packet shape. Situate is the primary engine, so its context is
 * preferred; the Prism block is kept byte-identical for the case where only a
 * Prism packet exists. The context is placed before {@link USER_PROMPT_MARKER}
 * so `userFacingPrompt` still strips it out of anything the client displays.
 */
export function buildResearchPrompt(
  message: string,
  ticker?: string,
  prismSummary?: string,
  situateSummary?: string,
): string {
  const instruction =
    "Write like a short financial news brief when you conclude — lede first, then evidence. Research-only; no trades; no broker orders.";
  const focus = ticker ? `Focus ticker: $${ticker}. ` : "";
  const situate = situateSummary?.trim();
  const prism = prismSummary?.trim();
  const subject = ticker ?? "the subject";
  const context = situate
    ? `\n\nSituate packet context for $${subject} — a quantitative research packet already computed by the Underlying engine (factor + macro exposure, per-horizon base-rate and options-implied odds, fundamentals, filing diffs). It frames the odds as a posture, never a buy/sell call. Treat it as evidence you may cite as "Situate", verify anything load-bearing, and say so if it contradicts what you find:\n${situate.slice(0, RESEARCH_PRISM_CONTEXT_MAX_CHARS)}`
    : prism
      ? `\n\nPrism packet context for $${ticker ?? "the subject"} — a quantitative memo packet already computed by the Underlying engine (macro, factor, regime, spectral, entropy, fundamentals, filings). Treat it as evidence you may cite as "Prism", verify anything load-bearing, and say so if it contradicts what you find:\n${prism.slice(0, RESEARCH_PRISM_CONTEXT_MAX_CHARS)}`
      : "";
  return `${focus}${instruction}${context}${USER_PROMPT_MARKER}${message}`;
}

function userFacingPrompt(value: string): string {
  const marker = value.indexOf(USER_PROMPT_MARKER);
  return marker >= 0 ? value.slice(marker + USER_PROMPT_MARKER.length) : value;
}

export function titleFromResearchPrompt(message: string, ticker?: string): string {
  if (ticker) return `$${ticker} research`;
  const firstLine = message.split(/\r?\n/, 1)[0]?.trim() || "Research";
  return firstLine.slice(0, 72);
}

export function conversationFromPayload(payload: unknown): ResearchConversation | undefined {
  const root = object(payload);
  const conversation = object(root?.conversation) ?? object(root?.campaign);
  return nonEmptyString(conversation?.id) ? (conversation as ResearchConversation) : undefined;
}

export function conversationIdFromPayload(payload: unknown): string | undefined {
  return conversationFromPayload(payload)?.id ?? nonEmptyString(object(payload)?.conversation_id);
}

function tickerSymbols(text: string): string[] {
  const stop = new Set([
    "THE",
    "AND",
    "FOR",
    "WITH",
    "FROM",
    "THIS",
    "THAT",
    "JSON",
    "USD",
    "ETF",
    "CEO",
    "IPO",
    "SEC",
    "PDF",
    "API",
    "HTTP",
    "URL",
  ]);
  const symbols: string[] = [];
  const matches = text.matchAll(/\$([A-Z][A-Z0-9.]{0,5})\b|\b([A-Z]{1,5})\b/g);
  for (const match of matches) {
    const symbol = (match[1] ?? match[2] ?? "").toUpperCase();
    if (!symbol || stop.has(symbol) || symbols.includes(symbol)) continue;
    symbols.push(symbol);
    if (symbols.length >= 6) break;
  }
  return symbols;
}

function sourceList(value: unknown): Array<{ label: string; url?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ label: item.trim() }];
    const source = object(item);
    if (!source) return [];
    const label =
      nonEmptyString(source.label) ??
      nonEmptyString(source.name) ??
      nonEmptyString(source.provider) ??
      "source";
    const rawUrl = nonEmptyString(source.url);
    let url: string | undefined;
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") url = parsed.toString();
      } catch {
        // Provider-only citations remain useful when an upstream URL is malformed.
      }
    }
    return [{ label, ...(url ? { url } : {}) }];
  });
}

function ideas(value: unknown): ResearchArticle["ideas"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const idea = object(item);
    if (!idea) return [];
    return [
      {
        title: nonEmptyString(idea.title) ?? "Research idea",
        thesis:
          nonEmptyString(idea.thesis) ??
          nonEmptyString(idea.why) ??
          nonEmptyString(idea.summary) ??
          "",
        ...(nonEmptyString(idea.disposition)
          ? { disposition: nonEmptyString(idea.disposition) }
          : {}),
        findings: stringArray(idea.findings),
      },
    ];
  });
}

function tools(result: LooseObject | undefined, run: LooseObject): string[] {
  const names: string[] = [];
  const trace = Array.isArray(result?.trace) ? result.trace : [];
  for (const item of trace) {
    const name = nonEmptyString(object(item)?.tool);
    if (name && !names.includes(name)) names.push(name);
  }
  const events = Array.isArray(run.events) ? run.events : [];
  for (const item of events) {
    const event = object(item);
    const name = nonEmptyString(object(event?.data)?.tool);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function researchProgress(run: LooseObject): ResearchArticle["progress"] {
  const taskRuns = Array.isArray(run.task_runs) ? run.task_runs : [];
  const planTasks = Array.isArray(object(run.research_plan)?.tasks)
    ? (object(run.research_plan)?.tasks as unknown[])
    : [];
  const gate = object(run.evidence_gate);
  const completedTasks = taskRuns.filter((item) => {
    const task = object(item);
    const taskStatus = nonEmptyString(task?.status)?.toLowerCase();
    return (
      Boolean(task?.result) ||
      ["complete", "completed", "succeeded", "failed", "skipped", "error"].includes(
        taskStatus ?? "",
      )
    );
  }).length;
  const progress = {
    ...(finiteNumber(run.completed_iterations) !== undefined
      ? { completedIterations: finiteNumber(run.completed_iterations) }
      : {}),
    ...(finiteNumber(run.max_iterations) !== undefined
      ? { maxIterations: finiteNumber(run.max_iterations) }
      : {}),
    ...(taskRuns.length || planTasks.length
      ? { completedTasks, totalTasks: planTasks.length }
      : {}),
    ...(typeof gate?.ready === "boolean" ? { evidenceReady: gate.ready } : {}),
    ...(finiteNumber(gate?.essential_claims_ready) !== undefined
      ? { essentialClaimsReady: finiteNumber(gate?.essential_claims_ready) }
      : {}),
    ...(finiteNumber(gate?.essential_claims_total) !== undefined
      ? { essentialClaimsTotal: finiteNumber(gate?.essential_claims_total) }
      : {}),
  };
  return Object.keys(progress).length ? progress : undefined;
}

function researchEvidence(run: LooseObject): NonNullable<ResearchArticle["evidence"]> {
  const facts = Array.isArray(object(run.preview)?.facts) ? object(run.preview)?.facts : [];
  return (facts as unknown[]).flatMap((item) => {
    const fact = object(item);
    const summary = nonEmptyString(fact?.summary);
    if (!summary) return [];
    return [
      {
        summary,
        ...(nonEmptyString(fact?.source) ? { source: nonEmptyString(fact?.source) } : {}),
        ...(nonEmptyString(fact?.freshness_verdict)
          ? { freshness: nonEmptyString(fact?.freshness_verdict) }
          : {}),
        ...(stringArray(fact?.artifact_refs).length
          ? { artifactRefs: stringArray(fact?.artifact_refs) }
          : {}),
      },
    ];
  });
}

function researchContext(run: LooseObject): NonNullable<ResearchArticle["context"]> {
  const context = Array.isArray(object(run.preview)?.context) ? object(run.preview)?.context : [];
  return (context as unknown[]).flatMap((item) => {
    const detail = object(item);
    const summary = nonEmptyString(detail?.summary);
    if (!summary) return [];
    return [
      {
        summary,
        ...(nonEmptyString(detail?.reason) ? { reason: nonEmptyString(detail?.reason) } : {}),
        ...(nonEmptyString(detail?.source) ? { source: nonEmptyString(detail?.source) } : {}),
      },
    ];
  });
}

function researchSpecialists(run: LooseObject): NonNullable<ResearchArticle["specialists"]> {
  const specialists = Array.isArray(run.specialist_runs) ? run.specialist_runs : [];
  return specialists.flatMap((item) => {
    const specialist = object(item);
    const role = nonEmptyString(specialist?.role);
    if (!role) return [];
    return [
      {
        role,
        ...(nonEmptyString(specialist?.status)
          ? { status: nonEmptyString(specialist?.status) }
          : {}),
        ...(nonEmptyString(specialist?.analysis) || nonEmptyString(specialist?.summary)
          ? {
              analysis: nonEmptyString(specialist?.analysis) ?? nonEmptyString(specialist?.summary),
            }
          : {}),
      },
    ];
  });
}

function researchMemo(run: LooseObject): ResearchArticle["memo"] {
  const memo = object(run.memo);
  if (!memo) return undefined;
  const verdict = object(memo.verdict);
  const scenarios = object(memo.scenarios);
  const projected = {
    ...(nonEmptyString(memo.title) ? { title: nonEmptyString(memo.title) } : {}),
    ...(nonEmptyString(memo.executive_summary)
      ? { executiveSummary: nonEmptyString(memo.executive_summary) }
      : {}),
    ...(nonEmptyString(verdict?.status) || nonEmptyString(verdict?.disposition)
      ? { verdict: nonEmptyString(verdict?.status) ?? nonEmptyString(verdict?.disposition) }
      : {}),
    ...(nonEmptyString(verdict?.rationale)
      ? { rationale: nonEmptyString(verdict?.rationale) }
      : {}),
    ...(nonEmptyString(scenarios?.bull_case)
      ? { bullCase: nonEmptyString(scenarios?.bull_case) }
      : {}),
    ...(nonEmptyString(scenarios?.base_case)
      ? { baseCase: nonEmptyString(scenarios?.base_case) }
      : {}),
    ...(nonEmptyString(scenarios?.bear_case)
      ? { bearCase: nonEmptyString(scenarios?.bear_case) }
      : {}),
  };
  return Object.keys(projected).length ? projected : undefined;
}

function finalContent(run: LooseObject, result: LooseObject | undefined): string {
  const runStatus = status(run.status, "running");
  return (
    nonEmptyString(result?.briefing) ??
    nonEmptyString(object(run.preview)?.briefing) ??
    nonEmptyString(object(run.memo)?.executive_summary) ??
    nonEmptyString(object(run.conclusion)?.reason) ??
    nonEmptyString(run.error) ??
    (runStatus === "queued" || runStatus === "running"
      ? "Research is still running."
      : "Research finished without a displayable brief.")
  );
}

function articleId(run: LooseObject): string {
  const id = nonEmptyString(run.id) ?? "research";
  const revision =
    typeof run.revision === "number"
      ? String(run.revision)
      : (nonEmptyString(run.updated_at) ?? String(status(run.status, "running")));
  return `research-${id}-${revision}`.replace(/[^A-Za-z0-9._-]/g, "-");
}

export function researchArticleFromRun(runValue: unknown, ticker?: string): ResearchArticle {
  const run = object(runValue) ?? {};
  const result = object(run.latest_result);
  const content = finalContent(run, result);
  const interesting = stringArray(result?.interesting);
  const chartTickers = [
    ...(ticker ? [ticker] : []),
    ...tickerSymbols([content, ...interesting].join(" ")),
  ]
    .filter((symbol, index, all) => all.indexOf(symbol) === index)
    .slice(0, 4);
  const runStatus = status(run.status, "running");
  const evidence = researchEvidence(run);
  const context = researchContext(run);
  const specialists = researchSpecialists(run);
  const memo = researchMemo(run);
  const progress = researchProgress(run);
  const blocker = nonEmptyString(object(object(run.preview)?.blocker)?.reason);
  return {
    id: articleId(run),
    role: "assistant",
    content,
    createdAt:
      nonEmptyString(run.updated_at) ?? nonEmptyString(run.created_at) ?? new Date().toISOString(),
    interesting,
    ideas: ideas(result?.ideas),
    toolsUsed: tools(result, run),
    sources: sourceList(result?.data_sources_used),
    chartTickers,
    status: runStatus,
    ...(nonEmptyString(run.phase) ? { phase: nonEmptyString(run.phase) } : {}),
    ...(progress ? { progress } : {}),
    ...(evidence.length ? { evidence } : {}),
    ...(context.length ? { context } : {}),
    ...(blocker ? { blocker } : {}),
    ...(specialists.length ? { specialists } : {}),
    ...(memo ? { memo } : {}),
    mode: nonEmptyString(result?.mode) ?? "agent",
    ...(runStatus === "blocked" || runStatus === "error"
      ? { error: nonEmptyString(run.error) ?? runStatus }
      : {}),
  };
}

function messageArticle(value: unknown): ResearchArticle | undefined {
  const message = object(value);
  if (!message) return undefined;
  const role =
    message.role === "user"
      ? "user"
      : message.role === "agent" || message.role === "assistant"
        ? "assistant"
        : null;
  const rawContent = nonEmptyString(message.content);
  const content = rawContent && role === "user" ? userFacingPrompt(rawContent) : rawContent;
  if (!role || !content) return undefined;
  return {
    id: nonEmptyString(message.id) ?? `research-message-${crypto.randomUUID()}`,
    role,
    content,
    createdAt: nonEmptyString(message.created_at) ?? new Date().toISOString(),
    interesting: [],
    ideas: [],
    toolsUsed: [],
    sources: [],
    chartTickers: tickerSymbols(content).slice(0, 4),
  };
}

function conversationSourceUrl(conversation: ResearchConversation | undefined): string | undefined {
  if (!conversation?.href) return undefined;
  try {
    const origin = new URL(getDerivationOrigin());
    const url = new URL(conversation.href, origin);
    return url.origin === origin.origin ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function researchThreadFromRun(
  stored: StoredResearchConversation,
  runValue: unknown,
): AgentThreadSummary {
  const run = object(runValue) ?? {};
  const conversation = conversationFromPayload(runValue);
  const messages = (Array.isArray(run.messages) ? run.messages : [])
    .map(messageArticle)
    .filter((message): message is ResearchArticle => Boolean(message));
  const rawPrompt = nonEmptyString(run.prompt);
  const prompt = rawPrompt ? userFacingPrompt(rawPrompt) : undefined;
  if (
    prompt &&
    !messages.some((message) => message.role === "user" && message.content === prompt)
  ) {
    messages.unshift({
      id: `research-prompt-${stored.conversationId}`,
      role: "user",
      content: prompt,
      createdAt: nonEmptyString(run.created_at) ?? stored.createdAt,
      interesting: [],
      ideas: [],
      toolsUsed: [],
      sources: [],
      chartTickers: tickerSymbols(prompt).slice(0, 4),
    });
  }
  const finalArticle = researchArticleFromRun(run);
  let finalMessageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.content === finalArticle.content) {
      finalMessageIndex = index;
      break;
    }
  }
  if (finalMessageIndex >= 0) {
    messages[finalMessageIndex] = finalArticle;
  } else {
    messages.push(finalArticle);
  }
  const runStatus = status(run.status, status(stored.status));
  const sourceUrl = conversationSourceUrl(conversation);
  return {
    id: stored.conversationId,
    conversationId: stored.conversationId,
    title: stored.title,
    createdAt: nonEmptyString(run.created_at) ?? stored.createdAt,
    updatedAt: nonEmptyString(run.updated_at) ?? stored.updatedAt,
    preview: finalArticle.content.slice(0, 180),
    status: runStatus,
    ...(nonEmptyString(run.phase) ? { phase: nonEmptyString(run.phase) } : {}),
    ...(conversation?.pdf_url
      ? { memoUrl: `/v1/agent/threads/${encodeURIComponent(stored.conversationId)}/memo` }
      : {}),
    ...(conversation ? { conversation } : {}),
    messages,
    safety: { liveTradingForbidden: true, orderSubmissionAllowed: false },
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export function researchStatusFromRun(
  conversationId: string,
  runValue: unknown,
): AgentConversationStatus {
  const run = object(runValue) ?? {};
  const preview = object(run.preview);
  return {
    conversationId,
    status: status(run.status, "running"),
    ...(nonEmptyString(run.phase) ? { phase: nonEmptyString(run.phase) } : {}),
    ...(typeof run.active === "boolean" ? { active: run.active } : {}),
    ...(typeof run.completed_iterations === "number"
      ? { completedIterations: run.completed_iterations }
      : {}),
    ...(typeof run.max_iterations === "number" ? { maxIterations: run.max_iterations } : {}),
    ...(nonEmptyString(preview?.briefing) ? { preview: nonEmptyString(preview?.briefing) } : {}),
    ...(nonEmptyString(run.updated_at) ? { updatedAt: nonEmptyString(run.updated_at) } : {}),
  };
}

function pollIntervalMs(): number {
  const value = Number(process.env.DERIVATION_RESEARCH_POLL_INTERVAL_MS ?? 1_500);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 1_500;
}

function pollTimeoutMs(): number {
  const value = Number(process.env.DERIVATION_RESEARCH_POLL_TIMEOUT_MS ?? 180_000);
  return Number.isFinite(value) && value > 0 ? Math.max(100, Math.floor(value)) : 180_000;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("request aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("request aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (typeof timer.unref === "function") timer.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class ResearchConversationPendingError extends Error {
  readonly conversationId: string;
  readonly latest: DerivationAutoresearchResponse | undefined;

  constructor(conversationId: string, latest?: DerivationAutoresearchResponse) {
    super("Research conversation is still running");
    this.name = "ResearchConversationPendingError";
    this.conversationId = conversationId;
    this.latest = latest;
  }
}

function isTransientPollingError(error: unknown): boolean {
  if (error instanceof DerivationUpstreamError) {
    return error.status === 429 || error.status >= 500;
  }
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError" || error.name === "TypeError")
  );
}

export async function waitForResearchConversation(
  conversationId: string,
  options: Readonly<{
    signal?: AbortSignal;
    onProgress?: (status: AgentConversationStatus) => Promise<void> | void;
  }> = {},
): Promise<DerivationAutoresearchResponse> {
  const deadline = Date.now() + pollTimeoutMs();
  let latest: DerivationAutoresearchResponse | undefined;
  while (Date.now() <= deadline) {
    try {
      latest = await getDerivationAutoresearch(conversationId, "summary", {
        signal: options.signal,
      });
      await options.onProgress?.(researchStatusFromRun(conversationId, latest));
      if (isResearchConversationTerminal(latest.status)) {
        return await getDerivationAutoresearch(conversationId, "display", {
          signal: options.signal,
        });
      }
    } catch (error) {
      if (isTransientPollingError(error)) {
        throw new ResearchConversationPendingError(conversationId, latest);
      }
      throw error;
    }
    await delay(pollIntervalMs(), options.signal);
  }
  throw new ResearchConversationPendingError(conversationId, latest);
}
