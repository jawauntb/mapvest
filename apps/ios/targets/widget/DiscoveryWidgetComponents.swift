import SwiftUI
import WidgetKit

extension View {
    @ViewBuilder
    func mapvestWidgetBackground<Background: View>(
        @ViewBuilder _ background: () -> Background
    ) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { background() }
        } else {
            self.background(background())
        }
    }
}

struct DiscoveryHeader: View {
    let snapshot: WidgetDiscoverySnapshotV1
    let state: WidgetSnapshotState

    private var title: String {
        switch snapshot.location.source {
        case .device: return snapshot.isPersonal ? "NEARBY DEX" : "NEARBY SIGNALS"
        case .map: return snapshot.isPersonal ? "MAP AREA DEX" : "MAP AREA SIGNALS"
        case .demo: return "DEMO AREA"
        }
    }

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    Image(systemName: "scope")
                        .font(.caption2.weight(.bold))
                    Text(title)
                        .font(.caption2.weight(.black))
                        .tracking(0.8)
                }
                Text(snapshot.location.label)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(.mapvestFgMuted)
                    .lineLimit(1)
            }
            .foregroundColor(.mapvestAccent)
            Spacer(minLength: 6)
            WidgetFreshnessView(state: state)
        }
    }
}

struct DiscoveryStatusPill: View {
    let caught: Bool

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: caught ? "checkmark.circle.fill" : "circle.dashed")
            Text(caught ? "CAUGHT" : "UNCOVERED")
        }
        .font(.caption2.weight(.black))
        .foregroundColor(caught ? .mapvestFg : .mapvestAccent)
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(caught ? Color.mapvestSurfaceRaised : Color.mapvestAccentSoft)
                .overlay(
                    Capsule().stroke(caught ? Color.mapvestBorder : Color.mapvestAccent.opacity(0.5), lineWidth: 0.75)
                )
        )
    }
}

struct PrimaryDiscoveryCard: View {
    let card: WidgetDiscoveryCard
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 4 : 7) {
            HStack {
                DiscoveryStatusPill(caught: card.caught)
                Spacer(minLength: 4)
                Image(systemName: "arrow.up.right")
                    .font(.caption2.weight(.bold))
                    .foregroundColor(.mapvestFgMuted)
            }

            Spacer(minLength: 0)

            Text(card.tickerText)
                .font(compact ? .title2.weight(.black) : .largeTitle.weight(.black))
                .monospaced()
                .foregroundColor(.mapvestFg)
                .minimumScaleFactor(0.65)
                .lineLimit(1)
            Text(card.name)
                .font(compact ? .caption.weight(.semibold) : .subheadline.weight(.semibold))
                .foregroundColor(.mapvestFg)
                .lineLimit(1)
            HStack(spacing: 5) {
                Circle()
                    .fill(Color.mapvestSector(card.sector))
                    .frame(width: 6, height: 6)
                Text(compact
                    ? "\(widgetDistanceText(card.distanceM)) · \(card.evidenceText)"
                    : "\(widgetDistanceText(card.distanceM)) · \(card.relevance)")
                    .font(.caption2)
                    .foregroundColor(.mapvestFgMuted)
                    .lineLimit(compact ? 1 : 2)
            }
            if !compact {
                Text(card.evidenceText)
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.mapvestFgMuted)
                    .lineLimit(1)
            }
        }
        .padding(compact ? 9 : 11)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color.mapvestSurfaceRaised, Color.mapvestSurface],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.mapvestSector(card.sector).opacity(0.5), lineWidth: 0.75)
                )
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(card.caught ? "Caught" : "Uncovered") company, \(card.name), \(card.tickerAccessibilityText), \(widgetDistanceText(card.distanceM)). \(card.relevance). \(card.evidenceText)")
        .accessibilityHint("Opens company details in Mapvest")
    }
}

struct QuestPanel: View {
    let quest: WidgetQuestSnapshot

    private var progress: Double {
        min(max(quest.progress / max(quest.target, 1), 0), 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: quest.completed ? "checkmark.seal.fill" : "flag.checkered")
                    .foregroundColor(quest.completed ? .mapvestAccent : .mapvestWarn)
                Text(quest.completed ? "QUEST COMPLETE" : "TODAY'S QUEST")
                    .font(.caption2.weight(.black))
                    .tracking(0.5)
                    .foregroundColor(.mapvestFgMuted)
                Spacer(minLength: 4)
                Text("+\(Int(quest.xp)) XP")
                    .font(.caption2.weight(.bold))
                    .foregroundColor(.mapvestWarn)
            }
            Text(quest.title)
                .font(.caption.weight(.semibold))
                .foregroundColor(.mapvestFg)
                .lineLimit(2)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.mapvestBorder)
                    Capsule()
                        .fill(Color.mapvestAccent)
                        .frame(width: proxy.size.width * progress)
                }
            }
            .frame(height: 5)
            Text("\(Int(quest.progress)) / \(Int(quest.target))")
                .font(.caption2)
                .monospacedDigit()
                .foregroundColor(.mapvestFgMuted)
        }
        .padding(9)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.mapvestSurface)
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.mapvestBorder, lineWidth: 0.75))
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Today's quest, \(quest.title), \(Int(quest.progress)) of \(Int(quest.target)), worth \(Int(quest.xp)) XP")
        .accessibilityHint("Opens your Universe in Mapvest")
    }
}

struct DexProgressPanel: View {
    let dex: WidgetDexSnapshot

    private var progress: Double {
        guard dex.total > 0 else { return 0 }
        return min(max(dex.found / dex.total, 0), 1)
    }

    var body: some View {
        HStack(spacing: 9) {
            ZStack {
                Circle().stroke(Color.mapvestBorder, lineWidth: 5)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(Color.mapvestAccent, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("\(Int(progress * 100))%")
                    .font(.caption2.weight(.black))
                    .monospacedDigit()
                    .foregroundColor(.mapvestFg)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 2) {
                Text("SECTOR DEX")
                    .font(.caption2.weight(.black))
                    .tracking(0.5)
                    .foregroundColor(.mapvestFgMuted)
                Text("\(Int(dex.found)) / \(Int(dex.total)) caught")
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundColor(.mapvestFg)
                Text("\(Int(dex.tilesVisited)) map tiles")
                    .font(.caption2)
                    .foregroundColor(.mapvestFgMuted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Sector dex, \(Int(dex.found)) of \(Int(dex.total)) caught across \(Int(dex.tilesVisited)) map tiles")
        .accessibilityHint("Opens your Universe in Mapvest")
    }
}

struct CompactDiscoveryRow: View {
    let card: WidgetDiscoveryCard

    var body: some View {
        HStack(spacing: 7) {
            ZStack {
                Circle().fill(Color.mapvestSector(card.sector).opacity(0.2))
                Text(String(card.ticker.prefix(1)))
                    .font(.caption.weight(.black))
                    .foregroundColor(Color.mapvestSector(card.sector))
            }
            .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(card.tickerText) · \(card.name)")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.mapvestFg)
                    .lineLimit(1)
                Text("\(card.caught ? "Caught" : "Uncovered") · \(widgetDistanceText(card.distanceM)) · \(card.evidenceText)")
                    .font(.caption2)
                    .foregroundColor(.mapvestFgMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 2)
            Image(systemName: card.caught ? "checkmark.circle.fill" : "chevron.right")
                .font(.caption2.weight(.bold))
                .foregroundColor(card.caught ? .mapvestFgMuted : .mapvestAccent)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(card.caught ? "Caught" : "Uncovered") company, \(card.name), \(card.tickerAccessibilityText), \(widgetDistanceText(card.distanceM)). \(card.evidenceText)")
        .accessibilityHint("Opens company details in Mapvest")
    }
}

struct DistanceSignalField: View {
    let cards: [WidgetDiscoveryCard]

    private let angles: [Double] = [-62, 18, 132, 205, 286]

    var body: some View {
        GeometryReader { proxy in
            let center = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
            let maxRadius = min(proxy.size.width, proxy.size.height) * 0.42
            ZStack {
                ForEach(1...3, id: \.self) { ring in
                    Circle()
                        .stroke(Color.mapvestBorder.opacity(0.9), style: StrokeStyle(lineWidth: 0.75, dash: [3, 3]))
                        .frame(width: maxRadius * 2 * CGFloat(ring) / 3, height: maxRadius * 2 * CGFloat(ring) / 3)
                }
                Rectangle().fill(Color.mapvestBorder.opacity(0.6)).frame(width: proxy.size.width, height: 0.5)
                Rectangle().fill(Color.mapvestBorder.opacity(0.6)).frame(width: 0.5, height: proxy.size.height)
                Circle().fill(Color.mapvestAccent).frame(width: 8, height: 8)
                    .shadow(color: .mapvestAccent.opacity(0.8), radius: 5)

                ForEach(Array(cards.prefix(5).enumerated()), id: \.element.id) { index, card in
                    let normalized = min(max((card.distanceM ?? 1500) / 1500, 0.2), 1)
                    let radius = maxRadius * CGFloat(normalized)
                    let angle = angles[index % angles.count] * .pi / 180
                    Link(destination: card.url) {
                        VStack(spacing: 1) {
                            ZStack {
                                Circle().fill(Color.mapvestBg)
                                Circle().stroke(Color.mapvestSector(card.sector), lineWidth: 2)
                                Text(String(card.ticker.prefix(2)))
                                    .font(.system(size: 8, weight: .black, design: .monospaced))
                                    .foregroundColor(.mapvestFg)
                            }
                            .frame(width: 28, height: 28)
                            Text(card.tickerText)
                                .font(.system(size: 8, weight: .bold, design: .monospaced))
                                .foregroundColor(.mapvestFg)
                                .lineLimit(1)
                        }
                    }
                    .position(
                        x: center.x + CGFloat(cos(angle)) * radius,
                        y: center.y + CGFloat(sin(angle)) * radius
                    )
                    .accessibilityLabel("\(card.name), \(card.tickerAccessibilityText), \(widgetDistanceText(card.distanceM)). \(card.evidenceText)")
                    .accessibilityHint("Opens company details in Mapvest")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Nearby distance signals")
    }
}
