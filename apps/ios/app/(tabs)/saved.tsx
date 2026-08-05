import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { listWatchlist, type WatchEntry } from "@/api/client";
import { useSession } from "@/auth/session";

export default function SavedScreen() {
  const router = useRouter();
  const { session } = useSession();

  const q = useQuery({
    queryKey: ["watchlist", session?.token],
    queryFn: () => listWatchlist({ token: session!.token }),
    enabled: !!session?.token,
    staleTime: 5_000,
  });
  const items = q.data?.items ?? [];

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
      {q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Nothing saved yet.</Text>
          <Text style={styles.emptySub}>
            On any detail sheet, tap ★ Save to add a ticker here. Tap 📝 to
            generate an investment memo and save it too.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.ticker}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={q.isRefetching}
              onRefresh={() => q.refetch()}
              tintColor="#fff"
            />
          }
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
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
              <View style={styles.chevron}>
                <Text style={styles.chevronArrow}>›</Text>
              </View>
            </Pressable>
          )}
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
});
