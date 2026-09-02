import { fmtNumber } from "@/prism/format";
import type { FactorRow } from "@/prism/signals";
import { G, Line, Rect, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismPanel } from "./PrismPanel";
import { chart } from "./theme";

const LABEL_W = 46;
const VALUE_W = 42;
const ROW_H = 22;
const GAP = 4;

/**
 * Factor exposures as diverging bars around zero.
 *
 * A loading whose t-statistic clears ±2 is drawn solid; anything weaker is
 * drawn hollow, because an exposure the regression cannot distinguish from
 * noise should not look as load-bearing as one it can.
 */
export function FactorBars({ rows }: { rows: FactorRow[] }) {
  if (rows.length === 0) {
    return <PrismChartEmpty note="No factor loadings for this window." />;
  }
  const max = Math.max(0.5, ...rows.map((r) => (r.beta === null ? 0 : Math.abs(r.beta))));
  const height = rows.length * (ROW_H + GAP) + 14;

  return (
    <PrismPanel height={height}>
      {(w) => {
        const plotW = Math.max(30, w - LABEL_W - VALUE_W);
        const mid = LABEL_W + plotW / 2;
        const scale = plotW / 2 / max;
        return (
          <>
            <Line x1={mid} y1={4} x2={mid} y2={height - 8} stroke={chart.zero} strokeWidth={1} />
            {rows.map((row, i) => {
              const y = 8 + i * (ROW_H + GAP);
              const beta = row.beta;
              const significant = row.t !== null && Math.abs(row.t) >= 2;
              const positive = (beta ?? 0) >= 0;
              const color = positive ? chart.bull : chart.bear;
              const len = beta === null ? 0 : Math.abs(beta) * scale;
              return (
                <G key={row.name}>
                  <SvgText x={4} y={y + 14} fill={chart.text} fontSize={10} fontWeight="bold">
                    {row.name}
                  </SvgText>
                  {beta === null ? (
                    <SvgText x={mid} y={y + 14} fill={chart.dim} fontSize={9} textAnchor="middle">
                      not estimated
                    </SvgText>
                  ) : (
                    <Rect
                      x={positive ? mid : mid - len}
                      y={y + 3}
                      width={Math.max(1, len)}
                      height={ROW_H - 6}
                      rx={2}
                      fill={significant ? color : "none"}
                      stroke={color}
                      strokeWidth={significant ? 0 : 1}
                      opacity={significant ? 0.9 : 0.85}
                    />
                  )}
                  <SvgText
                    x={w - 4}
                    y={y + 14}
                    fill={significant ? chart.text : chart.muted}
                    fontSize={9.5}
                    textAnchor="end"
                  >
                    {`${fmtNumber(beta, 2)}${row.t === null ? "" : ` (t ${fmtNumber(row.t, 1)})`}`}
                  </SvgText>
                </G>
              );
            })}
          </>
        );
      }}
    </PrismPanel>
  );
}
