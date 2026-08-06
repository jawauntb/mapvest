import {
  type Quote,
  type WatchEntry,
  type WatchlistSummary,
  fetchQuotesMap,
  fetchWatchlistBrief,
  listWatchlist,
  listWatchlists,
  removeFromWatchlist,
} from "@/api/client";
import { useSession } from "@/auth/session";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScalePressable } from "@/components/ScalePressable";
import { BacktestCard } from "@/components/BacktestCard";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { RichText } from "@/components/RichText";
import { LocalEconomyBriefCard } from "@/components/LocalEconomyBriefCard";
import { ScreenFade } from "@/components/ScreenFade";
import { ShareButton } from "@/components/ShareButton";
import { SkeletonList } from "@/components/Skeleton";
import { shareBriefText } from "@/util/share";
import { openChatAbout } from "@/nav/chatAbout";
import { useSidebar } from "@/nav/SidebarContext";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

type SortKey = "added" | "name" | "price" | "changePct";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "added", label: "Added" },
  { key: "name", label: "Name" },
  { key: "price", label: "Price" },
  { key: "changePct", label: "% Change" },
];

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
  const [sortKey, setSortKey] = useState<SortKey>("added");
  const [wlCollapsed, setWlCollapsed] = useState(false);
  // `null` = "All lists" (server default-list scoping).
  // Any list id = filter to that one list.
  const [selectedListId, setSelectedListId] = useState<string | null>(null);

  useEffect(() => {
    if (params.focus === "search") {
      setTimeout(() => searchRef.current?.focus(), 200);
    }
  }, [params.focus]);

  // Pull the user's lists so the chip selector can render.
  const listsQ = useQuery({
    queryKey: ["watchlists", session?.token],
    queryFn: () => listWatchlists({ token: session!.token }),
    enabled: !!session?.token,
    staleTime: 30_000,
  });
  const lists: WatchlistSummary[] = listsQ.data?.lists ?? [];

  // Home watchlist query — cache key includes selectedListId so switching
  // between lists doesn't cross-contaminate. When `selectedListId` is null
  // ("All") the server returns the default list (see spec).
  const wl = useQuery({
    queryKey: ["watchlist", session?.token, selectedListId ?? "default"],
    queryFn: () =>
      listWatchlist(
        { token: session!.token },
        selectedListId ? { listId: selectedListId } : {},
      ),
    enabled: !!session?.token,
    staleTime: 5_000,
  });

  useFocusEffect(
    useCallback(() => {
      if (session?.token) {
        void qc.invalidateQueries({ queryKey: ["watchlist", session.token] });
        void qc.invalidateQueries({ queryKey: ["watchlists", session.token] });
      }
    }, [qc, session?.token]),
  );

  const rawItems = wl.data?.items ?? [];
  const tickers = rawItems.map((i) => i.ticker).slice(0, 16);
  const quotesQ = useQuery({
    queryKey: ["home-quotes", tickers.join(",")],
    queryFn: () => fetchQuotesMap(tickers, { token: session?.token }),
    enabled: tickers.length > 0,
    staleTime: 60_000,
  });
  const quotes: Record<string, Quote> = quotesQ.data ?? {};

  // Sorted view of the watchlist. "Added" preserves server order; the other
  // sorts derive from name/price/percent-change joined against the quotes map.
  const items = useMemo(() => {
    if (sortKey === "added") return rawItems;
    const copy = [...rawItems];
    copy.sort((a, b) => {
      const qa = quotes[a.ticker.toUpperCase()];
      const qb = quotes[b.ticker.toUpperCase()];
      switch (sortKey) {
        case "name": {
          const na = (a.name ?? a.ticker).toLocaleLowerCase();
          const nb = (b.name ?? b.ticker).toLocaleLowerCase();
          return na.localeCompare(nb);
        }
        case "price":
          // Missing quotes sink to the bottom; otherwise high → low.
          return (qb?.price ?? -Infinity) - (qa?.price ?? -Infinity);
        case "changePct":
          return (qb?.changePct ?? -Infinity) - (qa?.changePct ?? -Infinity);
        default:
          return 0;
      }
    });
    return copy;
  }, [rawItems, quotes, sortKey]);

  // Optimistic-remove watchlist mutation. Swipe-to-delete calls this; on error
  // we invalidate to restore the row.
  const removeMut = useMutation({
    mutationFn: (ticker: string) => removeFromWatchlist(ticker, { token: session!.token }),
    onMutate: async (ticker) => {
      const key = ["watchlist", session?.token, selectedListId ?? "default"];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ items: WatchEntry[] }>(key);
      qc.setQueryData<{ items: WatchEntry[] }>(key, (prev) => ({
        items: (prev?.items ?? []).filter((e) => e.ticker !== ticker),
      }));
      return { previous };
    },
    onError: (_err, _ticker, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(
          ["watchlist", session?.token, selectedListId ?? "default"],
          ctx.previous,
        );
      }
      Alert.alert("Couldn't remove", "The ticker is still on your list. Try again.");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["watchlist", session?.token] });
      void qc.invalidateQueries({ queryKey: ["watchlists", session?.token] });
    },
  });

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
          data={wlCollapsed ? [] : items}
          keyExtractor={(e) => e.ticker}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
          // Lets a single tap on the search Go button (or watchlist row) fire
          // when the keyboard is up. Without this, iOS eats the first tap to
          // dismiss the keyboard and only the second tap actually presses.
          keyboardShouldPersistTaps="handled"
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
                  <Ionicons
                    name="search-outline"
                    size={17}
                    color={colors.fgDim}
                    style={{ marginLeft: 12 }}
                  />
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

              {session?.token && lists.length > 0 ? (
                <FlatList
                  data={[{ id: "__all__", name: "All", isDefault: false, tickerCount: 0 } as WatchlistSummary, ...lists]}
                  keyExtractor={(l) => l.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.listChipRow}
                  renderItem={({ item }) => {
                    const isAll = item.id === "__all__";
                    const active = isAll ? selectedListId === null : selectedListId === item.id;
                    return (
                      <Pressable
                        onPress={() => {
                          hapticSelect();
                          setSelectedListId(isAll ? null : item.id);
                        }}
                        onLongPress={
                          isAll
                            ? undefined
                            : () =>
                                router.push({
                                  pathname: "/watchlists/[id]",
                                  params: { id: item.id, name: item.name },
                                })
                        }
                        style={[styles.listChip, active && styles.listChipOn]}
                        accessibilityRole="button"
                        accessibilityLabel={
                          isAll ? "Show default watchlist" : `Filter to ${item.name}`
                        }
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.listChipText, active && styles.listChipTextOn]}>
                          {item.name}
                          {!isAll && item.tickerCount > 0 ? ` · ${item.tickerCount}` : ""}
                        </Text>
                      </Pressable>
                    );
                  }}
                  ListFooterComponent={
                    <Pressable
                      onPress={() => {
                        hapticSelect();
                        router.push("/watchlists");
                      }}
                      style={styles.listChipManage}
                      accessibilityRole="button"
                      accessibilityLabel="Manage watchlists"
                    >
                      <Ionicons name="options-outline" size={14} color={colors.fgMuted} />
                      <Text style={styles.listChipManageText}>Manage</Text>
                    </Pressable>
                  }
                />
              ) : null}

              <View style={styles.sectionHead}>
                <View style={styles.sectionHeadRow}>
                  <Text style={styles.sectionTitle}>Watchlist</Text>
                  {items.length > 0 ? (
                    <Pressable
                      onPress={() => {
                        hapticSelect();
                        setWlCollapsed((v) => !v);
                      }}
                      hitSlop={10}
                      style={styles.collapseBtn}
                      accessibilityRole="button"
                      accessibilityLabel={
                        wlCollapsed ? "Expand watchlist" : "Collapse watchlist"
                      }
                      accessibilityState={{ expanded: !wlCollapsed }}
                    >
                      <Ionicons
                        name={wlCollapsed ? "chevron-down" : "chevron-up"}
                        size={16}
                        color={colors.fgMuted}
                      />
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.count}>
                  {items.length} ticker{items.length === 1 ? "" : "s"}
                </Text>
              </View>

              {session?.token && items.length > 1 && !wlCollapsed ? (
                <View style={styles.sortRow}>
                  {SORTS.map((s) => {
                    const active = s.key === sortKey;
                    return (
                      <Pressable
                        key={s.key}
                        onPress={() => {
                          hapticSelect();
                          setSortKey(s.key);
                        }}
                        style={[styles.sortChip, active && styles.sortChipOn]}
                        accessibilityRole="button"
                        accessibilityLabel={`Sort by ${s.label}`}
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.sortChipText, active && styles.sortChipTextOn]}>
                          {s.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

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
              onPress={() => router.push({ pathname: "/detail/[id]", params: { id: item.ticker } })}
              onDelete={() => removeMut.mutate(item.ticker)}
            />
          )}
          ListFooterComponent={
            session?.token ? (
              <View style={{ marginTop: 20 }}>
                <DailyBriefCard
                  token={session.token}
                  tickers={rawItems.map((i) => i.ticker)}
                />
                <LocalEconomyBriefCard token={session.token} />
                <TopMoversCard items={rawItems} quotes={quotes} onOpen={(t) =>
                  router.push({ pathname: "/detail/[id]", params: { id: t } })
                } />
                <BacktestCard tickers={rawItems.map((i) => i.ticker)} token={session.token} />
              </View>
            ) : null
          }
        />
      </ScreenFade>
    </SafeAreaView>
  );
}

/**
 * FT-style daily brief on the user's watchlist. Server generates once per day
 * and caches — the API returns the same payload on every fetch until the
 * cache expires. Renders a serif headline + body so it reads like a column.
 */
function DailyBriefCard({ token, tickers }: { token: string; tickers: string[] }) {
  const router = useRouter();
  // Fingerprint the ticker set so the query key stays stable when the user
  // re-orders their watchlist but changes when they add/remove.
  const fp = useMemo(
    () => [...tickers].map((t) => t.toUpperCase()).sort().join(","),
    [tickers],
  );
  const briefQ = useQuery<{ headline: string; body: string; generatedAt: string }>({
    queryKey: ["watchlist-brief", fp],
    queryFn: () => fetchWatchlistBrief({ token }),
    enabled: tickers.length > 0,
    staleTime: 6 * 60 * 60 * 1000, // 6h client cache; server refreshes daily
    // Retry ~3x with backoff so a cold-start LLM call or transient 5xx doesn't
    // leave a permanent "no brief" state — we want a brief every render.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
  if (tickers.length === 0) return null;

  // Determine what to show. Never say "add tickers" here — we already know
  // the user has tickers. If the fetch is in-flight OR errored OR returned
  // an empty payload, keep the loading skeleton up so the user sees "we're
  // generating your brief" rather than a wrong empty state.
  const hasBrief = briefQ.data && briefQ.data.headline && briefQ.data.body;
  const isWaiting = !hasBrief && (briefQ.isFetching || briefQ.isPending || briefQ.isError);

  return (
    <View style={styles.briefCard}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={styles.briefEyebrow}>
          Mapvest Daily ·{" "}
          {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </Text>
        {hasBrief ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ChatAboutButton
              onPress={() =>
                openChatAbout(router, {
                  kind: "brief",
                  title: briefQ.data!.headline,
                  body: briefQ.data!.body,
                })
              }
              accessibilityLabel="Chat about this brief"
            />
            <ShareButton
              onPress={() =>
                void shareBriefText({
                  headline: briefQ.data!.headline,
                  body: briefQ.data!.body,
                })
              }
              accessibilityLabel="Share daily brief"
            />
          </View>
        ) : null}
      </View>
      {hasBrief ? (
        <>
          <Text style={styles.briefHeadline}>{briefQ.data!.headline}</Text>
          {/* RichText parses paragraphs + auto-links $TICKER mentions to
              the detail page. Was previously a plain Text which left every
              inline ticker un-clickable and every paragraph mashed together. */}
          <RichText text={briefQ.data!.body} />
          <Text style={styles.briefFooter}>
            Auto-generated · refreshed {new Date(briefQ.data!.generatedAt).toLocaleString()}
          </Text>
        </>
      ) : isWaiting ? (
        <>
          <View style={styles.briefSkeleton} />
          <Text style={styles.briefFooter}>
            Writing your daily brief…
            {briefQ.isError ? " (retrying)" : ""}
          </Text>
        </>
      ) : null}
    </View>
  );
}

/**
 * Derived widget — no API call. Top 3 gainers and top 3 losers within the
 * user's current watchlist, computed from the quotes map already fetched.
 * Memoized so it doesn't recompute on unrelated re-renders.
 */
function TopMoversCard({
  items,
  quotes,
  onOpen,
}: {
  items: WatchEntry[];
  quotes: Record<string, Quote>;
  onOpen: (ticker: string) => void;
}) {
  const { gainers, losers } = useMemo(() => {
    const withQuote = items
      .map((i) => ({ i, q: quotes[i.ticker.toUpperCase()] }))
      .filter((x) => x.q && typeof x.q.changePct === "number");
    const sorted = [...withQuote].sort((a, b) => (b.q!.changePct ?? 0) - (a.q!.changePct ?? 0));
    return { gainers: sorted.slice(0, 3), losers: sorted.slice(-3).reverse() };
  }, [items, quotes]);
  if (gainers.length === 0 && losers.length === 0) return null;
  return (
    <View style={styles.moversCard}>
      <Text style={styles.moversTitle}>Today's movers</Text>
      {gainers.map(({ i, q }) => (
        <Pressable
          key={`g-${i.ticker}`}
          onPress={() => onOpen(i.ticker)}
          style={styles.moverRow}
          accessibilityRole="button"
          accessibilityLabel={`Open ${i.ticker}, up ${q!.changePct.toFixed(2)} percent`}
        >
          <View style={styles.moverLeft}>
            <Text style={styles.moverTicker}>${i.ticker}</Text>
            <Text style={styles.moverName} numberOfLines={1}>
              {i.name ?? "—"}
            </Text>
          </View>
          <Text style={[styles.moverPct, { color: colors.accent }]}>
            +{q!.changePct.toFixed(2)}%
          </Text>
        </Pressable>
      ))}
      {losers.map(({ i, q }) =>
        (q!.changePct ?? 0) < 0 ? (
          <Pressable
            key={`l-${i.ticker}`}
            onPress={() => onOpen(i.ticker)}
            style={styles.moverRow}
            accessibilityRole="button"
            accessibilityLabel={`Open ${i.ticker}, down ${Math.abs(q!.changePct).toFixed(2)} percent`}
          >
            <View style={styles.moverLeft}>
              <Text style={styles.moverTicker}>${i.ticker}</Text>
              <Text style={styles.moverName} numberOfLines={1}>
                {i.name ?? "—"}
              </Text>
            </View>
            <Text style={[styles.moverPct, { color: colors.danger }]}>
              {q!.changePct.toFixed(2)}%
            </Text>
          </Pressable>
        ) : null,
      )}
    </View>
  );
}

function WatchRow({
  entry,
  quote,
  onPress,
  onDelete,
}: {
  entry: WatchEntry;
  quote?: Quote;
  onPress: () => void;
  onDelete: () => void;
}) {
  const up = (quote?.change ?? 0) >= 0;

  // Right-side action revealed on swipe-left. Confirming before delete because
  // a stray gesture shouldn't nuke a watched ticker.
  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        Alert.alert("Remove from watchlist?", `$${entry.ticker} will be removed.`, [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: onDelete },
        ]);
      }}
      style={styles.swipeDelete}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${entry.ticker}`}
    >
      <Ionicons name="trash-outline" size={20} color="#fff" />
      <Text style={styles.swipeDeleteText}>Delete</Text>
    </Pressable>
  );

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={1.6}
      rightThreshold={40}
    >
      <ScalePressable
        style={styles.row}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Open ${entry.ticker}. Swipe left to remove.`}
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
                <Text
                  style={{
                    color: up ? colors.accent : colors.danger,
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
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
    </Swipeable>
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
  heroSub: {
    color: colors.accentInk,
    opacity: 0.85,
    fontSize: 12,
    marginTop: 2,
    fontWeight: "600",
  },
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
  sortRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  sortChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  sortChipText: { color: colors.fgMuted, fontSize: 12, fontWeight: "600" },
  sortChipTextOn: { color: colors.accentInk },
  listChipRow: {
    paddingHorizontal: 16,
    gap: 6,
    paddingBottom: 10,
  },
  listChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  listChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  listChipText: { color: colors.fgMuted, fontSize: 12, fontWeight: "700" },
  listChipTextOn: { color: colors.accentInk },
  listChipManage: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  listChipManageText: { color: colors.fgMuted, fontSize: 11, fontWeight: "700" },
  swipeDelete: {
    backgroundColor: colors.danger,
    justifyContent: "center",
    alignItems: "center",
    width: 88,
    gap: 4,
  },
  swipeDeleteText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  sectionHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  collapseBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  briefCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 8,
  },
  briefEyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  briefHeadline: {
    color: colors.fg,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    fontFamily: "Georgia",
  },
  briefBody: {
    color: colors.fgMuted,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Georgia",
  },
  briefFooter: {
    color: colors.fgDim,
    fontSize: 11,
    marginTop: 4,
  },
  briefSkeleton: {
    height: 90,
    borderRadius: radii.md,
    backgroundColor: colors.bgSunken,
  },
  moversCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 10,
  },
  moversTitle: { color: colors.fg, fontSize: 14, fontWeight: "700" },
  moverRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  moverLeft: { flexDirection: "column" },
  moverTicker: { color: colors.fg, fontWeight: "700", fontSize: 14 },
  moverName: { color: colors.fgDim, fontSize: 11, marginTop: 1 },
  moverPct: { fontSize: 13, fontWeight: "700" },
});
