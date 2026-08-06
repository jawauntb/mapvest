/**
 * A pill button suitable for the ticker detail page. Tapping opens a modal
 * that lets the user pick a kind (Price above / Price below / % move),
 * enter a threshold, and add an optional note. On save it POSTs to
 * /v1/alerts and closes.
 *
 * Owned by the alerts feature — the detail screen imports and drops this in.
 */
import { alertKindLabel, createPriceAlert } from "@/api/alerts";
import type { AlertKind, PriceAlert } from "@/api/alerts";
import { useSession } from "@/auth/session";
import { PrimaryButton } from "@/components/PrimaryButton";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticSuccess } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const KIND_OPTIONS: readonly AlertKind[] = ["price_above", "price_below", "pct_move"];

export function SetAlertButton({
  ticker,
  compact,
  onCreated,
}: {
  ticker: string;
  compact?: boolean;
  onCreated?: (alert: PriceAlert) => void;
}) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AlertKind>("price_above");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: () => {
      const num = Number.parseFloat(threshold);
      if (!Number.isFinite(num)) {
        throw new Error("Enter a valid number");
      }
      if (!session?.token) throw new Error("Sign in to set alerts");
      return createPriceAlert(
        { ticker, kind, threshold: num, note: note.trim() || undefined },
        { token: session.token },
      );
    },
    onSuccess: (r) => {
      hapticSuccess();
      onCreated?.(r.alert);
      void qc.invalidateQueries({ queryKey: ["price-alerts", session?.token] });
      setOpen(false);
      setThreshold("");
      setNote("");
      setErr(null);
    },
    onError: (e) => setErr((e as Error).message),
  });

  const disabled = !session?.token;

  return (
    <>
      <Pressable
        onPress={() => {
          hapticSelect();
          setOpen(true);
        }}
        disabled={disabled}
        style={[styles.pill, compact && styles.pillCompact, disabled && { opacity: 0.5 }]}
        accessibilityRole="button"
        accessibilityLabel={`Set alert for ${ticker}`}
      >
        <Ionicons name="notifications-outline" size={14} color={colors.accent} />
        <Text style={styles.pillText}>{compact ? "Alert" : "Set alert"}</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%", alignItems: "center" }}
          >
            {/* Inner Pressable eats taps so the backdrop closes only on outside taps. */}
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Set alert · ${ticker}</Text>
                <Pressable
                  onPress={() => setOpen(false)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={20} color={colors.fgMuted} />
                </Pressable>
              </View>

              <Text style={styles.label}>Kind</Text>
              <View style={styles.kindRow}>
                {KIND_OPTIONS.map((k) => {
                  const active = kind === k;
                  return (
                    <Pressable
                      key={k}
                      onPress={() => {
                        hapticSelect();
                        setKind(k);
                      }}
                      style={[styles.kindChip, active && styles.kindChipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.kindChipText, active && styles.kindChipTextActive]}>
                        {alertKindLabel(k)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>
                {kind === "pct_move" ? "Threshold (%)" : "Threshold ($)"}
              </Text>
              <TextInput
                value={threshold}
                onChangeText={setThreshold}
                keyboardType="decimal-pad"
                placeholder={kind === "pct_move" ? "e.g. 5" : "e.g. 250.00"}
                placeholderTextColor={colors.fgDim}
                style={styles.input}
                accessibilityLabel="Threshold"
              />

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Why this level?"
                placeholderTextColor={colors.fgDim}
                style={styles.input}
                maxLength={240}
                accessibilityLabel="Note"
              />

              {err ? <Text style={styles.err}>{err}</Text> : null}

              <PrimaryButton
                label={createM.isPending ? "Saving…" : "Save alert"}
                busy={createM.isPending}
                onPress={() => createM.mutate()}
                style={{ marginTop: 12, alignSelf: "stretch" }}
              />
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  pillCompact: { paddingHorizontal: 10, paddingVertical: 6 },
  pillText: { color: colors.fg, fontSize: 13, fontWeight: "600" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 8,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sheetTitle: { color: colors.fg, ...type.h3 },
  label: { color: colors.fgMuted, ...type.label, marginTop: 8 },
  kindRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  kindChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  kindChipActive: { borderColor: colors.accent, backgroundColor: colors.accentMuted },
  kindChipText: { color: colors.fgMuted, fontSize: 13, fontWeight: "600" },
  kindChipTextActive: { color: colors.fg },
  input: {
    color: colors.fg,
    backgroundColor: colors.bgSunken,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 44,
  },
  err: { color: colors.danger, fontSize: 13, marginTop: 4 },
});
