import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";
process.env.DERIVATION_RESEARCH_API_ORIGIN = "https://console-stream.example.test";
process.env.DERIVATION_RESEARCH_SERVICE_TOKEN = "test-console-stream-token";
process.env.DERIVATION_RESEARCH_POLL_INTERVAL_MS = "1";
process.env.DERIVATION_RESEARCH_POLL_TIMEOUT_MS = "500";
process.env.SSE_HEARTBEAT_MS = "5";

import { app } from "../src/index.js";
import { __resetEntitlements } from "../src/lib/entitlements.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import {
  __resetResearchConversationStore,
  upsertResearchConversation,
} from "../src/lib/research-conversation-store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

const DEVICE_ID = "test-device-agent-stream";

function url(path: string) {
  return `http://localhost/v1${path}`;
}

function parseEvents(raw: string): Array<{ event: string; data: unknown }> {
  const out: Array<{ event: string; data: unknown }> = [];
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
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
      // Ignore malformed third-party frames; the route never emits them.
    }
  }
  return out;
}

function conversation(id: string, status: string) {
  return {
    schema_version: "research_conversation_ref_v1",
    id,
    conversation_id: `conv_${id}`,
    status,
    deliverable: "ideas",
    href: `/explore?conversation_id=conv_${id}`,
    stream_href: `/api/autoresearch/stream?id=${id}`,
    pdf_url: null,
  };
}

beforeEach(() => {
  __resetRateLimit();
  __resetMetrics();
  __resetEntitlements();
  __resetResearchConversationStore();
});

describe("POST /v1/agent/stream", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("streams durable progress, keepalives, the final article, and conversation identity", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    let summaryCalls = 0;
    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const upstreamUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      requests.push({
        url: upstreamUrl,
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      if (upstreamUrl.endsWith("/api/explore")) {
        return Response.json(
          { mode: "agent", conversation: conversation("auto_stream", "queued") },
          { status: 202 },
        );
      }
      if (upstreamUrl.includes("summary=1")) {
        summaryCalls += 1;
        if (summaryCalls === 1) {
          await Bun.sleep(25);
          return Response.json({
            id: "auto_stream",
            status: "running",
            phase: "evidence",
            completed_iterations: 2,
            max_iterations: 8,
            active: true,
          });
        }
        return Response.json({
          id: "auto_stream",
          status: "conclusive",
          phase: "complete",
          completed_iterations: 8,
          max_iterations: 8,
          active: false,
        });
      }
      if (upstreamUrl.includes("display=1")) {
        return Response.json({
          id: "auto_stream",
          prompt: "Research MXL",
          status: "conclusive",
          phase: "complete",
          created_at: "2026-08-24T12:00:00.000Z",
          updated_at: "2026-08-24T12:01:00.000Z",
          messages: [],
          events: [{ data: { tool: "sec_search" } }],
          latest_result: {
            mode: "agent",
            briefing: "MXL is a mixed-signal chipmaker with cited evidence.",
            interesting: [],
            ideas: [],
            data_sources_used: ["SEC"],
            trace: [{ tool: "sec_search", ok: true }],
          },
          conversation: conversation("auto_stream", "conclusive"),
        });
      }
      return new Response(`unexpected fetch ${upstreamUrl}`, { status: 599 });
    }) as typeof fetch;

    const res = await app.fetch(
      new Request(url("/agent/stream"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Device-Id": DEVICE_ID,
        },
        body: JSON.stringify({
          message: "Is it a good time to research MXL?",
          ticker: "MXL",
          clientMessageId: "stable-stream-message-id",
          researchDepth: "standard",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const events = parseEvents(await res.text());
    const names = events.map((event) => event.event);
    expect(names).toContain("ping");
    expect(names).toContain("reasoning");
    expect(names).toContain("article");
    expect(names).toContain("done");
    expect(names).not.toContain("error");
    const article = events.find((event) => event.event === "article")?.data as {
      content?: string;
      toolsUsed?: string[];
    };
    expect(article.content).toContain("mixed-signal");
    expect(article.toolsUsed).toContain("sec_search");
    expect(events.find((event) => event.event === "done")?.data).toMatchObject({
      conversationId: "auto_stream",
      threadId: "auto_stream",
      clientMessageId: "stable-stream-message-id",
      status: "conclusive",
    });
    expect(requests.find((item) => item.url.endsWith("/api/explore"))?.body).toMatchObject({
      mode: "agent",
      research_depth: "standard",
    });
    expect(
      (
        requests.find((item) => item.url.endsWith("/api/explore"))?.body as {
          client_message_id?: string;
        }
      )?.client_message_id,
    ).toMatch(/^mapvest_[a-f0-9]{64}$/);

    const recovery = await app.fetch(
      new Request(url("/agent/chat"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": DEVICE_ID,
        },
        body: JSON.stringify({
          message: "Is it a good time to research MXL?",
          ticker: "MXL",
          clientMessageId: "stable-stream-message-id",
          researchDepth: "standard",
        }),
      }),
    );
    expect(recovery.status).toBe(200);

    const quota = await app.fetch(
      new Request(url("/entitlements"), { headers: { "X-Device-Id": DEVICE_ID } }),
    );
    expect(await quota.json()).toMatchObject({ remaining: 49 });
  });

  test("returns a semantic 409 before opening SSE and never calls a fallback model", async () => {
    await upsertResearchConversation(`device:${DEVICE_ID}`, {
      conversationId: "auto_exhausted_stream",
      title: "Exhausted",
      preview: "At limit",
      status: "exhausted",
    });
    const urls: string[] = [];
    globalThis.fetch = (async (input: URL | Request | string) => {
      const upstreamUrl =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      urls.push(upstreamUrl);
      return Response.json(
        {
          mode: "blocked",
          error: "iteration_limit_exhausted",
          briefing: "This conversation cannot run more work.",
          conversation: conversation("auto_exhausted_stream", "exhausted"),
        },
        { status: 409 },
      );
    }) as typeof fetch;

    const res = await app.fetch(
      new Request(url("/agent/stream"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Device-Id": DEVICE_ID,
        },
        body: JSON.stringify({
          message: "Do more work",
          conversationId: "auto_exhausted_stream",
          clientMessageId: "stable-blocked-stream-id",
          researchDepth: "max",
        }),
      }),
    );

    expect(res.status).toBe(409);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    expect(await res.json()).toMatchObject({
      code: "iteration_limit_exhausted",
      conversationId: "auto_exhausted_stream",
    });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/api/explore");
    expect(urls.some((item) => item.includes("chat/completions"))).toBe(false);
  });
});
