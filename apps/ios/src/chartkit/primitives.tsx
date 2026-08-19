import { radii } from "@/theme/tokens";
import { useState } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { safeUpper } from "./format";
import { MONO_FONT, terminal } from "./palette";
import { isSafeSvgPoints, shortDate, spansYears, tickIndices } from "./scale";
import {
  Circle,
  G,
  Line,
  Polygon,
  type PolygonProps,
  Polyline,
  type PolylineProps,
  Rect,
  Svg,
  Text as SvgText,
} from "./view-svg";

/**
 * Shared chrome for the Underlying Terminal charts: the outer shell (title /
 * subtitle / footer stat strip), self-measuring SVG panels with drag-to-scrub
 * support, grid + axis labels, level pills, signal markers, and the scrub
 * crosshair/readout primitives.
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
        <Text style={styles.title}>{safeUpper(title)}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {children}
      <View style={styles.footerRow}>
        <Text style={styles.footerLeft} numberOfLines={1}>
          {safeUpper(footerLeft ?? "", "")}
        </Text>
        <Text style={styles.footerRight}>{safeUpper(footerRight)}</Text>
      </View>
    </View>
  );
}

/** Small amber uppercase caption above a sub-panel (matplotlib axis titles). */
export function PanelHeading({ label }: { label: string }) {
  return <Text style={styles.panelHeading}>{safeUpper(label)}</Text>;
}

/**
 * Touch-scrub contract for a Panel. `count` is the number of index positions
 * along the chart's category x-axis and `padStart`/`padEnd` mirror the
 * horizontal padding of the chart's own `linearScale([0, count-1], [pad,
 * width-pad])` so touch x inverts to the same index the chart plotted.
 */
export type PanelScrub = {
  count: number;
  /** Nearest index while the finger is down; null on release/cancel. */
  onIndex: (index: number | null) => void;
  padStart?: number;
  padEnd?: number;
};

/**
 * Self-measuring SVG plot panel with the terminal plot-area background and
 * border. Children render into the SVG once the width is known. When `scrub`
 * is provided the panel claims touches (same responder pattern as
 * NativePriceChart — vertical page scrolls still win via responder
 * termination) and reports the nearest data index while dragging.
 */
export function Panel({
  height,
  style,
  children,
  scrub,
}: {
  height: number;
  style?: ViewStyle;
  children: (width: number, height: number) => React.ReactNode;
  scrub?: PanelScrub;
}) {
  const [width, setWidth] = useState(0);
  const scrubActive = !!scrub && scrub.count > 1 && width > 1;

  const toIndex = (locationX: number): number => {
    if (!scrub) return 0;
    const padStart = scrub.padStart ?? 6;
    const padEnd = scrub.padEnd ?? 6;
    const span = Math.max(1, width - padStart - padEnd);
    const t = (locationX - padStart) / span;
    return Math.min(scrub.count - 1, Math.max(0, Math.round(t * (scrub.count - 1))));
  };

  return (
    <View
      style={[styles.panel, { height }, style]}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      onStartShouldSetResponder={() => scrubActive}
      onMoveShouldSetResponder={() => scrubActive}
      onResponderGrant={(e) => scrub?.onIndex(toIndex(e.nativeEvent.locationX))}
      onResponderMove={(e) => scrub?.onIndex(toIndex(e.nativeEvent.locationX))}
      onResponderRelease={() => scrub?.onIndex(null)}
      onResponderTerminate={() => scrub?.onIndex(null)}
      accessible={scrubActive}
      accessibilityRole={scrubActive ? "adjustable" : undefined}
      accessibilityLabel={scrubActive ? "Chart. Drag horizontally to inspect values." : undefined}
    >
      {width > 1 ? (
        // pointerEvents none keeps the parent View the touch target so
        // locationX stays panel-relative for the index math above.
        <Svg width={width} height={height} pointerEvents="none">
          {children(width, height)}
        </Svg>
      ) : null}
    </View>
  );
}

/** Drop empty / NaN `points` — never mount a polyline with junk coords. */
export function SafePolyline(props: PolylineProps) {
  const pts = typeof props.points === "string" ? props.points : undefined;
  if (!isSafeSvgPoints(pts)) return null;
  return <Polyline {...props} points={pts} />;
}

export function SafePolygon(props: PolygonProps) {
  const pts = typeof props.points === "string" ? props.points : undefined;
  if (!isSafeSvgPoints(pts)) return null;
  return <Polygon {...props} points={pts} />;
}

function finitePair(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b);
}

/** Vertical scrub crosshair spanning the plot height. */
export function Crosshair({
  x,
  top = 0,
  bottom,
  color = terminal.amberHot,
}: {
  x: number;
  top?: number;
  bottom: number;
  color?: string;
}) {
  if (!finitePair(x, bottom) || !Number.isFinite(top)) return null;
  return (
    <Line
      x1={x}
      x2={x}
      y1={top}
      y2={bottom}
      stroke={color}
      strokeWidth={1}
      strokeDasharray="2 2"
      opacity={0.9}
    />
  );
}

/** Value marker riding a series at the scrub position (dark keyline). */
export function ScrubDot({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  if (!finitePair(cx, cy)) return null;
  return <Circle cx={cx} cy={cy} r={3.2} fill={color} stroke={terminal.chartBg} strokeWidth={1} />;
}

export type ScrubTipLine = { text: string; color?: string };

/**
 * Monospace readout box pinned to the top corner opposite the crosshair so
 * the finger never covers it. `x` is the crosshair position, `plotWidth` the
 * usable plot width (pass the pre-gutter width on charts with right gutters).
 */
export function ScrubTip({
  x,
  plotWidth,
  lines,
  y = 6,
}: {
  x: number;
  plotWidth: number;
  lines: ScrubTipLine[];
  y?: number;
}) {
  if (lines.length === 0) return null;
  const maxChars = Math.max(...lines.map((l) => l.text.length));
  const w = maxChars * 5.4 + 12;
  const lineH = 11;
  const h = lines.length * lineH + 9;
  const bx = x > plotWidth / 2 ? 6 : Math.max(6, plotWidth - w - 6);
  return (
    <G>
      <Rect
        x={bx}
        y={y}
        width={w}
        height={h}
        rx={4}
        fill={terminal.chartBg}
        opacity={0.94}
        stroke={AMBER_BORDER}
        strokeWidth={0.8}
      />
      {lines.map((l, i) => (
        <SvgText
          key={l.text}
          x={bx + 6}
          y={y + 12 + i * lineH}
          fill={l.color ?? terminal.text}
          fontSize={8}
          fontWeight="bold"
          fontFamily={MONO_FONT}
        >
          {l.text}
        </SvgText>
      ))}
    </G>
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
  if (!finitePair(cx, cy) || !Number.isFinite(size)) return null;
  const s = size;
  const points =
    dir === "up"
      ? `${cx},${cy - s} ${cx - s},${cy + s} ${cx + s},${cy + s}`
      : `${cx},${cy + s} ${cx - s},${cy - s} ${cx + s},${cy - s}`;
  return <SafePolygon points={points} fill={color} stroke={terminal.chartBg} strokeWidth={0.8} />;
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
      <Text style={styles.noteTitle}>{safeUpper(title)}</Text>
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
