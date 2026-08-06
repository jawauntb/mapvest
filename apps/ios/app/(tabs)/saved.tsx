import {
  type AlertItem,
  type CockpitRow,
  type Quote,
  type WatchEntry,
  fetchAlerts,
  fetchCockpit,
  fetchQuotesMap,
  listWatchlist,
} from "@/api/client";
import { useSession } from "@/auth/session";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScalePressable } from "@/components/ScalePressable";
import { ScreenFade } from "@/components/ScreenFade";
import { SkeletonList } from "@/components/Skeleton";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SavedScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const [cockpit, setCockpit] = useState<CockpitRow[] | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [panelErr, setPanelErr] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["watchlist", session?.token],
    queryFn: () => listWatchlist({ token: session!.token }),
    enabled: !!session?.token,
    staleTime: 5_000,
  });

  // Refetch every time Saved is focused — catches saves from detail/camera.
  useFocusEffect(
    useCallback(() => {
      if (!session?.token) return;
      void qc.invalidateQueries({ queryKey: ["watchlist", session.token] });
    }, [qc, session?.token]),
  );

  const items = q.data?.items ?? [];
  const tickers = items.map((i) => i.ticker).slice(0, 10);

  const quotesQ = useQuery({
    queryKey: ["watchlist-quotes", tickers.join(",")],
    queryFn: () => fetchQuotesMap(tickers, { token: session?.token }),
    enabled: tickers.length > 0,
    staleTime: 60_000,
  });
  const quotes: Record<string, Quote> = quotesQ.data ?? {};

  const cockpitM = useMutation({
    mutationFn: () => fetchCockpit(tickers, { token: session!.token }),
    onSuccess: (r) => {
      setCockpit(r.rows);
      setAlerts(null);
      setPanelErr(null);
    },
    onError: (e) => setPanelErr((e as Error).message),
  });

  const alertsM = useMutation({
    mutationFn: () => fetchAlerts(tickers, { token: session!.token }),
    onSuccess: (r) => {
      setAlerts(r.alerts);
      setCockpit(null);
      setPanelErr(null);
    },
    onError: (e) => setPanelErr((e as Error).message),
  });

  const onOpen = useCallback(
    (entry: WatchEntry) => {
      router.push({ pathname: "/detail/[id]", params: { id: entry.ticker } });
    },
    [router],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Saved</Text>
        <Text style={styles.count}>
          {items.length} ticker{items.length === 1 ? "" : "s"}
        </Text>
      </View>
      <ScreenFade>
        {!session?.token ? (
          <EmptyState
            icon="lock-closed-outline"
            title="Sign in to save tickers"
            subtitle="Your watchlist, memos, and Robinhood MCP key are tied to your account. Map, Camera, and Research all work without one."
          >
            <PrimaryButton
              label="Sign in"
              onPress={() => router.push("/auth")}
              style={{ marginTop: 4, alignSelf: "stretch" }}
            />
          </EmptyState>
        ) : q.isLoading ? (
          <SkeletonList rows={6} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="bookmark-outline"
            title="Nothing saved yet"
            subtitle="On any detail sheet, tap Save to add a ticker here. Generate an investment memo and save it too."
          />
        ) : (
          <FlatList
            style={{ flex: 1 }}
            data={items}
            keyExtractor={(e) => e.ticker}
            contentContainerStyle={{ paddingBottom: 24 }}
            ListHeaderComponent={
              <View style={styles.panel}>
                <View style={styles.actionRow}>
                  <Pressable
                    style={[styles.actionBtn, cockpitM.isPending && { opacity: 0.5 }]}
                    disabled={cockpitM.isPending || !session?.token}
                    onPress={() => {
                      hapticSelect();
                      cockpitM.mutate();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Cockpit view"
                  >
                    <Ionicons name="speedometer-outline" size={15} color={colors.fg} />
                    <Text style={styles.actionBtnText}>
                      {cockpitM.isPending ? "Cockpit…" : "Cockpit"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtn, alertsM.isPending && { opacity: 0.5 }]}
                    disabled={alertsM.isPending || !session?.token}
                    onPress={() => {
                      hapticSelect();
                      alertsM.mutate();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Alerts"
                  >
                    <Ionicons name="notifications-outline" size={15} color={colors.fg} />
                    <Text style={styles.actionBtnText}>
                      {alertsM.isPending ? "Alerts…" : "Alerts"}
                    </Text>
                  </Pressable>
                </View>
                <Text style={styles.hint}>up to 10 · Underlying Analyzer</Text>
                {panelErr ? <Text style={styles.err}>{panelErr}</Text> : null}
                {cockpit ? (
                  <View style={styles.card}>
                    <Text style={styles.panelTitle}>Cockpit</Text>
                    <ScrollView horizontal>
                      <View>
                        <View style={styles.tableRow}>
                          {["#", "Ticker", "Lane", "Score", "Ridge", "Flow"].map((h) => (
                            <Text key={h} style={[styles.cell, styles.cellHead]}>
                              {h}
                            </Text>
                          ))}
                        </View>
                        {cockpit.map((r, i) => (
                          <Pressable
                            key={`${r.ticker}-${i}`}
                            style={styles.tableRow}
                            onPress={() =>
                              router.push({
                                pathname: "/detail/[id]",
                                params: { id: r.ticker },
                              })
                            }
                          >
                            <Text style={styles.cell}>{r.rank ?? i + 1}</Text>
                            <Text style={[styles.cell, styles.cellTicker]}>${r.ticker}</Text>
                            <Text style={styles.cell}>{r.lane ?? "—"}</Text>
                            <Text style={styles.cell}>
                              {r.score != null ? Number(r.score).toFixed(2) : "—"}
                            </Text>
                            <Text style={styles.cell}>{r.ridge ?? "—"}</Text>
                            <Text style={styles.cell}>{r.flow ?? "—"}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                ) : null}
                {alerts ? (
                  <View style={styles.card}>
                    <Text style={styles.panelTitle}>Alerts</Text>
                    {alerts.length === 0 ? (
                      <Text style={styles.hint}>No alerts for this set.</Text>
                    ) : (
                      alerts.map((a, i) => (
                        <View key={i} style={styles.alertRow}>
                          <Text style={styles.alertTitle}>
                            {a.ticker ? `$${a.ticker}` : "—"}
                            {a.title ? ` · ${a.title}` : ""}
                          </Text>
                          <Text style={styles.hint}>{a.summary ?? a.message ?? ""}</Text>
                        </View>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            }
            refreshControl={
              <RefreshControl
                refreshing={q.isRefetching}
                onRefresh={() => q.refetch()}
                tintColor={colors.fgMuted}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => {
              const quote = quotes[item.ticker.toUpperCase()];
              const up = (quote?.change ?? 0) >= 0;
              return (
                <ScalePressable
                  style={styles.row}
                  onPress={() => onOpen(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.ticker}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTicker}>{item.ticker}</Text>
                    <Text style={styles.rowSub}>
                      {item.name ? `${item.name} · ` : ""}
                      {item.sector ?? "—"}
                    </Text>
                    {item.memo ? (
                      <View style={styles.memoBadge}>
                        <Ionicons name="document-text-outline" size={11} color={colors.accent} />
                        <Text style={styles.memoBadgeText} numberOfLines={1}>
                          {item.memoProvider ?? "memo"} · {item.memo.length} chars
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.priceCol}>
                    {quote ? (
                      <>
                        <Text style={styles.price}>${quote.price.toFixed(2)}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                          <Ionicons
                            name={up ? "caret-up" : "caret-down"}
                            size={10}
                            color={up ? colors.accent : colors.danger}
                          />
                          <Text style={{ color: up ? colors.accent : colors.danger, fontSize: 12 }}>
                            {quote.changePct.toFixed(2)}%
                          </Text>
                        </View>
                      </>
                    ) : (
                      <Ionicons name="chevron-forward" size={16} color={colors.fgDim} />
                    )}
                  </View>
                </ScalePressable>
              );
            }}
          />
        )}
      </ScreenFade>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  title: { color: colors.fg, ...type.h1, fontSize: 28 },
  count: { color: colors.fgDim, fontSize: 14 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  rowTicker: { color: colors.fg, fontSize: 18, fontWeight: "700" },
  rowSub: { color: colors.fgMuted, fontSize: 13, marginTop: 2 },
  memoBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  memoBadgeText: { color: colors.accent, fontSize: 12 },
  priceCol: { alignItems: "flex-end", minWidth: 72 },
  price: { color: colors.fg, fontSize: 16, fontWeight: "700" },
  panel: { paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 40,
  },
  actionBtnText: { color: colors.fg, fontSize: 14, fontWeight: "600" },
  hint: { color: colors.fgDim, fontSize: 12 },
  err: { color: colors.danger, fontSize: 13 },
  card: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 12,
    gap: 8,
  },
  panelTitle: { color: colors.fg, fontSize: 16, fontWeight: "700" },
  tableRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  cell: { color: colors.fgMuted, fontSize: 12, width: 64 },
  cellHead: { color: colors.fgDim, fontWeight: "600" },
  cellTicker: { color: colors.accent, fontWeight: "700", width: 72 },
  alertRow: {
    gap: 2,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: 8,
  },
  alertTitle: { color: colors.fg, fontSize: 13, fontWeight: "600" },
});
