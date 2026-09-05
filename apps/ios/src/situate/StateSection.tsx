import type { SituatePacket } from "@/api/situate";
import { StateGrid } from "@/chartkit/situate";
import { colors, space } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import { fmtPct, humanize } from "./format";
import { sectionUnavailable, stateCells } from "./signals";
import { Chip, SectionCard, StatTile } from "./ui";

/**
 * The current state (SPEC 5.2): the 2×2 vol×trend grid for SPY and the ticker,
 * the optional HMM second opinion as a chip, and the VIX / HY-OAS / curve
 * percentiles as macro context. This is what the odds are conditioned on — a
 * mostly *vol* state, which is why it sits above the odds, not beside a
 * direction call.
 */
export function StateSection({ packet }: { packet: SituatePacket }) {
  const state = packet.state;
  const unavailable = sectionUnavailable(packet, "state", state);
  const cells = stateCells(state);
  const ticker = cells.find((c) => c.who === "ticker") ?? cells[0];
  const spy = cells.find((c) => c.who === "spy");
  const hmm = state?.hmm ?? null;
  const context = state?.context ?? null;

  return (
    <SectionCard
      eyebrow="State"
      title="Where we are now"
      unavailable={unavailable}
      right={
        hmm?.label ? (
          <Chip
            label={`HMM: ${humanize(hmm.label)}${
              hmm.probs?.bull != null ? ` ${fmtPct(hmm.probs.bull, 0)}` : ""
            }`}
            tone={hmm.label === "bull" ? "bull" : hmm.label === "bear" ? "bear" : "neutral"}
          />
        ) : undefined
      }
    >
      {state ? (
        <>
          {ticker ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.gridLabel}>{packet.ticker} · vol × trend</Text>
              <StateGrid volState={ticker.volState} trendState={ticker.trendState} />
            </View>
          ) : null}
          {spy ? (
            <Text style={styles.spyLine}>
              SPY is {humanize(spy.cell ?? "unknown").toLowerCase()} (realized vol{" "}
              {fmtPct(spy.realizedVol, 0)}).
            </Text>
          ) : null}
          {context ? (
            <View style={styles.tiles}>
              <StatTile label="VIX pct" value={fmtPct(context.vix_pct, 0)} sub="of history" />
              <StatTile label="HY OAS pct" value={fmtPct(context.hy_oas_pct, 0)} sub="of history" />
              <StatTile
                label="10y–2y"
                value={
                  typeof context.curve_10y_2y === "number"
                    ? `${(context.curve_10y_2y * 100).toFixed(0)}bp`
                    : "—"
                }
                sub="curve"
              />
            </View>
          ) : null}
          <Text style={styles.note}>
            The state is primarily a volatility state — knowing it sizes the distribution's width,
            not its direction.
          </Text>
        </>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  gridLabel: { color: colors.fgMuted, fontSize: 11.5, fontWeight: "700", letterSpacing: 0.3 },
  spyLine: { color: colors.fgMuted, fontSize: 12.5, lineHeight: 18 },
  tiles: { flexDirection: "row", gap: space.sm },
  note: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 17 },
});
