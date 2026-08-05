import { beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { Hono } from "hono";
import {
  IDENTIFY_LIMITS,
  __resetIdentifyGuards,
  identifyGuards,
} from "../src/middleware/identifyGuards.js";
import { __resetMetrics, tail } from "../src/lib/metrics.js";
import {
  MAX_OCR_STRING_LENGTH,
  sanitizeOcrString,
  stripControlChars,
} from "../src/lib/sanitize.js";

/** Build a minimal Hono app with just the identifyGuards middleware attached. */
function makeApp() {
  const app = new Hono();
  app.use("*", identifyGuards);
  app.post("/", (c) => c.json({ ok: true }));
  return app;
}

function hit(app: ReturnType<typeof makeApp>, ip: string) {
  return app.fetch(
    new Request("http://localhost/", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    }),
  );
}

beforeEach(() => {
  __resetIdentifyGuards();
  __resetMetrics();
});

describe("sanitize helpers", () => {
  test("stripControlChars removes NULs, ESC and other C0 controls but keeps \\n and \\t", () => {
    const input = "hello\x00world\x1b[31m\ttab\nnewline\x7f";
    const cleaned = stripControlChars(input);
    expect(cleaned).toBe("helloworld[31m\ttab\nnewline");
  });

  test("stripControlChars strips C1 controls (0x80-0x9F)", () => {
    const input = "safe\x80\x9fpayload";
    expect(stripControlChars(input)).toBe("safepayload");
  });

  test("sanitizeOcrString truncates strings past the 4KB cap", () => {
    const oversized = "a".repeat(MAX_OCR_STRING_LENGTH + 500);
    const out = sanitizeOcrString(oversized);
    expect(out).toBeDefined();
    expect(out!.length).toBe(MAX_OCR_STRING_LENGTH);
  });

  test("sanitizeOcrString passes through undefined/null unchanged", () => {
    expect(sanitizeOcrString(undefined)).toBeUndefined();
    expect(sanitizeOcrString(null)).toBeUndefined();
  });

  test("sanitizeOcrString combines both guardrails in one shot", () => {
    // 5KB payload with an ESC injected halfway through — must strip the ESC
    // AND cap the result at 4KB.
    const half = "x".repeat(2600);
    const payload = `${half}\x1b${"y".repeat(2600)}`;
    const out = sanitizeOcrString(payload);
    expect(out).toBeDefined();
    expect(out!.length).toBe(MAX_OCR_STRING_LENGTH);
    expect(out!.includes("\x1b")).toBe(false);
  });
});

describe("identifyGuards middleware", () => {
  test("allows the first N requests up to the per-minute cap and then 429s", async () => {
    const app = makeApp();
    for (let i = 0; i < IDENTIFY_LIMITS.perMinute; i++) {
      const res = await hit(app, "1.2.3.4");
      expect(res.status).toBe(200);
    }
    const blocked = await hit(app, "1.2.3.4");
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toContain("identify rate limit");
  });

  test("sets X-Identify-RateLimit-* headers on allowed requests", async () => {
    const app = makeApp();
    const res = await hit(app, "5.5.5.5");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Identify-RateLimit-Minute")).toBe(
      String(IDENTIFY_LIMITS.perMinute),
    );
    expect(res.headers.get("X-Identify-RateLimit-Minute-Remaining")).toBe(
      String(IDENTIFY_LIMITS.perMinute - 1),
    );
    expect(res.headers.get("X-Identify-RateLimit-Hour")).toBe(
      String(IDENTIFY_LIMITS.perHour),
    );
    expect(res.headers.get("X-Identify-RateLimit-Hour-Remaining")).toBe(
      String(IDENTIFY_LIMITS.perHour - 1),
    );
  });

  test("separate IPs get separate buckets", async () => {
    const app = makeApp();
    for (let i = 0; i < IDENTIFY_LIMITS.perMinute; i++) {
      expect((await hit(app, "6.6.6.6")).status).toBe(200);
    }
    // 6.6.6.6 is now blocked but a fresh IP still succeeds.
    expect((await hit(app, "6.6.6.6")).status).toBe(429);
    expect((await hit(app, "7.7.7.7")).status).toBe(200);
  });

  test("abuse heuristic: >30 hits in 60s from the same IP writes an admin log entry with 'suspected_abuse'", async () => {
    const app = makeApp();
    // Fire 31 requests from the same IP. The first 10 will be 200s, requests
    // 11..30 come back 429 (identify rate limit exceeded), and request 31
    // trips the abuse heuristic and comes back 429 with the admin log entry.
    let abuseSeen = false;
    for (let i = 0; i < IDENTIFY_LIMITS.abuseThreshold + 1; i++) {
      const res = await hit(app, "9.9.9.9");
      if (i === IDENTIFY_LIMITS.abuseThreshold) {
        // 31st request → abuse trigger.
        expect(res.status).toBe(429);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("suspected abuse");
        abuseSeen = true;
      }
    }
    expect(abuseSeen).toBe(true);

    const flagged = tail(500).filter((r) => r.tag === "suspected_abuse");
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged[0]?.ip).toBe("9.9.9.9");
    expect(flagged[0]?.status).toBe(429);
  });

  test("abuse heuristic does NOT fire at exactly 30 attempts (strictly greater than threshold)", async () => {
    const app = makeApp();
    for (let i = 0; i < IDENTIFY_LIMITS.abuseThreshold; i++) {
      await hit(app, "3.3.3.3");
    }
    const flagged = tail(500).filter((r) => r.tag === "suspected_abuse");
    expect(flagged.length).toBe(0);
  });
});
