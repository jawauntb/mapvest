#!/usr/bin/env bash
# mirror-doppler-to-railway.sh
# Mirror every secret in a Doppler config into a Railway service.
#
# chmod +x this after clone:  chmod +x scripts/mirror-doppler-to-railway.sh
#
# Preconditions:
#   1. `railway link` has been run in this repo (verify with `railway status`).
#   2. DOPPLER_PROJECT and DOPPLER_CONFIG are exported.
#   3. `doppler`, `railway`, and `jq` are on PATH.
#
# Usage:
#   DOPPLER_PROJECT=mapvest DOPPLER_CONFIG=prd \
#     scripts/mirror-doppler-to-railway.sh <railway-service-name>
#
# Prints only the NAMES of variables that were set. Never prints values.

set -euo pipefail

service="${1:-}"
if [[ -z "$service" ]]; then
  echo "usage: $(basename "$0") <railway-service-name>" >&2
  exit 2
fi

: "${DOPPLER_PROJECT:?DOPPLER_PROJECT must be set (e.g. mapvest)}"
: "${DOPPLER_CONFIG:?DOPPLER_CONFIG must be set (e.g. dev or stg)}"

for bin in doppler railway; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: $bin not found on PATH" >&2
    exit 127
  fi
done

# Confirm the Railway CLI is linked to a project/environment.
if ! railway status >/dev/null 2>&1; then
  echo "error: 'railway link' has not been run in this directory" >&2
  exit 3
fi

# Pull secrets as KEY=VALUE lines, no file on disk. --no-file is required so
# nothing lands in a .env; the stream stays in memory.
#
# The Railway CLI historically accepted `--set-from-stdin`; current versions
# use one or more `--set KEY=VALUE` flags. We build the argv from the env
# stream so this script works on both — check `railway variables --help` if
# a newer stdin flag reappears.
#
# We never expand values into the shell — jq reads the raw env stream and
# emits (name, value) pairs on NUL boundaries so newlines and spaces inside
# values stay intact and never touch the terminal.

names=()

# shellcheck disable=SC2016
env_stream="$(doppler secrets download \
  --project "$DOPPLER_PROJECT" \
  --config  "$DOPPLER_CONFIG" \
  --format env --no-file)"

if [[ -z "$env_stream" ]]; then
  echo "error: doppler returned no secrets for $DOPPLER_PROJECT/$DOPPLER_CONFIG" >&2
  exit 4
fi

# Build the --set argv without ever echoing a value.
set_args=()
while IFS= read -r line; do
  # Skip blanks and comments.
  [[ -z "$line" || "$line" == \#* ]] && continue
  # Split on the first '='.
  key="${line%%=*}"
  val="${line#*=}"
  # Strip surrounding quotes that doppler adds for values with special chars.
  if [[ "$val" == \"*\" ]]; then
    val="${val:1:${#val}-2}"
    # Unescape doppler's shell escapes.
    val="${val//\\\"/\"}"
    val="${val//\\\\/\\}"
    val="${val//\\n/$'\n'}"
  fi
  set_args+=(--set "${key}=${val}")
  names+=("$key")
done <<< "$env_stream"

if (( ${#set_args[@]} == 0 )); then
  echo "error: no KEY=VALUE pairs parsed from doppler output" >&2
  exit 5
fi

# Push to Railway. The CLI itself never echoes values back.
railway variables --service "$service" "${set_args[@]}" >/dev/null

# Report ONLY names, sorted, one per line. Never values.
printf 'mirrored to railway service "%s" (%d vars):\n' "$service" "${#names[@]}"
printf '%s\n' "${names[@]}" | sort -u
