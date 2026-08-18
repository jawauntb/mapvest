import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.SSE_HEARTBEAT_MS = "50";

import { app } from "../src/index.js";
import { __resetEntitlements } from "../src/lib/entitlements.js";
import { __resetMetrics } from "../src/lib/metrics.js";
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
      /* skip */
    }
  }
  return out;
}

beforeEach(() => {
  __resetRateLimit();
  __resetMetrics();
  __resetEntitlements();
});

describe("POST /v1/agent/stream", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("falls back to OpenRouter and still emits article + done when Derivation is blocked", async () => {
    globalThis.fetch = (async (input: URL | Request | string) => {
      const s =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (s.includes("/api/idea-chats/stream")) {
        return new Response("MODEL_BUDGET_EXHAUSTED", { status: 403 });
      }
      if (s.includes("/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "AAPL is a large-cap US technology company." } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(`unexpected fetch ${s}`, { status: 599 });
    }) as typeof fetch;

    const res = await app.fetch(
      new Request(url("/agent/stream"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Device-Id": DEVICE_ID,
        },
        body: JSON.stringify({ message: "one sentence on AAPL", ticker: "AAPL" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const raw = await res.text();
    const events = parseEvents(raw);
    const names = events.map((e) => e.event);
    expect(names).toContain("reasoning");
    expect(names).toContain("article");
    expect(names).toContain("done");
    expect(names).not.toContain("error");

    const article = events.find((e) => e.event === "article")?.data as { content?: string };
    expect(article?.content).toContain("AAPL");
  });

  test("forwards Derivation model_text into an article", async () => {
    const upstream = `data: ${JSON.stringify({ data: { type: "model_text", text: "MXL is a mixed-signal chipmaker." } })}\n\n`;
    globalThis.fetch = (async (input: URL | Request | string) => {
      const s =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (s.includes("/api/idea-chats/stream")) {
        return new Response(upstream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(`unexpected fetch ${s}`, { status: 599 });
    }) as typeof fetch;

    const res = await app.fetch(
      new Request(url("/agent/stream"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Device-Id": `${DEVICE_ID}-direct`,
        },
        body: JSON.stringify({ message: "Is it a good time to invest in MXL?", ticker: "SMXL" }),
      }),
    );

    expect(res.status).toBe(200);
    const events = parseEvents(await res.text());
    const article = events.find((e) => e.event === "article")?.data as { content?: string };
    expect(article?.content).toContain("mixed-signal");
    expect(events.some((e) => e.event === "done")).toBe(true);
  });

  test("keeps pinging while OpenRouter fallback is in flight", async () => {
    globalThis.fetch = (async (input: URL | Request | string) => {
      const s =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (s.includes("/api/idea-chats/stream")) {
        return new Response("blocked", { status: 503 });
      }
      if (s.includes("/chat/completions")) {
        await Bun.sleep(160);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Fallback brief for SMXL." } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(`unexpected fetch ${s}`, { status: 599 });
    }) as typeof fetch;

    const res = await app.fetch(
      new Request(url("/agent/stream"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-Device-Id": `${DEVICE_ID}-ping`,
        },
        body: JSON.stringify({ message: "ping check", ticker: "SMXL" }),
      }),
    );

    const events = parseEvents(await res.text());
    expect(events.some((e) => e.event === "ping")).toBe(true);
    expect(events.some((e) => e.event === "article")).toBe(true);
  });
});
