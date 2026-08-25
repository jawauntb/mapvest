import { BrandMark } from "@/components/BrandMark";
import { colors, fonts, radii } from "@/theme/tokens";
import type { UniverseShareCopy } from "@/util/universeShare";
import { forwardRef, useState } from "react";
import { StyleSheet, Text, View, type ViewProps } from "react-native";

/**
 * A summary-only 4:5 card for social sharing. It intentionally accepts the
 * preformatted share copy rather than a Find, so photos, places, coordinates,
 * and account details cannot enter the snapshot path accidentally.
 */
export type UniverseShareCardProps = {
  copy: UniverseShareCopy;
  onLayout?: ViewProps["onLayout"];
  onBrandMarkReady?: () => void;
};

const CARD_WIDTH = 360;
const CARD_HEIGHT = 450;

export const UniverseShareCard = forwardRef<View, UniverseShareCardProps>(
  function UniverseShareCard({ copy, onLayout, onBrandMarkReady }, ref) {
    const [brandMarkFailed, setBrandMarkFailed] = useState(false);

    return (
      <View ref={ref} collapsable={false} onLayout={onLayout} style={styles.card}>
        <View style={styles.header}>
          <View style={styles.brand}>
            {brandMarkFailed ? (
              <View accessible={false} style={styles.captureMark}>
                <View style={styles.capturePin} />
                <View style={styles.captureTape} />
              </View>
            ) : (
              <BrandMark
                size={24}
                onLoad={onBrandMarkReady}
                onError={() => {
                  // A bundled asset should not fail, but the view-only mark keeps
                  // capture usable if a platform cannot decode the PNG.
                  setBrandMarkFailed(true);
                  onBrandMarkReady?.();
                }}
              />
            )}
            <Text style={styles.wordmark}>Mapvest</Text>
          </View>
          <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
        </View>

        <View style={styles.copy}>
          <Text style={styles.headline}>{copy.headline}</Text>
          <Text style={styles.kicker}>HYPOTHETICAL · COUNTERFACTUAL</Text>
          <View style={styles.metricRow}>
            <Text style={styles.value}>{copy.value}</Text>
            <Text
              style={[
                styles.change,
                copy.changePositive === false
                  ? styles.changeDown
                  : copy.changePositive === null
                    ? styles.changeUnavailable
                    : null,
              ]}
            >
              {copy.change}
            </Text>
          </View>
          <Text style={styles.basis}>{copy.basis}</Text>
          <Text style={styles.coverage}>{copy.coverage}</Text>
          <Text style={styles.provenance}>{copy.provenance}</Text>
          <Text style={styles.disclaimer}>{copy.disclaimer}</Text>
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.footer}>{copy.footer}</Text>
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
  captureMark: {
    width: 24,
    height: 24,
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: "#0C0E10",
    position: "relative",
  },
  capturePin: {
    position: "absolute",
    left: 7,
    top: 3,
    width: 10,
    height: 13,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: colors.accent,
  },
  captureTape: {
    position: "absolute",
    left: 3,
    top: 16,
    width: 18,
    height: 2,
    backgroundColor: colors.fg,
    transform: [{ rotate: "-18deg" }],
  },
  wordmark: {
    color: colors.fg,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  copy: {
    flex: 1,
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },
  headline: {
    color: colors.fg,
    fontFamily: fonts.serif,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  kicker: {
    color: colors.fgDim,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
  },
  value: {
    color: colors.fg,
    fontFamily: fonts.serif,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  change: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: "800",
  },
  changeDown: {
    color: colors.danger,
  },
  changeUnavailable: {
    color: colors.fgDim,
  },
  basis: {
    color: colors.fgMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  coverage: {
    color: colors.fg,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
  },
  provenance: {
    color: colors.fgMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  disclaimer: {
    color: colors.fgDim,
    fontSize: 11,
    lineHeight: 16,
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
