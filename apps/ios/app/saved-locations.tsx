/**
 * Location folder — every Local Economy Brief the user has stashed via the
 * home-screen Save button. Tap a row to expand its full text; swipe left to
 * delete. Mirrors the swipe-to-delete pattern in home.tsx's WatchRow.
 */
import {
  deleteSavedLocalBrief,
  listSavedLocalBriefs,
  type SavedLocalBrief,
} from "@/api/local-brief";
import { useSession } from "@/auth/session";
import { AppTopBar } from "@/components/AppTopBar";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenFade } from "@/components/ScreenFade";
import { SkeletonList } from "@/components/Skeleton";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SavedLocationsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const [expanded, setExpanded] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["saved-local-briefs", session?.token],
    queryFn: () => listSavedLocalBriefs({ token: session!.token }),
    enabled: !!session?.token,
    staleTime: 10_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSavedLocalBrief(id, { token: session!.token }),
    onMutate: async (id) => {
      const key = ["saved-local-briefs", session?.token];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ items: SavedLocalBrief[] }>(key);
      qc.setQueryData<{ items: SavedLocalBrief[] }>(key, (prev) => ({
        items: (prev?.items ?? []).filter((e) => e.id !== id),
      }));
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(["saved-local-briefs", session?.token], ctx.previous);
      Alert.alert("Couldn't delete", "The brief is still saved. Try again.");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["saved-local-briefs", session?.token] });
    },
  });

  const items = listQ.data?.items ?? [];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ title: "Location folder", headerShown: false }} />
      <AppTopBar
        title="Location folder"
        leading={
          <Pressable
            onPress={() => {
              hapticSelect();
              router.back();
            }}
            hitSlop={12}
            style={styles.backBtn}
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
            icon="bookmark-outline"
            title="Sign in to save briefs"
            subtitle="Your Location folder syncs across devices once you're in."
          >
            <PrimaryButton
              label="Sign in"
              onPress={() => router.push("/auth")}
              style={{ marginTop: 4, alignSelf: "stretch" }}
            />
          </EmptyState>
        ) : listQ.isLoading ? (
          <SkeletonList rows={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="folder-open-outline"
            title="No saved locations yet"
            subtitle="Open Home, wait for the Local Economy Brief, then tap Save to stash it here."
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(e) => e.id}
            contentContainerStyle={{ paddingBottom: 32 }}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => (
              <SavedRow
                entry={item}
                open={expanded === item.id}
                onToggle={() => {
                  hapticSelect();
                  setExpanded((cur) => (cur === item.id ? null : item.id));
                }}
                onDelete={() => {
                  Alert.alert("Delete saved brief?", `"${item.label}" will be removed.`, [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => deleteMut.mutate(item.id),
                    },
                  ]);
                }}
              />
            )}
          />
        )}
      </ScreenFade>
    </SafeAreaView>
  );
}

function SavedRow({
  entry,
  open,
  onToggle,
  onDelete,
}: {
  entry: SavedLocalBrief;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const created = new Date(entry.createdAt);
  const subtitle = [entry.city, entry.state].filter(Boolean).join(", ");
  const renderRightActions = () => (
    <Pressable
      onPress={onDelete}
      style={styles.swipeDelete}
      accessibilityRole="button"
      accessibilityLabel={`Delete saved brief ${entry.label}`}
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
      <Pressable
        onPress={onToggle}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`Open ${entry.label}. Swipe left to delete.`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>{entry.label}</Text>
            {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
            <Text style={styles.rowDate}>
              Saved {created.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </Text>
          </View>
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.fgMuted}
          />
        </View>
        {open ? <Text style={styles.rowBody}>{entry.brief}</Text> : null}
      </Pressable>
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
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  title: { color: colors.fg, ...type.h3, fontSize: 18 },
  sep: { height: 1, backgroundColor: colors.border, marginHorizontal: 16 },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.bg,
    gap: 8,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowLabel: { color: colors.fg, fontSize: 15, fontWeight: "700" },
  rowSubtitle: { color: colors.fgMuted, fontSize: 12, marginTop: 2 },
  rowDate: { color: colors.fgDim, fontSize: 11, marginTop: 2 },
  rowBody: {
    color: colors.fg,
    fontFamily: "Georgia",
    fontSize: 14,
    lineHeight: 22,
    marginTop: 6,
  },
  swipeDelete: {
    backgroundColor: colors.danger,
    justifyContent: "center",
    alignItems: "center",
    width: 88,
    gap: 4,
  },
  swipeDeleteText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
