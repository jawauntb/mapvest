# Deploy

Two production surfaces:

1. **Railway** — API + landing page + Postgres.
2. **TestFlight** — iOS app.

## Railway

### First-time project setup

```bash
railway login
railway init                # create a new project 'mapvest'
railway link                # link this repo to it
```

### Services

Create two Railway services from this repo:

- `api` — root: `apps/api`, start command: `bun run start`, healthcheck: `/v1/health`
- `landing` — root: `apps/landing`, start command: `bun run start`
- (Plugin) Postgres

### Variables

Shared Massive credentials are authoritative in Doppler `shared/prd` (personal
workplace) and should reach Railway through the Doppler integration, never
copied into Railway variables. Service-specific Mapvest values may remain in
their own service project. See `infra/doppler/README.md` for the separation.

### Deploy

- Auto-deploy on push to `main` via GitHub integration.
- Manual: `railway up --service api`.

### Research verification

After the API deployment is healthy, open or refresh a pre-existing saved
research thread from an internal account. The thread should load without a
research service unavailable message; this read-only check does not admit a new
generation or spend quota.

If it fails, compare the deployed `DERIVATION_RESEARCH_API_ORIGIN` with the
Console's current canonical origin. `RESEARCH_CONSOLE_FORWARDED_HOST` must be
unset for direct Railway-to-Railway traffic and set only when a real trusted
proxy is in the path. Do not rotate, print, or paste service tokens while
diagnosing host configuration.

### Domains

- Landing: `https://mapvest.app` — public site. `www.mapvest.app` is the Railway custom domain on the `landing` service (port 3000). The apex `301`s to `www` at GoDaddy.
- API: `https://api-production-4b27.up.railway.app` — Railway service domain. No custom API host yet.

The previous landing URL `https://landing-production-ce7b.up.railway.app` still resolves and can stay as a fallback.

## TestFlight (iOS)

### Prerequisites

- Apple Developer account (paid) — team ID recorded in `apps/ios/eas.json`.
- Xcode 26.0 for production-equivalent local builds. `xcodebuild -version`
  must succeed.
- EAS CLI: `bun add -g eas-cli` (or `bunx eas ...`).

### First-time

```bash
cd apps/ios
eas login
eas init                   # creates the EAS project
eas credentials            # let EAS manage signing
```

Bundle id: `com.mapvest.app` (change if the Apple team requires).

### Build + submit

```bash
# Preview / internal
eas build --platform ios --profile preview

# Production TestFlight (local / cloud agent with EXPO_TOKEN)
cd apps/ios
eas build --platform ios --profile production --auto-submit --non-interactive
```

### CI (automatic)

GitHub Action `ios-eas-production` (`.github/workflows/ios-eas-production.yml`) cuts a production TestFlight after **green `ci` on `main`**, the same `workflow_run` gate as Railway `deploy.yml`. It checks out that merge SHA, validates the external-distribution workflow after authenticated EAS setup, waits for EAS (so an invalid distribution workflow, `PRE_INSTALL_HOOK`, or compile miss is a red check), then `--auto-submit`s to App Store Connect. After App Store Connect reports that exact upload complete, `apps/ios/.eas/workflows/testflight-external.yml` assigns its Apple build ID to the external `friend-testers` group and submits it for Beta App Review.

Every production release first runs the `production-preflight` profile as a
local macOS EAS build. It uses the same EAS-managed production certificate and
provisioning profiles but has `autoIncrement: false`, so a signing mismatch
fails before EAS reserves another cloud build number. This is unconditional:
it also catches profiles changed, revoked, or expired outside the repository.
The cloud profile pins Expo's `macos-sequoia-15.6-xcode-26.0` image, while the
GitHub preflight explicitly selects the available Xcode 26.0 generation rather
than its moving default. Local EAS does not reproduce every cloud-image tool;
its required invariant here is a complete archive using the production
credentials before the cloud build can start.

Also:

- **Manual:** Actions → `ios-eas-production` → Run workflow (on `main`)
- **Tag:** `git tag v0.1.0 && git push origin v0.1.0`

Requires repo secret `EXPO_TOKEN` (Expo access token). Apple signing + ASC submit stay in EAS-managed credentials. Do not set `EAS_NO_VCS=1`. `eas.json` uses `cli.appVersionSource: remote` so every merge gets a unique `buildNumber` without a sync commit.

### Capability or entitlement changes

Apple provisioning profiles capture the app's entitlements when they are
created. Capabilities needed before Expo prebuild must be declared in
`ios.entitlements`; `ios.associatedDomains` is mirrored there for that reason.
After changing either field, an Expo config plugin, or a native target's
entitlements, regenerate only the affected profile before releasing:

```bash
cd apps/ios
eas credentials -p ios
```

Choose `production`, log into Apple, open **Build Credentials**, delete the
affected target's provisioning profile, then choose **All** and generate a new
profile while reusing the distribution certificate. Do not delete unrelated
share-extension or widget profiles. The local signing preflight is the
enforcement gate; `--clear-cache` does not refresh signing credentials.

The build appears in App Store Connect → TestFlight → the automatic internal groups after processing. The external `friend-testers` build then advances through Apple's Beta App Review; production submits remain serialized (`concurrency: ios-eas-production-store`). The EAS workflow binds distribution to the upload event's Apple build ID rather than a racy "latest" lookup.

Public join URL (landing CTA): https://testflight.apple.com/join/yvYrrxbM

### Tester groups

The populated external group is `friend-testers`, backed by the public link above. Every completed upload is added to it automatically and submitted for review. Apple decides when review is required; testers decide whether TestFlight's Automatic Updates setting installs the approved build on their devices.

The Expo project is connected to App Store Connect app `6798832989`. Verify the connection and workflow schema from `apps/ios` with `eas integrations:asc:status --json` and `eas workflow:validate .eas/workflows/testflight-external.yml --non-interactive`.

## Landing page → Docs

The landing page reads `docs/*.md` at build time. Any doc change requires a landing deploy to appear on `/docs/*`. This is intentional — production docs are always tagged with a specific commit.
