import Foundation
import WidgetKit

let appGroupId = "group.com.mapvest.app.widget"
let widgetSnapshotKey = "discoverySnapshotV1"
let widgetScopeKey = "widgetAccountScopeV1"

private let refreshIntervalMinutes = 30

enum WidgetLocationSource: String, Codable {
    case device
    case map
    case demo
}

/// Retained for the extension's coarse location heartbeat. Coordinates never
/// enter `WidgetDiscoverySnapshotV1`; the app turns a fix into display-ready
/// public nearby cards before WidgetKit may render it.
struct WidgetLocation: Codable {
    let lat: Double
    let lng: Double
    let capturedAt: Double?
    let source: WidgetLocationSource?

    init(lat: Double, lng: Double, capturedAt: Double? = nil, source: WidgetLocationSource? = nil) {
        self.lat = lat
        self.lng = lng
        self.capturedAt = capturedAt
        self.source = source
    }
}

enum WidgetSnapshotScopeKind: String, Codable {
    case guest
    case account
}

struct WidgetSnapshotScope: Codable {
    let kind: WidgetSnapshotScopeKind
    let accountId: String?
    let epoch: String?
}

enum WidgetSnapshotLocationStatus: String, Codable {
    case fresh
    case denied
    case unavailable
}

enum WidgetConfidence: String, Codable {
    case high
    case medium
    case low
}

enum WidgetSourceProvider: String, Codable {
    case exa
    case openrouter
    case gemini
    case massive
    case yahoo
    case polygon
    case sec
    case fred
    case manual
}

struct WidgetSource: Codable {
    let provider: WidgetSourceProvider
    let url: String?
    let fetchedAt: String
    let confidence: WidgetConfidence
}

struct WidgetSnapshotLocation: Codable {
    let status: WidgetSnapshotLocationStatus
    let source: WidgetLocationSource
    let label: String
}

struct WidgetDiscoveryCard: Codable, Identifiable {
    let id: String
    let name: String
    let ticker: String
    let sector: String?
    let distanceM: Double?
    let isPublic: Bool
    let caught: Bool
    let confidence: WidgetConfidence
    let sources: [WidgetSource]
    let relevance: String
    let deepLink: String

    var url: URL { URL(string: deepLink) ?? URL(string: "mapvest:///map")! }
    var tickerText: String { (isPublic ? "$" : "≈$") + ticker }
    var tickerAccessibilityText: String {
        isPublic ? "ticker \(ticker)" : "public comparable ticker \(ticker)"
    }
    var evidenceText: String {
        let sourceText = sources.count == 1 ? "1 source" : "\(sources.count) sources"
        let trust = "\(confidence.rawValue.capitalized) confidence · \(sourceText)"
        return isPublic ? trust : "Comparable · \(trust)"
    }
}

struct WidgetQuestSnapshot: Codable {
    let id: String
    let title: String
    let progress: Double
    let target: Double
    let completed: Bool
    let xp: Double
    let deepLink: String

    var url: URL { URL(string: deepLink) ?? URL(string: "mapvest:///universe")! }
}

struct WidgetDexSnapshot: Codable {
    let found: Double
    let total: Double
    let tilesVisited: Double
    let deepLink: String

    var url: URL { URL(string: deepLink) ?? URL(string: "mapvest:///universe")! }
}

struct WidgetDiscoverySnapshotV1: Codable {
    let schemaVersion: Int
    let snapshotId: String
    let scope: WidgetSnapshotScope
    let generatedAt: String
    let expiresAt: String
    let location: WidgetSnapshotLocation
    let cards: [WidgetDiscoveryCard]
    let quest: WidgetQuestSnapshot?
    let dex: WidgetDexSnapshot?
    let mapDeepLink: String

    var mapURL: URL { URL(string: mapDeepLink) ?? URL(string: "mapvest:///map")! }
    var generatedDate: Date? { widgetIsoDate(generatedAt) }
    var expiresDate: Date? { widgetIsoDate(expiresAt) }
    var isPersonal: Bool { scope.kind == .account }
    var isPrivacySensitive: Bool { isPersonal || location.source != .demo }
}

struct WidgetActiveScopeV1: Codable {
    let kind: WidgetSnapshotScopeKind
    let accountId: String?
    let epoch: String?
}

enum WidgetSetupReason {
    case missing
    case corrupt
    case scopeMismatch
}

enum WidgetStaleReason {
    case expired
    case denied
    case unavailable
}

enum WidgetSnapshotState {
    case setup(WidgetSetupReason)
    case fresh(WidgetDiscoverySnapshotV1)
    case stale(WidgetDiscoverySnapshotV1, WidgetStaleReason)

    var snapshot: WidgetDiscoverySnapshotV1? {
        switch self {
        case .setup: return nil
        case let .fresh(snapshot), let .stale(snapshot, _): return snapshot
        }
    }

    var isStale: Bool {
        if case .stale = self { return true }
        return false
    }
}

struct NearbyEntry: TimelineEntry {
    let date: Date
    let state: WidgetSnapshotState

    static let placeholder = NearbyEntry(date: Date(), state: .setup(.missing))
}

private let widgetDateFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

func widgetIsoDate(_ raw: String) -> Date? {
    widgetDateFormatter.date(from: raw)
}

private func isValidWidgetSnapshot(_ snapshot: WidgetDiscoverySnapshotV1) -> Bool {
    let cardTickers = snapshot.cards.map(\.ticker)
    guard snapshot.schemaVersion == 1,
          !snapshot.snapshotId.isEmpty,
          snapshot.snapshotId.count <= 256,
          snapshot.mapDeepLink == "mapvest:///map",
          let generatedAt = snapshot.generatedDate,
          let expiresAt = snapshot.expiresDate,
          expiresAt >= generatedAt,
          snapshot.cards.count <= 6,
          Set(cardTickers).count == cardTickers.count,
          snapshot.cards.allSatisfy({ card in
              card.id == card.ticker &&
                  !card.name.isEmpty &&
                  card.name.count <= 120 &&
                  !card.relevance.isEmpty &&
                  card.relevance.count <= 160 &&
                  (card.sector?.count ?? 0) <= 80 &&
                  card.deepLink.count <= 500 &&
                  card.sources.count <= 3 &&
                  (!card.sources.isEmpty || card.confidence == .low) &&
                  card.sources.allSatisfy({ source in
                      widgetIsoDate(source.fetchedAt) != nil &&
                          (source.url.map { raw in
                              raw.count <= 800 &&
                                  (raw.lowercased().hasPrefix("https://") || raw.lowercased().hasPrefix("http://"))
                          } ?? true)
                  }) &&
                  card.ticker.range(of: "^[A-Z][A-Z0-9.-]{0,23}$", options: .regularExpression) != nil &&
                  card.deepLink == "mapvest:///detail/\(card.ticker)" &&
                  (card.distanceM.map { $0.isFinite && $0 >= 0 } ?? true)
          })
    else { return false }

    switch snapshot.scope.kind {
    case .account:
        guard let accountId = snapshot.scope.accountId,
              let epoch = snapshot.scope.epoch,
              !accountId.isEmpty,
              accountId.count <= 256,
              !epoch.isEmpty,
              epoch.count <= 256
        else { return false }
    case .guest:
        guard snapshot.scope.accountId == nil,
              snapshot.scope.epoch == nil,
              snapshot.quest == nil,
              snapshot.dex == nil,
              snapshot.cards.allSatisfy({ !$0.caught })
        else { return false }
    }

    if let quest = snapshot.quest {
        guard !quest.id.isEmpty,
              quest.id.count <= 160,
              !quest.title.isEmpty,
              quest.title.count <= 120,
              quest.progress.isFinite,
              quest.progress >= 0,
              quest.target.isFinite,
              quest.target > 0,
              quest.xp.isFinite,
              quest.xp >= 0,
              quest.deepLink == "mapvest:///universe"
        else { return false }
    }
    if let dex = snapshot.dex {
        guard dex.found.isFinite,
              dex.total.isFinite,
              dex.tilesVisited.isFinite,
              dex.found >= 0,
              dex.total >= dex.found,
              dex.tilesVisited >= 0,
              dex.deepLink == "mapvest:///universe"
        else { return false }
    }
    return true
}

func loadWidgetSnapshotState(now: Date = Date()) -> WidgetSnapshotState {
    guard let defaults = UserDefaults(suiteName: appGroupId),
          let raw = defaults.string(forKey: widgetSnapshotKey),
          raw.utf8.count <= 24_000
    else {
        return .setup(.missing)
    }
    guard let data = raw.data(using: .utf8),
          let snapshot = try? JSONDecoder().decode(WidgetDiscoverySnapshotV1.self, from: data),
          isValidWidgetSnapshot(snapshot)
    else {
        return .setup(.corrupt)
    }

    let activeScope: WidgetActiveScopeV1? = {
        guard let scopeRaw = defaults.string(forKey: widgetScopeKey),
              let scopeData = scopeRaw.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(WidgetActiveScopeV1.self, from: scopeData)
    }()

    if snapshot.scope.kind == .account {
        guard activeScope?.kind == .account,
              activeScope?.accountId == snapshot.scope.accountId,
              activeScope?.epoch == snapshot.scope.epoch
        else {
            return .setup(.scopeMismatch)
        }
    } else if activeScope?.kind == .account {
        return .setup(.scopeMismatch)
    }

    switch snapshot.location.status {
    case .denied:
        return .stale(snapshot, .denied)
    case .unavailable:
        return .stale(snapshot, .unavailable)
    case .fresh:
        guard let expiresAt = snapshot.expiresDate else { return .setup(.corrupt) }
        return expiresAt < now ? .stale(snapshot, .expired) : .fresh(snapshot)
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

func nextRefreshDate() -> Date {
    Calendar.current.date(byAdding: .minute, value: refreshIntervalMinutes, to: Date())
        ?? Date().addingTimeInterval(TimeInterval(refreshIntervalMinutes * 60))
}

extension WidgetDiscoverySnapshotV1 {
    static let preview = WidgetDiscoverySnapshotV1(
        schemaVersion: 1,
        snapshotId: "preview-nearby-dex",
        scope: WidgetSnapshotScope(kind: .account, accountId: "preview", epoch: "preview"),
        generatedAt: widgetDateFormatter.string(from: Date()),
        expiresAt: widgetDateFormatter.string(from: Date().addingTimeInterval(21_600)),
        location: WidgetSnapshotLocation(status: .fresh, source: .demo, label: "Sample preview"),
        cards: [
            WidgetDiscoveryCard(id: "JPM", name: "JPMorgan Chase", ticker: "JPM", sector: "Financials", distanceM: 120, isPublic: true, caught: false, confidence: .high, sources: [.preview], relevance: "Uncovered Financials company", deepLink: "mapvest:///detail/JPM"),
            WidgetDiscoveryCard(id: "SBUX", name: "Starbucks", ticker: "SBUX", sector: "Consumer", distanceM: 260, isPublic: true, caught: true, confidence: .high, sources: [.preview], relevance: "Caught in your Universe", deepLink: "mapvest:///detail/SBUX"),
            WidgetDiscoveryCard(id: "NKE", name: "Nike", ticker: "NKE", sector: "Consumer", distanceM: 410, isPublic: true, caught: false, confidence: .medium, sources: [.preview], relevance: "Uncovered Consumer company", deepLink: "mapvest:///detail/NKE")
        ],
        quest: WidgetQuestSnapshot(id: "preview", title: "Catch one nearby company", progress: 1, target: 2, completed: false, xp: 25, deepLink: "mapvest:///universe"),
        dex: WidgetDexSnapshot(found: 8, total: 42, tilesVisited: 3, deepLink: "mapvest:///universe"),
        mapDeepLink: "mapvest:///map"
    )
}

private extension WidgetSource {
    static let preview = WidgetSource(
        provider: .manual,
        url: "https://mapvest.app",
        fetchedAt: widgetDateFormatter.string(from: Date()),
        confidence: .high
    )
}
