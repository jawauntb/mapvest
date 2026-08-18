import type { AuctionDataset } from "@/api/underlying";
import { G, Line, Polyline, Rect } from "react-native-svg";
import { terminal } from "./palette";
import { ChartShell, LevelPill, Panel, XDateLabels, YGrid } from "./primitives";
import { bucketOhlc, extent, fmtPrice, linearScale, niceTicks, padDomain } from "./scale";

const PANEL_HEIGHT = 260;
const PILL_GUTTER = 64;
const MAX_BARS = 110;

/**
 * Auction map: candles + close line with VAH/VAL/POC levels, value-area
 * shading, and right-edge level pills.
 */
export function AuctionChart({ data }: { data: AuctionDataset }) {
  const { vah, val, poc } = data.levels;
  const bars = bucketOhlc(data.series.ohlcv, MAX_BARS);
  const dates = bars.map((b) => b.date);

  return (
    <ChartShell
      title={`${data.ticker} auction map`}
      subtitle={`${data.period.toUpperCase()} | PROVIDER ${data.provider ?? "n/a"} | ${data.meta.location.toUpperCase()}`}
      footerLeft={`Fair price ${poc.toFixed(2)} | high ${vah.toFixed(2)} | low ${val.toFixed(2)}`}
      footerRight={`${data.ticker} ${data.period}`}
    >
      <Panel height={PANEL_HEIGHT}>
        {(w, h) => {
          if (bars.length === 0) return null;
          const plotRight = w - PILL_GUTTER;
          const x = linearScale([0, Math.max(1, bars.length - 1)], [6, plotRight - 6]);
          const domain = padDomain(
            extent([...bars.flatMap((b) => [b.low, b.high]), vah, val, poc]),
            0.05,
          );
          const y = linearScale(domain, [h - 18, 10]);
          const bodyWidth = Math.max(1.5, ((plotRight - 12) / bars.length) * 0.55);

          return (
            <>
              <YGrid width={w} ticks={niceTicks(domain, 4)} y={y} format={fmtPrice} />
              {/* Value-area shading: VAL→VAH amber, POC→VAH green, VAL→POC red */}
              <Rect
                x={0}
                y={y(vah)}
                width={plotRight}
                height={Math.max(0, y(val) - y(vah))}
                fill={terminal.amber}
                opacity={0.055}
              />
              <Rect
                x={0}
                y={y(vah)}
                width={plotRight}
                height={Math.max(0, y(poc) - y(vah))}
                fill={terminal.green}
                opacity={0.11}
              />
              <Rect
                x={0}
                y={y(poc)}
                width={plotRight}
                height={Math.max(0, y(val) - y(poc))}
                fill={terminal.red}
                opacity={0.11}
              />
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
              <Line
                x1={0}
                x2={plotRight}
                y1={y(vah)}
                y2={y(vah)}
                stroke={terminal.green}
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              <Line
                x1={0}
                x2={plotRight}
                y1={y(val)}
                y2={y(val)}
                stroke={terminal.red}
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
              <Line
                x1={0}
                x2={plotRight}
                y1={y(poc)}
                y2={y(poc)}
                stroke={terminal.amberHot}
                strokeWidth={2}
                strokeDasharray="8 3 2 3"
              />
              <XDateLabels dates={dates} x={x} height={h} />
              <LevelPill
                plotWidth={w}
                y={y(vah)}
                label={`VAH ${vah.toFixed(2)}`}
                color={terminal.green}
              />
              <LevelPill
                plotWidth={w}
                y={y(poc)}
                label={`POC ${poc.toFixed(2)}`}
                color={terminal.amber}
              />
              <LevelPill
                plotWidth={w}
                y={y(val)}
                label={`VAL ${val.toFixed(2)}`}
                color={terminal.red}
              />
            </>
          );
        }}
      </Panel>
    </ChartShell>
  );
}
