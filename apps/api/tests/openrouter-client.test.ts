import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  OpenRouterConfigError,
  callOpenRouterCascade,
  stripToJsonObject,
} from "../src/lib/openrouter-client.js";

/**
 * Shared OpenRouter cascade client. Every test mocks `globalThis.fetch` —
 * no network, no real OPENROUTER_API_KEY needed.
 */

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
const originalBase = process.env.OPENROUTER_BASE_URL;

type FetchCall = { url: string; body: unknown; headers: Record<string, string> };

function stubFetch(calls: FetchCall[], handler: (call: FetchCall) => Response): void {
  globalThis.fetch = (async (input: URL | Request | string, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: FetchCall = { url, body, headers: (init?.headers as Record<string, string>) ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

function chatCompletion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  // biome-ignore lint/performance/noDelete: `= undefined` stores the string "undefined" on Bun >= 1.4 — delete is the only way to unset
  delete process.env.OPENROUTER_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) {
    // biome-ignore lint/performance/noDelete: `= undefined` stores the string "undefined" on Bun >= 1.4 — delete is the only way to unset
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = originalKey;
  }
  if (originalBase === undefined) {
    // biome-ignore lint/performance/noDelete: `= undefined` stores the string "undefined" on Bun >= 1.4 — delete is the only way to unset
    delete process.env.OPENROUTER_BASE_URL;
  } else {
    process.env.OPENROUTER_BASE_URL = originalBase;
  }
});

describe("stripToJsonObject", () => {
  test("passes clean JSON through unchanged", () => {
    expect(stripToJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  test("strips a ```json fence", () => {
    expect(stripToJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("drops surrounding prose", () => {
    expect(stripToJsonObject('Here you go:\n{"a":1}\nHope that helps!')).toBe('{"a":1}');
  });
});

describe("callOpenRouterCascade", () => {
  test("fails with OpenRouterConfigError when the key is unset", async () => {
    // biome-ignore lint/performance/noDelete: `= undefined` stores the string "undefined" on Bun >= 1.4 — delete is the only way to unset
    delete process.env.OPENROUTER_API_KEY;
    const calls: FetchCall[] = [];
    stubFetch(calls, () => chatCompletion("{}"));
    await expect(
      callOpenRouterCascade({
        models: ["m1"],
        systemPrompt: "sys",
        userContent: "user",
        parse: (raw) => raw,
        logPrefix: "[test]",
      }),
    ).rejects.toBeInstanceOf(OpenRouterConfigError);
    expect(calls).toHaveLength(0);
  });

  test("sends the documented auth header and body on the primary model", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => chatCompletion(JSON.stringify({ ok: true })));
    const result = await callOpenRouterCascade({
      models: ["primary-model"],
      systemPrompt: "system prompt",
      userContent: "user content",
      temperature: 0.5,
      parse: (raw) => JSON.parse(stripToJsonObject(raw)) as { ok: boolean },
      logPrefix: "[test]",
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0]?.headers.Authorization).toBe("Bearer test-openrouter-key");
    expect(calls[0]?.body).toMatchObject({
      model: "primary-model",
      temperature: 0.5,
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user content" },
      ],
    });
  });

  test("falls through to the next model when the primary returns non-2xx", async () => {
    const calls: FetchCall[] = [];
    let n = 0;
    stubFetch(calls, () => {
      n++;
      if (n === 1) return new Response("boom", { status: 500 });
      return chatCompletion(JSON.stringify({ ok: true, model: n }));
    });
    const result = await callOpenRouterCascade({
      models: ["primary", "fallback"],
      systemPrompt: "sys",
      userContent: "user",
      parse: (raw) => JSON.parse(stripToJsonObject(raw)) as { ok: boolean },
      logPrefix: "[test]",
    });
    expect(result).toEqual({ ok: true, model: 2 });
    expect(calls).toHaveLength(2);
    expect((calls[1]?.body as { model: string }).model).toBe("fallback");
  });

  test("falls through when a model's output fails the caller's parse function", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => chatCompletion(JSON.stringify({ headline: "" })));
    let attempt = 0;
    const parse = (raw: string) => {
      attempt++;
      const parsed = JSON.parse(stripToJsonObject(raw)) as { headline?: string };
      if (attempt === 1) throw new Error("bad shape from first model");
      return parsed;
    };
    // Both models return the same unparseable body — this asserts the
    // fallthrough happens (attempt increments per model), not full recovery.
    await expect(
      callOpenRouterCascade({
        models: ["m1", "m2"],
        systemPrompt: "sys",
        userContent: "user",
        parse,
        logPrefix: "[test]",
      }),
    ).resolves.toEqual({ headline: "" });
    expect(attempt).toBe(2);
  });

  test("throws the last error when every model in the cascade fails", async () => {
    const calls: FetchCall[] = [];
    stubFetch(calls, () => new Response("nope", { status: 503 }));
    await expect(
      callOpenRouterCascade({
        models: ["m1", "m2", "m3"],
        systemPrompt: "sys",
        userContent: "user",
        parse: (raw) => raw,
        logPrefix: "[test]",
      }),
    ).rejects.toThrow(/m3 503/);
    expect(calls).toHaveLength(3);
  });

  test("uses OPENROUTER_BASE_URL when set", async () => {
    process.env.OPENROUTER_BASE_URL = "https://proxy.example.test/v1";
    const calls: FetchCall[] = [];
    stubFetch(calls, () => chatCompletion(JSON.stringify({ ok: true })));
    await callOpenRouterCascade({
      models: ["m1"],
      systemPrompt: "sys",
      userContent: "user",
      parse: (raw) => JSON.parse(stripToJsonObject(raw)),
      logPrefix: "[test]",
    });
    expect(calls[0]?.url).toBe("https://proxy.example.test/v1/chat/completions");
  });
});
