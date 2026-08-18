#!/usr/bin/env bash
# Railway production vars + needed GIC provider tokens → personal Doppler.
# Never prints secret values. Refuses GIC workplace (enforced in the python).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec python3 "$ROOT/infra/doppler/sync-personal-apps.py"
