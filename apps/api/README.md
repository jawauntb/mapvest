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

See `../../packages/core/src/schemas/index.ts` for exact response shapes.
