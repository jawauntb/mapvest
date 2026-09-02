import { fmtPoints } from "@/prism/format";
import type { CurvePoint } from "@/prism/signals";
import { SafePolyline } from "../primitives";
import { extent, linearScale, padDomain } from "../scale";
import { Circle, G, Line, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismPanel } from "./PrismPanel";
import { chart } from "./theme";

const HEIGHT = 128;

/**
 * The Treasury curve as four points, drawn on a tenor axis. Inversion is
 * visible as a downward slope; the 2s10s number beside it names it.
 */
export function YieldCurveMini({ points }: { points: CurvePoint[] }) {
  if (points.length < 2) {
    return <PrismChartEmpty note="Not enough Treasury tenors to draw a curve." />;
  }
  return (
    <PrismPanel height={HEIGHT}>
      {(w, h) => {
        const tenors = points.map((p) => p.tenorYears);
        const x = linearScale([Math.min(...tenors), Math.max(...tenors)], [26, w - 26]);
        const domain = padDomain(extent(points.map((p) => p.value)), 0.35);
        const y = linearScale(domain, [h - 24, 22]);
        return (
          <>
            <Line x1={20} y1={h - 20} x2={w - 20} y2={h - 20} stroke={chart.grid} strokeWidth={1} />
            <SafePolyline
              points={points
                .map((p) => `${x(p.tenorYears).toFixed(1)},${y(p.value).toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke={chart.info}
              strokeWidth={2}
            />
            {points.map((p) => (
              <G key={p.label}>
                <Circle
                  cx={x(p.tenorYears)}
                  cy={y(p.value)}
                  r={3}
                  fill={chart.info}
                  stroke={chart.bg}
                  strokeWidth={1}
                />
                <SvgText
                  x={x(p.tenorYears)}
                  y={y(p.value) - 8}
                  fill={chart.text}
                  fontSize={9}
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {fmtPoints(p.value, 2)}
                </SvgText>
                <SvgText
                  x={x(p.tenorYears)}
                  y={h - 7}
                  fill={chart.dim}
                  fontSize={8.5}
                  textAnchor="middle"
                >
                  {p.label}
                </SvgText>
              </G>
            ))}
          </>
        );
      }}
    </PrismPanel>
  );
}
