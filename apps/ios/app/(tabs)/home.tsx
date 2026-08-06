import {
  type Quote,
  type WatchEntry,
  fetchQuotesMap,
  listWatchlist,
} from "@/api/client";
import { useSession } from "@/auth/session";
import { useSidebar } from "@/nav/SidebarContext";
import { colors } from "@/theme/tokens";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Default Home — watchlist + map/camera shortcuts + ticker search.
 * Settings / research / saved chats live in the sidebar menu.
 */
export default function HomeScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const { openSidebar } = useSidebar();
  const params = useLocalSearchParams<{ focus?: string }>();
  const searchRef = useRef<TextInput>(null);
  const [tickerQuery, setTickerQuery] = useState("");

  useEffect(() => {
    if (params.focus === "search") {
      setTimeout(() => searchRef.current?.focus(), 200);
    }
  }, [params.focus]);

  const wl = useQuery({
    queryKey: ["watchlist", session?.token],
    queryFn: () => listWatchlist({ token: session!.token }),
    enabled: !!session?.token,
    staleTime: 5_000,
  });

  useFocusEffect(
    useCallback(() => {
      if (session?.token) void qc.invalidateQueries({ queryKey: ["watchlist", session.token] });
    }, [qc, session?.token]),
  );

  const items = wl.data?.items ?? [];
  const tickers = items.map((i) => i.ticker).slice(0, 16);
  const quotesQ = useQuery({
    queryKey: ["home-quotes", tickers.join(",")],
    queryFn: () => fetchQuotesMap(tickers, { token: session?.token }),
    enabled: tickers.length > 0,
    staleTime: 60_000,
  });
  const quotes: Record<string, Quote> = quotesQ.data ?? {};

  function openTicker(raw: string) {
    const sym = raw.trim().toUpperCase().replace(/^\$/, "");
    if (!/^[A-Z][A-Z0-9.]{0,5}$/.test(sym)) return;
    setTickerQuery("");
    router.push(`/detail/${encodeURIComponent(sym)}`);
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={openSidebar}
          hitSlop={12}
          style={styles.burger}
          accessibilityLabel="Open menu"
        >
          <Text style={styles.burgerIcon}>☰</Text>
        </Pressable>
        <Text style={styles.title}>Mapvest</Text>
        <Pressable onPress={() => router.push("/(tabs)/settings")} hitSlop={12}>
          <Text style={styles.gear}>⚙</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          ref={searchRef}
          style={styles.search}
          placeholder="Find ticker — AAPL, SBUX…"
          placeholderTextColor="#666"
          autoCapitalize="characters"
          autoCorrect={false}
          value={tickerQuery}
          onChangeText={setTickerQuery}
          returnKeyType="search"
          onSubmitEditing={() => openTicker(tickerQuery)}
        />
        <Pressable
          style={[styles.goBtn, !tickerQuery.trim() && { opacity: 0.4 }]}
          disabled={!tickerQuery.trim()}
          onPress={() => openTicker(tickerQuery)}
        >
          <Text style={styles.goBtnText}>Go</Text>
        </Pressable>
      </View>

      <View style={styles.widgets}>
        <Pressable style={styles.widget} onPress={() => router.push("/(tabs)/map")}>
          <Text style={styles.widgetEmoji}>🗺</Text>
          <Text style={styles.widgetTitle}>Map</Text>
          <Text style={styles.widgetSub}>Nearby brands</Text>
        </Pressable>
        <Pressable style={styles.widget} onPress={() => router.push("/(tabs)/camera")}>
          <Text style={styles.widgetEmoji}>📷</Text>
          <Text style={styles.widgetTitle}>Camera</Text>
          <Text style={styles.widgetSub}>Snap a brand</Text>
        </Pressable>
        <Pressable style={styles.widget} onPress={() => router.push("/(tabs)/live-scan")}>
          <Text style={styles.widgetEmoji}>◎</Text>
          <Text style={styles.widgetTitle}>Live</Text>
          <Text style={styles.widgetSub}>Scan around</Text>
        </Pressable>
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Watchlist</Text>
        <Text style={styles.count}>
          {items.length} ticker{items.length === 1 ? "" : "s"}
        </Text>
      </View>

      {!session?.token ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Sign in to keep a watchlist</Text>
          <Text style={styles.emptySub}>
            Browse map and camera as a guest. Sign in to ★ Save tickers and research threads.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.push("/auth")}>
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </Pressable>
        </View>
      ) : wl.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Nothing saved yet</Text>
          <Text style={styles.emptySub}>
            Open a ticker from Map or search above, then tap ★ Save. It shows up here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(e) => e.ticker}
          contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16 }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <WatchRow
              entry={item}
              quote={quotes[item.ticker.toUpperCase()]}
              onPress={() =>
                router.push({ pathname: "/detail/[id]", params: { id: item.ticker } })
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function WatchRow({
  entry,
  quote,
  onPress,
}: {
  entry: WatchEntry;
  quote?: Quote;
  onPress: () => void;
}) {
  const up = (quote?.change ?? 0) >= 0;
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTicker}>${entry.ticker}</Text>
        <Text style={styles.rowName} numberOfLines={1}>
          {entry.name ?? entry.sector ?? "—"}
        </Text>
      </View>
      {quote ? (
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.rowPrice}>${quote.price.toFixed(2)}</Text>
          <Text style={{ color: up ? colors.accent : colors.danger, fontSize: 12, fontWeight: "700" }}>
            {up ? "+" : ""}
            {quote.changePct.toFixed(2)}%
          </Text>
        </View>
      ) : (
        <Text style={styles.rowName}>›</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  burger: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgElevated,
  },
  burgerIcon: { color: colors.fg, fontSize: 18, fontWeight: "700" },
  title: { color: colors.fg, fontSize: 20, fontWeight: "800" },
  gear: { color: colors.fgMuted, fontSize: 20, padding: 8 },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: colors.fg,
    fontSize: 15,
  },
  goBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  goBtnText: { color: colors.accentInk, fontWeight: "800" },
  widgets: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  widget: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
    gap: 2,
  },
  widgetEmoji: { fontSize: 18 },
  widgetTitle: { color: colors.fg, fontWeight: "700", fontSize: 14 },
  widgetSub: { color: colors.fgDim, fontSize: 11 },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: { color: colors.fg, fontSize: 18, fontWeight: "700" },
  count: { color: colors.fgDim, fontSize: 13 },
  center: { padding: 28, alignItems: "center", gap: 10 },
  emptyTitle: { color: colors.fg, fontSize: 17, fontWeight: "600" },
  emptySub: { color: colors.fgMuted, fontSize: 13, textAlign: "center", lineHeight: 19 },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryBtnText: { color: colors.accentInk, fontWeight: "800" },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  rowTicker: { color: colors.fg, fontWeight: "800", fontSize: 16 },
  rowName: { color: colors.fgMuted, fontSize: 12, marginTop: 2 },
  rowPrice: { color: colors.fg, fontWeight: "600", fontSize: 15 },
});
