/**
 * Full-screen "Price Alerts" route.
 *
 * Lists every alert the user owns (active first, then triggered, then
 * disabled), with a header "New alert" CTA that opens a modal to add one for
 * an arbitrary ticker. On focus we call GET /v1/alerts/check so any freshly
 * triggered alerts flip visible status without waiting for a manual refresh.
 *
 * Deleting an alert is a swipe-away pattern via a trailing trash pressable —
 * kept simple until we ship swipe-to-delete for the whole app.
 */
import {
  type AlertKind,
  type PriceAlert,
  alertKindLabel,
  alertSummary,
  checkPriceAlerts,
  createPriceAlert,
  deletePriceAlert,
  listPriceAlerts,
} from "@/api/alerts";
import { useSession } from "@/auth/session";
import { AppTopBar } from "@/components/AppTopBar";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenFade } from "@/components/ScreenFade";
import { SkeletonList } from "@/components/Skeleton";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect, hapticSuccess, hapticWarn } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const KIND_OPTIONS: readonly AlertKind[] = ["price_above", "price_below", "pct_move"];

export default function AlertsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const [creating, setCreating] = useState(false);

  const listQ = useQuery({
    queryKey: ["price-alerts", session?.token],
    queryFn: () => listPriceAlerts({ token: session!.token }),
    enabled: !!session?.token,
    staleTime: 10_000,
  });

  const checkM = useMutation({
    mutationFn: () => checkPriceAlerts({ token: session!.token }),
    onSuccess: (r) => {
      if (r.triggered.length > 0) {
        hapticWarn();
        void qc.invalidateQueries({ queryKey: ["price-alerts", session?.token] });
      }
    },
  });

  // Every focus: refetch list + poll /check so triggered flips show up.
  useFocusEffect(
    useCallback(() => {
      if (!session?.token) return;
      void qc.invalidateQueries({ queryKey: ["price-alerts", session.token] });
      checkM.mutate();
      // biome-ignore lint/correctness/useExhaustiveDependencies: checkM stable
    }, [qc, session?.token]),
  );

  const deleteM = useMutation({
    mutationFn: (id: string) => deletePriceAlert(id, { token: session!.token }),
    onSuccess: () => {
      hapticSelect();
      void qc.invalidateQueries({ queryKey: ["price-alerts", session?.token] });
    },
  });

  const all = listQ.data?.alerts ?? [];
  const { active, triggered } = useMemo(() => {
    const a: PriceAlert[] = [];
    const t: PriceAlert[] = [];
    for (const x of all) {
      if (x.triggeredAt) t.push(x);
      else if (!x.disabled) a.push(x);
    }
    return { active: a, triggered: t };
  }, [all]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ title: "Alerts" }} />
      <AppTopBar
        title="Alerts"
        right={
          <Pressable
            onPress={() => {
              hapticSelect();
              setCreating(true);
            }}
            style={styles.newBtn}
            disabled={!session?.token}
            accessibilityRole="button"
            accessibilityLabel="New alert"
          >
            <Ionicons name="add" size={16} color={colors.accentInk} />
            <Text style={styles.newBtnText}>New</Text>
          </Pressable>
        }
      />
      <Text style={[styles.subtitle, { paddingHorizontal: 20, marginBottom: 8 }]}>
        {active.length} active · {triggered.length} triggered
      </Text>

      <ScreenFade>
        {!session?.token ? (
          <EmptyState
            icon="lock-closed-outline"
            title="Sign in to set alerts"
            subtitle="Alerts follow your account across devices. Sign in to save one."
          >
            <PrimaryButton
              label="Sign in"
              onPress={() => router.push("/auth")}
              style={{ marginTop: 4, alignSelf: "stretch" }}
            />
          </EmptyState>
        ) : listQ.isLoading ? (
          <SkeletonList rows={6} />
        ) : all.length === 0 ? (
          <EmptyState
            icon="notifications-outline"
            title="No alerts yet"
            subtitle="Create a price or %-move alert to get pinged the next time you open Mapvest."
          />
        ) : (
          <FlatList
            style={{ flex: 1 }}
            data={all}
            keyExtractor={(a) => a.id}
            contentContainerStyle={{ paddingBottom: 32 }}
            refreshControl={
              <RefreshControl
                refreshing={listQ.isRefetching || checkM.isPending}
                onRefresh={() => {
                  void listQ.refetch();
                  checkM.mutate();
                }}
                tintColor={colors.fgMuted}
              />
            }
            ListHeaderComponent={
              triggered.length > 0 ? (
                <View style={styles.calloutRow}>
                  <Ionicons name="alert-circle" size={16} color={colors.warn} />
                  <Text style={styles.calloutText}>
                    {triggered.length} alert{triggered.length === 1 ? "" : "s"} triggered — review
                    below.
                  </Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <AlertRow
                alert={item}
                onOpen={() =>
                  router.push({ pathname: "/detail/[id]", params: { id: item.ticker } })
                }
                onDelete={() => deleteM.mutate(item.id)}
                busy={deleteM.isPending && deleteM.variables === item.id}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
          />
        )}
      </ScreenFade>

      <NewAlertModal
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          hapticSuccess();
          setCreating(false);
          void qc.invalidateQueries({ queryKey: ["price-alerts", session?.token] });
        }}
        token={session?.token}
      />
    </SafeAreaView>
  );
}

function AlertRow({
  alert,
  onOpen,
  onDelete,
  busy,
}: {
  alert: PriceAlert;
  onOpen: () => void;
  onDelete: () => void;
  busy?: boolean;
}) {
  const isTriggered = !!alert.triggeredAt;
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onOpen}
        style={{ flex: 1, gap: 4 }}
        accessibilityRole="button"
        accessibilityLabel={`Open ${alert.ticker}`}
      >
        <View style={styles.rowHead}>
          <Text style={styles.rowTicker}>${alert.ticker}</Text>
          <View
            style={[
              styles.badge,
              isTriggered ? styles.badgeTriggered : styles.badgeActive,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                { color: isTriggered ? colors.warn : colors.accent },
              ]}
            >
              {isTriggered ? "Triggered" : "Active"}
            </Text>
          </View>
        </View>
        <Text style={styles.rowKind}>{alertSummary(alert)}</Text>
        {alert.note ? (
          <Text style={styles.rowNote} numberOfLines={2}>
            {alert.note}
          </Text>
        ) : null}
        {isTriggered && alert.triggeredAt ? (
          <Text style={styles.rowMeta}>
            Triggered {new Date(alert.triggeredAt).toLocaleString()}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        onPress={onDelete}
        disabled={busy}
        hitSlop={12}
        style={[styles.deleteBtn, busy && { opacity: 0.4 }]}
        accessibilityRole="button"
        accessibilityLabel={`Delete alert for ${alert.ticker}`}
      >
        <Ionicons name="trash-outline" size={18} color={colors.fgMuted} />
      </Pressable>
    </View>
  );
}

function NewAlertModal({
  visible,
  onClose,
  onCreated,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (a: PriceAlert) => void;
  token?: string;
}) {
  const [ticker, setTicker] = useState("");
  const [kind, setKind] = useState<AlertKind>("price_above");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setTicker("");
    setThreshold("");
    setNote("");
    setKind("price_above");
    setErr(null);
  };

  const createM = useMutation({
    mutationFn: () => {
      if (!token) throw new Error("Sign in to set alerts");
      const sym = ticker.trim().toUpperCase();
      if (!sym) throw new Error("Ticker required");
      const num = Number.parseFloat(threshold);
      if (!Number.isFinite(num)) throw new Error("Enter a valid threshold");
      return createPriceAlert(
        { ticker: sym, kind, threshold: num, note: note.trim() || undefined },
        { token },
      );
    },
    onSuccess: (r) => {
      onCreated(r.alert);
      reset();
    },
    onError: (e) => setErr((e as Error).message),
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        onClose();
        reset();
      }}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          onClose();
          reset();
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ width: "100%", alignItems: "center" }}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>New alert</Text>
              <Pressable
                onPress={() => {
                  onClose();
                  reset();
                }}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={20} color={colors.fgMuted} />
              </Pressable>
            </View>

            <Text style={styles.label}>Ticker</Text>
            <TextInput
              value={ticker}
              onChangeText={(t) => setTicker(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="AAPL"
              placeholderTextColor={colors.fgDim}
              style={styles.input}
              maxLength={10}
              accessibilityLabel="Ticker symbol"
            />

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
              label={createM.isPending ? "Saving…" : "Create alert"}
              busy={createM.isPending}
              onPress={() => createM.mutate()}
              style={{ marginTop: 12, alignSelf: "stretch" }}
            />
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  title: { color: colors.fg, ...type.h1, fontSize: 28 },
  subtitle: { color: colors.fgDim, fontSize: 13, marginTop: 4 },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
  },
  newBtnText: { color: colors.accentInk, fontWeight: "800", fontSize: 13 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 20 },
  calloutRow: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  calloutText: { color: colors.fg, fontSize: 13, flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTicker: { color: colors.fg, fontSize: 17, fontWeight: "700" },
  rowKind: { color: colors.fgMuted, fontSize: 13 },
  rowNote: { color: colors.fgDim, fontSize: 12, marginTop: 2 },
  rowMeta: { color: colors.fgDim, fontSize: 11, marginTop: 2 },
  badge: {
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
  },
  badgeActive: { borderColor: colors.accentMuted, backgroundColor: "transparent" },
  badgeTriggered: { borderColor: colors.warn, backgroundColor: "transparent" },
  badgeText: { fontSize: 11, fontWeight: "700" },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
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
