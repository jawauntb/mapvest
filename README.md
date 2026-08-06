# Mapvest

A Google-Maps/Zillow-style investable-brand explorer.

**What it does.** Point your phone at a place, a shelf, or an object and Mapvest tells you what's investable:
- The **map view** shows nearby brands whose parent companies are publicly tradeable (with tickers).
- The **camera view** identifies the brand or product in a photo — a chocolate bar becomes `HSY`, a McDonald's storefront becomes `MCD`.
- For **private goods**, Mapvest finds the closest **public comparable** or an **ETF** that has meaningful exposure.
- The **list view** ranks nearby investables by proximity, market cap, or theme.

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

## Quick start

```bash
# 1. Doppler: use cofounder/dev
doppler setup --project cofounder --config dev

# 2. Install
bun install

# 3. Dev
bun run dev            # runs api, landing, and expo start
```

## Deploy

- **API + landing**: Railway (see `docs/DEPLOY.md`)
- **iOS**: TestFlight via EAS (see `apps/ios/README.md`)

## Docs

- [`AGENTS.md`](AGENTS.md) — rules for AI contributors
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — the build plan
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md)
- [`docs/SECRETS.md`](docs/SECRETS.md)
- [`docs/DEPLOY.md`](docs/DEPLOY.md)
- [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md)
- [`docs/SHARE_AND_WIDGETS.md`](docs/SHARE_AND_WIDGETS.md) — share-to-Mapvest + home-screen widgets

## License

MIT
