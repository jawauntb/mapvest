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
/// Must match `WIDGET_LOCATION_MAX_AGE_MS` in `src/widgets/widgetFreshness.ts`.
let widgetLocationFreshness: TimeInterval = 6 * 60 * 60

enum WidgetLocationSource: String, Codable {
    case device
    case map
}

struct WidgetLocation: Codable {
    let lat: Double
    let lng: Double
    /// Epoch milliseconds. Optional only to decode pre-truthfulness records;
    /// those records are rendered as stale/setup, never as nearby.
    let capturedAt: Double?
    let source: WidgetLocationSource?

    init(lat: Double, lng: Double, capturedAt: Double? = nil, source: WidgetLocationSource? = nil) {
        self.lat = lat
        self.lng = lng
        self.capturedAt = capturedAt
        self.source = source
    }
}

enum WidgetLocationState {
    case setup
    case stale(capturedAt: Double?, source: WidgetLocationSource?)
    case fresh(WidgetLocation)

    var location: WidgetLocation? {
        if case let .fresh(value) = self { return value }
        return nil
    }

    var capturedAt: Double? {
        switch self {
        case .setup: return nil
        case let .stale(capturedAt, _): return capturedAt
        case let .fresh(location): return location.capturedAt
        }
    }
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
        guard let ticker else { return "No public ticker" }
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
    let locationState: WidgetLocationState

    static let placeholder = NearbyEntry(
        date: Date(),
        items: [],
        mapImage: nil,
        errorMessage: nil,
        locationState: .setup
    )
}

/// Reads the last origin the main app or widget saved. There is deliberately
/// no city fallback: a fresh widget must explain setup rather than label an
/// arbitrary coordinate as "nearby".
func widgetOriginState(now: Date = Date()) -> WidgetLocationState {
    guard let data = UserDefaults(suiteName: appGroupId)?.data(forKey: "lastLocation"),
          let loc = try? JSONDecoder().decode(WidgetLocation.self, from: data)
    else {
        return .setup
    }
    guard isValidWidgetLocation(loc), let capturedAt = loc.capturedAt, let source = loc.source else {
        return .stale(capturedAt: loc.capturedAt, source: loc.source)
    }
    let age = now.timeIntervalSince1970 * 1000 - capturedAt
    guard age >= 0, age <= widgetLocationFreshness * 1000 else {
        return .stale(capturedAt: capturedAt, source: source)
    }
    return .fresh(loc)
}

private func isValidWidgetLocation(_ location: WidgetLocation) -> Bool {
    location.lat.isFinite && location.lng.isFinite &&
        abs(location.lat) <= 90 && abs(location.lng) <= 180 &&
        !(location.lat == 0 && location.lng == 0)
}

func widgetHeader(for state: WidgetLocationState) -> String {
    switch state {
    case .fresh(let location) where location.source == .map:
        return "MAPVEST · MAP AREA"
    case .fresh:
        return "MAPVEST · NEARBY"
    case .setup, .stale:
        return "MAPVEST · LOCATION"
    }
}

func widgetDistanceText(_ distanceM: Double?) -> String {
    guard let distanceM, distanceM.isFinite, distanceM >= 0 else {
        return "distance unavailable"
    }
    if distanceM < 1000 {
        return "\(max(10, Int((distanceM / 10).rounded()) * 10))m"
    }
    return String(format: "%.1fkm", distanceM / 1000)
}

func widgetDetailURL(for ticker: String) -> URL {
    let encoded = ticker.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ticker
    return URL(string: "mapvest:///detail/\(encoded)")!
}

func widgetMapURL(for state: WidgetLocationState) -> URL {
    guard let location = state.location else {
        return URL(string: "mapvest:///map")!
    }
    var components = URLComponents()
    components.scheme = "mapvest"
    components.path = "/map"
    components.queryItems = [
        URLQueryItem(name: "lat", value: String(location.lat)),
        URLQueryItem(name: "lng", value: String(location.lng)),
    ]
    return components.url ?? URL(string: "mapvest:///map")!
}

func nextRefreshDate() -> Date {
    Calendar.current.date(byAdding: .minute, value: refreshIntervalMinutes, to: Date())
        ?? Date().addingTimeInterval(TimeInterval(refreshIntervalMinutes * 60))
}

/// `GET /v1/widget/nearby` — see apps/api/src/routes/widget.ts.
func fetchNearby(origin: WidgetLocation, limit: Int, completion: @escaping (NearbyResponseDTO?) -> Void) {
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
