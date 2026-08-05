import { Hono } from "hono";
import {
  DERIVATION_URL,
  derivationMutateHeaders,
  derivationReadHeaders,
} from "../lib/derivation.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import { optionalAuth } from "../middleware/optionalAuth.js";
import { requireGenerationQuota } from "../middleware/requireGenerationQuota.js";

/**
 * Finance research agent — thin proxy to Derivation Research Console idea-chats.
 * Product IA: context-bound from ticker detail; history under Saved → Briefs.
 * Never expose Factory/Experiments/Jobs UI. Broker orders permanently off upstream.
 *
 * Upstream requires Cloudflare front-door host attestation + service tokens
 * (see option_derivation research-console request-guard).
 */

const agent = new Hono();

type UpstreamMsg = {
  id?: string;
  role?: string;
  content?: string;
  created_at?: string;
  result?: {
    briefing?: string;
    interesting?: string[];
    ideas?: Array<{
      title?: string;
      thesis?: string;
      why?: string;
      disposition?: string;
      findings?: string[];
    }>;
    data_sources_used?: unknown[];
    trace?: Array<{ tool?: string; summary?: string; ok?: boolean }>;
    mode?: string;
    error?: string;
  };
};

type UpstreamThread = {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  messages?: UpstreamMsg[];
  latest_result?: UpstreamMsg["result"];
  safety?: {
    live_trading_forbidden?: boolean;
    order_submission_allowed?: boolean;
  };
};

function tickersFromText(text: string): string[] {
  const out: string[] = [];
  const re = /\$([A-Z][A-Z0-9.]{0,5})\b|\b([A-Z]{1,5})\b/g;
  let m: RegExpExecArray | null;
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
  while ((m = re.exec(text))) {
    const sym = (m[1] ?? m[2] ?? "").toUpperCase();
    if (!sym || stop.has(sym) || out.includes(sym)) continue;
    if (sym.length >= 1 && sym.length <= 5) out.push(sym);
    if (out.length >= 6) break;
  }
  return out;
}

function normalizeMessage(m: UpstreamMsg) {
  const briefing = m.result?.briefing?.trim();
  const content = (briefing || m.content || "").trim();
  const interesting = Array.isArray(m.result?.interesting)
    ? m.result!.interesting!.filter((x): x is string => typeof x === "string")
    : [];
  const ideas = Array.isArray(m.result?.ideas)
    ? m.result!.ideas!.map((i) => ({
        title: i.title ?? "Idea",
        thesis: i.thesis ?? i.why ?? "",
        disposition: i.disposition,
        findings: i.findings ?? [],
      }))
    : [];
  const toolsUsed = (m.result?.trace ?? [])
    .map((t) => t.tool)
    .filter((t): t is string => typeof t === "string");
  const sources = (m.result?.data_sources_used ?? [])
    .map((s) => {
      if (typeof s === "string") return { label: s };
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        return {
          label: String(o.label ?? o.name ?? o.provider ?? "source"),
          url: typeof o.url === "string" ? o.url : undefined,
        };
      }
      return null;
    })
    .filter(Boolean) as Array<{ label: string; url?: string }>;

  const chartTickers = tickersFromText(
    [content, ...interesting, ...ideas.map((i) => `${i.title} ${i.thesis}`)].join(" "),
  );

  return {
    id: m.id ?? crypto.randomUUID(),
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content,
    createdAt: m.created_at ?? new Date().toISOString(),
    interesting,
    ideas,
    toolsUsed: [...new Set(toolsUsed)],
    sources,
    chartTickers,
    mode: m.result?.mode,
    error: m.result?.error,
  };
}

function normalizeThread(t: UpstreamThread) {
  const messages = (t.messages ?? []).map(normalizeMessage);
  return {
    id: t.id,
    title: t.title ?? "Research",
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    messages,
    preview:
      messages
        .filter((m) => m.role === "assistant")
        .at(-1)
        ?.content?.slice(0, 180) ??
      messages.at(-1)?.content?.slice(0, 180) ??
      "",
    safety: {
      liveTradingForbidden: t.safety?.live_trading_forbidden ?? true,
      orderSubmissionAllowed: t.safety?.order_submission_allowed ?? false,
    },
    sourceUrl: `${DERIVATION_URL}/docs`,
  };
}

function parseSseBlocks(raw: string): Array<{ event: string; data: unknown }> {
  const out: Array<{ event: string; data: unknown }> = [];
  for (const block of raw.split("\n\n")) {
    const lines = block.split("\n").filter(Boolean);
    if (!lines.length) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    try {
      out.push({ event, data: JSON.parse(dataLines.join("\n")) });
    } catch {
      /* skip */
    }
  }
  return out;
}

function extractBriefing(text: string): string | undefined {
  const fence = text.match(/```json\s*([\s\S]*?)```/i);
  if (!fence) return undefined;
  try {
    const j = JSON.parse(fence[1]) as { briefing?: string };
    if (typeof j.briefing === "string" && j.briefing.trim()) return j.briefing.trim();
  } catch {
    /* ignore */
  }
  return undefined;
}

/** GET /v1/agent/threads — persisted research briefs */
agent.get("/threads", async (c) => {
  return safeExecuteWithSpan("http.agent.threads", async (span) => {
    span.setAttributes({ upstream: DERIVATION_URL });
    const res = await fetch(`${DERIVATION_URL}/api/idea-chats`, {
      headers: derivationReadHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json({ error: `derivation threads ${res.status}`, detail: text.slice(0, 300) }, 502);
    }
    const j = (await res.json()) as { threads?: UpstreamThread[]; count?: number };
    const threads = (j.threads ?? []).map(normalizeThread);
    return c.json({ threads, count: j.count ?? threads.length, sourceUrl: `${DERIVATION_URL}/docs` });
  });
});

/** GET /v1/agent/threads/:id */
agent.get("/threads/:id", async (c) => {
  return safeExecuteWithSpan("http.agent.thread", async (span) => {
    const id = c.req.param("id");
    span.setAttributes({ thread_id: id });
    const res = await fetch(`${DERIVATION_URL}/api/idea-chats`, {
      headers: derivationReadHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return c.json({ error: `derivation threads ${res.status}` }, 502);
    }
    const j = (await res.json()) as { threads?: UpstreamThread[] };
    const t = (j.threads ?? []).find((x) => x.id === id);
    if (!t) return c.json({ error: "thread not found" }, 404);
    return c.json({ thread: normalizeThread(t) });
  });
});

/**
 * POST /v1/agent/chat
 * Body: { message, ticker?, threadId? }
 * Aggregates Derivation SSE into one ResearchArticle-shaped assistant turn.
 */
agent.post("/chat", optionalAuth, requireGenerationQuota("agent_chat"), async (c) => {
  return safeExecuteWithSpan("http.agent.chat", async (span) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      message?: unknown;
      ticker?: unknown;
      threadId?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 4000) {
      return c.json({ error: "message required (1–4000 chars)" }, 400);
    }
    const ticker =
      typeof body.ticker === "string" && /^[A-Z][A-Z0-9.]{0,5}$/i.test(body.ticker.trim())
        ? body.ticker.trim().toUpperCase()
        : undefined;
    const threadId = typeof body.threadId === "string" ? body.threadId : undefined;

    const prompt = ticker
      ? `Focus ticker: $${ticker}. Write like a short financial news brief when you conclude — lede first, then evidence. Research-only; no trades; no broker orders.\n\nUser: ${message}`
      : `Write like a short financial news brief when you conclude — lede first, then evidence. Research-only; no trades; no broker orders.\n\nUser: ${message}`;

    span.setAttributes({ has_ticker: !!ticker, ticker: ticker ?? "", upstream: DERIVATION_URL });

    const started = performance.now();
    const res = await fetch(`${DERIVATION_URL}/api/idea-chats/stream`, {
      method: "POST",
      headers: derivationMutateHeaders(),
      body: JSON.stringify({
        message: prompt,
        client_message_id: crypto.randomUUID(),
        ...(threadId ? { thread_id: threadId, threadId } : {}),
      }),
      signal: AbortSignal.timeout(90_000),
    });
    span.setAttributes({
      upstream_status: res.status,
      upstream_latency_ms: Math.round(performance.now() - started),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return c.json(
        { error: `derivation agent ${res.status}`, detail: text.slice(0, 300) },
        502,
      );
    }

    const raw = await res.text();
    const blocks = parseSseBlocks(raw);
    const texts: string[] = [];
    const tools: string[] = [];
    let resolvedThread = threadId;
    let latestBriefing: string | undefined;
    let interesting: string[] = [];
    let ideas: ReturnType<typeof normalizeMessage>["ideas"] = [];
    let sources: Array<{ label: string; url?: string }> = [];
    let mode: string | undefined;
    let error: string | undefined;

    for (const b of blocks) {
      const payload = b.data as {
        thread?: UpstreamThread;
        data?: { type?: string; text?: string; tool?: string };
        latest_result?: UpstreamMsg["result"];
      };
      if (payload.thread?.id) {
        resolvedThread = payload.thread.id;
        if (payload.thread.latest_result || payload.thread.messages?.length) {
          const norm = normalizeThread(payload.thread);
          const last = norm.messages.filter((m) => m.role === "assistant").at(-1);
          if (last?.content) latestBriefing = last.content;
          if (last?.interesting.length) interesting = last.interesting;
          if (last?.ideas.length) ideas = last.ideas;
          if (last?.sources.length) sources = last.sources;
          if (last?.toolsUsed.length) tools.push(...last.toolsUsed);
          mode = last?.mode;
          error = last?.error;
        }
      }
      const inner = payload.data;
      if (inner?.type === "model_text" && typeof inner.text === "string") {
        texts.push(inner.text);
        const brief = extractBriefing(inner.text);
        if (brief) latestBriefing = brief;
      }
      if (inner?.type === "tool_start" && typeof inner.tool === "string") {
        tools.push(inner.tool);
      }
      if (payload.latest_result?.briefing) {
        latestBriefing = payload.latest_result.briefing;
        interesting = payload.latest_result.interesting ?? interesting;
      }
    }

    const content =
      latestBriefing ??
      texts
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(-2)
        .join("\n\n")
        .trim();

    if (!content) {
      return c.json(
        {
          error: "agent returned no text",
          threadId: resolvedThread,
          toolsUsed: [...new Set(tools)],
        },
        502,
      );
    }

    const chartTickers = [
      ...(ticker ? [ticker] : []),
      ...tickersFromText(content),
    ].filter((t, i, a) => a.indexOf(t) === i);

    const article = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content,
      createdAt: new Date().toISOString(),
      interesting,
      ideas,
      toolsUsed: [...new Set(tools)],
      sources,
      chartTickers: chartTickers.slice(0, 4),
      mode,
      error,
    };

    return c.json({
      threadId: resolvedThread,
      ticker,
      article,
      userMessage: {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: message,
        createdAt: new Date().toISOString(),
        interesting: [],
        ideas: [],
        toolsUsed: [],
        sources: [],
        chartTickers: ticker ? [ticker] : [],
      },
      safety: {
        liveTradingForbidden: true,
        orderSubmissionAllowed: false,
      },
      provider: "derivation-research-console",
      sourceUrl: `${DERIVATION_URL}/docs`,
    });
  });
});

export default agent;
