import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentChatResponse, AgentThreadSummary } from "@mapvest/core";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";
process.env.DERIVATION_RESEARCH_API_ORIGIN = "https://console.example.test";
process.env.DERIVATION_RESEARCH_SERVICE_TOKEN = "test-console-service-token";
process.env.DERIVATION_RESEARCH_POLL_INTERVAL_MS = "1";
process.env.DERIVATION_RESEARCH_POLL_TIMEOUT_MS = "500";

import { app } from "../src/index.js";
import { __resetEntitlements } from "../src/lib/entitlements.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import {
  __resetResearchConversationStore,
  upsertResearchConversation,
} from "../src/lib/research-conversation-store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

const DEVICE_A = "device-agent-conversation-a";
const DEVICE_B = "device-agent-conversation-b";

type FetchCall = { url: string; init?: RequestInit };

function request(path: string, body?: unknown, deviceId = DEVICE_A) {
  return new Request(`http://localhost/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function conversation(id: string, status = "queued") {
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

function displayRun(id: string, briefing = "Evidence-backed research brief") {
  return {
    id,
    prompt: "Research the opportunity",
    status: "conclusive",
    phase: "complete",
    created_at: "2026-08-24T12:00:00.000Z",
    updated_at: "2026-08-24T12:01:00.000Z",
    max_iterations: 8,
    completed_iterations: 8,
    messages: [],
    events: [
      {
        seq: 1,
        id: "evt-1",
        at: "2026-08-24T12:00:30.000Z",
        type: "tool_completed",
        message: "SEC evidence gathered",
        data: { tool: "sec_search" },
      },
    ],
    latest_result: {
      mode: "agent",
      prompt: "Research the opportunity",
      briefing,
      interesting: ["Volatility is elevated"],
      ideas: [{ title: "Defined-risk structure", thesis: "Cap downside", findings: [] }],
      data_sources_used: [
        { provider: "sec", label: "SEC filing", url: "https://www.sec.gov/example" },
      ],
      trace: [{ tool: "sec_search", summary: "Reviewed filing", ok: true }],
      safety: { live_trading_forbidden: true, order_submission_allowed: false },
    },
    conversation: conversation(id, "conclusive"),
    active: false,
  };
}

function installSuccessfulConsole(
  id: string,
  calls: FetchCall[],
  options?: { campaignOnly?: boolean },
) {
  globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    if (url.endsWith("/api/explore")) {
      const ref = conversation(id);
      return Response.json(
        options?.campaignOnly
          ? { mode: "agent", campaign: ref }
          : { mode: "agent", conversation: ref },
        { status: 202 },
      );
    }
    if (url.includes("/api/autoresearch") && url.includes("summary=1")) {
      return Response.json({
        id,
        conversation_id: `conv_${id}`,
        status: "conclusive",
        phase: "complete",
        max_iterations: 8,
        completed_iterations: 8,
        active: false,
      });
    }
    if (url.includes("/api/autoresearch") && url.includes("display=1")) {
      return Response.json(displayRun(id));
    }
    return new Response(`unexpected fetch ${url}`, { status: 599 });
  }) as typeof fetch;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  __resetRateLimit();
  __resetMetrics();
  __resetEntitlements();
  __resetResearchConversationStore();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("unified research conversation routes", () => {
  test("starts one agent conversation and returns its completed display projection", async () => {
    const calls: FetchCall[] = [];
    installSuccessfulConsole("auto_new", calls);

    const res = await app.fetch(
      request("/agent/chat", {
        message: "Find unusual options opportunities with strong evidence",
        ticker: "MXL",
        clientMessageId: "client-message-new",
        researchDepth: "deep",
      }),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as AgentChatResponse;
    expect(json.conversationId).toBe("auto_new");
    expect(json.threadId).toBe("auto_new");
    expect(json.clientMessageId).toBe("client-message-new");
    expect(json.status).toBe("conclusive");
    expect(json.article.content).toBe("Evidence-backed research brief");
    expect(json.article.toolsUsed).toContain("sec_search");
    expect(json.article.sources[0]).toEqual({
      label: "SEC filing",
      url: "https://www.sec.gov/example",
    });

    const exploreCall = calls.find((call) => call.url.endsWith("/api/explore"));
    expect(exploreCall).toBeDefined();
    expect(JSON.parse(String(exploreCall?.init?.body))).toEqual({
      prompt:
        "Focus ticker: $MXL. Write like a short financial news brief when you conclude — lede first, then evidence. Research-only; no trades; no broker orders.\n\nUser: Find unusual options opportunities with strong evidence",
      mode: "agent",
      research_depth: "deep",
      client_message_id: "client-message-new",
    });
    expect(new Headers(exploreCall?.init?.headers).get("authorization")).toBe(
      "Bearer test-console-service-token",
    );
    expect(calls.some((call) => call.url.includes("summary=1"))).toBe(true);
    expect(calls.some((call) => call.url.includes("display=1"))).toBe(true);
    expect(calls.some((call) => call.url.includes("idea-chats"))).toBe(false);
    expect(calls.some((call) => call.url.includes("chat/completions"))).toBe(false);
  });

  test("continues an owned conversation with steer mode and the caller retry key", async () => {
    await upsertResearchConversation(`device:${DEVICE_A}`, {
      conversationId: "auto_existing",
      title: "Existing research",
      preview: "Running",
      status: "running",
    });
    const calls: FetchCall[] = [];
    installSuccessfulConsole("auto_existing", calls);

    const body = {
      message: "Challenge the volatility assumptions",
      conversationId: "auto_existing",
      clientMessageId: "stable-follow-up-id",
      researchDepth: "max",
    };
    const first = await app.fetch(request("/agent/chat", body));
    const retry = await app.fetch(request("/agent/chat", body));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    const exploreBodies = calls
      .filter((call) => call.url.endsWith("/api/explore"))
      .map((call) => JSON.parse(String(call.init?.body)));
    expect(exploreBodies).toHaveLength(2);
    expect(exploreBodies[0]).toMatchObject({
      conversation_id: "auto_existing",
      message_mode: "steer",
      client_message_id: "stable-follow-up-id",
      mode: "agent",
      research_depth: "max",
    });
    expect(exploreBodies[1]).toEqual(exploreBodies[0]);
  });

  test("accepts the legacy campaign response while keeping conversation terminology", async () => {
    const calls: FetchCall[] = [];
    installSuccessfulConsole("auto_legacy", calls, { campaignOnly: true });

    const res = await app.fetch(
      request("/agent/chat", {
        message: "Research legacy rollout",
        clientMessageId: "legacy-campaign-id",
        researchDepth: "auto",
      }),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as AgentChatResponse;
    expect(json.conversationId).toBe("auto_legacy");
    expect(json.conversation.id).toBe("auto_legacy");
    expect(JSON.stringify(json)).not.toContain("campaign dashboard");
  });

  test("denies a cross-owner follow-up before calling Console", async () => {
    await upsertResearchConversation(`device:${DEVICE_A}`, {
      conversationId: "auto_private",
      title: "Private research",
      preview: "Private",
      status: "running",
    });
    const calls: FetchCall[] = [];
    installSuccessfulConsole("auto_private", calls);

    const res = await app.fetch(
      request(
        "/agent/chat",
        {
          message: "Try to continue another device's research",
          conversationId: "auto_private",
          clientMessageId: "foreign-follow-up",
          researchDepth: "auto",
        },
        DEVICE_B,
      ),
    );

    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test("propagates iteration exhaustion without creating a replacement or fallback brief", async () => {
    await upsertResearchConversation(`device:${DEVICE_A}`, {
      conversationId: "auto_exhausted",
      title: "Exhausted research",
      preview: "At limit",
      status: "exhausted",
    });
    const calls: FetchCall[] = [];
    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      return Response.json(
        {
          mode: "blocked",
          error: "iteration_limit_exhausted",
          briefing: "This conversation cannot run more work.",
          conversation: conversation("auto_exhausted", "exhausted"),
        },
        { status: 409 },
      );
    }) as typeof fetch;

    const res = await app.fetch(
      request("/agent/chat", {
        message: "Do more work",
        conversationId: "auto_exhausted",
        clientMessageId: "exhausted-follow-up",
        researchDepth: "max",
      }),
    );

    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      code: string;
      conversationId: string;
    };
    expect(json.code).toBe("iteration_limit_exhausted");
    expect(json.conversationId).toBe("auto_exhausted");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/api/explore");
  });

  test("uses summary for lightweight recovery and display for the full owned thread", async () => {
    await upsertResearchConversation(`device:${DEVICE_A}`, {
      conversationId: "auto_recover",
      title: "Recovery research",
      preview: "Queued",
      status: "queued",
    });
    const calls: FetchCall[] = [];
    installSuccessfulConsole("auto_recover", calls);

    const statusRes = await app.fetch(request("/agent/threads/auto_recover/status"));
    expect(statusRes.status).toBe(200);
    expect(await statusRes.json()).toMatchObject({
      conversationId: "auto_recover",
      status: "conclusive",
      active: false,
    });

    const displayRes = await app.fetch(request("/agent/threads/auto_recover"));
    expect(displayRes.status).toBe(200);
    const display = (await displayRes.json()) as { thread: AgentThreadSummary };
    expect(display.thread.id).toBe("auto_recover");
    expect(display.thread.status).toBe("conclusive");
    expect(display.thread.messages.at(-1).content).toBe("Evidence-backed research brief");
    expect(calls.some((call) => call.url.includes("summary=1"))).toBe(true);
    expect(calls.some((call) => call.url.includes("display=1"))).toBe(true);
  });
});
