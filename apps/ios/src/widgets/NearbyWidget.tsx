import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { WidgetData, WidgetNearbyItem } from "./widgetData";
import type { WidgetLocationState } from "./widgetFreshness";

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
export function NearbyWidget({ items, error, locationState }: WidgetData) {
  const fresh = locationState.kind === "fresh";
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
        text={
          fresh && locationState.location.source === "map"
            ? "MAPVEST · MAP AREA"
            : "MAPVEST · NEARBY"
        }
        style={{ color: C.accent, fontSize: 10, fontWeight: "700", letterSpacing: 1 }}
      />
      {fresh && typeof locationState.location.capturedAt === "number" ? (
        <TextWidget
          text={`Updated ${relativeTime(locationState.location.capturedAt)}`}
          style={{ color: C.fgMuted, fontSize: 9 }}
        />
      ) : null}
      {locationState.kind !== "fresh" ? (
        <LocationState state={locationState} />
      ) : error ? (
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
  const label = item.ticker
    ? item.isPublic
      ? `$${item.ticker}`
      : `≈$${item.ticker}`
    : "No public ticker";
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
      <FlexWidget style={{ flexDirection: "column", flex: 1, marginRight: 6 }}>
        <TextWidget
          text={item.name}
          style={{ color: C.fg, fontSize: 12, fontWeight: "600" }}
          maxLines={1}
          truncate="END"
        />
        <TextWidget
          text={`${label} · ${distanceText(item.distanceM)}`}
          style={{ color: C.fgMuted, fontSize: 10 }}
          maxLines={1}
          truncate="END"
        />
      </FlexWidget>
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

function LocationState({ state }: { state: WidgetLocationState }) {
  const stale = state.kind === "stale";
  return (
    <FlexWidget style={{ flex: 1, justifyContent: "center" }}>
      <TextWidget
        text={stale ? "Location is stale" : "Set up your nearby location"}
        style={{ color: stale ? C.danger : C.fg, fontSize: 12, fontWeight: "600" }}
      />
      <TextWidget
        text={
          stale
            ? state.capturedAt
              ? `Last updated ${relativeTime(state.capturedAt)}`
              : "Open Mapvest to refresh it"
            : "Open Mapvest and visit Map to begin"
        }
        style={{ color: C.fgMuted, fontSize: 10, marginTop: 4 }}
        maxLines={2}
        truncate="END"
      />
    </FlexWidget>
  );
}

function distanceText(distanceM?: number): string {
  if (typeof distanceM !== "number" || !Number.isFinite(distanceM)) return "distance unavailable";
  if (distanceM < 1000) return `${Math.max(10, Math.round(distanceM / 10) * 10)}m`;
  return `${(distanceM / 1000).toFixed(1)}km`;
}

function relativeTime(capturedAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - capturedAt) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
