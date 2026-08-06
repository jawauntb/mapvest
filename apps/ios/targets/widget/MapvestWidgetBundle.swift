import WidgetKit
import SwiftUI

@main
struct MapvestWidgetBundle: WidgetBundle {
    var body: some Widget {
        NearbyListWidget()
        NearbyMapWidget()
    }
}
