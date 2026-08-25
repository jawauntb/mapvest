# Secrets

Every shared provider secret Mapvest touches lives in the **Jawaun personal** Doppler workplace, project `shared`. Local development uses `shared/dev_personal`; production and Railway use `shared/prd`. GIC `cofounder` is not authoritative. Service-specific values may remain in the Mapvest service project, but Massive credentials are canonical only in `shared`.

## Doppler setup

```
doppler login --scope . --overwrite   # pick workplace "jawaun personal", not GIC
doppler run --project shared --config dev_personal -- bun run dev
doppler run --project shared --config prd -- <production verification command>
bash infra/doppler/sync-from-railway.sh   # service-owned variables only; not Massive credentials
python3 infra/doppler/sync-personal-apps.py  # all personal Railway apps + shared providers
python3 infra/doppler/setup-local-repos.py   # scope local sibling checkouts (no extra login)
```

## Names (canonical)

| Env var | Provider | Used by |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter | `packages/vision`, `apps/api` |
| `OPENROUTER_BASE_URL` | OpenRouter | `packages/vision` |
| `EXA_API_KEY` | Exa | `packages/search`, `apps/api` |
| `FRED_API_KEY` | FRED (St. Louis Fed) | `packages/finance` macro series; optional — environment briefs omit series when unset |
| `FRED_BASE_URL` | FRED | non-secret override; defaults to `https://api.stlouisfed.org/fred` |
| `GEMINI_API_KEY` | Google | `packages/vision` (fallback) |
| `GOOGLE_MAPS_API_KEY` | Google Places | `apps/api` server-side only |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Google | server-side Places if using ADC |
| `MASSIVE_API_KEY` | Massive | `packages/finance` market-data adapter; server-side only; shared Doppler |
| `MASSIVE_S3_FLAT_FILE_ACCESS_KEY_ID` | Massive | optional flat-file ingestion; shared Doppler |
| `MASSIVE_S3_FLAT_FILE_SECRET_ACCESS_KEY` | Massive | optional flat-file ingestion; shared Doppler |
| `MASSIVE_S3_ENDPOINT` | Massive | optional flat-file ingestion; shared Doppler |
| `MASSIVE_S3_BUCKET` | Massive | optional flat-file ingestion; shared Doppler |
| `MASSIVE_BASE_URL` | Massive | optional REST base URL; defaults to `https://api.massive.com` |
| `POSTGRES_URL` | Railway Postgres (`${{Postgres.DATABASE_URL}}`) | users, Robinhood MCP, `user_watchlist`, owner-scoped research conversations, nearby_cache, brand_ticker_cache, usage/entitlements |
| `STRIPE_SECRET_KEY` | Stripe (**Artesanato Poesia** `acct_1Pj15wKwhiITC0uV`) — Mapvest only, not objetdart | Checkout + portal (Phase 8 Slice E). Railway API currently uses test-mode `sk_test_…` until live keys have `product_write`. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint → `POST /v1/billing/webhook` | Subscription webhooks |
| `STRIPE_PRICE_ID_MONTHLY` | Stripe Price **Mapvest Pro** $19.99/mo (`price_…`) on Artesanato Poesia | Checkout line item |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | optional | Checkout return URLs (default landing `/app`) |
| `APPLE_IAP_PRODUCT_ID` | App Store Connect product id `mapvest_pro_monthly` | When set, iOS `POST /v1/billing/checkout` returns `channel: "apple_iap"`. Leave unset on Railway until the StoreKit client is on TestFlight (older builds would otherwise stop opening Stripe). Not a secret. |
| `APPLE_BUNDLE_ID` | `com.mapvest.app` | StoreKit JWS `bundleId` pin. Optional; defaults to `com.mapvest.app`. |
| `GOOGLE_PLAY_PRODUCT_ID` | optional Play Billing product id | Android v0.2 only. Do not treat this as permission to ship a Play build. |
| `SESSION_SIGNING_KEY` | self | `apps/api` (magic-link JWT) |
| `IOS_MAPS_TOKEN_SIGNING_KEY` | self | `apps/api` for the short-lived iOS map token |
| `EXPO_TOKEN` | Expo | GitHub Actions `ios-eas-production` only. Create at expo.dev → Access tokens. Never put it in the iOS bundle, Doppler-to-client path, or a commit. |
| `DERIVATION_RESEARCH_API_ORIGIN` | Railway Derivation Research Console | Server-only origin for `/api/explore` and `/api/autoresearch`; `DERIVATION_URL` remains a compatibility alias |
| `DERIVATION_RESEARCH_SERVICE_TOKEN` | Derivation Doppler/Railway | Server-only bearer used by Mapvest's research proxy; never expose it to web or iOS |
| `RESEARCH_CONSOLE_FORWARDED_HOST` | Cloudflare front door host | Host attestation header for Derivation request-guard |
| `RESEARCH_CONSOLE_SERVICE_TOKEN_READ` / `_MUTATE` | Derivation Doppler/Railway | Legacy token aliases retained during rollout |

### Massive market data

The API reads `MASSIVE_*` values through Doppler. Never place a Massive token in
`.env`, an iOS bundle, a checked-in Railway file, or a test fixture. The
provider selection flags are non-secret configuration: `MARKET_DATA_PRIMARY`
defaults to `massive` (with `MARKET_DATA_PROVIDER` retained as a compatibility
alias), while `MARKET_DATA_FALLBACK_PROVIDER=yahoo` enables the temporary
quote/history fallback. The plan and freshness variables are optional reporting
metadata only; this repository does not require or invent any `MASSIVE_*_PLAN`
values. The five shared S3 variables are reserved for future flat-file ingestion
and are not required by the REST adapter.

### App Store Connect (StoreKit)

Create an auto-renewable subscription with product id `mapvest_pro_monthly` at $19.99/month, bundle `com.mapvest.app`. Sandbox testers use a Sandbox Apple ID — do not put a card number in the repo or Doppler. After the StoreKit client is on TestFlight, set `APPLE_IAP_PRODUCT_ID=mapvest_pro_monthly` on the Railway API so checkout stops returning Stripe to iOS.

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
# Prefer the Doppler ↔ Railway integration targeting project `shared`, config
# `prd`, so secrets are not piped through a shell or copied to Railway variables.
```

## Rotation

- Any secret found in a commit → rotate immediately, then `git filter-repo` the history.
- Rotate `SESSION_SIGNING_KEY` every 90d (invalidates outstanding sessions).
- Rotate iOS map JWT signing key on demand — apps re-issue at next boot.

## Local `.env.example` policy

`.env.example` is committed. It contains **names only**. If you need to test without Doppler, `cp .env.example .env` and paste values from `doppler open` — never commit `.env`.
