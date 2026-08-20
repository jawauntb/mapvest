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

### Domains

- Landing: `https://mapvest.app` — public site. `www.mapvest.app` is the Railway custom domain on the `landing` service (port 3000). The apex `301`s to `www` at GoDaddy.
- API: `https://api-production-4b27.up.railway.app` — Railway service domain. No custom API host yet.

The previous landing URL `https://landing-production-ce7b.up.railway.app` still resolves and can stay as a fallback.

## TestFlight (iOS)

### Prerequisites

- Apple Developer account (paid) — team ID recorded in `apps/ios/eas.json`.
- Xcode 16+ on the build machine (locally). `xcodebuild -version` must succeed.
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

GitHub Action `ios-eas-production` (`.github/workflows/ios-eas-production.yml`) cuts a production TestFlight after **green `ci` on `main`**, the same `workflow_run` gate as Railway `deploy.yml`. It checks out that merge SHA, waits for EAS (so a `PRE_INSTALL_HOOK` or compile miss is a red check), then `--auto-submit`s to App Store Connect.

Also:

- **Manual:** Actions → `ios-eas-production` → Run workflow (on `main`)
- **Tag:** `git tag v0.1.0 && git push origin v0.1.0`

Requires repo secret `EXPO_TOKEN` (Expo access token). Apple signing + ASC submit stay in EAS-managed credentials. Do not set `EAS_NO_VCS=1`.

The build appears in App Store Connect → TestFlight → your internal group within ~15 min of upload. Production submits are serialized (`concurrency: ios-eas-production-store`).

Public join URL (landing CTA): https://testflight.apple.com/join/yvYrrxbM

### Demo group

Set up an **internal testing** group `mapvest-demo` and add teammates by Apple ID. They receive a TestFlight invite via email and install through the TestFlight app. Testers can also use the public join link above.

## Landing page → Docs

The landing page reads `docs/*.md` at build time. Any doc change requires a landing deploy to appear on `/docs/*`. This is intentional — production docs are always tagged with a specific commit.
