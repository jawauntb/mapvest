import { type WatchlistHeadline, fetchWatchlistHeadlines } from "@/api/news";
import { InAppReader } from "@/components/InAppReader";
import { MaterialOnlyToggle, MaterialityBadge } from "@/components/MaterialityBadge";
import { neutralizeProviderMetadata } from "@/evidence/presentation";
import { colors, radii, type as typography } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { hasAnyScored, isMaterialOrUnscored, materialityOf } from "@/util/materiality";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Headline feed for one watchlist (`GET /v1/watchlist/headlines`), newest
 * first across every ticker on the list, each row tagged with its ticker.
 *
 * Sits under Mapvest Daily on the watchlist detail page — the brief is the
 * column, this is the tape it was written from. Rows may carry a Jev
 * `jev_materiality` tag ("Material · 82%"); a "Material only" toggle appears
 * once anything is scored and filters client-side, always keeping unscored
 * rows so a Jev outage can never hide news. Loading, empty, and error states
 * are handled inline; the endpoint answers 200 with an empty list on a news
 * outage, so the empty branch covers that too.
 */
export function WatchlistHeadlinesCard({
  token,
  tickers,
  listId,
}: {
  token: string;
  tickers: string[];
  listId?: string;
}) {
  const fp = useMemo(
    () =>
      [...tickers]
        .map((t) => t.toUpperCase())
        .sort()
        .join(","),
    [tickers],
  );
  const q = useQuery({
    queryKey: ["watchlist-headlines", token, listId ?? "default", fp],
    enabled: tickers.length > 0,
    // Server caches per-ticker news ~10 min; the materiality memo is 15 min.
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => fetchWatchlistHeadlines({ token, ...(listId ? { listId } : {}) }),
  });

  const allItems = useMemo<WatchlistHeadline[]>(() => q.data?.items ?? [], [q.data]);
  const anyScored = useMemo(() => hasAnyScored(allItems), [allItems]);
  const [materialOnly, setMaterialOnly] = useState(false);
  const items = useMemo(
    () => (materialOnly && anyScored ? allItems.filter(isMaterialOrUnscored) : allItems),
    [allItems, materialOnly, anyScored],
  );
  const [reader, setReader] = useState<{ url: string; title: string; source: string } | null>(null);

  if (tickers.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.h2}>Headlines</Text>
        {anyScored ? <MaterialOnlyToggle value={materialOnly} onChange={setMaterialOnly} /> : null}
      </View>
      <View style={styles.card}>
        {q.isLoading ? (
          <ActivityIndicator color={colors.fg} />
        ) : items.length === 0 ? (
          <Text style={styles.muted}>
            {q.isError
              ? "Headlines unavailable."
              : materialOnly && allItems.length > 0
                ? "Nothing material right now."
                : "No recent headlines for this list."}
          </Text>
        ) : (
          <View>
            {items.map((it, idx) => {
              const source = neutralizeProviderMetadata(it.source);
              return (
                <Pressable
                  key={`${it.ticker}-${it.url}-${idx}`}
                  onPress={() => {
                    hapticTap();
                    setReader({ url: it.url, title: it.title, source });
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    idx < items.length - 1 && styles.rowDivider,
                    pressed && { opacity: 0.7 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Read ${it.title} about ${it.ticker} from ${source}`}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.title} numberOfLines={3}>
                      {it.title}
                    </Text>
                    <View style={styles.meta}>
                      <View style={styles.pill}>
                        <Text style={styles.pillText}>{it.ticker}</Text>
                      </View>
                      <Text style={styles.metaText} numberOfLines={1}>
                        {source} · {formatRelative(it.publishedAt)}
                      </Text>
                      <MaterialityBadge tag={materialityOf(it)} />
                    </View>
                  </View>
                  <Ionicons
                    name="book-outline"
                    size={16}
                    color={colors.fgMuted}
                    style={{ marginTop: 2, marginLeft: 8 }}
                  />
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      {reader ? (
        <InAppReader
          visible
          url={reader.url}
          title={reader.title}
          source={reader.source}
          onClose={() => setReader(null)}
        />
      ) : null}
    </View>
  );
}

/** Compact relative-time formatter, same as TickerNewsSection's. */
function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "recent";
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return "just now";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  h2: { ...typography.h2, color: colors.fg, flexShrink: 1 },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  row: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10 },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { ...typography.body, color: colors.fg, fontWeight: "600" },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  metaText: { ...typography.caption, color: colors.fgMuted, fontWeight: "500", flexShrink: 1 },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSunken,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  pillText: { ...typography.caption, fontSize: 10, lineHeight: 13, color: colors.fg },
  muted: { ...typography.body, color: colors.fgMuted },
});
