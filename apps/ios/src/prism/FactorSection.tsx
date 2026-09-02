import type { PrismPacket } from "@/api/prism";
import { FactorBars } from "@/chartkit/prism";
import { colors, space, type } from "@/theme/tokens";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  fmtCount,
  fmtDate,
  fmtNumber,
  fmtPct,
  fmtSignedPct,
  humanize,
  sectionUnavailable,
  toneForValue,
} from "./format";
import { factorFreshness, factorRows, factorWindowRange, factorWindows } from "./signals";
import { KeyValueRow, SectionCard, SegmentedChips, StatTile } from "./ui";

/**
 * Factor exposures from an OLS fit per window, with alpha and the residual.
 *
 * The residual block is what makes this actionable: cumulative residual return
 * over the last 20 and 60 days is the part of the move the factors do *not*
 * explain, and its z-score says whether that idiosyncratic run is unusual.
 */
export function FactorSection({ packet }: { packet: PrismPacket }) {
  const factors = packet.factors;
  const unavailable = sectionUnavailable(packet, "factors", factors);
  const windows = factorWindows(factors);
  const [selected, setSelected] = useState<string>(windows[0] ?? "1y");
  const active = windows.includes(selected) ? selected : (windows[0] ?? selected);
  const stats = factors?.windows?.[active] ?? null;
  const residuals = factors?.residuals ?? null;
  // The factor library is published on a lag — on the live NVDA packet the
  // betas end two months before the packet's own as-of date. A card that shows
  // exposures without saying when they stop reads as current positioning.
  const freshness = factorFreshness(factors);
  const range = factorWindowRange(factors, active);

  return (
    <SectionCard
      eyebrow="Factors"
      title="Exposures"
      subtitle={subtitleOf(factors?.model, freshness.asOf)}
      unavailable={unavailable}
      right={
        windows.length > 1 ? (
          <SegmentedChips
            options={windows}
            value={active}
            onChange={setSelected}
            labelOf={(w) => w.toUpperCase()}
          />
        ) : undefined
      }
    >
      {freshness.stale ? (
        <Text style={styles.stale}>
          Factor returns are {fmtCount(freshness.staleDays)} days behind this packet — these betas
          are fitted through {fmtDate(freshness.windowEnd ?? freshness.asOf)} and say nothing about
          the weeks since.
        </Text>
      ) : null}

      <FactorBars rows={factorRows(factors, active)} />

      {range.start || range.end ? (
        <Text style={styles.rangeNote}>
          {active.toUpperCase()} window · {fmtDate(range.start)} → {fmtDate(range.end)}
        </Text>
      ) : null}

      <View style={styles.tiles}>
        <StatTile
          label="Alpha (ann.)"
          value={fmtSignedPct(stats?.alpha_annual)}
          tone={toneForValue(stats?.alpha_annual)}
        />
        <StatTile label="R²" value={fmtPct(stats?.r2, 0)} />
        <StatTile
          label="Residual vol"
          value={fmtPct(stats?.residual_vol_annual, 0)}
          sub={
            stats?.n === null || stats?.n === undefined ? undefined : `${fmtCount(stats.n)} days`
          }
        />
      </View>

      {residuals ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>Unexplained move</Text>
          <KeyValueRow
            label="Residual, last 20 days"
            value={fmtSignedPct(residuals.last_20d_cum)}
            tone={toneForValue(residuals.last_20d_cum)}
          />
          <KeyValueRow
            label="Residual, last 60 days"
            value={fmtSignedPct(residuals.last_60d_cum)}
            tone={toneForValue(residuals.last_60d_cum)}
          />
          <KeyValueRow label="z-score" value={fmtNumber(residuals.z_score, 2)} />
        </View>
      ) : null}
    </SectionCard>
  );
}

/**
 * The factor card's own header line. `as of` is the last date in the factor
 * library, not the packet date, and the two differ by weeks — naming it here
 * is what stops a reader from reading the bars as today's exposure.
 */
function subtitleOf(model: string | null | undefined, asOf: string | null): string {
  const parts = [model ? humanize(model) : null, asOf ? `as of ${fmtDate(asOf)}` : null].filter(
    (v): v is string => v !== null,
  );
  return parts.length > 0
    ? `${parts.join(" · ")} · solid bars clear |t| ≥ 2.`
    : "Solid bars clear |t| ≥ 2.";
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: space.sm },
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
  // Amber, like the hero's stale-packet line: a caveat the reader has to see
  // before reading the bars, not a footnote under them.
  stale: { color: colors.warn, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  rangeNote: { color: colors.fgMuted, fontSize: 10.5, lineHeight: 15 },
});
