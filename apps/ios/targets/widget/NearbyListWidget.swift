import SwiftUI
import WidgetKit

struct NearbyListWidgetView: View {
    var entry: NearbyEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(widgetHeader(for: entry.locationState))
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.mapvestAccent)
            WidgetLastUpdatedView(state: entry.locationState)

            if entry.locationState.location == nil {
                Spacer()
                WidgetLocationStatusView(state: entry.locationState)
                Spacer()
            } else if let errorMessage = entry.errorMessage {
                Spacer()
                Text(errorMessage)
                    .font(.system(size: 12))
                    .foregroundColor(.mapvestDanger)
                Spacer()
            } else if entry.items.isEmpty {
                Spacer()
                Text("Nothing nearby yet")
                    .font(.system(size: 12))
                    .foregroundColor(.mapvestFgMuted)
                Spacer()
            } else {
                ForEach(entry.items.prefix(maxRows)) { item in
                    Link(destination: item.ticker.map { widgetDetailURL(for: $0) } ?? widgetMapURL(for: entry.locationState)) {
                        NearbyRow(item: item, showPrice: family != .systemSmall)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.mapvestBg)
        .widgetURL(widgetMapURL(for: entry.locationState))
    }

    private var maxRows: Int {
        switch family {
        case .systemSmall: return 3
        case .systemMedium: return 5
        default: return 8
        }
    }
}

private struct NearbyRow: View {
    let item: NearbyItemDTO
    let showPrice: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text(item.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.mapvestFg)
                    .lineLimit(1)
                Text("\(item.label) · \(widgetDistanceText(item.distanceM))")
                    .font(.system(size: 10))
                    .foregroundColor(.mapvestFgMuted)
                    .lineLimit(1)
            }
            Spacer()
            if showPrice, let price = item.price {
                Text(priceText(price: price, changePct: item.changePct))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor((item.changePct ?? 0) >= 0 ? .mapvestAccent : .mapvestDanger)
            }
        }
        .padding(.vertical, 3)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.mapvestBorder).frame(height: 0.5)
        }
    }

    private func priceText(price: Double, changePct: Double?) -> String {
        guard let changePct else { return String(format: "$%.2f", price) }
        return String(format: "$%.2f %@%.1f%%", price, changePct >= 0 ? "+" : "", changePct)
    }
}

struct NearbyListWidget: Widget {
    let kind = "MapvestNearbyWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NearbyProvider(limit: 8, wantsMapImage: false)) { entry in
            NearbyListWidgetView(entry: entry)
        }
        .configurationDisplayName("Mapvest Nearby")
        .description("Investable brands near your last known location.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
