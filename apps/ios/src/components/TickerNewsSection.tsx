import { type MarketEvent, fetchMarketEvents } from "@/api/market-events";
import { type NewsItem, fetchTickerNews } from "@/api/news";
import { InAppReader } from "@/components/InAppReader";
import { neutralizeProviderMetadata, providerName } from "@/evidence/presentation";
import { colors, radii, type as typography } from "@/theme/tokens";
import { hapticTap } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Per-ticker "News & catalysts" feed for the detail screen.
 *
 * Two independent feeds render into one card:
 *   1. Corporate events (`/v1/market-events`) — splits, dividends and the TMX
 *      partner dataset — newest first, each labelled with its provider.
 *   2. Recent headlines (`/v1/news`) with source + relative time.
 * Each is tappable to open an in-app reader (Safari is an explicit fallback);
 * events are only tappable when the provider gave us a `sourceUrl`.
 *
 * The two live in separate queries on purpose: `/v1/market-events` answers 503
 * when the market-data provider is unconfigured and 502 on provider errors, and
 * neither of those may take the headlines down with it (nor the reverse). Empty
 * and loading states are handled inline so this component can be dropped in
 * without conditional wrappers upstream.
 *
 * The news endpoint already returns an empty `items` array on upstream failure,
 * so the "nothing to show" branch covers real outages too.
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

  const eventsQ = useQuery({
    queryKey: ["market-events", ticker.toUpperCase(), token ?? "anon"],
    enabled: !!ticker,
    // Corporate actions move on a calendar, not a news cycle — cache longer.
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: () => fetchMarketEvents(ticker, { token, limit: 8 }),
  });

  const items = useMemo<NewsItem[]>(() => q.data?.items ?? [], [q.data]);
  const events = useMemo<MarketEvent[]>(() => eventsQ.data?.events ?? [], [eventsQ.data]);
  const [reader, setReader] = useState<ReaderTarget | null>(null);

  const total = events.length + items.length;
  // Keep the existing news skeleton: spin while headlines load, unless events
  // have already landed — then show those rather than hiding them behind it.
  const showSkeleton = q.isLoading && events.length === 0;

  function open(target: ReaderTarget) {
    hapticTap();
    setReader(target);
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.h2}>News &amp; catalysts</Text>
      <View style={styles.card}>
        {showSkeleton ? (
          <ActivityIndicator color={colors.fg} />
        ) : total === 0 ? (
          <Text style={styles.muted}>
            {q.isError && eventsQ.isError
              ? "News unavailable."
              : "No recent headlines or corporate events."}
          </Text>
        ) : (
          <View style={styles.list}>
            {events.map((ev, idx) => {
              const href = ev.sourceUrl;
              return (
                <EventRow
                  key={ev.id ?? `${ev.provider ?? "event"}-${ev.date ?? "tbd"}-${idx}`}
                  event={ev}
                  isLast={idx === total - 1}
                  onOpen={
                    href
                      ? () =>
                          open({
                            url: href,
                            title: eventLabel(ev),
                            source: providerLabel(ev.provider),
                          })
                      : undefined
                  }
                />
              );
            })}
            {items.map((it, idx) => (
              <NewsRow
                key={`${it.url}-${idx}`}
                item={it}
                source={neutralizeProviderMetadata(it.source)}
                isLast={events.length + idx === total - 1}
                onOpen={() =>
                  open({
                    url: it.url,
                    title: it.title,
                    source: neutralizeProviderMetadata(it.source),
                  })
                }
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

/** What the in-app reader needs, shared by both row kinds. */
type ReaderTarget = { url: string; title?: string; source?: string };

function EventRow({
  event,
  isLast,
  onOpen,
}: {
  event: MarketEvent;
  isLast: boolean;
  /** Absent when the provider gave no `sourceUrl` — the row renders inert. */
  onOpen?: () => void;
}) {
  const label = eventLabel(event);
  const provider = providerLabel(event.provider);
  const when = formatEventDate(event.date);
  const status = event.status?.trim();

  const body = (
    <>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title} numberOfLines={3}>
          {label}
        </Text>
        <View style={styles.eventMeta}>
          <Text style={styles.meta}>{when}</Text>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{provider}</Text>
          </View>
          {status ? (
            <Text style={styles.meta} numberOfLines={1}>
              · {status}
            </Text>
          ) : null}
        </View>
      </View>
      {onOpen ? (
        <Ionicons
          name="open-outline"
          size={16}
          color={colors.fgMuted}
          style={{ marginTop: 2, marginLeft: 8 }}
        />
      ) : null}
    </>
  );

  const accessibilityLabel = `${label}, ${when}, ${provider}${status ? `, ${status}` : ""}`;

  if (!onOpen) {
    return (
      <View
        style={[styles.row, !isLast && styles.rowDivider]}
        accessible
        accessibilityLabel={accessibilityLabel}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.row,
        !isLast && styles.rowDivider,
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${accessibilityLabel}`}
    >
      {body}
    </Pressable>
  );
}

function NewsRow({
  item,
  source,
  isLast,
  onOpen,
}: {
  item: NewsItem;
  source: string;
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
      accessibilityLabel={`Read ${item.title} from ${source}`}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.title} numberOfLines={3}>
          {item.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {source} · {formatRelative(item.publishedAt)}
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

/** Headline for an event: the provider blurb, else a readable form of `type`. */
function eventLabel(event: MarketEvent): string {
  const description = event.description?.trim();
  if (description) return description;
  const words = event.type.replace(/_/g, " ").trim();
  if (!words) return "Corporate event";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function providerLabel(provider: MarketEvent["provider"]): string {
  return provider === "tmx" ? "TMX" : providerName(provider ?? "massive");
}

/**
 * `Mar 14` for the current year, `Mar 14, 2025` otherwise. Calendar days are
 * parsed as local dates — `new Date("2025-03-14")` is UTC midnight, which
 * renders as the 13th anywhere west of Greenwich.
 */
function formatEventDate(raw?: string): string {
  const d = parseEventDate(raw);
  if (!d) return "Date pending";
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", opts);
}

function parseEventDate(raw?: string): Date | null {
  const s = raw?.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const [, y, mo, day] = m ?? [];
  if (y && mo && day) return new Date(Number(y), Number(mo) - 1, Number(day));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
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
  eventMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSunken,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  pillText: { ...typography.caption, fontSize: 10, lineHeight: 13, color: colors.fgMuted },
  muted: { ...typography.body, color: colors.fgMuted },
});

export default TickerNewsSection;
