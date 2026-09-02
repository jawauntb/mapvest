import { fmtSignedPct } from "@/prism/format";
import type { FanPoint } from "@/prism/scenario";
import { SafePolygon, SafePolyline } from "../primitives";
import { extent, linearScale, niceTicks, padDomain } from "../scale";
import { Circle, G, Line, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismLegend, PrismPanel } from "./PrismPanel";
import { chart } from "./theme";

const HEIGHT = 200;
const PAD_L = 38;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 22;

type Seg = FanPoint[];

/** Split the horizon list into contiguous runs where `pick` has a number. */
function segments(points: FanPoint[], pick: (p: FanPoint) => number | null): Seg[] {
  const out: Seg[] = [];
  let current: Seg = [];
  for (const p of points) {
    if (pick(p) === null) {
      if (current.length > 0) out.push(current);
      current = [];
      continue;
    }
    current.push(p);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * The horizon fan: probability-weighted expected return per horizon with the
 * p10..p90 mixture band behind it.
 *
 * The x axis is spaced by *months*, not by slot, so the widening of the band
 * over time is the real shape and not an artefact of equal spacing. A horizon
 * no case projected is simply absent — the band and the line break rather than
 * running through a zero.
 */
export function HorizonFan({ fan }: { fan: FanPoint[] }) {
  const values = fan.flatMap((p) =>
    [p.p10, p.p50, p.p90, p.expected].filter((v): v is number => typeof v === "number"),
  );
  if (values.length === 0) {
    return <PrismChartEmpty note="No horizon projections in this packet." />;
  }

  const bandSegs = segments(fan, (p) => (p.p10 !== null && p.p90 !== null ? p.p10 : null));
  const medianSegs = segments(fan, (p) => p.p50);
  const expectedSegs = segments(fan, (p) => p.expected);

  return (
    <>
      <PrismPanel height={HEIGHT}>
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

              {bandSegs.map((seg) => {
                const head = seg[0];
                if (!head) return null;
                const upper = seg.map(
                  (p) => `${x(p.months).toFixed(1)},${y(p.p90 ?? 0).toFixed(1)}`,
                );
                const lower = [...seg]
                  .reverse()
                  .map((p) => `${x(p.months).toFixed(1)},${y(p.p10 ?? 0).toFixed(1)}`);
                return (
                  <SafePolygon
                    key={`band-${head.horizon}`}
                    points={[...upper, ...lower].join(" ")}
                    fill={chart.infoSoft}
                  />
                );
              })}

              {medianSegs.map((seg) => {
                const head = seg[0];
                if (!head) return null;
                return (
                  <SafePolyline
                    key={`p50-${head.horizon}`}
                    points={seg
                      .map((p) => `${x(p.months).toFixed(1)},${y(p.p50 ?? 0).toFixed(1)}`)
                      .join(" ")}
                    fill="none"
                    stroke={chart.info}
                    strokeWidth={1.2}
                    strokeDasharray="4 3"
                  />
                );
              })}

              {expectedSegs.map((seg) => {
                const head = seg[0];
                if (!head) return null;
                return (
                  <SafePolyline
                    key={`exp-${head.horizon}`}
                    points={seg
                      .map((p) => `${x(p.months).toFixed(1)},${y(p.expected ?? 0).toFixed(1)}`)
                      .join(" ")}
                    fill="none"
                    stroke={chart.bull}
                    strokeWidth={2}
                  />
                );
              })}

              {fan.map((p) => {
                if (p.expected === null) return null;
                const above = (p.p90 ?? p.expected) >= p.expected;
                return (
                  <G key={`pt-${p.horizon}`}>
                    <Circle
                      cx={x(p.months)}
                      cy={y(p.expected)}
                      r={3}
                      fill={p.expected >= 0 ? chart.bull : chart.bear}
                      stroke={chart.bg}
                      strokeWidth={1}
                    />
                    <SvgText
                      x={x(p.months)}
                      y={y(p.expected) + (above ? -8 : 14)}
                      fill={chart.text}
                      fontSize={8.5}
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {fmtSignedPct(p.expected, 1)}
                    </SvgText>
                  </G>
                );
              })}

              {fan.map((p) => (
                <SvgText
                  key={`xt-${p.horizon}`}
                  x={x(p.months)}
                  y={h - 6}
                  fill={p.expected === null ? chart.dim : chart.muted}
                  fontSize={8.5}
                  textAnchor="middle"
                >
                  {p.horizon.toUpperCase()}
                </SvgText>
              ))}
            </>
          );
        }}
      </PrismPanel>
      <PrismLegend
        items={[
          { color: chart.bull, label: "Expected" },
          { color: chart.info, label: "Median", dashed: true },
          { color: chart.info, label: "p10–p90" },
        ]}
      />
    </>
  );
}
