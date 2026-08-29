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

## Audition four replacement soundtracks

The audition workflow is separate from the accepted soundtrack above. It never changes
`public/music/mapvest-launch.mp3`, its provenance, either silent master, the storyboard, or the
normal four-render manifest. It creates these four intentionally different directions:

| Candidate | Direction |
|---|---|
| Street Grid | 112 BPM human, slightly off-grid urban broken-beat |
| Pocket Library Funk | 101 BPM clever, restrained modern library funk |
| Felt Cartography | 94 BPM intimate chamber minimalism |
| Magnetic North | 106 BPM exploratory analog electro |

Every prompt asks for a 72–75 second original instrumental with a complete first 58.5-second arc
matched to the launch-video scenes. Vocals, vocal-like textures, samples, recognizable melodies,
copyrighted material, and artist imitation are explicitly excluded.

Choose one new absolute destination under `/Users/jawaun`; it must not exist yet. Pass the accepted
portrait and square **silent** renders explicitly. First run the read-only dry-run:

```sh
bun run music:alternatives -- \
  --output-dir /Users/jawaun/mapvest-launch-music-options \
  --portrait-master /Users/jawaun/mapvest-launch-portrait-silent.mp4 \
  --square-master /Users/jawaun/mapvest-launch-square-silent.mp4 \
  --dry-run
```

The dry-run validates both masters and all four prompts, makes no request, creates no directory,
and reports the four-request estimate of `$0.32`. Generate only after that output is correct:

```sh
doppler run --project shared --config dev_personal -- \
  bun run music:alternatives -- \
    --output-dir /Users/jawaun/mapvest-launch-music-options \
    --portrait-master /Users/jawaun/mapvest-launch-portrait-silent.mp4 \
    --square-master /Users/jawaun/mapvest-launch-square-silent.mp4
```

Generation makes exactly one paid request for each candidate, sequentially, with no retry. Before
the first request it acquires an exclusive sibling lock, preflights macOS `RENAME_EXCL` on the
destination filesystem, verifies the FFmpeg/FFprobe encoders and muxer, and confirms the output
parent is writable. Generation is macOS-only; unsupported platforms fail before a paid request. A
sibling staging directory holds all work. Pre-request failures clean that directory. Once a paid
response is persisted, a later failure or signal preserves the evidence in a uniquely named sibling
`.failed-...` quarantine and reports its JSON-escaped path. The command validates every artifact
and both unchanged master hashes before exclusive immutable publication. A signal received after
publication reports the completed result. Existing or concurrently locked destinations are always
refused; there is no force or overwrite option.

Verify the published directory again at any time without making a model request:

```sh
bun run music:alternatives:verify -- \
  --output-dir /Users/jawaun/mapvest-launch-music-options \
  --portrait-master /Users/jawaun/mapvest-launch-portrait-silent.mp4 \
  --square-master /Users/jawaun/mapvest-launch-square-silent.mp4
```

The immutable directory contains eight videos, four MP3/provenance pairs, and one manifest:

```text
street-grid.mp3
street-grid.provenance.json
street-grid-portrait.mp4
street-grid-square.mp4
...the same four files for pocket-library-funk, felt-cartography, and magnetic-north
music-alternatives-manifest.json
```

The verifier checks the exact file set, whole-file SHA-256 values, 58.5-second duration, dimensions,
30 fps H.264 video, 48 kHz stereo AAC audio with full-timeline packet coverage, unchanged video
payload and timestamps from each silent master, and identical audio packets across each
portrait/square pair. The manifest binds those checks to the four prompts and explicit master paths.

For review, open the directory and watch all four portrait cuts first, then the matching square
cuts on the same headphones and at the same volume:

```sh
open /Users/jawaun/mapvest-launch-music-options
```

Pick the direction by candidate title. Do not copy an audition MP3 over the accepted soundtrack
until the chosen portrait and square videos have both passed review.

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
