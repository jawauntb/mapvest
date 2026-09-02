import { fmtSignedPct } from "@/prism/format";
import type { SeasonalRow } from "@/prism/signals";
import { G, Rect, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismPanel } from "./PrismPanel";
import { chart, divergingColor, onDivergingText } from "./theme";

const LABEL_W = 56;
const HEADER_H = 16;
const ROW_H = 30;
const GAP = 3;

/**
 * This-calendar-month mean return for the ticker and its benchmarks across the
 * 1 / 2 / 5 / 10-year lookbacks.
 *
 * Cell fill is a symmetric diverging ramp over the largest absolute mean in the
 * grid, so the strongest month in view sets the scale. A cell the engine could
 * not compute stays at the ground color and prints an em dash — never a zero.
 * The thin bar under each value is the hit rate (share of those years positive).
 */
export function SeasonalityGrid({ rows }: { rows: SeasonalRow[] }) {
  if (rows.length === 0) {
    return <PrismChartEmpty note="No seasonality rows in this packet." />;
  }
  const windows = rows[0]?.cells.map((c) => c.window) ?? [];
  const max = Math.max(
    0.01,
    ...rows.flatMap((r) => r.cells.map((c) => (c.mean === null ? 0 : Math.abs(c.mean)))),
  );
  const height = HEADER_H + rows.length * (ROW_H + GAP);

  return (
    <PrismPanel height={height + 6}>
      {(w) => {
        const gridW = Math.max(40, w - LABEL_W - 8);
        const colW = gridW / Math.max(1, windows.length);
        return (
          <>
            {windows.map((window, ci) => (
              <SvgText
                key={`h-${window}`}
                x={LABEL_W + ci * colW + colW / 2}
                y={11}
                fill={chart.dim}
                fontSize={9}
                textAnchor="middle"
              >
                {window.toUpperCase()}
              </SvgText>
            ))}
            {rows.map((row, ri) => {
              const y = HEADER_H + ri * (ROW_H + GAP);
              return (
                <G key={`row-${row.symbol}`}>
                  <SvgText
                    x={4}
                    y={y + ROW_H / 2 + 4}
                    fill={row.isTicker ? chart.text : chart.muted}
                    fontSize={row.isTicker ? 11 : 10}
                    fontWeight={row.isTicker ? "bold" : undefined}
                  >
                    {row.symbol}
                  </SvgText>
                  {row.cells.map((cell, ci) => {
                    const x = LABEL_W + ci * colW;
                    const cw = colW - GAP;
                    return (
                      <G key={`cell-${row.symbol}-${cell.window}`}>
                        <Rect
                          x={x}
                          y={y}
                          width={cw}
                          height={ROW_H}
                          rx={4}
                          fill={divergingColor(cell.mean, max)}
                        />
                        <SvgText
                          x={x + cw / 2}
                          y={y + 15}
                          fill={onDivergingText(cell.mean, max)}
                          fontSize={10}
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {fmtSignedPct(cell.mean, 1)}
                        </SvgText>
                        {cell.hitRate === null ? null : (
                          <Rect
                            x={x + 6}
                            y={y + ROW_H - 7}
                            width={Math.max(
                              0.5,
                              (cw - 12) * Math.min(1, Math.max(0, cell.hitRate)),
                            )}
                            height={2.5}
                            rx={1.5}
                            fill={onDivergingText(cell.mean, max)}
                            opacity={0.65}
                          />
                        )}
                      </G>
                    );
                  })}
                </G>
              );
            })}
          </>
        );
      }}
    </PrismPanel>
  );
}
