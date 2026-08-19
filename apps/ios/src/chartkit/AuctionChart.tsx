import type { AuctionDataset } from "@/api/underlying";
import { useState } from "react";
import { G, Line, Polyline, Rect } from "react-native-svg";
import { safeFixed, safeUpper } from "./format";
import { terminal } from "./palette";
import {
  ChartShell,
  Crosshair,
  LevelPill,
  Panel,
  ScrubDot,
  ScrubTip,
  XDateLabels,
  YGrid,
} from "./primitives";
import {
  bucketOhlc,
  extent,
  fmtCompact,
  fmtPrice,
  linearScale,
  niceTicks,
  padDomain,
  shortDate,
} from "./scale";

const PANEL_HEIGHT = 260;
const PILL_GUTTER = 64;
const MAX_BARS = 110;

/**
 * Auction map: candles + close line with VAH/VAL/POC levels, value-area
 * shading, and right-edge level pills.
 */
export function AuctionChart({ data }: { data: AuctionDataset }) {
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const { vah, val, poc } = data.levels ?? { vah: undefined, val: undefined, poc: undefined };
  const bars = bucketOhlc(data.series?.ohlcv ?? [], MAX_BARS);
  const dates = bars.map((b) => b.date);

  return (
    <ChartShell
      title={`${data.ticker} auction map`}
      subtitle={`${safeUpper(data.period)} | PROVIDER ${data.provider ?? "n/a"} | ${safeUpper(data.meta?.location)}`}
      footerLeft={`Fair price ${safeFixed(poc)} | high ${safeFixed(vah)} | low ${safeFixed(val)}`}
      footerRight={`${data.ticker} ${data.period}`}
    >
      <Panel
        height={PANEL_HEIGHT}
        scrub={{ count: bars.length, onIndex: setScrubIdx, padEnd: PILL_GUTTER + 6 }}
      >
        {(w, h) => {
          if (bars.length === 0) return null;
          const plotRight = w - PILL_GUTTER;
          const x = linearScale([0, Math.max(1, bars.length - 1)], [6, plotRight - 6]);
          const domain = padDomain(
            extent(
              [...bars.flatMap((b) => [b.low, b.high]), vah, val, poc].filter(
                (n): n is number => typeof n === "number" && Number.isFinite(n),
              ),
            ),
            0.05,
          );
          const y = linearScale(domain, [h - 18, 10]);
          const bodyWidth = Math.max(1.5, ((plotRight - 12) / bars.length) * 0.55);

          let scrub: React.ReactNode = null;
          const bar = scrubIdx == null ? undefined : bars[scrubIdx];
          if (scrubIdx != null && bar) {
            const cx = x(scrubIdx);
            const closeColor = bar.close >= bar.open ? terminal.green : terminal.red;
            scrub = (
              <>
                <Crosshair x={cx} bottom={h - 16} color={terminal.amberHot} />
                <ScrubDot cx={cx} cy={y(bar.close)} color={closeColor} />
                <ScrubTip
                  x={cx}
                  plotWidth={plotRight}
                  lines={[
                    { text: shortDate(bar.date, true).toUpperCase(), color: terminal.amberHot },
                    { text: `O ${fmtPrice(bar.open)}`, color: terminal.text },
                    { text: `H ${fmtPrice(bar.high)}`, color: terminal.green },
                    { text: `L ${fmtPrice(bar.low)}`, color: terminal.red },
                    { text: `C ${fmtPrice(bar.close)}`, color: closeColor },
                    { text: `VOL ${fmtCompact(bar.volume)}`, color: terminal.muted },
                  ]}
                />
              </>
            );
          }

          return (
            <>
              <YGrid width={w} ticks={niceTicks(domain, 4)} y={y} format={fmtPrice} />
              {typeof vah === "number" && typeof val === "number" ? (
                <Rect
                  x={0}
                  y={y(vah)}
                  width={plotRight}
                  height={Math.max(0, y(val) - y(vah))}
                  fill={terminal.amber}
                  opacity={0.055}
                />
              ) : null}
              {typeof vah === "number" && typeof poc === "number" ? (
                <Rect
                  x={0}
                  y={y(vah)}
                  width={plotRight}
                  height={Math.max(0, y(poc) - y(vah))}
                  fill={terminal.green}
                  opacity={0.11}
                />
              ) : null}
              {typeof poc === "number" && typeof val === "number" ? (
                <Rect
                  x={0}
                  y={y(poc)}
                  width={plotRight}
                  height={Math.max(0, y(val) - y(poc))}
                  fill={terminal.red}
                  opacity={0.11}
                />
              ) : null}
              {bars.map((b, i) => {
                const color = b.close >= b.open ? terminal.green : terminal.red;
                const cx = x(i);
                return (
                  <G key={b.date}>
                    <Line
                      x1={cx}
                      x2={cx}
                      y1={y(b.low)}
                      y2={y(b.high)}
                      stroke={color}
                      strokeWidth={0.9}
                      opacity={0.8}
                    />
                    <Line
                      x1={cx}
                      x2={cx}
                      y1={y(b.open)}
                      y2={y(b.close)}
                      stroke={color}
                      strokeWidth={bodyWidth}
                      opacity={0.95}
                    />
                  </G>
                );
              })}
              <Polyline
                points={bars.map((b, i) => `${x(i).toFixed(1)},${y(b.close).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={terminal.textStrong}
                strokeWidth={1.4}
              />
              {typeof vah === "number" ? (
                <Line
                  x1={0}
                  x2={plotRight}
                  y1={y(vah)}
                  y2={y(vah)}
                  stroke={terminal.green}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              ) : null}
              {typeof val === "number" ? (
                <Line
                  x1={0}
                  x2={plotRight}
                  y1={y(val)}
                  y2={y(val)}
                  stroke={terminal.red}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              ) : null}
              {typeof poc === "number" ? (
                <Line
                  x1={0}
                  x2={plotRight}
                  y1={y(poc)}
                  y2={y(poc)}
                  stroke={terminal.amberHot}
                  strokeWidth={2}
                  strokeDasharray="8 3 2 3"
                />
              ) : null}
              <XDateLabels dates={dates} x={x} height={h} />
              {typeof vah === "number" ? (
                <LevelPill
                  plotWidth={w}
                  y={y(vah)}
                  label={`VAH ${safeFixed(vah)}`}
                  color={terminal.green}
                />
              ) : null}
              {typeof poc === "number" ? (
                <LevelPill
                  plotWidth={w}
                  y={y(poc)}
                  label={`POC ${safeFixed(poc)}`}
                  color={terminal.amber}
                />
              ) : null}
              {typeof val === "number" ? (
                <LevelPill
                  plotWidth={w}
                  y={y(val)}
                  label={`VAL ${safeFixed(val)}`}
                  color={terminal.red}
                />
              ) : null}
              {scrub}
            </>
          );
        }}
      </Panel>
    </ChartShell>
  );
}
