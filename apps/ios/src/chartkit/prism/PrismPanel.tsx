import { radii, space } from "@/theme/tokens";
import type { ReactNode } from "react";
import { useState } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Svg } from "../view-svg";
import { chart } from "./theme";

/**
 * Self-measuring plot surface for the Prism charts — the Atlas Signal sibling
 * of `chartkit/primitives.tsx`'s `Panel`. Children render only once the width
 * is known, which is what keeps the View-backed SVG shims from laying out
 * against a zero-width parent.
 */
export function PrismPanel({
  height,
  style,
  children,
}: {
  height: number;
  style?: ViewStyle;
  children: (width: number, height: number) => ReactNode;
}) {
  const [width, setWidth] = useState(0);
  return (
    <View
      style={[styles.panel, { height }, style]}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {width > 1 ? (
        <Svg width={width} height={height}>
          {children(width, height)}
        </Svg>
      ) : null}
    </View>
  );
}

/** Swatch legend under a plot. Dashed entries draw two ticks instead of a bar. */
export function PrismLegend({
  items,
}: {
  items: Array<{ color: string; label: string; dashed?: boolean }>;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          {item.dashed ? (
            <View style={styles.legendDashes}>
              <View style={[styles.legendDash, { backgroundColor: item.color }]} />
              <View style={[styles.legendDash, { backgroundColor: item.color }]} />
            </View>
          ) : (
            <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
          )}
          <Text style={styles.legendLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * What a chart renders instead of an empty plot. Charts never draw a blank
 * frame — an absent series says so in words.
 */
export function PrismChartEmpty({ note }: { note: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radii.md,
    overflow: "hidden",
    backgroundColor: chart.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chart.border,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
    rowGap: space.xs,
    marginTop: space.sm,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendSwatch: { width: 12, height: 3, borderRadius: 2 },
  legendDashes: { flexDirection: "row", gap: 2 },
  legendDash: { width: 5, height: 3, borderRadius: 2 },
  legendLabel: { color: chart.muted, fontSize: 10.5, fontWeight: "600" },
  empty: {
    borderRadius: radii.md,
    backgroundColor: chart.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chart.border,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: "center",
  },
  emptyText: { color: chart.muted, fontSize: 12, textAlign: "center", lineHeight: 17 },
});
