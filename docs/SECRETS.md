# Secrets

Every secret Mapvest touches lives in the **personal** Doppler workplace (jawaun personal), project `mapvest`, configs `dev` / `stg` / `prd`. GIC `cofounder` is not authoritative for this repo. Sibling Railway apps (objetdart, derivation, inquiry, …) have their own Doppler projects in the same workplace; shared provider tokens and `KEY_APP` aliases are documented in `infra/doppler/README.md`.

## Doppler setup

```
doppler login --scope . --overwrite   # pick workplace "jawaun personal", not GIC
doppler setup --project mapvest --config dev
doppler run -- bun run dev            # every dev script goes through Doppler
bash infra/doppler/sync-from-railway.sh   # one-time: Railway production API → mapvest/prd
python3 infra/doppler/sync-personal-apps.py  # all personal Railway apps + shared providers
python3 infra/doppler/setup-local-repos.py   # scope local sibling checkouts (no extra login)
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
| `POSTGRES_URL` | Railway Postgres (`${{Postgres.DATABASE_URL}}`) | users, Robinhood MCP, `user_watchlist`, nearby_cache, brand_ticker_cache, usage/entitlements |
| `STRIPE_SECRET_KEY` | Stripe (**Artesanato Poesia** `acct_1Pj15wKwhiITC0uV`) — Mapvest only, not objetdart | Checkout + portal (Phase 8 Slice E). Railway API currently uses test-mode `sk_test_…` until live keys have `product_write`. |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook endpoint → `POST /v1/billing/webhook` | Subscription webhooks |
| `STRIPE_PRICE_ID_MONTHLY` | Stripe Price **Mapvest Pro** $19.99/mo (`price_…`) on Artesanato Poesia | Checkout line item |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | optional | Checkout return URLs (default landing `/app`) |
| `APPLE_IAP_PRODUCT_ID` | App Store Connect product id `mapvest_pro_monthly` | When set, iOS `POST /v1/billing/checkout` returns `channel: "apple_iap"`. Leave unset on Railway until the StoreKit client is on TestFlight (older builds would otherwise stop opening Stripe). Not a secret. |
| `APPLE_BUNDLE_ID` | `com.mapvest.app` | StoreKit JWS `bundleId` pin. Optional; defaults to `com.mapvest.app`. |
| `GOOGLE_PLAY_PRODUCT_ID` | optional Play Billing product id | Android v0.2 only. Do not treat this as permission to ship a Play build. |
| `SESSION_SIGNING_KEY` | self | `apps/api` (magic-link JWT) |
| `IOS_MAPS_TOKEN_SIGNING_KEY` | self | `apps/api` for the short-lived iOS map token |
| `DERIVATION_URL` | Railway Derivation Research Console | `apps/api` agent proxy (Railway origin, not workers.dev) |
| `RESEARCH_CONSOLE_FORWARDED_HOST` | Cloudflare front door host | Host attestation header for Derivation request-guard |
| `RESEARCH_CONSOLE_SERVICE_TOKEN_READ` | Derivation Doppler/Railway | Bearer for GET `/api/idea-chats` |
| `RESEARCH_CONSOLE_SERVICE_TOKEN_MUTATE` | Derivation Doppler/Railway | Bearer for POST `/api/idea-chats/stream` |

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
doppler secrets download --project mapvest --config prd --format env --no-file \
  | railway variable set --service api --environment production
# Prefer the Doppler ↔ Railway integration so you are not piping secrets through a shell.
```

## Rotation

- Any secret found in a commit → rotate immediately, then `git filter-repo` the history.
- Rotate `SESSION_SIGNING_KEY` every 90d (invalidates outstanding sessions).
- Rotate iOS map JWT signing key on demand — apps re-issue at next boot.

## Local `.env.example` policy

`.env.example` is committed. It contains **names only**. If you need to test without Doppler, `cp .env.example .env` and paste values from `doppler open` — never commit `.env`.
