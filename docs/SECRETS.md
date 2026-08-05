# Secrets

Every secret Mapvest touches lives in Doppler `cofounder` project, `dev` (or `stg`) config. Nothing else is authoritative.

## Doppler setup

```
doppler login
doppler setup --project cofounder --config dev
doppler run -- bun run dev   # every dev script goes through Doppler
```

## Names (canonical)

| Env var | Provider | Used by |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter | `packages/vision`, `apps/api` |
| `OPENROUTER_BASE_URL` | OpenRouter | `packages/vision` |
| `EXA_API_KEY` | Exa | `packages/search`, `apps/api` |
| `GEMINI_API_KEY` | Google | `packages/vision` (fallback) |
| `GOOGLE_MAPS_API_KEY` | Google Places | `apps/api` server-side only |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Google | server-side Places if using ADC |
| `POSTGRES_URL` | Railway Postgres (`${{Postgres.DATABASE_URL}}`) | users, Robinhood MCP, nearby_cache, brand_ticker_cache, usage/entitlements |
| `STRIPE_SECRET_KEY` | Stripe | Checkout + portal (Phase 8 Slice E) |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Subscription webhooks |
| `STRIPE_PRICE_ID_MONTHLY` | Stripe Price ($20/mo) | Checkout line item |
| `SESSION_SIGNING_KEY` | self | `apps/api` (magic-link JWT) |
| `IOS_MAPS_TOKEN_SIGNING_KEY` | self | `apps/api` for the short-lived iOS map token |
| `DERIVATION_URL` | Railway Derivation Research Console | `apps/api` agent proxy (Railway origin, not workers.dev) |
| `RESEARCH_CONSOLE_FORWARDED_HOST` | Cloudflare front door host | Host attestation header for Derivation request-guard |
| `RESEARCH_CONSOLE_SERVICE_TOKEN_READ` | Derivation Doppler/Railway | Bearer for GET `/api/idea-chats` |
| `RESEARCH_CONSOLE_SERVICE_TOKEN_MUTATE` | Derivation Doppler/Railway | Bearer for POST `/api/idea-chats/stream` |

### Robinhood MCP (operator vs user)

Derivation Research Console uses operator env `ROBINHOOD_MCP_URL` / `ROBINHOOD_MCP_TOKEN` (and optional credential JSON) on **its** Railway service — Mapvest Research chat proxies through that.

Users can paste a personal Robinhood agent MCP bearer into Mapvest **Home → Robinhood MCP**. The API stores it server-side and only returns a SHA-256 fingerprint + last4 (`POST /v1/settings/robinhood-mcp`). Never put the raw token in the iOS bundle or landing localStorage.

When configured, ticker detail shows **Open in Robinhood** (`GET /v1/robinhood?ticker=` → `https://robinhood.com/us/en/stocks/{TICKER}/`). That opens Robinhood so the user can buy or place an order there (app / agentic trading). Mapvest never calls Robinhood `place_*` tools and never submits broker orders.

## Why the iOS app never sees the raw Google key

Shipping the raw `GOOGLE_MAPS_API_KEY` in the app binary is trivially extractable. Instead:

1. iOS boots and calls `POST /v1/session/maps-token` with its user session.
2. The API mints a 60-minute JWT signed with `IOS_MAPS_TOKEN_SIGNING_KEY`.
3. iOS uses the JWT to hit `GET /v1/proxy/places?…`, which the API forwards to Google Places using the real key server-side.
4. If a native map SDK is genuinely required client-side, use an Apple-restricted key with bundle-id allowlist and a strict monthly cap.

## `jq` hash-and-forward pattern (Doppler → Railway)

When copying secrets to Railway from Doppler, mask any value that will be logged:

```bash
doppler secrets download --format json --no-file \
  | jq 'to_entries | map(
      if .key | test("KEY|TOKEN|SECRET|PASSWORD") then
        .value = { computed: .value.computed, note: "masked" }
      else . end
    ) | from_entries' \
  > /tmp/masked.json
```

Then `railway variables set` from the real (unmasked) JSON, and only paste the masked one into any log/PR:

```bash
doppler secrets download --format env --no-file \
  | railway variables set --from-stdin
```

## Rotation

- Any secret found in a commit → rotate immediately, then `git filter-repo` the history.
- Rotate `SESSION_SIGNING_KEY` every 90d (invalidates outstanding sessions).
- Rotate iOS map JWT signing key on demand — apps re-issue at next boot.

## Local `.env.example` policy

`.env.example` is committed. It contains **names only**. If you need to test without Doppler, `cp .env.example .env` and paste values from `doppler open` — never commit `.env`.
