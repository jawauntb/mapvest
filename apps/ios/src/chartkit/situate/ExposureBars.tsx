import { fmtNumber, fmtSignedPct } from "@/situate/format";
import type { ExposureBar } from "@/situate/signals";
import { linearScale } from "../scale";
import { G, Line, Rect, Text as SvgText } from "../view-svg";
import { SituateChartEmpty, SituatePanel } from "./panel";
import { chart } from "./theme";

const ROW_H = 26;
const PAD_T = 10;
const PAD_B = 8;
const LABEL_W = 52;
const VALUE_W = 96;

/**
 * What you're buying, in one picture: each basket beta as a diverging bar from
 * a centre zero — jade for positive exposure, red for negative — with the
 * 12-month change printed beside it so "this became more of an SPY proxy this
 * year" is legible, not buried in a table.
 */
export function ExposureBars({ bars }: { bars: ExposureBar[] }) {
  if (bars.length === 0) {
    return <SituateChartEmpty note="No exposure betas in this packet." />;
  }
  const height = PAD_T + PAD_B + bars.length * ROW_H;
  const maxAbs = Math.max(0.2, ...bars.map((b) => Math.abs(b.beta)));

  return (
    <SituatePanel height={height}>
      {(w) => {
        const plotL = LABEL_W;
        const plotR = w - VALUE_W;
        const mid = (plotL + plotR) / 2;
        const x = linearScale([-maxAbs, maxAbs], [plotL, plotR]);
        return (
          <>
            {/* centre zero rail */}
            <Line
              x1={mid}
              y1={PAD_T - 2}
              x2={mid}
              y2={height - PAD_B}
              stroke={chart.zero}
              strokeWidth={1}
            />
            {bars.map((b, i) => {
              const cy = PAD_T + i * ROW_H + ROW_H / 2;
              const bx = x(b.beta);
              const left = Math.min(mid, bx);
              const barW = Math.max(1, Math.abs(bx - mid));
              const color = b.beta >= 0 ? chart.bull : chart.bear;
              const change = b.change12m;
              return (
                <G key={b.symbol}>
                  <SvgText x={4} y={cy + 3.5} fill={chart.text} fontSize={10} fontWeight="bold">
                    {b.symbol}
                  </SvgText>
                  <Rect
                    x={left}
                    y={cy - 7}
                    width={barW}
                    height={14}
                    rx={3}
                    fill={color}
                    opacity={0.85}
                  />
                  <SvgText
                    x={w - VALUE_W + 6}
                    y={cy + 3.5}
                    fill={chart.text}
                    fontSize={10}
                    fontWeight="bold"
                  >
                    β {fmtNumber(b.beta, 2)}
                  </SvgText>
                  {change === null ? null : (
                    <SvgText
                      x={w - 4}
                      y={cy + 3.5}
                      fill={change >= 0 ? chart.bull : chart.bear}
                      fontSize={8.5}
                      textAnchor="end"
                    >
                      {fmtSignedPct(change, 0)} 12m
                    </SvgText>
                  )}
                </G>
              );
            })}
          </>
        );
      }}
    </SituatePanel>
  );
}
