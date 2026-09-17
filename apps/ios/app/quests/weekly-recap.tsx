import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, useEffect } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts, radii, type } from "@/theme/tokens";
import { AppTopBar } from "@/components/AppTopBar";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Weekly recap screen shown after a weekly-close notification. Displays:
 * - Quests completed this week
 * - Total XP earned
 * - Preview of next week's quests
 *
 * Navigated to via deep-link from weekly_close/weekly_completed push notifications.
 */
export default function WeeklyRecapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    completed?: string;
    xp?: string;
  }>();

  const completedQuestCount = parseInt(params.completed ?? "0", 10) || 0;
  const xpEarned = parseInt(params.xp ?? "0", 10) || 0;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <AppTopBar title="Weekly Recap" />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Hero card — week complete */}
        <View style={styles.hero}>
          <Ionicons name="checkmark-circle" size={64} color={colors.accent} />
          <Text style={styles.heroTitle}>This week's quests complete</Text>
          <Text style={styles.heroSub}>You earned {xpEarned} XP</Text>
        </View>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Quests completed</Text>
            <Text style={styles.summaryValue}>{completedQuestCount}</Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryRowLast]}>
            <Text style={styles.summaryLabel}>Total XP earned</Text>
            <Text style={styles.summaryValue}>{xpEarned}</Text>
          </View>
        </View>

        {/* Next week preview text */}
        <View style={styles.previewSection}>
          <Text style={styles.previewTitle}>Next week starts now</Text>
          <Text style={styles.previewText}>
            A fresh set of quests is waiting. Keep finding to complete them all before next
            Saturday at noon UTC.
          </Text>
        </View>

        {/* CTA button */}
        <Pressable
          onPress={() => {
            router.dismiss();
          }}
          style={({ pressed }) => [
            styles.ctaButton,
            pressed && { opacity: 0.8 },
          ]}
        >
          <Text style={styles.ctaText}>Back to home</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 20,
  },
  hero: {
    alignItems: "center",
    gap: 12,
    marginVertical: 16,
  },
  heroTitle: {
    color: colors.fg,
    fontSize: 20,
    fontWeight: "700",
    fontFamily: fonts.display,
  },
  heroSub: {
    color: colors.fgMuted,
    fontSize: 16,
  },
  summaryCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryRowLast: {
    borderBottomWidth: 0,
  },
  summaryLabel: {
    color: colors.fgMuted,
    fontSize: 13,
  },
  summaryValue: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: "700",
  },
  previewSection: {
    gap: 8,
    marginVertical: 8,
  },
  previewTitle: {
    color: colors.fg,
    fontSize: 14,
    fontWeight: "700",
  },
  previewText: {
    color: colors.fgMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  ctaButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 12,
  },
  ctaText: {
    color: colors.accentInk,
    fontSize: 14,
    fontWeight: "700",
  },
});
