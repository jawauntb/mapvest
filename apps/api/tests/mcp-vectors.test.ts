import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  type Post,
  type PostResult,
  type ToolContext,
  type ToolSpec,
  createMcp,
  relayResult,
} from "../src/lib/mcp-lite.mjs";

/**
 * The constellation's conformance vectors (lattice-animal
 * docs/constellation.md, "Conformance"). Every member builds the fixture the
 * file describes with `createMcp` and must answer each case the same way; this
 * is the same runner as lattice-animal's tests/mcp-lite.test.mjs. A case's
 * `expect` maps a dotted path into `{ status, headers, json, outbound }` to an
 * exact value, or to `{ startsWith }` or `{ absent: true }`. `outbound` is what
 * the site sent to its peer.
 */

type Vector = {
  name: string;
  request: {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  expect: Record<string, unknown>;
};

type Fixture = {
  name: string;
  title: string;
  origin: string;
  tools: Array<{
    name: string;
    kind: "echo" | "relay";
    description: string;
    peer?: string;
    tool?: string;
  }>;
  peers: Record<string, { url?: string; about: string }>;
  peerReplies: Record<string, unknown>;
};

const here = (rel: string) => new URL(rel, import.meta.url);
const vectors = JSON.parse(readFileSync(here("./fixtures/constellation-vectors.json"), "utf8")) as {
  fixture: Fixture;
  cases: Vector[];
};

type Outbound = {
  url: string;
  headers: Record<string, string>;
  body: { id?: number; method: string };
};

function build(fx: Fixture, post: Post) {
  const tools: ToolSpec[] = fx.tools.map((t) =>
    t.kind === "echo"
      ? {
          name: t.name,
          description: t.description,
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
          run: (a: Record<string, unknown>) => String(a.text || ""),
        }
      : {
          name: t.name,
          description: t.description,
          relay: true,
          run: async (a: Record<string, unknown>, ctx: ToolContext) =>
            relayResult(await ctx.call(t.peer as string, t.tool as string, { text: a.text })),
        },
  );
  return createMcp({
    name: fx.name,
    title: fx.title,
    origin: fx.origin,
    tools,
    peers: fx.peers,
    post,
  });
}

function at(root: unknown, path: string): unknown {
  let v = root;
  for (const k of path.split(".")) {
    if (v === undefined || v === null) return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

describe("constellation vectors (every member answers these the same way)", () => {
  test("the fixture is the whole 26-case contract", () => {
    expect(vectors.cases).toHaveLength(26);
  });

  for (const c of vectors.cases) {
    test(c.name, async () => {
      const outbound: Outbound[] = [];
      const post: Post = async (url, { body, headers }): Promise<PostResult> => {
        const m = JSON.parse(body) as Outbound["body"];
        outbound.push({ url, headers, body: m });
        if (m.id === undefined) return { ok: true, status: 202, headers: {}, text: "" };
        const result = vectors.fixture.peerReplies[m.method];
        return {
          ok: true,
          status: 200,
          headers: { "content-type": "application/json" },
          text: JSON.stringify(
            result
              ? { jsonrpc: "2.0", id: m.id, result }
              : { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no" } },
          ),
        };
      };
      const mcp = build(vectors.fixture, post);
      const out = await mcp.handle({
        ...c.request,
        headers: c.request.headers ?? {},
        ip: "203.0.113.9",
      });
      expect(out).not.toBeNull();
      const seen = { status: out?.status, headers: out?.headers ?? {}, json: out?.json, outbound };

      // Collect every mismatch so a failure names the path, not just a diff.
      const wrong: string[] = [];
      for (const [path, want] of Object.entries(c.expect)) {
        const got = at(seen, path);
        if (isObject(want) && "absent" in want) {
          if (got !== undefined) wrong.push(`${path} should be absent, got ${JSON.stringify(got)}`);
        } else if (isObject(want) && "startsWith" in want) {
          if (!String(got).startsWith(String(want.startsWith))) {
            wrong.push(`${path} = ${JSON.stringify(got)} should start with ${want.startsWith}`);
          }
        } else if (!isDeepStrictEqual(got, want)) {
          wrong.push(`${path} = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});

describe("the vendored copies are verbatim", () => {
  // A member's copy of the library is verbatim (docs/constellation.md). These
  // are the SHA-256 of lattice-animal's files at commit fe9400a, so a stray
  // edit or a formatter pass fails here. To take a newer library, copy all
  // three files from lattice-animal (lib/mcp-lite.mjs, lib/mcp-lite.d.mts,
  // tests/fixtures/constellation-vectors.json), `cmp` them, and update these.
  const sha256 = (rel: string) =>
    createHash("sha256")
      .update(readFileSync(here(rel)))
      .digest("hex");

  test("mcp-lite.mjs", () => {
    expect(sha256("../src/lib/mcp-lite.mjs")).toBe(
      "0cd88641832a24e31cfd877742a0886e48099c3c12c109de08833e3664be60cf",
    );
  });

  test("mcp-lite.d.mts", () => {
    expect(sha256("../src/lib/mcp-lite.d.mts")).toBe(
      "2822c194a1a819cfc7ffdd1a36e6f295a8e6485513651b039918b83e44c585c5",
    );
  });

  test("constellation-vectors.json", () => {
    expect(sha256("./fixtures/constellation-vectors.json")).toBe(
      "b3c1be73321a194c801e2e451f119fcc8294944d35e7a1912630bc0ddc1462fa",
    );
  });
});
