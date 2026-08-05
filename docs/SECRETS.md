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
| `POSTGRES_URL` | Railway plugin | `apps/api` |
| `SESSION_SIGNING_KEY` | self | `apps/api` (magic-link JWT) |
| `IOS_MAPS_TOKEN_SIGNING_KEY` | self | `apps/api` for the short-lived iOS map token |

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
