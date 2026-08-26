import { createHash } from "node:crypto";
import { AgentChatRequest, type User } from "@mapvest/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  DerivationConfigurationError,
  type DerivationConversation,
  type DerivationExploreRequest,
  DerivationUpstreamError,
  exploreDerivation,
  getDerivationAutoresearch,
  getDerivationResearchMemo,
} from "../lib/derivation.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { onAgentResponseReady } from "../lib/notifiers/agentNotifier.js";
import {
  ResearchConversationPendingError,
  buildResearchPrompt,
  conversationFromPayload,
  researchArticleFromRun,
  researchStatusFromRun,
  researchThreadFromRun,
  titleFromResearchPrompt,
  waitForResearchConversation,
} from "../lib/research-agent.js";
import {
  type ResearchConversation,
  ResearchConversationOwnershipError,
  claimResearchConversation,
  claimResearchConversations,
  getResearchConversation,
  listResearchConversations,
  updateResearchConversation,
  upsertResearchConversation,
} from "../lib/research-conversation-store.js";
import { createSseSession } from "../lib/sse-heartbeat.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import {
  deviceIdFromRequest,
  requireGenerationQuota,
} from "../middleware/requireGenerationQuota.js";

/**
 * Mapvest's owner-scoped proxy for the Derivation unified research conversation.
 * Browser and native clients keep their Mapvest auth/device identity; the
 * server-only Console service credential never crosses this boundary.
 */
const agent = new Hono();

type ParsedChatRequest = ReturnType<typeof AgentChatRequest.parse> & {
  ticker?: string;
};

type Admission = Readonly<{
  conversation: DerivationConversation;
  conversationId: string;
  clientMessageId: string;
  ownerKey: string;
  stored: ResearchConversation;
  ticker?: string;
  message: string;
}>;

class ResearchConversationNotFoundError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string) {
    super("Research conversation not found");
    this.name = "ResearchConversationNotFoundError";
    this.conversationId = conversationId;
  }
}

class InvalidResearchResponseError extends Error {
  constructor() {
    super("Research Console returned no conversation reference");
    this.name = "InvalidResearchResponseError";
  }
}

class ResearchTerminalError extends Error {
  readonly conversationId: string;
  readonly status: "blocked" | "error";
  readonly detail: string;

  constructor(conversationId: string, status: "blocked" | "error", detail: string) {
    super(detail);
    this.name = "ResearchTerminalError";
    this.conversationId = conversationId;
    this.status = status;
    this.detail = detail;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeTicker(value: string | undefined): string | undefined {
  const ticker = value?.trim().toUpperCase();
  return ticker && /^[A-Z][A-Z0-9.]{0,5}$/.test(ticker) ? ticker : undefined;
}

function parseChatRequest(value: unknown): ParsedChatRequest | null {
  const parsed = AgentChatRequest.safeParse(value);
  if (!parsed.success) return null;
  const ticker = normalizeTicker(parsed.data.ticker);
  if (parsed.data.ticker && !ticker) return null;
  return { ...parsed.data, ...(ticker ? { ticker } : {}) };
}

type OwnerContext = {
  req: { header: (name: string) => string | undefined };
  get: (key: string) => unknown;
};

type OwnerIdentity = Readonly<{
  ownerKey: string;
  deviceOwnerKey?: string;
}>;

function ownerIdentity(value: unknown): OwnerIdentity | undefined {
  const c = value as OwnerContext;
  const user = userFromContext(c);
  const deviceId = deviceIdFromRequest(c);
  if (user?.id) {
    return {
      ownerKey: `user:${user.id}`,
      ...(deviceId ? { deviceOwnerKey: `device:${deviceId}` } : {}),
    };
  }
  return deviceId ? { ownerKey: `device:${deviceId}` } : undefined;
}

function userFromContext(value: unknown): User | undefined {
  return (value as OwnerContext).get("user") as User | undefined;
}

function requestedConversationId(body: ParsedChatRequest): string | undefined {
  return body.conversationId ?? body.threadId;
}

async function ownedConversation(
  owner: OwnerIdentity,
  requestedId: string,
): Promise<ResearchConversation | null> {
  const ids = requestedId.startsWith("conv_")
    ? [requestedId, requestedId.slice("conv_".length)]
    : [requestedId];
  for (const conversationId of ids) {
    const direct = await getResearchConversation(owner.ownerKey, conversationId);
    if (direct) return direct;
  }
  if (!owner.deviceOwnerKey) return null;
  for (const conversationId of ids) {
    const claimed = await claimResearchConversation(
      owner.deviceOwnerKey,
      owner.ownerKey,
      conversationId,
    );
    if (claimed) return claimed;
  }
  return null;
}

function responseConversationId(value: unknown): string | undefined {
  return conversationFromPayload(value)?.id;
}

function upstreamClientMessageId(namespace: string, clientMessageId: string): string {
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(clientMessageId)
    .digest("hex");
  return `mapvest_${digest}`;
}

function normalizedConversationId(body: ParsedChatRequest): string | undefined {
  const conversationId = requestedConversationId(body);
  return conversationId?.startsWith("conv_")
    ? conversationId.slice("conv_".length)
    : conversationId;
}

function quotaRequestKey(body: ParsedChatRequest): string | undefined {
  if (!body.clientMessageId) return undefined;
  const digest = createHash("sha256")
    .update(normalizedConversationId(body) ?? "new")
    .update("\0")
    .update(body.clientMessageId)
    .digest("hex");
  return `agent_${digest}`;
}

async function admitResearch(body: ParsedChatRequest, owner: OwnerIdentity): Promise<Admission> {
  const requestedId = requestedConversationId(body);
  let continued: ResearchConversation | null = null;
  if (requestedId) {
    continued = await ownedConversation(owner, requestedId);
    if (!continued) throw new ResearchConversationNotFoundError(requestedId);
  }

  const clientMessageId = body.clientMessageId ?? `client_${crypto.randomUUID()}`;
  const prompt = buildResearchPrompt(body.message, body.ticker);
  const retryNamespace = continued
    ? `conversation:${continued.conversationId}`
    : (owner.deviceOwnerKey ?? owner.ownerKey);
  const base = {
    prompt,
    mode: "agent" as const,
    research_depth: body.researchDepth ?? "auto",
    client_message_id: upstreamClientMessageId(retryNamespace, clientMessageId),
  };
  const request: DerivationExploreRequest = continued
    ? {
        ...base,
        conversation_id: continued.conversationId,
        message_mode: "steer",
      }
    : base;
  const upstream = await exploreDerivation(request);
  const conversation = conversationFromPayload(upstream) as DerivationConversation | undefined;
  const conversationId = responseConversationId(upstream);
  if (!conversation || !conversationId) throw new InvalidResearchResponseError();

  // A new anonymous admission may be retried after sign-in before the caller
  // has a conversation id. Console returns the same idempotent conversation;
  // claim its device-owned reference before refreshing it under the user.
  if (!continued && owner.deviceOwnerKey) {
    await claimResearchConversation(owner.deviceOwnerKey, owner.ownerKey, conversationId);
  }

  const stored = await upsertResearchConversation(owner.ownerKey, {
    conversationId,
    title: continued?.title ?? titleFromResearchPrompt(body.message, body.ticker),
    preview: text(object(upstream)?.briefing)?.slice(0, 180) ?? body.message.slice(0, 180),
    status: conversation.status,
  });
  return {
    conversation,
    conversationId,
    clientMessageId,
    ownerKey: owner.ownerKey,
    stored,
    ticker: body.ticker,
    message: body.message,
  };
}

async function completeAdmission(
  admission: Admission,
  onProgress?: (status: ReturnType<typeof researchStatusFromRun>) => Promise<void> | void,
) {
  const run = await waitForResearchConversation(admission.conversationId, {
    onProgress: async (progress) => {
      await updateResearchConversation(admission.ownerKey, admission.conversationId, {
        status: progress.status,
        ...(progress.preview ? { preview: progress.preview.slice(0, 180) } : {}),
      });
      await onProgress?.(progress);
    },
  });
  const thread = researchThreadFromRun(admission.stored, run);
  const article = thread.messages?.filter((message) => message.role === "assistant").at(-1);
  if (!article) throw new InvalidResearchResponseError();
  await updateResearchConversation(admission.ownerKey, admission.conversationId, {
    status: thread.status,
    preview: article.content.slice(0, 180),
  });
  if (thread.status === "blocked" || thread.status === "error") {
    throw new ResearchTerminalError(
      admission.conversationId,
      thread.status,
      article.error ?? article.content,
    );
  }
  return { run, thread, article };
}

function userMessage(admission: Admission) {
  return {
    id: `user-${admission.clientMessageId}`,
    role: "user" as const,
    content: admission.message,
    createdAt: new Date().toISOString(),
    interesting: [],
    ideas: [],
    toolsUsed: [],
    sources: [],
    chartTickers: admission.ticker ? [admission.ticker] : [],
  };
}

function completedResponse(
  admission: Admission,
  completion: Awaited<ReturnType<typeof completeAdmission>>,
) {
  return {
    conversationId: admission.conversationId,
    threadId: admission.conversationId,
    clientMessageId: admission.clientMessageId,
    status: completion.thread.status,
    conversation: conversationFromPayload(completion.run) ?? admission.conversation,
    ticker: admission.ticker,
    article: completion.article,
    userMessage: userMessage(admission),
    safety: { liveTradingForbidden: true, orderSubmissionAllowed: false },
    provider: "derivation-research-console",
    sourceUrl: completion.thread.sourceUrl,
    memoUrl: completion.thread.memoUrl,
  };
}

function pendingResponse(admission: Admission, error: ResearchConversationPendingError) {
  const progress = researchStatusFromRun(admission.conversationId, error.latest);
  return {
    conversationId: admission.conversationId,
    threadId: admission.conversationId,
    clientMessageId: admission.clientMessageId,
    status: progress.status,
    conversation: admission.conversation,
    ticker: admission.ticker,
    article: researchArticleFromRun(error.latest, admission.ticker),
    userMessage: userMessage(admission),
    safety: { liveTradingForbidden: true, orderSubmissionAllowed: false },
    provider: "derivation-research-console",
    pending: true,
  };
}

function upstreamErrorStatus(value: number): 400 | 409 | 429 | 502 | 503 {
  if (value === 400 || value === 409 || value === 429 || value === 503) {
    return value;
  }
  // Console credentials, routing, and host attestation are server-to-server
  // concerns. They must not look like a caller authorization/not-found error.
  return 502;
}

function upstreamDiagnosticCode(upstream: Record<string, unknown> | undefined): string | undefined {
  const nestedError = object(upstream?.error);
  const candidate =
    text(nestedError?.code) ?? text(upstream?.code) ?? text(upstream?.error) ?? undefined;
  return candidate && /^[A-Za-z0-9_.-]{1,128}$/.test(candidate) ? candidate : undefined;
}

function upstreamErrorMessage(status: number): string {
  if (status === 400) return "Research service could not process this request";
  if (status === 409) return "This research conversation cannot accept more work";
  if (status === 429) return "Research service is busy; please try again shortly";
  return "Research service is temporarily unavailable";
}

function errorPayload(error: unknown) {
  if (error instanceof ResearchConversationNotFoundError) {
    return {
      status: 404 as const,
      body: {
        error: "research conversation not found",
        code: "research_conversation_not_found",
        conversationId: error.conversationId,
      },
    };
  }
  if (error instanceof ResearchConversationOwnershipError) {
    return {
      status: 404 as const,
      body: {
        error: "research conversation not found",
        code: "research_conversation_not_found",
        conversationId: error.conversationId,
      },
    };
  }
  if (error instanceof DerivationUpstreamError) {
    const upstream = object(error.body);
    const conversation = conversationFromPayload(upstream);
    const code = upstreamDiagnosticCode(upstream) ?? `research_upstream_${error.status}`;
    return {
      status: upstreamErrorStatus(error.status),
      body: {
        error: upstreamErrorMessage(error.status),
        code,
        ...(conversation?.id ? { conversationId: conversation.id } : {}),
        ...(conversation?.status ? { status: conversation.status } : {}),
        ...(conversation ? { conversation } : {}),
      },
    };
  }
  if (error instanceof ResearchTerminalError) {
    return {
      status: error.status === "blocked" ? (409 as const) : (502 as const),
      body: {
        error: error.detail,
        code: `research_${error.status}`,
        conversationId: error.conversationId,
        status: error.status,
      },
    };
  }
  if (error instanceof DerivationConfigurationError) {
    return {
      status: 503 as const,
      body: { error: "research service is not configured", code: "research_not_configured" },
    };
  }
  if (error instanceof InvalidResearchResponseError) {
    return {
      status: 502 as const,
      body: { error: error.message, code: "invalid_research_response" },
    };
  }
  return {
    status: 502 as const,
    body: {
      error: error instanceof Error ? error.message : "research service failed",
      code: "research_service_failed",
    },
  };
}

agent.get("/threads", optionalAuth, async (c) => {
  const owner = ownerIdentity(c);
  if (!owner) return c.json({ error: "X-Device-Id header required for anonymous requests" }, 400);
  if (owner.deviceOwnerKey) {
    await claimResearchConversations(owner.deviceOwnerKey, owner.ownerKey);
  }
  const stored = await listResearchConversations(owner.ownerKey);
  return c.json({
    threads: stored.map((conversation) => ({
      id: conversation.conversationId,
      conversationId: conversation.conversationId,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      preview: conversation.preview,
      status: conversation.status,
      safety: { liveTradingForbidden: true, orderSubmissionAllowed: false },
    })),
    count: stored.length,
  });
});

agent.get("/threads/:id/status", optionalAuth, async (c) => {
  const owner = ownerIdentity(c);
  if (!owner) return c.json({ error: "X-Device-Id header required for anonymous requests" }, 400);
  const stored = await ownedConversation(owner, c.req.param("id"));
  if (!stored) return c.json({ error: "research conversation not found" }, 404);
  try {
    const summary = await getDerivationAutoresearch(stored.conversationId, "summary");
    const progress = researchStatusFromRun(stored.conversationId, summary);
    await updateResearchConversation(owner.ownerKey, stored.conversationId, {
      status: progress.status,
      ...(progress.preview ? { preview: progress.preview.slice(0, 180) } : {}),
    });
    return c.json(progress);
  } catch (error) {
    const response = errorPayload(error);
    return c.json(response.body, response.status);
  }
});

agent.get("/threads/:id/memo", optionalAuth, async (c) => {
  const owner = ownerIdentity(c);
  if (!owner) return c.json({ error: "X-Device-Id header required for anonymous requests" }, 400);
  const stored = await ownedConversation(owner, c.req.param("id"));
  if (!stored) return c.json({ error: "research conversation not found" }, 404);
  try {
    const upstream = await getDerivationResearchMemo(stored.conversationId);
    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "application/pdf",
      "Cache-Control": "private, no-store",
    });
    const disposition = upstream.headers.get("content-disposition");
    const length = upstream.headers.get("content-length");
    if (disposition) headers.set("Content-Disposition", disposition);
    if (length) headers.set("Content-Length", length);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    const response = errorPayload(error);
    return c.json(response.body, response.status);
  }
});

agent.get("/threads/:id", optionalAuth, async (c) => {
  const owner = ownerIdentity(c);
  if (!owner) return c.json({ error: "X-Device-Id header required for anonymous requests" }, 400);
  const stored = await ownedConversation(owner, c.req.param("id"));
  if (!stored) return c.json({ error: "research conversation not found" }, 404);
  try {
    const run = await getDerivationAutoresearch(stored.conversationId, "display");
    const thread = researchThreadFromRun(stored, run);
    await updateResearchConversation(owner.ownerKey, stored.conversationId, {
      status: thread.status,
      preview: thread.preview,
    });
    return c.json({ thread });
  } catch (error) {
    const response = errorPayload(error);
    return c.json(response.body, response.status);
  }
});

const agentChatQuota = requireGenerationQuota("agent_chat", async (c) => {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = parseChatRequest(raw);
  return parsed ? quotaRequestKey(parsed) : undefined;
});

agent.post("/chat", optionalAuth, agentChatQuota, async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const body = parseChatRequest(raw);
  if (!body) return c.json({ error: "valid message required (1–4000 chars)" }, 400);
  const owner = ownerIdentity(c);
  if (!owner) return c.json({ error: "X-Device-Id header required for anonymous requests" }, 400);

  try {
    return await safeExecuteWithSpan("http.agent.chat", async (span) => {
      span.setAttributes({
        has_ticker: Boolean(body.ticker),
        ticker: body.ticker ?? "",
        continued: Boolean(requestedConversationId(body)),
      });
      const admission = await admitResearch(body, owner);
      span.setAttributes({
        conversation_id: admission.conversationId,
        client_message_id: admission.clientMessageId,
      });
      try {
        const completion = await completeAdmission(admission);
        const user = userFromContext(c);
        if (user?.id) {
          const title = completion.article.content.split(/\r?\n/, 1)[0]?.trim() || "Research ready";
          void onAgentResponseReady(user.id, admission.conversationId, title.slice(0, 160)).catch(
            () => {},
          );
        }
        return c.json(completedResponse(admission, completion));
      } catch (error) {
        if (error instanceof ResearchConversationPendingError) {
          return c.json(pendingResponse(admission, error), 202);
        }
        throw error;
      }
    });
  } catch (error) {
    const response = errorPayload(error);
    return c.json(response.body, response.status);
  }
});

agent.post("/stream", optionalAuth, agentChatQuota, async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const body = parseChatRequest(raw);
  if (!body) return c.json({ error: "valid message required (1–4000 chars)" }, 400);
  const owner = ownerIdentity(c);
  if (!owner) return c.json({ error: "X-Device-Id header required for anonymous requests" }, 400);

  let admission: Admission;
  try {
    admission = await admitResearch(body, owner);
  } catch (error) {
    const response = errorPayload(error);
    return c.json(response.body, response.status);
  }

  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache, no-transform");
  return streamSSE(c, async (sse) => {
    const session = createSseSession(sse);
    try {
      await session.write("reasoning", {
        text: "Research conversation accepted. Gathering evidence…",
        conversationId: admission.conversationId,
      });
      const completion = await completeAdmission(admission, async (progress) => {
        const detail = [progress.phase, progress.status].filter(Boolean).join(" · ");
        await session.write("reasoning", {
          text: detail || "Researching…",
          conversationId: admission.conversationId,
          progress,
        });
      });
      await session.write("article", completion.article);
      await session.write("done", {
        conversationId: admission.conversationId,
        threadId: admission.conversationId,
        clientMessageId: admission.clientMessageId,
        status: completion.thread.status,
      });
      const user = userFromContext(c);
      if (user?.id) {
        const title = completion.article.content.split(/\r?\n/, 1)[0]?.trim() || "Research ready";
        void onAgentResponseReady(user.id, admission.conversationId, title.slice(0, 160)).catch(
          () => {},
        );
      }
    } catch (error) {
      if (error instanceof ResearchConversationPendingError) {
        await session.write("done", {
          conversationId: admission.conversationId,
          threadId: admission.conversationId,
          clientMessageId: admission.clientMessageId,
          status: researchStatusFromRun(admission.conversationId, error.latest).status,
        });
      } else {
        const response = errorPayload(error);
        await session.write("error", {
          ...response.body,
          conversationId: admission.conversationId,
          clientMessageId: admission.clientMessageId,
        });
      }
    } finally {
      session.stop();
    }
  });
});

export default agent;
