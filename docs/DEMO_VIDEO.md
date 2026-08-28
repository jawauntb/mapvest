# Demo video

Mapvest includes a local Remotion project for a 27-second, muted product walkthrough. It exports a
1080×1920 portrait video and a 1080×1080 square video from the same timeline. Rendering is local and
does not require a hosted renderer or renderer credential.

## Preview and render

Run these commands from the repository root:

```sh
bun run demo:video
bun run demo:video:typecheck
bun run demo:video:render:portrait
bun run demo:video:render:square
```

The renders are written to ignored local files:

- `apps/demo-video/out/mapvest-tweet-portrait.mp4`
- `apps/demo-video/out/mapvest-tweet-square.mp4`

## Media and data rules

Commit only privacy-safe simulator clips that have already been trimmed to the exact usable scene.
Never commit a full signed-in walkthrough or frames containing Home, account, authentication, email,
personal-find history, secrets, or device/user identifiers.

The MacBook identify provenance artifact is the source of truth for the displayed Apple ticker,
confidence, provider, and fetch timestamp. Update the artifact and the visible card together whenever
the production capture changes. Market prices, returns, research evidence, and other live financial
data must remain inside captured application UI and must never be fabricated for the video.
