import { type BacktestPeriod, type BacktestResponse, fetchBacktest } from "@/api/backtest";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * BacktestCard — Home footer widget answering "if I'd equal-weighted this
 * watchlist N months ago, what would have happened?".
 *
 * Chart-library free: renders a price LINE of portfolio value (rotated View
 * segments + last-print dot — same technique as NativePriceChart, no svg).
 * Jade when the window is up, red when down. The line is shape, not candles.
 *
 * Positioning: I recommend dropping this into home.tsx's ListFooterComponent
 * right AFTER <TopMoversCard /> — same signed-in gate, same container.
 */

const PERIODS: { key: BacktestPeriod; label: string }[] = [
  { key: "1mo", label: "1M" },
  { key: "3mo", label: "3M" },
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
];

const SPARKLINE_HEIGHT = 40;
const LINE_WIDTH = 2;

export function BacktestCard({ tickers, token }: { tickers: string[]; token?: string }) {
  const [period, setPeriod] = useState<BacktestPeriod>("3mo");

  // Fingerprint the ticker set so equivalent inputs share a cache slot but
  // reordering the watchlist doesn't re-fetch.
  const fp = useMemo(
    () =>
      [...tickers]
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join(","),
    [tickers],
  );

  const q = useQuery<BacktestResponse>({
    queryKey: ["backtest", fp, period, token ?? ""],
    queryFn: () =>
      fetchBacktest({ tickers: tickers.map((t) => t.toUpperCase()), period }, { token }),
    enabled: !!token && fp.length > 0,
    staleTime: 15 * 60 * 1000, // client cache — server already caches 30 min
    retry: 1,
  });

  if (!token || tickers.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>If you'd equal-weighted this</Text>
        <View style={styles.chips}>
          {PERIODS.map((p) => {
            const active = p.key === period;
            return (
              <Pressable
                key={p.key}
                onPress={() => {
                  hapticSelect();
                  setPeriod(p.key);
                }}
                style={[styles.chip, active && styles.chipOn]}
                accessibilityRole="button"
                accessibilityLabel={`Backtest window ${p.label}`}
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextOn]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {q.isLoading || q.isPending ? (
        <BacktestSkeleton />
      ) : q.isError || !q.data ? (
        <Text style={styles.errorText}>
          Couldn't run the backtest right now. Try again in a moment.
        </Text>
      ) : (
        <BacktestBody data={q.data} />
      )}
    </View>
  );
}

function BacktestBody({ data }: { data: BacktestResponse }) {
  const [sparkWidth, setSparkWidth] = useState(0);
  const up = data.totalReturn >= 0;
  const spreadUp = data.spread >= 0;
  return (
    <>
      <View style={styles.headlineRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headlineLabel}>Basket return</Text>
          <Text
            style={[styles.headline, { color: up ? colors.accent : colors.danger }]}
            accessibilityLabel={`Basket return ${formatPct(data.totalReturn)}`}
          >
            {formatPct(data.totalReturn)}
          </Text>
        </View>
        <View style={styles.sparkWrap} onLayout={(e) => setSparkWidth(e.nativeEvent.layout.width)}>
          {sparkWidth > 0 ? (
            <Sparkline series={data.series} width={sparkWidth} positive={up} />
          ) : null}
        </View>
      </View>

      <View style={styles.vsRow}>
        <Text style={styles.vsLabel}>vs S&amp;P 500</Text>
        <Text style={[styles.vsValue, { color: spreadUp ? colors.accent : colors.danger }]}>
          {spreadUp ? "+" : ""}
          {formatPct(data.spread)}
          <Text style={styles.vsSub}>
            {"  "}(SPY {formatPct(data.benchmarkReturn)})
          </Text>
        </Text>
      </View>

      <View style={styles.contribRow}>
        <ContributorPill label="Best" ticker={data.best.ticker} value={data.best.return} good />
        <ContributorPill
          label="Worst"
          ticker={data.worst.ticker}
          value={data.worst.return}
          good={false}
        />
      </View>

      {data.omitted && data.omitted.length > 0 ? (
        <Text style={styles.omitted}>No history for: {data.omitted.join(", ")}</Text>
      ) : null}

      <Text style={styles.footer}>
        Equal-weight · adj-close · no dividends reinvested · as of{" "}
        {new Date(data.generatedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </Text>
    </>
  );
}

function ContributorPill({
  label,
  ticker,
  value,
  good,
}: {
  label: string;
  ticker: string;
  value: number;
  good: boolean;
}) {
  const router = useRouter();
  const tone = good ? colors.accent : colors.danger;
  return (
    <Pressable
      onPress={() => {
        hapticSelect();
        router.push({ pathname: "/detail/[id]", params: { id: ticker.toUpperCase() } });
      }}
      style={({ pressed }) => [styles.pill, pressed && { opacity: 0.75 }]}
      accessibilityRole="link"
      accessibilityLabel={`Open ${ticker} details`}
    >
      <Text style={styles.pillLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
        <Text style={[styles.pillTicker, { color: colors.accent }]}>${ticker}</Text>
        <Text style={[styles.pillValue, { color: tone }]}>
          {value >= 0 ? "+" : ""}
          {formatPct(value)}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Close-to-close polyline of portfolio value — looks like a price line, not
 * a volume histogram. Jade when the window is up, red when down. Degenerate
 * range (< 1e-9) still draws a flat line so the widget doesn't go empty.
 */
function Sparkline({
  series,
  width,
  positive,
}: {
  series: number[];
  width: number;
  positive: boolean;
}) {
  const pts = useMemo(() => {
    if (series.length < 2 || width <= 0) return [];
    let mn = series[0] ?? 0;
    let mx = series[0] ?? 1;
    for (const v of series) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const range = Math.max(mx - mn, 1e-9);
    const pad = 4;
    const innerH = SPARKLINE_HEIGHT - pad * 2;
    const innerW = Math.max(width - pad * 2, 1);
    return series.map((v, i) => ({
      x: pad + (i / (series.length - 1)) * innerW,
      y: pad + (1 - (v - mn) / range) * innerH,
    }));
  }, [series, width]);

  const color = positive ? colors.accent : colors.danger;
  const last = pts[pts.length - 1];
  if (pts.length < 2 || !last) return null;

  return (
    <View
      style={{ width, height: SPARKLINE_HEIGHT }}
      pointerEvents="none"
      accessibilityLabel="Portfolio value line"
    >
      {pts.slice(0, -1).map((a, i) => {
        const b = pts[i + 1];
        if (!b) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: series index is stable per query
            key={i}
            style={{
              position: "absolute",
              left: a.x,
              top: a.y,
              width: Math.max(len, 1),
              height: LINE_WIDTH,
              backgroundColor: color,
              borderRadius: 1,
              transform: [{ rotate: `${deg}deg` }],
            }}
          />
        );
      })}
      <View
        style={{
          position: "absolute",
          left: last.x - 3.5,
          top: last.y - 3.5,
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function BacktestSkeleton() {
  return (
    <>
      <View style={styles.headlineRow}>
        <View style={{ flex: 1 }}>
          <View style={[styles.skel, { width: 90, height: 12, marginBottom: 8 }]} />
          <View style={[styles.skel, { width: 110, height: 28 }]} />
        </View>
        <View style={[styles.skel, { width: 96, height: SPARKLINE_HEIGHT, borderRadius: 6 }]} />
      </View>
      <View style={[styles.skel, { height: 14, marginTop: 12, width: "60%" }]} />
      <View style={[styles.skel, { height: 44, marginTop: 12 }]} />
    </>
  );
}

function formatPct(x: number): string {
  const pct = x * 100;
  // Small returns still deserve two decimals; giant moves round to one.
  const digits = Math.abs(pct) >= 100 ? 0 : Math.abs(pct) >= 10 ? 1 : 2;
  return `${pct.toFixed(digits)}%`;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    gap: 10,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  title: { color: colors.fg, ...type.body, fontWeight: "700", fontSize: 14, flexShrink: 1 },
  chips: { flexDirection: "row", gap: 4 },
  chip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  chipText: { color: colors.fgMuted, fontSize: 11, fontWeight: "700" },
  chipTextOn: { color: colors.accentInk },
  headlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  headlineLabel: {
    color: colors.fgDim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  headline: { fontSize: 26, fontWeight: "800", letterSpacing: -0.4 },
  sparkWrap: {
    flex: 1,
    minWidth: 96,
    height: SPARKLINE_HEIGHT,
    justifyContent: "center",
    overflow: "hidden",
  },
  vsRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  vsLabel: { color: colors.fgMuted, fontSize: 12, fontWeight: "600" },
  vsValue: { fontSize: 14, fontWeight: "800" },
  vsSub: { color: colors.fgDim, fontSize: 11, fontWeight: "600" },
  contribRow: { flexDirection: "row", gap: 8 },
  pill: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.bgSunken,
    gap: 2,
  },
  pillLabel: {
    color: colors.fgDim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  pillTicker: { color: colors.fg, fontSize: 13, fontWeight: "800" },
  pillValue: { fontSize: 13, fontWeight: "800" },
  omitted: { color: colors.fgDim, fontSize: 11 },
  footer: { color: colors.fgDim, fontSize: 10, marginTop: 2 },
  errorText: { color: colors.fgMuted, fontSize: 13, paddingVertical: 8 },
  skel: {
    backgroundColor: colors.bgSunken,
    borderRadius: 6,
  },
});

export default BacktestCard;
