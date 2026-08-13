import { type QuoteHistoryPeriod, fetchQuoteHistory } from "@/api/client";
import type { QuoteHistoryPoint } from "@/api/types";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const PERIODS: { key: QuoteHistoryPeriod; label: string }[] = [
  { key: "1mo", label: "1M" },
  { key: "3mo", label: "3M" },
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
];

const CHART_HEIGHT = 148;
const BAR_MIN_HEIGHT = 4;
const DISPLAY_BARS = 64;

type Props = {
  ticker: string;
  token?: string;
  period?: QuoteHistoryPeriod;
  onPeriod?: (period: QuoteHistoryPeriod) => void;
};

export function NativePriceChart({ ticker, token, period = "1mo", onPeriod }: Props) {
  const [activePeriod, setActivePeriod] = useState<QuoteHistoryPeriod>(period);

  const q = useQuery({
    queryKey: ["quote-history", ticker, activePeriod],
    queryFn: () => fetchQuoteHistory(ticker, activePeriod, { token }),
    enabled: !!ticker,
    staleTime: 60_000,
    retry: 1,
  });

  const selectPeriod = (next: QuoteHistoryPeriod) => {
    hapticSelect();
    setActivePeriod(next);
    onPeriod?.(next);
  };

  return (
    <View style={styles.root}>
      <View style={styles.chips}>
        {PERIODS.map((p) => {
          const on = p.key === activePeriod;
          return (
            <Pressable
              key={p.key}
              onPress={() => selectPeriod(p.key)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityLabel={`Price window ${p.label}`}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {q.isLoading || q.isPending ? (
        <ChartSkeleton />
      ) : q.isError || !q.data || q.data.points.length < 2 ? (
        <Text style={styles.error}>Price history unavailable</Text>
      ) : (
        <ChartBody data={q.data.points} fetchedAt={q.data.sources[0]?.fetchedAt} />
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
  const bars = useMemo(() => resampleCloses(data, DISPLAY_BARS), [data]);

  const first = data[0];
  const last = data[data.length - 1];
  const shown = (scrubIndex !== null ? data[scrubIndex] : last) ?? last;
  if (!first || !last || !shown) {
    return <Text style={styles.error}>Price history unavailable</Text>;
  }

  const windowChange = (last.close - first.close) / first.close;
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
        <BarSparkline series={bars} positive={up} />
        {scrubIndex !== null && chartWidth > 0 ? (
          <View
            pointerEvents="none"
            style={[styles.scrubLine, { left: (scrubIndex / (data.length - 1)) * chartWidth - 1 }]}
          />
        ) : null}
      </View>

      <Text style={styles.footer}>
        Yahoo Finance
        {fetchedAt ? ` · ${formatFetchedAt(fetchedAt)}` : ""}
      </Text>
    </>
  );
}

function BarSparkline({ series, positive }: { series: number[]; positive: boolean }) {
  const { min, max } = useMemo(() => {
    if (series.length === 0) return { min: 0, max: 1 };
    let mn = series[0] ?? 0;
    let mx = series[0] ?? 1;
    for (const v of series) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return { min: mn, max: mx };
  }, [series]);

  const color = positive ? colors.accent : colors.danger;
  const range = Math.max((max ?? 1) - (min ?? 0), 1e-9);

  return (
    <View style={styles.spark}>
      {series.map((v, i) => {
        const norm = (v - (min ?? 0)) / range;
        const h = Math.max(BAR_MIN_HEIGHT, Math.round(norm * CHART_HEIGHT));
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: series index is stable per query
            key={i}
            style={{
              flex: 1,
              height: h,
              backgroundColor: color,
              opacity: 0.4 + 0.6 * (i / Math.max(series.length - 1, 1)),
              borderTopLeftRadius: 1,
              borderTopRightRadius: 1,
            }}
          />
        );
      })}
    </View>
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
  spark: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1,
    height: CHART_HEIGHT,
    width: "100%",
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
