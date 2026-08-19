import type { QuarterPoint, TorqueDataset, ValuePoint } from "@/api/underlying";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Circle, G, Line, Rect, Text as SvgText } from "react-native-svg";
import { safeFixed, safeUpper } from "./format";
import {
  MONO_FONT,
  TORQUE_STAGE_COLORS,
  terminal,
  torqueComponentColor,
  torqueGaugeColor,
  torqueStageColor,
} from "./palette";
import {
  ChartShell,
  Crosshair,
  LegendRow,
  Panel,
  PanelHeading,
  PanelNote,
  SafePolygon,
  SafePolyline,
  ScrubDot,
  ScrubTip,
  type ScrubTipLine,
  XDateLabels,
  YGrid,
} from "./primitives";
import {
  extent,
  fmtCompact,
  fmtPrice,
  indexByDate,
  linearScale,
  niceTicks,
  padDomain,
  polylinePoints,
  shortDate,
  tickIndices,
} from "./scale";

const PRICE_HEIGHT = 205;
const FUNDAMENTAL_HEIGHT = 150;

/**
 * Torque dashboard: price with EMA75/SMA200 and the coiled-spring band,
 * 8-quarter revenue + gross-margin panel, operating-margin trajectory, and
 * the composite score gauge with component bars and stage chips.
 */
export function TorqueDashboard({ data }: { data: TorqueDataset }) {
  const m = data.meta;
  const price = data.series?.price ?? { close: [] };
  const fundamentals = data.series?.fundamentals ?? {
    revenue: [],
    gross_margin: [],
    operating_margin: [],
  };
  const hasPrice = (price.close?.length ?? 0) > 0;
  if (!m) {
    return (
      <ChartShell title={`${data.ticker ?? "ticker"} torque`} subtitle="No torque payload">
        <PanelNote title="No data" detail="Torque payload was missing its score block." />
      </ChartShell>
    );
  }
  const stageColor = torqueStageColor(m.stage_label);
  const gaugeColor = torqueGaugeColor(m.total_score);

  return (
    <ChartShell
      title={`${data.ticker} misclassified revenue torque`}
      subtitle={`STAGE ${m.stage_label ?? "—"} | TOTAL ${safeFixed(m.total_score, 1)} | REC ${m.recommendation ?? "—"} | ZONE ${m.target_zone ?? "—"}`}
      footerLeft={`${data.ticker} torque ${safeFixed(m.total_score, 0)} | stage ${m.stage_label ?? "—"} | ${m.recommendation ?? "—"}`}
      footerRight="misclassified revenue torque"
    >
      <View style={styles.stageChips}>
        {TORQUE_STAGE_COLORS.map((stage) => {
          const active = stage.label === m.stage_label;
          return (
            <View
              key={stage.label}
              style={[
                styles.stageChip,
                { borderColor: stage.color },
                active && { backgroundColor: stage.color },
              ]}
            >
              <Text
                style={[styles.stageChipText, { color: active ? terminal.chartBg : stage.color }]}
              >
                {stage.label.replace(" Phase", "")}
              </Text>
            </View>
          );
        })}
      </View>

      {hasPrice ? (
        <TorquePricePanel price={price} coiled={m.stage_label === "Coiled Spring"} />
      ) : (
        <PanelNote title="No price history" detail="Torque scored without a price series." />
      )}

      {hasPrice ? (
        <LegendRow
          items={[
            { color: terminal.textStrong, label: "Close" },
            { color: terminal.cyan, label: "EMA 75" },
            { color: terminal.amber, label: "SMA 200" },
            {
              color: m.stage_label === "Coiled Spring" ? terminal.green : terminal.amber,
              label: "Coiled-spring zone",
            },
          ]}
        />
      ) : null}

      <View style={styles.midRow}>
        <View style={styles.midCell}>
          <PanelHeading label="Revenue (8Q) + gross margin" />
          {fundamentals.revenue.length > 0 ? (
            <RevenuePanel revenue={fundamentals.revenue} grossMargin={fundamentals.gross_margin} />
          ) : (
            <PanelNote
              title="Fundamental data unavailable"
              detail={
                m.fundamental_data_available
                  ? "No quarterly revenue series in this issuer's SEC trend pack."
                  : "SEC trend pack unavailable — technicals only."
              }
            />
          )}
        </View>
        <View style={styles.midCell}>
          <PanelHeading label="Operating margin" />
          {fundamentals.operating_margin.length > 0 ? (
            <OperatingMarginPanel series={fundamentals.operating_margin} />
          ) : (
            <PanelNote
              title="Operating margin unavailable"
              detail="No quarterly operating-income series."
            />
          )}
        </View>
      </View>

      <PanelHeading label="Composite torque score" />
      <View style={styles.scoreBox}>
        <View style={styles.gaugeTrack}>
          <View
            style={[
              styles.gaugeFill,
              {
                width: `${Math.min(100, Math.max(0, m.total_score ?? 0))}%`,
                backgroundColor: gaugeColor,
              },
            ]}
          />
          <View
            style={[
              styles.gaugeMarker,
              {
                left: `${Math.min(100, Math.max(0, m.total_score ?? 0))}%`,
                backgroundColor: gaugeColor,
              },
            ]}
          />
        </View>
        <View style={styles.gaugeLabelRow}>
          <Text style={[styles.gaugeTotal, { color: gaugeColor }]}>
            TOTAL {safeFixed(m.total_score, 0)}
          </Text>
          <Text style={[styles.gaugeStage, { color: stageColor }]} numberOfLines={1}>
            STAGE: {safeUpper(m.stage_label)} — {m.recommendation ?? "—"}
          </Text>
        </View>
        {(data.torque?.components ?? []).map((c) => (
          <View key={c.name} style={styles.componentRow}>
            <Text style={styles.componentName} numberOfLines={2}>
              {c.name}
            </Text>
            <View style={styles.componentTrack}>
              <View
                style={[
                  styles.componentFill,
                  {
                    width: `${Math.min(100, Math.max(0, c.score))}%`,
                    backgroundColor: torqueComponentColor(c.score),
                  },
                ]}
              />
            </View>
            <Text style={styles.componentValue}>
              {c.score.toFixed(0)} ({Math.round(c.weight * 100)}%)
            </Text>
          </View>
        ))}
        <Text style={styles.stageDetail}>{m.stage_detail}</Text>
      </View>
    </ChartShell>
  );
}

function TorquePricePanel({
  price,
  coiled,
}: {
  price: TorqueDataset["series"]["price"];
  coiled: boolean;
}) {
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const close = price.close ?? [];
  const dates = close.map((p) => p.date);
  const dateIndex = indexByDate(dates);
  const bandColor = coiled ? terminal.green : terminal.amber;
  const ema75By = new Map((price.ema75 ?? []).map((p) => [p.date, p.value]));
  const sma200By = new Map((price.sma200 ?? []).map((p) => [p.date, p.value]));

  return (
    <Panel height={PRICE_HEIGHT} scrub={{ count: dates.length, onIndex: setScrubIdx }}>
      {(w, h) => {
        if (dates.length === 0) return null;
        const x = linearScale([0, Math.max(1, dates.length - 1)], [6, w - 6]);
        const sma50 = (price.sma50 ?? []).filter((p) => dateIndex.has(p.date));
        const domain = padDomain(
          extent([
            ...close.map((p) => p.value),
            ...(price.sma200 ?? []).map((p) => p.value),
            ...sma50.map((p) => p.value * 1.08),
            ...sma50.map((p) => p.value * 0.92),
          ]),
          0.04,
        );
        const y = linearScale(domain, [h - 18, 8]);
        const toPt = (p: ValuePoint, mult: number) =>
          `${x(dateIndex.get(p.date) ?? 0).toFixed(1)},${y(p.value * mult).toFixed(1)}`;
        const band =
          sma50.length > 1
            ? [
                ...sma50.map((p) => toPt(p, 1.08)),
                ...sma50
                  .slice()
                  .reverse()
                  .map((p) => toPt(p, 0.92)),
              ].join(" ")
            : "";
        let scrubChrome: React.ReactNode = null;
        if (scrubIdx != null) {
          const p = close[scrubIdx];
          if (p) {
            const e = ema75By.get(p.date);
            const sm = sma200By.get(p.date);
            const lines: ScrubTipLine[] = [
              { text: shortDate(p.date, true).toUpperCase(), color: terminal.amberHot },
              { text: `C ${fmtPrice(p.value)}`, color: terminal.textStrong },
            ];
            if (e != null) lines.push({ text: `EMA75 ${fmtPrice(e)}`, color: terminal.cyan });
            if (sm != null) lines.push({ text: `SMA200 ${fmtPrice(sm)}`, color: terminal.amber });
            scrubChrome = (
              <>
                <Crosshair x={x(scrubIdx)} bottom={h - 16} />
                <ScrubDot cx={x(scrubIdx)} cy={y(p.value)} color={terminal.textStrong} />
                <ScrubTip x={x(scrubIdx)} plotWidth={w} lines={lines} />
              </>
            );
          }
        }
        return (
          <>
            <YGrid width={w} ticks={niceTicks(domain, 4)} y={y} format={fmtPrice} />
            {band ? <SafePolygon points={band} fill={bandColor} opacity={0.07} /> : null}
            {price.sma200 ? (
              <SafePolyline
                points={polylinePoints(price.sma200, dateIndex, x, y)}
                fill="none"
                stroke={terminal.amber}
                strokeWidth={1.6}
              />
            ) : null}
            {price.ema75 ? (
              <SafePolyline
                points={polylinePoints(price.ema75, dateIndex, x, y)}
                fill="none"
                stroke={terminal.cyan}
                strokeWidth={1.6}
              />
            ) : null}
            <SafePolyline
              points={polylinePoints(close, dateIndex, x, y)}
              fill="none"
              stroke={terminal.textStrong}
              strokeWidth={1.35}
            />
            <XDateLabels dates={dates} x={x} height={h} />
            {scrubChrome}
          </>
        );
      }}
    </Panel>
  );
}

/** 8Q revenue bars (cyan, amber edge) + gross-margin overlay on its own scale. */
function RevenuePanel({
  revenue,
  grossMargin,
}: {
  revenue: QuarterPoint[];
  grossMargin: QuarterPoint[];
}) {
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  return (
    <Panel
      height={FUNDAMENTAL_HEIGHT}
      scrub={{ count: revenue.length, onIndex: setScrubIdx, padStart: 14, padEnd: 14 }}
    >
      {(w, h) => {
        const n = revenue.length;
        const x = linearScale([0, Math.max(1, n - 1)], [14, w - 14]);
        const maxRev = Math.max(1, ...revenue.map((p) => p.value));
        const yRev = linearScale([0, maxRev * 1.1], [h - 16, 8]);
        const barWidth = Math.max(4, ((w - 28) / n) * 0.62);
        const labelIdx = new Set(tickIndices(n, Math.min(4, n)));

        const gmValues = grossMargin.map((p) => p.value);
        const gmDomain: [number, number] =
          gmValues.length > 0
            ? [Math.max(0, Math.min(...gmValues) - 5), Math.min(100, Math.max(...gmValues) + 5)]
            : [0, 100];
        const yGm = linearScale(gmDomain, [h - 16, 8]);
        // GM points align to the trailing revenue quarters.
        const gmOffset = n - grossMargin.length;

        let scrubChrome: React.ReactNode = null;
        if (scrubIdx != null) {
          const q = revenue[scrubIdx];
          if (q) {
            const lines: ScrubTipLine[] = [
              { text: q.label.toUpperCase(), color: terminal.amberHot },
              { text: `REV ${fmtCompact(q.value)}`, color: terminal.cyan },
            ];
            const gm = scrubIdx >= gmOffset ? grossMargin[scrubIdx - gmOffset] : undefined;
            if (gm) lines.push({ text: `GM ${gm.value.toFixed(1)}%`, color: terminal.green });
            scrubChrome = (
              <>
                <Crosshair x={x(scrubIdx)} bottom={h - 14} />
                <ScrubDot cx={x(scrubIdx)} cy={yRev(q.value)} color={terminal.cyan} />
                <ScrubTip x={x(scrubIdx)} plotWidth={w} lines={lines} />
              </>
            );
          }
        }

        return (
          <>
            {revenue.map((p, i) => (
              <G key={p.label + String(i)}>
                <Rect
                  x={x(i) - barWidth / 2}
                  y={yRev(p.value)}
                  width={barWidth}
                  height={Math.max(1, yRev(0) - yRev(p.value))}
                  fill={terminal.cyan}
                  opacity={0.78}
                  stroke={terminal.amber}
                  strokeWidth={0.5}
                />
                {labelIdx.has(i) ? (
                  <SvgText
                    x={x(i)}
                    y={h - 4}
                    fill={terminal.muted}
                    fontSize={6.5}
                    textAnchor="middle"
                  >
                    {p.label}
                  </SvgText>
                ) : null}
              </G>
            ))}
            <SvgText x={4} y={12} fill={terminal.muted} fontSize={7}>
              {fmtCompact(maxRev)}
            </SvgText>
            {grossMargin.length > 0 ? (
              <>
                <SafePolyline
                  points={grossMargin
                    .map((p, i) => `${x(gmOffset + i).toFixed(1)},${yGm(p.value).toFixed(1)}`)
                    .join(" ")}
                  fill="none"
                  stroke={terminal.green}
                  strokeWidth={1.8}
                />
                {grossMargin.map((p, i) => (
                  <Circle
                    key={`gm-${p.label}-${String(i)}`}
                    cx={x(gmOffset + i)}
                    cy={yGm(p.value)}
                    r={2}
                    fill={terminal.green}
                  />
                ))}
                <SvgText x={w - 4} y={12} fill={terminal.green} fontSize={7} textAnchor="end">
                  GM {gmValues[gmValues.length - 1]?.toFixed(1)}%
                </SvgText>
              </>
            ) : null}
            {scrubChrome}
          </>
        );
      }}
    </Panel>
  );
}

/** Operating-margin trajectory with amber underfill and a zero line. */
function OperatingMarginPanel({ series }: { series: QuarterPoint[] }) {
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  return (
    <Panel
      height={FUNDAMENTAL_HEIGHT}
      scrub={{ count: series.length, onIndex: setScrubIdx, padStart: 14, padEnd: 14 }}
    >
      {(w, h) => {
        const n = series.length;
        const x = linearScale([0, Math.max(1, n - 1)], [14, w - 14]);
        const values = series.map((p) => p.value);
        const domain = padDomain(extent([...values, 0]), 0.12);
        const y = linearScale(domain, [h - 16, 8]);
        const labelIdx = new Set(tickIndices(n, Math.min(4, n)));
        const linePts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
        const fillPts = [
          `${x(0).toFixed(1)},${y(0).toFixed(1)}`,
          ...linePts,
          `${x(n - 1).toFixed(1)},${y(0).toFixed(1)}`,
        ].join(" ");
        let scrubChrome: React.ReactNode = null;
        if (scrubIdx != null) {
          const q = series[scrubIdx];
          if (q) {
            scrubChrome = (
              <>
                <Crosshair x={x(scrubIdx)} bottom={h - 14} />
                <ScrubDot cx={x(scrubIdx)} cy={y(q.value)} color={terminal.amberHot} />
                <ScrubTip
                  x={x(scrubIdx)}
                  plotWidth={w}
                  lines={[
                    { text: q.label.toUpperCase(), color: terminal.amberHot },
                    { text: `OM ${q.value.toFixed(1)}%`, color: terminal.amberHot },
                  ]}
                />
              </>
            );
          }
        }
        return (
          <>
            <Line
              x1={0}
              x2={w}
              y1={y(0)}
              y2={y(0)}
              stroke={terminal.text}
              strokeWidth={0.8}
              opacity={0.65}
            />
            {n > 1 ? <SafePolygon points={fillPts} fill={terminal.amber} opacity={0.15} /> : null}
            <SafePolyline
              points={linePts.join(" ")}
              fill="none"
              stroke={terminal.amberHot}
              strokeWidth={1.9}
            />
            {series.map((p, i) => (
              <G key={`om-${p.label}-${String(i)}`}>
                <Circle cx={x(i)} cy={y(p.value)} r={2} fill={terminal.amberHot} />
                {labelIdx.has(i) ? (
                  <SvgText
                    x={x(i)}
                    y={h - 4}
                    fill={terminal.muted}
                    fontSize={6.5}
                    textAnchor="middle"
                  >
                    {p.label}
                  </SvgText>
                ) : null}
              </G>
            ))}
            <SvgText x={w - 4} y={12} fill={terminal.amberHot} fontSize={7} textAnchor="end">
              OM {values[values.length - 1]?.toFixed(1)}%
            </SvgText>
            {scrubChrome}
          </>
        );
      }}
    </Panel>
  );
}

const styles = StyleSheet.create({
  stageChips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  stageChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
  },
  stageChipText: { fontSize: 8, fontWeight: "800", letterSpacing: 0.3 },
  midRow: { flexDirection: "row", gap: 8 },
  midCell: { flex: 1, gap: 6 },
  scoreBox: {
    backgroundColor: terminal.axBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 201, 74, 0.34)",
    borderRadius: 6,
    padding: 10,
    gap: 7,
  },
  gaugeTrack: {
    height: 10,
    borderRadius: 4,
    backgroundColor: terminal.panel,
    overflow: "hidden",
  },
  gaugeFill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.28 },
  gaugeMarker: { position: "absolute", top: 0, bottom: 0, width: 3, borderRadius: 1 },
  gaugeLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  gaugeTotal: { fontSize: 10.5, fontWeight: "800", fontFamily: MONO_FONT },
  gaugeStage: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4, flexShrink: 1 },
  componentRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  componentName: { color: terminal.muted, fontSize: 9, fontWeight: "600", width: 96 },
  componentTrack: {
    flex: 1,
    height: 10,
    borderRadius: 3,
    backgroundColor: terminal.panel,
    overflow: "hidden",
  },
  componentFill: {
    position: "absolute",
    left: 0,
    top: 1.5,
    bottom: 1.5,
    borderRadius: 2,
    opacity: 0.86,
  },
  componentValue: {
    color: terminal.textStrong,
    width: 64,
    textAlign: "right",
    fontSize: 9,
    fontWeight: "700",
    fontFamily: MONO_FONT,
  },
  stageDetail: { color: terminal.muted, fontSize: 9, lineHeight: 13, marginTop: 2 },
});
