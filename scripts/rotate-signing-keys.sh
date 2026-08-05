#!/usr/bin/env bash
# rotate-signing-keys.sh
# Mint fresh SESSION_SIGNING_KEY and IOS_MAPS_TOKEN_SIGNING_KEY values and
# store them in Doppler. These are the two secrets we generate ourselves —
# every other secret comes from a provider.
#
# chmod +x this after clone:  chmod +x scripts/rotate-signing-keys.sh
#
# Effects:
#   - SESSION_SIGNING_KEY (rotate every 90d — invalidates outstanding sessions).
#   - IOS_MAPS_TOKEN_SIGNING_KEY (rotate on demand — iOS re-issues on next boot).
#
# After rotation, re-mirror to Railway:
#   scripts/mirror-doppler-to-railway.sh api
#
# Environment:
#   DOPPLER_PROJECT (default: cofounder)
#   DOPPLER_CONFIG  (default: dev)  # set to stg for staging

set -euo pipefail

project="${DOPPLER_PROJECT:-cofounder}"
config="${DOPPLER_CONFIG:-dev}"

for bin in doppler openssl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: $bin not found on PATH" >&2
    exit 127
  fi
done

# Generate 32 raw bytes → 64 hex chars. Never echo the values.
session_key="$(openssl rand -hex 32)"
maps_key="$(openssl rand -hex 32)"

# `doppler secrets set` accepts NAME=VALUE pairs on the command line. It
# does NOT print the value back. We pipe from a heredoc through --no-interactive
# so the values never appear in shell history or on the terminal.
doppler secrets set \
  --project "$project" \
  --config  "$config" \
  --no-interactive \
  "SESSION_SIGNING_KEY=$session_key" \
  "IOS_MAPS_TOKEN_SIGNING_KEY=$maps_key" \
  >/dev/null

unset session_key maps_key

echo "rotated in doppler ${project}/${config}:"
echo "  SESSION_SIGNING_KEY"
echo "  IOS_MAPS_TOKEN_SIGNING_KEY"
echo
echo "next step: mirror to every Railway service that consumes these keys"
echo "  scripts/mirror-doppler-to-railway.sh api"
