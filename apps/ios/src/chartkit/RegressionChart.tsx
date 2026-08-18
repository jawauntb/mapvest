import type { RegressionDataset, ValuePoint } from "@/api/underlying";
import { View } from "react-native";
import { Polygon, Polyline, Rect } from "react-native-svg";
import { terminal } from "./palette";
import { ChartShell, LegendRow, Panel, PanelHeading, XDateLabels, YGrid } from "./primitives";
import {
  decimate,
  extent,
  fmtCompact,
  fmtPrice,
  indexByDate,
  linearScale,
  niceTicks,
  padDomain,
  polylinePoints,
} from "./scale";

const PRICE_HEIGHT = 228;
const VOLUME_HEIGHT = 76;
const MAX_POINTS = 160;

/**
 * Regression channel: two stacked panels ~3:1. Top — close, regression trend,
 * ±1σ bands with cyan channel fill, EMA 21/50/200. Bottom — up/down volume.
 */
export function RegressionChart({ data }: { data: RegressionDataset }) {
  const s = data.series;
  const bars = decimate(s.ohlcv, MAX_POINTS);
  const dates = bars.map((b) => b.date);
  const dateIndex = indexByDate(dates);

  const values = (series: ValuePoint[]) =>
    series.filter((p) => dateIndex.has(p.date)).map((p) => p.value);

  return (
    <ChartShell
      title={`${data.ticker} regression channel`}
      subtitle={`SLOPE ${data.meta.slope_per_day.toFixed(4)}/SESSION | SIGMA ${data.meta.residual_std.toFixed(2)}`}
      footerLeft={`${data.ticker} trend diagnostics`}
      footerRight={`source ${data.provider ?? "n/a"}`}
    >
      <Panel height={PRICE_HEIGHT}>
        {(w, h) => {
          if (dates.length === 0) return null;
          const x = linearScale([0, Math.max(1, dates.length - 1)], [6, w - 6]);
          const domain = padDomain(
            extent([
              ...values(s.close),
              ...values(s.upper_band),
              ...values(s.lower_band),
              ...values(s.ema200),
            ]),
            0.04,
          );
          const y = linearScale(domain, [h - 18, 8]);
          const pts = (series: ValuePoint[]) => polylinePoints(series, dateIndex, x, y);

          const upper = s.upper_band.filter((p) => dateIndex.has(p.date));
          const lower = s.lower_band.filter((p) => dateIndex.has(p.date));
          const channel = [
            ...upper.map(
              (p) => `${x(dateIndex.get(p.date) ?? 0).toFixed(1)},${y(p.value).toFixed(1)}`,
            ),
            ...lower
              .slice()
              .reverse()
              .map((p) => `${x(dateIndex.get(p.date) ?? 0).toFixed(1)},${y(p.value).toFixed(1)}`),
          ].join(" ");

          return (
            <>
              <YGrid width={w} ticks={niceTicks(domain, 4)} y={y} format={fmtPrice} />
              {channel ? <Polygon points={channel} fill={terminal.cyan} opacity={0.11} /> : null}
              <Polyline points={pts(s.ema21)} fill="none" stroke={terminal.cyan} strokeWidth={1} />
              <Polyline
                points={pts(s.ema50)}
                fill="none"
                stroke={terminal.violet}
                strokeWidth={1}
              />
              <Polyline
                points={pts(s.ema200)}
                fill="none"
                stroke={terminal.orange}
                strokeWidth={1}
              />
              <Polyline
                points={pts(s.upper_band)}
                fill="none"
                stroke={terminal.green}
                strokeWidth={1}
                strokeDasharray="5 4"
              />
              <Polyline
                points={pts(s.lower_band)}
                fill="none"
                stroke={terminal.red}
                strokeWidth={1}
                strokeDasharray="5 4"
              />
              <Polyline
                points={pts(s.trend)}
                fill="none"
                stroke={terminal.amberHot}
                strokeWidth={2}
              />
              <Polyline
                points={pts(s.close)}
                fill="none"
                stroke={terminal.textStrong}
                strokeWidth={1.4}
              />
              <XDateLabels dates={dates} x={x} height={h} />
            </>
          );
        }}
      </Panel>

      <PanelHeading label="Volume" />
      <Panel height={VOLUME_HEIGHT}>
        {(w, h) => {
          if (bars.length === 0) return null;
          const x = linearScale([0, Math.max(1, bars.length - 1)], [6, w - 6]);
          const maxVol = Math.max(1, ...bars.map((b) => b.volume));
          const y = linearScale([0, maxVol * 1.08], [h - 4, 6]);
          const barWidth = Math.max(1, ((w - 12) / bars.length) * 0.7);
          return (
            <>
              <YGrid width={w} ticks={[maxVol / 2, maxVol]} y={y} format={fmtCompact} />
              {bars.map((b, i) => (
                <Rect
                  key={b.date}
                  x={x(i) - barWidth / 2}
                  y={y(b.volume)}
                  width={barWidth}
                  height={Math.max(0.5, y(0) - y(b.volume))}
                  fill={b.close >= b.open ? terminal.green : terminal.red}
                  opacity={0.68}
                />
              ))}
            </>
          );
        }}
      </Panel>

      <View>
        <LegendRow
          items={[
            { color: terminal.textStrong, label: "Close" },
            { color: terminal.amberHot, label: "Regression" },
            { color: terminal.green, label: "+1σ", dashed: true },
            { color: terminal.red, label: "−1σ", dashed: true },
            { color: terminal.cyan, label: "EMA 21" },
            { color: terminal.violet, label: "EMA 50" },
            { color: terminal.orange, label: "EMA 200" },
          ]}
        />
      </View>
    </ChartShell>
  );
}
