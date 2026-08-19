import type { FlowCompassDataset } from "@/api/underlying";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MONO_FONT, flowComponentColor, terminal } from "./palette";
import {
  ChartShell,
  Crosshair,
  LegendRow,
  Panel,
  PanelHeading,
  SafePolyline,
  ScrubDot,
  ScrubTip,
  type ScrubTipLine,
  TriangleMarker,
  XDateLabels,
  YGrid,
} from "./primitives";
import {
  decimate,
  extent,
  fmtPrice,
  indexByDate,
  linearScale,
  niceTicks,
  padDomain,
  polylinePoints,
  shortDate,
} from "./scale";
import { Line, Rect } from "./view-svg";

const PRICE_HEIGHT = 112;
const SCORE_HEIGHT = 185;
const SCORE_RANGE = 105;
const MAX_BARS = 150;

/**
 * Flow compass dashboard: close with fresh long/short markers, the flow-score
 * histogram with the compass signal line and ±trigger/±strong guides, and the
 * component score bars.
 */
export function FlowCompassChart({ data }: { data: FlowCompassDataset }) {
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const m = data.meta;
  const s = data.series;
  const signals = s?.signals ?? [];
  const dates = signals.map((p) => p.date);
  const dateIndex = indexByDate(dates);
  const trigger =
    typeof data.levels?.trigger_level === "number" && Number.isFinite(data.levels.trigger_level)
      ? data.levels.trigger_level
      : 50;
  const strong =
    typeof data.levels?.strong_level === "number" && Number.isFinite(data.levels.strong_level)
      ? data.levels.strong_level
      : 80;

  const freshLongs = signals.filter((p) => p.fresh_long);
  const freshShorts = signals.filter((p) => p.fresh_short);

  const components: Array<{ label: string; score: number | null }> = [
    { label: "Volume", score: m.volume_score },
    { label: "Trend", score: m.trend_score },
    { label: "Momentum", score: m.momentum_score },
    { label: "Value", score: m.value_score },
    { label: "RVI", score: m.rvi_score },
  ];

  return (
    <ChartShell
      title={`${data.ticker} flow compass dashboard`}
      subtitle={`1D ${data.period.toUpperCase()} | ${m.state} | SIGNED-VOLUME DELTA PROXY`}
      footerLeft={`${data.ticker} flow ${(m.score ?? 0).toFixed(1)} | ${m.state}`}
      footerRight="flow compass"
    >
      <Panel height={PRICE_HEIGHT} scrub={{ count: dates.length, onIndex: setScrubIdx }}>
        {(w, h) => {
          if (dates.length === 0) return null;
          const x = linearScale([0, Math.max(1, dates.length - 1)], [6, w - 6]);
          const domain = padDomain(extent(s.close.map((p) => p.value)), 0.08);
          const y = linearScale(domain, [h - 4, 6]);
          const scrubPt = scrubIdx != null ? signals[scrubIdx] : undefined;
          return (
            <>
              <YGrid width={w} ticks={niceTicks(domain, 2)} y={y} format={fmtPrice} />
              <SafePolyline
                points={polylinePoints(s.close, dateIndex, x, y)}
                fill="none"
                stroke={terminal.textStrong}
                strokeWidth={1.35}
              />
              {freshLongs.map((p) =>
                p.Low != null ? (
                  <TriangleMarker
                    key={`fl-${p.date}`}
                    cx={x(dateIndex.get(p.date) ?? 0)}
                    cy={y(p.Low * 0.985)}
                    dir="up"
                    color={terminal.green}
                  />
                ) : null,
              )}
              {freshShorts.map((p) =>
                p.High != null ? (
                  <TriangleMarker
                    key={`fs-${p.date}`}
                    cx={x(dateIndex.get(p.date) ?? 0)}
                    cy={y(p.High * 1.015)}
                    dir="down"
                    color={terminal.red}
                  />
                ) : null,
              )}
              {scrubIdx != null && scrubPt ? (
                <>
                  <Crosshair x={x(scrubIdx)} bottom={h - 2} />
                  {scrubPt.Close != null ? (
                    <ScrubDot cx={x(scrubIdx)} cy={y(scrubPt.Close)} color={terminal.textStrong} />
                  ) : null}
                </>
              ) : null}
            </>
          );
        }}
      </Panel>

      <PanelHeading label="Main bias score" />
      <Panel height={SCORE_HEIGHT} scrub={{ count: dates.length, onIndex: setScrubIdx }}>
        {(w, h) => {
          if (dates.length === 0) return null;
          const x = linearScale([0, Math.max(1, dates.length - 1)], [6, w - 6]);
          const y = linearScale([-SCORE_RANGE, SCORE_RANGE], [h - 18, 6]);
          const bars = decimate(s.flow_score, MAX_BARS);
          const barWidth = Math.max(1, ((w - 12) / bars.length) * 0.8);

          const guide = (level: number, color: string, dash: string, width = 1) => (
            <Line
              x1={0}
              x2={w}
              y1={y(level)}
              y2={y(level)}
              stroke={color}
              strokeWidth={width}
              strokeDasharray={dash}
              opacity={0.75}
            />
          );

          const scoreColor = (v: number) =>
            v > trigger ? terminal.green : v < -trigger ? terminal.red : terminal.muted;
          const scrubPt = scrubIdx != null ? signals[scrubIdx] : undefined;
          const tipLines: ScrubTipLine[] = [];
          if (scrubPt) {
            tipLines.push({
              text: shortDate(scrubPt.date, true).toUpperCase(),
              color: terminal.amberHot,
            });
            if (scrubPt.Close != null) {
              tipLines.push({ text: `C ${fmtPrice(scrubPt.Close)}`, color: terminal.textStrong });
            }
            if (scrubPt.flow_score != null) {
              tipLines.push({
                text: `FLOW ${scrubPt.flow_score.toFixed(1)}`,
                color: scoreColor(scrubPt.flow_score),
              });
            }
            if (scrubPt.compass_signal != null) {
              tipLines.push({
                text: `SIG ${scrubPt.compass_signal.toFixed(1)}`,
                color: terminal.amberHot,
              });
            }
            if (scrubPt.state) {
              tipLines.push({ text: scrubPt.state.toUpperCase(), color: terminal.cyan });
            }
          }

          return (
            <>
              <YGrid width={w} ticks={[-100, -50, 0, 50, 100]} y={y} format={(v) => v.toFixed(0)} />
              {bars.map((p) => {
                const i = dateIndex.get(p.date);
                if (i === undefined) return null;
                const color =
                  p.value > trigger
                    ? terminal.green
                    : p.value < -trigger
                      ? terminal.red
                      : terminal.muted;
                const top = Math.min(y(0), y(p.value));
                const height = Math.abs(y(p.value) - y(0));
                return (
                  <Rect
                    key={`fsb-${p.date}`}
                    x={x(i) - barWidth / 2}
                    y={top}
                    width={barWidth}
                    height={Math.max(0.5, height)}
                    fill={color}
                    opacity={0.72}
                  />
                );
              })}
              <Line
                x1={0}
                x2={w}
                y1={y(0)}
                y2={y(0)}
                stroke={terminal.text}
                strokeWidth={0.8}
                opacity={0.72}
              />
              {guide(trigger, terminal.green, "5 4", 1.1)}
              {guide(-trigger, terminal.red, "5 4", 1.1)}
              {guide(strong, terminal.cyan, "2 3", 1.3)}
              {guide(-strong, terminal.orange, "2 3", 1.3)}
              <SafePolyline
                points={polylinePoints(s.compass_signal, dateIndex, x, y)}
                fill="none"
                stroke={terminal.amberHot}
                strokeWidth={1.9}
              />
              {freshLongs.map((p) =>
                p.flow_score != null ? (
                  <TriangleMarker
                    key={`flt-${p.date}`}
                    cx={x(dateIndex.get(p.date) ?? 0)}
                    cy={y(p.flow_score)}
                    dir="up"
                    color={terminal.green}
                  />
                ) : null,
              )}
              {freshShorts.map((p) =>
                p.flow_score != null ? (
                  <TriangleMarker
                    key={`fst-${p.date}`}
                    cx={x(dateIndex.get(p.date) ?? 0)}
                    cy={y(p.flow_score)}
                    dir="down"
                    color={terminal.red}
                  />
                ) : null,
              )}
              <XDateLabels dates={dates} x={x} height={h} />
              {scrubIdx != null && scrubPt ? (
                <>
                  <Crosshair x={x(scrubIdx)} bottom={h - 16} />
                  {scrubPt.flow_score != null ? (
                    <ScrubDot
                      cx={x(scrubIdx)}
                      cy={y(scrubPt.flow_score)}
                      color={scoreColor(scrubPt.flow_score)}
                    />
                  ) : null}
                  {scrubPt.compass_signal != null ? (
                    <ScrubDot
                      cx={x(scrubIdx)}
                      cy={y(scrubPt.compass_signal)}
                      color={terminal.amberHot}
                    />
                  ) : null}
                  <ScrubTip x={x(scrubIdx)} plotWidth={w} lines={tipLines} />
                </>
              ) : null}
            </>
          );
        }}
      </Panel>

      <LegendRow
        items={[
          { color: terminal.amberHot, label: "Compass signal" },
          { color: terminal.green, label: `Long > +${trigger.toFixed(0)}`, dashed: true },
          { color: terminal.red, label: `Short < −${trigger.toFixed(0)}`, dashed: true },
          { color: terminal.cyan, label: `Strong ±${strong.toFixed(0)}`, dashed: true },
        ]}
      />

      <PanelHeading label="Component scores" />
      <View style={styles.componentBox}>
        {components.map((c) => (
          <ComponentBar key={c.label} label={c.label} score={c.score} />
        ))}
      </View>
    </ChartShell>
  );
}

/** Horizontal diverging bar over ±105 with the value printed at the end. */
function ComponentBar({ label, score }: { label: string; score: number | null }) {
  const value = score ?? 0;
  const frac = Math.min(1, Math.abs(value) / SCORE_RANGE) * 0.5;
  const color = flowComponentColor(score);
  return (
    <View style={styles.componentRow}>
      <Text style={styles.componentLabel}>{label}</Text>
      <View style={styles.track}>
        <View style={styles.zeroLine} />
        <View
          style={[
            styles.bar,
            {
              backgroundColor: color,
              width: `${frac * 100}%`,
              left: value >= 0 ? "50%" : `${50 - frac * 100}%`,
            },
          ]}
        />
      </View>
      <Text style={[styles.componentValue, { color }]}>{value.toFixed(1)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  componentBox: {
    backgroundColor: terminal.axBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 201, 74, 0.34)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 7,
  },
  componentRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  componentLabel: { color: terminal.muted, fontSize: 9.5, fontWeight: "600", width: 62 },
  track: {
    flex: 1,
    height: 11,
    borderRadius: 3,
    backgroundColor: terminal.panel,
    overflow: "hidden",
  },
  zeroLine: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: terminal.text,
    opacity: 0.55,
  },
  bar: { position: "absolute", top: 1.5, bottom: 1.5, borderRadius: 2, opacity: 0.86 },
  componentValue: {
    width: 46,
    textAlign: "right",
    fontSize: 9.5,
    fontWeight: "700",
    fontFamily: MONO_FONT,
  },
});
