import type { SituateExportFormat } from "@/api/situate";
import { colors, radii, space } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { BUILD_COST_NOTE, confirmBuild } from "./BuildProgress";
import { shareSituateExport } from "./export";

const FORMATS: ReadonlyArray<{
  format: SituateExportFormat;
  label: string;
  icon: "document-text-outline" | "document-outline" | "code-slash-outline";
}> = [
  { format: "txt", label: "Text", icon: "document-text-outline" },
  { format: "pdf", label: "PDF", icon: "document-outline" },
  { format: "json", label: "JSON", icon: "code-slash-outline" },
];

/**
 * Export and rebuild. The three exports are the engine's own renderings of the
 * same packet, downloaded and handed to the iOS share sheet — free. Rebuild
 * re-runs the whole engine and spends one generation, so its cost is in its
 * label and behind a confirm.
 */
export function SituateExportBar({
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
  const [busy, setBusy] = useState<SituateExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (format: SituateExportFormat) => {
    if (busy) return;
    hapticTap();
    setBusy(format);
    setError(null);
    shareSituateExport(ticker, format, token)
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
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    minWidth: 68,
  },
  btnRebuild: { borderColor: colors.accentMuted, marginLeft: "auto" },
  btnText: { color: colors.fg, fontSize: 12.5, fontWeight: "700" },
  costNote: { color: colors.fgMuted, fontSize: 11, lineHeight: 16 },
  error: { color: colors.danger, fontSize: 12 },
});
