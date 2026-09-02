import type { PrismPacket } from "@/api/prism";
import { EntropyBacktestBars, EntropyGauge } from "@/chartkit/prism";
import { colors, space, type } from "@/theme/tokens";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { fmtCount, fmtNumber, fmtPct, humanize, sectionUnavailable } from "./format";
import { entropyPercentile, entropyTone } from "./signals";
import { KeyValueRow, SectionCard, SegmentedChips } from "./ui";

const WINDOW_ORDER = ["1m", "2m", "3m", "6m", "12m"] as const;

/**
 * Shannon entropy of the rolling return distribution, normalised to [0,1].
 * Low entropy means the distribution is concentrated — structure the model can
 * act on; high entropy means it is spread out — noise. The backtest below is
 * the only evidence that the distinction has ever paid.
 */
export function EntropySection({ packet }: { packet: PrismPacket }) {
  const entropy = packet.entropy;
  const unavailable = sectionUnavailable(packet, "entropy", entropy);
  const windows = entropy?.windows ?? {};
  const available = WINDOW_ORDER.filter((w) => windows[w]);
  const [selected, setSelected] = useState<(typeof WINDOW_ORDER)[number]>(available[0] ?? "3m");
  const active = available.includes(selected) ? selected : (available[0] ?? selected);
  const stat = windows[active] ?? null;

  return (
    <SectionCard
      eyebrow="Entropy"
      title="Structure versus noise"
      subtitle={`${fmtCount(entropy?.bins)} bins on a fixed quantile grid, normalised by log₂(bins).`}
      unavailable={unavailable}
      right={
        available.length > 1 ? (
          <SegmentedChips
            options={available}
            value={active}
            onChange={setSelected}
            labelOf={(w) => w.toUpperCase()}
          />
        ) : undefined
      }
    >
      <EntropyGauge
        value={typeof stat?.H === "number" ? stat.H : null}
        classification={stat?.classification ?? null}
        caption={captionFor(active, stat?.n, entropyPercentile(stat))}
      />

      {available.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.blockTitle}>All windows</Text>
          {available.map((window) => {
            const row = windows[window];
            return (
              <KeyValueRow
                key={window}
                label={window.toUpperCase()}
                value={`${fmtNumber(row?.H, 2)} · ${humanize(row?.classification, "—")}`}
                tone={entropyTone(row?.classification)}
              />
            );
          })}
        </View>
      ) : null}

      <Text style={styles.blockTitle}>Forward-return edge</Text>
      <EntropyBacktestBars backtest={entropy?.backtest ?? null} />
    </SectionCard>
  );
}

/**
 * An absolute H means little on its own — 0.88 is high for one ticker and
 * ordinary for another — so the gauge names where it sits in this ticker's own
 * history whenever the engine measured that. Older packets have no such figure
 * and the caption simply drops it.
 */
function captionFor(window: string, n: unknown, percentile: number | null): string {
  const parts = [`${window.toUpperCase()} window`, `${fmtCount(n)} observations`];
  if (percentile !== null) parts.push(`${fmtPct(percentile, 0)} of its own history`);
  return parts.join(" · ");
}

const styles = StyleSheet.create({
  blockTitle: { color: colors.fgMuted, ...type.label, marginTop: space.xs },
});
