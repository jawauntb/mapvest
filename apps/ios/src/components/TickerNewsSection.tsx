import { type NewsItem, fetchTickerNews } from "@/api/news";
import { InAppReader } from "@/components/InAppReader";
import { colors, radii, type as typography } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Per-ticker news feed for the detail screen.
 *
 * Renders up to 6 recent headlines with source + relative time, each
 * tappable to open an in-app reader (Safari is an explicit fallback).
 * Empty and loading states are handled inline so this
 * component can be dropped in without conditional wrappers upstream.
 *
 * The API endpoint (`/v1/news`) already returns an empty `items` array on
 * upstream failure, so the "no news" branch covers real outages too.
 */
export function TickerNewsSection({
  ticker,
  token,
  limit = 6,
}: {
  ticker: string;
  token?: string;
  limit?: number;
}) {
  const q = useQuery({
    queryKey: ["ticker-news", ticker.toUpperCase(), token ?? "anon", limit],
    enabled: !!ticker,
    // Server cache is 10 min; keep the client fresh for 5 min so a screen
    // revisit inside the same session reuses the response.
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: () => fetchTickerNews(ticker, { token, limit }),
  });

  const items = useMemo<NewsItem[]>(() => q.data?.items ?? [], [q.data]);
  const [reader, setReader] = useState<NewsItem | null>(null);

  return (
    <View style={styles.wrap}>
      <Text style={styles.h2}>News</Text>
      <View style={styles.card}>
        {q.isLoading ? (
          <ActivityIndicator color={colors.fg} />
        ) : q.isError ? (
          <Text style={styles.muted}>News unavailable.</Text>
        ) : items.length === 0 ? (
          <Text style={styles.muted}>No recent headlines for {ticker.toUpperCase()}.</Text>
        ) : (
          <View style={styles.list}>
            {items.map((it, idx) => (
              <NewsRow
                key={`${it.url}-${idx}`}
                item={it}
                isLast={idx === items.length - 1}
                onOpen={() => {
                  hapticTap();
                  setReader(it);
                }}
              />
            ))}
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

function NewsRow({
  item,
  isLast,
  onOpen,
}: {
  item: NewsItem;
  isLast: boolean;
  onOpen: () => void;
}) {
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.row,
        !isLast && styles.rowDivider,
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Read ${item.title} from ${item.source}`}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title} numberOfLines={3}>
          {item.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.source} · {formatRelative(item.publishedAt)}
        </Text>
      </View>
      <Ionicons
        name="book-outline"
        size={16}
        color={colors.fgMuted}
        style={{ marginTop: 2, marginLeft: 8 }}
      />
    </Pressable>
  );
}

/** Compact relative-time formatter — no external date library. */
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
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  h2: { ...typography.h2, color: colors.fg },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  list: { gap: 0 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { ...typography.body, color: colors.fg, fontWeight: "600" },
  meta: { ...typography.caption, color: colors.fgMuted, fontWeight: "500" },
  muted: { ...typography.body, color: colors.fgMuted },
});

export default TickerNewsSection;
