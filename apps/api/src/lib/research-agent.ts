import type {
  AgentConversationStatus,
  AgentThreadSummary,
  ResearchArticle,
  ResearchConversation,
  ResearchConversationStatus,
} from "@mapvest/core";
import {
  type DerivationAutoresearchResponse,
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

export function buildResearchPrompt(message: string, ticker?: string): string {
  const instruction =
    "Write like a short financial news brief when you conclude — lede first, then evidence. Research-only; no trades; no broker orders.";
  return ticker
    ? `Focus ticker: $${ticker}. ${instruction}\n\nUser: ${message}`
    : `${instruction}\n\nUser: ${message}`;
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
    const url = nonEmptyString(source.url);
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

function finalContent(run: LooseObject, result: LooseObject | undefined): string {
  return (
    nonEmptyString(result?.briefing) ??
    nonEmptyString(object(run.preview)?.briefing) ??
    nonEmptyString(object(run.memo)?.executive_summary) ??
    nonEmptyString(object(run.conclusion)?.reason) ??
    nonEmptyString(run.error) ??
    "Research finished without a displayable brief."
  );
}

function articleId(run: LooseObject): string {
  const id = nonEmptyString(run.id) ?? "research";
  const revision =
    typeof run.revision === "number"
      ? String(run.revision)
      : (nonEmptyString(run.updated_at) ?? String(status(run.status)));
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
  const runStatus = status(run.status);
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
    mode: nonEmptyString(result?.mode) ?? "agent",
    ...(runStatus === "blocked" || runStatus === "error"
      ? { error: nonEmptyString(run.error) ?? runStatus }
      : {}),
  };
}

function messageArticle(value: unknown): ResearchArticle | undefined {
  const message = object(value);
  if (!message) return undefined;
  const role = message.role === "user" ? "user" : message.role === "agent" ? "assistant" : null;
  const content = nonEmptyString(message.content);
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
    return new URL(conversation.href, `${getDerivationOrigin()}/`).toString();
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
  const prompt = nonEmptyString(run.prompt);
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
  if (
    !messages.some(
      (message) => message.role === "assistant" && message.content === finalArticle.content,
    )
  ) {
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
    ...(conversation?.pdf_url ? { memoUrl: conversation.pdf_url } : {}),
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
    status: status(run.status),
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
    latest = await getDerivationAutoresearch(conversationId, "summary", {
      signal: options.signal,
    });
    await options.onProgress?.(researchStatusFromRun(conversationId, latest));
    if (isResearchConversationTerminal(latest.status)) {
      return getDerivationAutoresearch(conversationId, "display", { signal: options.signal });
    }
    await delay(pollIntervalMs(), options.signal);
  }
  throw new ResearchConversationPendingError(conversationId, latest);
}
