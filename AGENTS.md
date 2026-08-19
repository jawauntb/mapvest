# AGENTS.md — Rules for AI agents working on Mapvest

Anyone touching this repo (Claude Code, Codex, Cursor, Devin, human‑with‑agent) reads this first. It is intentionally short and load‑bearing.

## 1. What Mapvest is

A map + camera product that turns **places and objects into investable tickers**. If the brand is public → give the ticker. If it's private → give the closest public comparable and an ETF with real exposure. Nothing else in the codebase matters if that loop is broken.

## 2. Non‑negotiables

1. **No secret ever hardcoded.** All secrets flow through Doppler **personal workplace** (jawaun personal). Mapvest uses project `mapvest` (`dev` / `stg` / `prd`). Sibling Railway apps each have their own project; identical provider tokens live in `shared`. Not GIC `cofounder`. Read via `doppler run -- ...` in scripts or via `process.env.*` populated by Doppler. If a secret has to reach the iOS app, hash/mask it via `jq` before writing to the runtime bundle — see `docs/SECRETS.md` and `infra/doppler/README.md`.
2. **API layer vs implementation layer is a hard boundary.** `apps/api` exposes HTTP; it must not import from `apps/ios` or `apps/landing`. Everything shared lives in `packages/*`. Any downstream web/mobile client can plug in without changes to `apps/api`.
3. **Types are the source of truth.** Every request and response is a zod schema in `packages/core/src/schemas`. Never invent a JSON shape at the call site.
4. **Never fake financial data.** Ticker resolution, ETF matches, and comparables always cite a source (Exa result URL, provider name, timestamp). If confidence is low, return `confidence: "low"` and let the client decide.
5. **User photos are private by default.** Never persist a raw uploaded photo to a public bucket. If storage is needed, use a signed URL bucket keyed by user id.
6. **Docs live in `.md` and are served by the landing page.** If you change behavior, update the relevant doc in the same PR. The landing page reads `docs/*.md` and renders them.

## 3. Layout you must respect

```
apps/api          Bun + Hono. Only HTTP + auth + rate limiting. No business logic beyond glue.
apps/ios          Expo React Native. Camera, map, list, login, admin.
apps/landing      Next.js. Marketing + rendered docs.
packages/core     Shared types + zod schemas. No runtime deps beyond zod.
packages/vision   OpenRouter multimodal client (GPT-5.6 Terra / Claude Opus 4.8 / Grok 4.6). Input: image bytes. Output: {brand, product, confidence, tags}.
packages/finance  Ticker resolver, private→public comparable, ETF match. Cites sources.
packages/search   Exa wrapper for open-web enrichment.
infra/railway     Railway service configs.
infra/doppler     Doppler mount snippets.
```

Do not add a package outside `packages/`. Do not add an app outside `apps/`. If a new concern doesn't fit, propose the shape in `IMPLEMENTATION_PLAN.md` before coding.

## 4. Tooling

- **JS runtime**: Bun 1.3+. `bun` for install, `bun run` for scripts, `bun test` for tests.
- **Yarn** is allowed only inside `apps/ios` if Expo forces it. Nowhere else.
- **TypeScript** everywhere except Swift bridging (avoid unless we ship a pure‑Swift native module).
- **Env**: Doppler. Never write `.env` files that contain real secrets. `.env.example` is fine.
- **Lint/format**: `biome` at the repo root.

## 5. Secrets contract

Every secret this repo touches is in Doppler `mapvest/dev` (or `stg` / `prd`) in the personal workplace. The names below are the exact env var names — do not rename:

| Purpose | Env var |
|---|---|
| Multimodal LLM (image + text) | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` |
| Open‑web search | `EXA_API_KEY` |
| Gemini direct (fallback vision) | `GEMINI_API_KEY` |
| Google Maps / Places (server side) | `GOOGLE_APPLICATION_CREDENTIALS_JSON` and/or a scoped `GOOGLE_MAPS_API_KEY` (add if missing) |
| Anthropic (agent operations only, not user path) | `ANTHROPIC_API_KEY` |

For iOS, the maps SDK key is delivered via a **Railway‑signed short‑lived token endpoint** — the client never sees the raw Google key. See `docs/SECRETS.md` for the hash‑and‑forward pattern.

## 6. Data source contract

Every finance answer must attach a `sources: Source[]` array. The canonical shape lives as a zod schema in `packages/core/src/schemas` and is projected into the OpenAPI 3.1 document at the repo root (`openapi.yaml`) — see the `Source` component there for the authoritative field list. For reference:

```ts
type Source = {
  provider: "exa" | "openrouter" | "gemini" | "massive" | "yahoo" | "polygon" | "sec" | "manual";
  url?: string;
  fetchedAt: string; // ISO
  confidence: "high" | "medium" | "low";
};
```

If you cannot cite a source, return an empty `sources: []` and set overall `confidence: "low"` — do not fabricate.

Market-data provider routing is owned by `packages/finance/src/marketData`. Massive is primary when `MARKET_DATA_PROVIDER` is unset or `massive` and `MASSIVE_API_KEY` is available. Yahoo is only used when `MARKET_DATA_PROVIDER=yahoo` or `MARKET_DATA_FALLBACK_PROVIDER=yahoo`; fallback is never implicit. Massive credentials and plan declarations flow through Doppler as `MASSIVE_API_KEY`, `MASSIVE_BASE_URL`, `MASSIVE_MARKET_DATA_FRESHNESS`, `MASSIVE_STOCKS_PLAN`, `MASSIVE_OPTIONS_PLAN`, and `MASSIVE_EVENTS_PLAN`. Never put their values in `.env` files or source.

**API contract artifacts.** `openapi.yaml` and `postman.json` at the repo root are **generated files** — never hand-edit. Regenerate whenever a schema in `packages/core` changes:

```
bun run openapi   # zod → openapi.yaml
bun run postman   # openapi.yaml → postman.json
```

Downstream clients (iOS, landing, external integrators) consume `openapi.yaml` as the wire contract; the zod schemas remain the source of truth for the API implementation itself.

## 7. How to run and test

```
# from repo root
doppler setup --project mapvest --config dev
bun install
bun run dev        # api :3001, landing :3000, expo :8081
bun test           # runs all package + api tests
```

For the iOS app specifically:
```
cd apps/ios
bun install
bun run ios        # launches simulator
```

## 8. Deploy

- API + landing → **Railway** (`infra/railway`).
- iOS → **TestFlight** via **EAS** (`apps/ios/eas.json`).
- Never deploy from a dirty tree. Never deploy `main` without CI green.

## 9. Agent workflow rules

1. **Read `IMPLEMENTATION_PLAN.md` first**, then this file, then the doc for the area you're touching.
2. **One concern per PR.** If your change spans map + camera + finance, it's three PRs.
3. **Update docs in the same commit** as the behavior change.
4. **Never disable a failing test to "unblock"** — fix it or write a follow‑up task.
5. **Never push secrets, .DS_Store, node_modules, or ios build artifacts.**
6. **Cite sources in commit messages** when the change is finance‑adjacent ("uses Exa result at <url>").
7. **When you finish a phase in `IMPLEMENTATION_PLAN.md`, tick its checkbox** in the same commit.

## 10. Escalation

If the current instruction contradicts this file, this file wins — and open an issue tagged `agents-md-conflict` so it can be reconciled. Do not silently deviate.
