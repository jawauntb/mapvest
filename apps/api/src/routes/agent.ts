import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  DERIVATION_URL,
  derivationMutateHeaders,
  derivationReadHeaders,
} from "../lib/derivation.js";
import { safeExecuteWithSpan } from "../lib/logfire.js";
import {
  friendlyResearchPreview,
  isMachineErrorText,
  openRouterResearchBrief,
} from "../lib/research-fallback.js";
import { onAgentResponseReady } from "../lib/notifiers/agentNotifier.js";
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
  const rawContent = (briefing || m.content || "").trim();
  const machine = Boolean(m.result?.error) || isMachineErrorText(rawContent);
  const content = machine ? friendlyResearchPreview() : rawContent;
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
  const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1);
  const rawPreview =
    lastAssistant?.content?.slice(0, 180) ?? messages.at(-1)?.content?.slice(0, 180) ?? "";
  const preview =
    lastAssistant?.error || isMachineErrorText(rawPreview)
      ? friendlyResearchPreview()
      : rawPreview;
  return {
    id: t.id,
    title: t.title && t.title !== "Idea chat" ? t.title : "Research",
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    messages,
    preview,
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
      try {
        const fallback = await openRouterResearchBrief(prompt);
        return c.json({
          threadId,
          ticker,
          article: {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: fallback,
            createdAt: new Date().toISOString(),
            interesting: [],
            ideas: [],
            toolsUsed: [],
            sources: [],
            chartTickers: tickersFromText(fallback).slice(0, 4),
          },
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
          safety: { liveTradingForbidden: true, orderSubmissionAllowed: false },
          provider: "openrouter",
          sourceUrl: `${DERIVATION_URL}/docs`,
        });
      } catch {
        const text = await res.text().catch(() => "");
        return c.json(
          { error: `derivation agent ${res.status}`, detail: text.slice(0, 300) },
          502,
        );
      }
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

    let content =
      latestBriefing ??
      texts
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(-2)
        .join("\n\n")
        .trim();

    let provider: "derivation-research-console" | "openrouter" = "derivation-research-console";
    if (!content || isMachineErrorText(content) || error) {
      try {
        content = await openRouterResearchBrief(prompt);
        error = undefined;
        provider = "openrouter";
        span.setAttribute("research_fallback", "openrouter");
      } catch (fallbackErr) {
        span.recordException(fallbackErr);
      }
    }

    if (!content || isMachineErrorText(content)) {
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

    // Fire-and-forget push (opted-in users only). Never blocks the response.
    const chatUser = (c as unknown as { get: (k: string) => { id?: string } | undefined }).get(
      "user",
    );
    if (chatUser?.id) {
      const title = content.split(/\r?\n/)[0]?.trim() || "Research ready";
      onAgentResponseReady(chatUser.id, resolvedThread, title.slice(0, 160)).catch(() => {});
    }

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
      provider,
      sourceUrl: `${DERIVATION_URL}/docs`,
    });
  });
});

/**
 * POST /v1/agent/stream
 * Same body as /v1/agent/chat, but the response is `text/event-stream`.
 *
 * Emits these named events, one JSON payload per event:
 *   tool       { name, arg? }        — a tool call started
 *   tool_end   { name, ok }          — a tool call finished
 *   reasoning  { text }              — short human-readable status
 *   token      { text }              — chunk of the streamed brief
 *   article    ResearchArticle       — final composed brief (same shape as /chat's `article`)
 *   done       { threadId? }         — stream complete
 *   error      { message }           — fatal error; stream will close after
 *
 * The upstream Derivation console already speaks SSE, so we forward its
 * events after translating them into our own event vocabulary. If upstream
 * fails to yield any streamed text (e.g. it only sends a final result blob),
 * we degrade gracefully by emitting one `token` event with the full body and
 * one `article` event so the UI still updates.
 */
agent.post("/stream", optionalAuth, requireGenerationQuota("agent_chat"), async (c) => {
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

  return streamSSE(c, async (sse) => {
    return safeExecuteWithSpan("http.agent.stream", async (span) => {
      span.setAttributes({ has_ticker: !!ticker, ticker: ticker ?? "", upstream: DERIVATION_URL });
      const started = performance.now();

      await sse.writeSSE({
        event: "reasoning",
        data: JSON.stringify({ text: "Contacting research agent…" }),
      });

      let upstream: Response;
      try {
        upstream = await fetch(`${DERIVATION_URL}/api/idea-chats/stream`, {
          method: "POST",
          headers: derivationMutateHeaders(),
          body: JSON.stringify({
            message: prompt,
            client_message_id: crypto.randomUUID(),
            ...(threadId ? { thread_id: threadId, threadId } : {}),
          }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (e) {
        await sse.writeSSE({
          event: "error",
          data: JSON.stringify({ message: (e as Error).message || "upstream failed" }),
        });
        return;
      }

      span.setAttributes({
        upstream_status: upstream.status,
        upstream_connect_ms: Math.round(performance.now() - started),
      });

      if (!upstream.ok || !upstream.body) {
        try {
          const fallback = await openRouterResearchBrief(prompt);
          await sse.writeSSE({
            event: "token",
            data: JSON.stringify({ text: fallback }),
          });
          await sse.writeSSE({
            event: "article",
            data: JSON.stringify({
              id: crypto.randomUUID(),
              role: "assistant",
              content: fallback,
              createdAt: new Date().toISOString(),
              interesting: [],
              ideas: [],
              toolsUsed: [],
              sources: [],
              chartTickers: [
                ...(ticker ? [ticker] : []),
                ...tickersFromText(fallback),
              ]
                .filter((t, i, a) => a.indexOf(t) === i)
                .slice(0, 4),
            }),
          });
          await sse.writeSSE({
            event: "done",
            data: JSON.stringify({ threadId }),
          });
          span.setAttribute("research_fallback", "openrouter");
          return;
        } catch {
          const text = await upstream.text().catch(() => "");
          await sse.writeSSE({
            event: "error",
            data: JSON.stringify({
              message: `derivation agent ${upstream.status}`,
              detail: text.slice(0, 300),
            }),
          });
          return;
        }
      }

      // Accumulators for building the final ResearchArticle.
      const texts: string[] = [];
      const tools: string[] = [];
      const openTools = new Set<string>();
      let resolvedThread = threadId;
      let latestBriefing: string | undefined;
      let interesting: string[] = [];
      let ideas: ReturnType<typeof normalizeMessage>["ideas"] = [];
      let sources: Array<{ label: string; url?: string }> = [];
      let mode: string | undefined;
      let error: string | undefined;
      let tokensStreamed = 0;

      // Manual SSE parser over the upstream ReadableStream so we can emit
      // events downstream as they arrive rather than waiting for res.text().
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buf = "";

      const handleBlock = async (rawBlock: string) => {
        const lines = rawBlock.split("\n").filter(Boolean);
        if (!lines.length) return;
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) return;
        let payload: {
          thread?: UpstreamThread;
          data?: { type?: string; text?: string; tool?: string; ok?: boolean; arg?: string; error?: string };
          latest_result?: UpstreamMsg["result"];
        };
        try {
          payload = JSON.parse(dataLines.join("\n"));
        } catch {
          return;
        }

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
        if (inner?.type === "error") {
          const code = inner.error || inner.text || "MODEL_BUDGET_EXHAUSTED";
          if (isMachineErrorText(code) || /budget/i.test(code)) error = code;
        }
        if (inner?.type === "tool_start" && typeof inner.tool === "string") {
          tools.push(inner.tool);
          openTools.add(inner.tool);
          await sse.writeSSE({
            event: "tool",
            data: JSON.stringify({ name: inner.tool, arg: inner.arg }),
          });
          await sse.writeSSE({
            event: "reasoning",
            data: JSON.stringify({ text: `Running ${inner.tool}…` }),
          });
        }
        if (inner?.type === "tool_end" && typeof inner.tool === "string") {
          openTools.delete(inner.tool);
          await sse.writeSSE({
            event: "tool_end",
            data: JSON.stringify({ name: inner.tool, ok: inner.ok !== false }),
          });
        }
        if (inner?.type === "model_text" && typeof inner.text === "string") {
          texts.push(inner.text);
          if (isMachineErrorText(inner.text)) {
            error = inner.text.trim();
            return;
          }
          const brief = extractBriefing(inner.text);
          if (brief) latestBriefing = brief;
          // Chunk into ~20-char slices so the client sees a smooth stream even
          // when upstream buffers into large paragraphs. If it's already short,
          // one event is fine.
          const chunkSize = 24;
          if (inner.text.length <= chunkSize) {
            tokensStreamed += 1;
            await sse.writeSSE({
              event: "token",
              data: JSON.stringify({ text: inner.text }),
            });
          } else {
            for (let i = 0; i < inner.text.length; i += chunkSize) {
              const slice = inner.text.slice(i, i + chunkSize);
              tokensStreamed += 1;
              await sse.writeSSE({
                event: "token",
                data: JSON.stringify({ text: slice }),
              });
              await sse.sleep(15);
            }
          }
        }
        if (payload.latest_result?.briefing) {
          latestBriefing = payload.latest_result.briefing;
          interesting = payload.latest_result.interesting ?? interesting;
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // Split on blank-line SSE boundaries; keep the trailing partial in buf.
          let idx = buf.indexOf("\n\n");
          while (idx !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            await handleBlock(block);
            idx = buf.indexOf("\n\n");
          }
        }
        // Flush any remaining buffered block.
        if (buf.trim()) await handleBlock(buf);
      } catch (e) {
        await sse.writeSSE({
          event: "error",
          data: JSON.stringify({ message: (e as Error).message || "stream read failed" }),
        });
        return;
      }

      let content =
        latestBriefing ??
        texts
          .map((t) => t.trim())
          .filter((t) => t && !isMachineErrorText(t))
          .slice(-2)
          .join("\n\n")
          .trim();

      if (!content || isMachineErrorText(content) || error) {
        try {
          content = await openRouterResearchBrief(prompt);
          error = undefined;
          tokensStreamed = 0;
          span.setAttribute("research_fallback", "openrouter");
        } catch (fallbackErr) {
          span.recordException(fallbackErr);
        }
      }

      if (!content || isMachineErrorText(content)) {
        await sse.writeSSE({
          event: "error",
          data: JSON.stringify({
            message: "agent returned no text",
            threadId: resolvedThread,
          }),
        });
        return;
      }

      // Graceful degradation: if upstream never yielded model_text chunks,
      // still feed the client a single token event so the draft area fills.
      if (tokensStreamed === 0) {
        await sse.writeSSE({
          event: "token",
          data: JSON.stringify({ text: content }),
        });
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

      await sse.writeSSE({
        event: "article",
        data: JSON.stringify(article),
      });

      // Fire-and-forget push for opted-in users. Never blocks the SSE stream.
      const streamUser = (
        c as unknown as { get: (k: string) => { id?: string } | undefined }
      ).get("user");
      if (streamUser?.id) {
        const title = content.split(/\r?\n/)[0]?.trim() || "Research ready";
        onAgentResponseReady(streamUser.id, resolvedThread, title.slice(0, 160)).catch(
          () => {},
        );
      }

      await sse.writeSSE({
        event: "done",
        data: JSON.stringify({ threadId: resolvedThread }),
      });

      span.setAttributes({
        stream_ms: Math.round(performance.now() - started),
        tools_seen: [...new Set(tools)].length,
        tokens_streamed: tokensStreamed,
      });
    });
  });
});

export default agent;
