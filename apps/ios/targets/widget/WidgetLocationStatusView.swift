import SwiftUI
import WidgetKit

struct WidgetStatusView: View {
    let state: WidgetSnapshotState
    @Environment(\.widgetFamily) private var family

    private var compact: Bool { family == .systemSmall }

    private var copy: (icon: String, title: String, body: String, action: String) {
        switch state {
        case .setup(.scopeMismatch):
            return ("person.crop.circle.badge.exclamationmark", "Finish account refresh", "Open Mapvest so this widget can safely match your active account.", "Open Mapvest")
        case .setup(.corrupt):
            return ("arrow.clockwise.circle", "Refresh Nearby Dex", "The saved discovery snapshot could not be read safely.", "Open to rebuild")
        case .setup(.missing):
            return ("location.circle", "Start your Nearby Dex", "Open Mapvest and visit Map to discover investable companies around you.", "Open Mapvest")
        case .fresh(let snapshot) where snapshot.cards.isEmpty:
            return ("scope", "No signals in this area", "Move the map or use your location to scan somewhere new.", "Explore the map")
        case .stale(let snapshot, .denied) where snapshot.cards.isEmpty:
            return ("location.slash", "Location is off", "Allow location in Settings, then open Mapvest to refresh nearby companies.", "Open Mapvest")
        case .stale(_, .denied):
            return ("location.slash", "Location is off", "Showing your last safe discovery snapshot.", "Refresh in Mapvest")
        case .stale(let snapshot, .unavailable) where snapshot.cards.isEmpty:
            return ("wifi.exclamationmark", "Nearby is unavailable", "Open Mapvest when your connection returns.", "Try in Mapvest")
        case .stale(_, .unavailable):
            return ("wifi.exclamationmark", "Offline snapshot", "Showing the last nearby companies Mapvest verified.", "Refresh in Mapvest")
        case .stale(_, .expired):
            return ("clock.badge.exclamationmark", "Discovery snapshot is old", "Open Mapvest to refresh nearby companies and quests.", "Refresh now")
        case .fresh:
            return ("scope", "Nearby Dex", "Open Mapvest to explore.", "Open Mapvest")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 5 : 8) {
            ZStack {
                Circle().fill(Color.mapvestAccentSoft)
                Image(systemName: copy.icon)
                    .font((compact ? Font.caption : Font.title3).weight(.semibold))
                    .foregroundColor(.mapvestAccent)
            }
            .frame(width: compact ? 28 : 36, height: compact ? 28 : 36)

            Text(copy.title)
                .font(compact ? .subheadline.weight(.bold) : .headline)
                .foregroundColor(.mapvestFg)
                .lineLimit(2)
            Text(copy.body)
                .font(.caption)
                .foregroundColor(.mapvestFgMuted)
                .lineLimit(compact ? 2 : 3)
            Text(copy.action + "  →")
                .font(.caption.weight(.bold))
                .foregroundColor(.mapvestAccent)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(copy.title). \(copy.body). \(copy.action)")
    }
}

struct WidgetFreshnessView: View {
    let state: WidgetSnapshotState

    private var staleLabel: String? {
        switch state {
        case .stale(_, .denied): return "Location off"
        case .stale(_, .unavailable): return "Offline"
        case .stale(_, .expired): return "Needs refresh"
        default: return nil
        }
    }

    var body: some View {
        if let generatedAt = state.snapshot?.generatedDate {
            HStack(spacing: 4) {
                Circle()
                    .fill(state.isStale ? Color.mapvestWarn : Color.mapvestAccent)
                    .frame(width: 5, height: 5)
                if state.isStale {
                    (Text("\(staleLabel ?? "Last good") · ") + Text(generatedAt, style: .relative))
                        .font(.caption2)
                        .foregroundColor(.mapvestFgMuted)
                } else {
                    (Text("Updated ") + Text(generatedAt, style: .relative))
                        .font(.caption2)
                        .foregroundColor(.mapvestFgMuted)
                }
            }
            .lineLimit(1)
        }
    }
}
