import { describe, expect, test } from "bun:test";
import { derivationAuthorizationHeaders } from "../src/lib/derivation.js";

describe("Derivation Console request headers", () => {
  test("does not attest direct canonical Railway requests as a Cloudflare worker", () => {
    const headers = new Headers(
      derivationAuthorizationHeaders("test-console-service-token", {
        DERIVATION_RESEARCH_API_ORIGIN:
          "https://derivation-research-console-production.up.railway.app",
      }),
    );

    expect(headers.get("authorization")).toBe("Bearer test-console-service-token");
    expect(headers.get("x-research-console-forwarded-host")).toBeNull();
    expect(headers.get("x-forwarded-proto")).toBeNull();
    expect(headers.get("origin")).toBeNull();
  });

  test("preserves proxy attestation when its forwarded host is explicitly configured", () => {
    const headers = new Headers(
      derivationAuthorizationHeaders("test-console-service-token", {
        RESEARCH_CONSOLE_FORWARDED_HOST: " research-console.example.test ",
      }),
    );

    expect(headers.get("x-research-console-forwarded-host")).toBe("research-console.example.test");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("origin")).toBe("https://research-console.example.test");
  });
});
