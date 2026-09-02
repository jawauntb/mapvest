import type { PrismSpectralMode } from "@/api/prism";
import { fmtPct, humanize } from "@/prism/format";
import { cycleNodes, reconstructWave } from "@/prism/signals";
import { space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { SafePolyline } from "../primitives";
import { linearScale } from "../scale";
import { Circle, G, Line, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismLegend, PrismPanel } from "./PrismPanel";
import { chart } from "./theme";

const WHEEL_H = 226;
const WAVE_H = 118;

/**
 * Spectral cycle wheel — a circular phase diagram of the dominant modes.
 *
 * The wheel is read like a clock face of one cycle: trough at the bottom,
 * rising up the right side, peak at the top, falling down the left. Each dot is
 * one mode; its distance from the centre is that mode's share of spectral
 * power, so a dominant cycle sits near the rim and a marginal one hugs the
 * middle. That mapping is exactly the `phase_fraction` contract in the packet.
 */
export function CycleWheel({
  modes,
  limit = 6,
}: {
  modes: PrismSpectralMode[] | null | undefined;
  limit?: number;
}) {
  const nodes = cycleNodes(modes, limit);
  if (nodes.length === 0) {
    return <PrismChartEmpty note="No spectral modes in this packet." />;
  }
  const maxShare = Math.max(...nodes.map((n) => n.share), 1e-9);

  return (
    <View style={{ gap: space.sm }}>
      <PrismPanel height={WHEEL_H}>
        {(w, h) => {
          const cx = w / 2;
          const cy = h / 2;
          const R = Math.max(24, Math.min(w, h) / 2 - 30);
          return (
            <>
              <Circle cx={cx} cy={cy} r={R} fill="none" stroke={chart.grid} strokeWidth={1} />
              <Circle cx={cx} cy={cy} r={R * 0.6} fill="none" stroke={chart.grid} strokeWidth={1} />
              <Line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={chart.grid} strokeWidth={1} />
              <Line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke={chart.grid} strokeWidth={1} />

              <SvgText x={cx} y={cy - R - 8} fill={chart.dim} fontSize={8.5} textAnchor="middle">
                PEAK
              </SvgText>
              <SvgText x={cx} y={cy + R + 15} fill={chart.dim} fontSize={8.5} textAnchor="middle">
                TROUGH
              </SvgText>
              <SvgText x={cx + R + 6} y={cy + 3} fill={chart.dim} fontSize={8.5}>
                RISING
              </SvgText>
              <SvgText x={cx - R - 6} y={cy + 3} fill={chart.dim} fontSize={8.5} textAnchor="end">
                FALLING
              </SvgText>

              {nodes.map((node, i) => {
                const r = R * (0.32 + 0.68 * (node.share / maxShare));
                const px = cx + node.unitX * r;
                const py = cy + node.unitY * r;
                const dot = 3 + 4 * Math.sqrt(node.share / maxShare);
                const labelRight = node.unitX >= 0;
                return (
                  <G key={`${node.label}-${i}`}>
                    <Line
                      x1={cx}
                      y1={cy}
                      x2={px}
                      y2={py}
                      stroke={i === 0 ? chart.bull : chart.info}
                      strokeWidth={1}
                      opacity={0.35}
                    />
                    <Circle
                      cx={px}
                      cy={py}
                      r={dot}
                      fill={i === 0 ? chart.bull : chart.info}
                      stroke={chart.bg}
                      strokeWidth={1}
                    />
                    <SvgText
                      x={px + (labelRight ? dot + 4 : -(dot + 4))}
                      y={py + 3}
                      fill={chart.text}
                      fontSize={9}
                      fontWeight="bold"
                      textAnchor={labelRight ? "start" : "end"}
                    >
                      {node.label}
                    </SvgText>
                  </G>
                );
              })}
            </>
          );
        }}
      </PrismPanel>

      <View style={styles.modeRows}>
        {nodes.map((node, i) => (
          <Text key={`row-${node.label}-${i}`} style={styles.modeRow}>
            <Text style={{ color: i === 0 ? chart.bull : chart.info }}>{node.label}</Text>{" "}
            {humanize(node.position, "phase")} · {fmtPct(node.share, 0)} power
          </Text>
        ))}
      </View>
    </View>
  );
}

/**
 * The composite wave those modes make, from a year back to a year ahead.
 * Everything right of the "now" line is extrapolation of the same modes, drawn
 * dashed so it never reads as history.
 */
export function SpectralWave({
  modes,
  past = 250,
  forward = 250,
}: {
  modes: PrismSpectralMode[] | null | undefined;
  past?: number;
  forward?: number;
}) {
  const { points } = reconstructWave(modes, { past, forward, step: 5 });
  if (points.length < 2) {
    return <PrismChartEmpty note="Not enough spectral structure to project a wave." />;
  }
  const history = points.filter((p) => p.t <= 0);
  const future = points.filter((p) => p.t >= 0);

  return (
    <>
      <PrismPanel height={WAVE_H}>
        {(w, h) => {
          const x = linearScale([-past, forward], [8, w - 8]);
          const y = linearScale([-1.1, 1.1], [h - 16, 12]);
          const nowX = x(0);
          const toPoints = (pts: typeof points) =>
            pts.map((p) => `${x(p.t).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
          return (
            <>
              <Line x1={8} y1={y(0)} x2={w - 8} y2={y(0)} stroke={chart.zero} strokeWidth={1} />
              <Line
                x1={nowX}
                y1={8}
                x2={nowX}
                y2={h - 12}
                stroke={chart.gridStrong}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <SafePolyline
                points={toPoints(history)}
                fill="none"
                stroke={chart.bull}
                strokeWidth={1.8}
              />
              <SafePolyline
                points={toPoints(future)}
                fill="none"
                stroke={chart.info}
                strokeWidth={1.6}
                strokeDasharray="5 3"
              />
              <SvgText x={nowX + 4} y={h - 4} fill={chart.dim} fontSize={8.5}>
                NOW
              </SvgText>
              <SvgText x={8} y={h - 4} fill={chart.dim} fontSize={8.5}>
                {`−${Math.round(past / 21)}mo`}
              </SvgText>
              <SvgText x={w - 8} y={h - 4} fill={chart.dim} fontSize={8.5} textAnchor="end">
                {`+${Math.round(forward / 21)}mo`}
              </SvgText>
            </>
          );
        }}
      </PrismPanel>
      <PrismLegend
        items={[
          { color: chart.bull, label: "Fitted cycle" },
          { color: chart.info, label: "Extrapolation", dashed: true },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modeRows: { gap: 3 },
  modeRow: { color: chart.muted, fontSize: 11 },
});
