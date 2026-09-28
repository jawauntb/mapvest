import { type Context, Hono } from "hono";
import { type Mcp, buildMapvestMcp } from "../lib/mcp-tools.js";

/**
 * The constellation's MCP, mounted at the root (not under /v1: MCP clients and
 * the lattice animal's embed look for these exact addresses):
 *
 *   POST /mcp                         this site's tools (lib/mcp-tools.ts)
 *   POST /mcp/<peer>                  another member's own MCP, relayed one hop deeper
 *   GET  /.well-known/mcp.json        where everything is (also /mcp/server-card.json)
 *
 * `mcp-lite` owns the protocol: `fetch` answers a Response, or `null` for a
 * path that is not its own. Every failure on these routes is a JSON-RPC error
 * from the library (a `405` on GET, `-32600` on a body it cannot read), never
 * this API's flat `{ error }`; the global `notFound`/`onError` handlers only
 * see paths that are not MCP paths. Public and read-only; the global rate
 * limiter still applies, and the library adds its own per-address limit.
 */
const mcpRoutes = new Hono();

let instance: Mcp | null = null;

/** Built on first use so the environment is read once it is settled, and a test can rebuild it. */
export function getMcp(): Mcp {
  instance ??= buildMapvestMcp();
  return instance;
}

/** Test-only: forget the built server so the next request re-reads the environment. */
export function __resetMcp(): void {
  instance = null;
}

const serve = async (c: Context) => (await getMcp().fetch(c.req.raw)) ?? c.notFound();

mcpRoutes.all("/mcp", serve);
// Hono is strict about a trailing slash, the library is not: a client that
// adds one still reaches the tools instead of this API's `{ error }` 404.
mcpRoutes.all("/mcp/", serve);
mcpRoutes.all("/mcp/:peer", serve);
mcpRoutes.get("/.well-known/mcp.json", serve);
mcpRoutes.get("/.well-known/mcp/server-card.json", serve);

export default mcpRoutes;
