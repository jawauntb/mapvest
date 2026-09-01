import WidgetKit

/// Both widget families render one app-authored snapshot. The extension never
/// joins personalized endpoints, carries a bearer token, or invents a mixed
/// frame after an account transition.
struct NearbyProvider: TimelineProvider {
    func placeholder(in context: Context) -> NearbyEntry {
        .placeholder
    }

    func getSnapshot(in context: Context, completion: @escaping (NearbyEntry) -> Void) {
        if context.isPreview {
            completion(NearbyEntry(date: Date(), state: .fresh(.preview)))
        } else {
            completion(NearbyEntry(date: Date(), state: loadWidgetSnapshotState()))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NearbyEntry>) -> Void) {
        // Keep the coarse heartbeat for the next app foreground, but render
        // only the already-verified snapshot. A new fix alone cannot safely
        // recompute account catches, quest, or dex state inside WidgetKit.
        WidgetLocationHeartbeat.shared.requestFix { _ in
            let entry = NearbyEntry(date: Date(), state: loadWidgetSnapshotState())
            completion(Timeline(entries: [entry], policy: .after(nextRefreshDate())))
        }
    }
}
