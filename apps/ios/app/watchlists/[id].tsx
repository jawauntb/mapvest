/**
 * Watchlist detail — one named list.
 *
 * Layout (top to bottom):
 *   1. Header with list name + edit pencil (rename)
 *   2. Sector-composition stacked bar + chip legend (from /list-summary)
 *   3. BacktestCard for the list's tickers
 *   4. Add-ticker inline input (uppercased) + Add button
 *   5. List of tickers (swipe-left to remove, tap to open detail)
 *
 * Sector chart is a plain flex-row of colored View segments (no SVG — the
 * app doesn't depend on react-native-svg). Segment width = pct of total.
 */
import {
  type Quote,
  type WatchEntry,
  type WatchlistSummary,
  addToWatchlist,
  fetchQuotesMap,
  getListSummary,
  listWatchlist,
  listWatchlists,
  removeFromWatchlist,
  renameWatchlist,
} from "@/api/client";
import { useSession } from "@/auth/session";
import { AppTopBar } from "@/components/AppTopBar";
import { BacktestCard } from "@/components/BacktestCard";
import { EmptyState } from "@/components/EmptyState";
import { ScalePressable } from "@/components/ScalePressable";
import { ScreenFade } from "@/components/ScreenFade";
import { SkeletonList } from "@/components/Skeleton";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { sectorColor } from "@/util/sectors";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

export default function WatchlistDetailScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const listId = params.id ?? "";
  const [addSym, setAddSym] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  // Read the list's summary (from /watchlists) so header falls back to server
  // name if params.name isn't passed (deep-linked open).
  const listsQ = useQuery({
    queryKey: ["watchlists", session?.token],
    queryFn: () => listWatchlists({ token: session!.token }),
    enabled: !!session?.token,
    staleTime: 15_000,
  });
  const list: WatchlistSummary | undefined = listsQ.data?.lists.find((l) => l.id === listId);
  const displayName = list?.name ?? (params.name as string | undefined) ?? "Watchlist";

  const entriesQ = useQuery({
    queryKey: ["watchlist", session?.token, listId],
    queryFn: () => listWatchlist({ token: session!.token }, { listId }),
    enabled: !!session?.token && !!listId,
    staleTime: 10_000,
  });
  const entries: WatchEntry[] = entriesQ.data?.items ?? [];
  const tickers = entries.map((e) => e.ticker);

  const summaryQ = useQuery({
    queryKey: ["watchlist-summary", session?.token, listId, tickers.length],
    queryFn: () => getListSummary(listId, { token: session!.token }),
    enabled: !!session?.token && !!listId,
    staleTime: 15_000,
  });

  const quotesQ = useQuery({
    queryKey: ["watchlist-quotes", listId, tickers.join(",")],
    queryFn: () => fetchQuotesMap(tickers, { token: session?.token }),
    enabled: tickers.length > 0,
    staleTime: 60_000,
  });
  const quotes: Record<string, Quote> = quotesQ.data ?? {};

  const addMut = useMutation({
    mutationFn: (ticker: string) =>
      addToWatchlist({ ticker, listId, source: "manual" }, { token: session!.token }),
    onSuccess: (res) => {
      setAddSym("");
      void qc.invalidateQueries({ queryKey: ["watchlist", session?.token, listId] });
      void qc.invalidateQueries({ queryKey: ["watchlists", session?.token] });
      if (res?.unresolved) {
        Alert.alert(
          "Added — but unverified",
          `We couldn't confirm ${res.entry.ticker} exists. It's on your list; check the symbol before trading.`,
        );
      }
    },
    onError: () => Alert.alert("Couldn't add", "Please try again."),
  });

  const removeMut = useMutation({
    mutationFn: (ticker: string) => removeFromWatchlist(ticker, { token: session!.token }),
    onMutate: async (ticker) => {
      const key = ["watchlist", session?.token, listId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ items: WatchEntry[] }>(key);
      qc.setQueryData<{ items: WatchEntry[] }>(key, (prev) => ({
        items: (prev?.items ?? []).filter((e) => e.ticker !== ticker),
      }));
      return { previous };
    },
    onError: (_e, _t, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(["watchlist", session?.token, listId], ctx.previous);
      }
      Alert.alert("Couldn't remove", "Please try again.");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["watchlist", session?.token, listId] });
      void qc.invalidateQueries({ queryKey: ["watchlists", session?.token] });
    },
  });

  const renameMut = useMutation({
    mutationFn: (name: string) => renameWatchlist(listId, name, { token: session!.token }),
    onSuccess: () => {
      setRenameOpen(false);
      void qc.invalidateQueries({ queryKey: ["watchlists", session?.token] });
    },
    onError: () => Alert.alert("Couldn't rename", "Please try again."),
  });

  function submitAdd() {
    const sym = addSym.trim().toUpperCase().replace(/^\$/, "");
    if (!/^[A-Z][A-Z0-9.\-]{0,7}$/.test(sym)) {
      Alert.alert("Not a ticker", "Try something like AAPL, BRK.B, or SBUX.");
      return;
    }
    addMut.mutate(sym);
  }

  const sectors = summaryQ.data?.sectors ?? [];
  // Pre-color each sector so bar segments and chips match.
  const sectorTiles = useMemo(
    () => sectors.map((s) => ({ ...s, color: sectorColor(s.sector) })),
    [sectors],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ title: displayName }} />
      <AppTopBar
        title={displayName}
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.fg} />
          </Pressable>
        }
        right={
          <Pressable
            onPress={() => {
              hapticSelect();
              setRenameValue(displayName);
              setRenameOpen(true);
            }}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Rename list"
          >
            <Ionicons name="pencil-outline" size={18} color={colors.fgMuted} />
          </Pressable>
        }
      />

      <ScreenFade>
        <FlatList
          data={entries}
          keyExtractor={(e) => e.ticker}
          contentContainerStyle={{ paddingBottom: 40 }}
          initialNumToRender={10}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={
            <View>
              <SectorCompositionCard
                tiles={sectorTiles}
                total={summaryQ.data?.tickerCount ?? entries.length}
                loading={summaryQ.isLoading}
              />

              <View style={styles.addRow}>
                <View style={styles.addWrap}>
                  <Ionicons
                    name="add-circle-outline"
                    size={18}
                    color={colors.fgDim}
                    style={{ marginLeft: 10 }}
                  />
                  <TextInput
                    style={styles.addInput}
                    placeholder="Add ticker — AAPL, MSFT…"
                    placeholderTextColor={colors.fgDim}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    value={addSym}
                    onChangeText={(t) => setAddSym(t.toUpperCase())}
                    returnKeyType="done"
                    onSubmitEditing={submitAdd}
                  />
                </View>
                <Pressable
                  onPress={submitAdd}
                  disabled={!addSym.trim() || addMut.isPending}
                  style={[styles.addBtn, (!addSym.trim() || addMut.isPending) && { opacity: 0.5 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Add ticker"
                >
                  <Text style={styles.addBtnText}>{addMut.isPending ? "…" : "Add"}</Text>
                </Pressable>
              </View>

              {session?.token ? <BacktestCard tickers={tickers} token={session.token} /> : null}

              <Text style={styles.sectionTitle}>Tickers</Text>
              <Text style={styles.count}>{entries.length} in this list</Text>
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
          ListEmptyComponent={
            entriesQ.isLoading ? (
              <SkeletonList rows={4} />
            ) : (
              <EmptyState
                icon="bookmark-outline"
                title="No tickers yet"
                subtitle="Use the field above to add symbols directly, or save tickers from map / camera."
              />
            )
          }
        />
      </ScreenFade>

      <Modal
        visible={renameOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setRenameOpen(false)}
      >
        <Pressable style={styles.modalScrim} onPress={() => setRenameOpen(false)}>
          <Pressable style={[styles.modalCard, elevation.md]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Rename watchlist</Text>
            <TextInput
              style={styles.editInput}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Name"
              placeholderTextColor={colors.fgDim}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setRenameOpen(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.createBtn,
                  (!renameValue.trim() || renameValue === displayName) && { opacity: 0.5 },
                ]}
                disabled={!renameValue.trim() || renameValue === displayName || renameMut.isPending}
                onPress={() => renameMut.mutate(renameValue.trim())}
              >
                <Text style={styles.createBtnText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function SectorCompositionCard({
  tiles,
  total,
  loading,
}: {
  tiles: Array<{ sector: string; count: number; pct: number; color: string }>;
  total: number;
  loading: boolean;
}) {
  if (loading) {
    return (
      <View style={styles.compCard}>
        <Text style={styles.compTitle}>Sector composition</Text>
        <View style={styles.compBarSkeleton} />
      </View>
    );
  }
  if (tiles.length === 0) {
    return (
      <View style={styles.compCard}>
        <Text style={styles.compTitle}>Sector composition</Text>
        <Text style={styles.compEmpty}>
          Add tickers with a sector tag (from map or camera) to see composition.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.compCard}>
      <Text style={styles.compTitle}>Sector composition</Text>
      <View style={styles.compBar}>
        {tiles.map((t) => (
          <View
            key={t.sector}
            style={{
              flex: Math.max(t.pct, 0.02),
              backgroundColor: t.color,
              height: 12,
            }}
          />
        ))}
      </View>
      <View style={styles.compChips}>
        {tiles.map((t) => (
          <View key={t.sector} style={styles.compChip}>
            <View style={[styles.compChipDot, { backgroundColor: t.color }]} />
            <Text style={styles.compChipText} numberOfLines={1}>
              {t.sector}
            </Text>
            <Text style={styles.compChipPct}>
              {t.count} · {Math.round(t.pct * 100)}%
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.compFooter}>
        {total} ticker{total === 1 ? "" : "s"} grouped by stored sector.
      </Text>
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

  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        Alert.alert("Remove from list?", `${entry.ticker} will be removed.`, [
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
          <Text style={styles.rowTicker}>{entry.ticker}</Text>
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  titleWrap: {
    flex: 1,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  title: { color: colors.fg, ...type.h3, fontSize: 18, maxWidth: 220 },
  titleTag: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  compCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    padding: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 10,
  },
  compTitle: { color: colors.fg, ...type.body, fontWeight: "700", fontSize: 14 },
  compBar: {
    flexDirection: "row",
    borderRadius: radii.sm,
    overflow: "hidden",
    backgroundColor: colors.bgSunken,
    height: 12,
  },
  compBarSkeleton: {
    height: 12,
    borderRadius: radii.sm,
    backgroundColor: colors.bgSunken,
  },
  compEmpty: { color: colors.fgDim, fontSize: 12 },
  compChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  compChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
    maxWidth: "100%",
  },
  compChipDot: { width: 8, height: 8, borderRadius: 4 },
  compChipText: { color: colors.fg, fontSize: 11, fontWeight: "700" },
  compChipPct: { color: colors.fgDim, fontSize: 11, fontWeight: "600" },
  compFooter: { color: colors.fgDim, fontSize: 11 },
  addRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 14,
  },
  addWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
  },
  addInput: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 11,
    color: colors.fg,
    fontSize: 15,
    minHeight: 44,
  },
  addBtn: {
    paddingHorizontal: 16,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 60,
  },
  addBtnText: { color: colors.accentInk, fontWeight: "800", fontSize: 15 },
  sectionTitle: {
    color: colors.fg,
    ...type.h3,
    fontSize: 16,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  count: {
    color: colors.fgDim,
    fontSize: 12,
    paddingHorizontal: 16,
    marginTop: 2,
    marginBottom: 6,
  },
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
  swipeDelete: {
    backgroundColor: colors.danger,
    justifyContent: "center",
    alignItems: "center",
    width: 88,
    gap: 4,
  },
  swipeDeleteText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  modalTitle: { color: colors.fg, fontWeight: "700", fontSize: 16 },
  editInput: {
    color: colors.fg,
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    backgroundColor: colors.bgSunken,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 9 },
  cancelText: { color: colors.fgMuted, fontWeight: "700" },
  createBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  createBtnText: { color: colors.accentInk, fontWeight: "800" },
});
