/**
 * SectorRing — composition chart for the List screen.
 *
 * Ships the "Option B" variant per the brief: a horizontal stacked bar
 * (visually a pill) rather than a true donut, because `react-native-svg`
 * is not installed and the pure-View half-circle hack makes reliable
 * per-segment tap targets brittle. Each colored segment is a Pressable
 * whose flex is proportional to its share of the total. Tap → selects,
 * showing a pill with the sector name, ticker count, and percentage.
 *
 * Height budget stays well under 120pt (bar 20 + gaps + one pill + one
 * legend row ≈ 96pt). Set `loading` to render a skeleton.
 */
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { sectorColor } from "@/util/sectors";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type SectorSegment = {
  sector: string;
  count: number;
  pct: number; // 0..1 share of the total
  color: string;
};

export type SectorRingProps = {
  segments: SectorSegment[];
  loading?: boolean;
  onSelect?: (sector: string | null) => void;
  selectedSector?: string | null;
};

const OTHER_LABEL = "Other";
const UNKNOWN_LABEL = "Unknown";

/**
 * Roll a raw sector-count map into at most `maxTop` named segments plus an
 * "Other" bucket. Sorted descending by count. Percentages sum to 1 within
 * float tolerance.
 */
export function buildSegments(counts: Record<string, number>, maxTop = 6): SectorSegment[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return [];

  const sorted = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const top = sorted.slice(0, maxTop);
  const rest = sorted.slice(maxTop);
  const restCount = rest.reduce((a, [, n]) => a + n, 0);

  const segs: SectorSegment[] = top.map(([sector, count]) => ({
    sector,
    count,
    pct: count / total,
    color: sectorColor(sector === UNKNOWN_LABEL ? undefined : sector),
  }));

  if (restCount > 0) {
    segs.push({
      sector: OTHER_LABEL,
      count: restCount,
      pct: restCount / total,
      color: colors.fgDim,
    });
  }

  return segs;
}

export function SectorRing({ segments, loading, onSelect, selectedSector }: SectorRingProps) {
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  // Support controlled and uncontrolled selection.
  const selected = selectedSector !== undefined ? selectedSector : localSelected;

  const total = useMemo(() => segments.reduce((a, s) => a + s.count, 0), [segments]);

  const selectedSeg = useMemo(
    () => segments.find((s) => s.sector === selected) ?? null,
    [segments, selected],
  );

  function toggle(sector: string) {
    const next = selected === sector ? null : sector;
    hapticSelect();
    if (selectedSector === undefined) setLocalSelected(next);
    onSelect?.(next);
  }

  if (loading) {
    return (
      <View style={styles.wrap}>
        <View style={[styles.bar, styles.skeleton]} />
        <View style={styles.legendRow}>
          <View style={[styles.legendSkeleton, { width: 90 }]} />
          <View style={[styles.legendSkeleton, { width: 70 }]} />
          <View style={[styles.legendSkeleton, { width: 80 }]} />
        </View>
      </View>
    );
  }

  if (segments.length === 0 || total === 0) return null;

  return (
    <View style={styles.wrap}>
      <View
        style={styles.bar}
        accessibilityRole="image"
        accessibilityLabel={`Sector composition of ${total} nearby brand${total === 1 ? "" : "s"}`}
      >
        {segments.map((s, i) => {
          const isSelected = selected === s.sector;
          const isDimmed = selected != null && !isSelected;
          return (
            <Pressable
              key={s.sector}
              onPress={() => toggle(s.sector)}
              // flex is percentage * 1000 to keep integer math and preserve
              // very small slices' proportional widths.
              style={{
                flex: Math.max(0.02, s.pct) * 1000,
                backgroundColor: s.color,
                opacity: isDimmed ? 0.35 : 1,
                borderLeftWidth: i === 0 ? 0 : 1,
                borderLeftColor: colors.bg,
              }}
              accessibilityRole="button"
              accessibilityLabel={`${s.sector}, ${s.count} of ${total}, ${(s.pct * 100).toFixed(1)} percent`}
              accessibilityState={{ selected: isSelected }}
            />
          );
        })}
      </View>

      {selectedSeg ? (
        <View style={styles.pill}>
          <View style={[styles.pillDot, { backgroundColor: selectedSeg.color }]} />
          <Text style={styles.pillText} numberOfLines={1}>
            {formatSector(selectedSeg.sector)}
            <Text style={styles.pillSep}>{"  ·  "}</Text>
            {selectedSeg.count} ticker{selectedSeg.count === 1 ? "" : "s"}
            <Text style={styles.pillSep}>{"  ·  "}</Text>
            {(selectedSeg.pct * 100).toFixed(1)}% of nearby
          </Text>
        </View>
      ) : (
        <View style={styles.pill}>
          <Text style={styles.pillTextMuted}>
            {total} brand{total === 1 ? "" : "s"} nearby · tap a slice
          </Text>
        </View>
      )}
    </View>
  );
}

function formatSector(s: string): string {
  if (!s) return UNKNOWN_LABEL;
  // Title-case single-word sectors that come lowercased from the API.
  return s
    .split(" ")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 4,
    gap: 8,
  },
  bar: {
    height: 20,
    borderRadius: radii.pill,
    overflow: "hidden",
    flexDirection: "row",
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  skeleton: {
    backgroundColor: colors.bgElevated,
    opacity: 0.6,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 22,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pillText: {
    color: colors.fg,
    ...type.caption,
    fontSize: 12,
    flexShrink: 1,
  },
  pillTextMuted: {
    color: colors.fgDim,
    ...type.caption,
    fontSize: 11,
  },
  pillSep: {
    color: colors.fgDim,
  },
  legendRow: {
    flexDirection: "row",
    gap: 8,
  },
  legendSkeleton: {
    height: 12,
    borderRadius: radii.sm,
    backgroundColor: colors.bgElevated,
    opacity: 0.6,
  },
});
