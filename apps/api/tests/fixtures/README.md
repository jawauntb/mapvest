# Test image fixtures

This directory holds inputs for the vision-pipeline integration tests
(`apps/api/tests/integration/identify.integration.test.ts`) and the demo
GIFs used in the landing page.

We do **not** ship the JPEGs themselves in git. They are third-party
photographs whose licence terms we don't want to embed in this repo.
Instead we ship a small manifest of public-domain / free-use image URLs
in [`urls.json`](./urls.json), and the tests download them on demand.

## Files in this directory

| File | Purpose |
| --- | --- |
| `README.md` | This file. |
| `urls.json` | Manifest of remote images + expected `{brand, ticker}` results. |
| `stubs/` | Generated at test time by `apps/api/scripts/generate-stub-images.ts`. Contains 5 tiny 8×8 PNGs used for shape/size assertions without any network I/O. |
| `*.jpg` (optional) | If you drop real JPEGs here (matching the filenames in `urls.json`), the integration test will use the local copy instead of hitting the network. |

## Adding real images locally

If you want the integration tests to run against a bulletproof local
snapshot rather than the internet:

1. Open `urls.json` and, for each entry, download the linked image into
   this directory using the entry's `filename` field, e.g.
   `curl -L "$url" -o apps/api/tests/fixtures/mcdonalds-storefront.jpg`.
2. Rerun the integration test.
3. **Do not commit the JPEGs.** They are ignored via `apps/api/tests/fixtures/.gitignore`.

The images we curate come from:

- **Wikimedia Commons** — public-domain or CC-BY-SA photographs of
  storefronts, product packaging, and logos. Each entry in `urls.json`
  points at the direct `upload.wikimedia.org` URL of the source file
  and records the licence in the `license` field.
- **Product packaging** where the trade dress is functional / no
  copyright is claimed on plain wrappers (e.g. Hershey's bar, Starbucks
  cup, Nike swoosh on a shoe).

## What each fixture is for

Each entry in `urls.json` carries three things the integration test
needs:

- `url` — the remote fetch target.
- `filename` — where to cache it locally (also used as the "did the user
  drop it in manually?" lookup key).
- `expected.brand` and `expected.ticker` — the assertion the test makes
  after calling `identifyFromImage()`.

The brands are chosen to exercise a range of sectors and to match the
Phase 2 acceptance criteria in `IMPLEMENTATION_PLAN.md`:

- McDonald's storefront → `MCD` (Consumer Discretionary)
- Hershey's bar wrapper → `HSY` (Consumer Staples)
- Starbucks cup → `SBUX` (Consumer Discretionary)
- Walmart aisle sign → `WMT` (Consumer Staples)
- Nike shoe → `NKE` (Consumer Discretionary)
- Chevron pump → `CVX` (Energy)

## CI behaviour

- Normal `bun test` **skips** the integration file entirely — it only
  runs when `INTEGRATION=1`.
- When the integration test does run, set `MOCK_FIXTURES=1` to mock the
  `fetch()` for image downloads (used in CI so we don't hammer Wikimedia
  on every push). The mock returns a small in-memory PNG per URL; the
  real OpenRouter call to `identifyFromImage()` still executes with the
  Doppler-provided key, so the test verifies the full pipeline.
- The helper script `apps/api/scripts/run-integration.sh` sets both env
  vars for local runs against `doppler run --project cofounder --config dev`.

## Adding a new fixture

1. Find a Wikimedia Commons image (or another verifiably free-use image)
   that clearly shows the brand.
2. Append an entry to `urls.json` with the direct file URL, a filename,
   the expected brand + ticker, and the licence string.
3. If the image is not on Wikimedia, also add a note to the entry's
   `notes` field explaining why we believe it's safe to use.
