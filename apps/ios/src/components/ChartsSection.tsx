import type { QuoteHistoryInterval } from "@/api/client";
import { type ChartDataEnvelope, fetchChartData, fetchMoneylineData } from "@/api/underlying";
import {
  AuctionChart,
  FlowCompassChart,
  MoneylineChart,
  PerformanceHeatmap,
  PortfolioChart,
  RegressionChart,
  RidgeGrowthChart,
  TorqueDashboard,
  VolatilityChart,
} from "@/chartkit";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { NativePriceChart } from "@/components/NativePriceChart";
import { RichText } from "@/components/RichText";
import { Skeleton } from "@/components/Skeleton";
import { colors, elevation, motion, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeInDown,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

/**
 * The one charts surface on the detail sheet. Price is the default and the
 * only thing a first-time reader sees: chart, its interval chips, and a quiet
 * "Advanced analytics" row underneath. The other nine Underlying Terminal
 * chart types live behind that row — tapping it reveals the full chip set
 * (Price included, current selection highlighted). Collapsing hides the chip
 * row, never the selection, so a reader who picked Torque keeps Torque.
 * Expansion is local state on purpose — nothing to persist, nothing to sync.
 *
 * Only the selected chart's block mounts, so exactly one query runs at a time
 * and react-query keeps previously viewed charts warm.
 */

const CHART_CHIPS = [
  { id: "price", label: "Price" },
  { id: "auction", label: "Auction" },
  { id: "performance", label: "Seasonality" },
  { id: "regression", label: "Regression" },
  { id: "ridge-growth", label: "Ridge" },
  { id: "flow-compass", label: "Flow" },
  { id: "torque", label: "Torque" },
  { id: "portfolio", label: "Portfolio" },
  { id: "volatility", label: "Volatility" },
  { id: "moneyline", label: "Moneyline" },
] as const;

type ChartId = (typeof CHART_CHIPS)[number]["id"];

/** Plain-language one-liners so the charts read as more than wall art. */
const CHART_EXPLAINERS: Record<ChartId, string> = {
  price: "Market price history. Touch and drag any chart here to read exact values.",
  auction:
    "Where trading actually happened. Fat zones are fair value; thin edges are where buyers or sellers gave up.",
  performance: "How this name historically behaves through the year. Rhythm, not prophecy.",
  regression: "Trend with bands. Shows how stretched price is from its own path.",
  "ridge-growth": "A $10k trend-following simulation — when the model was long and what it earned.",
  "flow-compass": "Which way money is leaning — accumulation or distribution.",
  torque: "How hard fundamentals and price are coiling off trend. Momentum's turning force.",
  portfolio: "Growth of $100 in this name against an SPY benchmark over the last year.",
  volatility: "How hard this name typically swings — expected weekly and monthly dollar ranges.",
  moneyline: "Options positioning around spot — where calls and puts are stacked for expiry.",
};

/** Windows offered per period-aware chart (server defaults marked first). */
const PERIOD_CHIPS: Partial<Record<ChartId, readonly string[]>> = {
  auction: ["5d", "1mo", "3mo", "6mo", "1y", "2y"],
  regression: ["5d", "3mo", "6mo", "1y", "2y"],
  "flow-compass": ["5d", "6mo", "1y", "2y"],
};

const DEFAULT_PERIOD: Partial<Record<ChartId, string>> = {
  auction: "1y",
  regression: "1y",
  "flow-compass": "1y",
};

const RIDGE_WINDOWS = ["6mo", "1y", "2y"] as const;
const INTERVAL_CHIPS: { key: QuoteHistoryInterval; label: string }[] = [
  { key: "15m", label: "15m" },
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
];
const INTERVAL_CHARTS = new Set<ChartId>([
  "price",
  "auction",
  "regression",
  "ridge-growth",
  "flow-compass",
  "torque",
  "portfolio",
  "volatility",
]);
const STALE_TIME = 5 * 60_000;

export function ChartsSection({ ticker, token }: { ticker: string; token?: string }) {
  const [chartId, setChartId] = useState<ChartId>("price");
  const [interval, setInterval] = useState<QuoteHistoryInterval>("1d");
  const [periods, setPeriods] = useState<Partial<Record<ChartId, string>>>({});
  const [ridgeWindow, setRidgeWindow] = useState<(typeof RIDGE_WINDOWS)[number]>("1y");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Chevron points right when closed, down when open — the springy quarter
  // turn is the only flourish here (motion tokens, same spring as ScalePressable).
  const chevronTurn = useSharedValue(0);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronTurn.value * 90}deg` }],
  }));

  const label = CHART_CHIPS.find((c) => c.id === chartId)?.label ?? chartId;
  const period = periods[chartId] ?? DEFAULT_PERIOD[chartId];
  const periodChips = PERIOD_CHIPS[chartId];

  function toggleAdvanced() {
    hapticSelect();
    const next = !advancedOpen;
    chevronTurn.value = withSpring(next ? 1 : 0, motion.springSnappy);
    setAdvancedOpen(next);
  }

  // Collapsed with a terminal chart still selected: name it on the row so the
  // way back to the chooser is obvious.
  const advancedLabel = advancedOpen
    ? "Hide advanced"
    : chartId === "price"
      ? "Advanced analytics"
      : `Advanced analytics · ${label}`;

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.h2}>{`Charts · ${label}`}</Text>

      <Text style={styles.explainer}>{CHART_EXPLAINERS[chartId]}</Text>

      {INTERVAL_CHARTS.has(chartId) ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {INTERVAL_CHIPS.map((chip) => (
            <Pressable
              key={chip.key}
              onPress={() => {
                hapticSelect();
                setInterval(chip.key);
                if (chip.key === "15m") {
                  setPeriods((prev) => ({ ...prev, [chartId]: "5d" }));
                }
              }}
              style={[styles.periodBtn, interval === chip.key && styles.periodBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: interval === chip.key }}
              accessibilityLabel={`Chart interval ${chip.label}`}
            >
              <Text style={[styles.periodText, interval === chip.key && styles.periodTextActive]}>
                {chip.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {periodChips ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {periodChips.map((p) => (
            <Pressable
              key={p}
              onPress={() => {
                hapticSelect();
                setPeriods((prev) => ({ ...prev, [chartId]: p }));
              }}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: period === p }}
            >
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>{p}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {chartId === "ridge-growth" ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {RIDGE_WINDOWS.map((p) => (
            <Pressable
              key={p}
              onPress={() => {
                hapticSelect();
                setRidgeWindow(p);
              }}
              style={[styles.periodBtn, ridgeWindow === p && styles.periodBtnActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: ridgeWindow === p }}
            >
              <Text style={[styles.periodText, ridgeWindow === p && styles.periodTextActive]}>
                {p}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ChartErrorBoundary key={chartId}>
        <ActiveChart
          ticker={ticker}
          token={token}
          chartId={chartId}
          period={period}
          interval={interval}
          ridgeWindow={ridgeWindow}
        />
      </ChartErrorBoundary>

      <Pressable
        onPress={toggleAdvanced}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={advancedOpen ? "Hide advanced analytics" : "Advanced analytics"}
        accessibilityHint={
          advancedOpen ? "Hides the chart chooser" : "Shows the other nine chart types"
        }
        accessibilityState={{ expanded: advancedOpen }}
        style={({ pressed }) => [styles.advancedBtn, pressed && styles.advancedBtnPressed]}
      >
        <Text style={styles.advancedBtnText}>{advancedLabel}</Text>
        <Animated.View style={chevronStyle}>
          <Ionicons name="chevron-forward" size={13} color={colors.accent} />
        </Animated.View>
      </Pressable>

      {advancedOpen ? (
        <Animated.View entering={FadeInDown.duration(180)} exiting={FadeOutUp.duration(140)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {CHART_CHIPS.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    hapticSelect();
                    setChartId(c.id);
                  }}
                  style={[styles.chip, chartId === c.id && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chartId === c.id }}
                >
                  <Text style={[styles.chipText, chartId === c.id && styles.chipTextActive]}>
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </Animated.View>
      ) : null}
    </View>
  );
}

function ActiveChart({
  ticker,
  token,
  chartId,
  period,
  interval,
  ridgeWindow,
}: {
  ticker: string;
  token?: string;
  chartId: ChartId;
  period?: string;
  interval: QuoteHistoryInterval;
  ridgeWindow: string;
}) {
  switch (chartId) {
    case "price":
      return (
        <View style={styles.priceCard}>
          <NativePriceChart ticker={ticker} token={token} interval={interval} hideIntervalChips />
        </View>
      );
    case "auction":
      return <AuctionBlock ticker={ticker} period={period ?? "1y"} interval={interval} />;
    case "performance":
      return <PerformanceBlock ticker={ticker} />;
    case "regression":
      return <RegressionBlock ticker={ticker} period={period ?? "1y"} interval={interval} />;
    case "ridge-growth":
      return <RidgeBlock ticker={ticker} window={ridgeWindow} interval={interval} />;
    case "flow-compass":
      return <FlowBlock ticker={ticker} period={period ?? "1y"} interval={interval} />;
    case "torque":
      return <TorqueBlock ticker={ticker} interval={interval} />;
    case "portfolio":
      return <PortfolioBlock ticker={ticker} interval={interval} />;
    case "volatility":
      return <VolatilityBlock ticker={ticker} interval={interval} />;
    case "moneyline":
      return <MoneylineBlock ticker={ticker} />;
  }
}

// -------- per-type blocks (each owns one typed query) --------

/** Unwrap a batch envelope: first dataset, else the per-ticker error. */
function firstDataset<D>(env: ChartDataEnvelope<D>): { dataset?: D; error?: string } {
  const dataset = env.datasets[0];
  if (dataset) return { dataset };
  const err = env.meta.errors[0];
  return { error: err ? `${err.ticker}: ${err.error}` : "No data returned" };
}

function ChartLoading() {
  return (
    <View style={{ gap: 8 }}>
      <Skeleton height={14} width="52%" />
      <Skeleton height={240} radius={radii.md} />
      <Skeleton height={10} width="70%" />
    </View>
  );
}

function ChartError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryBtn} accessibilityRole="button">
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function AuctionBlock({
  ticker,
  period,
  interval,
}: {
  ticker: string;
  period: string;
  interval: QuoteHistoryInterval;
}) {
  const q = useQuery({
    queryKey: ["underlying", "auction", ticker, period, interval],
    queryFn: () => fetchChartData("auction", { ticker, period, interval }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  const { dataset, error } = firstDataset(q.data);
  if (!dataset) return <ChartError message={error ?? "No data"} onRetry={q.refetch} />;
  return <AuctionChart data={dataset} />;
}

function PerformanceBlock({ ticker }: { ticker: string }) {
  const month = new Date().getMonth() + 1;
  const q = useQuery({
    queryKey: ["underlying", "performance", ticker, month],
    queryFn: () => fetchChartData("performance", { ticker, month }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  const { dataset, error } = firstDataset(q.data);
  if (!dataset) return <ChartError message={error ?? "No data"} onRetry={q.refetch} />;
  return <PerformanceHeatmap data={dataset} />;
}

function RegressionBlock({
  ticker,
  period,
  interval,
}: {
  ticker: string;
  period: string;
  interval: QuoteHistoryInterval;
}) {
  const q = useQuery({
    queryKey: ["underlying", "regression", ticker, period, interval],
    queryFn: () => fetchChartData("regression", { ticker, period, interval }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  const { dataset, error } = firstDataset(q.data);
  if (!dataset) return <ChartError message={error ?? "No data"} onRetry={q.refetch} />;
  return <RegressionChart data={dataset} />;
}

function RidgeBlock({
  ticker,
  window,
  interval,
}: {
  ticker: string;
  window: string;
  interval: QuoteHistoryInterval;
}) {
  // One request returns all three windows (6mo/1y/2y); switching is local.
  const q = useQuery({
    queryKey: ["underlying", "ridge-growth", ticker, interval],
    queryFn: () => fetchChartData("ridge-growth", { ticker, interval }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  const datasets = q.data.datasets;
  const dataset = datasets.find((d) => d.period === window) ?? datasets[0];
  if (!dataset) {
    const err = q.data.meta.errors[0];
    return (
      <ChartError
        message={err ? `${err.ticker}: ${err.error}` : "No data returned"}
        onRetry={q.refetch}
      />
    );
  }
  const memo = datasets.find((d) => d.meta.analysis_memo)?.meta.analysis_memo;
  return (
    <View style={{ gap: 10 }}>
      <RidgeGrowthChart data={dataset} />
      {memo ? (
        <View style={styles.memoCard}>
          <RichText text={memo} />
        </View>
      ) : null}
    </View>
  );
}

function FlowBlock({
  ticker,
  period,
  interval,
}: {
  ticker: string;
  period: string;
  interval: QuoteHistoryInterval;
}) {
  const q = useQuery({
    queryKey: ["underlying", "flow-compass", ticker, period, interval],
    queryFn: () => fetchChartData("flow-compass", { ticker, period, interval }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  const { dataset, error } = firstDataset(q.data);
  if (!dataset) return <ChartError message={error ?? "No data"} onRetry={q.refetch} />;
  return <FlowCompassChart data={dataset} />;
}

function TorqueBlock({ ticker, interval }: { ticker: string; interval: QuoteHistoryInterval }) {
  const q = useQuery({
    queryKey: ["underlying", "torque", ticker, interval],
    queryFn: () => fetchChartData("torque", { ticker, interval }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  const { dataset, error } = firstDataset(q.data);
  if (!dataset) return <ChartError message={error ?? "No data"} onRetry={q.refetch} />;
  return <TorqueDashboard data={dataset} />;
}

function PortfolioBlock({ ticker, interval }: { ticker: string; interval: QuoteHistoryInterval }) {
  const q = useQuery({
    queryKey: ["underlying", "portfolio", ticker, interval],
    queryFn: () => fetchChartData("portfolio", { ticker, interval }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  const { dataset, error } = firstDataset(q.data);
  if (!dataset) return <ChartError message={error ?? "No data"} onRetry={q.refetch} />;
  return <PortfolioChart data={dataset} />;
}

function VolatilityBlock({ ticker, interval }: { ticker: string; interval: QuoteHistoryInterval }) {
  const q = useQuery({
    queryKey: ["underlying", "volatility", ticker, interval],
    queryFn: () => fetchChartData("volatility", { ticker, interval }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  const { dataset, error } = firstDataset(q.data);
  if (!dataset) return <ChartError message={error ?? "No data"} onRetry={q.refetch} />;
  return <VolatilityChart data={dataset} />;
}

function MoneylineBlock({ ticker }: { ticker: string }) {
  const q = useQuery({
    queryKey: ["underlying", "moneyline", ticker],
    queryFn: () => fetchMoneylineData({ ticker }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  return <MoneylineChart data={q.data} />;
}

const styles = StyleSheet.create({
  h2: { color: colors.fg, ...type.label, fontSize: 15 },
  explainer: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
  priceCard: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 12,
    ...elevation.sm,
  },
  chip: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
    minHeight: 32,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  // Same pill as the sheet's other secondary rows (detail/[id].tsx `miniBtn`).
  advancedBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 32,
  },
  advancedBtnPressed: { opacity: 0.7 },
  advancedBtnText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  chipText: { color: colors.fg, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.accentInk },
  periodBtn: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 5,
    paddingHorizontal: 8,
    minHeight: 28,
    justifyContent: "center",
  },
  periodBtnActive: { borderColor: colors.accent },
  periodText: { color: colors.fgMuted, fontSize: 11 },
  periodTextActive: { color: colors.accent },
  errorBox: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 12,
    gap: 8,
  },
  errorText: { color: colors.danger, fontSize: 13 },
  retryBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 30,
    justifyContent: "center",
  },
  retryText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  memoCard: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 12,
  },
});
