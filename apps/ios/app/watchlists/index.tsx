/**
 * Watchlists index — collapsible list of every named list the user owns.
 *
 * Each row shows the list name + ticker count with an expand chevron and a
 * visible "•••" button (long-press also works, as a shortcut). Both open a
 * rename / make-default / delete action sheet. A "+ New watchlist" pill at
 * the top lets the user create one inline. A one-time dismissible tip
 * explains the default list's purpose once a second list exists — the
 * moment "make this one the default" first becomes a real question.
 */
import {
  type WatchEntry,
  type WatchlistSummary,
  createWatchlist,
  deleteWatchlist,
  listWatchlist,
  listWatchlists,
  renameWatchlist,
  setDefaultWatchlist,
} from "@/api/client";
import { useSession } from "@/auth/session";
import { AppTopBar } from "@/components/AppTopBar";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenFade } from "@/components/ScreenFade";
import { SkeletonList } from "@/components/Skeleton";
import { colors, elevation, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const DEFAULT_TIP_KEY = "mapvest.watchlistDefaultTip.v1";

export default function WatchlistsIndexScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<WatchlistSummary | null>(null);
  const [editName, setEditName] = useState("");
  const [showDefaultTip, setShowDefaultTip] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(DEFAULT_TIP_KEY);
        if (!cancelled && seen !== "1") setShowDefaultTip(true);
      } catch {
        /* fail closed — no tip is better than a broken screen */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function dismissDefaultTip() {
    setShowDefaultTip(false);
    AsyncStorage.setItem(DEFAULT_TIP_KEY, "1").catch(() => {
      /* worst case it reappears next visit — not worth blocking on */
    });
  }

  const listsQ = useQuery({
    queryKey: ["watchlists", session?.token],
    queryFn: () => listWatchlists({ token: session!.token }),
    enabled: !!session?.token,
    staleTime: 10_000,
  });
  const lists = listsQ.data?.lists ?? [];

  const createMut = useMutation({
    mutationFn: (name: string) => {
      // Fail loudly when we don't have a token — the outer render already
      // guards against this, but a race (session going stale mid-tap) would
      // otherwise throw a TypeError inside jsonFetch and hit onError with
      // an opaque message that reads as "nothing happened" in the UI.
      if (!session?.token) throw new Error("You're signed out. Sign in and try again.");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Give the list a name first.");
      return createWatchlist(trimmed, { token: session.token });
    },
    onSuccess: () => {
      setNewName("");
      setCreating(false);
      void qc.invalidateQueries({ queryKey: ["watchlists", session?.token] });
    },
    onError: (err: unknown) => {
      // Surface the API's real error text — a silent "nothing happens on tap"
      // is worse than a specific message the user can act on (auth expired,
      // network offline, duplicate name, etc.).
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Please try again.";
      Alert.alert("Couldn't create", msg);
    },
  });

  const renameMut = useMutation({
    mutationFn: (args: { id: string; name: string }) =>
      renameWatchlist(args.id, args.name, { token: session!.token }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["watchlists", session?.token] });
    },
    onError: () => Alert.alert("Couldn't rename", "Please try again."),
  });

  const defaultMut = useMutation({
    mutationFn: (id: string) => setDefaultWatchlist(id, { token: session!.token }),
    onSuccess: () => {
      setEditing(null);
      // The default list backs Home's "All" view AND the Mapvest Daily brief,
      // so invalidate every list-scoped cache: the lists index (star / order),
      // all watchlist entry queries (Home's "default"-keyed entry included),
      // and the brief itself so Home re-fetches it for the new default.
      void qc.invalidateQueries({ queryKey: ["watchlists", session?.token] });
      void qc.invalidateQueries({ queryKey: ["watchlist", session?.token] });
      void qc.invalidateQueries({ queryKey: ["watchlist-brief"] });
      void qc.invalidateQueries({ queryKey: ["watchlist-summary"] });
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Please try again.";
      Alert.alert("Couldn't set default", msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteWatchlist(id, { token: session!.token }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["watchlists", session?.token] });
    },
    onError: (err: unknown) => {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Please try again.";
      Alert.alert("Couldn't delete", msg);
    },
  });

  function toggleExpand(id: string) {
    hapticSelect();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ title: "Watchlists" }} />
      <AppTopBar
        title="Watchlists"
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
      />

      <ScreenFade>
        {!session?.token ? (
          <EmptyState
            icon="star-outline"
            title="Sign in to keep watchlists"
            subtitle="Multiple named lists, backtests, and sector composition — all sync when you sign in."
          >
            <PrimaryButton
              label="Sign in"
              onPress={() => router.push("/auth")}
              style={{ marginTop: 4, alignSelf: "stretch" }}
            />
          </EmptyState>
        ) : (
          <FlatList
            data={lists}
            keyExtractor={(l) => l.id}
            contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16 }}
            // Without this, the first tap on Create (while the "Name your
            // watchlist" input has focus) just dismisses the keyboard —
            // the Pressable never fires and the user perceives the button
            // as broken. `handled` lets Pressables with their own onPress
            // consume the tap instead of the scroll view eating it.
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View>
                {showDefaultTip && lists.length >= 2 ? (
                  <View style={[styles.tipCard, elevation.sm]}>
                    <Ionicons
                      name="star-outline"
                      size={16}
                      color={colors.accent}
                      style={{ marginTop: 1 }}
                    />
                    <Text style={styles.tipText}>
                      One list is always your <Text style={styles.tipBold}>default</Text> — it
                      powers the home screen and your Mapvest Daily brief. Tap{" "}
                      <Text style={styles.tipBold}>•••</Text> on any list to make it the default.
                    </Text>
                    <Pressable
                      onPress={dismissDefaultTip}
                      hitSlop={10}
                      style={styles.tipDismiss}
                      accessibilityRole="button"
                      accessibilityLabel="Dismiss tip"
                    >
                      <Ionicons name="close" size={15} color={colors.fgDim} />
                    </Pressable>
                  </View>
                ) : null}
                {creating ? (
                  <View style={[styles.newCard, elevation.sm]}>
                    <TextInput
                      style={styles.newInput}
                      placeholder="Name your watchlist"
                      placeholderTextColor={colors.fgDim}
                      autoFocus
                      value={newName}
                      onChangeText={setNewName}
                      returnKeyType="done"
                      onSubmitEditing={() => {
                        if (newName.trim()) createMut.mutate(newName.trim());
                      }}
                    />
                    <View style={styles.newActions}>
                      <Pressable
                        onPress={() => {
                          setCreating(false);
                          setNewName("");
                        }}
                        style={styles.cancelBtn}
                      >
                        <Text style={styles.cancelText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.createBtn, !newName.trim() && { opacity: 0.5 }]}
                        disabled={!newName.trim() || createMut.isPending}
                        onPress={() => createMut.mutate(newName.trim())}
                      >
                        <Text style={styles.createBtnText}>
                          {createMut.isPending ? "Creating…" : "Create"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      hapticSelect();
                      setCreating(true);
                    }}
                    style={styles.newPill}
                    accessibilityRole="button"
                    accessibilityLabel="New watchlist"
                  >
                    <Ionicons name="add" size={16} color={colors.accent} />
                    <Text style={styles.newPillText}>New watchlist</Text>
                  </Pressable>
                )}
              </View>
            }
            renderItem={({ item }) => (
              <WatchlistRow
                list={item}
                expanded={expanded.has(item.id)}
                onToggle={() => toggleExpand(item.id)}
                onOpen={() =>
                  router.push({
                    pathname: "/watchlists/[id]",
                    params: { id: item.id, name: item.name },
                  })
                }
                onLongPress={() => {
                  setEditing(item);
                  setEditName(item.name);
                }}
                token={session.token}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            ListEmptyComponent={
              listsQ.isLoading ? (
                <SkeletonList rows={3} />
              ) : (
                <EmptyState
                  icon="bookmark-outline"
                  title="No lists yet"
                  subtitle="Create one to group tickers by theme (Growth, REITs, Food chains…)."
                />
              )
            }
          />
        )}
      </ScreenFade>

      <Modal
        visible={!!editing}
        animationType="fade"
        transparent
        onRequestClose={() => setEditing(null)}
      >
        <Pressable style={styles.modalScrim} onPress={() => setEditing(null)}>
          <Pressable style={[styles.modalCard, elevation.md]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Edit "{editing?.name}"</Text>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Rename"
              placeholderTextColor={colors.fgDim}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setEditing(null)}
                style={styles.cancelBtn}
                accessibilityRole="button"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.createBtn,
                  (!editName.trim() || editName === editing?.name) && { opacity: 0.5 },
                ]}
                disabled={
                  !editing || !editName.trim() || editName === editing.name || renameMut.isPending
                }
                onPress={() => {
                  if (editing && editName.trim()) {
                    renameMut.mutate({ id: editing.id, name: editName.trim() });
                  }
                }}
              >
                <Text style={styles.createBtnText}>Rename</Text>
              </Pressable>
            </View>
            {editing && !editing.isDefault ? (
              <View style={styles.makeDefaultWrap}>
                <Text style={styles.makeDefaultHint}>
                  The default list powers the home screen and your Mapvest Daily brief.
                </Text>
                <Pressable
                  style={styles.makeDefaultBtn}
                  disabled={defaultMut.isPending}
                  onPress={() => {
                    if (!editing) return;
                    hapticSelect();
                    defaultMut.mutate(editing.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Make ${editing.name} the default watchlist`}
                >
                  <Ionicons name="star-outline" size={16} color={colors.accent} />
                  <Text style={styles.makeDefaultText}>
                    {defaultMut.isPending ? "Making default…" : "Make default"}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {editing && !editing.isDefault ? (
              <Pressable
                style={styles.deleteBtn}
                onPress={() => {
                  if (!editing) return;
                  Alert.alert(
                    "Delete this list?",
                    `"${editing.name}" and its ${editing.tickerCount} ticker${
                      editing.tickerCount === 1 ? "" : "s"
                    } will be removed.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => deleteMut.mutate(editing.id),
                      },
                    ],
                  );
                }}
              >
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.deleteText}>Delete watchlist</Text>
              </Pressable>
            ) : editing?.isDefault ? (
              <Text style={styles.defaultNote}>
                This is your default list — it powers the home screen and Mapvest Daily. Make
                another list the default to delete this one.
              </Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function WatchlistRow({
  list,
  expanded,
  onToggle,
  onOpen,
  onLongPress,
  token,
}: {
  list: WatchlistSummary;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onLongPress: () => void;
  token: string;
}) {
  return (
    <View style={[styles.rowCard, elevation.sm]}>
      <View style={styles.rowHead}>
        <Pressable
          style={styles.rowHeadMain}
          onPress={onOpen}
          onLongPress={onLongPress}
          delayLongPress={350}
          accessibilityRole="button"
          accessibilityLabel={`Open ${list.name}`}
        >
          <View style={styles.rowIcon}>
            <Ionicons
              name={list.isDefault ? "star" : "bookmark-outline"}
              size={16}
              color={colors.accent}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowName} numberOfLines={1}>
              {list.name}
            </Text>
            <Text style={styles.rowSub}>
              {list.tickerCount} ticker{list.tickerCount === 1 ? "" : "s"}
              {list.isDefault ? " · Default" : ""}
            </Text>
          </View>
        </Pressable>
        {/* Visible entry point to rename / make-default / delete — long-press
            on the row body still works as a shortcut, but a button you can
            see is the one people actually find. */}
        <Pressable
          onPress={onLongPress}
          hitSlop={10}
          style={styles.menuBtn}
          accessibilityRole="button"
          accessibilityLabel={`${list.name} options: rename, make default, or delete`}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.fgMuted} />
        </Pressable>
        <Pressable
          onPress={onToggle}
          hitSlop={12}
          style={styles.chevronBtn}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Collapse" : "Expand"}
          accessibilityState={{ expanded }}
        >
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.fgMuted}
          />
        </Pressable>
      </View>
      {expanded ? <ExpandedTickers listId={list.id} token={token} onOpen={onOpen} /> : null}
    </View>
  );
}

function ExpandedTickers({
  listId,
  token,
  onOpen,
}: {
  listId: string;
  token: string;
  onOpen: () => void;
}) {
  const router = useRouter();
  const q = useQuery({
    queryKey: ["watchlist", token, listId],
    queryFn: () => listWatchlist({ token }, { listId }),
    staleTime: 15_000,
  });
  const items: WatchEntry[] = q.data?.items ?? [];
  if (q.isLoading) {
    return (
      <View style={styles.expandBody}>
        <Text style={styles.mutedText}>Loading…</Text>
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={styles.expandBody}>
        <Text style={styles.mutedText}>Empty — tap the list to add tickers.</Text>
      </View>
    );
  }
  return (
    <View style={styles.expandBody}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingRight: 4 }}
      >
        {items.slice(0, 20).map((e) => (
          <Pressable
            key={e.ticker}
            style={styles.tickerChip}
            onPress={() => router.push({ pathname: "/detail/[id]", params: { id: e.ticker } })}
            accessibilityRole="button"
            accessibilityLabel={`Open ${e.ticker}`}
          >
            <Text style={styles.tickerChipText}>${e.ticker}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={styles.openLink} onPress={onOpen}>
        <Text style={styles.openLinkText}>Open list</Text>
        <Ionicons name="arrow-forward" size={13} color={colors.accent} />
      </Pressable>
    </View>
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
  title: { color: colors.fg, ...type.h3, fontSize: 20 },
  newPill: {
    marginTop: 12,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.bgElevated,
  },
  newPillText: { color: colors.accent, fontWeight: "700", fontSize: 14 },
  tipCard: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  tipText: { flex: 1, color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
  tipBold: { color: colors.fg, fontWeight: "700" },
  tipDismiss: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -1,
  },
  newCard: {
    marginTop: 12,
    marginBottom: 16,
    padding: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 10,
  },
  newInput: {
    color: colors.fg,
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    backgroundColor: colors.bgSunken,
  },
  newActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 9 },
  cancelText: { color: colors.fgMuted, fontWeight: "700" },
  createBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  createBtnText: { color: colors.accentInk, fontWeight: "800" },
  rowCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  rowHeadMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    backgroundColor: colors.bgSunken,
    alignItems: "center",
    justifyContent: "center",
  },
  rowName: { color: colors.fg, fontWeight: "700", fontSize: 15 },
  rowSub: { color: colors.fgDim, fontSize: 12, marginTop: 2 },
  menuBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  chevronBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
  },
  expandBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  mutedText: { color: colors.fgDim, fontSize: 12 },
  tickerChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  tickerChipText: { color: colors.fg, fontSize: 12, fontWeight: "700" },
  openLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  openLinkText: { color: colors.accent, fontSize: 12, fontWeight: "700" },
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
  makeDefaultWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 4,
    paddingTop: 8,
    gap: 4,
  },
  makeDefaultHint: { color: colors.fgDim, fontSize: 11, textAlign: "center" },
  makeDefaultBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
  },
  makeDefaultText: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 4,
  },
  deleteText: { color: colors.danger, fontWeight: "700", fontSize: 13 },
  defaultNote: { color: colors.fgDim, fontSize: 11, textAlign: "center", paddingTop: 6 },
});
