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
        getTimeline(in: context) { timeline in
            completion(timeline.entries.first ?? .placeholder)
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NearbyEntry>) -> Void) {
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
