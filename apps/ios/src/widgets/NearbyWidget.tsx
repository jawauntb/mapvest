import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { WidgetData, WidgetNearbyItem } from "./widgetData";

// Widget RemoteViews can't consume RN's dynamic color objects — hex only.
// Mirrors apps/ios/src/theme/tokens.ts (Atlas Signal palette).
const C = {
  bg: "#0C0E10",
  bgElevated: "#161A1F",
  fg: "#F2F4F5",
  fgMuted: "#8B939C",
  accent: "#3ECF8E",
  danger: "#E85D5D",
  border: "#242A32",
} as const;

const MAX_ROWS = 6;

/**
 * Android home-screen widget: a compact list of investable brands near the
 * last location Mapvest saw (see `widgetLocation.ts`). Rendered by
 * `widget-task-handler.tsx` on add/update/resize via
 * `react-native-android-widget`'s JSX-to-RemoteViews pipeline — there is no
 * live map surface on Android RemoteViews, so "map" here means the same
 * geo-sorted nearby list the iOS Map widget falls back to when it can't
 * fetch a static map snapshot.
 */
export function NearbyWidget({ items, error }: WidgetData) {
  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: C.bg,
        borderRadius: 16,
        padding: 12,
        flexDirection: "column",
      }}
      clickAction="OPEN_APP"
    >
      <TextWidget
        text="MAPVEST · NEARBY"
        style={{ color: C.accent, fontSize: 10, fontWeight: "700", letterSpacing: 1 }}
      />
      {error ? (
        <FlexWidget style={{ flex: 1, justifyContent: "center" }}>
          <TextWidget
            text="Couldn't load nearby brands"
            style={{ color: C.danger, fontSize: 12 }}
          />
        </FlexWidget>
      ) : items.length === 0 ? (
        <FlexWidget style={{ flex: 1, justifyContent: "center" }}>
          <TextWidget text="Nothing nearby yet" style={{ color: C.fgMuted, fontSize: 12 }} />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flexDirection: "column", marginTop: 6 }}>
          {items.slice(0, MAX_ROWS).map((item) => (
            <Row key={`${item.name}-${item.ticker ?? ""}`} item={item} />
          ))}
        </FlexWidget>
      )}
    </FlexWidget>
  );
}

function Row({ item }: { item: WidgetNearbyItem }) {
  const up = (item.changePct ?? 0) >= 0;
  const label = item.ticker ? (item.isPublic ? `$${item.ticker}` : `≈$${item.ticker}`) : item.name;
  return (
    <FlexWidget
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 5,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}
      clickAction="OPEN_APP"
    >
      <TextWidget
        text={label}
        style={{ color: C.fg, fontSize: 12, fontWeight: "600" }}
        maxLines={1}
        truncate="END"
      />
      {typeof item.price === "number" ? (
        <TextWidget
          text={`$${item.price.toFixed(2)}${
            typeof item.changePct === "number"
              ? ` ${up ? "+" : ""}${item.changePct.toFixed(1)}%`
              : ""
          }`}
          style={{ color: up ? C.accent : C.danger, fontSize: 11, fontWeight: "600" }}
        />
      ) : null}
    </FlexWidget>
  );
}
