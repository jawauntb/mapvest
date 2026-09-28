# @mapvest/api

Bun + Hono HTTP API.

## Run

```
doppler run -- bun run dev
```

## Routes

- `GET  /v1/health` — liveness
- `GET  /v1/config` — feature flags + version
- `POST /v1/identify` — multipart `image` → `IdentifyResponse`
- `GET  /v1/nearby?lat=&lng=&radius=&limit=` → `NearbyResponse`
- `POST /v1/resolve-comparable` — `{brand}` → `ResolveComparableResponse`
- `POST /mcp` — the constellation's MCP (JSON-RPC 2.0): `search_intent`, `rating`, `brand_lookup`, `ask_lattice_animals`; read-only, public. `POST /mcp/lattice` relays to the lattice hub; `GET /.well-known/mcp.json` says where everything is. Root paths, not `/v1`; see `docs/ARCHITECTURE.md`.

See `../../packages/core/src/schemas/index.ts` for exact response shapes.
