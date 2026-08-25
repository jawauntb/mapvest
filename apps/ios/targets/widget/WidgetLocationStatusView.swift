import SwiftUI

/// Honest setup/stale copy shared by both iOS widget families.
struct WidgetLocationStatusView: View {
    let state: WidgetLocationState

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            switch state {
            case .setup:
                Text("Set up your nearby location")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.mapvestFg)
                Text("Open Mapvest and visit Map to begin")
                    .font(.system(size: 10))
                    .foregroundColor(.mapvestFgMuted)
                    .lineLimit(2)
            case let .stale(capturedAt, _):
                Text("Location is stale")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.mapvestDanger)
                if let capturedAt {
                    (Text("Last updated ") + Text(Date(timeIntervalSince1970: capturedAt / 1000), style: .relative))
                        .font(.system(size: 10))
                        .foregroundColor(.mapvestFgMuted)
                    Text("Open Mapvest to refresh it")
                        .font(.system(size: 10))
                        .foregroundColor(.mapvestFgMuted)
                        .lineLimit(2)
                } else {
                    Text("Timestamp unavailable — open Mapvest to refresh it")
                        .font(.system(size: 10))
                        .foregroundColor(.mapvestFgMuted)
                        .lineLimit(2)
                }
            case .fresh:
                EmptyView()
            }
        }
    }
}

struct WidgetLastUpdatedView: View {
    let state: WidgetLocationState

    var body: some View {
        if case let .fresh(location) = state, let capturedAt = location.capturedAt {
            (Text("Updated ") + Text(Date(timeIntervalSince1970: capturedAt / 1000), style: .relative))
                .font(.system(size: 9))
                .foregroundColor(.mapvestFgMuted)
                .lineLimit(1)
        }
    }
}
