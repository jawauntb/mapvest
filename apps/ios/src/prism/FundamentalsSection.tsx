import type { PrismPacket, PrismQuarter } from "@/api/prism";
import { PrismSparkline } from "@/chartkit/prism";
import { colors, space, type } from "@/theme/tokens";
import { StyleSheet, Text, View } from "react-native";
import {
  fmtMoneyCompact,
  fmtMultiple,
  fmtPct,
  fmtSignedPct,
  humanize,
  sectionUnavailable,
  toneForValue,
} from "./format";
import { quarterSeries, seriesGrowth } from "./signals";
import { Chip, KeyValueRow, SectionCard } from "./ui";

const SPARKS: ReadonlyArray<{ field: keyof PrismQuarter; label: string }> = [
  { field: "revenue", label: "Revenue" },
  { field: "operating_income", label: "Operating income" },
  { field: "net_income", label: "Net income" },
  { field: "fcf", label: "Free cash flow" },
];

const RATIO_LABELS: Readonly<Record<string, string>> = {
  pe: "P/E",
  ps: "P/S",
  pb: "P/B",
  ev_ebitda: "EV/EBITDA",
  ev_ebit: "EV/EBIT",
  ev_sales: "EV/Sales",
  debt_to_equity: "Debt/Equity",
  fcf_yield: "FCF yield",
  dividend_yield: "Dividend yield",
  nav_per_share: "NAV/share",
};

const YIELD_RATIOS = new Set(["fcf_yield", "dividend_yield"]);

/**
 * Eight quarters of the income and cash statements, the derived multiples, and
 * the engine's stage call.
 *
 * Sparklines carry the shape and the year-over-year number carries the fact —
 * a four-quarter lag is a real YoY comparison, which is why growth is null
 * until there are five quarters to compare.
 */
export function FundamentalsSection({ packet }: { packet: PrismPacket }) {
  const fundamentals = packet.fundamentals;
  const unavailable = sectionUnavailable(packet, "fundamentals", fundamentals);
  const quarters = fundamentals?.quarters ?? [];
  const ratios = fundamentals?.ratios ?? {};
  const stage = fundamentals?.stage ?? null;

  return (
    <SectionCard
      eyebrow="Fundamentals"
      title="The business"
      subtitle={`${quarters.length} quarters from the filings and the financials API.`}
      unavailable={unavailable}
      right={stage?.label ? <Chip label={humanize(stage.label)} tone="neutral" /> : undefined}
    >
      <View style={styles.sparkGrid}>
        {SPARKS.map(({ field, label }) => {
          const series = quarterSeries(quarters, field);
          if (series.values.length < 2) return null;
          const yoy = seriesGrowth(series.values, 4);
          return (
            <View key={String(field)} style={styles.sparkCell}>
              <Text style={styles.sparkLabel}>{label.toUpperCase()}</Text>
              <Text style={styles.sparkValue}>{fmtMoneyCompact(series.latest)}</Text>
              <PrismSparkline values={series.values} height={38} />
              <Text
                style={[
                  styles.sparkDelta,
                  {
                    color: yoy === null ? colors.fgMuted : yoy >= 0 ? colors.accent : colors.danger,
                  },
                ]}
              >
                {yoy === null ? "YoY unavailable" : `${fmtSignedPct(yoy)} YoY`}
              </Text>
            </View>
          );
        })}
      </View>

      {Object.keys(ratios).length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>Multiples</Text>
          {Object.entries(RATIO_LABELS).map(([key, label]) => {
            const value = ratios[key];
            if (typeof value !== "number" || !Number.isFinite(value)) return null;
            return (
              <KeyValueRow
                key={key}
                label={label}
                value={YIELD_RATIOS.has(key) ? fmtPct(value, 2) : fmtMultiple(value)}
              />
            );
          })}
        </View>
      ) : null}

      {stage?.evidence && stage.evidence.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.blockTitle}>Why {humanize(stage.label).toLowerCase()}</Text>
          {stage.evidence.map((line) => (
            <Text key={line} style={styles.evidence}>
              · {line}
            </Text>
          ))}
        </View>
      ) : null}

      {fundamentals?.growth ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>Growth</Text>
          {Object.entries(fundamentals.growth).map(([key, value]) => (
            <KeyValueRow
              key={key}
              label={humanize(key)}
              value={typeof value === "number" ? fmtSignedPct(value) : humanize(value)}
              tone={typeof value === "number" ? toneForValue(value) : "neutral"}
            />
          ))}
        </View>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  sparkGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  sparkCell: {
    flexGrow: 1,
    flexBasis: "46%",
    gap: 4,
  },
  sparkLabel: { color: colors.fgMuted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  sparkValue: { color: colors.fg, fontSize: 15, fontWeight: "700" },
  sparkDelta: { fontSize: 11, fontWeight: "600" },
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
  evidence: { color: colors.fgMuted, fontSize: 12.5, lineHeight: 18 },
});
