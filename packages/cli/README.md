# @mapvest/cli

Small local CLI that hits the deployed Mapvest API. Useful for demos and power users.

Runs on [Bun](https://bun.sh) — no build step, no external CLI deps (arg parsing is hand-rolled).

## Install

The CLI lives inside the monorepo as a workspace package. There's nothing to install beyond running `bun install` at the repo root.

From the repo root you can invoke it either way:

```sh
# via the workspace bin (uses root package.json "bin" wiring)
bun run mapvest --help

# or directly through Bun
bun run packages/cli/src/index.ts --help
```

If you want a global `mapvest` on your `PATH`, link it once from inside the package:

```sh
cd packages/cli && bun link
```

Then `mapvest --help` works anywhere.

## Configuration

| Env var           | Default                                              | Purpose                              |
| ----------------- | ---------------------------------------------------- | ------------------------------------ |
| `MAPVEST_API_URL` | `https://api-production-4b27.up.railway.app`         | Base URL of the Mapvest API to hit.  |

Point it at a local API during development:

```sh
export MAPVEST_API_URL=http://localhost:8787
```

Check what the CLI resolved to:

```sh
mapvest --api-url
```

## Commands

### `mapvest identify <image-file>`

POSTs the file as `multipart/form-data` to `POST /v1/identify` and pretty-prints the top identified brand, its ticker, up to three comparables, and the top ETF exposure.

```sh
mapvest identify ~/Downloads/hersheys-bar.jpg
```

Sample output:

```
brand       Hershey's
parent      The Hershey Company
sector      Consumer Staples
public      yes
ticker      HSY (NYSE)
confidence  high
quote       190.12 USD (-1.23 / -0.64%)

comparables:
  MDLZ    Mondelez  score=0.82
  NSRGY   Nestle    score=0.71

top ETF: XLP  Consumer Staples SPDR  weight=1.23%
```

### `mapvest resolve <brand> [--sector <hint>]`

POSTs `{ brand, hintSector? }` to `POST /v1/resolve-comparable` and pretty-prints the brand, its comparables table, and its ETF exposures table.

```sh
mapvest resolve "In-N-Out" --sector Restaurants
```

### `mapvest quote <symbol>`

GETs `/v1/quote?symbol=…` and pretty-prints the provider-routed quote. The API's
disclaimer is printed verbatim (the provider remains the source of truth for
freshness and attribution).

```sh
mapvest quote HSY
```

### `mapvest nearby --lat <n> --lng <n> [--radius <m>] [--limit <n>]`

GETs `/v1/nearby` with the given coordinates and prints a table of nearby places and their tickers (when publicly investable).

```sh
mapvest nearby --lat 37.7749 --lng -122.4194 --radius 300 --limit 10
```

## Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| `0`  | Success.                                             |
| `1`  | Runtime error (network, filesystem, non-2xx API).    |
| `2`  | Usage error (missing / invalid args, unknown cmd).   |

## Tests

```sh
bun test packages/cli
```

The tests mock `globalThis.fetch` — they never hit the real API.

Sources: The API surface tested here is defined in [`apps/api/src/routes/`](../../apps/api/src/routes/) and typed by [`@mapvest/core` schemas](../core/src/schemas/index.ts).
