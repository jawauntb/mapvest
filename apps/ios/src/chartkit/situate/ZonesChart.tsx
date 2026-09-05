import { fmtPrice, fmtSignedPct } from "@/situate/format";
import type { LevelRow, ZoneView } from "@/situate/signals";
import { extent, linearScale, padDomain } from "../scale";
import { G, Line, Rect, Text as SvgText } from "../view-svg";
import { SituateChartEmpty, SituatePanel } from "./panel";
import { chart } from "./theme";

const HEIGHT = 220;

function levelColor(kind: string): string {
  const k = kind.toUpperCase();
  if (k === "VAH" || k === "VAL") return chart.info;
  if (k === "POC") return chart.warn;
  return chart.muted;
}

/**
 * Cheap/rich zones on a price ladder. The zones are the price at the 25th/75th
 * implied quantile (jade band = cheap, red band = rich); the dashed rails are
 * the auction levels and moving averages; the solid rail is the current price.
 * Distances are shown as percentages because "3.1% above" is the actionable
 * form, not a raw dollar gap. Not a target — a zone, with the uncertainty in
 * its width.
 */
export function ZonesChart({
  rows,
  zones,
  current,
}: {
  rows: LevelRow[];
  zones: ZoneView[];
  current: number | null;
}) {
  const prices: number[] = [
    ...rows.map((r) => r.price),
    ...(current === null ? [] : [current]),
    ...zones.flatMap((z) => [z.lo, z.hi].filter((v): v is number => typeof v === "number")),
  ];
  if (prices.length === 0) {
    return <SituateChartEmpty note="No price levels or zones in this packet." />;
  }

  return (
    <SituatePanel height={HEIGHT}>
      {(w, h) => {
        const y = linearScale(padDomain(extent(prices), 0.06), [h - 14, 14]);
        const zoneL = 46;
        const zoneR = w - 66;
        return (
          <>
            {zones.map((z) => {
              if (z.lo === null || z.hi === null) return null;
              const top = y(Math.max(z.lo, z.hi));
              const bottom = y(Math.min(z.lo, z.hi));
              const color = z.kind === "cheap" ? chart.bull : chart.bear;
              const soft = z.kind === "cheap" ? chart.bullSoft : chart.bearSoft;
              return (
                <G key={`zone-${z.kind}`}>
                  <Rect
                    x={zoneL}
                    y={top}
                    width={zoneR - zoneL}
                    height={Math.max(2, bottom - top)}
                    rx={4}
                    fill={soft}
                    stroke={color}
                    strokeWidth={0.8}
                  />
                  <SvgText
                    x={4}
                    y={(top + bottom) / 2 + 3.5}
                    fill={color}
                    fontSize={9}
                    fontWeight="bold"
                  >
                    {z.kind === "cheap" ? "CHEAP" : "RICH"}
                  </SvgText>
                </G>
              );
            })}

            {rows.map((row) => {
              const color = levelColor(row.kind);
              const ly = y(row.price);
              return (
                <G key={`${row.kind}-${row.price}`}>
                  <Line
                    x1={zoneL}
                    y1={ly}
                    x2={zoneR}
                    y2={ly}
                    stroke={color}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                    opacity={0.7}
                  />
                  <SvgText x={zoneR + 4} y={ly + 3.5} fill={chart.text} fontSize={9}>
                    {fmtPrice(row.price)}
                  </SvgText>
                  <SvgText x={w - 2} y={ly + 3.5} fill={chart.dim} fontSize={8} textAnchor="end">
                    {row.kind}
                  </SvgText>
                </G>
              );
            })}

            {current === null ? null : (
              <G>
                <Line
                  x1={zoneL}
                  y1={y(current)}
                  x2={zoneR}
                  y2={y(current)}
                  stroke={chart.bull}
                  strokeWidth={1.8}
                />
                <SvgText
                  x={4}
                  y={y(current) - 4}
                  fill={chart.bull}
                  fontSize={9.5}
                  fontWeight="bold"
                >
                  NOW {fmtPrice(current)}
                </SvgText>
              </G>
            )}
          </>
        );
      }}
    </SituatePanel>
  );
}

/** Small helper the section uses to caption a zone with its distance from spot. */
export function zoneDistanceNote(zone: ZoneView, current: number | null): string | null {
  if (current === null || zone.lo === null || zone.hi === null) return null;
  const mid = (zone.lo + zone.hi) / 2;
  return `${fmtSignedPct(mid / current - 1, 1)} from spot`;
}
