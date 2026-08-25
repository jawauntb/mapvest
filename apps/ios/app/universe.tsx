/**
 * Your universe — the full finds journal. Every camera identify lands here,
 * grouped day by day. Home shows the 8 newest as a strip; this screen is the
 * whole record. Shares the ["finds", token] cache with Home.
 */
import {
  type DexRarity,
  type DexRarityCounts,
  type DexSector,
  type Quest,
  type Quote,
  type UniverseSummary,
  type UserProgress,
  fetchDex,
  fetchProgress,
  fetchQuests,
  fetchQuotesMap,
  fetchUniverseSummary,
} from "@/api/client";
import {
  EVOLUTION_TIER_COLORS,
  EVOLUTION_TIER_LABELS,
  type Find,
  changeSinceFoundPct,
  evolutionTierForChange,
  listFinds,
  resolveStreakDays,
} from "@/api/finds";
import { useSession } from "@/auth/session";
import { AppTopBar } from "@/components/AppTopBar";
import { EmptyState } from "@/components/EmptyState";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenFade } from "@/components/ScreenFade";
import { ShareButton } from "@/components/ShareButton";
import { SkeletonList } from "@/components/Skeleton";
import { UniverseShareCard } from "@/components/UniverseShareCard";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { sectorColor } from "@/util/sectors";
import { shareBriefImage } from "@/util/share";
import { canStartShareAttempt, isShareCardReady } from "@/util/shareReadiness";
import { universeShareCopy } from "@/util/universeShare";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
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

/** Whole dollars once we're past $1,000 — the counterfactual line is a headline, not a statement. */
function money(n: number): string {
  const decimals = Math.abs(n) < 1000 ? 2 : 0;
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** "Lv 3 · 240 XP" — compact, and only when the progression store answered. */
function levelLine(progress: UserProgress | undefined): string | null {
  if (!progress) return null;
  const xp = progress.xp >= 10_000 ? `${(progress.xp / 1000).toFixed(1)}k` : `${progress.xp}`;
  return `Lv ${progress.level} · ${xp} XP`;
}

const RARITY_ORDER: DexRarity[] = ["common", "uncommon", "rare", "legendary"];

const RARITY_LABELS: Record<DexRarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  legendary: "Legendary",
};

/** Rarity ink climbs toward the accent — legendary is the loudest thing here. */
const RARITY_COLORS: Record<DexRarity, string> = {
  common: colors.fgDim,
  uncommon: colors.fgMuted,
  rare: colors.accent2,
  legendary: colors.warn,
};

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

  // Progression / counterfactual / dex all fail soft: `retry: false` and we
  // only ever read `.data`, so a 404 (server slice not deployed yet) leaves
  // the journal rendering exactly as it did before these endpoints existed.
  const progressQ = useQuery({
    queryKey: ["progress", session?.token],
    queryFn: () => fetchProgress({ token: session?.token }),
    enabled: !!session?.token,
    staleTime: 60_000,
    retry: false,
  });
  const streak = resolveStreakDays(progressQ.data?.progress.streakDays, finds);
  const levelText = levelLine(progressQ.data?.progress);

  const summaryQ = useQuery({
    queryKey: ["universe-summary", session?.token],
    queryFn: () => fetchUniverseSummary({ token: session?.token }),
    enabled: !!session?.token,
    staleTime: 60_000,
    retry: false,
  });
  const summary: UniverseSummary | undefined = summaryQ.data;
  const shareCopy = summary ? universeShareCopy(summary) : undefined;
  const shareCardRef = useRef<View>(null);
  const sharingRef = useRef(false);
  const [isSharing, setIsSharing] = useState(false);
  const shareCardKey = shareCopy?.message ?? null;
  const [shareCardLayoutKey, setShareCardLayoutKey] = useState<string | null>(null);
  const [shareBrandMarkKey, setShareBrandMarkKey] = useState<string | null>(null);
  const shareCardReady =
    shareCardKey !== null &&
    isShareCardReady({
      laidOut: shareCardLayoutKey === shareCardKey,
      brandMarkLoaded: shareBrandMarkKey === shareCardKey,
    });

  const markShareCardLaidOut = useCallback(() => {
    if (shareCardKey) setShareCardLayoutKey(shareCardKey);
  }, [shareCardKey]);

  const markBrandMarkReady = useCallback(() => {
    if (shareCardKey) setShareBrandMarkKey(shareCardKey);
  }, [shareCardKey]);

  async function shareUniverse() {
    if (
      !summary ||
      !shareCopy ||
      !canStartShareAttempt({ ready: shareCardReady, inFlight: sharingRef.current })
    ) {
      return;
    }
    sharingRef.current = true;
    setIsSharing(true);
    try {
      await shareBriefImage(shareCardRef, "mapvest-universe.png", shareCopy.message);
    } finally {
      sharingRef.current = false;
      setIsSharing(false);
    }
  }

  const dexQ = useQuery({
    queryKey: ["dex", session?.token],
    queryFn: () => fetchDex({ token: session?.token }),
    enabled: !!session?.token,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const dexSectors = useMemo(
    () => (dexQ.data?.sectors ?? []).filter((s) => s.found > 0 && s.total > 0),
    [dexQ.data],
  );
  // `rarityCounts` shipped after the first /v1/dex slice, so a server that
  // predates it answers 200 without the field — read every count defensively.
  const rarityCounts = dexQ.data?.rarityCounts;

  const questsQ = useQuery({
    queryKey: ["quests", session?.token],
    queryFn: () => fetchQuests({ token: session?.token }),
    enabled: !!session?.token,
    staleTime: 60_000,
    retry: false,
  });
  const quests = questsQ.data?.quests ?? [];

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
              <View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summary}>
                    {count} find{count === 1 ? "" : "s"}
                    {streak >= 2 ? ` · ${streak} day streak` : ""}
                  </Text>
                  {/* Progression is cosmetic chrome — it appears only once the
                      store answers, and its absence changes nothing else. */}
                  {levelText ? (
                    <Text style={styles.levelPill} accessibilityLabel={levelText}>
                      {levelText}
                    </Text>
                  ) : null}
                </View>
                {/* Counterfactual portfolio — hypothetical, and only ever drawn
                    from finds the server could actually value. */}
                {summary && summary.valuedFinds > 0 && shareCopy ? (
                  <View style={styles.counterfactual}>
                    <View style={styles.cfHead}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cfLine}>
                          <Text style={styles.cfLabel}>{shareCopy.basis} → worth </Text>
                          <Text style={styles.cfValue}>{money(summary.hypotheticalValue)}</Text>
                          <Text
                            style={[
                              styles.cfDelta,
                              {
                                color: summary.changePct >= 0 ? colors.accent : colors.danger,
                              },
                            ]}
                          >
                            {"  "}
                            {summary.changePct >= 0 ? "+" : ""}
                            {summary.changePct.toFixed(1)}%
                          </Text>
                        </Text>
                        <Text style={styles.cfFoot}>
                          Hypothetical · {summary.valuedFinds} of {summary.findCount} find
                          {summary.findCount === 1 ? "" : "s"} priced when found
                        </Text>
                        <Text style={styles.cfProvenance}>{shareCopy.provenance}</Text>
                      </View>
                      <ShareButton
                        label={isSharing || !shareCardReady ? "Preparing…" : "Share"}
                        accessibilityLabel={
                          isSharing || !shareCardReady
                            ? "Preparing universe share"
                            : "Share your universe"
                        }
                        busy={isSharing || !shareCardReady}
                        disabled={!shareCardReady}
                        onPress={shareUniverse}
                      />
                    </View>
                    {/* Kept mounted off-screen so view-shot can capture a stable
                        4:5 card without exposing private Find records. */}
                    <View
                      key={shareCardKey}
                      style={styles.shareCardCapture}
                      pointerEvents="none"
                      accessible={false}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <UniverseShareCard
                        ref={shareCardRef}
                        copy={shareCopy}
                        onLayout={markShareCardLaidOut}
                        onBrandMarkReady={markBrandMarkReady}
                      />
                    </View>
                  </View>
                ) : null}
                <DexStrip sectors={dexSectors} />
                <RarityRow counts={rarityCounts} />
                <QuestsCard quests={quests} xpGrantedToday={questsQ.data?.xpGrantedToday ?? 0} />
              </View>
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

/**
 * Compact sector-completion strip (Universe Roadmap A4). SectorRing draws a
 * share-of-total composition bar, which answers a different question than
 * "how much of this sector have I caught" — so this is its own row of chips,
 * borrowing the same per-sector palette. Renders nothing until /v1/dex answers
 * with at least one sector the user has actually caught something in.
 */
function DexStrip({ sectors }: { sectors: DexSector[] }) {
  if (sectors.length === 0) return null;
  return (
    <FlatList
      data={sectors}
      keyExtractor={(s) => s.sector}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.dexRow}
      renderItem={({ item }) => {
        const pct = Math.max(0, Math.min(1, item.found / item.total));
        const tint = sectorColor(item.sector);
        return (
          <View
            style={styles.dexChip}
            accessibilityRole="text"
            accessibilityLabel={`${item.sector}, ${item.found} of ${item.total} found`}
          >
            <Text style={styles.dexSector} numberOfLines={1}>
              {item.sector}
            </Text>
            <Text style={styles.dexCount}>
              {item.found}/{item.total}
            </Text>
            <View style={styles.dexTrack}>
              <View
                style={[styles.dexFill, { backgroundColor: tint, flex: Math.max(0.02, pct) }]}
              />
              <View style={{ flex: Math.max(0.02, 1 - pct) }} />
            </View>
          </View>
        );
      }}
    />
  );
}

/**
 * Rarity histogram (roadmap A4) — how the caught set breaks down across
 * common/uncommon/rare/legendary. Sits with the dex strip because it answers
 * the other half of "what have I collected". Renders nothing until /v1/dex
 * answers with the field (older servers omit it) and at least one find is
 * classified.
 */
function RarityRow({ counts }: { counts?: DexRarityCounts }) {
  const total = RARITY_ORDER.reduce((n, key) => n + (counts?.[key] ?? 0), 0);
  if (total === 0) return null;
  return (
    <View style={styles.rarityRow}>
      {RARITY_ORDER.map((key) => {
        const n = counts?.[key] ?? 0;
        return (
          <View
            key={key}
            style={styles.rarityChip}
            accessibilityRole="text"
            accessibilityLabel={`${n} ${RARITY_LABELS[key]}`}
          >
            <View style={[styles.rarityDot, { backgroundColor: RARITY_COLORS[key] }]} />
            <Text style={styles.rarityCount}>{n}</Text>
            <Text style={styles.rarityLabel} numberOfLines={1}>
              {RARITY_LABELS[key]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Today's quests (roadmap A5). Completion is decided server-side from the find
 * stream — this card only renders `progress`/`target`/`completed` as returned,
 * and it disappears entirely when /v1/quests 404s.
 */
function QuestsCard({ quests, xpGrantedToday }: { quests: Quest[]; xpGrantedToday: number }) {
  if (quests.length === 0) return null;
  return (
    <View style={styles.questCard}>
      <View style={styles.questHead}>
        <Ionicons name="flag-outline" size={13} color={colors.accent} />
        <Text style={styles.questTitle}>Today's quests</Text>
        {xpGrantedToday > 0 ? (
          <Text style={styles.questXpToday}>+{xpGrantedToday} XP today</Text>
        ) : null}
      </View>
      {quests.map((quest) => {
        const target = quest.target > 0 ? quest.target : 1;
        const pct = Math.max(0, Math.min(1, quest.progress / target));
        return (
          <View
            key={quest.id}
            style={styles.questRow}
            accessibilityRole="text"
            accessibilityLabel={`${quest.title}. ${
              quest.completed
                ? `Complete, ${quest.xp} XP`
                : `${quest.progress} of ${quest.target}, ${quest.xp} XP`
            }`}
          >
            <Ionicons
              name={quest.completed ? "checkmark-circle" : "ellipse-outline"}
              size={15}
              color={quest.completed ? colors.accent : colors.fgDim}
            />
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.questLabel, quest.completed && styles.questLabelDone]}
                numberOfLines={1}
              >
                {quest.title}
              </Text>
              {!quest.completed && quest.target > 1 ? (
                <View style={styles.questTrack}>
                  <View style={[styles.questFill, { flex: Math.max(0.02, pct) }]} />
                  <View style={{ flex: Math.max(0.02, 1 - pct) }} />
                </View>
              ) : null}
            </View>
            <Text style={[styles.questXp, quest.completed && { color: colors.accent }]}>
              {quest.completed ? `+${quest.xp}` : `${quest.progress}/${quest.target}`}
            </Text>
          </View>
        );
      })}
    </View>
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
  const delta = changeSinceFoundPct(find, quote?.price);
  // Evolution tier (roadmap A2) — a hairline ring on the find's badge. A
  // collection event, not a buy signal: no copy changes with the tier.
  const tier = evolutionTierForChange(delta);
  const headline = find.ticker ?? (find.comparable ? `≈${find.comparable}` : find.brand);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${find.brand}${tier ? ` — ${EVOLUTION_TIER_LABELS[tier]} evolution` : ""}`}
    >
      <View
        style={[
          styles.rowBadge,
          tier ? { borderColor: EVOLUTION_TIER_COLORS[tier], borderWidth: 2 } : null,
        ]}
      >
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
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  summary: {
    color: colors.fgMuted,
    fontSize: 13,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  levelPill: {
    color: colors.accent,
    ...type.caption,
    marginRight: 16,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
  },
  counterfactual: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  cfHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cfLine: { color: colors.fg },
  cfLabel: { color: colors.fgMuted, fontSize: 14 },
  cfValue: { color: colors.fg, fontSize: 18, fontWeight: "800" },
  cfDelta: { fontSize: 13, fontWeight: "700" },
  cfFoot: { color: colors.fgDim, fontSize: 11, marginTop: 2 },
  cfProvenance: { color: colors.fgDim, fontSize: 10, lineHeight: 14, marginTop: 2 },
  shareCardCapture: {
    position: "absolute",
    left: -10_000,
    top: 0,
  },
  dexRow: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
    gap: 8,
  },
  dexChip: {
    minWidth: 104,
    maxWidth: 150,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 3,
  },
  dexSector: { color: colors.fgMuted, ...type.caption, fontSize: 10 },
  dexCount: { color: colors.fg, fontSize: 14, fontWeight: "800" },
  dexTrack: {
    flexDirection: "row",
    height: 3,
    borderRadius: radii.pill,
    overflow: "hidden",
    backgroundColor: colors.bgSunken,
    marginTop: 2,
  },
  dexFill: { height: 3 },
  rarityRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  rarityChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  rarityDot: { width: 6, height: 6, borderRadius: 3 },
  rarityCount: { color: colors.fg, fontSize: 12, fontWeight: "800" },
  rarityLabel: { color: colors.fgDim, fontSize: 9, flexShrink: 1 },
  questCard: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 6,
  },
  questHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  questTitle: { color: colors.fgMuted, ...type.caption, flex: 1 },
  questXpToday: { color: colors.accent, ...type.caption },
  questRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  questLabel: { color: colors.fg, fontSize: 13 },
  questLabelDone: { color: colors.fgMuted },
  questTrack: {
    flexDirection: "row",
    height: 3,
    borderRadius: radii.pill,
    overflow: "hidden",
    backgroundColor: colors.bgSunken,
    marginTop: 4,
  },
  questFill: { height: 3, backgroundColor: colors.accent },
  questXp: { color: colors.fgDim, fontSize: 11, fontWeight: "700" },
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
