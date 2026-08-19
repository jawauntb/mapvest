# Mapvest

The world is your watchlist.

**What it does.** See a brand. Get the ticker. Mapvest is four layers on one loop:
- **(A) Identify** anything around you via camera or map — a public brand returns its ticker; a private one resolves to the closest public cousin plus an ETF with real exposure. Sources, always.
- **(B) Agentic research** on the company you found — or the local economy around it.
- **(C) Finance agent** briefs, memos, and saved chats on the names you care about.
- **(D) Analytics** to think about positions — charts and modules for how and why to own or trade a name.

Every identify is kept as a **find** — your universe of companies you've seen with your own eyes, growing as you move through the world.

## Repo layout

```
mapvest/
├── AGENTS.md                # rules for AI agents working in this repo
├── IMPLEMENTATION_PLAN.md   # phased build plan
├── docs/                    # architecture, data sources, deploy, secrets
├── apps/
│   ├── api/                 # Bun + Hono backend (public API)
│   ├── ios/                 # Expo React Native iOS app
│   └── landing/             # web landing page (Next.js)
├── packages/
│   ├── core/                # shared TS types + zod schemas
│   ├── vision/              # OpenRouter multimodal wrapper (image → brand/product)
│   ├── finance/             # ticker resolution + private→public comparable + ETF match
│   └── search/              # Exa search wrapper
└── infra/                   # Railway + Doppler config
```

## Market data

`packages/finance` owns the provider boundary. Massive is the default provider
for quotes, daily/intraday aggregates, options chains and contracts, and
corporate events exposed by this API. Existing quote and history endpoints keep
their request and response contracts; new data is additive:

- `GET /v1/market-data/capabilities`
- `GET /v1/market-data/aggregates`
- `GET /v1/options/chain`
- `GET /v1/options/contracts` and `GET /v1/options/contracts/:ticker`
- `GET /v1/market-events`

Configure credentials with `doppler run -- ...`, using `MASSIVE_API_KEY` and
the non-secret routing variables documented in [`docs/SECRETS.md`](docs/SECRETS.md).
Yahoo is only used when explicitly selected or enabled as a temporary fallback;
fallbacks never cover options or corporate-event datasets. The API reports the
configured freshness and dataset access at `/v1/market-data/capabilities`.

## Quick start

```bash
# 1. Doppler: personal workplace, project mapvest
doppler setup --project mapvest --config dev

# 2. Install
bun install

# 3. Dev
bun run dev            # runs api, landing, and expo start
```

## Deploy

- **Landing**: https://mapvest.app (`www` on Railway; apex `301`s to `www`)
- **API**: https://api-production-4b27.up.railway.app (see `docs/DEPLOY.md`)
- **iOS**: TestFlight via EAS (see `apps/ios/README.md`)

## Docs

- [`AGENTS.md`](AGENTS.md) — rules for AI contributors
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — the build plan
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)
- [`docs/MARKET_DATA_MIGRATION.md`](docs/MARKET_DATA_MIGRATION.md)
- [`docs/SECRETS.md`](docs/SECRETS.md)
- [`docs/DEPLOY.md`](docs/DEPLOY.md)
- [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md)
- [`docs/SHARE_AND_WIDGETS.md`](docs/SHARE_AND_WIDGETS.md) — share-to-Mapvest + home-screen widgets

## License

MIT
