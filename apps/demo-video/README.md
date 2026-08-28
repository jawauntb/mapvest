# Mapvest launch video

Local Remotion 4 project for a 58.5-second launch walkthrough built from one typed storyboard. It
registers four delivery compositions with identical visuals:

- `MapvestLaunchPortraitMusic` — 1080×1920 with the accepted Lyria soundtrack
- `MapvestLaunchPortraitSilent` — 1080×1920 with no audio stream
- `MapvestLaunchSquareMusic` — 1080×1080 with the same soundtrack
- `MapvestLaunchSquareSilent` — 1080×1080 with no audio stream

The story covers the live map, a location-aware Flatiron Local Economy Brief, camera recognition of
a MacBook as Apple / AAPL, Your Universe, AAPL detail and sourced research, Mapvest Daily, and the
launch CTA. Financial values stay inside real captured UI or the sanitized production-identify
provenance; the motion layer does not invent market data.

## Edit the story

`src/storyboard.ts` owns scene order, timings, copy, assets, formats, and output names. Print the
current shot list before changing anything:

```sh
bun run launch:plan
```

Changing the storyboard updates all four compositions. `src/storyboard.test.ts` protects scene
order, duration, transition overlaps, and the shared-visual variant contract.

## Capture and prepare real app media

Use a logged-in development client and a public test location. The Home anchors are deliberately
development-only:

```text
mapvest://map
mapvest://home?demoSection=local
mapvest://universe
mapvest://home?demoSection=daily
```

Set the simulator to Flatiron (`40.7411,-73.9897`), hide personal Finds on the map, and keep raw
signed-in captures outside the repository. Place these source files in a temporary capture folder:

```text
map-raw.mp4
local-brief-raw.png
universe-raw.png
daily-raw.png
```

Then prepare exact-length, H.264, 1206×2622, privacy-safe scene assets:

```sh
bun scripts/launch-video.ts prepare --capture-dir /tmp/mapvest-launch-captures --force
```

The prepare step removes the personal Universe journal before writing `public/universe.mp4` and
records output hashes in `public/provenance/launch-captures.json`. Review every prepared asset before
committing it. Never commit the raw folder, the account drawer, an email address, Photos thumbnails,
research history, a private watchlist name, or a native share sheet.

The camera, detail, and research scenes reuse their existing pre-trimmed real simulator assets.
Replace those scene-scoped clips independently when their UI changes.

## Generate or keep the soundtrack

The accepted soundtrack is generated once, normalized to 58.5 seconds, and reused. Normal rendering
never calls an external model.

```sh
bun scripts/generate-music.ts --dry-run
doppler run --project shared --config dev_personal -- \
  bun scripts/launch-video.ts music --force
```

The generator reads `GEMINI_API_KEY` only from the environment, sets `store: false`, never logs the
credential or raw response, does not retry, and refuses to overwrite without `--force`. Lyria 3 Pro
is a preview, nondeterministic paid model; the current estimate is $0.08 per generated song. The
accepted MP3 and sanitized provenance make normal renders deterministic. Every generated track has
SynthID, and the prompt explicitly excludes vocals, samples, copyrighted melodies, and artist
imitation.

## Preview, render, and verify

```sh
bun run start
bun run typecheck
bun test
bun scripts/launch-video.ts render
bun scripts/launch-video.ts verify
```

Rendering stages all four variants and publishes them together only after every composition
succeeds. It also writes an ignored `out/launch-render-manifest.json` that binds the completed set
to the storyboard, composition source, soundtrack, prepared-capture provenance, referenced assets,
and output hashes.

The verifier rejects missing, mixed, modified, or stale render sets before checking duration,
dimensions, 30 fps H.264/yuv420p video, stereo AAC only in the music versions, no audio stream in
silent versions, and full-timeline perceptual parity (SSIM ≥ 0.999) between each music/silent pair.
Outputs land in ignored files under `out/`.

## Asset provenance

- `map-nearby.mp4`, `local-economy-brief.mp4`, `universe.mp4`, `watchlist-daily.mp4`: exact-length,
  privacy-safe media prepared from the real iPhone simulator
- `camera-flow.mp4`, `market-detail-aapl.mp4`, `research-aapl.mp4`: pre-trimmed real simulator clips
- `macbook-test.png`: synthetic MacBook test photo sent through the production identify path
- `provenance/macbook-identify.json`: sanitized real identify result used for visible Apple / AAPL
  copy and sources
- `music/mapvest-launch.mp3`: accepted Lyria output, normalized once for the launch timeline
- `music/mapvest-launch.provenance.json`: prompt/output hashes and non-secret technical metadata
- `brand/mark.svg`, `brand/wordmark.svg`: Mapvest brand assets
