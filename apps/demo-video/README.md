# Mapvest tweet demo video

Local Remotion 4 project for a 27-second, muted-autoplay product walkthrough. It registers:

- `MapvestTweetPortrait` — 1080×1920 at 30 fps
- `MapvestTweetSquare` — 1080×1080 at 30 fps

The timeline uses authentic simulator footage for the Camera, AAPL detail, and Research flows. The
MacBook test photo is composited only inside the simulator camera viewport. Market values appear only
inside captured live UI; the motion graphics do not invent a price or return.

## Preview

From the repository root:

```sh
bun install
bun run demo:video
```

Or from this directory:

```sh
bun run start
```

## Render

From the repository root:

```sh
bun run demo:video:render:portrait
bun run demo:video:render:square
```

Outputs are written to `apps/demo-video/out/`, which is ignored by Git. The package has no audio,
licensed music, hosted renderer, or renderer credential. Rendering happens entirely on the local
machine with Remotion's CLI.

## Replace the simulator clips

1. Record each signed-in flow separately at 1206×2622 (or another portrait aspect ratio).
2. Trim each recording to the intended flow before copying it into this package. Never store or
   commit a full signed-in walkthrough: Home, account, auth, email, and personal-find screens must not
   be present anywhere in a repository asset, even outside the rendered range.
3. Replace the dedicated H.264, muted clips in `public/`: `camera-flow.mp4` (3 seconds),
   `market-detail-aapl.mp4` (3.4 seconds), and `research-aapl.mp4` (5 seconds).
4. Replace the matching crisp holds in `public/` when UI or live values change.
5. Sanitize the matching identify response into `public/provenance/macbook-identify.json`. Keep only
   the displayed detection, investable mapping, source timestamps, and quote-provider metadata; never
   include credentials, account identifiers, request headers, or user data.
6. If a clip duration changes, update its `Sequence` duration in `src/MapvestTweet.tsx`, expressed in
   30 fps composition frames.
7. Run `bun run typecheck`, preview both compositions, and render locally.

The separate `research-complete.mp4` capture contains only one encoded frame;
`research-complete.png` provides the crisp completion/evidence hold.

## Asset provenance

- `camera-flow.mp4`, `market-detail-aapl.mp4`, `research-aapl.mp4`: privacy-safe, pre-trimmed clips
  from the real signed-in iPhone simulator
- `camera-live.png`, `detail-aapl-loaded.png`, `research-start.png`, `research-running.png`,
  `research-complete.png`: real simulator captures
- `macbook-test.png`: MacBook test photo used by the production identify API; verified as Apple / AAPL
  with high confidence
- `provenance/macbook-identify.json`: sanitized production identify response that supplies the visible
  Apple / AAPL result, confidence, providers, and capture timestamp
- `brand/mark.svg`, `brand/wordmark.svg`: Mapvest brand assets copied from the landing app

Keep all replacement media free of secrets, account identifiers, and personal data.
