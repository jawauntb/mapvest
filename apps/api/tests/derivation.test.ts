import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { exploreDerivation } from "../src/lib/derivation.js";

const DERIVATION_ENV_KEYS = [
  "DERIVATION_RESEARCH_API_ORIGIN",
  "DERIVATION_URL",
  "DERIVATION_RESEARCH_SERVICE_TOKEN",
  "RESEARCH_CONSOLE_SERVICE_TOKEN_MUTATE",
  "RESEARCH_CONSOLE_FORWARDED_HOST",
] as const;

const originalEnvironment = Object.fromEntries(
  DERIVATION_ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof DERIVATION_ENV_KEYS)[number], string | undefined>;

function restoreEnvironment() {
  for (const key of DERIVATION_ENV_KEYS) {
    const value = originalEnvironment[key];
    if (value === undefined) process.env[key] = undefined;
    else process.env[key] = value;
  }
}

function configureConsole(origin: string) {
  process.env.DERIVATION_RESEARCH_API_ORIGIN = origin;
  process.env.DERIVATION_RESEARCH_SERVICE_TOKEN = "test-console-service-token";
  process.env.DERIVATION_URL = undefined;
  process.env.RESEARCH_CONSOLE_SERVICE_TOKEN_MUTATE = undefined;
  process.env.RESEARCH_CONSOLE_FORWARDED_HOST = undefined;
}

async function exploreWithHeaders(): Promise<Headers> {
  let received: HeadersInit | undefined;
  await exploreDerivation(
    {
      prompt: "Research MXL",
      mode: "agent",
      research_depth: "auto",
      client_message_id: "test-client-message",
    },
    {
      fetch: async (_url, init) => {
        received = init?.headers;
        return Response.json({ conversation: { id: "research-1" } }, { status: 202 });
      },
    },
  );
  return new Headers(received);
}

beforeEach(restoreEnvironment);
afterEach(restoreEnvironment);

describe("Derivation Console request headers", () => {
  test("does not attest direct canonical Railway requests as a Cloudflare worker", async () => {
    configureConsole("https://derivation-research-console-production.up.railway.app");

    const headers = await exploreWithHeaders();

    expect(headers.get("authorization")).toBe("Bearer test-console-service-token");
    expect(headers.get("x-research-console-forwarded-host")).toBeNull();
    expect(headers.get("x-forwarded-proto")).toBeNull();
    expect(headers.get("origin")).toBeNull();
  });

  test("preserves proxy attestation when its forwarded host is explicitly configured", async () => {
    configureConsole("https://console-proxy.example.test");
    process.env.RESEARCH_CONSOLE_FORWARDED_HOST = "research-console.example.test";

    const headers = await exploreWithHeaders();

    expect(headers.get("x-research-console-forwarded-host")).toBe("research-console.example.test");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("origin")).toBe("https://research-console.example.test");
  });
});
