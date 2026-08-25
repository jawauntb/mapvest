# Share-to-Mapvest + home-screen widgets

Two related features that let Mapvest live outside the app itself:

1. **Share-to-Mapvest** — share any photo from Photos, Messages, Safari,
   Chrome, Claude, ChatGPT, Google Photos, or anywhere else the OS shows a
   share sheet, and Mapvest shows up as a target, the same way "Open in…"
   does for a photo. Mapvest identifies the shared image and offers to save
   the ticker or open the full detail sheet.
2. **Home-screen widgets** — a "Nearby" list widget and a "Nearby" map
   widget (iOS WidgetKit + Android App Widget) showing investable brands
   near the last location Mapvest saw, without opening the app.

Both ship as real source in this repo, but **both require a native rebuild
to activate** — `bun test`/`tsc --noEmit` cover the JS/TS surface and the
API endpoints, but a share extension and a widget extension are separate
native targets that only exist after `expo prebuild` regenerates the `ios/`
and `android/` directories. This environment has no Xcode/Android Studio
to build and smoke-test those targets, so treat everything under
"Activation checklist" below as required, not optional, before the next
TestFlight/Play build.

## Share-to-Mapvest

- **Library**: [`expo-share-intent`](https://github.com/achorein/expo-share-intent)
  (`5.1.1`, matches Expo SDK 54 — see the package's own SDK compatibility
  table before bumping). Its config plugin generates the iOS Share
  Extension target and the Android `ACTION_SEND` intent filters at
  `expo prebuild` time — no hand-written native share-extension code lives
  in this repo.
- **Config**: `apps/ios/app.json` → `plugins: ["expo-share-intent", {...}]`.
  Accepts images, web URLs/pages, and text; only images run through
  `/v1/identify` today (see below).
- **Receiving flow**:
  - `apps/ios/app/_layout.tsx` mounts `ShareIntentProvider` after first
    paint (`DeferredShareIntent`) so a hung native init cannot black-screen
    launch. `ShareIntentListener` then routes to `/share-intent`.
  - Build 11–42 shipped **without** the provider (black-screen fix). Those
    IPAs will not show Mapvest in the iOS share sheet. Need a build after
    this wiring, plus the share-extension target from `expo prebuild`.
  - `apps/ios/app/share-intent.tsx` reads the shared image, runs it through
    the same `identifyPhoto()` call the Camera tab uses (with a best-effort
    location fix), and shows the same result card (Save / View details).
    A shared text/URL with no image shows a friendly "photos only for now"
    message instead of erroring.
- **Outbound half**: the detail sheet (`apps/ios/app/detail/[id].tsx`) has a
  header **Share** button using React Native's built-in `Share` API — the
  native OS share sheet, so a ticker can be shared right back out to
  Messages, Notes, Claude, etc. Shared investables use the canonical
  `https://www.mapvest.app/app/ticker/{symbol-or-brand}` URL. The `www` host
  serves the landing app directly (the apex currently redirects there), so
  Apple can fetch its association file without following a redirect. The web
  app resolves that route for recipients without Mapvest; iOS builds associate
  `mapvest.app` and rewrite the same path to native `/detail/[id]` through
  `app/+native-intent.tsx`. The AASA file is served from
  `apps/landing/public/.well-known/apple-app-site-association`.

### Activation checklist (share)

1. `cd apps/ios && bun install` (pulls `expo-share-intent`).
2. `bunx expo prebuild --clean` — regenerates `ios/`/`android/` with the
   share extension target and Android intent filters wired in.
3. If prebuild reports `Config sync failed` on the Xcode project mod, see
   the `patch-package` note in the `expo-share-intent` README ("Config sync
   failed" section) — this is a known issue with some Xcode project
   versions and is fixed with a small patch, not a code change here.
4. `expo run:ios` / `expo run:android` in a simulator, then use the
   simulator's Photos app (or a browser) to share an image to Mapvest and
   confirm `/share-intent` opens with a result.
5. Before the next EAS build, check that only **one** iOS extension target
   exists in `app.json`/credentials (EAS flags multiple `appExtensions`
   entries — see expo-share-intent's README FAQ).
6. After deploying the landing app and installing a fresh native build, tap
   a `https://www.mapvest.app/app/ticker/AAPL` link from Notes or Messages. It
   must open AAPL detail in Mapvest; the same URL must remain a useful web
   ticker page on a device without the app.

## Universe summary sharing

The Universe screen's counterfactual summary has a dedicated outbound share
card. It is a fixed 4:5, Mapvest-branded PNG sized for social feeds and
contains only the server-produced summary: the hypothetical basis, find
coverage, value, and change. The card and its text fallback explicitly label
the result hypothetical and include `https://mapvest.app`; they never include
find photos, precise locations, email addresses, or raw Find records. They also
carry the server's calculation date, returned provider names, and the lowest
returned confidence. An empty source list is labeled uncited/low confidence;
the calculation date is not presented as quote freshness.

`apps/ios/src/util/share.ts` uses `react-native-view-shot@5.1.0` to capture the
off-screen card, then `expo-sharing` hands the PNG to the native share sheet.
If capture, native sharing, or the module is unavailable, the same summary is
shared as paste-safe text instead. The Share button shows a preparation state
until the off-screen card has laid out and its local brand mark is ready, then
blocks duplicate sheets until the current share attempt resolves.

This native module is activated only in a rebuilt binary. After dependency
changes, run `cd apps/ios && bun install && bunx expo prebuild --clean`, then
exercise the Universe Share button on an iOS simulator or device. A simulator
run should show the branded PNG in the native share sheet; forcing the
capture path unavailable should still produce the text fallback.

## Home-screen widgets

Both widgets read `GET /v1/widget/nearby` (trimmed nearby payload, capped
at 12 items, quotes on top 6 tickers) and the map widget additionally reads
`GET /v1/widget/map-snapshot` (a server-rendered Google Static Maps PNG).
See `apps/api/src/routes/widget.ts`. Both endpoints are public (no bearer
token) since a widget can't reliably hold a fresh session, and they return
the same public brand/ticker data `/v1/nearby` does.

**The map snapshot is server-rendered on purpose** — same rule as the iOS
maps SDK key (`docs/SECRETS.md`): a widget extension is a build artifact
distributed to end users, so it must never carry `GOOGLE_MAPS_API_KEY`
directly. If `GOOGLE_MAPS_API_KEY` isn't configured, `/v1/widget/map-snapshot`
returns `501` and the map widget falls back to the same list layout as the
"Nearby" list widget.

### Where the widgets get a location

Widgets can't prompt for GPS permission themselves. Whenever the Map or List
tab gets a location fix, it calls `saveLastLocationForWidgets()`
(`apps/ios/src/widgets/widgetLocation.ts`), which persists
`{lat, lng, capturedAt, source}`. A widget origin is fresh for six hours;
older or legacy coordinates are shown as stale/setup state and are never
queried or labeled "Nearby". A GPS fix uses `source: "device"`; a user-panned
map center uses `source: "map"` and is labeled "Map area" rather than
implying the device is there.

The storage paths are:

- **Android**: writes to `AsyncStorage` — the widget's headless task
  handler (`apps/ios/src/widgets/widget-task-handler.tsx`, registered from
  `apps/ios/index.js`) runs in the same JS engine and reads it straight
  back.
- **iOS**: mirrors the value into a shared App Group
  (`group.com.mapvest.app.widget`) via `@bacons/apple-targets`'
  `ExtensionStorage`, since the WidgetKit extension is a fully separate
  Swift process with zero JS/RN access. `targets/widget/NearbyModels.swift`
  reads it back with `UserDefaults(suiteName:)`.

A widget that has never seen a location shows “Set up your nearby location”
and asks the user to open Mapvest and visit Map. A stale location shows its
last-updated context and asks the user to refresh Mapvest. The six-hour
freshness window is deliberately shared by the TypeScript origin classifier
and the Swift WidgetKit target.

### Map and List context

Map and List share one app-side location context through the React Query
`tab-state` cache. Their precedence is: a linked map origin, the active
Map/device context, a cached map viewport, then the persisted widget origin.
With no usable origin, both screens enter an explicit loading state instead of
querying the demo viewport. Only the focused screen initiates the first-use
permission request; a frozen tab adopts the shared context when it regains
focus, avoiding duplicate prompts.

When no current foreground fix is available, the app labels visible data
“Explore demo area”, “Map area”, or “Last known location” and offers recovery.
A map/demo context uses **Use my location**; an unavailable fix uses **Try
again**; after iOS has denied the prompt, the action becomes **Open Settings**.
A current GPS fix is labeled “Nearby” / “Your location”; a user pan is labeled
“Map area”. List does not request an independent fallback or silently reset to
San Francisco — it consumes the same context and writes widget origins with the
matching `device` or `map` source.

### iOS — WidgetKit (`apps/ios/targets/widget/`)

Built with [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets)
(`4.0.7` — pinned below `5.x` because that version pulls in an
`@expo/prebuild-config` version tied to Expo SDK 55, not our SDK 54). Its
config plugin (`app.json` → `"@bacons/apple-targets"`) auto-discovers every
`targets/*/expo-target.config.js` and links the directory as a native
Xcode target at `expo prebuild` time — the Swift files below are hand
written, but the Xcode project wiring, `Info.plist`, and entitlements are
generated.

- `expo-target.config.js` — target type `widget`, App Group entitlement.
- `NearbyModels.swift` — DTOs mirroring `WidgetNearbyResponse`
  (`packages/core`), the timestamped App Group reader, freshness classifier,
  deep-link builders, and the two `fetch*` network calls (plain `URLSession`,
  no dependencies).
- `NearbyProvider.swift` — shared `TimelineProvider`, refreshes every 30
  minutes.
- `NearbyListWidget.swift` — small/medium/large list of nearby brands with
  ticker/comparable labeling, distance, and last-updated context. Each ticker
  row opens its detail route; the widget surface opens Map centered on the
  shown origin.
- `NearbyMapWidget.swift` — medium/large map snapshot with the nearest brand,
  ticker/comparable label, distance, and last-updated context; the widget opens
  Map centered on the shown origin and falls back to an honest text state when
  the origin is not fresh or the snapshot is unavailable.
- Android applies the same setup/stale/map-area headers, adjusts visible rows
  to the widget's current height, and deep-links ticker rows to Detail.
- `MapvestWidgetBundle.swift` — `@main` `WidgetBundle` registering both.
- `ColorHex.swift` — the RN app's palette (`apps/ios/src/theme/tokens.ts`)
  mirrored as plain hex `Color` values, so the widget target doesn't need
  its own Xcode asset-catalog color story.

Deployment target is pinned to iOS 16 in `expo-target.config.js` — the
widgets intentionally avoid iOS 17-only APIs (SwiftUI `Map`,
`containerBackground(for:)`) so they build against the same minimum iOS
version as the main app.

### Android — App Widget (`apps/ios/src/widgets/`)

Built with [`react-native-android-widget`](https://github.com/sAleksovski/react-native-android-widget)
(`0.21.0`) — the widget UI is JSX (`FlexWidget`/`TextWidget` primitives
rendered to native RemoteViews), not hand-written Kotlin. Android
RemoteViews can't embed a live map surface or an arbitrary bitmap easily
without extra plumbing, so the Android widget is list-only for now; the
"map" experience on Android is the iOS map widget's fallback list, reused.

- `app.json` → `["react-native-android-widget", { widgets: [...] }]`
  registers the `NearbyWidget` App Widget provider (30 min update period,
  resizable) — this generates the `AndroidManifest.xml` entry and
  `res/xml/*_widget_info.xml` at prebuild time.
- `apps/ios/index.js` replaces the default `expo-router/entry` as the app's
  `main` so the widget's headless task can be registered alongside
  expo-router's own bootstrapping — the headless task lives outside
  file-based routes by design.
- `src/widgets/widget-task-handler.tsx` — handles `WIDGET_ADDED` /
  `WIDGET_UPDATE` / `WIDGET_RESIZED` by fetching `widgetData.ts` and calling
  `renderWidget()`.
- `src/widgets/widgetData.ts` — fetch + origin resolution (mirrors
  `NearbyModels.swift`'s Swift version).
- `src/widgets/NearbyWidget.tsx` — the JSX widget UI itself.

### Activation checklist (widgets)

1. `cd apps/ios && bun install` (pulls `@bacons/apple-targets`,
   `react-native-android-widget`).
2. Set `ios.appleTeamId` in `app.json` before an EAS/Xcode build — the
   plugin warns (does not hard-fail prebuild) without it, but the widget
   extension target won't code-sign.
3. `bunx expo prebuild --clean`.
4. iOS: open `xed ios`, confirm the "MapvestWidgets" target builds, add the
   widget to a simulator home screen, and confirm it shows the placeholder
   data before the network call resolves and real data after.
5. Android: `expo run:android`, long-press the home screen → Widgets →
   "Mapvest Nearby", confirm it renders and updates after visiting the Map
   or List tab (which seeds the last-known location).
6. Both: hit `GET {API_URL}/v1/widget/nearby?lat=37.7749&lng=-122.4194` and
   `GET {API_URL}/v1/widget/map-snapshot?lat=37.7749&lng=-122.4194` directly
   to confirm the deployed API is serving them (the map snapshot 501s until
   `GOOGLE_MAPS_API_KEY` is set on Railway — see `docs/SECRETS.md`).

## API surface

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /v1/widget/nearby` | none | Trimmed nearby payload (≤12 items, quotes on top 6 tickers) |
| `GET /v1/widget/map-snapshot` | none | Server-rendered static map PNG; `501` if `GOOGLE_MAPS_API_KEY` unset |

Both share `apps/api/src/lib/nearby-resolve.ts` with `/v1/nearby` — the
Google Places → Overpass → Photon cascade and brand→ticker join are
identical, just capped smaller. Schemas: `WidgetNearbyItem` /
`WidgetNearbyResponse` in `packages/core/src/schemas`. Regenerated into
`openapi.yaml` / `postman.json` via `bun run openapi && bun run postman`
per AGENTS.md §6 — do not hand-edit those files.
