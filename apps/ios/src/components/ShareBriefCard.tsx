import { BrandMark } from "@/components/BrandMark";
import { colors, radii } from "@/theme/tokens";
import { forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Self-contained brand-styled card designed for view-shot capture into a
 * 4:5 social-friendly PNG (~1080×1350 aspect). Rendered off-screen when
 * we want to snapshot it — kept lightweight (no images, no data fetching)
 * so it renders synchronously.
 *
 * Fixed content width (via aspectRatio) so the snapshot looks the same on
 * every device — otherwise a wide iPad would produce a different-shaped PNG
 * than an iPhone SE. Callers wrap it in an off-screen View so it doesn't
 * take space on the actual screen.
 */

export type ShareBriefCardProps = {
  headline: string;
  body: string;
  /** Optional ticker — renders as "$AAPL · Mapvest Daily" eyebrow. */
  ticker?: string;
  /** ISO string or Date — defaults to now. */
  generatedAt?: string | Date;
  /** Override the small bottom-right footer. */
  footer?: string;
};

// 4:5 (1080x1350) is Instagram/Twitter friendly. We render at a modest RN
// width (360) so the layout math is stable, then view-shot scales it up.
const CARD_WIDTH = 360;
const CARD_HEIGHT = 450; // 360 * (1350/1080)

function formatDate(d?: string | Date): string {
  const date = d ? new Date(d) : new Date();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const ShareBriefCard = forwardRef<View, ShareBriefCardProps>(
  function ShareBriefCard({ headline, body, ticker, generatedAt, footer }, ref) {
    const dateStr = formatDate(generatedAt);
    return (
      <View ref={ref} collapsable={false} style={styles.card}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <BrandMark size={22} />
            <Text style={styles.wordmark}>Mapvest</Text>
          </View>
          <Text style={styles.eyebrow}>
            {ticker ? `$${ticker.replace(/^\$/, "").toUpperCase()} · ` : ""}
            Mapvest Daily
          </Text>
        </View>

        {/* Body — serif for editorial voice, matches home.tsx briefHeadline */}
        <View style={styles.copy}>
          <Text style={styles.headline}>{headline}</Text>
          <Text style={styles.body}>{body}</Text>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.footer}>{footer ?? `mapvest.co · ${dateStr}`}</Text>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    justifyContent: "space-between",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  wordmark: {
    color: colors.fg,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  copy: {
    flex: 1,
    justifyContent: "center",
    gap: 12,
    paddingVertical: 16,
  },
  headline: {
    color: colors.fg,
    fontFamily: "Georgia",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  body: {
    color: colors.fgMuted,
    fontFamily: "Georgia",
    fontSize: 15,
    lineHeight: 22,
  },
  footerRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  footer: {
    color: colors.fgDim,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
