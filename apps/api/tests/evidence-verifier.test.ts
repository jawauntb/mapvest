import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ClaimCheck } from "@mapvest/finance";
import {
  CLAIM_INSTRUCTIONS,
  CLAIM_MIN_YES_DEFAULT,
  claimCheckEnabled,
  claimMinYes,
  jevClaimVerifier,
  verdictFromYes,
} from "../src/lib/evidence-verifier.js";

/**
 * Jev as the outside check on a finance agent's claim. Every test mocks `globalThis.fetch`: no network, no real
 * JEV_API_KEY. The contract: it can only call a claim unsupported when Jev is confident; every other path (no key,
 * kill switch, HTTP error, timeout-shaped failure, a middling answer) leaves the claim "unknown", which keeps it.
 */

const originalFetch = globalThis.fetch;
const KEYS = ["JEV_API_KEY", "JEV_CLAIM_CHECK", "JEV_CLAIM_MIN"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.JEV_API_KEY = "test-jev";
  Reflect.deleteProperty(process.env, "JEV_CLAIM_CHECK");
  Reflect.deleteProperty(process.env, "JEV_CLAIM_MIN");
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const k of KEYS) {
    if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = saved[k];
  }
});

const claim = (id: string): ClaimCheck => ({
  id,
  statement: `${id} supplies components or services to NVDA.`,
  evidence: {
    title: "10-K",
    url: "https://example.com/secret-path?token=abc",
    snippet: `Snippet for ${id} that is long enough to be checked against a statement.`,
  },
});

type Seen = { state: unknown; questions: Record<string, { type: string; instructions: string }> };
/** Jev answers the noul question with `yes(id)` per claim, decided from the statement in the state. */
function stubJev(yes: (statement: string) => number | "http500", seen: Seen[] = []): Seen[] {
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Seen;
    seen.push(body);
    const v = yes((body.state as { statement: string }).statement);
    if (v === "http500") return new Response("boom", { status: 500 });
    return new Response(
      JSON.stringify({
        answers: { q: { type: "noul", noul: v } },
        usage: { input_tokens: 10, output_tokens: 1 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return seen;
}

describe("verdictFromYes", () => {
  test("below the threshold is unsupported, at or above 0.5 supported, between is unknown", () => {
    expect(verdictFromYes(0.01)).toBe("unsupported");
    expect(verdictFromYes(CLAIM_MIN_YES_DEFAULT - 0.001)).toBe("unsupported");
    expect(verdictFromYes(CLAIM_MIN_YES_DEFAULT)).toBe("unknown");
    expect(verdictFromYes(0.4)).toBe("unknown");
    expect(verdictFromYes(0.5)).toBe("supported");
    expect(verdictFromYes(0.99)).toBe("supported");
    expect(verdictFromYes(Number.NaN)).toBe("unknown");
    expect(verdictFromYes(0.3, 0.35)).toBe("unsupported");
  });

  test("the threshold and the kill switch come from env, and a bad value falls back", () => {
    expect(claimMinYes({})).toBe(CLAIM_MIN_YES_DEFAULT);
    expect(claimMinYes({ JEV_CLAIM_MIN: "0.3" })).toBe(0.3);
    expect(CLAIM_MIN_YES_DEFAULT).toBe(0.1);
    for (const bad of ["abc", "-1", "0.9", "", "NaN"])
      expect(claimMinYes({ JEV_CLAIM_MIN: bad })).toBe(CLAIM_MIN_YES_DEFAULT);
    expect(claimCheckEnabled({})).toBe(true);
    expect(claimCheckEnabled({ JEV_CLAIM_CHECK: "off" })).toBe(false);
  });
});

describe("jevClaimVerifier", () => {
  test("a claim Jev is confident is unsupported is called so; the rest are supported or unknown", async () => {
    stubJev((st) => (st.startsWith("bad") ? 0.03 : st.startsWith("mid") ? 0.35 : 0.9));
    const out = await jevClaimVerifier([claim("good1"), claim("bad1"), claim("mid1")]);
    expect(out).toEqual({ good1: "supported", bad1: "unsupported", mid1: "unknown" });
  });

  test("Jev sees only the statement and the snippet's title and text: never the url or any id", async () => {
    const seen = stubJev(() => 0.9);
    await jevClaimVerifier([claim("a")]);
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen[0]?.state)).not.toMatch(/secret-path|token|example\.com/);
    expect(Object.keys((seen[0]?.state as { evidence: object }).evidence).sort()).toEqual([
      "snippet",
      "title",
    ]);
    expect(seen[0]?.questions.q).toEqual({ type: "noul", instructions: CLAIM_INSTRUCTIONS });
  });

  test("no key, the kill switch and an empty batch make no request and keep every claim", async () => {
    const seen = stubJev(() => 0.01);
    Reflect.deleteProperty(process.env, "JEV_API_KEY");
    expect(await jevClaimVerifier([claim("a")])).toEqual({ a: "unknown" });
    process.env.JEV_API_KEY = "test-jev";
    process.env.JEV_CLAIM_CHECK = "off";
    expect(await jevClaimVerifier([claim("a")])).toEqual({ a: "unknown" });
    Reflect.deleteProperty(process.env, "JEV_CLAIM_CHECK");
    expect(await jevClaimVerifier([])).toEqual({});
    expect(seen).toHaveLength(0);
  });

  test("an HTTP error on one claim leaves that claim unknown and does not stop the others", async () => {
    stubJev((st) => (st.startsWith("err") ? "http500" : 0.02));
    expect(await jevClaimVerifier([claim("err1"), claim("bad2")])).toEqual({
      err1: "unknown",
      bad2: "unsupported",
    });
  });

  test("a network failure keeps every claim", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await jevClaimVerifier([claim("a"), claim("b")])).toEqual({
      a: "unknown",
      b: "unknown",
    });
  });

  test("a batch larger than the concurrency cap is answered in full, never more than 6 at once", async () => {
    let inFlight = 0;
    let peak = 0;
    globalThis.fetch = (async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(
        JSON.stringify({ answers: { q: { type: "noul", noul: 0.9 } }, usage: {} }),
        { status: 200 },
      );
    }) as typeof fetch;
    const claims = Array.from({ length: 20 }, (_, i) => claim(`c${i}`));
    const out = await jevClaimVerifier(claims);
    expect(Object.values(out).every((v) => v === "supported")).toBe(true);
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  test("a custom threshold from env moves the line", async () => {
    stubJev(() => 0.3);
    expect(await jevClaimVerifier([claim("a")])).toEqual({ a: "unknown" });
    process.env.JEV_CLAIM_MIN = "0.4";
    expect(await jevClaimVerifier([claim("a")])).toEqual({ a: "unsupported" });
  });
});
