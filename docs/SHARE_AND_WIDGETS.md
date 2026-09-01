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
  - `apps/ios/app/_layout.tsx` mounts `ShareIntentProvider` from the very
    first render but starts it `disabled`, flipping the provider's
    `disabled` option off after first paint (`DeferredShareIntent`) so a
    hung native init cannot black-screen launch. Do NOT go back to
    conditionally wrapping `children` in the provider: swapping the element
    type at that slot 800ms into launch remounted the entire app (query
    client, session, navigator, MapView) mid share-handoff and crashed
    "Share to Mapvest" cold-starts. `ShareIntentListener` then routes to
    `/share-intent`.
  - `apps/ios/app/+native-intent.tsx` short-circuits the extension's
    `mapvest://dataUrl=…` wake-up URL straight to `/share-intent` (and
    `app/+not-found.tsx` catches anything else) so the router never lands
    on the Unmatched screen mid-share.
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

iOS and Android intentionally use different data paths in this release:

- **iOS** renders one app-authored `WidgetDiscoverySnapshotV1`. After Map or
  List resolves nearby results, the app atomically composes public company
  cards with the current account's Find, quest, and Sector Dex truth. The
  WidgetKit extension never carries a bearer token, makes a personalized
  network join, or independently combines records from different refreshes.
- **Android** retains the existing public `GET /v1/widget/nearby` flow. Its
  redesign and atomic snapshot parity are deferred; the public endpoint and
  `GET /v1/widget/map-snapshot` remain supported for Android and backwards
  compatibility.

The iOS snapshot contains display-ready tickers, names, sectors, coarse
distances, collection/quest totals, freshness, account scope/epoch, exact
`mapvest:///` links, and up to three cited finance sources per card. Each card
shows its categorical confidence and source count; a public comparable for a
private brand is always labeled with `≈$` rather than presented as the brand's
own ticker. A card with no usable citation is forced to low confidence. The
snapshot excludes precise coordinates, bearer tokens, email, photos, provider
credentials, news, and price movement. The native widget marks signed-in
content and all device/map-derived guest content privacy-sensitive so iOS may
redact location-revealing signals when protected widget data is unavailable;
only the explicitly labeled demo area can remain public.

### Where the widgets get a location

Widgets can't prompt for GPS permission themselves. Whenever the Map or List
tab gets a location fix, it calls `saveLastLocationForWidgets()`
(`apps/ios/src/widgets/widgetLocation.ts`), which persists the origin for the
legacy Android path and the coarse iOS heartbeat. The iOS app separately
turns that context and its resolved nearby response into a display-only
snapshot with a six-hour expiry. A GPS result uses `source: "device"`; a
user-panned center uses `source: "map"` and is labeled "Map area" rather than
implying the device is there.

The storage paths are:

- **Android**: writes to `AsyncStorage` — the widget's headless task
  handler (`apps/ios/src/widgets/widget-task-handler.tsx`, registered from
  `apps/ios/index.js`) runs in the same JS engine and reads it straight
  back.
- **iOS**: mirrors both the heartbeat origin and one JSON snapshot string into
  the shared App Group (`group.com.mapvest.app.widget`) via
  `@bacons/apple-targets`' `ExtensionStorage`. The WidgetKit extension is a
  separate Swift process with zero JS/RN access;
  `targets/widget/NearbyModels.swift` validates the version, card bounds,
  links, account/epoch match, and expiry before rendering.

A widget with no valid snapshot asks the user to open Mapvest and visit Map.
Corrupt or account-mismatched snapshots fail closed. An expired, offline, or
permission-denied snapshot may show the matching last-good companies with an
explicit stale label; a valid empty result says no signals were resolved in
that area and never invents a ticker.

Map/List synchronization reuses the existing TanStack Query caches for Finds,
Dex, and quests, applies a 15-second deadline to the personal join, and limits
successful per-account WidgetKit reloads to one every 30 seconds. A newer map
area invalidates an older in-flight composition. Universe personalization uses
the snapshot ID as a compare-and-swap token, so it cannot overwrite a newer
proximity frame.

#### Account and notification lifecycle

WidgetKit location fixes are relayable only after the active account has a
successful push registration. The app writes an opaque registration epoch to
the App Group; the extension copies that account/epoch onto each captured fix,
and the foreground relay rejects missing, mismatched, pre-registration, stale,
or future fixes. The visual snapshot has its own account ID and authentication
generation epoch. Sign-out invalidates the in-memory writer before serialized
cleanup, and every read/write must match the exact supplied account. Account
activation is two-phase: the persisted scope changes before the writer commits,
so even a failed old-snapshot removal makes the previous frame scope-mismatched
and hidden. A same-generation guest transition after boot cleanup remains
valid, while late work from the removed account stays blocked. This prevents a
guest or later account from seeing, relaying, or contaminating an old account's
state.

Confirmed notification opt-out and sign-out stop visit monitoring and clear
the AsyncStorage origin plus the App Group `widgetLocationFix`, `lastLocation`,
and registration context. If cleanup cannot be verified, the session remains
in its truthful retry state rather than allowing another account to proceed.

### Map and List context

Map and List share one app-side location context through the React Query
`tab-state` cache. Their precedence is: a linked map origin, the active
Map/device context, a cached map viewport, then the persisted widget origin.
With no usable origin, both screens enter an explicit loading state instead of
querying the demo viewport; neither screen queries it while permission or
origin resolution is pending. If permission is denied or a fix is unavailable
with no selected map/known device origin, the app intentionally enters a
visibly labeled **Explore demo area** state and may query the configured demo
viewport (currently the San Francisco demo area). A frozen tab adopts the
shared context when it regains focus, avoiding duplicate prompts. Only the
focused screen initiates the first-use permission request; an outgoing tab
invalidates its in-flight application request before another tab can take
over. The platform permission prompt remains system-owned and single; a
blurred tab's eventual application callback is ignored.

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
- `NearbyModels.swift` — native snapshot DTOs plus strict App Group decoding,
  account/epoch selection, freshness classification, and preview truth.
- `NearbyProvider.swift` — shared `TimelineProvider`; requests a coarse
  heartbeat and rereads the app-authored snapshot every 30 minutes without
  making network requests or combining personalized records.
- `NearbyListWidget.swift` — **Nearby Dex** at small/medium/large sizes: one
  uncovered/caught target, exact company link, relevance and distance, then
  quest, Sector Dex, and additional signals as space permits.
- `NearbyMapWidget.swift` — **Discovery Signals** at medium/large sizes: an
  explicitly non-geographic distance field, closest target, quest, and Dex
  progress. It does not imply compass direction and never displays an
  independently fetched map image.
- `DiscoveryWidgetComponents.swift` — shared visual hierarchy, textual
  caught/uncovered status, source confidence, honest public-comparable labels,
  visible device/map/demo context, accessible labels, progress, and stale
  freshness.
- Android applies the same setup/stale/map-area headers, adjusts visible rows
  to the widget's current height, and deep-links ticker rows to Detail.
- `MapvestWidgetBundle.swift` — `@main` `WidgetBundle` registering both.
- `ColorHex.swift` — the RN app's palette (`apps/ios/src/theme/tokens.ts`)
  mirrored as plain hex `Color` values, so the widget target doesn't need
  its own Xcode asset-catalog color story.

Deployment target is pinned to iOS 16 in `expo-target.config.js`. The widgets
avoid an iOS 17-only SwiftUI map, but conditionally adopt
`containerBackground(for: .widget)` on iOS 17+ and retain the existing
background path on iOS 16. This keeps current WidgetKit rendering valid while
preserving the app's minimum iOS version.

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
4. iOS: open `xed ios`, confirm the "MapvestWidgets" target builds, add both
   widget kinds in every supported size, visit Map/List to author a real
   snapshot, and verify guest, signed-in, empty, stale/offline, denied,
   corrupt/setup, account-switch, failed-cleanup, and sign-out states plus every
   deep link. Confirm map/demo headers, `≈$` comparable labels, confidence/source
   copy, and lock-screen redaction for account and device/map guest snapshots.
5. Android: `expo run:android`, long-press the home screen → Widgets →
   "Mapvest Nearby", confirm it renders and updates after visiting the Map
   or List tab (which seeds the last-known location).
6. Android/backwards compatibility: hit
   `GET {API_URL}/v1/widget/nearby?lat=37.7749&lng=-122.4194` and
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
