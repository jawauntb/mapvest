import {
  type Quote,
  type WatchEntry,
  fetchQuotesMap,
  listWatchlist,
} from "@/api/client";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScalePressable } from "@/components/ScalePressable";
import { ScreenFade } from "@/components/ScreenFade";
import { SkeletonList } from "@/components/Skeleton";
import { useSession } from "@/auth/session";
import { useSidebar } from "@/nav/SidebarContext";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
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
          onPress={() => {
            hapticSelect();
            openSidebar();
          }}
          hitSlop={12}
          style={styles.burger}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <Ionicons name="menu-outline" size={20} color={colors.fg} />
        </Pressable>
        <Text style={styles.title}>Mapvest</Text>
        <Pressable
          onPress={() => router.push("/(tabs)/settings")}
          hitSlop={12}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={20} color={colors.fgMuted} />
        </Pressable>
      </View>

      <ScreenFade>
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(e) => e.ticker}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={!!session?.token && wl.isRefetching}
              onRefresh={() => wl.refetch()}
              tintColor={colors.fgMuted}
            />
          }
          ListHeaderComponent={
            <View>
              <View style={styles.searchRow}>
                <View style={styles.searchWrap}>
                  <Ionicons name="search-outline" size={17} color={colors.fgDim} style={{ marginLeft: 12 }} />
                  <TextInput
                    ref={searchRef}
                    style={styles.search}
                    placeholder="Find ticker — AAPL, SBUX…"
                    placeholderTextColor={colors.fgDim}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    value={tickerQuery}
                    onChangeText={setTickerQuery}
                    returnKeyType="search"
                    onSubmitEditing={() => openTicker(tickerQuery)}
                    accessibilityLabel="Find ticker"
                  />
                </View>
                <Pressable
                  style={[styles.goBtn, !tickerQuery.trim() && { opacity: 0.4 }]}
                  disabled={!tickerQuery.trim()}
                  onPress={() => openTicker(tickerQuery)}
                  accessibilityRole="button"
                  accessibilityLabel="Go to ticker"
                >
                  <Ionicons name="arrow-forward" size={18} color={colors.accentInk} />
                </Pressable>
              </View>

              {/* Hero card — camera identify is Mapvest's signature loop. */}
              <ScalePressable
                onPress={() => router.push("/(tabs)/camera")}
                accessibilityRole="button"
                accessibilityLabel="Open camera — identify what's investable"
                style={[styles.hero, elevation.md]}
              >
                <LinearGradient
                  colors={colors.gradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroGrad}
                >
                  <View style={styles.heroIcon}>
                    <Ionicons name="camera" size={22} color={colors.accentInk} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroTitle}>Snap a brand</Text>
                    <Text style={styles.heroSub}>Point your camera — see what's investable</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.accentInk} />
                </LinearGradient>
              </ScalePressable>

              <View style={styles.widgets}>
                <ScalePressable
                  style={[styles.widget, elevation.sm]}
                  onPress={() => router.push("/(tabs)/map")}
                  accessibilityRole="button"
                  accessibilityLabel="Open map — nearby brands"
                >
                  <View style={styles.widgetIcon}>
                    <Ionicons name="map-outline" size={18} color={colors.accent} />
                  </View>
                  <Text style={styles.widgetTitle}>Map</Text>
                  <Text style={styles.widgetSub}>Nearby brands</Text>
                </ScalePressable>
                <ScalePressable
                  style={[styles.widget, elevation.sm]}
                  onPress={() => router.push("/(tabs)/list")}
                  accessibilityRole="button"
                  accessibilityLabel="Open list — nearby sorted"
                >
                  <View style={styles.widgetIcon}>
                    <Ionicons name="list-outline" size={18} color={colors.accent} />
                  </View>
                  <Text style={styles.widgetTitle}>List</Text>
                  <Text style={styles.widgetSub}>Nearby sorted</Text>
                </ScalePressable>
              </View>

              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Watchlist</Text>
                <Text style={styles.count}>
                  {items.length} ticker{items.length === 1 ? "" : "s"}
                </Text>
              </View>

              {!session?.token ? (
                <EmptyState
                  icon="star-outline"
                  title="Sign in to keep a watchlist"
                  subtitle="Browse map and camera as a guest. Sign in to save tickers and research threads."
                >
                  <PrimaryButton
                    label="Sign in"
                    onPress={() => router.push("/auth")}
                    style={{ marginTop: 4, alignSelf: "stretch" }}
                  />
                </EmptyState>
              ) : wl.isLoading ? (
                <SkeletonList rows={4} />
              ) : items.length === 0 ? (
                <EmptyState
                  icon="bookmark-outline"
                  title="Nothing saved yet"
                  subtitle="Open a ticker from Map or search above, then tap Save. It shows up here."
                />
              ) : null}
            </View>
          }
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
      </ScreenFade>
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
    <ScalePressable
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${entry.ticker}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTicker}>${entry.ticker}</Text>
        <Text style={styles.rowName} numberOfLines={1}>
          {entry.name ?? entry.sector ?? "—"}
        </Text>
      </View>
      {quote ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.rowPrice}>${quote.price.toFixed(2)}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Ionicons
                name={up ? "caret-up" : "caret-down"}
                size={10}
                color={up ? colors.accent : colors.danger}
              />
              <Text style={{ color: up ? colors.accent : colors.danger, fontSize: 12, fontWeight: "700" }}>
                {quote.changePct.toFixed(2)}%
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.fgDim} />
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.fgDim} />
      )}
    </ScalePressable>
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
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.fg, ...type.h3, fontSize: 20 },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  searchWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
  },
  search: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 11,
    color: colors.fg,
    fontSize: 15,
    minHeight: 44,
  },
  goBtn: {
    width: 48,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: radii.xl,
    overflow: "hidden",
  },
  heroGrad: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { color: colors.accentInk, ...type.h3, fontSize: 17 },
  heroSub: { color: colors.accentInk, opacity: 0.85, fontSize: 12, marginTop: 2, fontWeight: "600" },
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
    borderRadius: radii.lg,
    padding: 14,
    gap: 3,
  },
  widgetIcon: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    backgroundColor: colors.bgSunken,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  widgetTitle: { color: colors.fg, ...type.body, fontWeight: "700", fontSize: 14 },
  widgetSub: { color: colors.fgDim, fontSize: 11 },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: { color: colors.fg, ...type.h3, fontSize: 18 },
  count: { color: colors.fgDim, fontSize: 13 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  rowTicker: { color: colors.fg, fontWeight: "800", fontSize: 16 },
  rowName: { color: colors.fgMuted, fontSize: 12, marginTop: 2 },
  rowPrice: { color: colors.fg, fontWeight: "600", fontSize: 15 },
});
