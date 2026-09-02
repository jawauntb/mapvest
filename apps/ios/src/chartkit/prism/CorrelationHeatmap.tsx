import { fmtNumber } from "@/prism/format";
import type { RelationalRow } from "@/prism/signals";
import { SafePolygon } from "../primitives";
import { G, Line, Rect, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismPanel } from "./PrismPanel";
import { chart, divergingColor, onDivergingText, toneColor } from "./theme";

const LABEL_W = 46;
const BETA_W = 34;
const KIN_W = 30;
const HEADER_H = 15;
const ROW_H = 24;
const GAP = 2;

/**
 * Correlation heatmap in the packet's gauge-fixed frame (excess over SPY,
 * z-scored per window) with a beta column and a kinematics arrow.
 *
 * Cell fill is correlation over a fixed ±1 domain — the scale is absolute here,
 * unlike the seasonality grid, because a correlation already lives in [-1,1].
 * The arrow is the symbol's own motion: it rises when 21-day velocity is
 * positive, and its head fills when acceleration agrees with velocity (the move
 * is still building) rather than fighting it.
 */
export function CorrelationHeatmap({
  rows,
  maxRows = 8,
}: { rows: RelationalRow[]; maxRows?: number }) {
  const shown = rows.slice(0, Math.max(1, maxRows));
  if (shown.length === 0) {
    return <PrismChartEmpty note="No relational rows in this packet." />;
  }
  const windows = shown[0]?.correlation.map((c) => c.window) ?? [];
  const maxVel = Math.max(
    1e-9,
    ...shown.map((r) => (r.velocity === null ? 0 : Math.abs(r.velocity))),
  );
  const height = HEADER_H + shown.length * (ROW_H + GAP) + 4;

  return (
    <PrismPanel height={height}>
      {(w) => {
        const gridW = Math.max(40, w - LABEL_W - BETA_W - KIN_W - 6);
        const colW = gridW / Math.max(1, windows.length);
        const betaX = LABEL_W + gridW + 4;
        const kinX = betaX + BETA_W;
        return (
          <>
            {windows.map((window, ci) => (
              <SvgText
                key={`h-${window}`}
                x={LABEL_W + ci * colW + colW / 2}
                y={10}
                fill={chart.dim}
                fontSize={8.5}
                textAnchor="middle"
              >
                {window.toUpperCase()}
              </SvgText>
            ))}
            <SvgText
              x={betaX + BETA_W / 2}
              y={10}
              fill={chart.dim}
              fontSize={8.5}
              textAnchor="middle"
            >
              β 1Y
            </SvgText>
            <SvgText
              x={kinX + KIN_W / 2}
              y={10}
              fill={chart.dim}
              fontSize={8.5}
              textAnchor="middle"
            >
              KIN
            </SvgText>

            {shown.map((row, ri) => {
              const y = HEADER_H + ri * (ROW_H + GAP);
              const cy = y + ROW_H / 2;
              const vel = row.velocity;
              const acc = row.acceleration;
              const tone =
                vel === null ? "neutral" : vel > 0 ? "bull" : vel < 0 ? "bear" : "neutral";
              const dy = vel === null ? 0 : -(vel / maxVel) * 7;
              const ax = kinX + 7;
              const bx = kinX + KIN_W - 9;
              const building = vel !== null && acc !== null && vel * acc > 0;
              return (
                <G key={`row-${row.symbol}`}>
                  <SvgText x={4} y={cy + 4} fill={chart.text} fontSize={10} fontWeight="bold">
                    {row.symbol}
                  </SvgText>
                  {row.correlation.map((cell, ci) => {
                    const x = LABEL_W + ci * colW;
                    const cw = colW - GAP;
                    return (
                      <G key={`c-${row.symbol}-${cell.window}`}>
                        <Rect
                          x={x}
                          y={y}
                          width={cw}
                          height={ROW_H}
                          rx={3}
                          fill={divergingColor(cell.value, 1)}
                        />
                        <SvgText
                          x={x + cw / 2}
                          y={cy + 3.5}
                          fill={onDivergingText(cell.value, 1)}
                          fontSize={9}
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {fmtNumber(cell.value, 2)}
                        </SvgText>
                      </G>
                    );
                  })}
                  <SvgText
                    x={betaX + BETA_W / 2}
                    y={cy + 3.5}
                    fill={chart.muted}
                    fontSize={9.5}
                    textAnchor="middle"
                  >
                    {fmtNumber(row.beta1y, 2)}
                  </SvgText>
                  {vel === null ? (
                    <SvgText
                      x={kinX + KIN_W / 2}
                      y={cy + 3.5}
                      fill={chart.dim}
                      fontSize={9}
                      textAnchor="middle"
                    >
                      —
                    </SvgText>
                  ) : (
                    <G>
                      <Line
                        x1={ax}
                        y1={cy - dy / 2}
                        x2={bx}
                        y2={cy + dy / 2}
                        stroke={toneColor(tone)}
                        strokeWidth={1.4}
                      />
                      <SafePolygon
                        points={`${bx + 4},${(cy + dy / 2).toFixed(1)} ${bx - 2},${(cy + dy / 2 - 3.4).toFixed(1)} ${bx - 2},${(cy + dy / 2 + 3.4).toFixed(1)}`}
                        fill={building ? toneColor(tone) : "none"}
                        stroke={toneColor(tone)}
                        strokeWidth={1}
                      />
                    </G>
                  )}
                </G>
              );
            })}
          </>
        );
      }}
    </PrismPanel>
  );
}
