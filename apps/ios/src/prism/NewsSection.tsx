import type { PrismPacket } from "@/api/prism";
import { colors, radii, space, type } from "@/theme/tokens";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { humanize, relativeAge, sectionUnavailable } from "./format";
import { Chip, SectionCard } from "./ui";

const PAGE = 6;

/**
 * The news sweep behind the memo: company, industry, regulation, policy, and
 * forex items, each keeping its source link so a claim in the memo can be
 * traced to the story it came from.
 */
export function NewsSection({ packet }: { packet: PrismPacket }) {
  const news = packet.news;
  const unavailable = sectionUnavailable(packet, "news", news);
  const items = news?.items ?? [];
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, PAGE);

  return (
    <SectionCard
      eyebrow="News"
      title="What is being said"
      subtitle={`${items.length} item${items.length === 1 ? "" : "s"} across company, industry, policy, and macro.`}
      unavailable={unavailable}
    >
      {items.length === 0 ? (
        <Text style={styles.note}>The news sweep returned nothing for this ticker.</Text>
      ) : null}

      {shown.map((item, i) => {
        const url = typeof item.url === "string" && item.url.startsWith("http") ? item.url : null;
        const body = (
          <View style={styles.item}>
            <View style={styles.itemHead}>
              {item.category ? <Chip label={humanize(item.category)} tone="neutral" /> : null}
              <Text style={styles.meta} numberOfLines={1}>
                {[item.source, item.published ? relativeAge(item.published) : null]
                  .filter((v): v is string => !!v)
                  .join(" · ")}
              </Text>
              {url ? <Ionicons name="open-outline" size={13} color={colors.fgDim} /> : null}
            </View>
            <Text style={styles.title} numberOfLines={3}>
              {item.title ?? "Untitled"}
            </Text>
            {item.summary ? (
              <Text style={styles.summary} numberOfLines={4}>
                {item.summary}
              </Text>
            ) : null}
          </View>
        );
        const key = `${item.url ?? item.title ?? "item"}-${i}`;
        if (!url) return <View key={key}>{body}</View>;
        return (
          <Pressable
            key={key}
            onPress={() => {
              void Linking.openURL(url).catch(() => {});
            }}
            accessibilityRole="link"
            accessibilityLabel={`Open: ${item.title ?? "news item"}`}
            style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
          >
            {body}
          </Pressable>
        );
      })}

      {items.length > PAGE ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Show fewer news items" : "Show all news items"}
          style={({ pressed }) => [styles.more, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.moreText}>
            {expanded ? "Show fewer" : `Show all ${items.length}`}
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  item: {
    gap: 5,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  meta: { color: colors.fgMuted, fontSize: 10.5, flex: 1 },
  title: { color: colors.fg, fontSize: 13.5, fontWeight: "700", lineHeight: 19 },
  summary: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
  note: { color: colors.fgMuted, fontSize: 12, fontStyle: "italic" },
  more: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moreText: { color: colors.fgMuted, ...type.label },
});
