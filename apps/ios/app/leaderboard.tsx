/**
 * Weekly leaderboard — the first cross-user surface (packages/design/
 * HANDOFF.md Item 3, "the early spotter"). Ranks finders by early-find
 * score for the current cycle, never by raw find count (see
 * `@/api/leaderboard`). A plain scrollable list; the caller's own row is
 * always present and highlighted, in the top 50 or appended below it.
 *
 * Reached from the WeeklyQuestCard's "This week" chip.
 */
import { type LeaderboardRow, fetchWeeklyLeaderboard } from "@/api/leaderboard";
import { useSession } from "@/auth/session";
import { AppTopBar } from "@/components/AppTopBar";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenFade } from "@/components/ScreenFade";
import { SkeletonList } from "@/components/Skeleton";
import { colors } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { formatCycleHeader } from "@/util/weeklyCycle";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function LeaderboardScreen() {
  const router = useRouter();
  const { session } = useSession();

  const boardQ = useQuery({
    queryKey: ["leaderboard-weekly", session?.token],
    queryFn: () => fetchWeeklyLeaderboard({ token: session!.token }, 50),
    enabled: !!session?.token,
    staleTime: 60_000,
  });

  // Every focus: freshest scores + rank, no stale week-old snapshot.
  useFocusEffect(
    useCallback(() => {
      if (!session?.token) return;
      void boardQ.refetch();
    }, [session?.token, boardQ.refetch]),
  );

  const rows = boardQ.data?.rows ?? [];
  const header =
    boardQ.data &&
    formatCycleHeader(new Date(boardQ.data.cycleStart), new Date(boardQ.data.cycleEnd));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ title: "Leaderboard", headerShown: false }} />
      <AppTopBar
        title="Leaderboard"
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
      {header ? <Text style={styles.cycleLabel}>{header}</Text> : null}
      <Text style={styles.subtitle}>
        Ranked on early-find score — evidence, not raw scan count.
      </Text>

      <ScreenFade>
        {!session?.token ? (
          <EmptyState
            icon="trophy-outline"
            title="Sign in to see the board"
            subtitle="The weekly leaderboard follows your account across devices."
          >
            <PrimaryButton
              label="Sign in"
              onPress={() => router.push("/auth")}
              style={{ marginTop: 4, alignSelf: "stretch" }}
            />
          </EmptyState>
        ) : boardQ.isLoading ? (
          <SkeletonList rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            title="No early finds yet this week"
            subtitle="Catch a brand before anyone else does to open your score."
          />
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => `${r.rank}-${r.handle}`}
            contentContainerStyle={{ paddingBottom: 32 }}
            refreshControl={
              <RefreshControl
                refreshing={boardQ.isRefetching}
                onRefresh={() => void boardQ.refetch()}
                tintColor={colors.fgMuted}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => <LeaderboardRowView row={item} />}
          />
        )}
      </ScreenFade>
    </SafeAreaView>
  );
}

function LeaderboardRowView({ row }: { row: LeaderboardRow }) {
  return (
    <View style={[styles.row, row.isYou && styles.rowYou]}>
      <Text style={[styles.rank, row.isYou && styles.rankYou]}>#{row.rank}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.handle, row.isYou && styles.handleYou]} numberOfLines={1}>
          {row.handle}
          {row.isYou ? "  ·  you" : ""}
        </Text>
      </View>
      <Text style={[styles.score, row.isYou && styles.scoreYou]}>{row.earlyFindScore}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
  cycleLabel: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "700",
    paddingHorizontal: 20,
    marginTop: 4,
  },
  subtitle: {
    color: colors.fgDim,
    fontSize: 12,
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 12,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowYou: {
    backgroundColor: `${colors.accentMuted}33`,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  rank: {
    color: colors.fgMuted,
    fontSize: 14,
    fontWeight: "700",
    width: 40,
  },
  rankYou: { color: colors.accent },
  handle: {
    color: colors.fg,
    fontSize: 15,
    fontWeight: "600",
  },
  handleYou: { color: colors.fg, fontWeight: "800" },
  score: {
    color: colors.fgMuted,
    fontSize: 15,
    fontWeight: "700",
  },
  scoreYou: { color: colors.accent },
});
