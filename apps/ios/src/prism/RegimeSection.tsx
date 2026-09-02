import type { PrismPacket } from "@/api/prism";
import { RegimeRibbon } from "@/chartkit/prism";
import { colors, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtCount, fmtNumber, fmtPct, humanize, sectionUnavailable, toneForLabel } from "./format";
import { regimeStateVol } from "./signals";
import { KeyValueRow, SectionCard, StatTile, toneFg } from "./ui";

const REGIME_ORDER = ["bull", "neutral", "bear"] as const;

/**
 * The hidden-Markov regime view: which state the market is in, how confident
 * the model is that it has not already switched, and how this ticker has
 * actually behaved inside each state.
 *
 * The per-regime ticker stats are the point of the section — a bull-market
 * Sharpe means nothing without the bear-market one next to it.
 */
export function RegimeSection({ packet }: { packet: PrismPacket }) {
  const regimes = packet.regimes;
  const unavailable = sectionUnavailable(packet, "regimes", regimes);
  const current = regimes?.current ?? null;
  const byRegime = regimes?.ticker_by_regime ?? {};

  return (
    <SectionCard
      eyebrow="Regimes"
      title="Market state"
      subtitle={
        regimes
          ? `${fmtCount(regimes.n_states)}-state Gaussian HMM on ${regimes.trained_on ?? "SPY"} · features ${(regimes.features ?? []).join(", ") || "—"}`
          : undefined
      }
      unavailable={unavailable}
    >
      <View style={styles.tiles}>
        <StatTile
          label="Current"
          value={humanize(current?.label, "—")}
          tone={toneForLabel(current?.label)}
        />
        <StatTile label="Days in state" value={fmtCount(current?.days_in_regime)} />
        <StatTile label="Switch confidence" value={fmtPct(current?.switch_confidence, 0)} />
      </View>

      <RegimeRibbon regimes={regimes} />

      {(regimes?.states ?? []).length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>States</Text>
          {(regimes?.states ?? []).map((state, i) => {
            // `state.volatility` is the raw HMM feature (~1e-5) and would print
            // as "0.0%" — `regimeStateVol` returns the annualized figure or
            // nothing at all. See `PrismRegimeState`.
            const vol = regimeStateVol(state);
            return (
              <KeyValueRow
                key={`${state?.label ?? "state"}-${i}`}
                label={`${humanize(state?.label, `State ${i}`)} · ${fmtPct(state?.occupancy, 0)} of days`}
                value={`${fmtPct(state?.mean_daily_return, 2)}/day · vol ${vol === null ? "n/a" : fmtPct(vol, 1)} · ${fmtCount(state?.avg_duration_days)}d avg`}
                tone={toneForLabel(state?.label)}
              />
            );
          })}
          <Text style={styles.blockNote}>
            Volatility is annualized, measured on the days the model assigns to each state.
          </Text>
        </View>
      ) : null}

      {Object.keys(byRegime).length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>{packet.ticker} inside each state</Text>
          <View style={styles.headRow}>
            <Text style={[styles.cell, styles.head, styles.first]}>State</Text>
            <Text style={[styles.cell, styles.head]}>Daily</Text>
            <Text style={[styles.cell, styles.head]}>Sharpe</Text>
            <Text style={[styles.cell, styles.head]}>Hit</Text>
            <Text style={[styles.cell, styles.head]}>n</Text>
          </View>
          {REGIME_ORDER.filter((key) => byRegime[key]).map((key) => {
            const stats = byRegime[key];
            return (
              <View key={key} style={styles.row}>
                <Text style={[styles.cell, styles.first, { color: toneFg(toneForLabel(key)) }]}>
                  {humanize(key)}
                </Text>
                <Text style={styles.cell}>{fmtPct(stats?.mean_daily, 2)}</Text>
                <Text style={styles.cell}>{fmtNumber(stats?.sharpe, 2)}</Text>
                <Text style={styles.cell}>{fmtPct(stats?.hit_rate, 0)}</Text>
                <Text style={[styles.cell, styles.dim]}>{fmtCount(stats?.n)}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: space.sm },
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
  blockNote: { color: colors.fgMuted, fontSize: 10.5, lineHeight: 15, marginTop: 4 },
  headRow: { flexDirection: "row", paddingBottom: 4 },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cell: { flex: 1, textAlign: "right", fontSize: 12, color: colors.fg, fontWeight: "600" },
  first: { flex: 1.3, textAlign: "left", fontWeight: "700" },
  head: { color: colors.fgMuted, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.5 },
  dim: { color: colors.fgMuted, fontWeight: "400" },
});
