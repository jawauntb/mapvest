import type { PrismEntropyBacktest } from "@/api/prism";
import { fmtCount, fmtNumber, fmtPct } from "@/prism/format";
import { classifyEntropy } from "@/prism/signals";
import { space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { SafePolyline } from "../primitives";
import { Circle, G, Line, Rect, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismPanel } from "./PrismPanel";
import { chart } from "./theme";

const GAUGE_H = 132;

/** Band edges the engine classifies with: < 0.35 structure, > 0.7 noise. */
const BANDS: ReadonlyArray<{ from: number; to: number; color: string }> = [
  { from: 0, to: 0.35, color: chart.bull },
  { from: 0.35, to: 0.7, color: chart.neutral },
  { from: 0.7, to: 1, color: chart.warn },
];

function arcPoints(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  steps = 18,
): string {
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const v = from + ((to - from) * i) / steps;
    const theta = Math.PI * (1 - v);
    parts.push(`${(cx + r * Math.cos(theta)).toFixed(1)},${(cy - r * Math.sin(theta)).toFixed(1)}`);
  }
  return parts.join(" ");
}

/**
 * Normalised Shannon entropy of the return distribution as a half-dial:
 * 0 is pure structure on the left, 1 is pure noise on the right, and the arc is
 * banded at the engine's own 0.35 / 0.7 classification thresholds.
 */
export function EntropyGauge({
  value,
  classification,
  caption,
}: {
  value: number | null;
  classification?: string | null;
  caption?: string;
}) {
  if (value === null) {
    return <PrismChartEmpty note="Entropy was not computed for this window." />;
  }
  const label = classification ?? classifyEntropy(value) ?? "—";
  const clamped = Math.min(1, Math.max(0, value));
  const tone = label === "structure" ? chart.bull : label === "noise" ? chart.warn : chart.neutral;

  return (
    <PrismPanel height={GAUGE_H}>
      {(w, h) => {
        const cx = w / 2;
        const cy = h - 26;
        const r = Math.max(30, Math.min(cx - 24, cy - 16));
        const theta = Math.PI * (1 - clamped);
        return (
          <>
            {BANDS.map((band) => (
              <SafePolyline
                key={`band-${band.from}`}
                points={arcPoints(cx, cy, r, band.from, band.to)}
                fill="none"
                stroke={band.color}
                strokeWidth={7}
                opacity={0.45}
              />
            ))}
            <Line
              x1={cx}
              y1={cy}
              x2={cx + r * 0.88 * Math.cos(theta)}
              y2={cy - r * 0.88 * Math.sin(theta)}
              stroke={tone}
              strokeWidth={2.4}
            />
            <Circle cx={cx} cy={cy} r={4} fill={tone} stroke={chart.bg} strokeWidth={1} />
            <SvgText x={cx - r} y={cy + 14} fill={chart.dim} fontSize={8.5} textAnchor="middle">
              0 · STRUCTURE
            </SvgText>
            <SvgText x={cx + r} y={cy + 14} fill={chart.dim} fontSize={8.5} textAnchor="middle">
              NOISE · 1
            </SvgText>
            <SvgText
              x={cx}
              y={cy - 12}
              fill={chart.text}
              fontSize={22}
              fontWeight="bold"
              textAnchor="middle"
            >
              {fmtNumber(value, 2)}
            </SvgText>
            <SvgText
              x={cx}
              y={cy + 14}
              fill={tone}
              fontSize={10}
              fontWeight="bold"
              textAnchor="middle"
            >
              {String(label).toUpperCase()}
            </SvgText>
            {caption ? (
              <SvgText x={cx} y={12} fill={chart.dim} fontSize={9} textAnchor="middle">
                {caption}
              </SvgText>
            ) : null}
          </>
        );
      }}
    </PrismPanel>
  );
}

/**
 * The entropy edge: forward 21-day win rate after low-entropy days versus after
 * high-entropy days, against the 50% coin-flip line. The gap between them is
 * the whole claim, so it is labeled explicitly rather than left to the eye.
 */
export function EntropyBacktestBars({ backtest }: { backtest: PrismEntropyBacktest | null }) {
  const low =
    typeof backtest?.low_entropy_win_rate === "number" ? backtest.low_entropy_win_rate : null;
  const high =
    typeof backtest?.high_entropy_win_rate === "number" ? backtest.high_entropy_win_rate : null;
  if (low === null && high === null) {
    return <PrismChartEmpty note="No entropy backtest in this packet." />;
  }
  const rows: Array<{ label: string; value: number | null; n: unknown; color: string }> = [
    { label: "Low entropy", value: low, n: backtest?.n_low, color: chart.bull },
    { label: "High entropy", value: high, n: backtest?.n_high, color: chart.warn },
  ];

  return (
    <View style={{ gap: space.sm }}>
      <PrismPanel height={72}>
        {(w) => {
          const labelW = 78;
          const barX = labelW;
          const barW = Math.max(20, w - labelW - 46);
          const half = barX + barW * 0.5;
          return (
            <>
              {rows.map((row, i) => {
                const y = 12 + i * 30;
                return (
                  <G key={row.label}>
                    <SvgText x={4} y={y + 12} fill={chart.muted} fontSize={10}>
                      {row.label}
                    </SvgText>
                    <Rect x={barX} y={y} width={barW} height={16} rx={3} fill={chart.grid} />
                    {row.value === null ? null : (
                      <Rect
                        x={barX}
                        y={y}
                        width={Math.max(1, barW * Math.min(1, Math.max(0, row.value)))}
                        height={16}
                        rx={3}
                        fill={row.color}
                        opacity={0.85}
                      />
                    )}
                    <SvgText
                      x={barX + barW + 4}
                      y={y + 12}
                      fill={chart.text}
                      fontSize={10}
                      fontWeight="bold"
                    >
                      {fmtPct(row.value, 0)}
                    </SvgText>
                  </G>
                );
              })}
              <Line
                x1={half}
                y1={6}
                x2={half}
                y2={66}
                stroke={chart.gridStrong}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            </>
          );
        }}
      </PrismPanel>
      <Text style={styles.footnote}>
        Edge {fmtPct(backtest?.edge, 1)} · {fmtCount(backtest?.n_low)} low /{" "}
        {fmtCount(backtest?.n_high)} high entry days, 21-day forward horizon. Dashed line is a coin
        flip.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footnote: { color: chart.dim, fontSize: 10.5, lineHeight: 15 },
});
