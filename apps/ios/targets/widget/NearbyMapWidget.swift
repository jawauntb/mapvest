import SwiftUI
import WidgetKit

/// A deliberately non-geographic distance field. Points communicate proximity
/// and collection state without implying a direction the snapshot does not own.
struct NearbyMapWidgetView: View {
    let entry: NearbyEntry
    @Environment(\.widgetFamily) private var family

    private var snapshot: WidgetDiscoverySnapshotV1? { entry.state.snapshot }
    private var rootURL: URL? {
        guard let snapshot else { return URL(string: "mapvest:///map") }
        return snapshot.cards.isEmpty ? snapshot.mapURL : nil
    }

    var body: some View {
        Group {
            if let snapshot, !snapshot.cards.isEmpty {
                signalField(snapshot)
                    .privacySensitive(snapshot.isPrivacySensitive)
            } else {
                status
            }
        }
        .padding(contentPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .mapvestWidgetBackground { widgetBackground }
        .widgetURL(rootURL)
    }

    @ViewBuilder
    private func signalField(_ snapshot: WidgetDiscoverySnapshotV1) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            DiscoveryHeader(snapshot: snapshot, state: entry.state)
            if family == .systemLarge {
                DistanceSignalField(cards: snapshot.cards)
                    .frame(maxHeight: .infinity)
                HStack(spacing: 9) {
                    if let quest = snapshot.quest {
                        Link(destination: quest.url) {
                            QuestPanel(quest: quest)
                        }
                    }
                    if let dex = snapshot.dex {
                        Link(destination: dex.url) {
                            DexProgressPanel(dex: dex)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 12) {
                    ForEach(snapshot.cards.prefix(2)) { card in
                        Link(destination: card.url) {
                            CompactDiscoveryRow(card: card)
                        }
                    }
                }
            } else {
                HStack(spacing: 10) {
                    DistanceSignalField(cards: snapshot.cards)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    VStack(alignment: .leading, spacing: 7) {
                        if let target = snapshot.cards.first {
                            Text("NEXT TARGET")
                                .font(.caption2.weight(.black))
                                .tracking(0.5)
                                .foregroundColor(.mapvestFgMuted)
                            Link(destination: target.url) {
                                CompactDiscoveryRow(card: target)
                            }
                        }
                        if let dex = snapshot.dex {
                            Link(destination: dex.url) {
                                DexProgressPanel(dex: dex)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var status: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let snapshot {
                DiscoveryHeader(snapshot: snapshot, state: entry.state)
            } else {
                HStack(spacing: 5) {
                    Image(systemName: "dot.radiowaves.left.and.right")
                    Text("DISTANCE SIGNALS")
                }
                .font(.caption2.weight(.black))
                .tracking(0.8)
                .foregroundColor(.mapvestAccent)
            }
            Spacer(minLength: 0)
            WidgetStatusView(state: entry.state)
            Spacer(minLength: 0)
        }
    }

    private var widgetBackground: some View {
        ZStack {
            Color.mapvestBg
            LinearGradient(
                colors: [Color.mapvestBlue.opacity(0.08), .clear, Color.mapvestAccent.opacity(0.08)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }

    private var contentPadding: CGFloat {
        if #available(iOSApplicationExtension 17.0, *) { return 0 }
        return 12
    }
}

struct NearbyMapWidget: Widget {
    let kind = "MapvestNearbyMapWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NearbyProvider()) { entry in
            NearbyMapWidgetView(entry: entry)
        }
        .configurationDisplayName("Discovery Signals")
        .description("See nearby investable companies as honest distance signals, with your Sector Dex progress.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
