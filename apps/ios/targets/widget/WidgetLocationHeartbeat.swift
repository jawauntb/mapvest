import CoreLocation
import Foundation

/// Roadmap §2 B3 — "widget location heartbeat".
///
/// The main app only learns where you are when you open it. A home-screen
/// widget, on the other hand, gets woken by WidgetKit several times a day on
/// its own. With `NSWidgetWantsLocation` set in the extension's Info.plist,
/// the widget may read Core Location under the *containing app's* When-In-Use
/// authorization — no extra prompt, no Always ask, nothing for the user to
/// approve. Each timeline refresh takes one coarse fix, stashes it in the
/// shared App Group, and the next app foreground relays it to the server
/// heartbeat (`push_tokens.prefs.last_lat/last_lng`) via
/// `apps/ios/src/location/heartbeat.ts` → `syncWidgetFixIfFresh()`.
///
/// Why the extension doesn't POST directly: it has no session token (the
/// user's bearer token lives in the app's Keychain, not the App Group) and
/// widget refreshes get a very small execution budget. Writing a fix to the
/// App Group is cheap and always safe; the relay is the app's job.
///
/// DEFERRED ACCEPTANCE: like all of `targets/widget/` (Phase 9), nothing here
/// compiles or runs until the next `expo prebuild` + Xcode/EAS device build.
/// Simulator location is faked and widget location is not exercised in Expo
/// Go at all, so "server sees fixes move during a normal day" can only be
/// verified on the user's own device build.

/// Key the widget writes its captured fix under, in the App Group shared with
/// the app. Must match `IOS_WIDGET_FIX_KEY` in
/// apps/ios/src/widgets/widgetLocation.ts.
let widgetFixKey = "widgetLocationFix"

/// Key holding the most recent lat/lng from *either* side (app or widget).
/// `widgetOrigin()` in NearbyModels.swift reads this, and the app writes it
/// via `saveLastLocationForWidgets`. Same `{lat, lng}` JSON either way.
let widgetLastLocationKey = "lastLocation"

/// What the widget hands the JS side. `capturedAt` is epoch **milliseconds**
/// so it compares directly against `Date.now()` in heartbeat.ts.
struct WidgetLocationFix: Codable {
    let lat: Double
    let lng: Double
    let capturedAt: Double
}

/// One-shot Core Location fix for a widget timeline refresh.
///
/// Deliberately minimal: coarse accuracy (a heartbeat only needs to know
/// which neighborhood you're in — the server's move trigger is 2km), a hard
/// timeout so a slow fix can never stall the timeline, and completion called
/// exactly once on every path.
final class WidgetLocationHeartbeat: NSObject, CLLocationManagerDelegate {
    static let shared = WidgetLocationHeartbeat()

    /// Widget refreshes get a small execution budget — never spend more than
    /// this waiting on a fix before rendering with whatever origin we have.
    private static let fixTimeout: TimeInterval = 6

    /// Created lazily *on the main queue* (see `requestFix`). `CLLocationManager`
    /// delivers delegate callbacks on the run loop it was allocated on, and a
    /// widget timeline refresh runs on a background thread with no run loop —
    /// allocating there would mean callbacks that never arrive.
    private var manager: CLLocationManager?
    private var completion: ((WidgetLocationFix?) -> Void)?
    private var timeoutWork: DispatchWorkItem?

    private override init() {
        super.init()
    }

    /// Main queue only.
    private func mainQueueManager() -> CLLocationManager {
        if let existing = manager { return existing }
        let created = CLLocationManager()
        created.delegate = self
        // Hundred-meter accuracy is plenty for a "which part of town" ping and
        // costs a fraction of the power of a GPS-grade fix.
        created.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager = created
        return created
    }

    /// Requests a single fix, persists it to the App Group, and calls back.
    ///
    /// Always calls `completion` exactly once, on the main queue, including
    /// when location is unauthorized (widgets cannot prompt — they inherit
    /// the app's grant or get nothing) or when the fix times out.
    func requestFix(completion: @escaping (WidgetLocationFix?) -> Void) {
        DispatchQueue.main.async {
            // A second request while one is in flight: fail the newcomer
            // rather than stomping the pending completion.
            guard self.completion == nil else {
                completion(nil)
                return
            }

            let locationManager = self.mainQueueManager()
            let status = locationManager.authorizationStatus
            guard status == .authorizedWhenInUse || status == .authorizedAlways else {
                // Not authorized (or not determined — an extension can never
                // move that needle). Silent no-op, exactly as designed: B3
                // adds zero permission surface.
                completion(nil)
                return
            }

            self.completion = completion

            let timeout = DispatchWorkItem { [weak self] in
                self?.finish(with: nil)
            }
            self.timeoutWork = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.fixTimeout, execute: timeout)

            locationManager.requestLocation()
        }
    }

    private func finish(with fix: WidgetLocationFix?) {
        // Keeps `completion`/`timeoutWork` single-threaded on the main queue.
        guard Thread.isMainThread else {
            DispatchQueue.main.async { self.finish(with: fix) }
            return
        }
        let done = completion
        completion = nil
        timeoutWork?.cancel()
        timeoutWork = nil
        done?(fix)
    }

    private func persist(_ fix: WidgetLocationFix) {
        guard let defaults = UserDefaults(suiteName: appGroupId) else { return }
        let encoder = JSONEncoder()
        // The relay payload the app reads on next foreground.
        if let data = try? encoder.encode(fix) {
            defaults.set(data, forKey: widgetFixKey)
        }
        // Also refresh the shared origin so the *next* widget refresh centers
        // on where the user actually is, even if the app never reopens.
        // Same shape the app writes via `saveLastLocationForWidgets`.
        if let data = try? encoder.encode(WidgetLocation(lat: fix.lat, lng: fix.lng)) {
            defaults.set(data, forKey: widgetLastLocationKey)
        }
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0 else {
            finish(with: nil)
            return
        }
        let fix = WidgetLocationFix(
            lat: location.coordinate.latitude,
            lng: location.coordinate.longitude,
            capturedAt: location.timestamp.timeIntervalSince1970 * 1000
        )
        persist(fix)
        finish(with: fix)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Best-effort by design: the timeline still renders from the last
        // known origin (or San Francisco), same as before B3.
        finish(with: nil)
    }
}
