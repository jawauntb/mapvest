import { fmtPct, fmtSignedPct } from "@/prism/format";
import type { ScenarioDensity as Density, DensityPoint } from "@/prism/scenario";
import { SafePolygon, SafePolyline } from "../primitives";
import { linearScale } from "../scale";
import { G, Line, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismPanel } from "./PrismPanel";
import { chart } from "./theme";

const HEIGHT = 178;

const CASE_COLOR = {
  bull: chart.bull,
  neutral: chart.neutral,
  bear: chart.bear,
} as const;

/** Split a density at x = 0, interpolating the crossing point so the fills meet. */
function splitAtZero(points: DensityPoint[]): { below: DensityPoint[]; above: DensityPoint[] } {
  const below: DensityPoint[] = [];
  const above: DensityPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    (p.x <= 0 ? below : above).push(p);
    const next = points[i + 1];
    if (next && p.x < 0 && next.x > 0) {
      const f = (0 - p.x) / (next.x - p.x);
      const crossing = { x: 0, y: p.y + (next.y - p.y) * f };
      below.push(crossing);
      above.push(crossing);
    }
  }
  return { below, above };
}

/**
 * The scenario mixture as one density over the return axis for a chosen
 * horizon: red mass below zero, jade above, with each case's median marked.
 * The shape is normalised to a peak of one — it is a distribution's silhouette,
 * not a pdf with units.
 */
export function ScenarioDensityChart({
  density,
  horizonLabel,
}: {
  density: Density | null;
  horizonLabel: string;
}) {
  if (!density || density.points.length < 3) {
    return <PrismChartEmpty note="No scenario distribution for this horizon." />;
  }
  const { below, above } = splitAtZero(density.points);

  return (
    <PrismPanel height={HEIGHT}>
      {(w, h) => {
        const x = linearScale([density.min, density.max], [10, w - 10]);
        const y = linearScale([0, 1], [h - 24, 16]);
        const baseline = y(0);
        const area = (pts: DensityPoint[]) => {
          const head = pts[0];
          const tail = pts[pts.length - 1];
          if (!head || !tail || pts.length < 2) return null;
          return [
            `${x(head.x).toFixed(1)},${baseline.toFixed(1)}`,
            ...pts.map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`),
            `${x(tail.x).toFixed(1)},${baseline.toFixed(1)}`,
          ].join(" ");
        };
        const belowPts = area(below);
        const abovePts = area(above);

        return (
          <>
            <Line
              x1={10}
              y1={baseline}
              x2={w - 10}
              y2={baseline}
              stroke={chart.grid}
              strokeWidth={1}
            />
            {belowPts ? <SafePolygon points={belowPts} fill={chart.bearSoft} /> : null}
            {abovePts ? <SafePolygon points={abovePts} fill={chart.bullSoft} /> : null}
            <SafePolyline
              points={density.points
                .map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke={chart.text}
              strokeWidth={1.4}
            />
            {density.min < 0 && density.max > 0 ? (
              <Line x1={x(0)} y1={12} x2={x(0)} y2={baseline} stroke={chart.zero} strokeWidth={1} />
            ) : null}
            {density.marks.map((mark) => (
              <G key={mark.key}>
                <Line
                  x1={x(mark.x)}
                  y1={16}
                  x2={x(mark.x)}
                  y2={baseline}
                  stroke={CASE_COLOR[mark.key]}
                  strokeWidth={1.2}
                  strokeDasharray="3 3"
                  opacity={0.9}
                />
                <SvgText
                  x={x(mark.x)}
                  y={12}
                  fill={CASE_COLOR[mark.key]}
                  fontSize={8.5}
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {`${mark.key.toUpperCase()} ${fmtPct(mark.probability, 0)}`}
                </SvgText>
              </G>
            ))}
            <SvgText x={10} y={h - 6} fill={chart.dim} fontSize={8.5}>
              {fmtSignedPct(density.min, 0)}
            </SvgText>
            <SvgText x={w / 2} y={h - 6} fill={chart.muted} fontSize={8.5} textAnchor="middle">
              {`${horizonLabel} return`}
            </SvgText>
            <SvgText x={w - 10} y={h - 6} fill={chart.dim} fontSize={8.5} textAnchor="end">
              {fmtSignedPct(density.max, 0)}
            </SvgText>
          </>
        );
      }}
    </PrismPanel>
  );
}
