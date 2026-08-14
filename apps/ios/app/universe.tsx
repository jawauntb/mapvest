/**
 * Your universe — the full finds journal. Every camera identify lands here,
 * grouped day by day. Home shows the 8 newest as a strip; this screen is the
 * whole record. Shares the ["finds", token] cache with Home.
 */
import { type Quote, fetchQuotesMap } from "@/api/client";
import { type Find, findStreakDays, listFinds } from "@/api/finds";
import { useSession } from "@/auth/session";
import { AppTopBar } from "@/components/AppTopBar";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenFade } from "@/components/ScreenFade";
import { SkeletonList } from "@/components/Skeleton";
import { colors, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Row =
  | { type: "header"; key: string; label: string }
  | { type: "find"; key: string; find: Find };

const CONFIDENCE_WORD: Record<Find["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function UniverseScreen() {
  const router = useRouter();
  const { session } = useSession();

  const findsQ = useQuery({
    queryKey: ["finds", session?.token],
    queryFn: () => listFinds({ token: session?.token }, 200),
    enabled: !!session?.token,
    staleTime: 60_000,
  });
  const finds = findsQ.data?.finds ?? [];
  const count = findsQ.data?.count ?? finds.length;
  const streak = findStreakDays(finds);

  const syms = useMemo(
    () =>
      [
        ...new Set(
          finds
            .map((f) => (f.ticker ?? f.comparable)?.toUpperCase())
            .filter((s): s is string => !!s),
        ),
      ].slice(0, 24),
    [finds],
  );
  const quotesQ = useQuery({
    queryKey: ["find-quotes", syms.join(",")],
    queryFn: () => fetchQuotesMap(syms, { token: session?.token }),
    enabled: syms.length > 0,
    staleTime: 60_000,
  });
  const quotes: Record<string, Quote> = quotesQ.data ?? {};

  // Flatten into one array of day-header + find rows so a single FlatList
  // renders the journal. A header is emitted whenever the calendar day
  // changes between consecutive (newest-first) finds.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay: string | null = null;
    for (const f of finds) {
      const day = new Date(f.createdAt).toDateString();
      if (day !== lastDay) {
        out.push({ type: "header", key: `day-${day}`, label: dayLabel(f.createdAt) });
        lastDay = day;
      }
      out.push({ type: "find", key: f.id, find: f });
    }
    return out;
  }, [finds]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ title: "Your universe", headerShown: false }} />
      <AppTopBar
        title="Your universe"
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
            icon="camera-outline"
            title="Sign in to keep your finds"
            subtitle="Everything you snap gets saved here — your universe of companies found in the wild."
          >
            <PrimaryButton
              label="Sign in"
              onPress={() => router.push("/auth")}
              style={{ marginTop: 4, alignSelf: "stretch" }}
            />
          </EmptyState>
        ) : findsQ.isLoading ? (
          <SkeletonList rows={6} />
        ) : finds.length === 0 ? (
          <EmptyState
            icon="sparkles-outline"
            title="Nothing found yet"
            subtitle="Snap a storefront or walk the map — every find lands here."
          >
            <PrimaryButton
              label="Find your first one"
              onPress={() => router.push("/(tabs)/camera?intent=snap")}
              style={{ marginTop: 4, alignSelf: "stretch" }}
            />
          </EmptyState>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            contentContainerStyle={{ paddingBottom: 32 }}
            ListHeaderComponent={
              <Text style={styles.summary}>
                {count} find{count === 1 ? "" : "s"}
                {streak >= 2 ? ` · ${streak} day streak` : ""}
              </Text>
            }
            renderItem={({ item }) =>
              item.type === "header" ? (
                <Text style={styles.dayHeader}>{item.label}</Text>
              ) : (
                <FindRow
                  find={item.find}
                  quote={quotes[(item.find.ticker ?? item.find.comparable ?? "").toUpperCase()]}
                  onPress={() => {
                    hapticSelect();
                    router.push(
                      `/detail/${encodeURIComponent(
                        item.find.ticker ?? item.find.comparable ?? item.find.brand,
                      )}`,
                    );
                  }}
                />
              )
            }
          />
        )}
      </ScreenFade>
    </SafeAreaView>
  );
}

function FindRow({
  find,
  quote,
  onPress,
}: {
  find: Find;
  quote?: Quote;
  onPress: () => void;
}) {
  const delta =
    find.foundPrice && quote
      ? ((quote.price - find.foundPrice) / find.foundPrice) * 100
      : undefined;
  const headline = find.ticker ?? (find.comparable ? `≈${find.comparable}` : find.brand);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${find.brand}`}
    >
      <View style={styles.rowBadge}>
        <Ionicons name="camera" size={14} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowHeadline} numberOfLines={1}>
          {headline}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {find.brand} · {CONFIDENCE_WORD[find.confidence]}
        </Text>
      </View>
      {delta !== undefined ? (
        <Text style={[styles.rowDelta, { color: delta >= 0 ? colors.accent : colors.danger }]}>
          {delta >= 0 ? "+" : ""}
          {delta.toFixed(1)}%
        </Text>
      ) : null}
    </Pressable>
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
  summary: {
    color: colors.fgMuted,
    fontSize: 13,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  dayHeader: {
    color: colors.fgMuted,
    ...type.label,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    minHeight: 56,
  },
  rowBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  rowHeadline: { color: colors.fg, fontSize: 15, fontWeight: "600" },
  rowSub: { color: colors.fgMuted, fontSize: 12, marginTop: 2 },
  rowDelta: { fontSize: 13, fontWeight: "700" },
});
