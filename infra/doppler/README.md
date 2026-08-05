# Doppler → Railway mirroring

Doppler (`cofounder` project, `dev` or `stg` config) is the source of truth for every
secret in this repo. Railway services never store canonical values — they receive a
snapshot of Doppler at deploy time. This directory documents the exact commands to
push that snapshot up.

The paired script is `scripts/mirror-doppler-to-railway.sh` (chmod +x that after clone).

## Prerequisites

1. `doppler` and `railway` CLIs installed.
2. `doppler login` completed (or `DOPPLER_TOKEN` in the environment).
3. `railway login` completed (or `RAILWAY_TOKEN` in the environment).
4. `railway link` has been run inside this repo so the CLI knows which project and
   environment to write to. Verify with `railway status`.
5. `jq` on PATH — used for the mask-and-forward pattern documented in
   `docs/SECRETS.md`.

## Self-signed keys (required, create once)

Two secrets are minted locally rather than issued by a provider. If they are missing
from Doppler, generate them before the first mirror:

```bash
# 32 bytes of hex → 64-char secret. Create only if missing.
openssl rand -hex 32   # → paste as IOS_MAPS_TOKEN_SIGNING_KEY
openssl rand -hex 32   # → paste as SESSION_SIGNING_KEY

doppler secrets set IOS_MAPS_TOKEN_SIGNING_KEY --project cofounder --config dev
doppler secrets set SESSION_SIGNING_KEY        --project cofounder --config dev
```

Or run `scripts/rotate-signing-keys.sh` which does both in one shot (also
usable for the 90-day rotation cadence called out in `docs/SECRETS.md`).

## Mirror all Doppler secrets into a Railway service

The pattern is: download secrets from Doppler as `KEY=VALUE` pairs and stream them
straight into `railway variables`. Nothing is written to disk — no `.env` file, no
temp file, no shell history entry that captures a value.

```bash
export DOPPLER_PROJECT=cofounder
export DOPPLER_CONFIG=dev        # or stg for staging

# Current Railway CLI (v3+): each variable is passed via --set KEY=VALUE.
# The helper script parses the env stream and issues one --set per pair so it
# works whether or not your Railway CLI ships --set-from-stdin.
./scripts/mirror-doppler-to-railway.sh api
./scripts/mirror-doppler-to-railway.sh landing
```

The equivalent one-shot form (works on Railway CLI versions that accept stdin):

```bash
doppler secrets download \
    --project "$DOPPLER_PROJECT" \
    --config  "$DOPPLER_CONFIG" \
    --format env --no-file \
  | railway variables --service api --set-from-stdin
```

On completion the script prints **variable names only** — never values. If you see a
value in the terminal, stop and rotate that secret.

## Mask-and-forward for anything you have to log

If a value must appear in a PR, a Slack paste, or a debug log, mask it first with
the pattern from `docs/SECRETS.md`:

```bash
doppler secrets download --format json --no-file \
  | jq 'to_entries | map(
      if .key | test("KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL") then
        .value = { computed: (.value.computed // .value | tostring
                             | .[0:4] + "…" + .[-4:]),
                   note: "masked" }
      else . end
    ) | from_entries'
```

The real (unmasked) JSON goes straight into `railway variables`. The masked JSON is
the only thing that ever leaves the machine.

## Verifying the mirror

```bash
railway variables --service api      # names + masked values (Railway masks by default)
railway variables --service landing
```

If a name is missing on Railway that Doppler has, re-run the mirror script — do not
paste the value by hand.

## Rotation cheatsheet

| Secret | Cadence | Command |
| --- | --- | --- |
| `SESSION_SIGNING_KEY` | 90 days | `scripts/rotate-signing-keys.sh` |
| `IOS_MAPS_TOKEN_SIGNING_KEY` | on demand | `scripts/rotate-signing-keys.sh` |
| Any leaked secret | immediately | rotate at the provider, then re-mirror |

After any rotation, re-run the mirror script against every Railway service that uses
the changed secret so Railway sees the new value.
