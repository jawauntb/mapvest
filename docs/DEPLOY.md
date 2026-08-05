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
doppler secrets download --project cofounder --config stg --format env --no-file \
  | railway variables --service api set --from-stdin
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

# Production TestFlight
eas build --platform ios --profile production
eas submit --platform ios --latest
```

The build appears in App Store Connect → TestFlight → your internal group within ~15 min of upload.

### Demo group

Set up an **internal testing** group `mapvest-demo` and add teammates by Apple ID. They receive a TestFlight invite via email and install through the TestFlight app.

## Landing page → Docs

The landing page reads `docs/*.md` at build time. Any doc change requires a landing deploy to appear on `/docs/*`. This is intentional — production docs are always tagged with a specific commit.
