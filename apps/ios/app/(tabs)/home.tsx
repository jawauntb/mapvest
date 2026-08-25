import {
  type Quote,
  type WatchEntry,
  type WatchlistSummary,
  fetchProgress,
  fetchQuote,
  fetchQuotesMap,
  fetchUniverseSummary,
  fetchWatchlistBrief,
  listWatchlist,
  listWatchlists,
  removeFromWatchlist,
} from "@/api/client";
import { listFinds, resolveStreakDays } from "@/api/finds";
import { useSession } from "@/auth/session";
import { AppTopBar } from "@/components/AppTopBar";
import { BacktestCard } from "@/components/BacktestCard";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { EmptyState } from "@/components/EmptyState";
import { LocalEconomyBriefCard } from "@/components/LocalEconomyBriefCard";
import { RichText, stripMdMarks } from "@/components/RichText";
import { ScalePressable } from "@/components/ScalePressable";
import { ScreenFade } from "@/components/ScreenFade";
import { ShareButton } from "@/components/ShareButton";
import { SkeletonList } from "@/components/Skeleton";
import { refreshFindSurfacesOnFocus } from "@/finds/focusRefresh";
import { openChatAbout } from "@/nav/chatAbout";
import { colors, elevation, fonts, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { shareBriefText } from "@/util/share";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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

/** Fast local matches while the live quote query catches up. */
const POPULAR_TICKERS: { symbol: string; name: string }[] = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "META", name: "Meta" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "NKE", name: "Nike" },
  { symbol: "SBUX", name: "Starbucks" },
  { symbol: "MCD", name: "McDonald's" },
  { symbol: "YUM", name: "Yum! Brands" },
  { symbol: "DIS", name: "Disney" },
  { symbol: "COST", name: "Costco" },
  { symbol: "WMT", name: "Walmart" },
  { symbol: "TGT", name: "Target" },
  { symbol: "KO", name: "Coca-Cola" },
  { symbol: "PEP", name: "PepsiCo" },
  { symbol: "HSY", name: "Hershey" },
  { symbol: "JPM", name: "JPMorgan" },
  { symbol: "V", name: "Visa" },
];

function isTickerShape(raw: string): boolean {
  return /^[A-Z][A-Z0-9.]{0,5}$/.test(raw.trim().toUpperCase().replace(/^\$/, ""));
}

/** Whole dollars past $1,000 — matches the counterfactual line on universe.tsx. */
function universeMoney(n: number): string {
  const decimals = Math.abs(n) < 1000 ? 2 : 0;
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Home is the watchlist plus your universe of found companies. Camera is the
 * hero loop; Map is one quiet link. Briefs and movers wait until something is
 * saved. Settings live in ≡.
 */
export default function HomeScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const params = useLocalSearchParams<{ focus?: string }>();
  const searchRef = useRef<TextInput>(null);
  const [tickerQuery, setTickerQuery] = useState("");
  /** Debounced copy of tickerQuery — drives live quote suggestions. */
  const [debouncedQuery, setDebouncedQuery] = useState("");
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

  useEffect(() => {
    const t = setTimeout(
      () => setDebouncedQuery(tickerQuery.trim().toUpperCase().replace(/^\$/, "")),
      180,
    );
    return () => clearTimeout(t);
  }, [tickerQuery]);

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
      listWatchlist({ token: session!.token }, selectedListId ? { listId: selectedListId } : {}),
    enabled: !!session?.token,
    staleTime: 5_000,
  });

  useFocusEffect(
    useCallback(() => {
      if (!session?.token) return;
      void qc.invalidateQueries({ queryKey: ["watchlist", session.token] });
      void qc.invalidateQueries({ queryKey: ["watchlists", session.token] });
      return refreshFindSurfacesOnFocus(qc, session.token);
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

  // "Your universe" — everything the user has identified, newest first.
  const findsQ = useQuery({
    queryKey: ["finds", session?.token],
    queryFn: () => listFinds({ token: session?.token }),
    enabled: !!session?.token,
    staleTime: 60_000,
  });
  const finds = findsQ.data?.finds ?? [];
  const recentFinds = finds.slice(0, 8);
  // Server progression is the streak's source of truth; `retry: false` plus a
  // local fallback means a 404 here leaves the universe subtitle unchanged.
  const progressQ = useQuery({
    queryKey: ["progress", session?.token],
    queryFn: () => fetchProgress({ token: session?.token }),
    enabled: !!session?.token,
    staleTime: 60_000,
    retry: false,
  });
  const findStreak = resolveStreakDays(progressQ.data?.progress.streakDays, finds);
  // Counterfactual universe portfolio (roadmap A3), same fail-soft contract as
  // the journal: `retry: false`, read `.data` only, so a 404 leaves the
  // universe section exactly as it was before this endpoint existed.
  const universeSummaryQ = useQuery({
    queryKey: ["universe-summary", session?.token],
    queryFn: () => fetchUniverseSummary({ token: session?.token }),
    enabled: !!session?.token,
    staleTime: 60_000,
    retry: false,
  });
  const universeSummary = universeSummaryQ.data;
  const findSyms = [
    ...new Set(
      recentFinds
        .map((f) => (f.ticker ?? f.comparable)?.toUpperCase())
        .filter((s): s is string => !!s),
    ),
  ].slice(0, 12);
  const findQuotesQ = useQuery({
    queryKey: ["find-quotes", findSyms.join(",")],
    queryFn: () => fetchQuotesMap(findSyms, { token: session?.token }),
    enabled: findSyms.length > 0,
    staleTime: 60_000,
  });
  const findQuotes: Record<string, Quote> = findQuotesQ.data ?? {};

  // Live quote for whatever the user is typing — makes the search bar feel
  // responsive instead of "type then hit Go and hope".
  const liveSearchEnabled =
    debouncedQuery.length >= 1 && isTickerShape(debouncedQuery) && debouncedQuery.length <= 6;
  const liveQuoteQ = useQuery({
    queryKey: ["search-quote", debouncedQuery],
    queryFn: () => fetchQuote(debouncedQuery, { token: session?.token }),
    enabled: liveSearchEnabled,
    staleTime: 30_000,
    retry: false,
  });

  const searchSuggestions = useMemo(() => {
    if (!debouncedQuery) return [];
    const q = debouncedQuery.toLowerCase();
    const fromWatch = rawItems
      .filter(
        (e) => e.ticker.toLowerCase().startsWith(q) || (e.name ?? "").toLowerCase().includes(q),
      )
      .map((e) => ({
        symbol: e.ticker.toUpperCase(),
        name: e.name ?? e.ticker,
        source: "watchlist" as const,
      }));
    const fromPopular = POPULAR_TICKERS.filter(
      (p) => p.symbol.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q),
    ).map((p) => ({
      symbol: p.symbol,
      name: p.name,
      source: "popular" as const,
    }));
    const seen = new Set<string>();
    const out: { symbol: string; name: string; source: "watchlist" | "popular" | "live" }[] = [];
    for (const row of [...fromWatch, ...fromPopular]) {
      if (seen.has(row.symbol)) continue;
      seen.add(row.symbol);
      out.push(row);
      if (out.length >= 6) break;
    }
    if (liveSearchEnabled && liveQuoteQ.data?.quote && !seen.has(debouncedQuery)) {
      out.unshift({
        symbol: debouncedQuery,
        name: liveQuoteQ.data.quote.symbol,
        source: "live",
      });
    } else if (
      liveSearchEnabled &&
      isTickerShape(debouncedQuery) &&
      !seen.has(debouncedQuery) &&
      out.length === 0
    ) {
      out.push({ symbol: debouncedQuery, name: debouncedQuery, source: "live" });
    }
    return out.slice(0, 6);
  }, [debouncedQuery, rawItems, liveSearchEnabled, liveQuoteQ.data]);

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
          return (qb?.price ?? Number.NEGATIVE_INFINITY) - (qa?.price ?? Number.NEGATIVE_INFINITY);
        case "changePct":
          return (
            (qb?.changePct ?? Number.NEGATIVE_INFINITY) -
            (qa?.changePct ?? Number.NEGATIVE_INFINITY)
          );
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
        qc.setQueryData(["watchlist", session?.token, selectedListId ?? "default"], ctx.previous);
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
      <AppTopBar title="Mapvest" brandTitle />

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
              onRefresh={() => {
                void wl.refetch();
                void qc.invalidateQueries({ queryKey: ["local-brief"] });
              }}
              tintColor={colors.fgMuted}
            />
          }
          ListHeaderComponent={
            <View>
              {/* Hero card — camera identify is Mapvest's signature loop. */}
              <ScalePressable
                onPress={() => router.push("/(tabs)/camera?intent=snap")}
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
                    <Ionicons name="camera" size={18} color={colors.accentInk} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroTitle}>Snap a brand</Text>
                    <Text style={styles.heroSub}>
                      Turn what's in front of you into something you can own.
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.accentInk} />
                </LinearGradient>
              </ScalePressable>

              <Pressable
                onPress={() => {
                  hapticSelect();
                  router.push("/(tabs)/map");
                }}
                style={styles.mapLink}
                accessibilityRole="button"
                accessibilityLabel="Open map — nearby brands"
              >
                <Ionicons name="map-outline" size={16} color={colors.accent} />
                <Text style={styles.mapLinkText}>Or walk the map</Text>
                <Ionicons name="chevron-forward" size={14} color={colors.fgDim} />
              </Pressable>

              {session?.token && finds.length > 0 ? (
                <>
                  <Pressable
                    onPress={() => {
                      hapticSelect();
                      router.push("/universe");
                    }}
                    style={styles.sectionHead}
                    accessibilityRole="button"
                    accessibilityLabel="Open your universe"
                  >
                    <Text style={styles.universeTitle}>Your universe</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text style={styles.count}>
                        {finds.length} find{finds.length === 1 ? "" : "s"}
                        {findStreak >= 2 ? ` · ${findStreak} day streak` : ""}
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={colors.fgDim} />
                    </View>
                  </Pressable>
                  {/* Counterfactual line (roadmap A3). Hypothetical, never a
                      holdings statement, and only drawn from finds the server
                      could actually price when found. */}
                  {universeSummary && universeSummary.valuedFinds > 0 ? (
                    <Text style={styles.universeCf}>
                      <Text style={styles.universeCfLabel}>$100 per find → </Text>
                      <Text style={styles.universeCfValue}>
                        {universeMoney(universeSummary.hypotheticalValue)}
                      </Text>
                      <Text
                        style={{
                          color: universeSummary.changePct >= 0 ? colors.accent : colors.danger,
                        }}
                      >
                        {"  "}
                        {universeSummary.changePct >= 0 ? "+" : ""}
                        {universeSummary.changePct.toFixed(1)}%
                      </Text>
                      <Text style={styles.universeCfLabel}>
                        {"  ·  "}hypothetical, {universeSummary.valuedFinds} priced when found
                      </Text>
                    </Text>
                  ) : null}
                  <FlatList
                    data={recentFinds}
                    keyExtractor={(f) => f.id}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.findRow}
                    renderItem={({ item }) => {
                      const sym = (item.ticker ?? item.comparable)?.toUpperCase();
                      const quote = sym ? findQuotes[sym] : undefined;
                      const delta =
                        item.foundPrice && quote
                          ? ((quote.price - item.foundPrice) / item.foundPrice) * 100
                          : undefined;
                      return (
                        <ScalePressable
                          style={styles.findChip}
                          onPress={() => {
                            hapticSelect();
                            router.push({
                              pathname: "/detail/[id]",
                              params: { id: item.ticker ?? item.comparable ?? item.brand },
                            });
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${item.brand}`}
                        >
                          <Text style={styles.findChipSym} numberOfLines={1}>
                            {item.ticker ?? (item.comparable ? `≈${item.comparable}` : item.brand)}
                          </Text>
                          <Text style={styles.findChipBrand} numberOfLines={1}>
                            {item.brand}
                          </Text>
                          {delta !== undefined ? (
                            <Text
                              style={[
                                styles.findChipDelta,
                                { color: delta >= 0 ? colors.accent : colors.danger },
                              ]}
                            >
                              {delta >= 0 ? "+" : ""}
                              {delta.toFixed(1)}% since
                            </Text>
                          ) : null}
                        </ScalePressable>
                      );
                    }}
                  />
                </>
              ) : null}

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
                  {liveQuoteQ.isFetching ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.fgDim}
                      style={{ marginRight: 10 }}
                    />
                  ) : null}
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

              {searchSuggestions.length > 0 ? (
                <View style={styles.suggestPanel}>
                  {searchSuggestions.map((s) => {
                    const q =
                      quotes[s.symbol] ??
                      (s.symbol === debouncedQuery ? liveQuoteQ.data?.quote : undefined);
                    const up = (q?.change ?? 0) >= 0;
                    return (
                      <Pressable
                        key={`${s.source}-${s.symbol}`}
                        style={styles.suggestRow}
                        onPress={() => openTicker(s.symbol)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${s.symbol}`}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.suggestSym}>{s.symbol}</Text>
                          <Text style={styles.suggestName} numberOfLines={1}>
                            {s.name}
                          </Text>
                        </View>
                        {q ? (
                          <Text
                            style={[
                              styles.suggestPx,
                              { color: up ? colors.accent : colors.danger },
                            ]}
                          >
                            ${q.price.toFixed(2)}
                          </Text>
                        ) : (
                          <Ionicons name="chevron-forward" size={14} color={colors.fgDim} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View style={{ marginTop: 8 }}>
                <LocalEconomyBriefCard token={session?.token} />
              </View>

              {/* Insight stack — backtest sits under the Local Economy button,
                  then the daily brief and movers lead into the watchlist. */}
              {session?.token && rawItems.length > 0 ? (
                <>
                  <BacktestCard tickers={rawItems.map((i) => i.ticker)} token={session.token} />
                  <DailyBriefCard token={session.token} tickers={rawItems.map((i) => i.ticker)} />
                  <TopMoversCard
                    items={rawItems}
                    quotes={quotes}
                    onOpen={(t) => router.push({ pathname: "/detail/[id]", params: { id: t } })}
                  />
                </>
              ) : null}

              {session?.token && lists.length >= 2 ? (
                <FlatList
                  data={[
                    {
                      id: "__all__",
                      name: "All",
                      isDefault: false,
                      tickerCount: 0,
                    } as WatchlistSummary,
                    ...lists,
                  ]}
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
                      accessibilityLabel={wlCollapsed ? "Expand watchlist" : "Collapse watchlist"}
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
                  {items.length} {items.length === 1 ? "company" : "companies"}
                </Text>
              </View>

              {session?.token && items.length >= 3 && !wlCollapsed ? (
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
                <View style={styles.guestHint}>
                  <Text style={styles.guestHintText}>
                    You can snap and explore without an account. Sign in when you find something
                    worth keeping.
                  </Text>
                  <Pressable
                    onPress={() => router.push("/auth")}
                    accessibilityRole="button"
                    accessibilityLabel="Sign in"
                    hitSlop={8}
                  >
                    <Text style={styles.guestSignIn}>Sign in</Text>
                  </Pressable>
                </View>
              ) : wl.isLoading ? (
                <SkeletonList rows={4} />
              ) : items.length === 0 ? (
                <EmptyState
                  icon="bookmark-outline"
                  title="Nothing found yet"
                  subtitle="Snap a storefront or walk the map — everything you find lands here."
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
  const [collapsed, setCollapsed] = useState(false);
  // Fingerprint the ticker set so the query key stays stable when the user
  // re-orders their watchlist but changes when they add/remove.
  const fp = useMemo(
    () =>
      [...tickers]
        .map((t) => t.toUpperCase())
        .sort()
        .join(","),
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
  const hasBrief = briefQ.data?.headline && briefQ.data.body;
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {!collapsed && hasBrief ? (
            <>
              <ChatAboutButton
                onPress={() =>
                  openChatAbout(router, {
                    kind: "brief",
                    title: stripMdMarks(briefQ.data!.headline),
                    body: briefQ.data!.body,
                  })
                }
                accessibilityLabel="Chat about this brief"
              />
              <ShareButton
                onPress={() =>
                  void shareBriefText({
                    headline: stripMdMarks(briefQ.data!.headline),
                    body: briefQ.data!.body,
                  })
                }
                accessibilityLabel="Share daily brief"
              />
            </>
          ) : null}
          <Pressable
            onPress={() => {
              hapticSelect();
              setCollapsed((v) => !v);
            }}
            hitSlop={10}
            style={styles.collapseBtn}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? "Expand daily brief" : "Collapse daily brief"}
            accessibilityState={{ expanded: !collapsed }}
          >
            <Ionicons
              name={collapsed ? "chevron-down" : "chevron-up"}
              size={16}
              color={colors.fgMuted}
            />
          </Pressable>
        </View>
      </View>
      {collapsed ? null : hasBrief ? (
        <>
          <Text style={styles.briefHeadline}>{stripMdMarks(briefQ.data!.headline)}</Text>
          {/* RichText parses paragraphs + auto-links $TICKER mentions to
              the detail page. Was previously a plain Text which left every
              inline ticker un-clickable and every paragraph mashed together. */}
          <RichText text={briefQ.data!.body} />
          <Text style={styles.briefFooter}>
            Written from your watchlist ·{" "}
            {new Date(briefQ.data!.generatedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            · research, not advice
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
            <Text style={styles.moverTicker}>{i.ticker}</Text>
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
              <Text style={styles.moverTicker}>{i.ticker}</Text>
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
  const tickerKey = entry.ticker.toLowerCase();
  const quoteName = (quote as { name?: string } | undefined)?.name;
  const subline =
    quoteName && quoteName.toLowerCase() !== tickerKey
      ? quoteName
      : entry.name && entry.name.toLowerCase() !== tickerKey
        ? entry.name
        : (entry.sector ?? undefined);

  // Right-side action revealed on swipe-left. Confirming before delete because
  // a stray gesture shouldn't nuke a watched ticker.
  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        Alert.alert("Remove from watchlist?", `${entry.ticker} will be removed.`, [
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text style={styles.rowTicker}>{entry.ticker}</Text>
            {entry.source === "camera" ? (
              <Ionicons name="camera-outline" size={12} color={colors.fgDim} />
            ) : null}
          </View>
          {subline ? (
            <Text style={styles.rowName} numberOfLines={1}>
              {subline}
            </Text>
          ) : null}
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
  suggestPanel: {
    marginHorizontal: 16,
    marginTop: -8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    minHeight: 48,
  },
  suggestSym: { color: colors.fg, fontSize: 15, fontWeight: "700" },
  suggestName: { color: colors.fgMuted, fontSize: 12, marginTop: 1 },
  suggestPx: { fontSize: 14, fontWeight: "700" },
  hero: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: radii.xl,
    overflow: "hidden",
  },
  heroGrad: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  heroIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { color: colors.accentInk, ...type.h3, fontSize: 16 },
  heroSub: {
    color: colors.accentInk,
    opacity: 0.85,
    fontSize: 11,
    marginTop: 1,
    fontWeight: "600",
  },
  mapLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  mapLinkText: { flex: 1, color: colors.fg, fontSize: 14, fontWeight: "600" },
  universeCf: { paddingHorizontal: 16, paddingBottom: 8, color: colors.fg },
  universeCfLabel: { color: colors.fgMuted, fontSize: 12 },
  universeCfValue: { color: colors.fg, fontSize: 15, fontWeight: "800" },
  findRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
  },
  findChip: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 108,
    maxWidth: 160,
    gap: 2,
  },
  findChipSym: { color: colors.fg, fontSize: 14, fontWeight: "800" },
  findChipBrand: { color: colors.fgMuted, fontSize: 11 },
  findChipDelta: { fontSize: 11, fontWeight: "700", marginTop: 2 },
  guestHint: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    padding: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 8,
  },
  guestHintText: { color: colors.fgMuted, fontSize: 14, lineHeight: 20 },
  guestSignIn: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: { color: colors.fg, ...type.h3, fontSize: 18 },
  universeTitle: { color: colors.fg, fontFamily: fonts.display, fontSize: 18, letterSpacing: -0.2 },
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
    fontFamily: fonts.serif,
  },
  briefBody: {
    color: colors.fgMuted,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.serif,
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
