import SwiftUI

extension Color {
    /// The RN app defines its palette as hex strings in
    /// `apps/ios/src/theme/tokens.ts` (Atlas Signal). Mirrored here directly
    /// instead of wired through an Xcode asset colorset, to keep this target
    /// simple and avoid a second source of truth for the palette.
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var rgb: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&rgb)
        let r = Double((rgb & 0xFF0000) >> 16) / 255
        let g = Double((rgb & 0x00FF00) >> 8) / 255
        let b = Double(rgb & 0x0000FF) / 255
        self.init(red: r, green: g, blue: b)
    }

    static let mapvestBg = Color(hex: "#0C0E10")
    static let mapvestFg = Color(hex: "#F2F4F5")
    static let mapvestFgMuted = Color(hex: "#8B939C")
    static let mapvestAccent = Color(hex: "#3ECF8E")
    static let mapvestDanger = Color(hex: "#E85D5D")
    static let mapvestBorder = Color(hex: "#242A32")
}
