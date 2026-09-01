import SwiftUI
import WidgetKit

struct NearbyListWidgetView: View {
    let entry: NearbyEntry
    @Environment(\.widgetFamily) private var family

    private var snapshot: WidgetDiscoverySnapshotV1? { entry.state.snapshot }

    private var rootURL: URL? {
        guard let snapshot else { return URL(string: "mapvest:///map") }
        if snapshot.cards.isEmpty { return snapshot.mapURL }
        if family == .systemSmall { return snapshot.cards.first?.url ?? snapshot.mapURL }
        return nil
    }

    var body: some View {
        Group {
            if let snapshot, !snapshot.cards.isEmpty {
                discovery(snapshot)
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
    private func discovery(_ snapshot: WidgetDiscoverySnapshotV1) -> some View {
        switch family {
        case .systemSmall:
            VStack(alignment: .leading, spacing: 8) {
                DiscoveryHeader(snapshot: snapshot, state: entry.state)
                if let card = snapshot.cards.first {
                    PrimaryDiscoveryCard(card: card, compact: true)
                }
            }
        case .systemMedium:
            VStack(alignment: .leading, spacing: 8) {
                DiscoveryHeader(snapshot: snapshot, state: entry.state)
                HStack(spacing: 9) {
                    if let card = snapshot.cards.first {
                        Link(destination: card.url) {
                            PrimaryDiscoveryCard(card: card, compact: true)
                        }
                    }
                    VStack(alignment: .leading, spacing: 5) {
                        if let quest = snapshot.quest {
                            Link(destination: quest.url) {
                                QuestPanel(quest: quest)
                            }
                        } else if let card = snapshot.cards.dropFirst().first {
                            Link(destination: card.url) {
                                CompactDiscoveryRow(card: card)
                            }
                        }
                        if let card = snapshot.cards.dropFirst(snapshot.quest == nil ? 2 : 1).first {
                            Link(destination: card.url) {
                                CompactDiscoveryRow(card: card)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        default:
            VStack(alignment: .leading, spacing: 8) {
                DiscoveryHeader(snapshot: snapshot, state: entry.state)
                HStack(spacing: 9) {
                    if let card = snapshot.cards.first {
                        Link(destination: card.url) {
                            PrimaryDiscoveryCard(card: card, compact: false)
                        }
                    }
                    VStack(spacing: 8) {
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
                }
                Text("OTHER SIGNALS")
                    .font(.caption2.weight(.black))
                    .tracking(0.6)
                    .foregroundColor(.mapvestFgMuted)
                ForEach(snapshot.cards.dropFirst().prefix(3)) { card in
                    Link(destination: card.url) {
                        CompactDiscoveryRow(card: card)
                    }
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
                    Image(systemName: "scope")
                    Text("NEARBY DEX")
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
            RadialGradient(
                colors: [Color.mapvestAccent.opacity(0.10), .clear],
                center: .topTrailing,
                startRadius: 0,
                endRadius: 190
            )
        }
    }

    private var contentPadding: CGFloat {
        if #available(iOSApplicationExtension 17.0, *) { return 0 }
        return 12
    }
}

struct NearbyListWidget: Widget {
    let kind = "MapvestNearbyWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NearbyProvider()) { entry in
            NearbyListWidgetView(entry: entry)
        }
        .configurationDisplayName("Nearby Dex")
        .description("Catch investable companies around you and track your next discovery quest.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
