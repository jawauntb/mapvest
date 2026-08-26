import { fetchWatchlistBrief } from "@/api/client";
import { ChatAboutButton } from "@/components/ChatAboutButton";
import { RichText, stripMdMarks } from "@/components/RichText";
import { ShareButton } from "@/components/ShareButton";
import { openChatAbout } from "@/nav/chatAbout";
import { colors, fonts, radii } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { shareBriefText } from "@/util/share";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * "Mapvest Daily" — FT-style daily brief on a watchlist. Server generates once
 * per day per ticker set and caches, so repeat fetches are free.
 *
 * Shared between Home (default/selected list) and each watchlist detail page.
 * The brief is only fetched while this card is mounted, so a per-list brief is
 * lazy: nothing is generated for a list until the user actually opens its page.
 *
 * `listId` scopes the brief to that list; omitted → the user's default list.
 * The query key carries token + list scope + a ticker-set fingerprint, so
 * reassigning the default watchlist re-keys the home card and it refetches for
 * the new default's tickers automatically.
 */
export function DailyBriefCard({
  token,
  tickers,
  listId,
}: {
  token: string;
  tickers: string[];
  listId?: string;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  // Fingerprint the ticker set so the query key stays stable when the user
  // re-orders their watchlist but changes when they add/remove.
  const fp = useMemo(
    () =>
      [...tickers]
        .map((t) => t.toUpperCase())
        .sort()
        .join(","),
    [tickers],
  );
  const briefQ = useQuery<{ headline: string; body: string; generatedAt: string }>({
    queryKey: ["watchlist-brief", token, listId ?? "default", fp],
    queryFn: () => fetchWatchlistBrief({ token }, listId ? { listId } : {}),
    enabled: tickers.length > 0,
    staleTime: 6 * 60 * 60 * 1000, // 6h client cache; server refreshes daily
    // Retry ~3x with backoff so a cold-start LLM call or transient 5xx doesn't
    // leave a permanent "no brief" state — we want a brief every render.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
  if (tickers.length === 0) return null;

  // Determine what to show. Never say "add tickers" here — we already know
  // the user has tickers. If the fetch is in-flight OR errored OR returned
  // an empty payload, keep the loading skeleton up so the user sees "we're
  // generating your brief" rather than a wrong empty state.
  const hasBrief = briefQ.data?.headline && briefQ.data.body;
  const isWaiting = !hasBrief && (briefQ.isFetching || briefQ.isPending || briefQ.isError);

  return (
    <View style={styles.briefCard}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={styles.briefEyebrow}>
          Mapvest Daily ·{" "}
          {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {!collapsed && hasBrief ? (
            <>
              <ChatAboutButton
                onPress={() =>
                  openChatAbout(router, {
                    kind: "brief",
                    title: stripMdMarks(briefQ.data!.headline),
                    body: briefQ.data!.body,
                  })
                }
                accessibilityLabel="Chat about this brief"
              />
              <ShareButton
                onPress={() =>
                  void shareBriefText({
                    headline: stripMdMarks(briefQ.data!.headline),
                    body: briefQ.data!.body,
                  })
                }
                accessibilityLabel="Share daily brief"
              />
            </>
          ) : null}
          <Pressable
            onPress={() => {
              hapticSelect();
              setCollapsed((v) => !v);
            }}
            hitSlop={10}
            style={styles.collapseBtn}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? "Expand daily brief" : "Collapse daily brief"}
            accessibilityState={{ expanded: !collapsed }}
          >
            <Ionicons
              name={collapsed ? "chevron-down" : "chevron-up"}
              size={16}
              color={colors.fgMuted}
            />
          </Pressable>
        </View>
      </View>
      {collapsed ? null : hasBrief ? (
        <>
          <Text style={styles.briefHeadline}>{stripMdMarks(briefQ.data!.headline)}</Text>
          {/* RichText parses paragraphs + auto-links $TICKER mentions to
              the detail page. */}
          <RichText text={briefQ.data!.body} />
          <Text style={styles.briefFooter}>
            Written from your watchlist ·{" "}
            {new Date(briefQ.data!.generatedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            · research, not advice
          </Text>
        </>
      ) : isWaiting ? (
        <>
          <View style={styles.briefSkeleton} />
          <Text style={styles.briefFooter}>
            Writing your daily brief…
            {briefQ.isError ? " (retrying)" : ""}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  briefCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 8,
  },
  briefEyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  briefHeadline: {
    color: colors.fg,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    fontFamily: fonts.serif,
  },
  briefFooter: {
    color: colors.fgDim,
    fontSize: 11,
    marginTop: 4,
  },
  briefSkeleton: {
    height: 90,
    borderRadius: radii.md,
    backgroundColor: colors.bgSunken,
  },
  collapseBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
});
