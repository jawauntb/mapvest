/**
 * @bacons/apple-targets config for the "Mapvest Nearby" WidgetKit extension.
 * Auto-discovered by the `@bacons/apple-targets` plugin (see app.json) on
 * `expo prebuild` — every Swift file in this directory becomes part of the
 * generated Xcode target. See docs/SHARE_AND_WIDGETS.md for the full
 * activation checklist (this is native scaffolding, not activated until a
 * prebuild + Xcode/EAS build runs).
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: "widget",
  name: "MapvestWidgets",
  displayName: "Mapvest",
  frameworks: ["SwiftUI", "WidgetKit"],
  deploymentTarget: "16.0",
  entitlements: {
    // Must match `ios.entitlements` in app.json and IOS_APP_GROUP in
    // apps/ios/src/widgets/widgetLocation.ts — this is how the main app
    // hands the widget extension a last-known lat/lng.
    "com.apple.security.application-groups": ["group.com.mapvest.app.widget"],
  },
};
