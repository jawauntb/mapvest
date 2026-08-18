import { radii } from "@/theme/tokens";
import { useState } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import Svg, { G, Line, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { MONO_FONT, terminal } from "./palette";
import { shortDate, spansYears, tickIndices } from "./scale";

/**
 * Shared chrome for the Underlying Terminal charts: the outer shell (title /
 * subtitle / footer stat strip), self-measuring SVG panels, grid + axis
 * labels, level pills, and signal markers.
 */

const AMBER_BORDER = "rgba(255, 201, 74, 0.34)";

export function ChartShell({
  title,
  subtitle,
  footerLeft,
  footerRight = "UNDERLYING TERMINAL",
  children,
}: {
  title: string;
  subtitle?: string;
  footerLeft?: string;
  footerRight?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.shell}>
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>{title.toUpperCase()}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {children}
      <View style={styles.footerRow}>
        <Text style={styles.footerLeft} numberOfLines={1}>
          {(footerLeft ?? "").toUpperCase()}
        </Text>
        <Text style={styles.footerRight}>{footerRight.toUpperCase()}</Text>
      </View>
    </View>
  );
}

/** Small amber uppercase caption above a sub-panel (matplotlib axis titles). */
export function PanelHeading({ label }: { label: string }) {
  return <Text style={styles.panelHeading}>{label.toUpperCase()}</Text>;
}

/**
 * Self-measuring SVG plot panel with the terminal plot-area background and
 * border. Children render into the SVG once the width is known.
 */
export function Panel({
  height,
  style,
  children,
}: {
  height: number;
  style?: ViewStyle;
  children: (width: number, height: number) => React.ReactNode;
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

/** Horizontal gridlines + muted value labels drawn inside the plot. */
export function YGrid({
  width,
  ticks,
  y,
  format,
}: {
  width: number;
  ticks: number[];
  y: (v: number) => number;
  format: (v: number) => string;
}) {
  return (
    <G>
      {ticks.map((t) => (
        <G key={`yt-${t}`}>
          <Line
            x1={0}
            x2={width}
            y1={y(t)}
            y2={y(t)}
            stroke={terminal.grid}
            strokeWidth={0.6}
            opacity={0.45}
          />
          <SvgText x={4} y={y(t) - 3} fill={terminal.muted} fontSize={8}>
            {format(t)}
          </SvgText>
        </G>
      ))}
    </G>
  );
}

/** Date labels along the bottom of a category (trading-day) axis. */
export function XDateLabels({
  dates,
  x,
  height,
  count = 4,
}: {
  dates: string[];
  x: (i: number) => number;
  height: number;
  count?: number;
}) {
  const withYear = spansYears(dates);
  const indices = tickIndices(dates.length, count);
  const last = dates.length - 1;
  return (
    <G>
      {indices.map((i) => {
        const date = dates[i];
        if (!date) return null;
        const anchor = i === 0 ? "start" : i === last ? "end" : "middle";
        return (
          <SvgText
            key={`xt-${date}`}
            x={x(i)}
            y={height - 4}
            fill={terminal.muted}
            fontSize={8}
            textAnchor={anchor}
          >
            {shortDate(date, withYear)}
          </SvgText>
        );
      })}
    </G>
  );
}

/** Rounded right-edge chip labeling a horizontal level (fill = level color). */
export function LevelPill({
  plotWidth,
  y,
  label,
  color,
}: {
  plotWidth: number;
  y: number;
  label: string;
  color: string;
}) {
  const w = label.length * 5.3 + 10;
  const h = 13;
  const x = plotWidth - w - 2;
  return (
    <G>
      <Rect x={x} y={y - h / 2} width={w} height={h} rx={3.5} fill={color} opacity={0.92} />
      <SvgText
        x={x + w / 2}
        y={y + 3}
        fill={terminal.chartBg}
        fontSize={8}
        fontWeight="bold"
        fontFamily={MONO_FONT}
        textAnchor="middle"
      >
        {label}
      </SvgText>
    </G>
  );
}

/** Buy/sell (▲/▼) signal marker with a dark keyline, like the terminal scatters. */
export function TriangleMarker({
  cx,
  cy,
  dir,
  color,
  size = 5.5,
}: {
  cx: number;
  cy: number;
  dir: "up" | "down";
  color: string;
  size?: number;
}) {
  const s = size;
  const points =
    dir === "up"
      ? `${cx},${cy - s} ${cx - s},${cy + s} ${cx + s},${cy + s}`
      : `${cx},${cy + s} ${cx - s},${cy - s} ${cx + s},${cy - s}`;
  return <Polygon points={points} fill={color} stroke={terminal.chartBg} strokeWidth={0.8} />;
}

/** Compact legend row — panel background + amber border like the terminal. */
export function LegendRow({
  items,
}: {
  items: Array<{ color: string; label: string; dashed?: boolean }>;
}) {
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

/** Explicit empty-state note inside a panel slot (never a blank panel). */
export function PanelNote({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.noteBox}>
      <Text style={styles.noteTitle}>{title.toUpperCase()}</Text>
      {detail ? <Text style={styles.noteDetail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: terminal.chartBg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: AMBER_BORDER,
    padding: 10,
    gap: 8,
  },
  title: {
    color: terminal.amberHot,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  subtitle: {
    color: terminal.muted,
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  panelHeading: {
    color: terminal.amberHot,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  panel: {
    borderRadius: 6,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: AMBER_BORDER,
    backgroundColor: terminal.axBg,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  footerLeft: {
    color: terminal.green,
    fontSize: 8.5,
    fontWeight: "700",
    fontFamily: MONO_FONT,
    flexShrink: 1,
  },
  footerRight: {
    color: terminal.amber,
    fontSize: 8.5,
    fontWeight: "700",
    fontFamily: MONO_FONT,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    rowGap: 4,
    backgroundColor: terminal.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: AMBER_BORDER,
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendSwatch: { width: 10, height: 3, borderRadius: 1 },
  legendDashes: { flexDirection: "row", gap: 2 },
  legendDash: { width: 4, height: 3, borderRadius: 1 },
  legendLabel: { color: terminal.text, fontSize: 9 },
  noteBox: {
    backgroundColor: terminal.axBg,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: AMBER_BORDER,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 6,
  },
  noteTitle: {
    color: terminal.amber,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  noteDetail: { color: terminal.muted, fontSize: 9.5, textAlign: "center", lineHeight: 14 },
});
