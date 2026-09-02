import type { PrismRegimes } from "@/api/prism";
import { fmtDate, fmtPct, humanize } from "@/prism/format";
import { regimePosterior, regimeRuns } from "@/prism/signals";
import { space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { Line, Rect, Text as SvgText } from "../view-svg";
import { PrismChartEmpty, PrismLegend, PrismPanel } from "./PrismPanel";
import { chart, toneColor } from "./theme";

const RIBBON_H = 34;
const AXIS_H = 16;

/**
 * The regime ribbon: the HMM's monthly-sampled state history as one continuous
 * band, bull jade / neutral slate / bear red, with the current posterior split
 * underneath it.
 *
 * The history is sampled, not daily, so segment width is "share of sampled
 * months", not calendar time — the axis labels the real dates at both ends so
 * the reader can see the span they are looking at.
 */
export function RegimeRibbon({ regimes }: { regimes: PrismRegimes | null | undefined }) {
  const runs = regimeRuns(regimes);
  const posterior = regimePosterior(regimes);
  const total = runs.reduce((acc, r) => acc + r.points, 0);
  const current = regimes?.current ?? null;

  if (total === 0) {
    return <PrismChartEmpty note="No sampled regime history in this packet." />;
  }

  const first = runs[0];
  const last = runs[runs.length - 1];

  return (
    <View style={{ gap: space.sm }}>
      <PrismPanel height={RIBBON_H + AXIS_H + 10}>
        {(w) => {
          const pad = 6;
          const usable = Math.max(1, w - pad * 2);
          let cursor = 0;
          return (
            <>
              {runs.map((run) => {
                const x = pad + (cursor / total) * usable;
                const width = Math.max(1, (run.points / total) * usable);
                cursor += run.points;
                const color = toneColor(run.tone);
                return (
                  <Rect
                    key={`${run.startDate}-${run.label ?? "unknown"}`}
                    x={x}
                    y={8}
                    width={width}
                    height={RIBBON_H}
                    fill={color}
                    opacity={run.label === null ? 0.25 : 0.85}
                    rx={2}
                  />
                );
              })}
              <Line
                x1={pad}
                x2={w - pad}
                y1={8 + RIBBON_H + 4}
                y2={8 + RIBBON_H + 4}
                stroke={chart.grid}
                strokeWidth={1}
              />
              <SvgText x={pad} y={8 + RIBBON_H + 17} fill={chart.dim} fontSize={9}>
                {fmtDate(first?.startDate)}
              </SvgText>
              <SvgText
                x={w - pad}
                y={8 + RIBBON_H + 17}
                fill={chart.dim}
                fontSize={9}
                textAnchor="end"
              >
                {fmtDate(last?.endDate)}
              </SvgText>
            </>
          );
        }}
      </PrismPanel>

      <PrismLegend
        items={[
          { color: chart.bull, label: "Bull" },
          { color: chart.neutral, label: "Neutral" },
          { color: chart.bear, label: "Bear" },
        ]}
      />

      {posterior.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.caption}>
            Current posterior
            {typeof current?.days_in_regime === "number"
              ? ` · ${Math.round(current.days_in_regime)} days in ${humanize(current.label, "regime").toLowerCase()}`
              : ""}
          </Text>
          <PrismPanel height={22}>
            {(w) => {
              let cursor = 0;
              return (
                <>
                  {posterior.map((slice, i) => {
                    const x = cursor * w;
                    const width = Math.max(0, slice.p * w);
                    cursor += slice.p;
                    return (
                      <Rect
                        key={`${slice.label ?? "state"}-${i}`}
                        x={x}
                        y={0}
                        width={width}
                        height={22}
                        fill={toneColor(slice.tone)}
                        opacity={0.8}
                      />
                    );
                  })}
                </>
              );
            }}
          </PrismPanel>
          <View style={styles.posteriorRow}>
            {posterior.map((slice, i) => (
              <Text key={`${slice.label ?? "state"}-lbl-${i}`} style={styles.posteriorLabel}>
                <Text style={{ color: toneColor(slice.tone) }}>
                  {humanize(slice.label, `State ${i}`)}
                </Text>{" "}
                {fmtPct(slice.p, 0)}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { color: chart.dim, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.3 },
  posteriorRow: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  posteriorLabel: { color: chart.muted, fontSize: 11, fontWeight: "600" },
});
