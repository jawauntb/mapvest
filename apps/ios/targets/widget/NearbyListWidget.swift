import SwiftUI
import WidgetKit

struct NearbyListWidgetView: View {
    var entry: NearbyEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("MAPVEST · NEARBY")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.mapvestAccent)

            if let errorMessage = entry.errorMessage {
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
                ForEach(entry.items.prefix(6)) { item in
                    NearbyRow(item: item)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.mapvestBg)
        .widgetURL(URL(string: "mapvest://"))
    }
}

private struct NearbyRow: View {
    let item: NearbyItemDTO

    var body: some View {
        HStack {
            Text(item.label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.mapvestFg)
                .lineLimit(1)
            Spacer()
            if let price = item.price {
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
