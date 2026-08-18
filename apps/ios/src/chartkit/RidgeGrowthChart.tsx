import type { RidgeGrowthDataset } from "@/api/underlying";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Line, Polyline, Rect } from "react-native-svg";
import { MONO_FONT, terminal } from "./palette";
import {
  ChartShell,
  Crosshair,
  LegendRow,
  Panel,
  PanelHeading,
  ScrubDot,
  ScrubTip,
  type ScrubTipLine,
  TriangleMarker,
  XDateLabels,
  YGrid,
} from "./primitives";
import {
  extent,
  fmtMoney,
  fmtPct,
  fmtPrice,
  indexByDate,
  linearScale,
  niceTicks,
  padDomain,
  polylinePoints,
  shortDate,
} from "./scale";

const PRICE_HEIGHT = 250;
const EQUITY_HEIGHT = 84;
const INITIAL_CAPITAL = 10_000;

/**
 * Ridge growth control: price + EMA75/EMA150/SMA200 with long-exposure
 * shading and buy/sell markers, the $10k strategy equity curve, and the
 * dashboard table.
 */
export function RidgeGrowthChart({ data }: { data: RidgeGrowthDataset }) {
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const m = data.meta;
  const s = data.series;
  const signals = s.signals;
  const dates = signals.map((p) => p.date);
  const dateIndex = indexByDate(dates);
  const auction = m.auction;
  const equityColor = m.total_return >= 0 ? terminal.green : terminal.red;
  const equityBy = new Map(s.equity.map((p) => [p.date, p.value]));

  return (
    <ChartShell
      title={`${data.ticker} ridge core growth control`}
      subtitle={`1D ${data.period.toUpperCase()} | STATE ${m.state} | REC ${m.recommendation}`}
      footerLeft={`${data.ticker} ${data.period} | buys ${m.buy_count} | sells ${m.sell_count} | flow ${m.flow_compass.state}`}
      footerRight="ridge growth"
    >
      <Panel height={PRICE_HEIGHT} scrub={{ count: dates.length, onIndex: setScrubIdx }}>
        {(w, h) => {
          if (dates.length === 0) return null;
          const x = linearScale([0, Math.max(1, dates.length - 1)], [6, w - 6]);
          const domain = padDomain(
            extent([
              ...s.close.map((p) => p.value),
              ...s.major_ma.map((p) => p.value),
              ...s.base_ma.map((p) => p.value),
              auction.vah,
              auction.val,
            ]),
            0.05,
          );
          const y = linearScale(domain, [h - 18, 8]);

          // Contiguous in_trade runs → long-exposure shading.
          const runs: Array<{ start: number; end: number }> = [];
          let runStart: number | null = null;
          signals.forEach((p, i) => {
            if (p.in_trade && runStart === null) runStart = i;
            if ((!p.in_trade || i === signals.length - 1) && runStart !== null) {
              runs.push({ start: runStart, end: p.in_trade ? i : Math.max(runStart, i - 1) });
              runStart = null;
            }
          });

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
            const eq = equityBy.get(scrubPt.date);
            if (eq != null) {
              tipLines.push({
                text: `EQ ${fmtMoney(eq)}`,
                color: eq >= INITIAL_CAPITAL ? terminal.green : terminal.red,
              });
            }
            tipLines.push(
              scrubPt.in_trade === true
                ? { text: "IN TRADE", color: terminal.green }
                : { text: "FLAT", color: terminal.muted },
            );
            if (scrubPt.rsi_14 != null) {
              tipLines.push({ text: `RSI ${scrubPt.rsi_14.toFixed(0)}`, color: terminal.cyan });
            }
          }

          return (
            <>
              <YGrid width={w} ticks={niceTicks(domain, 4)} y={y} format={(v) => v.toFixed(0)} />
              {runs.map((run) => (
                <Rect
                  key={`run-${run.start}`}
                  x={x(run.start)}
                  y={0}
                  width={Math.max(1, x(run.end) - x(run.start))}
                  height={h}
                  fill={terminal.green}
                  opacity={0.055}
                />
              ))}
              <Rect
                x={0}
                y={y(auction.vah)}
                width={w}
                height={Math.max(0, y(auction.val) - y(auction.vah))}
                fill={terminal.amber}
                opacity={0.04}
              />
              <Line
                x1={0}
                x2={w}
                y1={y(auction.poc)}
                y2={y(auction.poc)}
                stroke={terminal.amberHot}
                strokeWidth={1.5}
                strokeDasharray="8 3 2 3"
                opacity={0.78}
              />
              <Polyline
                points={polylinePoints(s.major_ma, dateIndex, x, y)}
                fill="none"
                stroke={terminal.muted}
                strokeWidth={1.4}
              />
              <Polyline
                points={polylinePoints(s.base_ma, dateIndex, x, y)}
                fill="none"
                stroke={terminal.amber}
                strokeWidth={1.6}
              />
              <Polyline
                points={polylinePoints(s.fast_ma, dateIndex, x, y)}
                fill="none"
                stroke={terminal.cyan}
                strokeWidth={1.6}
              />
              <Polyline
                points={polylinePoints(s.close, dateIndex, x, y)}
                fill="none"
                stroke={terminal.textStrong}
                strokeWidth={1.35}
              />
              {signals.map((p, i) => {
                if (p.buy_signal && p.Low != null) {
                  return (
                    <TriangleMarker
                      key={`buy-${p.date}`}
                      cx={x(i)}
                      cy={y(p.Low * 0.985)}
                      dir="up"
                      color={terminal.green}
                      size={6}
                    />
                  );
                }
                if (p.sell_signal && p.High != null) {
                  return (
                    <TriangleMarker
                      key={`sell-${p.date}`}
                      cx={x(i)}
                      cy={y(p.High * 1.015)}
                      dir="down"
                      color={terminal.red}
                      size={6}
                    />
                  );
                }
                return null;
              })}
              <XDateLabels dates={dates} x={x} height={h} />
              {scrubIdx != null && scrubPt ? (
                <>
                  <Crosshair x={x(scrubIdx)} bottom={h - 16} />
                  {scrubPt.Close != null ? (
                    <ScrubDot cx={x(scrubIdx)} cy={y(scrubPt.Close)} color={terminal.textStrong} />
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
          { color: terminal.textStrong, label: "Close" },
          { color: terminal.cyan, label: "Fast EMA 75" },
          { color: terminal.amber, label: "Base EMA 150" },
          { color: terminal.muted, label: "Major SMA 200" },
          { color: terminal.green, label: "Buy / long exposure" },
          { color: terminal.red, label: "Sell" },
          { color: terminal.amberHot, label: `POC ${auction.poc.toFixed(2)}`, dashed: true },
        ]}
      />

      <PanelHeading label="Strategy equity" />
      <Panel height={EQUITY_HEIGHT} scrub={{ count: dates.length, onIndex: setScrubIdx }}>
        {(w, h) => {
          if (s.equity.length === 0) return null;
          const x = linearScale([0, Math.max(1, dates.length - 1)], [6, w - 6]);
          const domain = padDomain(
            extent([...s.equity.map((p) => p.value), INITIAL_CAPITAL]),
            0.08,
          );
          const y = linearScale(domain, [h - 4, 6]);
          const scrubPt = scrubIdx != null ? signals[scrubIdx] : undefined;
          const scrubEq = scrubPt ? equityBy.get(scrubPt.date) : undefined;
          return (
            <>
              <YGrid width={w} ticks={niceTicks(domain, 2)} y={y} format={fmtMoney} />
              <Line
                x1={0}
                x2={w}
                y1={y(INITIAL_CAPITAL)}
                y2={y(INITIAL_CAPITAL)}
                stroke={terminal.muted}
                strokeWidth={1}
                strokeDasharray="5 4"
                opacity={0.62}
              />
              <Polyline
                points={polylinePoints(s.equity, dateIndex, x, y)}
                fill="none"
                stroke={equityColor}
                strokeWidth={2}
              />
              {scrubIdx != null && scrubEq != null ? (
                <>
                  <Crosshair x={x(scrubIdx)} bottom={h - 2} />
                  <ScrubDot cx={x(scrubIdx)} cy={y(scrubEq)} color={equityColor} />
                </>
              ) : null}
            </>
          );
        }}
      </Panel>

      <RidgeDashboard data={data} />
    </ChartShell>
  );
}

function RidgeDashboard({ data }: { data: RidgeGrowthDataset }) {
  const m = data.meta;
  const long = m.state === "LONG";
  const rows: Array<[string, string]> = [
    ["State", m.state],
    ["Recommendation", m.recommendation],
    ["Equity", fmtMoney(m.ending_equity)],
    ["Return", fmtPct(m.total_return)],
    ["Drawdown", fmtPct(m.max_drawdown)],
    ["Win rate", `${fmtPct(m.win_rate, 0)} of ${m.closed_trades} closed`],
    ["Flow", `${m.flow_compass.state} ${(m.flow_compass.score ?? 0).toFixed(1)}`],
    ["AMT", `${m.auction.location} / POC ${m.auction.poc.toFixed(2)}`],
    ["Caveat", "persistent large-cap trend bias"],
  ];
  return (
    <View style={styles.table}>
      <View style={[styles.headerRow, { backgroundColor: long ? terminal.green : terminal.axBg }]}>
        <Text style={[styles.headerCell, long && { color: terminal.chartBg }]}>RIDGE GROWTH</Text>
        <Text style={[styles.headerCell, long && { color: terminal.chartBg }]}>DASHBOARD</Text>
      </View>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={styles.keyCell}>{k}</Text>
          <Text style={styles.valueCell}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

const BORDER = "rgba(255, 201, 74, 0.34)";

const styles = StyleSheet.create({
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    borderRadius: 6,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  headerCell: {
    color: terminal.textStrong,
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    backgroundColor: terminal.panel,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  keyCell: { color: terminal.muted, fontSize: 10, fontWeight: "600" },
  valueCell: {
    color: terminal.text,
    fontSize: 10,
    fontWeight: "700",
    fontFamily: MONO_FONT,
    flexShrink: 1,
    textAlign: "right",
  },
});
