# Launch video workflow

Mapvest includes a local Remotion project for a 58.5-second, fully fledged product launch video. One
typed storyboard drives four exports: portrait and square, each with music and completely silent.

## What the launch story covers

1. Live map and nearby investable places at a public Flatiron test location
2. A real, sourced Local Economy Brief for that location
3. A MacBook test image identified through the real camera flow as Apple / AAPL
4. Your Universe summary, sector dex, rarity, and quests
5. Real AAPL chart/detail UI
6. Ticker-bound AAPL research with evidence attached
7. Mapvest Daily generated from the watchlist
8. `mapvest.app` CTA

Run `bun run demo:video:plan` at the repository root to print the exact timings, copy, assets, capture
anchors, and output variants. Amend `apps/demo-video/src/storyboard.ts` to update all four cuts.

## Rebuild commands

```sh
bun install
bun run demo:video:plan

# After placing reviewed raw captures in a temporary folder:
cd apps/demo-video
bun scripts/launch-video.ts prepare --capture-dir /tmp/mapvest-launch-captures --force

# Only when intentionally replacing the accepted track (one paid, nondeterministic request):
doppler run --project shared --config dev_personal -- \
  bun scripts/launch-video.ts music --force

bun test
bun run typecheck
bun scripts/launch-video.ts render
bun scripts/launch-video.ts verify
```

Outputs are ignored local files:

- `apps/demo-video/out/mapvest-launch-portrait-music.mp4`
- `apps/demo-video/out/mapvest-launch-portrait-silent.mp4`
- `apps/demo-video/out/mapvest-launch-square-music.mp4`
- `apps/demo-video/out/mapvest-launch-square-silent.mp4`

The render command stages and publishes those four files as one completed set. Its ignored
`apps/demo-video/out/launch-render-manifest.json` records hashes for the inputs and outputs; the
verify command rejects a partial set, a hand-modified file, or renders made before a storyboard,
capture, soundtrack, or composition-source change.

## Capture contract

Commit only scene-scoped media that has already been made privacy-safe. Raw signed-in walkthroughs
remain outside Git. Use the public Flatiron coordinate, hide Finds on the map, and use the dev-only
Home anchors:

```text
mapvest://home?demoSection=local
mapvest://home?demoSection=daily
```

The prepare script trims assets to storyboard duration and physically removes the lower personal
find journal from the Universe asset. Still review every output for account/email information,
private locations, Photos thumbnails, research history, private list names, or share sheets.

Market prices, returns, research evidence, and Local/Daily brief content must remain in captured
application UI. Never rewrite those values in the motion layer. The Apple result card may only read
from `public/provenance/macbook-identify.json`.

## Music contract

`music/mapvest-launch.prompt.txt` is the editable score brief. `scripts/generate-music.ts` calls
Lyria 3 Pro once through `GEMINI_API_KEY` supplied by Doppler `shared/dev_personal`, asks Google not
to store the interaction, validates the response, trims and loudness-normalizes it, and writes only
the accepted MP3 plus sanitized provenance. It never retries automatically or prints credentials.

The accepted track is original instrumental music with SynthID. Lyria is a paid preview model and
does not guarantee byte-for-byte regeneration or exclusivity, which is why the accepted artifact
and its SHA-256 are retained. Silent compositions contain no audio stream at all.

## Reusable master prompt

Copy this into a new Codex task for another project, replacing bracketed values:

```text
Create a fully fledged launch video for [APP_NAME] in [REPO_PATH] using local Remotion or another
free local renderer. Use real app/simulator/browser footage and real product outputs; do not invent
data. Deliver portrait 1080x1920 and square 1080x1080 versions, each both with original
instrumental music and with no audio stream, saved to [OUTPUT_DIR].

First inspect the product and turn every major feature in [FEATURE_LIST] into one coherent story,
ending with [CTA]. Use [PUBLIC_TEST_DATA_OR_LOCATION] for any sensitive flow. Never capture or
commit accounts, email addresses, private locations, upload pickers, personal history, list names,
secrets, or full signed-in walkthroughs. Keep raw captures outside Git and commit only reviewed,
scene-scoped, physically redacted assets.

Build one typed storyboard that owns scene order, timings, copy, asset paths, output names, and all
four variants. Add reusable scripts to print the shot list, prepare exact-length assets, optionally
generate one soundtrack from Doppler without logging the key or retrying a paid call, render all
variants, and verify dimensions, duration, codecs, audio presence/absence, and full-timeline
perceptual parity between music and silent pairs. Keep music generation separate from normal
rendering and retain sanitized provenance/hashes for real outputs.

Visually review contact sheets for both aspect ratios, run the repo's lint, typecheck, and targeted
tests, then commit, push, open a PR, wait for CI, and merge only if authorized. Return the four local
video paths, the reusable commands, the storyboard path, the PR/merge status, and any limitations.
```
