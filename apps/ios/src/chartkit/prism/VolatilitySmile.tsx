import { fmtPct } from "@/prism/format";
import type { SmilePoint } from "@/prism/signals";
import { SafePolyline } from "../primitives";
import { extent, linearScale, padDomain } from "../scale";
import { Circle, G, Line, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismLegend, PrismPanel } from "./PrismPanel";
import { chart } from "./theme";

const HEIGHT = 168;

/**
 * The implied-volatility smile for the nearest monthly expiry, plotted against
 * moneyness (strike ÷ spot). The dashed vertical is at-the-money; a smile that
 * leans left of it is the market paying up for downside.
 */
export function VolatilitySmile({
  points,
  atmIv,
}: {
  points: SmilePoint[];
  atmIv?: number | null;
}) {
  if (points.length < 2) {
    return <PrismChartEmpty note="No option-chain smile in this packet." />;
  }
  const puts = points.filter((p) => p.type === "put");
  const calls = points.filter((p) => p.type === "call");

  return (
    <>
      <PrismPanel height={HEIGHT}>
        {(w, h) => {
          const x = linearScale(padDomain(extent(points.map((p) => p.moneyness)), 0.06), [
            30,
            w - 12,
          ]);
          const domain = padDomain(extent(points.map((p) => p.iv)), 0.18);
          const y = linearScale(domain, [h - 22, 14]);
          const gridValues = [domain[0], (domain[0] + domain[1]) / 2, domain[1]];
          return (
            <>
              {gridValues.map((v) => (
                <G key={`g-${v}`}>
                  <Line
                    x1={30}
                    y1={y(v)}
                    x2={w - 12}
                    y2={y(v)}
                    stroke={chart.grid}
                    strokeWidth={1}
                  />
                  <SvgText x={26} y={y(v) + 3} fill={chart.dim} fontSize={8.5} textAnchor="end">
                    {fmtPct(v, 0)}
                  </SvgText>
                </G>
              ))}
              <Line
                x1={x(1)}
                y1={10}
                x2={x(1)}
                y2={h - 18}
                stroke={chart.gridStrong}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <SvgText x={x(1)} y={h - 6} fill={chart.dim} fontSize={8.5} textAnchor="middle">
                ATM
              </SvgText>
              <SafePolyline
                points={points
                  .map((p) => `${x(p.moneyness).toFixed(1)},${y(p.iv).toFixed(1)}`)
                  .join(" ")}
                fill="none"
                stroke={chart.muted}
                strokeWidth={1.2}
              />
              {points.map((p, i) => (
                <Circle
                  key={`pt-${p.moneyness}-${i}`}
                  cx={x(p.moneyness)}
                  cy={y(p.iv)}
                  r={2.8}
                  fill={
                    p.type === "put" ? chart.warn : p.type === "call" ? chart.info : chart.muted
                  }
                  stroke={chart.bg}
                  strokeWidth={0.8}
                />
              ))}
              {typeof atmIv === "number" && Number.isFinite(atmIv) ? (
                <SvgText
                  x={w - 12}
                  y={20}
                  fill={chart.text}
                  fontSize={10}
                  fontWeight="bold"
                  textAnchor="end"
                >
                  {`ATM IV ${fmtPct(atmIv, 1)}`}
                </SvgText>
              ) : null}
            </>
          );
        }}
      </PrismPanel>
      <PrismLegend
        items={[
          ...(puts.length > 0 ? [{ color: chart.warn, label: "Puts" }] : []),
          ...(calls.length > 0 ? [{ color: chart.info, label: "Calls" }] : []),
        ]}
      />
    </>
  );
}
