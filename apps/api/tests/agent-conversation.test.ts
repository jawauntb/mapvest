import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentChatResponse, AgentThreadSummary } from "@mapvest/core";
import { sign } from "hono/jwt";

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
import { __resetStore } from "../src/lib/store.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";

const DEVICE_A = "device-agent-conversation-a";
const DEVICE_B = "device-agent-conversation-b";
const originalForwardedHost = process.env.RESEARCH_CONSOLE_FORWARDED_HOST;

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

async function signedRequest(path: string, deviceId = DEVICE_A, body?: unknown) {
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(
    {
      purpose: "session",
      sub: "user-research-claim",
      email: "research-claim@mapvest.dev",
      iat: now,
      exp: now + 3600,
    },
    process.env.SESSION_SIGNING_KEY ?? "",
  );
  return new Request(`http://localhost/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Device-Id": deviceId,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function conversation(id: string, status = "queued", pdfUrl: string | null = null) {
  return {
    schema_version: "research_conversation_ref_v1",
    id,
    conversation_id: `conv_${id}`,
    status,
    deliverable: "ideas",
    href: `/explore?conversation_id=conv_${id}`,
    stream_href: `/api/autoresearch/stream?id=${id}`,
    pdf_url: pdfUrl,
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
    research_plan: { tasks: [{ id: "task-1" }, { id: "task-2" }, { id: "task-3" }] },
    task_runs: [
      { id: "task-1", status: "completed", result: { summary: "done" } },
      { id: "task-2", status: "failed" },
      { id: "task-3", status: "skipped" },
    ],
    evidence_gate: {
      ready: true,
      essential_claims_ready: 2,
      essential_claims_total: 2,
    },
    preview: {
      briefing,
      facts: [
        {
          summary: "Revenue accelerated in the latest filing.",
          source: "sec",
          freshness_verdict: "fresh",
          artifact_refs: ["https://www.sec.gov/example"],
        },
      ],
      context: [{ summary: "Peers rerated higher.", reason: "Sector demand", source: "massive" }],
      blocker: null,
    },
    specialist_runs: [
      { role: "falsifier", status: "complete", analysis: "The thesis survives the base case." },
    ],
    messages: [
      {
        id: "message-user-1",
        role: "user",
        content:
          "Write like a short financial news brief when you conclude — lede first, then evidence.\n\nUser: Research the opportunity",
        created_at: "2026-08-24T12:00:00.000Z",
      },
      {
        id: "message-assistant-1",
        role: "assistant",
        content: briefing,
        created_at: "2026-08-24T12:01:00.000Z",
      },
    ],
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
    memo: {
      title: "Research memo",
      executive_summary: "Evidence supports a measured opportunity.",
      verdict: { status: "watch", rationale: "Wait for confirmation." },
      scenarios: { bull_case: "Upside", base_case: "Steady", bear_case: "Demand fades" },
    },
    conversation: conversation(id, "conclusive", `/api/autoresearch/${id}/pdf`),
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
    if (url.endsWith(`/api/autoresearch/${id}/pdf`)) {
      return new Response("pdf-data", {
        headers: { "Content-Type": "application/pdf", "Content-Length": "8" },
      });
    }
    return new Response(`unexpected fetch ${url}`, { status: 599 });
  }) as typeof fetch;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.RESEARCH_CONSOLE_FORWARDED_HOST = undefined;
  __resetRateLimit();
  __resetMetrics();
  __resetEntitlements();
  __resetStore();
  __resetResearchConversationStore();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalForwardedHost === undefined) process.env.RESEARCH_CONSOLE_FORWARDED_HOST = undefined;
  else process.env.RESEARCH_CONSOLE_FORWARDED_HOST = originalForwardedHost;
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
    expect(json.article.progress).toMatchObject({
      completedIterations: 8,
      maxIterations: 8,
      completedTasks: 3,
      totalTasks: 3,
      evidenceReady: true,
    });
    expect(json.article.evidence?.[0]).toMatchObject({
      summary: "Revenue accelerated in the latest filing.",
      source: "sec",
      freshness: "fresh",
    });
    expect(json.article.specialists?.[0]).toMatchObject({ role: "falsifier", status: "complete" });
    expect(json.article.memo?.executiveSummary).toContain("measured opportunity");
    expect(json.memoUrl).toBe("/v1/agent/threads/auto_new/memo");

    const exploreCall = calls.find((call) => call.url.endsWith("/api/explore"));
    expect(exploreCall).toBeDefined();
    const exploreBody = JSON.parse(String(exploreCall?.init?.body)) as Record<string, unknown>;
    expect(exploreBody).toMatchObject({
      prompt:
        "Focus ticker: $MXL. Write like a short financial news brief when you conclude — lede first, then evidence. Research-only; no trades; no broker orders.\n\nUser: Find unusual options opportunities with strong evidence",
      mode: "agent",
      research_depth: "deep",
    });
    expect(exploreBody.client_message_id).toMatch(/^mapvest_[a-f0-9]{64}$/);
    expect(exploreBody.client_message_id).not.toBe("client-message-new");
    expect(new Headers(exploreCall?.init?.headers).get("authorization")).toBe(
      "Bearer test-console-service-token",
    );
    expect(new Headers(exploreCall?.init?.headers).get("x-forwarded-proto")).toBeNull();
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
      mode: "agent",
      research_depth: "max",
    });
    expect(exploreBodies[0]?.client_message_id).toMatch(/^mapvest_[a-f0-9]{64}$/);
    expect(exploreBodies[1]).toEqual(exploreBodies[0]);

    const quota = await app.fetch(request("/entitlements"));
    expect(await quota.json()).toMatchObject({ remaining: 49 });
  });

  test("meters the same client retry id separately in different conversations", async () => {
    for (const conversationId of ["auto_scope_one", "auto_scope_two"]) {
      await upsertResearchConversation(`device:${DEVICE_A}`, {
        conversationId,
        title: conversationId,
        preview: "Running",
        status: "running",
      });
    }
    const upstreamKeys: string[] = [];
    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/explore")) {
        const body = JSON.parse(String(init?.body)) as {
          conversation_id: string;
          client_message_id: string;
        };
        upstreamKeys.push(body.client_message_id);
        return Response.json(
          { mode: "agent", conversation: conversation(body.conversation_id) },
          { status: 202 },
        );
      }
      const id = new URL(url).searchParams.get("conversation_id") ?? "auto_scope_one";
      if (url.includes("summary=1")) {
        return Response.json({ id, status: "conclusive", phase: "complete" });
      }
      if (url.includes("display=1")) return Response.json(displayRun(id));
      return new Response(`unexpected fetch ${url}`, { status: 599 });
    }) as typeof fetch;

    const message = "Use the same local retry id without sharing quota";
    const clientMessageId = "same-id-different-conversations";
    const first = await app.fetch(
      request("/agent/chat", { message, conversationId: "auto_scope_one", clientMessageId }),
    );
    const second = await app.fetch(
      request("/agent/chat", { message, conversationId: "auto_scope_two", clientMessageId }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(upstreamKeys).toHaveLength(2);
    expect(upstreamKeys[0]).not.toBe(upstreamKeys[1]);
    const quota = await app.fetch(request("/entitlements"));
    expect(await quota.json()).toMatchObject({ remaining: 48 });
  });

  test("keeps a new admission idempotent when its device signs in before retrying", async () => {
    const calls: FetchCall[] = [];
    installSuccessfulConsole("auto_login_retry", calls);
    const retryBody = {
      message: "Research through an auth transition",
      clientMessageId: "login-transition-retry",
    };

    const anonymous = await app.fetch(request("/agent/chat", retryBody));
    const signedRetry = await app.fetch(await signedRequest("/agent/chat", DEVICE_A, retryBody));
    const distinctSigned = await app.fetch(
      await signedRequest("/agent/chat", DEVICE_A, {
        message: "A separate signed-in request",
        clientMessageId: "login-transition-distinct",
      }),
    );

    expect(anonymous.status).toBe(200);
    expect(signedRetry.status).toBe(200);
    expect(distinctSigned.status).toBe(200);
    const upstreamKeys = calls
      .filter((call) => call.url.endsWith("/api/explore"))
      .map(
        (call) =>
          (JSON.parse(String(call.init?.body)) as { client_message_id: string }).client_message_id,
      );
    expect(upstreamKeys[0]).toBe(upstreamKeys[1]);
    expect(upstreamKeys[2]).not.toBe(upstreamKeys[1]);

    const quota = await app.fetch(await signedRequest("/entitlements"));
    expect(await quota.json()).toMatchObject({ remaining: 49 });
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
  });

  test("namespaces retry keys so separate Mapvest owners cannot share an upstream admission", async () => {
    const calls: FetchCall[] = [];
    let admissions = 0;
    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      if (url.endsWith("/api/explore")) {
        admissions += 1;
        return Response.json(
          { mode: "agent", conversation: conversation(`auto_owner_${admissions}`) },
          { status: 202 },
        );
      }
      const id = new URL(url).searchParams.get("conversation_id") ?? "auto_owner_1";
      if (url.includes("summary=1")) {
        return Response.json({ id, status: "conclusive", phase: "complete" });
      }
      if (url.includes("display=1")) return Response.json(displayRun(id));
      return new Response(`unexpected fetch ${url}`, { status: 599 });
    }) as typeof fetch;

    const body = { message: "Research this", clientMessageId: "same-client-retry-key" };
    const first = await app.fetch(request("/agent/chat", body, DEVICE_A));
    const second = await app.fetch(request("/agent/chat", body, DEVICE_B));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const upstreamKeys = calls
      .filter((call) => call.url.endsWith("/api/explore"))
      .map(
        (call) =>
          (JSON.parse(String(call.init?.body)) as { client_message_id: string }).client_message_id,
      );
    expect(upstreamKeys).toHaveLength(2);
    expect(upstreamKeys[0]).not.toBe(upstreamKeys[1]);
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

  test("claims the current device conversation when that device signs in", async () => {
    await upsertResearchConversation(`device:${DEVICE_A}`, {
      conversationId: "auto_anonymous",
      title: "Anonymous research",
      preview: "Queued",
      status: "queued",
    });
    const calls: FetchCall[] = [];
    installSuccessfulConsole("auto_anonymous", calls);

    const signedIn = await app.fetch(await signedRequest("/agent/threads/auto_anonymous"));
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toMatchObject({
      thread: { conversationId: "auto_anonymous" },
    });

    const anonymousAgain = await app.fetch(request("/agent/threads/auto_anonymous"));
    expect(anonymousAgain.status).toBe(404);
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
    const quota = await app.fetch(request("/entitlements"));
    expect(await quota.json()).toMatchObject({ remaining: 50 });
  });

  test("maps plain and nested Console 403s to a safe gateway response without burning quota", async () => {
    const upstreamFailures = [
      { label: "plain", body: { error: "REQUEST_HOST_INVALID" } },
      { label: "nested", body: { error: { code: "REQUEST_HOST_INVALID" } } },
    ];

    for (const [index, failure] of upstreamFailures.entries()) {
      globalThis.fetch = (async () => Response.json(failure.body, { status: 403 })) as typeof fetch;

      const deviceId = `${DEVICE_A}-${index}`;
      const res = await app.fetch(
        request(
          "/agent/chat",
          {
            message: `Research the ${failure.label} upstream failure`,
            clientMessageId: `host-invalid-${failure.label}`,
          },
          deviceId,
        ),
      );

      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({
        error: "Research service is temporarily unavailable",
        code: "REQUEST_HOST_INVALID",
      });

      const quota = await app.fetch(request("/entitlements", undefined, deviceId));
      expect(quota.status).toBe(200);
      expect(await quota.json()).toMatchObject({ remaining: 50 });
    }
  });

  test("maps an upstream 404 to a safe gateway response", async () => {
    globalThis.fetch = (async () =>
      Response.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 })) as typeof fetch;

    const res = await app.fetch(
      request(
        "/agent/chat",
        {
          message: "Research through a missing Console endpoint",
          clientMessageId: "missing-console-endpoint",
        },
        DEVICE_A,
      ),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "Research service is temporarily unavailable",
      code: "CONVERSATION_NOT_FOUND",
    });
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
    expect(display.thread.messages[0]?.content).toBe("Research the opportunity");
    expect(display.thread.memoUrl).toBe("/v1/agent/threads/auto_recover/memo");
    expect(calls.some((call) => call.url.includes("summary=1"))).toBe(true);
    expect(calls.some((call) => call.url.includes("display=1"))).toBe(true);

    const memoRes = await app.fetch(request("/agent/threads/auto_recover/memo"));
    expect(memoRes.status).toBe(200);
    expect(memoRes.headers.get("content-type")).toBe("application/pdf");
    expect(await memoRes.text()).toBe("pdf-data");
  });

  test("returns a recoverable accepted response when polling fails after admission", async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      if (url.endsWith("/api/explore")) {
        return Response.json(
          { mode: "agent", conversation: conversation("auto_recoverable") },
          { status: 202 },
        );
      }
      return Response.json({ error: "temporarily unavailable" }, { status: 503 });
    }) as typeof fetch;

    const res = await app.fetch(
      request("/agent/chat", {
        message: "Run durable research",
        clientMessageId: "recover-after-poll-failure",
      }),
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      conversationId: "auto_recoverable",
      clientMessageId: "recover-after-poll-failure",
      pending: true,
      article: { content: "Research is still running.", status: "running" },
    });
  });
});
