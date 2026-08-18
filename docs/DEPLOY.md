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

Mirror Doppler into Railway service variables. Never paste raw secrets by hand:

```bash
See `infra/doppler/README.md`. Authoritative Mapvest secrets: Doppler `mapvest/prd` (personal workplace), mirrored to Railway `api`. Sibling Railway apps: `python3 infra/doppler/sync-personal-apps.py`.
```

### Deploy

- Auto-deploy on push to `main` via GitHub integration.
- Manual: `railway up --service api`.

### Domains

Generated Railway domains until custom is decided:

- API:      `mapvest-api-*.up.railway.app`
- Landing:  `mapvest-*.up.railway.app`

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

### CI (preferred)

GitHub Action `ios-eas-production` (`.github/workflows/ios-eas-production.yml`):

- **Manual:** Actions → `ios-eas-production` → Run workflow (on `main`)
- **Tag:** `git tag v0.1.0 && git push origin v0.1.0`

Requires repo secret `EXPO_TOKEN` (Expo access token). Apple signing + ASC submit stay in EAS-managed credentials. The job uses `--no-wait` so CI returns once EAS accepts the build.

The build appears in App Store Connect → TestFlight → your internal group within ~15 min of upload.

Public join URL (landing CTA): https://testflight.apple.com/join/yvYrrxbM

### Demo group

Set up an **internal testing** group `mapvest-demo` and add teammates by Apple ID. They receive a TestFlight invite via email and install through the TestFlight app. Testers can also use the public join link above.

## Landing page → Docs

The landing page reads `docs/*.md` at build time. Any doc change requires a landing deploy to appear on `/docs/*`. This is intentional — production docs are always tagged with a specific commit.
