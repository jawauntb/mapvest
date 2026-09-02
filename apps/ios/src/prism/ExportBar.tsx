import type { PrismExportFormat } from "@/api/prism";
import { colors, radii, space } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { BUILD_COST_NOTE, confirmBuild } from "./PrismProgress";
import { sharePrismExport } from "./export";

const FORMATS: ReadonlyArray<{
  format: PrismExportFormat;
  label: string;
  icon: "document-text-outline" | "document-outline" | "code-slash-outline";
}> = [
  { format: "txt", label: "Text", icon: "document-text-outline" },
  { format: "pdf", label: "PDF", icon: "document-outline" },
  { format: "json", label: "JSON", icon: "code-slash-outline" },
];

/**
 * Export and rebuild.
 *
 * The three exports are the engine's own renderings of the same packet — the
 * full text report, the PDF memo, and the raw JSON — downloaded and handed
 * straight to the iOS share sheet. They are free.
 *
 * Rebuild is not: it re-runs the whole engine and spends one generation against
 * the free tier. It sits in the same pill row as three free buttons, so the
 * cost is in its label, in its accessibility label, and behind a confirm — a
 * mis-tap must not be able to spend a user's last generation.
 */
export function PrismExportBar({
  ticker,
  token,
  onRebuild,
  rebuilding,
}: {
  ticker: string;
  token?: string;
  onRebuild?: () => void;
  rebuilding?: boolean;
}) {
  const [busy, setBusy] = useState<PrismExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (format: PrismExportFormat) => {
    if (busy) return;
    hapticTap();
    setBusy(format);
    setError(null);
    sharePrismExport(ticker, format, token)
      .catch(() => setError("Export failed. Try again."))
      .finally(() => setBusy(null));
  };

  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.groupLabel}>Export this packet</Text>
      <View style={styles.row}>
        {FORMATS.map((item) => (
          <Pressable
            key={item.format}
            onPress={() => run(item.format)}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={`Share the ${ticker} packet as ${item.label}`}
            accessibilityState={{ busy: busy === item.format }}
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
          >
            {busy === item.format ? (
              <ActivityIndicator color={colors.fg} />
            ) : (
              <>
                <Ionicons name={item.icon} size={15} color={colors.fg} />
                <Text style={styles.btnText}>{item.label}</Text>
              </>
            )}
          </Pressable>
        ))}
        {onRebuild ? (
          <Pressable
            onPress={() => {
              hapticTap();
              confirmBuild(ticker, "Rebuild", onRebuild);
            }}
            disabled={rebuilding}
            accessibilityRole="button"
            accessibilityLabel={`Rebuild the ${ticker} packet, uses one generation`}
            accessibilityHint={BUILD_COST_NOTE}
            accessibilityState={{ busy: !!rebuilding }}
            style={({ pressed }) => [styles.btn, styles.btnRebuild, pressed && { opacity: 0.7 }]}
          >
            {rebuilding ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <>
                <Ionicons name="refresh-outline" size={15} color={colors.accent} />
                <Text style={[styles.btnText, { color: colors.accent }]}>Rebuild · 1 gen</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
      {onRebuild ? <Text style={styles.costNote}>Exports are free. {BUILD_COST_NOTE}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  groupLabel: {
    color: colors.fgMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    // Sized so the three exports sit on one row at 375pt wide. Rebuild carries
    // its cost in its label and may wrap to a second line — which is the right
    // way round: the one button that spends money is the one set apart.
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    minWidth: 68,
  },
  // Rebuild spends a generation; the three exports are free. Jade marks it as
  // the one button here with a cost.
  btnRebuild: { borderColor: colors.accentMuted, marginLeft: "auto" },
  btnText: { color: colors.fg, fontSize: 12.5, fontWeight: "700" },
  costNote: { color: colors.fgMuted, fontSize: 11, lineHeight: 16 },
  error: { color: colors.danger, fontSize: 12 },
});
