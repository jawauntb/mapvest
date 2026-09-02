import { fmtPrice, fmtSignedPct } from "@/prism/format";
import type { LevelRow } from "@/prism/signals";
import { extent, linearScale, padDomain } from "../scale";
import { G, Line, Rect, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismPanel } from "./PrismPanel";
import { chart } from "./theme";

const HEIGHT = 196;

function levelColor(kind: string): string {
  const k = kind.toUpperCase();
  if (k === "VAH" || k === "VAL") return chart.info;
  if (k === "POC") return chart.warn;
  return chart.muted;
}

/**
 * Price ladder: every level the engine published, laid out on one price axis
 * with the current price as the live rail. Distances are shown as percentages
 * because "3.1% above" is the actionable form, not the raw dollar gap.
 */
export function KeyLevelsChart({
  rows,
  current,
}: {
  rows: LevelRow[];
  current: number | null;
}) {
  if (rows.length === 0) {
    return <PrismChartEmpty note="No key levels in this packet." />;
  }
  const prices = [...rows.map((r) => r.price), ...(current === null ? [] : [current])];

  return (
    <PrismPanel height={HEIGHT}>
      {(w, h) => {
        const y = linearScale(padDomain(extent(prices), 0.06), [h - 14, 14]);
        return (
          <>
            {rows.map((row, i) => {
              const color = levelColor(row.kind);
              const ly = y(row.price);
              return (
                <G key={`${row.kind}-${row.price}-${i}`}>
                  <Line
                    x1={52}
                    y1={ly}
                    x2={w - 62}
                    y2={ly}
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    opacity={0.75}
                  />
                  <SvgText x={4} y={ly + 3.5} fill={color} fontSize={9.5} fontWeight="bold">
                    {row.kind.toUpperCase()}
                  </SvgText>
                  <SvgText x={w - 58} y={ly + 3.5} fill={chart.text} fontSize={9.5}>
                    {fmtPrice(row.price)}
                  </SvgText>
                  <SvgText x={w - 4} y={ly + 3.5} fill={chart.dim} fontSize={8.5} textAnchor="end">
                    {fmtSignedPct(row.distance, 1, "")}
                  </SvgText>
                </G>
              );
            })}
            {current === null ? null : (
              <G>
                <Rect
                  x={40}
                  y={y(current) - 9}
                  width={w - 44}
                  height={18}
                  rx={4}
                  fill={chart.bullSoft}
                />
                <Line
                  x1={40}
                  y1={y(current)}
                  x2={w - 4}
                  y2={y(current)}
                  stroke={chart.bull}
                  strokeWidth={1.8}
                />
                <SvgText
                  x={4}
                  y={y(current) + 3.5}
                  fill={chart.bull}
                  fontSize={9.5}
                  fontWeight="bold"
                >
                  NOW
                </SvgText>
                <SvgText
                  x={w - 58}
                  y={y(current) + 3.5}
                  fill={chart.bull}
                  fontSize={9.5}
                  fontWeight="bold"
                >
                  {fmtPrice(current)}
                </SvgText>
              </G>
            )}
          </>
        );
      }}
    </PrismPanel>
  );
}
