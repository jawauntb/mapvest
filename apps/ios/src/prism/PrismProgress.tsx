import { colors, radii, space, type } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { PRISM_DIM } from "./constants";
import { type BuildStage, PRISM_BUILD_STAGES, fmtElapsed } from "./progress";
import { Meter } from "./ui";

/**
 * The exact words the two build buttons use for what a build costs.
 *
 * `POST /v1/prism` is metered as one generation against the free tier. A
 * button that spends one has to say so before it is pressed, not after the
 * paywall pops — especially here, where Rebuild sits in a row with three free
 * export buttons in the same pill style.
 */
export const BUILD_COST_NOTE = "Uses one of your generations and takes 1–3 minutes.";

/** Confirms a metered build, then runs it. Shared by ExportBar and the empty state. */
export function confirmBuild(ticker: string, title: string, onConfirm: () => void): void {
  Alert.alert(`${title} ${ticker}?`, BUILD_COST_NOTE, [
    { text: "Cancel", style: "cancel" },
    { text: title, onPress: onConfirm },
  ]);
}

/**
 * The 1–3 minute wait, made legible.
 *
 * The engine does not stream progress, so this is elapsed-time copy over the
 * real pipeline order — and it says so. The line about polling matters: if the
 * request drops, the packet is still being built and this screen will pick it
 * up, so leaving the screen open is the right move.
 */
export function PrismBuildProgress({
  stage,
  elapsedMs,
  ticker,
}: {
  stage: BuildStage;
  elapsedMs: number;
  ticker: string;
}) {
  const activeIndex = PRISM_BUILD_STAGES.findIndex((s) => s.key === stage.key);
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <ActivityIndicator color={colors.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>Building {ticker}</Text>
          <Text style={styles.detail}>{stage.detail}</Text>
        </View>
        <Text style={styles.clock}>{fmtElapsed(elapsedMs)}</Text>
      </View>

      <Meter value={stage.progress} tone="bull" height={6} />

      <View style={{ gap: 6 }}>
        {PRISM_BUILD_STAGES.map((s, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <View key={s.key} style={styles.stageRow}>
              <Ionicons
                name={done ? "checkmark-circle" : active ? "ellipse" : "ellipse-outline"}
                size={13}
                color={done ? colors.accent : active ? colors.accent2 : colors.fgDim}
              />
              <Text
                style={[
                  styles.stageLabel,
                  done && { color: colors.fgMuted },
                  active && { color: colors.fg, fontWeight: "700" },
                ]}
                numberOfLines={1}
              >
                {s.label}
              </Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.note}>
        A cold build runs the whole engine — ten years of bars, a regime fit, filings, and the memo.
        We keep checking every five seconds, so the packet lands here even if the request drops.
      </Text>
    </View>
  );
}

/** No packet has ever been built for this ticker. One button, one explanation. */
export function PrismEmptyState({
  ticker,
  onBuild,
  busy,
  note,
}: {
  ticker: string;
  onBuild: () => void;
  busy: boolean;
  note?: string | null;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>No Prism packet for {ticker} yet</Text>
      <Text style={styles.detail}>
        Prism splits this ticker into macro, factor, regime, spectral, entropy, fundamental, and
        filing components, then recombines them into bull / neutral / bear scenarios with a memo you
        can question. {BUILD_COST_NOTE}
      </Text>
      {note ? <Text style={styles.error}>{note}</Text> : null}
      <Pressable
        onPress={() => {
          hapticTap();
          confirmBuild(ticker, "Build", onBuild);
        }}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Build the Prism packet for ${ticker}, uses one generation`}
        accessibilityHint={BUILD_COST_NOTE}
        accessibilityState={{ busy }}
        style={({ pressed }) => [styles.cta, (busy || pressed) && { opacity: 0.75 }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.accentInk} />
        ) : (
          <>
            <Ionicons name="prism-outline" size={16} color={colors.accentInk} />
            <Text style={styles.ctaText}>Build packet · 1 generation</Text>
          </>
        )}
      </Pressable>
      <Text style={styles.disclaimer}>Research only. Not investment advice.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.lg,
    gap: space.md,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  title: { color: colors.fg, ...type.h3 },
  detail: { color: colors.fgMuted, fontSize: 13, lineHeight: 19 },
  clock: { color: colors.fgMuted, fontSize: 13, fontWeight: "700" },
  stageRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  // Not `colors.fgDim`: at 3.89:1 on the elevated ground it fails AA, and this
  // is the list a reader stares at for one to three minutes. PRISM_DIM is
  // 4.91:1 and still reads quieter than the reached and active rows.
  stageLabel: { color: PRISM_DIM, fontSize: 12.5, flexShrink: 1 },
  note: { color: colors.fgMuted, fontSize: 11.5, lineHeight: 17 },
  error: { color: colors.danger, fontSize: 12.5, lineHeight: 18 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingVertical: 12,
  },
  ctaText: { color: colors.accentInk, fontSize: 14, fontWeight: "800" },
  disclaimer: { color: colors.fgMuted, fontSize: 10.5, textAlign: "center" },
});
