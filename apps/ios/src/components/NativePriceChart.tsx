import { type QuoteHistoryInterval, fetchQuoteHistory } from "@/api/client";
import type { QuoteHistoryPoint } from "@/api/types";
import { LineSparkline } from "@/chartkit/LineSparkline";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const INTERVALS: { key: QuoteHistoryInterval; label: string }[] = [
  { key: "15m", label: "15m" },
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
];

const CHART_HEIGHT = 148;
const LINE_POINTS = 80;

type Props = {
  ticker: string;
  token?: string;
  interval?: QuoteHistoryInterval;
  onInterval?: (interval: QuoteHistoryInterval) => void;
  hideIntervalChips?: boolean;
};

export function NativePriceChart({
  ticker,
  token,
  interval = "1d",
  onInterval,
  hideIntervalChips = false,
}: Props) {
  const q = useQuery({
    queryKey: ["quote-history", ticker, interval],
    queryFn: () => fetchQuoteHistory(ticker, { interval }, { token }),
    enabled: !!ticker,
    staleTime: interval === "15m" ? 15_000 : 60_000,
    retry: 1,
  });

  const selectInterval = (next: QuoteHistoryInterval) => {
    hapticSelect();
    onInterval?.(next);
  };

  return (
    <View style={styles.root}>
      {hideIntervalChips ? null : (
        <View style={styles.chips}>
          {INTERVALS.map((p) => {
            const on = p.key === interval;
            return (
              <Pressable
                key={p.key}
                onPress={() => selectInterval(p.key)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityLabel={`Price interval ${p.label}`}
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {q.isLoading || q.isPending ? (
        <ChartSkeleton />
      ) : q.isError || !q.data || q.data.points.filter(isFiniteClose).length < 2 ? (
        <Text style={styles.error}>Price history unavailable</Text>
      ) : (
        <ChartBody
          data={q.data.points.filter(isFiniteClose)}
          fetchedAt={q.data.sources[0]?.fetchedAt}
        />
      )}
    </View>
  );
}

function ChartBody({
  data,
  fetchedAt,
}: {
  data: QuoteHistoryPoint[];
  fetchedAt?: string;
}) {
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const line = useMemo(() => resampleCloses(data, LINE_POINTS), [data]);

  const first = data[0];
  const last = data[data.length - 1];
  const shown = (scrubIndex !== null ? data[scrubIndex] : last) ?? last;
  if (
    !first ||
    !last ||
    !shown ||
    !isFiniteClose(shown) ||
    !isFiniteClose(first) ||
    !isFiniteClose(last)
  ) {
    return <Text style={styles.error}>Price history unavailable</Text>;
  }

  const windowChange = first.close === 0 ? 0 : (last.close - first.close) / first.close;
  const up = windowChange >= 0;

  const onScrub = (x: number) => {
    if (chartWidth <= 0 || data.length < 2) return;
    const t = Math.min(1, Math.max(0, x / chartWidth));
    setScrubIndex(Math.round(t * (data.length - 1)));
  };

  return (
    <>
      <View style={styles.statsRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.price}>${shown.close.toFixed(2)}</Text>
          <Text style={styles.date}>{formatTs(shown.ts)}</Text>
        </View>
        <Text
          style={[styles.change, { color: up ? colors.accent : colors.danger }]}
          accessibilityLabel={`Window change ${formatPct(windowChange)}`}
        >
          {windowChange >= 0 ? "+" : ""}
          {formatPct(windowChange)}
        </Text>
      </View>

      <View
        style={styles.chart}
        onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => onScrub(e.nativeEvent.locationX)}
        onResponderMove={(e) => onScrub(e.nativeEvent.locationX)}
        onResponderRelease={() => setScrubIndex(null)}
        onResponderTerminate={() => setScrubIndex(null)}
        accessibilityLabel="Price history chart. Drag to read a date and close."
        accessibilityRole="adjustable"
      >
        {chartWidth > 0 ? (
          <LineSparkline
            series={line}
            width={chartWidth}
            height={CHART_HEIGHT}
            color={up ? colors.accent : colors.danger}
            strokeWidth={2.5}
          />
        ) : null}
        {scrubIndex !== null && chartWidth > 0 ? (
          <View
            pointerEvents="none"
            style={[styles.scrubLine, { left: (scrubIndex / (data.length - 1)) * chartWidth - 1 }]}
          />
        ) : null}
      </View>

      <Text style={styles.footer}>
        Market data
        {fetchedAt ? ` · ${formatFetchedAt(fetchedAt)}` : ""}
      </Text>
    </>
  );
}

function ChartSkeleton() {
  return (
    <>
      <View style={styles.statsRow}>
        <View>
          <View style={[styles.skel, { width: 88, height: 22, marginBottom: 8 }]} />
          <View style={[styles.skel, { width: 72, height: 12 }]} />
        </View>
        <View style={[styles.skel, { width: 56, height: 18 }]} />
      </View>
      <View
        style={[styles.skel, { height: CHART_HEIGHT, width: "100%", borderRadius: radii.md }]}
      />
      <View style={[styles.skel, { width: 140, height: 10 }]} />
    </>
  );
}

function isFiniteClose(p: QuoteHistoryPoint): boolean {
  return typeof p.close === "number" && Number.isFinite(p.close);
}

/** Nearest-index resample for the bar strip. Stats/scrub still use full points. */
function resampleCloses(points: QuoteHistoryPoint[], targetLen: number): number[] {
  if (points.length === 0) return [];
  if (points.length <= targetLen) return points.map((p) => p.close);
  const out: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const idx = Math.floor((i * (points.length - 1)) / (targetLen - 1));
    const v = points[idx]?.close;
    if (typeof v === "number") out.push(v);
  }
  return out;
}

function formatPct(x: number): string {
  const pct = x * 100;
  const digits = Math.abs(pct) >= 100 ? 0 : Math.abs(pct) >= 10 ? 1 : 2;
  return `${pct.toFixed(digits)}%`;
}

function formatTs(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFetchedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  chips: { flexDirection: "row", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  chipText: { color: colors.fgMuted, fontSize: 11, fontWeight: "700" },
  chipTextOn: { color: colors.accentInk },
  statsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  price: { color: colors.fg, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  date: { color: colors.fgMuted, ...type.caption, marginTop: 2 },
  change: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2, paddingBottom: 2 },
  chart: {
    height: CHART_HEIGHT,
    width: "100%",
    justifyContent: "flex-end",
    overflow: "hidden",
    borderRadius: radii.sm,
    backgroundColor: colors.bgSunken,
  },
  scrubLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.fg,
    opacity: 0.7,
  },
  footer: { color: colors.fgDim, fontSize: 10 },
  error: { color: colors.fgMuted, fontSize: 13, paddingVertical: 12 },
  skel: { backgroundColor: colors.bgSunken, borderRadius: 6 },
});

export default NativePriceChart;
