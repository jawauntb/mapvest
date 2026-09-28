// Types for lib/mcp-lite.mjs, for TypeScript sites that carry a copy of it. It
// must be named mcp-lite.d.mts: TypeScript looks for that beside an .mjs import.
// Copy both files together; see docs/constellation.md.

export const MCP_VERSIONS: readonly string[];
export const MAX_HOP: number;
export const HUB_URL: string;

export interface HopState { hop: number; path: string[] }
export function readHop(headers: Headers | Record<string, string | string[] | undefined> | null | undefined): HopState;
export function hopHeaders(state?: Partial<HopState>, self?: string): Record<string, string>;

export interface PostResult { ok: boolean; status?: number; headers?: Record<string, string>; text?: string; reason?: string }
export type Post = (url: string, init: { body: string; headers: Record<string, string>; timeoutMs: number }) => Promise<PostResult>;
export function plainPost(url: string, init: { body: string; headers: Record<string, string>; timeoutMs: number }): Promise<PostResult>;

export interface JsonRpcReply { jsonrpc: "2.0"; id: number | string | null; result?: any; error?: { code: number; message: string } }
export function parseReply(res: { headers?: Record<string, string>; text?: string }, id?: number | string): JsonRpcReply | null;
export function resultText(result: unknown, max?: number): string;
export function relayResult(r: PeerCall | undefined, who?: string): string | { text: string; isError: true };

export interface PeerInfo { name: string; url: string | null; about: string; host: string }
export function vetPeerUrl(raw: unknown, allowLocal?: boolean): URL | null;
export function normalizePeers(peers: unknown, opts?: { self?: string; allowLocal?: boolean }): Map<string, PeerInfo>;
export function peersFromEnv(defaults: Array<{ name: string; url?: string | null; about?: string }>, env?: Record<string, string | undefined>): Array<{ name: string; url?: string | null; about?: string }>;

export interface PeerCall { ok: boolean; isError?: boolean; text?: string; reason?: string; meta?: { server: string; hop: number; path: string[] } }
export interface Peers {
  self: string;
  has(name: string): boolean;
  get(name: string): PeerInfo | null;
  list(): Array<{ name: string; about: string; host: string; configured: boolean }>;
  tools(name: string, ctx?: Partial<HopState>): Promise<{ ok: true; tools: Array<{ name: string; description: string; required: string[]; properties: string[] }> } | { ok: false; reason: string }>;
  call(name: string, tool: string, args?: Record<string, unknown>, ctx?: Partial<HopState>): Promise<PeerCall>;
  relay(name: string, message: unknown, ctx?: Partial<HopState>): Promise<[number, JsonRpcReply | null]>;
}
export function createPeers(opts?: {
  self?: string; peers?: unknown; post?: Post; allowLocal?: boolean; timeoutMs?: number; toolsTtlMs?: number; dailyCap?: number; now?: () => number;
}): Peers;

export function buildManifest(opts: {
  name: string; title?: string; description?: string; version: string; origin?: string; base?: string;
  tools?: Array<{ name: string; description: string; readOnly?: boolean }>; peers?: Array<{ name: string; about?: string; configured?: boolean }>;
}): Record<string, unknown>;

export interface ToolContext {
  hop: number;
  path: string[];
  ip: string;
  call(peer: string, tool: string, args?: Record<string, unknown>): Promise<PeerCall>;
}
export type ToolResult = string | { text: string; isError?: boolean } | { content: Array<{ type: string; text?: string }>; isError?: boolean } | Record<string, unknown> | unknown[];
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  readOnly?: boolean;
  relay?: boolean;
  run(args: Record<string, any>, ctx: ToolContext): ToolResult | Promise<ToolResult>;
}
export interface HandleInput { method?: string; path?: string; headers?: Headers | Record<string, string | string[] | undefined>; body?: unknown; ip?: string; origin?: string }
export interface HandleOutput { status: number; headers?: Record<string, string>; json?: unknown }
export interface Mcp {
  name: string;
  peers: Peers;
  tools(): Array<Record<string, unknown>>;
  manifest(origin?: string): Record<string, unknown>;
  handle(input: HandleInput): Promise<HandleOutput | null>;
  express(app: { all(path: string, h: (req: any, res: any) => unknown): unknown; get(path: string, h: (req: any, res: any) => unknown): unknown }): Mcp;
  fetch(request: Request): Promise<Response | null>;
}
export function createMcp(opts: {
  name: string; title?: string; description?: string; version?: string; instructions?: string; tools?: ToolSpec[]; peers?: unknown; base?: string;
  origin?: string; post?: Post; allowLocal?: boolean; perIpPerMin?: number; now?: () => number; timeoutMs?: number; dailyCap?: number; cors?: boolean;
}): Mcp;
export function latticeTool(opts?: { peer?: string; name?: string }): ToolSpec;
