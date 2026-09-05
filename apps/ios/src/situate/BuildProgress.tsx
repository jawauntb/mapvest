import { colors, radii, space, type } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SITUATE_DIM } from "./constants";
import { type BuildStage, SITUATE_BUILD_STAGES, fmtElapsed } from "./progress";
import { Meter } from "./ui";

/** The exact words the build buttons use for what a build costs. */
export const BUILD_COST_NOTE = "Uses one of your generations and takes 1–3 minutes.";

/** Confirms a metered build, then runs it. Shared by ExportBar and the empty state. */
export function confirmBuild(ticker: string, title: string, onConfirm: () => void): void {
  Alert.alert(`${title} ${ticker}?`, BUILD_COST_NOTE, [
    { text: "Cancel", style: "cancel" },
    { text: title, onPress: onConfirm },
  ]);
}

/**
 * The 1–3 minute wait, made legible. The engine does not stream progress, so
 * this is elapsed-time copy over the real pipeline order — and it says so. The
 * line about polling matters: if the request drops, the packet is still being
 * built and this screen picks it up.
 */
export function SituateBuildProgress({
  stage,
  elapsedMs,
  ticker,
}: {
  stage: BuildStage;
  elapsedMs: number;
  ticker: string;
}) {
  const activeIndex = SITUATE_BUILD_STAGES.findIndex((s) => s.key === stage.key);
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <ActivityIndicator color={colors.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title}>Situating {ticker}</Text>
          <Text style={styles.detail}>{stage.detail}</Text>
        </View>
        <Text style={styles.clock}>{fmtElapsed(elapsedMs)}</Text>
      </View>

      <Meter value={stage.progress} tone="bull" height={6} />

      <View style={{ gap: 6 }}>
        {SITUATE_BUILD_STAGES.map((s, i) => {
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
        A cold build runs the whole engine — ten years of point-in-time bars, base rates, the
        options chain, filings, and the memo. We keep checking every five seconds, so the packet
        lands here even if the request drops.
      </Text>
    </View>
  );
}

/** No packet has ever been built for this ticker. One button, one explanation. */
export function SituateEmptyState({
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
      <Text style={styles.title}>No Situate packet for {ticker} yet</Text>
      <Text style={styles.detail}>
        Situate frames one stock: what you're exposed to, the odds per horizon (base rates beside
        the options-implied distribution), and what the business is saying — a posture, not a
        buy/sell call. {BUILD_COST_NOTE}
      </Text>
      {note ? <Text style={styles.error}>{note}</Text> : null}
      <Pressable
        onPress={() => {
          hapticTap();
          confirmBuild(ticker, "Build", onBuild);
        }}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Build the Situate packet for ${ticker}, uses one generation`}
        accessibilityHint={BUILD_COST_NOTE}
        accessibilityState={{ busy }}
        style={({ pressed }) => [styles.cta, (busy || pressed) && { opacity: 0.75 }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.accentInk} />
        ) : (
          <>
            <Ionicons name="locate-outline" size={16} color={colors.accentInk} />
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
  stageLabel: { color: SITUATE_DIM, fontSize: 12.5, flexShrink: 1 },
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
