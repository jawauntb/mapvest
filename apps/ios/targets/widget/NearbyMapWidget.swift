import SwiftUI
import WidgetKit

/// Shows the server-rendered static map PNG (`/v1/widget/map-snapshot`,
/// proxied so the widget never needs a Google Maps key of its own — see
/// docs/SECRETS.md) with the nearest ticker overlaid. Falls back to the
/// same compact list the "Nearby" widget shows when no key is configured
/// server-side or the snapshot fetch fails.
struct NearbyMapWidgetView: View {
    var entry: NearbyEntry

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            if let mapImage = entry.mapImage {
                Image(uiImage: mapImage)
                    .resizable()
                    .scaledToFill()
            } else {
                Color.mapvestBg
            }

            overlay
        }
        .clipped()
        .widgetURL(widgetMapURL(for: entry.locationState))
    }

    @ViewBuilder
    private var overlay: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(widgetHeader(for: entry.locationState))
                .font(.system(size: 9, weight: .bold))
                .foregroundColor(.mapvestAccent)
            WidgetLastUpdatedView(state: entry.locationState)

            if entry.locationState.location == nil {
                WidgetLocationStatusView(state: entry.locationState)
            } else if entry.mapImage != nil {
                if let top = entry.items.first {
                    Link(destination: top.ticker.map { widgetDetailURL(for: $0) } ?? widgetMapURL(for: entry.locationState)) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(top.name)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.white)
                                .lineLimit(1)
                            Text("\(top.label) · \(widgetDistanceText(top.distanceM))")
                                .font(.system(size: 9))
                                .foregroundColor(.white.opacity(0.85))
                                .lineLimit(1)
                        }
                    }
                }
            } else if let errorMessage = entry.errorMessage {
                Text(errorMessage).font(.system(size: 11)).foregroundColor(.mapvestDanger)
            } else if entry.items.isEmpty {
                Text("Nothing nearby yet").font(.system(size: 11)).foregroundColor(.mapvestFgMuted)
            } else {
                ForEach(entry.items.prefix(3)) { item in
                    Link(destination: item.ticker.map { widgetDetailURL(for: $0) } ?? widgetMapURL(for: entry.locationState)) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(item.name)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.mapvestFg)
                                .lineLimit(1)
                            Text("\(item.label) · \(widgetDistanceText(item.distanceM))")
                                .font(.system(size: 9))
                                .foregroundColor(.mapvestFgMuted)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            entry.mapImage != nil
                ? LinearGradient(
                    colors: [Color.black.opacity(0.7), .clear],
                    startPoint: .bottom,
                    endPoint: .top
                )
                : nil
        )
    }
}

struct NearbyMapWidget: Widget {
    let kind = "MapvestNearbyMapWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: NearbyProvider(limit: 6, wantsMapImage: true)) { entry in
            NearbyMapWidgetView(entry: entry)
        }
        .configurationDisplayName("Mapvest Map")
        .description("A map of investable brands around your recent location or chosen map area.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
