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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
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
      {!session?.token ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Sign in to save tickers.</Text>
          <Text style={styles.emptySub}>
            Your watchlist, memos, and Robinhood MCP key are tied to your account. Map, Camera,
            Live, and Research all work without one.
          </Text>
          <Pressable style={styles.signInBtn} onPress={() => router.push("/auth")}>
            <Text style={styles.signInBtnText}>Sign in</Text>
          </Pressable>
        </View>
      ) : q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Nothing saved yet.</Text>
          <Text style={styles.emptySub}>
            On any detail sheet, tap ★ Save to add a ticker here. Tap 📝 to generate an investment
            memo and save it too.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.ticker}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={
            <View style={styles.panel}>
              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.actionBtn, cockpitM.isPending && { opacity: 0.5 }]}
                  disabled={cockpitM.isPending || !session?.token}
                  onPress={() => cockpitM.mutate()}
                >
                  <Text style={styles.actionBtnText}>
                    {cockpitM.isPending ? "Cockpit…" : "Cockpit"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, alertsM.isPending && { opacity: 0.5 }]}
                  disabled={alertsM.isPending || !session?.token}
                  onPress={() => alertsM.mutate()}
                >
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
              tintColor="#fff"
            />
          }
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => {
            const quote = quotes[item.ticker.toUpperCase()];
            return (
              <Pressable style={styles.row} onPress={() => onOpen(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTicker}>{item.ticker}</Text>
                  <Text style={styles.rowSub}>
                    {item.name ? `${item.name} · ` : ""}
                    {item.sector ?? "—"}
                  </Text>
                  {item.memo ? (
                    <Text style={styles.memoBadge} numberOfLines={1}>
                      📝 {item.memoProvider ?? "memo"} · {item.memo.length} chars
                    </Text>
                  ) : null}
                </View>
                <View style={styles.priceCol}>
                  {quote ? (
                    <>
                      <Text style={styles.price}>${quote.price.toFixed(2)}</Text>
                      <Text
                        style={{
                          color: quote.change >= 0 ? "#3ee68a" : "#ff6b6b",
                          fontSize: 12,
                        }}
                      >
                        {quote.change >= 0 ? "+" : ""}
                        {quote.changePct.toFixed(2)}%
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.chevronArrow}>›</Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  title: { color: "#fff", fontSize: 28, fontWeight: "700" },
  count: { color: "#888", fontSize: 14 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: { color: "#fff", fontSize: 18, fontWeight: "600", marginBottom: 8 },
  emptySub: { color: "#888", fontSize: 14, textAlign: "center", lineHeight: 20 },
  signInBtn: {
    marginTop: 16,
    backgroundColor: "#c8f5c8",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  signInBtnText: { color: "#000", fontWeight: "700" },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: "#222", marginLeft: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  rowTicker: { color: "#fff", fontSize: 18, fontWeight: "700" },
  rowSub: { color: "#aaa", fontSize: 13, marginTop: 2 },
  memoBadge: {
    color: "#3ee68a",
    fontSize: 12,
    marginTop: 6,
  },
  chevron: { width: 20, alignItems: "flex-end" },
  chevronArrow: { color: "#666", fontSize: 22, lineHeight: 22 },
  priceCol: { alignItems: "flex-end", minWidth: 72 },
  price: { color: "#fff", fontSize: 16, fontWeight: "700" },
  panel: { paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: {
    backgroundColor: "#141414",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  actionBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  hint: { color: "#888", fontSize: 12 },
  err: { color: "#ff6b6b", fontSize: 13 },
  card: {
    backgroundColor: "#0e0e0e",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  panelTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  tableRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  cell: { color: "#ccc", fontSize: 12, width: 64 },
  cellHead: { color: "#888", fontWeight: "600" },
  cellTicker: { color: "#3ee68a", fontWeight: "700", width: 72 },
  alertRow: {
    gap: 2,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#3ee68a",
    paddingLeft: 8,
  },
  alertTitle: { color: "#fff", fontSize: 13, fontWeight: "600" },
});
