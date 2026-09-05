import { colors, radii, space, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, createContext, useContext, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { SITUATE_DIM } from "./constants";
import { type Tone, unavailableCopy } from "./format";

/** Tone → the two colors every chip, meter, and value readout uses. */
export function toneFg(tone: Tone): string {
  return tone === "bull" ? colors.accent : tone === "bear" ? colors.danger : colors.fgMuted;
}

export function toneBg(tone: Tone): string {
  return tone === "bull"
    ? "rgba(20, 196, 166, 0.14)"
    : tone === "bear"
      ? "rgba(232, 93, 93, 0.14)"
      : "rgba(139, 147, 156, 0.12)";
}

/**
 * The card every Situate section lives in.
 *
 * `unavailable` is the whole contract for a `null` section: the card still
 * renders — same heading, same place in the page — and says in words why the
 * engine had nothing. A section is never silently missing and never shows an
 * empty chart.
 */
export function SectionCard({
  eyebrow,
  title,
  subtitle,
  right,
  unavailable,
  children,
  style,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  /** Non-null renders the "unavailable: reason" body instead of `children`. */
  unavailable?: string | null;
  children?: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1, gap: 2 }}>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {unavailable ? (
        <Text style={styles.unavailable}>{unavailableCopy(unavailable)}</Text>
      ) : (
        children
      )}
    </View>
  );
}

/** Small labelled value tile — the unit of every stat grid on this screen. */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  flex = 1,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  flex?: number;
}) {
  return (
    <View style={[styles.tile, { flexGrow: flex, flexBasis: 0 }]}>
      <Text style={styles.tileLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.tileValue, { color: tone === "neutral" ? colors.fg : toneFg(tone) }]}>
        {value}
      </Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  tone = "neutral",
  solid = false,
}: {
  label: string;
  tone?: Tone;
  solid?: boolean;
}) {
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: solid ? toneFg(tone) : toneBg(tone), borderColor: toneFg(tone) },
      ]}
    >
      <Text style={[styles.chipText, { color: solid ? colors.accentInk : toneFg(tone) }]}>
        {label}
      </Text>
    </View>
  );
}

/** Horizontal 0..1 meter. Used for conviction, probabilities, and shares. */
export function Meter({
  value,
  tone = "bull",
  height = 8,
  track = colors.bgSunken,
}: {
  value: number;
  tone?: Tone;
  height?: number;
  track?: string;
}) {
  const pct = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <View style={[styles.meterTrack, { height, backgroundColor: track, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${pct * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: toneFg(tone),
        }}
      />
    </View>
  );
}

/** Label / value row for dense readouts. */
export function KeyValueRow({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.kvValue, { color: tone === "neutral" ? colors.fg : toneFg(tone) }]}>
        {value}
      </Text>
    </View>
  );
}

/**
 * One citation, everywhere a citation is shown (the memo's list and a chat
 * answer's footer). Situate citations point at a module + version, so the
 * caption reads "module · vX" when there is no document url.
 */
export function CitationRow({
  id,
  claim,
  source,
  url,
}: {
  id: string;
  claim?: string | null;
  source?: string | null;
  url?: string | null;
}) {
  const href = typeof url === "string" && /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
  const text = typeof claim === "string" && claim.trim() ? claim.trim() : null;
  const body = (
    <View style={styles.citationRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.citationClaim}>
          <Text style={styles.citationId}>[{id}]</Text> {text ?? "No claim text on this citation."}
        </Text>
        {source ? (
          <Text style={styles.citationSource} numberOfLines={1}>
            {source}
          </Text>
        ) : null}
      </View>
      {href ? (
        <Ionicons
          name="chevron-forward"
          size={13}
          color={colors.fgMuted}
          style={{ marginTop: 2 }}
        />
      ) : null}
    </View>
  );
  if (!href) return body;
  return (
    <Pressable
      onPress={() => {
        void Linking.openURL(href).catch(() => {});
      }}
      accessibilityRole="link"
      accessibilityLabel={`Open citation ${id}${text ? `: ${text}` : ""}`}
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : undefined)}
    >
      {body}
    </Pressable>
  );
}

export function SegmentedChips<T extends string>({
  options,
  value,
  onChange,
  labelOf,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  labelOf?: (option: T) => string;
}) {
  return (
    <View style={styles.segment}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => {
              if (active) return;
              hapticSelect();
              onChange(option);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={labelOf ? labelOf(option) : option}
            style={({ pressed }) => [
              styles.segmentItem,
              active && styles.segmentItemActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {labelOf ? labelOf(option) : option.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// -------- lazy mounting --------

/**
 * How far the reader has scrolled, in content coordinates, plus a viewport of
 * lookahead. The screen only ever raises this value, so a section that has
 * mounted stays mounted.
 */
export const ScrollReachContext = createContext<number>(Number.POSITIVE_INFINITY);

/** Defers a heavy section until the reader is within a viewport of it. */
export function LazySection({
  minHeight = 220,
  children,
}: {
  minHeight?: number;
  children: ReactNode;
}) {
  const reach = useContext(ScrollReachContext);
  const [top, setTop] = useState<number | null>(null);
  const mounted = top === null ? false : top <= reach;
  return (
    <View
      onLayout={(e) => setTop(e.nativeEvent.layout.y)}
      style={mounted ? undefined : { minHeight }}
    >
      {mounted ? children : <SectionSkeleton height={minHeight} />}
    </View>
  );
}

export function SectionSkeleton({ height = 220 }: { height?: number }) {
  return (
    <View style={[styles.card, { height, justifyContent: "center", alignItems: "center" }]}>
      <ActivityIndicator color={colors.fgDim} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: space.lg,
    gap: space.md,
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  eyebrow: { color: colors.accent, ...type.caption, letterSpacing: 1.1 },
  cardTitle: { color: colors.fg, ...type.h3 },
  cardSubtitle: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
  unavailable: {
    color: colors.fgMuted,
    fontSize: 12.5,
    lineHeight: 18,
    fontStyle: "italic",
  },
  tile: {
    backgroundColor: colors.bgSunken,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 3,
    minWidth: 88,
  },
  tileLabel: { color: colors.fgMuted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  tileValue: { color: colors.fg, fontSize: 16, fontWeight: "700" },
  tileSub: { color: colors.fgMuted, fontSize: 10.5 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  chipText: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.2 },
  meterTrack: { width: "100%", overflow: "hidden" },
  kvRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  kvLabel: { color: colors.fgMuted, fontSize: 12, flexShrink: 1 },
  kvValue: { color: colors.fg, fontSize: 12.5, fontWeight: "700" },
  citationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  citationClaim: { color: colors.fgMuted, fontSize: 12.5, lineHeight: 18 },
  citationId: { color: colors.fg, fontWeight: "800" },
  citationSource: { color: SITUATE_DIM, fontSize: 10.5, lineHeight: 15 },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.bgSunken,
    borderRadius: radii.pill,
    padding: 3,
    gap: 2,
    alignSelf: "flex-start",
  },
  segmentItem: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill },
  segmentItemActive: { backgroundColor: colors.accentMuted },
  segmentText: { color: colors.fgMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  segmentTextActive: { color: colors.fg },
});
