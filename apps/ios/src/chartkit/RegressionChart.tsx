import type { RegressionDataset, ValuePoint } from "@/api/underlying";
import { useState } from "react";
import { View } from "react-native";
import { safeFixed } from "./format";
import { terminal } from "./palette";
import {
  ChartShell,
  Crosshair,
  LegendRow,
  Panel,
  PanelHeading,
  SafePolygon,
  SafePolyline,
  ScrubDot,
  ScrubTip,
  type ScrubTipLine,
  XDateLabels,
  YGrid,
} from "./primitives";
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
  shortDate,
} from "./scale";
import { Rect } from "./view-svg";

const PRICE_HEIGHT = 228;
const VOLUME_HEIGHT = 76;
const MAX_POINTS = 160;

/**
 * Regression channel: two stacked panels ~3:1. Top — close, regression trend,
 * ±1σ bands with cyan channel fill, EMA 21/50/200. Bottom — up/down volume.
 */
export function RegressionChart({ data }: { data: RegressionDataset }) {
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const s = {
    ohlcv: data.series?.ohlcv ?? [],
    close: data.series?.close ?? [],
    trend: data.series?.trend ?? [],
    upper_band: data.series?.upper_band ?? [],
    lower_band: data.series?.lower_band ?? [],
    ema21: data.series?.ema21 ?? [],
    ema50: data.series?.ema50 ?? [],
    ema200: data.series?.ema200 ?? [],
    volume: data.series?.volume ?? [],
  };
  const bars = decimate(s.ohlcv, MAX_POINTS);
  const dates = bars.map((b) => b.date);
  const dateIndex = indexByDate(dates);

  const values = (series: ValuePoint[]) =>
    series.filter((p) => dateIndex.has(p.date)).map((p) => p.value);

  // Series are sparse relative to the decimated bar dates, so the scrub readout joins by date.
  const closeBy = new Map(s.close.map((p) => [p.date, p.value]));
  const trendBy = new Map(s.trend.map((p) => [p.date, p.value]));
  const upperBy = new Map(s.upper_band.map((p) => [p.date, p.value]));
  const lowerBy = new Map(s.lower_band.map((p) => [p.date, p.value]));

  return (
    <ChartShell
      title={`${data.ticker} regression channel`}
      subtitle={`SLOPE ${safeFixed(data.meta?.slope_per_day, 4)}/SESSION | SIGMA ${safeFixed(data.meta?.residual_std)}`}
      footerLeft={`${data.ticker} trend diagnostics`}
      footerRight={`source ${data.provider ?? "n/a"}`}
    >
      <Panel height={PRICE_HEIGHT} scrub={{ count: dates.length, onIndex: setScrubIdx }}>
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

          let scrub: React.ReactNode = null;
          const bar = scrubIdx == null ? undefined : bars[scrubIdx];
          if (scrubIdx != null && bar) {
            const cx = x(scrubIdx);
            const close = closeBy.get(bar.date) ?? bar.close;
            const trend = trendBy.get(bar.date);
            const upperVal = upperBy.get(bar.date);
            const lowerVal = lowerBy.get(bar.date);
            const lines: ScrubTipLine[] = [
              { text: shortDate(bar.date, true).toUpperCase(), color: terminal.amberHot },
              { text: `C ${fmtPrice(close)}`, color: terminal.textStrong },
            ];
            if (trend != null) {
              lines.push({ text: `TREND ${fmtPrice(trend)}`, color: terminal.amberHot });
            }
            if (upperVal != null) {
              lines.push({ text: `+1σ ${fmtPrice(upperVal)}`, color: terminal.green });
            }
            if (lowerVal != null) {
              lines.push({ text: `−1σ ${fmtPrice(lowerVal)}`, color: terminal.red });
            }
            lines.push({ text: `VOL ${fmtCompact(bar.volume)}`, color: terminal.muted });
            scrub = (
              <>
                <Crosshair x={cx} bottom={h - 16} />
                <ScrubDot cx={cx} cy={y(close)} color={terminal.textStrong} />
                {trend != null ? (
                  <ScrubDot cx={cx} cy={y(trend)} color={terminal.amberHot} />
                ) : null}
                <ScrubTip x={cx} plotWidth={w} lines={lines} />
              </>
            );
          }

          return (
            <>
              <YGrid width={w} ticks={niceTicks(domain, 4)} y={y} format={fmtPrice} />
              {channel ? (
                <SafePolygon points={channel} fill={terminal.cyan} opacity={0.11} />
              ) : null}
              <SafePolyline
                points={pts(s.ema21)}
                fill="none"
                stroke={terminal.cyan}
                strokeWidth={1}
              />
              <SafePolyline
                points={pts(s.ema50)}
                fill="none"
                stroke={terminal.violet}
                strokeWidth={1}
              />
              <SafePolyline
                points={pts(s.ema200)}
                fill="none"
                stroke={terminal.orange}
                strokeWidth={1}
              />
              <SafePolyline
                points={pts(s.upper_band)}
                fill="none"
                stroke={terminal.green}
                strokeWidth={1}
                strokeDasharray="5 4"
              />
              <SafePolyline
                points={pts(s.lower_band)}
                fill="none"
                stroke={terminal.red}
                strokeWidth={1}
                strokeDasharray="5 4"
              />
              <SafePolyline
                points={pts(s.trend)}
                fill="none"
                stroke={terminal.amberHot}
                strokeWidth={2}
              />
              <SafePolyline
                points={pts(s.close)}
                fill="none"
                stroke={terminal.textStrong}
                strokeWidth={1.4}
              />
              <XDateLabels dates={dates} x={x} height={h} />
              {scrub}
            </>
          );
        }}
      </Panel>

      <PanelHeading label="Volume" />
      <Panel height={VOLUME_HEIGHT} scrub={{ count: dates.length, onIndex: setScrubIdx }}>
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
              {scrubIdx != null ? <Crosshair x={x(scrubIdx)} bottom={h - 2} /> : null}
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
