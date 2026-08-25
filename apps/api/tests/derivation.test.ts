import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DerivationConfigurationError,
  type DerivationExploreRequest,
  DerivationUpstreamError,
  exploreDerivation,
  getDerivationAutoresearch,
  normalizeDerivationResponse,
} from "../src/lib/derivation.js";

const CONFIG_KEYS = [
  "DERIVATION_RESEARCH_API_ORIGIN",
  "DERIVATION_URL",
  "DERIVATION_RESEARCH_SERVICE_TOKEN",
  "RESEARCH_CONSOLE_SERVICE_TOKEN_MUTATE",
  "RESEARCH_CONSOLE_SERVICE_TOKEN_READ",
  "RESEARCH_CONSOLE_FORWARDED_HOST",
] as const;

const originalConfig = Object.fromEntries(CONFIG_KEYS.map((key) => [key, process.env[key]]));

function unsetConfig(key: (typeof CONFIG_KEYS)[number]): void {
  Reflect.deleteProperty(process.env, key);
}

type FetchCall = {
  url: string;
  init: RequestInit | undefined;
};

function mockFetch(response: unknown, status = 202) {
  const calls: FetchCall[] = [];
  const fetcher = (async (input: URL | Request | string, init?: RequestInit) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      init,
    });
    return Response.json(response, { status });
  }) as typeof fetch;
  return { calls, fetcher };
}

beforeEach(() => {
  for (const key of CONFIG_KEYS) unsetConfig(key);
  process.env.DERIVATION_RESEARCH_API_ORIGIN = "https://console.example.test///";
  process.env.DERIVATION_RESEARCH_SERVICE_TOKEN = "primary-service-token";
  process.env.RESEARCH_CONSOLE_FORWARDED_HOST = "research.example.test";
});

afterEach(() => {
  for (const key of CONFIG_KEYS) {
    const value = originalConfig[key];
    if (value === undefined) unsetConfig(key);
    else process.env[key] = value;
  }
});

describe("Derivation Research Console boundary", () => {
  test("starts an agent conversation at the configured explore URL with server auth", async () => {
    const canonical = {
      schema_version: "research_conversation_ref_v1" as const,
      id: "auto_new",
      conversation_id: "conv_auto_new",
      status: "queued" as const,
      deliverable: "ideas" as const,
      href: "/explore?conversation_id=conv_auto_new",
      stream_href: "/api/autoresearch/stream?id=auto_new",
      pdf_url: null,
    };
    const { calls, fetcher } = mockFetch({ mode: "agent", conversation: canonical });
    const request: DerivationExploreRequest = {
      prompt: "Find unusual options opportunities with strong evidence",
      mode: "agent",
      research_depth: "auto",
      client_message_id: "message-new-1",
    };

    const result = await exploreDerivation(request, { fetch: fetcher });

    expect(result.conversation).toEqual(canonical);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://console.example.test/api/explore");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(request);
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer primary-service-token");
    expect(headers.get("x-research-console-forwarded-host")).toBe("research.example.test");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("origin")).toBe("https://research.example.test");
  });

  test("continues the same conversation with steer mode", async () => {
    const { calls, fetcher } = mockFetch({
      conversation: {
        id: "auto_existing",
        status: "running",
        deliverable: "ideas",
        href: "/explore?conversation_id=conv_auto_existing",
        pdf_url: null,
      },
    });
    const request: DerivationExploreRequest = {
      prompt: "Challenge the volatility assumptions",
      mode: "agent",
      research_depth: "deep",
      client_message_id: "message-follow-up-2",
      conversation_id: "conv_auto_existing",
      message_mode: "steer",
    };

    await exploreDerivation(request, { fetch: fetcher });

    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(request);
  });

  test("reuses the caller's stable client_message_id for retries", async () => {
    const { calls, fetcher } = mockFetch({ conversation: { id: "auto_retry" } });
    const request: DerivationExploreRequest = {
      prompt: "Retry this timed-out user message",
      mode: "agent",
      research_depth: "standard",
      client_message_id: "stable-retry-id",
    };

    await exploreDerivation(request, { fetch: fetcher });
    await exploreDerivation(request, { fetch: fetcher });

    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[0]?.init?.body)).client_message_id).toBe("stable-retry-id");
    expect(calls[1]?.init?.body).toBe(calls[0]?.init?.body);
  });

  test("builds exact summary and display recovery URLs", async () => {
    const { calls, fetcher } = mockFetch({ conversation_id: "conv_auto_poll" }, 200);

    await getDerivationAutoresearch("conv_auto_poll", "summary", { fetch: fetcher });
    await getDerivationAutoresearch("conv_auto_poll", "display", { fetch: fetcher });

    expect(calls.map((call) => call.url)).toEqual([
      "https://console.example.test/api/autoresearch?conversation_id=conv_auto_poll&summary=1",
      "https://console.example.test/api/autoresearch?conversation_id=conv_auto_poll&display=1",
    ]);
    expect(calls.every((call) => call.init?.method === "GET")).toBe(true);
  });

  test("prefers the canonical conversation over the legacy campaign", () => {
    const canonical = {
      id: "auto_canonical",
      status: "running" as const,
      deliverable: "memo" as const,
      href: "/explore?conversation_id=conv_auto_canonical",
      pdf_url: "/api/autoresearch/auto_canonical/pdf",
    };
    const legacy = {
      id: "auto_legacy",
      status: "queued" as const,
      deliverable: "ideas" as const,
      href: "/research/auto_legacy",
      pdf_url: null,
    };

    const normalized = normalizeDerivationResponse({ conversation: canonical, campaign: legacy });

    expect(normalized.conversation).toBe(canonical);
    expect(normalized.conversation).not.toBe(legacy);
  });

  test("falls back to campaign without inventing conversation fields", () => {
    const campaign = {
      id: "auto_legacy",
      status: "blocked" as const,
      deliverable: "memo" as const,
      href: "/research/auto_legacy",
      pdf_url: "/api/autoresearch/auto_legacy/pdf",
    };

    const normalized = normalizeDerivationResponse({ campaign });

    expect(normalized.conversation).toBe(campaign);
    expect(normalized.conversation).toEqual(campaign);
    expect("schema_version" in normalized.conversation!).toBe(false);
    expect("stream_href" in normalized.conversation!).toBe(false);
  });

  test("supports the legacy origin and service-token aliases", async () => {
    unsetConfig("DERIVATION_RESEARCH_API_ORIGIN");
    unsetConfig("DERIVATION_RESEARCH_SERVICE_TOKEN");
    process.env.DERIVATION_URL = "https://legacy-console.example.test/";
    process.env.RESEARCH_CONSOLE_SERVICE_TOKEN_MUTATE = "legacy-mutate-token";
    process.env.RESEARCH_CONSOLE_SERVICE_TOKEN_READ = "legacy-read-token";
    const { calls, fetcher } = mockFetch({ conversation: { id: "auto_legacy_config" } });

    await exploreDerivation(
      {
        prompt: "Use legacy configuration",
        mode: "agent",
        research_depth: "instant",
        client_message_id: "legacy-config-id",
      },
      { fetch: fetcher },
    );

    expect(calls[0]?.url).toBe("https://legacy-console.example.test/api/explore");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer legacy-mutate-token",
    );

    unsetConfig("RESEARCH_CONSOLE_SERVICE_TOKEN_MUTATE");
    await exploreDerivation(
      {
        prompt: "Use final read-token alias",
        mode: "agent",
        research_depth: "instant",
        client_message_id: "legacy-read-id",
      },
      { fetch: fetcher },
    );
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe(
      "Bearer legacy-read-token",
    );
  });

  test("fails before fetch when required server configuration is missing", async () => {
    unsetConfig("DERIVATION_RESEARCH_API_ORIGIN");
    unsetConfig("DERIVATION_URL");
    const { calls, fetcher } = mockFetch({});

    expect(
      exploreDerivation(
        {
          prompt: "No configured origin",
          mode: "agent",
          research_depth: "auto",
          client_message_id: "missing-config-id",
        },
        { fetch: fetcher },
      ),
    ).rejects.toBeInstanceOf(DerivationConfigurationError);
    expect(calls).toHaveLength(0);
  });

  test("propagates 409 status and body without a fallback", async () => {
    const body = {
      mode: "blocked",
      error: "iteration_limit_exhausted",
      conversation: {
        id: "auto_exhausted",
        status: "exhausted",
        deliverable: "ideas",
        href: "/explore?conversation_id=conv_auto_exhausted",
        pdf_url: null,
      },
    };
    const { fetcher } = mockFetch(body, 409);

    try {
      await exploreDerivation(
        {
          prompt: "Continue exhausted work",
          mode: "agent",
          research_depth: "max",
          client_message_id: "conflict-id",
          conversation_id: "conv_auto_exhausted",
          message_mode: "steer",
        },
        { fetch: fetcher },
      );
      throw new Error("expected DerivationUpstreamError");
    } catch (error) {
      expect(error).toBeInstanceOf(DerivationUpstreamError);
      expect((error as DerivationUpstreamError).status).toBe(409);
      expect((error as DerivationUpstreamError).body).toEqual(body);
    }
  });
});
