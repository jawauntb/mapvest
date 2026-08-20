import WidgetKit

/// Shared `TimelineProvider` for both the list and map widgets — they only
/// differ in `limit` (rows fetched) and whether they bother downloading the
/// static map snapshot image.
struct NearbyProvider: TimelineProvider {
    let limit: Int
    let wantsMapImage: Bool

    func placeholder(in context: Context) -> NearbyEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (NearbyEntry) -> Void) {
        if context.isPreview {
            completion(.placeholder)
            return
        }
        // Snapshots must be fast (widget gallery, transitions), so skip the B3
        // location fix here and render from the last known origin. Only the
        // real timeline refresh pays for a fix.
        loadNearby { timeline in
            completion(timeline.entries.first ?? .placeholder)
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NearbyEntry>) -> Void) {
        // Roadmap §2 B3 — take a coarse location fix under the app's existing
        // When-In-Use grant (`NSWidgetWantsLocation`, see Info.plist) before
        // building the timeline. Two payoffs: the widget centers on where the
        // user actually is even if the app hasn't been opened all day, and the
        // fix lands in the App Group for `syncWidgetFixIfFresh()` (see
        // apps/ios/src/location/heartbeat.ts) to relay to the server heartbeat
        // on the next foreground.
        //
        // Strictly best-effort: unauthorized, failed, or slow (6s cap) all
        // fall through to the previous behavior — `widgetOrigin()` reads the
        // last known lat/lng, or San Francisco.
        WidgetLocationHeartbeat.shared.requestFix { _ in
            // The fix (if any) is already persisted to the App Group, so
            // `widgetOrigin()` inside `fetchNearby` picks it up.
            loadNearby(completion: completion)
        }
    }

    /// The pre-B3 timeline body, unchanged apart from being hoisted out of
    /// `getTimeline` so the location fix can run in front of it.
    private func loadNearby(completion: @escaping (Timeline<NearbyEntry>) -> Void) {
        fetchNearby(limit: limit) { response in
            guard let response else {
                let entry = NearbyEntry(
                    date: Date(), items: [], mapImage: nil,
                    errorMessage: "Couldn't load nearby brands"
                )
                completion(Timeline(entries: [entry], policy: .after(nextRefreshDate())))
                return
            }

            let finish: (PlatformImage?) -> Void = { image in
                let entry = NearbyEntry(
                    date: Date(), items: response.items, mapImage: image, errorMessage: nil
                )
                completion(Timeline(entries: [entry], policy: .after(nextRefreshDate())))
            }

            if wantsMapImage, let urlString = response.mapSnapshotUrl, let url = URL(string: urlString) {
                fetchMapImage(url: url, completion: finish)
            } else {
                finish(nil)
            }
        }
    }
}
