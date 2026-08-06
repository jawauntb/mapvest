import Foundation
import WidgetKit

/// App Group shared with the main app — see `IOS_APP_GROUP` in
/// apps/ios/src/widgets/widgetLocation.ts. Must also match
/// `ios.entitlements` in app.json and `expo-target.config.js` here.
let appGroupId = "group.com.mapvest.app.widget"

/// Production API base. Local dev builds (`EXPO_PUBLIC_API_URL`) don't
/// reach the widget extension — it's a separate native process with no env
/// var inlining — so this points straight at the deployed API. Update this
/// if the Railway service URL ever changes (see apps/ios/src/util/env.ts
/// and infra/railway for the source of truth).
let apiBaseURL = "https://api-production-4b27.up.railway.app"

private let refreshIntervalMinutes = 30
private let defaultOrigin = WidgetLocation(lat: 37.7749, lng: -122.4194) // San Francisco — same fallback as the Map tab.

struct WidgetLocation: Codable {
    let lat: Double
    let lng: Double
}

struct NearbyItemDTO: Codable, Identifiable {
    var id: String { "\(name)-\(ticker ?? "")" }
    let name: String
    let ticker: String?
    let isPublic: Bool?
    let sector: String?
    let distanceM: Double?
    let price: Double?
    let changePct: Double?

    var label: String {
        guard let ticker else { return name }
        return (isPublic == true ? "$" : "≈$") + ticker
    }
}

struct NearbyResponseDTO: Codable {
    let items: [NearbyItemDTO]
    let mapSnapshotUrl: String?
    let generatedAt: String
}

struct NearbyEntry: TimelineEntry {
    let date: Date
    let items: [NearbyItemDTO]
    let mapImage: PlatformImage?
    let errorMessage: String?

    static let placeholder = NearbyEntry(
        date: Date(),
        items: [
            NearbyItemDTO(
                name: "Starbucks", ticker: "SBUX", isPublic: true,
                sector: "Consumer Discretionary", distanceM: 120, price: 94.12, changePct: 0.8
            ),
            NearbyItemDTO(
                name: "McDonald's", ticker: "MCD", isPublic: true,
                sector: "Consumer Discretionary", distanceM: 340, price: 296.40, changePct: -0.3
            ),
        ],
        mapImage: nil,
        errorMessage: nil
    )
}

/// Reads the last lat/lng the main app saved (Map/List tabs →
/// `saveLastLocationForWidgets`). Falls back to San Francisco, same as the
/// Map tab's own `FALLBACK_REGION`, so a freshly-added widget still shows
/// something before the app has ever been opened.
func widgetOrigin() -> WidgetLocation {
    guard let data = UserDefaults(suiteName: appGroupId)?.data(forKey: "lastLocation"),
          let loc = try? JSONDecoder().decode(WidgetLocation.self, from: data)
    else {
        return defaultOrigin
    }
    return loc
}

func nextRefreshDate() -> Date {
    Calendar.current.date(byAdding: .minute, value: refreshIntervalMinutes, to: Date())
        ?? Date().addingTimeInterval(TimeInterval(refreshIntervalMinutes * 60))
}

/// `GET /v1/widget/nearby` — see apps/api/src/routes/widget.ts.
func fetchNearby(limit: Int, completion: @escaping (NearbyResponseDTO?) -> Void) {
    let origin = widgetOrigin()
    var comps = URLComponents(string: "\(apiBaseURL)/v1/widget/nearby")
    comps?.queryItems = [
        URLQueryItem(name: "lat", value: String(origin.lat)),
        URLQueryItem(name: "lng", value: String(origin.lng)),
        URLQueryItem(name: "radius", value: "1500"),
        URLQueryItem(name: "limit", value: String(limit)),
    ]
    guard let url = comps?.url else {
        completion(nil)
        return
    }
    URLSession.shared.dataTask(with: url) { data, _, error in
        guard let data, error == nil,
              let decoded = try? JSONDecoder().decode(NearbyResponseDTO.self, from: data)
        else {
            completion(nil)
            return
        }
        completion(decoded)
    }.resume()
}

/// `GET /v1/widget/map-snapshot` — proxied Google Static Maps PNG, see
/// apps/api/src/routes/widget.ts. Best-effort: 501 (not configured) or any
/// network failure just means the map widget falls back to its list layout.
func fetchMapImage(url: URL, completion: @escaping (PlatformImage?) -> Void) {
    URLSession.shared.dataTask(with: url) { data, _, _ in
        guard let data, let image = PlatformImage(data: data) else {
            completion(nil)
            return
        }
        completion(image)
    }.resume()
}

#if canImport(UIKit)
import UIKit
typealias PlatformImage = UIImage
#endif
