import { fetchWeeklyQuests } from "@/api/quests";
import { colors, fonts, radii, type } from "@/theme/tokens";
import { formatCloseCountdown, msUntilClose } from "@/util/weeklyCycle";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Weekly quest card for the home screen. Shows quests for the current 7-day
 * cycle (Sunday–Saturday, closes Saturday 12:00 UTC), with progress per quest,
 * a countdown to close, and a reserved spot for the leaderboard chip.
 *
 * Mounted on home.tsx between DailyBriefCard and TopMoversCard; gated on
 * session?.token so guests see no weekly surface.
 */
export function WeeklyQuestCard({ token }: { token: string }) {
  const [countdown, setCountdown] = useState("Closes in — —");

  const weeklyQ = useQuery({
    queryKey: ["weekly-quests", token],
    queryFn: () => fetchWeeklyQuests({ token }),
    enabled: !!token,
    staleTime: 5 * 60_000, // 5 minutes
  });

  // Update countdown every minute
  useEffect(() => {
    if (!weeklyQ.data) return;
    const timer = setInterval(() => {
      setCountdown(formatCloseCountdown(msUntilClose()));
    }, 60_000);
    // Set initial countdown immediately
    setCountdown(formatCloseCountdown(msUntilClose()));
    return () => clearInterval(timer);
  }, [weeklyQ.data]);

  if (!weeklyQ.data) return null;

  const { cycleStart, cycleEnd, quests } = weeklyQ.data;
  const startDate = new Date(cycleStart);
  const endDate = new Date(cycleEnd);
  const startMonth = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const endMonth = endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const cycleLabel = `${startMonth} – ${endMonth}`;

  const completedCount = quests.filter((q) => q.completed).length;
  const totalXp = quests.reduce((sum, q) => sum + (q.completed ? q.xp : 0), 0);

  return (
    <View style={styles.card}>
      {/* Header with cycle window and chip spot */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cycleLabel}>{cycleLabel}</Text>
          <Text style={styles.countdown}>{countdown}</Text>
        </View>
        {/* Reserved for leaderboard "This week" chip — do not populate here */}
        <View style={styles.chipReserved} />
      </View>

      {/* Quest rows */}
      <View style={styles.questsContainer}>
        {quests.map((quest) => (
          <View key={quest.id} style={styles.questRow}>
            <View style={styles.questLeft}>
              <Text style={styles.questTitle}>{quest.title}</Text>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${(quest.progress / quest.target) * 100}%`,
                      backgroundColor: quest.completed ? colors.accent : colors.fgDim,
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {quest.progress}/{quest.target}
              </Text>
            </View>
            <View style={styles.questRight}>
              <Text style={styles.questXp}>{quest.xp} XP</Text>
              {quest.completed ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              ) : (
                <Ionicons name="ellipse-outline" size={20} color={colors.fgDim} />
              )}
            </View>
          </View>
        ))}
      </View>

      {/* Summary footer */}
      <View style={styles.footer}>
        <Text style={styles.summaryText}>
          {completedCount} of {quests.length} complete · {totalXp} XP earned this week
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  cycleLabel: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "700",
  },
  countdown: {
    color: colors.fgMuted,
    fontSize: 12,
    marginTop: 2,
    fontWeight: "500",
  },
  chipReserved: {
    width: 88,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  questsContainer: {
    gap: 0,
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  questRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  questLeft: {
    flex: 1,
    gap: 6,
  },
  questTitle: {
    color: colors.fg,
    fontSize: 13,
    fontWeight: "600",
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.bg,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
  },
  progressText: {
    color: colors.fgMuted,
    fontSize: 11,
    fontWeight: "500",
  },
  questRight: {
    alignItems: "center",
    gap: 8,
    marginLeft: 12,
  },
  questXp: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  summaryText: {
    color: colors.fgMuted,
    fontSize: 12,
    lineHeight: 16,
  },
});
