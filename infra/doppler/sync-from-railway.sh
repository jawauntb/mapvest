#!/usr/bin/env bash
# Copy Railway production API variables into the service-owned Doppler project.
# This helper is not the Massive credential source; Massive lives in shared/prd.
# Never prints secret values. Refuses to run against the GIC workplace.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RAILWAY_PROJECT_ID="${RAILWAY_PROJECT_ID:-6c776d1f-1604-4cfe-a664-410bafe65455}"
RAILWAY_ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
RAILWAY_SERVICE="${RAILWAY_SERVICE:-api}"
DOPPLER_PROJECT="${DOPPLER_PROJECT:-mapvest}"
DOPPLER_CONFIG="${DOPPLER_CONFIG:-prd}"

workplace="$(doppler me --json --scope "$ROOT" 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("workplace",{}).get("name") or d.get("workplace") or "")' 2>/dev/null || true)"
if echo "$workplace" | grep -qi "general intelligence"; then
  echo "Doppler CLI is still on the GIC workplace ($workplace)." >&2
  echo "Log into the personal workplace, scoped to this repo:" >&2
  echo "  doppler login --scope $ROOT --overwrite" >&2
  echo "Pick workplace: jawaun personal. Do not pick General Intelligence Company." >&2
  exit 1
fi

if ! doppler projects --scope "$ROOT" --json 2>/dev/null | python3 -c "import json,sys; ids=[p.get('id') or p.get('name') for p in json.load(sys.stdin)]; raise SystemExit(0 if '$DOPPLER_PROJECT' in ids else 1)"; then
  echo "Creating Doppler project $DOPPLER_PROJECT" >&2
  doppler projects create "$DOPPLER_PROJECT" --description "Mapvest API + landing secrets" --scope "$ROOT"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

railway variable list --json \
  --project "$RAILWAY_PROJECT_ID" \
  --environment "$RAILWAY_ENVIRONMENT" \
  --service "$RAILWAY_SERVICE" \
  | python3 -c '
import json, sys, re
data = json.load(sys.stdin)
skip = re.compile(r"^RAILWAY_")
n = 0
for key, value in sorted(data.items()):
    if skip.match(key) or value is None:
        continue
    text = str(value).replace("\\", "\\\\").replace("\n", "\\n")
    print(f"{key}={text}")
    n += 1
sys.stderr.write(f"prepared {n} keys (values not printed)\n")
' > "$tmp"

doppler secrets upload "$tmp" --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --scope "$ROOT" --silent
echo "uploaded to $DOPPLER_PROJECT/$DOPPLER_CONFIG (values not printed)"
