import { afterEach, beforeEach, describe, expect, test } from "bun:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SIGNING_KEY = "test-session-signing-key-32bytes__";
process.env.IOS_MAPS_TOKEN_SIGNING_KEY = "test-maps-signing-key-32bytes___";

import { McpJsonRpcResponse, McpManifest, McpRatingResult, RATING_DISCLAIMER } from "@mapvest/core";
import { app } from "../src/index.js";
import { __resetMetrics } from "../src/lib/metrics.js";
import { _clearRatingCache } from "../src/lib/rating.js";
import { _clearSearchIntentCache } from "../src/lib/search-intent.js";
import { __resetRateLimit } from "../src/middleware/rateLimit.js";
import { __resetMcp } from "../src/routes/mcp.js";

/**
 * The MCP through the real `app`: the mount, the routes, the JSON-RPC error
 * shape, the hop rule against a stub peer on 127.0.0.1, and the API's existing
 * routes still answering as before. Nothing reaches the network: `fetch` is
 * stubbed to fail for everything except the loopback stub peer.
 */

const originalFetch = globalThis.fetch;
const ENV_KEYS = [
  "LATTICE_MCP_URL",
  "MCP_ALLOW_LOCAL",
  "MCP_PUBLIC_ORIGIN",
  "JEV_API_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};
const stubs: Array<{ stop: (force?: boolean) => void }> = [];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    Reflect.deleteProperty(process.env, k);
  }
  __resetRateLimit();
  __resetMetrics();
  __resetMcp();
  _clearSearchIntentCache();
  _clearRatingCache();
  offlineExceptLoopback();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = v;
  }
  __resetMcp();
  globalThis.fetch = originalFetch;
  for (const s of stubs.splice(0)) s.stop(true);
});

function offlineExceptLoopback() {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("http://127.0.0.1")) return originalFetch(input, init);
    return Promise.reject(new Error("offline"));
  }) as typeof fetch;
}

// ---------------- harness ----------------

type Seen = { headers: Record<string, string>; body: { id?: number; method: string } };

/** A stand-in for the lattice hub: records what reaches it, answers like an MCP server. */
function startHub(answer = "the lattice says hi") {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const body = JSON.parse(await req.text()) as Seen["body"];
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });
      seen.push({ headers, body });
      if (body.id === undefined) return new Response(null, { status: 202 });
      if (body.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "ask_the_minds",
                description: "ask the minds",
                inputSchema: {
                  type: "object",
                  properties: { question: { type: "string" } },
                  required: ["question"],
                },
              },
            ],
          },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: answer }] },
      });
    },
  });
  stubs.push(server);
  return { seen, url: `http://127.0.0.1:${server.port}/mcp` };
}

/** Point the site at a hub and let it be plain http on loopback: what an operator does for a test. */
function useHub(hub: { url: string }) {
  process.env.MCP_ALLOW_LOCAL = "1";
  process.env.LATTICE_MCP_URL = hub.url;
  __resetMcp();
}

async function send(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: the wire body is checked field by field below
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON: `json` stays null and the assertion on it fails loudly */
  }
  return { status: res.status, headers: res.headers, text, json };
}

const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  send("POST", path, body, headers);
const get = (path: string, headers?: Record<string, string>) =>
  send("GET", path, undefined, headers);

const msg = (id: number, method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
});
const toolCall = (name: string, args?: unknown) =>
  msg(1, "tools/call", { name, ...(args === undefined ? {} : { arguments: args }) });

// ---------------- the protocol ----------------

describe("POST /mcp", () => {
  test("initialize echoes a protocol version it knows and names the server", async () => {
    const res = await post("/mcp", msg(1, "initialize", { protocolVersion: "2025-06-18" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = McpJsonRpcResponse.parse(res.json);
    expect(body.id).toBe(1);
    expect(body.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "mapvest", title: "Mapvest", version: "0.1.0" },
      capabilities: { tools: { listChanged: false } },
    });
    expect(String(body.result?.instructions)).toContain("not investment advice");
  });

  test("an unknown protocol version gets the newest, a notification gets 202 and no body, ping is empty", async () => {
    const newest = await post("/mcp", msg(2, "initialize", { protocolVersion: "2099-01-01" }));
    expect(newest.json.result.protocolVersion).toBe("2025-11-25");

    const note = await post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    expect(note.text).toBe("");

    const ping = await post("/mcp", msg(3, "ping"));
    expect(ping.status).toBe(200);
    expect(ping.json).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  test("tools/list offers the four tools, each with an object input schema", async () => {
    const res = await post("/mcp", msg(4, "tools/list"));
    expect(res.status).toBe(200);
    const tools = res.json.result.tools as Array<{
      name: string;
      inputSchema: { type: string };
      annotations: { readOnlyHint: boolean };
    }>;
    expect(tools.map((t) => t.name)).toEqual([
      "search_intent",
      "rating",
      "brand_lookup",
      "ask_lattice_animals",
    ]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });

  test("tools/call brand_lookup answers, and says where it sat on the chain", async () => {
    const res = await post("/mcp", toolCall("brand_lookup", { brand: "nike" }));
    expect(res.status).toBe(200);
    expect(res.json.result.isError).toBeUndefined();
    const body = JSON.parse(res.json.result.content[0].text);
    expect(body).toMatchObject({ found: true, match: { ticker: "NKE", kind: "exact" } });
    expect(res.json.result._meta.constellation).toEqual({
      server: "mapvest",
      hop: 0,
      path: ["mapvest"],
    });
  });

  test("tools/call search_intent answers through the real resolver, offline", async () => {
    const res = await post("/mcp", toolCall("search_intent", { query: "burger king" }));
    const body = JSON.parse(res.json.result.content[0].text);
    expect(body).toMatchObject({
      intent: "brand",
      resolved: { symbol: "QSR" },
      confidence: "high",
      sources: [{ provider: "manual" }],
    });
  });

  test("tools/call rating with no keys is insufficient_signal, with the disclaimer, not a made-up rating", async () => {
    const res = await post("/mcp", toolCall("rating", { ticker: "ZZZQ" }));
    expect(res.status).toBe(200);
    expect(res.json.result.isError).toBeUndefined();
    const body = McpRatingResult.parse(JSON.parse(res.json.result.content[0].text));
    expect(body).toMatchObject({
      ticker: "ZZZQ",
      status: "insufficient_signal",
      rating: null,
      probabilities: null,
      disclaimer: RATING_DISCLAIMER,
    });
  });

  test("a tool that is not offered is a JSON-RPC error: quote is -32602", async () => {
    for (const name of [
      "quote",
      "quote-history",
      "financials",
      "options",
      "market-data",
      "identify",
    ]) {
      const res = await post("/mcp", toolCall(name, { ticker: "MCD" }));
      expect(res.status).toBe(200);
      expect(res.json.error.code).toBe(-32602);
      expect(res.json.result).toBeUndefined();
    }
  });

  test("a tool refusal is an error result the caller's model can read, not a JSON-RPC error", async () => {
    const res = await post("/mcp", toolCall("rating", { ticker: "not a ticker" }));
    expect(res.status).toBe(200);
    expect(res.json.error).toBeUndefined();
    expect(res.json.result.isError).toBe(true);
    expect(res.json.result.content[0].text).toMatch(/^invalid /);
  });

  test("a method the server does not have is -32601", async () => {
    const res = await post("/mcp", msg(7, "resources/list"));
    expect(res.json.error.code).toBe(-32601);
  });

  test("a trailing slash still reaches the tools", async () => {
    const res = await post("/mcp/", msg(1, "ping"));
    expect(res.status).toBe(200);
    expect(res.json.result).toEqual({});
  });

  test("the global rate limiter still counts these calls", async () => {
    const res = await post("/mcp", msg(1, "ping"));
    expect(res.headers.get("x-ratelimit-limit")).toBe("300");
  });

  test("one address is held to 40 calls a minute by the library, and told so as a tool result", async () => {
    const headers = { "x-forwarded-for": "198.51.100.7" };
    for (let i = 0; i < 40; i++) {
      const ok = await post("/mcp", toolCall("brand_lookup", { brand: "nike" }), headers);
      expect(ok.json.result.isError).toBeUndefined();
    }
    const limited = await post("/mcp", toolCall("brand_lookup", { brand: "nike" }), headers);
    expect(limited.status).toBe(200);
    expect(limited.json.result.isError).toBe(true);
    expect(limited.json.result.content[0].text).toStartWith("rate-limited");
    // Another address has its own minute.
    const other = await post("/mcp", toolCall("brand_lookup", { brand: "nike" }), {
      "x-forwarded-for": "198.51.100.8",
    });
    expect(other.json.result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------- errors

describe("errors on the MCP routes are JSON-RPC, not the API's { error }", () => {
  test("GET and DELETE on /mcp are 405 with Allow: POST", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await send(method, "/mcp");
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(res.json).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: expect.stringContaining("POST JSON-RPC to /mcp") },
      });
    }
    const relay = await get("/mcp/lattice");
    expect(relay.status).toBe(405);
    expect(relay.headers.get("allow")).toBe("POST");
  });

  test("a body that is not JSON is a 400 JSON-RPC -32600 with a null id", async () => {
    const res = await post("/mcp", "{nope");
    expect(res.status).toBe(400);
    expect(res.json).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "invalid request" },
    });
    expect(typeof res.json.error).toBe("object");
  });

  test("an empty body, a body over 64 kB, a batch and not-JSON-RPC are all 400 -32600", async () => {
    const bodies: unknown[] = [
      "",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(70_000) }),
      [msg(1, "ping")],
      { hello: 1 },
      { jsonrpc: "1.0", id: 1, method: "ping" },
    ];
    for (const body of bodies) {
      const res = await post("/mcp", body);
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe(-32600);
      expect(res.json.jsonrpc).toBe("2.0");
    }
  });

  test("outside the MCP paths the API's own shape is untouched", async () => {
    const missing = await get("/nope");
    expect(missing.status).toBe(404);
    expect(missing.json).toEqual({ error: "not found" });
    const deeper = await get("/mcp/lattice/extra");
    expect(deeper.status).toBe(404);
    expect(deeper.json).toEqual({ error: "not found" });
  });

  test("a preflight from a browser is answered by the API's CORS, not a 404", async () => {
    const res = await send("OPTIONS", "/mcp", undefined, {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST",
    });
    expect(res.status).toBe(204);
  });
});

// ---------------------------------------------------------------- manifest

describe("GET /.well-known/mcp.json", () => {
  test("says where everything is: the production endpoint, the tools, the lattice peer, the hop limit", async () => {
    for (const path of ["/.well-known/mcp.json", "/.well-known/mcp/server-card.json"]) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
      const manifest = McpManifest.parse(res.json);
      expect(manifest.name).toBe("mapvest");
      expect(manifest.endpoint).toBe("https://api-production-4b27.up.railway.app/mcp");
      expect(manifest.tools.map((t) => t.name)).toEqual([
        "search_intent",
        "rating",
        "brand_lookup",
        "ask_lattice_animals",
      ]);
      expect(manifest.peers.map((p) => p.name)).toContain("lattice");
      expect(manifest.peers.find((p) => p.name === "lattice")?.endpoint).toBe(
        "https://api-production-4b27.up.railway.app/mcp/lattice",
      );
      expect(manifest.hop).toEqual({ max: 2, headers: ["x-mcp-hop", "x-mcp-path"] });
    }
  });

  test("the advertised origin is the operator's: MCP_PUBLIC_ORIGIN, never the request's Host", async () => {
    const before = await get("/.well-known/mcp.json", { Host: "evil.example" });
    expect(before.json.endpoint).toBe("https://api-production-4b27.up.railway.app/mcp");

    process.env.MCP_PUBLIC_ORIGIN = "https://mapvest.example";
    __resetMcp();
    const after = await get("/.well-known/mcp.json");
    expect(after.json.endpoint).toBe("https://mapvest.example/mcp");
    expect(after.json.peers[0].endpoint).toBe("https://mapvest.example/mcp/lattice");
  });
});

// ---------------------------------------------------------------- the constellation

describe("the constellation: relays and the hop rule", () => {
  test("POST /mcp/lattice relays the message to the hub as it is, one hop deeper", async () => {
    const hub = startHub();
    useHub(hub);
    const res = await post("/mcp/lattice", msg(9, "tools/list"));
    expect(res.status).toBe(200);
    expect(res.json.id).toBe(9);
    expect(res.json.result.tools[0].name).toBe("ask_the_minds");
    expect(hub.seen).toHaveLength(1);
    // The caller's message goes on as it is, its own id included.
    expect(hub.seen[0]?.body).toMatchObject({ jsonrpc: "2.0", id: 9, method: "tools/list" });
    expect(hub.seen[0]?.headers["x-mcp-hop"]).toBe("1");
    expect(hub.seen[0]?.headers["x-lattice-hop"]).toBe("1");
    expect(hub.seen[0]?.headers["x-mcp-path"]).toBe("mapvest");
  });

  test("a relay that arrives at the hop limit is a JSON-RPC -32001 and goes nowhere", async () => {
    const hub = startHub();
    useHub(hub);
    const res = await post("/mcp/lattice", msg(10, "tools/list"), { "x-mcp-hop": "2" });
    expect(res.status).toBe(200);
    expect(res.json.error.code).toBe(-32001);
    expect(hub.seen).toEqual([]);
  });

  test("a relay to a name that is not in the registry is a 404 JSON-RPC error", async () => {
    const hub = startHub();
    useHub(hub);
    for (const peer of ["stranger", "admissible", "f", "meta"]) {
      const res = await post(`/mcp/${peer}`, msg(11, "tools/list"));
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe(-32000);
    }
    expect(hub.seen).toEqual([]);
  });

  test("ask_lattice_animals at hop 0 goes out as hop 1 with this site's name in the path", async () => {
    const hub = startHub("the field says: hello, mapvest");
    useHub(hub);
    const res = await post("/mcp", toolCall("ask_lattice_animals", { question: "who are you?" }));
    expect(res.status).toBe(200);
    expect(res.json.result.isError).toBeUndefined();
    expect(res.json.result.content[0].text).toBe("the field says: hello, mapvest");
    expect(res.json.result._meta.constellation).toEqual({
      server: "mapvest",
      hop: 0,
      path: ["mapvest"],
    });
    expect(hub.seen).toHaveLength(1);
    expect(hub.seen[0]?.headers["x-mcp-hop"]).toBe("1");
    expect(hub.seen[0]?.headers["x-mcp-path"]).toBe("mapvest");
    expect(hub.seen[0]?.body).toMatchObject({
      method: "tools/call",
      params: { name: "ask_the_minds", arguments: { question: "who are you?" } },
    });
  });

  test("one hop in, its call is hop 2 and the path grows; the reply says where it sat", async () => {
    const hub = startHub();
    useHub(hub);
    const res = await post("/mcp", toolCall("ask_lattice_animals", { question: "hi" }), {
      "x-mcp-hop": "1",
      "x-mcp-path": "lattice",
    });
    expect(res.json.result.content[0].text).toBe("the lattice says hi");
    expect(hub.seen[0]?.headers["x-mcp-hop"]).toBe("2");
    expect(hub.seen[0]?.headers["x-mcp-path"]).toBe("lattice>mapvest");
    expect(res.json.result._meta.constellation).toEqual({
      server: "mapvest",
      hop: 1,
      path: ["lattice", "mapvest"],
    });
  });

  test("at x-mcp-hop 2 ask_lattice_animals is too-deep, and nothing goes out", async () => {
    const hub = startHub();
    useHub(hub);
    const res = await post("/mcp", toolCall("ask_lattice_animals", { question: "hi" }), {
      "x-mcp-hop": "2",
      "x-mcp-path": "lattice>reflect-search",
    });
    expect(res.status).toBe(200);
    expect(res.json.result.isError).toBe(true);
    expect(res.json.result.content[0].text).toStartWith("too-deep");
    expect(hub.seen).toEqual([]);
  });

  test("the older x-lattice-hop header counts as a hop too", async () => {
    const hub = startHub();
    useHub(hub);
    const res = await post("/mcp", toolCall("ask_lattice_animals", { question: "hi" }), {
      "x-lattice-hop": "2",
    });
    expect(res.json.result.isError).toBe(true);
    expect(hub.seen).toEqual([]);
  });

  test("a pure tool still answers at the hop limit", async () => {
    const res = await post("/mcp", toolCall("brand_lookup", { brand: "nike" }), {
      "x-mcp-hop": "2",
    });
    expect(res.json.result.isError).toBeUndefined();
    expect(JSON.parse(res.json.result.content[0].text).match.ticker).toBe("NKE");
  });

  test("a hub address the operator has not allowed is not configured: said so, never guessed or called", async () => {
    const hub = startHub();
    process.env.LATTICE_MCP_URL = hub.url; // plain http on loopback, and no MCP_ALLOW_LOCAL
    __resetMcp();

    const manifest = McpManifest.parse((await get("/.well-known/mcp.json")).json);
    expect(manifest.peers).toEqual([]);

    const relay = await post("/mcp/lattice", msg(12, "tools/list"));
    expect(relay.status).toBe(200);
    expect(relay.json.error.code).toBe(-32000);
    expect(relay.json.error.message).toContain("not configured");

    const ask = await post("/mcp", toolCall("ask_lattice_animals", { question: "hi" }));
    expect(ask.json.result.isError).toBe(true);
    expect(ask.json.result.content[0].text).toBe(
      "the lattice animals did not answer (not-configured)",
    );
    expect(hub.seen).toEqual([]);
  });

  test("a hub that is down is an error result that says so", async () => {
    process.env.MCP_ALLOW_LOCAL = "1";
    process.env.LATTICE_MCP_URL = "http://127.0.0.1:1/mcp"; // nothing listens on port 1
    __resetMcp();
    const res = await post("/mcp", toolCall("ask_lattice_animals", { question: "hi" }));
    expect(res.json.result.isError).toBe(true);
    expect(res.json.result.content[0].text).toBe(
      "the lattice animals did not answer (unreachable)",
    );
  });
});

// ---------------------------------------------------------------- nothing else moved

describe("the API's existing routes still answer", () => {
  test("health and config", async () => {
    const health = await get("/v1/health");
    expect(health.status).toBe(200);
    expect(health.json).toMatchObject({ ok: true, service: "mapvest-api" });
    const config = await get("/v1/config");
    expect(config.status).toBe(200);
    expect(config.json.flags).toBeDefined();
  });

  test("search intent and rating keep their own shapes and their own 400s", async () => {
    const intent = await post("/v1/search/intent", { q: "what does nvidia sell?" });
    expect(intent.status).toBe(200);
    expect(intent.json).toMatchObject({ intent: "question", method: "deterministic" });
    expect(intent.json.route).toEqual({
      screen: "research",
      params: { q: "what does nvidia sell?" },
    });

    const noQuery = await post("/v1/search/intent", {});
    expect(noQuery.status).toBe(400);
    expect(noQuery.json).toEqual({ error: "q required (1-200 chars)" });

    const badTicker = await get("/v1/rating/not-a-ticker");
    expect(badTicker.status).toBe(400);
    expect(typeof badTicker.json.error).toBe("string");
  });

  test("the licensed-data routes are still mounted where they were, with the API's own error shape", async () => {
    const quote = await get("/v1/quote");
    expect(quote.status).toBe(400);
    expect(quote.json).toEqual({ error: "symbol required" });
  });
});
