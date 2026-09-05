import { fmtSignedPct } from "@/situate/format";
import type { FanPoint, QuantileSet } from "@/situate/signals";
import { SafePolygon, SafePolyline } from "../primitives";
import { extent, linearScale, niceTicks, padDomain } from "../scale";
import { Circle, G, Line, Text as SvgText } from "../view-svg";
import { SituateChartEmpty, SituateLegend, SituatePanel } from "./panel";
import { chart } from "./theme";

const HEIGHT = 214;
const PAD_L = 40;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 24;

type Seg = FanPoint[];

/** Split the horizon list into contiguous runs where `pick` has a band. */
function segments(points: FanPoint[], pick: (p: FanPoint) => QuantileSet | null): Seg[] {
  const out: Seg[] = [];
  let current: Seg = [];
  for (const p of points) {
    const band = pick(p);
    if (!band || band.q05 === null || band.q95 === null) {
      if (current.length > 0) out.push(current);
      current = [];
      continue;
    }
    current.push(p);
  }
  if (current.length > 0) out.push(current);
  return out;
}

function band(
  seg: Seg,
  pick: (p: FanPoint) => QuantileSet,
  x: (m: number) => number,
  y: (v: number) => number,
): string {
  const upper = seg.map((p) => `${x(p.months).toFixed(1)},${y(pick(p).q95 ?? 0).toFixed(1)}`);
  const lower = [...seg]
    .reverse()
    .map((p) => `${x(p.months).toFixed(1)},${y(pick(p).q05 ?? 0).toFixed(1)}`);
  return [...upper, ...lower].join(" ");
}

function medianLine(points: FanPoint[], pick: (p: FanPoint) => number | null): Seg[] {
  const out: Seg[] = [];
  let cur: Seg = [];
  for (const p of points) {
    if (pick(p) === null) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The horizon quantile fan: the empirical base-rate distribution (jade) and the
 * options-implied distribution (blue) overlaid per horizon, with the merged
 * odds median as the solid line. The x-axis is spaced by *months*, so the band
 * widening over time is the real shape, not an artefact of equal slots. A
 * horizon with no band simply breaks the fan rather than running through zero.
 */
export function QuantileFan({ fan }: { fan: FanPoint[] }) {
  const values: number[] = [];
  for (const p of fan) {
    for (const set of [p.hist, p.implied, p.odds]) {
      if (!set) continue;
      for (const v of [set.q05, set.q25, set.q50, set.q75, set.q95]) {
        if (typeof v === "number") values.push(v);
      }
    }
  }
  if (values.length === 0) {
    return <SituateChartEmpty note="No per-horizon distribution in this packet." />;
  }

  const histSegs = segments(fan, (p) => p.hist);
  const impliedSegs = segments(fan, (p) => p.implied);
  const oddsMedian = medianLine(fan, (p) => p.odds?.q50 ?? null);

  return (
    <>
      <SituatePanel height={HEIGHT}>
        {(w, h) => {
          const months = fan.map((p) => p.months);
          const x = linearScale([Math.min(...months), Math.max(...months)], [PAD_L, w - PAD_R]);
          const domain = padDomain(extent([...values, 0]), 0.12);
          const y = linearScale(domain, [h - PAD_B, PAD_T]);
          const ticks = niceTicks(domain, 4);

          return (
            <>
              {ticks.map((t) => (
                <G key={`grid-${t}`}>
                  <Line
                    x1={PAD_L}
                    x2={w - PAD_R}
                    y1={y(t)}
                    y2={y(t)}
                    stroke={Math.abs(t) < 1e-9 ? chart.zero : chart.grid}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={PAD_L - 5}
                    y={y(t) + 3}
                    fill={chart.dim}
                    fontSize={8.5}
                    textAnchor="end"
                  >
                    {fmtSignedPct(t, 0)}
                  </SvgText>
                </G>
              ))}

              {/* historical (base-rate) band — jade */}
              {histSegs.map((seg) => {
                const head = seg[0];
                if (!head) return null;
                return (
                  <SafePolygon
                    key={`hist-${head.horizon}`}
                    points={band(seg, (p) => p.hist as QuantileSet, x, y)}
                    fill={chart.bullSoft}
                  />
                );
              })}

              {/* implied band — blue, overlaid */}
              {impliedSegs.map((seg) => {
                const head = seg[0];
                if (!head) return null;
                return (
                  <SafePolyline
                    key={`impl-line-${head.horizon}`}
                    points={band(seg, (p) => p.implied as QuantileSet, x, y)}
                    fill="none"
                    stroke={chart.infoEdge}
                    strokeWidth={1.1}
                    strokeDasharray="3 2"
                  />
                );
              })}

              {/* merged odds median */}
              {oddsMedian.map((seg) => {
                const head = seg[0];
                if (!head) return null;
                return (
                  <SafePolyline
                    key={`odds-${head.horizon}`}
                    points={seg
                      .map((p) => `${x(p.months).toFixed(1)},${y(p.odds?.q50 ?? 0).toFixed(1)}`)
                      .join(" ")}
                    fill="none"
                    stroke={chart.bull}
                    strokeWidth={2}
                  />
                );
              })}

              {fan.map((p) => {
                const q50 = p.odds?.q50 ?? p.hist?.q50 ?? null;
                if (q50 === null) return null;
                const above = (p.odds?.q95 ?? q50) >= q50;
                return (
                  <G key={`pt-${p.horizon}`}>
                    <Circle
                      cx={x(p.months)}
                      cy={y(q50)}
                      r={3}
                      fill={q50 >= 0 ? chart.bull : chart.bear}
                      stroke={chart.bg}
                      strokeWidth={1}
                    />
                    <SvgText
                      x={x(p.months)}
                      y={y(q50) + (above ? -8 : 14)}
                      fill={chart.text}
                      fontSize={8.5}
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {fmtSignedPct(q50, 1)}
                    </SvgText>
                  </G>
                );
              })}

              {fan.map((p) => (
                <SvgText
                  key={`xt-${p.horizon}`}
                  x={x(p.months)}
                  y={h - 7}
                  fill={chart.muted}
                  fontSize={8.5}
                  textAnchor="middle"
                >
                  {p.horizon}M
                </SvgText>
              ))}
            </>
          );
        }}
      </SituatePanel>
      <SituateLegend
        items={[
          { color: chart.bull, label: "Merged median" },
          { color: chart.bull, label: "Historical p05–p95" },
          { color: chart.info, label: "Implied p05–p95", dashed: true },
        ]}
      />
    </>
  );
}
