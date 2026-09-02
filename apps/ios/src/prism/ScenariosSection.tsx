import { PRISM_HORIZONS, type PrismHorizonKey, type PrismPacket } from "@/api/prism";
import { ScenarioDensityChart } from "@/chartkit/prism";
import { colors, fonts, radii, space, type } from "@/theme/tokens";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PRISM_DIM } from "./constants";
import { fmtPct, fmtSignedPct, humanize, sectionUnavailable, toneForLabel } from "./format";
import {
  caseProbabilities,
  densityCurve,
  normalizeWeights,
  shrinkageRows,
  weightEvidence,
} from "./scenario";
import { Chip, KeyValueRow, Meter, SectionCard, SegmentedChips, toneFg } from "./ui";

const CASE_TONE = { bull: "bull", neutral: "neutral", bear: "bear" } as const;

/**
 * The scenario split: three narratives, their probabilities, the mixture
 * density at a chosen horizon, and the component weights that produced them.
 *
 * The weights are shown because they are the argument: a reader can see whether
 * this call rests on seasonality or on the regime model.
 *
 * What those weights *mean* is not fixed, and the card must not pretend it is.
 * The engine ranks components by walk-forward out-of-sample skill — but when no
 * component beats a naive constant forecast it says so in `weight_evidence` and
 * falls back to a shrunk prior, and it separately lists the components it never
 * scored at all. On the live NVDA packet that is 60% of the weight. So the
 * subtitle is read off `weight_evidence`, and any component whose weight was
 * never measured is labelled as a prior next to its own bar.
 */
export function ScenariosSection({ packet }: { packet: PrismPacket }) {
  const scenarios = packet.scenarios;
  const unavailable = sectionUnavailable(packet, "scenarios", scenarios);
  const probs = caseProbabilities(scenarios);
  // `caseProbabilities` renormalises the triple and floors a missing case at 0.
  // If nothing survived, every case reads 0% — which would be a null rendered
  // as a zero. Say the split is unknown instead, and keep the narratives.
  const knownProbabilities = probs.some((row) => row.probability > 0);
  const weights = normalizeWeights(scenarios?.weights);
  const evidence = weightEvidence(scenarios);
  const priorOnly = new Set(evidence?.priorOnly ?? []);

  const available = useMemo(
    () => PRISM_HORIZONS.filter((h) => densityCurve(scenarios, h, 8) !== null),
    [scenarios],
  );
  const [horizon, setHorizon] = useState<PrismHorizonKey>(available[0] ?? "3m");
  const active = available.includes(horizon) ? horizon : (available[0] ?? horizon);
  const density = useMemo(() => densityCurve(scenarios, active), [scenarios, active]);
  // Empty on any packet built before the recalibration, which is how this
  // block knows to stay off the screen entirely.
  const shrinkage = useMemo(() => shrinkageRows(scenarios, active), [scenarios, active]);
  const anyClamped = shrinkage.some((row) => row.clamped);
  const timing = scenarios?.timing ?? null;
  const watch = scenarios?.watch_signals ?? [];

  return (
    <SectionCard
      eyebrow="Scenarios"
      title="Bull, neutral, bear"
      subtitle={weightsSubtitle(scenarios?.method, evidence)}
      unavailable={unavailable}
    >
      {timing?.this_month ? (
        <View style={styles.timingRow}>
          <Chip
            label={`This month: ${humanize(timing.this_month)}`}
            tone={toneForLabel(timing.this_month)}
          />
          {timing.reason ? <Text style={styles.timingReason}>{timing.reason}</Text> : null}
        </View>
      ) : null}

      {!unavailable && !knownProbabilities ? (
        <Text style={styles.note}>
          The engine produced no probability for any case at this horizon — no component forecast
          survived its walk-forward test, so the split below is unweighted.
        </Text>
      ) : null}

      <View style={{ gap: space.md }}>
        {probs.map((row) => {
          const narrative = row.narrative;
          return (
            <View key={row.key} style={styles.caseBlock}>
              <View style={styles.caseHead}>
                <Text style={[styles.caseName, { color: toneFg(CASE_TONE[row.key]) }]}>
                  {row.key.toUpperCase()}
                </Text>
                <Text style={styles.caseProb}>
                  {knownProbabilities ? fmtPct(row.probability, 0) : "—"}
                </Text>
              </View>
              {knownProbabilities ? (
                <Meter value={row.probability} tone={CASE_TONE[row.key]} height={6} />
              ) : null}
              <Text style={styles.narrative}>{narrative ?? "No narrative for this case."}</Text>
            </View>
          );
        })}
      </View>

      {available.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <View style={styles.densityHead}>
            <Text style={styles.blockTitle}>Return distribution</Text>
            <SegmentedChips
              options={available}
              value={active}
              onChange={setHorizon}
              labelOf={(h) => h.toUpperCase()}
            />
          </View>
          <ScenarioDensityChart density={density} horizonLabel={active.toUpperCase()} />
        </View>
      ) : null}

      {shrinkage.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.blockTitle}>Shrunk toward the market prior</Text>
          <Text style={styles.shrinkIntro}>
            No component's own forecast enters the mixture whole: each is pulled toward a market
            prior first. Raw is what the component said at {active.toUpperCase()}, shrunk is what
            the mixture used.
          </Text>
          {shrinkage.map((row) => (
            <KeyValueRow
              key={row.key}
              label={`${humanize(row.key)}${
                row.weight === null ? "" : ` · ${fmtPct(row.weight, 0)} prior`
              }`}
              value={`${fmtSignedPct(row.raw)} → ${fmtSignedPct(row.shrunk)}${
                row.clamped ? " †" : ""
              }`}
              tone="neutral"
            />
          ))}
          {anyClamped ? (
            <Text style={styles.weightFootnote}>
              † The shrunk figure sits on the engine's own bound for that component — it was capped,
              not chosen.
            </Text>
          ) : null}
        </View>
      ) : null}

      {weights.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.blockTitle}>Component weights</Text>
          {weights.map((row) => {
            const assumed = priorOnly.has(row.key);
            return (
              <View key={row.key} style={styles.weightRow}>
                <Text style={styles.weightLabel} numberOfLines={1}>
                  {humanize(row.key)}
                  {assumed ? <Text style={styles.weightPrior}> · prior</Text> : null}
                </Text>
                <View style={styles.weightMeter}>
                  <Meter value={row.share} tone="neutral" height={5} />
                </View>
                <Text style={styles.weightValue}>{fmtPct(row.share, 0)}</Text>
              </View>
            );
          })}
          {priorOnly.size > 0 ? (
            <Text style={styles.weightFootnote}>
              “Prior” marks a component the engine never scored — its weight is assumed, not
              measured.
              {evidence?.unscoredPriorMass === null || evidence?.unscoredPriorMass === undefined
                ? ""
                : ` ${fmtPct(evidence.unscoredPriorMass, 0)} of the weight is unmeasured.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {watch.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.blockTitle}>Watch signals</Text>
          {watch.map((signal, i) => (
            <KeyValueRow
              key={`${signal?.symbol ?? "signal"}-${i}`}
              label={`${signal?.symbol ?? "—"} ${signal?.condition ?? ""}`.trim()}
              value={signal?.implication ?? "—"}
            />
          ))}
        </View>
      ) : null}
    </SectionCard>
  );
}

/**
 * What the card is allowed to claim about its own weights. Never asserts
 * measured skill when the engine reported a fallback.
 */
function weightsSubtitle(
  method: string | null | undefined,
  evidence: ReturnType<typeof weightEvidence>,
): string {
  const head = method ? `Method: ${humanize(method)}.` : "Mixture of the component forecasts.";
  if (evidence?.fallback) {
    return `${head} ${
      evidence.reason
        ? `${evidence.reason.charAt(0).toUpperCase()}${evidence.reason.slice(1)}`
        : "No component beat a naive constant forecast out of sample"
    }; weights fall back to a shrunk prior.`;
  }
  if (evidence) return `${head} Weights are out-of-sample explanatory power.`;
  return head;
}

const styles = StyleSheet.create({
  note: { color: colors.fgMuted, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  timingRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  timingReason: { color: colors.fgMuted, fontSize: 12, flexShrink: 1, lineHeight: 17 },
  caseBlock: {
    gap: 6,
    backgroundColor: colors.bgSunken,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.md,
  },
  caseHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  caseName: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  caseProb: { color: colors.fg, fontSize: 13, fontWeight: "700" },
  narrative: { color: colors.fgMuted, fontFamily: fonts.serif, fontSize: 13.5, lineHeight: 20 },
  densityHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
    flexWrap: "wrap",
  },
  blockTitle: { color: colors.fgMuted, ...type.label },
  shrinkIntro: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 16.5 },
  weightRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  weightLabel: { color: colors.fgMuted, fontSize: 12, width: 118 },
  weightPrior: { color: PRISM_DIM, fontSize: 10.5, fontStyle: "italic" },
  weightFootnote: { color: colors.fgMuted, fontSize: 10.5, lineHeight: 15, marginTop: 2 },
  weightMeter: { flex: 1 },
  weightValue: {
    color: colors.fg,
    fontSize: 11.5,
    fontWeight: "700",
    width: 34,
    textAlign: "right",
  },
});
