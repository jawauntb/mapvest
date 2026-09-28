// mcp-lite: a site is its own MCP server in one call, and can reach the
// other sites' MCPs. No dependencies (Node 18+, fetch is global). The
// canonical copy is lattice-animal's lib/mcp-lite.mjs; the other sites in the
// constellation carry it verbatim and pass the same vectors
// (tests/fixtures/constellation-vectors.json). Spec: docs/constellation.md.
//
//   import { createMcp, latticeTool } from "./mcp-lite.mjs";
//   const mcp = createMcp({
//     name: "mysite",
//     tools: [{ name: "hello", description: "Say hello", run: () => "hello" }, latticeTool()],
//   });
//   mcp.express(app);                      // Express
//   // or, in a fetch-style server (Hono, Bun, Next, Workers):
//   //   const r = await mcp.fetch(request); if (r) return r;
//
// That mounts POST /mcp (this site's own tools), POST /mcp/<peer> (another
// site's MCP, relayed one hop deeper) and GET /.well-known/mcp.json (what a
// client or the lattice animal's embed finds to learn the address).
//
// Transport: Streamable HTTP, stateless. Every POST carries one JSON-RPC
// message and gets one JSON reply; notifications get 202; there are no
// sessions and no server-initiated stream, so GET and DELETE are 405.
//
// The hop rule: every call between sites carries x-mcp-hop (how many sites
// have already relayed it) and x-mcp-path (their names). A site makes an
// outbound call only while the hop is under MAX_HOP, and sends hop + 1; at
// the limit its pure tools still answer and anything that would call out
// says so. A call can go around a loop (A to B to A) and is stopped at the
// limit; each site checks the counter, and nothing here signs it.

export const MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const MAX_HOP = 2;
export const HUB_URL = "https://latticeanimal-production.up.railway.app/mcp";

const PATH_MAX = 8;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RESERVED = new Set(["f", "meta", "peers", "well-known"]);
const TEXT_MAX = 8000;
const BODY_MAX = 64 * 1024;
const REPLY_MAX = 256 * 1024;

const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const oneLine = (s, n) => clip(String(s == null ? "" : s).replace(/\s+/g, " ").trim(), n);
const text = (t, isError = false) => ({ content: [{ type: "text", text: clip(t, TEXT_MAX) }], ...(isError ? { isError: true } : {}) });
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

// ---- the hop rule -----------------------------------------------------------

function header(headers, key) {
  if (!headers) return "";
  const v = typeof headers.get === "function" ? headers.get(key) : headers[key];
  return v == null ? "" : String(Array.isArray(v) ? v[0] : v);
}

// The depth a call arrived at and the sites it passed through. The older
// x-lattice-hop header counts too, so the field-to-field rule keeps working.
export function readHop(headers) {
  const n = Math.max(Number.parseInt(header(headers, "x-mcp-hop"), 10) || 0, Number.parseInt(header(headers, "x-lattice-hop"), 10) || 0);
  const path = header(headers, "x-mcp-path").split(">").map(s => s.trim().toLowerCase()).filter(s => NAME_RE.test(s)).slice(0, PATH_MAX);
  return { hop: Math.max(0, Math.min(9, n)), path };
}

// The headers for a call this site makes one hop deeper.
export function hopHeaders({ hop = 0, path = [] } = {}, self = "") {
  const next = Math.max(0, Math.min(9, hop | 0)) + 1;
  const trail = [...path, self].filter(Boolean).slice(-PATH_MAX);
  return { "x-mcp-hop": String(next), "x-lattice-hop": String(next), ...(trail.length ? { "x-mcp-path": trail.join(">") } : {}) };
}

// ---- replies ----------------------------------------------------------------

// One JSON-RPC reply out of a JSON or event-stream body: the matching id.
export function parseReply(res, id) {
  const type = String((res.headers && (res.headers["content-type"] || res.headers["Content-Type"])) || "").toLowerCase();
  const pick = (m) => (m && m.jsonrpc === "2.0" && (m.id === id || id === undefined) && ("result" in m || "error" in m) ? m : null);
  if (type.includes("text/event-stream")) {
    for (const block of String(res.text || "").split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try { const m = pick(JSON.parse(data)); if (m) return m; } catch { /* next block */ }
    }
    return null;
  }
  try {
    const j = JSON.parse(res.text || "null");
    if (Array.isArray(j)) { for (const m of j) { const x = pick(m); if (x) return x; } return null; }
    return pick(j);
  } catch { return null; }
}

// A tool result as plain text: text parts joined, anything else named.
export function resultText(result, max = TEXT_MAX) {
  if (!result || typeof result !== "object") return "";
  const parts = Array.isArray(result.content) ? result.content : [];
  const out = parts.map(p => (p && p.type === "text" ? String(p.text || "") : p && p.type ? `[${p.type}]` : "")).filter(Boolean).join("\n");
  const structured = !out && result.structuredContent ? JSON.stringify(result.structuredContent) : "";
  return clip(out || structured, max);
}

// A peer call's answer as a tool result: what came back, or why it did not.
export function relayResult(r, who = "the other site") {
  if (r && r.ok) return r.text || "(no text)";
  if (r && r.isError) return { text: `${who} reported an error: ${r.text || ""}`, isError: true };
  return { text: `${who} did not answer (${(r && r.reason) || "failed"})`, isError: true };
}

// ---- peers: the sites this one can reach -----------------------------------

function loopback(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

// A peer URL is https (http only for loopback when allowLocal, for a laptop
// or a test), with no credentials and no fragment; anything else is null.
export function vetPeerUrl(raw, allowLocal = false) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (u.username || u.password) return null;
  const local = loopback(u.hostname);
  if (u.protocol === "http:" ? !(allowLocal && local) : u.protocol !== "https:") return null;
  u.hash = "";
  return u;
}

// { name: url } | { name: { url, about } } | [{ name, url, about }] -> Map.
// A peer with no url is listed as not configured, never guessed.
export function normalizePeers(peers, { self = "", allowLocal = false } = {}) {
  const rows = Array.isArray(peers) ? peers : Object.entries(peers || {}).map(([name, v]) => (v && typeof v === "object" ? { name, ...v } : { name, url: v }));
  const out = new Map();
  for (const r of rows.slice(0, 16)) {
    const name = String((r && r.name) || "").toLowerCase();
    if (!NAME_RE.test(name) || RESERVED.has(name) || name === self || out.has(name)) continue;
    const u = r.url ? vetPeerUrl(r.url, allowLocal) : null;
    out.set(name, { name, url: u ? u.href : null, about: oneLine(r.about, 240), host: u ? u.host : "" });
  }
  return out;
}

// Peer URLs from the environment: NAME_MCP_URL for each default (name
// upper-cased, dashes to underscores), and MCP_PEERS as a JSON array that
// adds or replaces entries.
export function peersFromEnv(defaults, env = {}) {
  const rows = new Map();
  for (const d of defaults || []) rows.set(d.name, { ...d });
  for (const [name, r] of rows) {
    const v = env[`${name.toUpperCase().replace(/-/g, "_")}_MCP_URL`];
    if (v) r.url = v;
  }
  try {
    for (const r of JSON.parse(env.MCP_PEERS || "[]")) if (r && typeof r.name === "string") rows.set(r.name.toLowerCase(), { ...(rows.get(r.name.toLowerCase()) || {}), ...r });
  } catch { /* a bad MCP_PEERS is ignored */ }
  return [...rows.values()];
}

// A plain POST for peers the operator named: no redirects, capped reply, a
// deadline. Sites with a stricter guard pass their own (see createPeers).
export async function plainPost(url, { body, headers, timeoutMs }) {
  try {
    const res = await fetch(url, { method: "POST", body, headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400) return { ok: false, reason: "redirect-refused", status: res.status };
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    let out = "";
    if (reader) {
      const dec = new TextDecoder();
      for (let size = 0; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        out += dec.decode(value, { stream: true });
        if (size > REPLY_MAX) { await reader.cancel(); break; }
      }
    } else out = await res.text();
    return { ok: res.ok, status: res.status, headers: Object.fromEntries(res.headers), text: out.slice(0, REPLY_MAX) };
  } catch (e) {
    return { ok: false, reason: e && e.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}

// createPeers: the registry and the way out. `post(url, { body, headers,
// timeoutMs })` resolves { ok, status, headers, text } or { ok: false,
// reason }; lattice-animal passes its SSRF-guarded safePost, everyone else
// gets a plain fetch (peer URLs are the operator's, never a caller's).
export function createPeers({ self = "", peers = {}, post = plainPost, allowLocal = false, timeoutMs = 25000, toolsTtlMs = 5 * 60 * 1000, dailyCap = 500, now = Date.now } = {}) {
  const reg = normalizePeers(peers, { self, allowLocal });
  const seen = new Map(); // name -> { tools, at }
  const day = { d: "", n: 0 };
  let seq = 0;
  const budget = () => {
    const d = new Date(now()).toISOString().slice(0, 10);
    if (day.d !== d) { day.d = d; day.n = 0; }
    if (day.n >= dailyCap) return false;
    day.n++;
    return true;
  };
  const headersFor = (ctx) => ({ "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_VERSIONS[1], ...hopHeaders(ctx, self) });

  async function rpc(peer, method, params, ctx) {
    const id = ++seq;
    const res = await post(peer.url, { body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), headers: headersFor(ctx), timeoutMs });
    const m = parseReply(res, id);
    if (!m) throw new Error(res.reason || (res.ok === false ? `http ${res.status}` : "no JSON-RPC reply"));
    if (m.error) throw new Error(oneLine(m.error.message || "error", 200));
    return m.result;
  }

  return {
    self,
    has: (name) => reg.has(String(name || "").toLowerCase()),
    get: (name) => reg.get(String(name || "").toLowerCase()) || null,
    list: () => [...reg.values()].map(p => ({ name: p.name, about: p.about, host: p.host, configured: !!p.url })),
    // The tools one peer offers, short and cached.
    async tools(name, ctx = {}) {
      const p = reg.get(String(name || "").toLowerCase());
      if (!p) return { ok: false, reason: "no-such-peer" };
      if (!p.url) return { ok: false, reason: "not-configured" };
      const c = seen.get(p.name);
      if (c && now() - c.at < toolsTtlMs) return { ok: true, tools: c.tools };
      if ((ctx.hop || 0) >= MAX_HOP) return { ok: false, reason: "too-deep" };
      if (!budget()) return { ok: false, reason: "daily-cap" };
      try {
        const r = await rpc(p, "tools/list", {}, ctx);
        const tools = (r && Array.isArray(r.tools) ? r.tools : []).slice(0, 40).map(t => ({
          name: clip(t && t.name, 64),
          description: oneLine(t && t.description, 300),
          required: Array.isArray(t && t.inputSchema && t.inputSchema.required) ? t.inputSchema.required.slice(0, 8) : [],
          properties: Object.keys((t && t.inputSchema && t.inputSchema.properties) || {}).slice(0, 12),
        }));
        seen.set(p.name, { tools, at: now() });
        return { ok: true, tools };
      } catch (e) {
        return { ok: false, reason: oneLine(e && e.message, 120) || "failed" };
      }
    },
    // Call one tool on one peer, one hop deeper. Never throws.
    async call(name, tool, args, ctx = {}) {
      const p = reg.get(String(name || "").toLowerCase());
      if (!p) return { ok: false, reason: "no-such-peer" };
      if (!p.url) return { ok: false, reason: "not-configured" };
      if ((ctx.hop || 0) >= MAX_HOP) return { ok: false, reason: "too-deep" };
      if (!budget()) return { ok: false, reason: "daily-cap" };
      try {
        const r = await rpc(p, "tools/call", { name: clip(tool, 64), arguments: args && typeof args === "object" ? args : {} }, ctx);
        return { ok: !(r && r.isError), isError: !!(r && r.isError), text: resultText(r), meta: r && r._meta && r._meta.constellation ? r._meta.constellation : undefined };
      } catch (e) {
        return { ok: false, reason: oneLine(e && e.message, 120) || "failed" };
      }
    },
    // Forward one JSON-RPC message to a peer as it is, one hop deeper.
    // Resolves [status, body] where body is the peer's own JSON-RPC reply.
    async relay(name, message, ctx = {}) {
      const p = reg.get(String(name || "").toLowerCase());
      const id = message && message.id !== undefined ? message.id : null;
      if (!p) return [404, fail(id, -32000, "no such peer")];
      if (!p.url) return [200, fail(id, -32000, `${p.name} is not configured on this site`)];
      if ((ctx.hop || 0) >= MAX_HOP) return [200, fail(id, -32001, `too deep: this call has already been relayed ${ctx.hop} times`)];
      if (!budget()) return [200, fail(id, -32002, "too many relayed calls today")];
      const res = await post(p.url, { body: JSON.stringify(message), headers: headersFor(ctx), timeoutMs });
      if (message && (message.id === undefined || message.id === null)) return [202, null];
      const m = parseReply(res, message.id);
      if (m) return [200, m];
      return [200, fail(id, -32003, `${p.name} did not answer (${res.reason || `http ${res.status}`})`)];
    },
  };
}

// ---- the manifest -----------------------------------------------------------

export function buildManifest({ name, title, description, version, origin = "", base = "/mcp", tools = [], peers = [] }) {
  return {
    name,
    title: title || name,
    description: description || "",
    version,
    endpoint: `${origin}${base}`,
    transport: "streamable-http",
    stateless: true,
    auth: "none",
    protocolVersions: MCP_VERSIONS,
    tools: tools.map(t => ({ name: t.name, description: oneLine(t.description, 300), readOnly: t.readOnly !== false })),
    peers: peers.filter(p => p.configured !== false).map(p => ({ name: p.name, endpoint: `${origin}${base}/${p.name}`, about: p.about || "" })),
    hop: { max: MAX_HOP, headers: ["x-mcp-hop", "x-mcp-path"] },
  };
}

// ---- the server -------------------------------------------------------------

// createMcp({ name, tools, ... }) -> { handle, fetch, express, manifest, peers }
//   tools: [{ name, description, inputSchema?, readOnly = true, relay = false,
//             run(args, ctx) }]; run returns a string, a plain object (sent as
//   JSON text), { text, isError } or a full MCP result.
//   ctx: { hop, path, ip, call(peer, tool, args) -> { ok, text, reason } }
//   A tool marked relay: true is one that calls a peer; the server refuses it
//   at the hop limit before it runs.
export function createMcp({
  name, title, description = "", version = "1.0.0", instructions = "", tools = [], peers = {}, base = "/mcp",
  origin = "", post, allowLocal = false, perIpPerMin = 40, now = Date.now, timeoutMs, dailyCap, cors = false,
} = {}) {
  if (!NAME_RE.test(String(name || ""))) throw new Error("createMcp: name must be a short slug (a-z, 0-9, dashes)");
  const list = tools.map(t => ({
    name: String(t.name), description: String(t.description || ""),
    inputSchema: t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {}, additionalProperties: false },
    readOnly: t.readOnly !== false, relay: !!t.relay, run: t.run,
  }));
  const byName = new Map(list.map(t => [t.name, t]));
  const net = createPeers({ self: name, peers, post, allowLocal, now, ...(timeoutMs ? { timeoutMs } : {}), ...(dailyCap ? { dailyCap } : {}) });
  const seenIp = new Map(); // ip -> [times]; memory only, never returned or logged
  const limited = (ip) => {
    if (!ip) return false;
    const t = now();
    const l = (seenIp.get(ip) || []).filter(x => t - x < 60000);
    if (l.length >= perIpPerMin) { seenIp.set(ip, l); return true; }
    l.push(t);
    seenIp.set(ip, l);
    if (seenIp.size > 5000) seenIp.clear();
    return false;
  };
  const publicTools = list.map(t => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, openWorldHint: t.relay },
  }));

  function normalize(out) {
    if (out && typeof out === "object" && Array.isArray(out.content)) return out;
    if (typeof out === "string") return text(out);
    if (out && typeof out === "object" && typeof out.text === "string") return text(out.text, !!out.isError);
    return text(JSON.stringify(out === undefined ? null : out));
  }

  async function rpc(m, ctx) {
    if (Array.isArray(m)) return [400, fail(null, -32600, "batches are not supported")];
    if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return [400, fail(m && m.id, -32600, "invalid request")];
    if (m.id === undefined || m.id === null) return [202, null]; // a notification
    const p = m.params && typeof m.params === "object" ? m.params : {};
    try {
      if (m.method === "initialize") {
        const v = MCP_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : MCP_VERSIONS[0];
        return [200, ok(m.id, {
          protocolVersion: v,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, title: title || name, version },
          instructions: instructions || description,
        })];
      }
      if (m.method === "ping") return [200, ok(m.id, {})];
      if (m.method === "tools/list") return [200, ok(m.id, { tools: publicTools })];
      if (m.method === "tools/call") {
        const t = byName.get(p.name);
        if (!t) return [200, fail(m.id, -32602, `unknown tool: ${p.name}`)];
        if (limited(ctx.ip)) return [200, ok(m.id, text("rate-limited: too many calls from here this minute; wait a little", true))];
        if (t.relay && ctx.hop >= MAX_HOP) return [200, ok(m.id, text(`too-deep: this call has already been relayed ${ctx.hop} times, so ${name} will not call out again (limit ${MAX_HOP})`, true))];
        const toolCtx = { hop: ctx.hop, path: ctx.path, ip: ctx.ip, call: (peer, tool, args) => net.call(peer, tool, args, { hop: ctx.hop, path: ctx.path }) };
        const res = normalize(await t.run(p.arguments && typeof p.arguments === "object" ? p.arguments : {}, toolCtx));
        return [200, ok(m.id, { ...res, _meta: { ...(res._meta || {}), constellation: { server: name, hop: ctx.hop, path: [...ctx.path, name] } } })];
      }
      return [200, fail(m.id, -32601, `method not found: ${m.method}`)];
    } catch {
      return [200, ok(m.id, text("the tool failed", true))];
    }
  }

  const notHere = () => ({ status: 405, headers: { allow: "POST" }, json: fail(null, -32000, `POST JSON-RPC to ${base}; this server keeps no stream or session`) });

  // The whole server as one function of a plain request; null when the path
  // is not ours, so a fetch-style server can fall through.
  async function handle({ method = "GET", path = "/", headers = {}, body, ip = "", origin: o = origin } = {}) {
    const p = String(path).replace(/\/+$/, "") || "/";
    if (p === "/.well-known/mcp.json" || p === "/.well-known/mcp/server-card.json") {
      if (method !== "GET") return { status: 405, headers: { allow: "GET" }, json: fail(null, -32000, "GET the manifest") };
      return { status: 200, headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" }, json: buildManifest({ name, title, description, version, origin: o, base, tools: list, peers: net.list() }) };
    }
    const cors_ = cors ? { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, mcp-protocol-version, x-mcp-hop, x-mcp-path", "access-control-allow-methods": "POST, OPTIONS" } : {};
    let peer = null;
    if (p === base) peer = "";
    else if (p.startsWith(`${base}/`) && !p.slice(base.length + 1).includes("/")) peer = p.slice(base.length + 1).toLowerCase();
    else return null;
    if (method === "OPTIONS" && cors) return { status: 204, headers: cors_ };
    if (method !== "POST") return notHere();
    const ctx = { ...readHop(headers), ip };
    if (peer === "") { const [status, json] = await rpc(body, ctx); return { status, headers: cors_, json }; }
    if (!net.has(peer)) return { status: 404, headers: cors_, json: fail(null, -32000, "no such peer") };
    if (limited(ip)) return { status: 200, headers: cors_, json: fail(body && body.id, -32002, "rate-limited: too many calls from here this minute; wait a little") };
    if (!body || Array.isArray(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") return { status: 400, headers: cors_, json: fail(body && body.id, -32600, "invalid request") };
    const [status, json] = await net.relay(peer, body, ctx);
    return { status, headers: cors_, json };
  }

  const originOf = (req) => origin || `${(req.headers["x-forwarded-proto"] || req.protocol || "http").toString().split(",")[0]}://${req.headers["x-forwarded-host"] || (req.get && req.get("host")) || req.headers.host || "localhost"}`;
  async function readBody(req) {
    if (req.body !== undefined) return req.body;
    if (req.method !== "POST") return undefined;
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > BODY_MAX) return null; chunks.push(c); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
  }

  return {
    name,
    peers: net,
    tools: () => publicTools.map(t => ({ ...t })),
    manifest: (o = origin) => buildManifest({ name, title, description, version, origin: o, base, tools: list, peers: net.list() }),
    handle,
    // For Express (or anything with the same req/res): mount before the
    // static handler and any catch-all. Needs no body parser of its own.
    express(app) {
      const h = async (req, res) => {
        const out = await handle({ method: req.method, path: req.path, headers: req.headers, body: await readBody(req), ip: req.ip || (req.socket && req.socket.remoteAddress) || "", origin: originOf(req) });
        if (!out) return res.status(404).end();
        for (const [k, v] of Object.entries(out.headers || {})) res.set(k, v);
        return out.json === undefined || out.json === null ? res.status(out.status).end() : res.status(out.status).json(out.json);
      };
      app.all(base, h);
      app.all(`${base}/:peer`, h);
      app.get("/.well-known/mcp.json", h);
      app.get("/.well-known/mcp/server-card.json", h);
      return this;
    },
    // For fetch-style servers: a Response, or null to fall through.
    async fetch(request) {
      const url = new URL(request.url);
      let body;
      if (request.method === "POST") {
        const raw = await request.text();
        try { body = raw.length > BODY_MAX ? null : JSON.parse(raw); } catch { body = null; }
      }
      // The platform's proxy appends the address it saw: the last entry (one
      // trusted hop, as Express's `trust proxy: 1`).
      const fwd = String(request.headers.get("x-forwarded-for") || "").split(",").map(x => x.trim()).filter(Boolean).pop() || "";
      const out = await handle({ method: request.method, path: url.pathname, headers: request.headers, body, ip: fwd, origin: origin || url.origin });
      if (!out) return null;
      const h = new Headers(out.headers || {});
      if (out.json === undefined || out.json === null) return new Response(null, { status: out.status, headers: h });
      h.set("content-type", "application/json");
      return new Response(JSON.stringify(out.json), { status: out.status, headers: h });
    },
  };
}

// The tool every site gets for reaching the lattice animals: ask them one
// question (they answer in their own voice, and may look things up).
export function latticeTool({ peer = "lattice", name = "ask_lattice_animals" } = {}) {
  return {
    name,
    description: "Ask the lattice animals (a field of small minds that become polyominoes by agreement; latticeanimal-production.up.railway.app) a question. They answer in their own voice and may search their repo and the web. One model call on their side; slow.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "1 to 600 characters" },
        to: { type: "string", enum: ["field", "app", "connectome"], description: "who answers (default: the field)" },
      },
      required: ["question"],
      additionalProperties: false,
    },
    readOnly: true,
    relay: true,
    run: async (args, ctx) => relayResult(await ctx.call(peer, "ask_the_minds", { question: clip(args && args.question, 600), ...(args && args.to ? { to: String(args.to) } : {}) }), "the lattice animals"),
  };
}
