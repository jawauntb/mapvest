import {
  type ChartDataEnvelope,
  fetchChartData,
  fetchMoneylineData,
  fetchTorqueData,
} from "@/api/underlying";
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
import { RichText } from "@/components/RichText";
import { Skeleton } from "@/components/Skeleton";
import { colors, radii, type } from "@/theme/tokens";
import { hapticSelect } from "@/util/haptics";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

/**
 * Native "Terminal charts" section for the detail sheet. Renders all nine
 * Underlying Analyzer dataset types from the JSON data endpoints — no PNGs.
 * Only the selected chart's block mounts, so exactly one query runs at a time
 * and react-query keeps previously viewed charts warm.
 */

const CHART_CHIPS = [
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

/** Plain-language one-liners so the terminal charts read as more than wall art. */
const CHART_EXPLAINERS: Record<ChartId, string> = {
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
const STALE_TIME = 5 * 60_000;

export function UnderlyingChartsSection({
  ticker,
  defaultOpen = false,
}: {
  ticker: string;
  defaultOpen?: boolean;
}) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? defaultOpen;
  const [chartId, setChartId] = useState<ChartId>("auction");
  const [periods, setPeriods] = useState<Partial<Record<ChartId, string>>>({});
  const [ridgeWindow, setRidgeWindow] = useState<(typeof RIDGE_WINDOWS)[number]>("1y");

  const label = CHART_CHIPS.find((c) => c.id === chartId)?.label ?? chartId;
  const period = periods[chartId] ?? DEFAULT_PERIOD[chartId];
  const periodChips = PERIOD_CHIPS[chartId];

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => {
          hapticSelect();
          setToggled(!open);
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Terminal charts"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.h2}>{`Terminal charts · ${label}`}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.fgMuted} />
      </Pressable>

      {open ? (
        <View style={{ gap: 8 }}>
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
          <Text style={styles.explainer}>{CHART_EXPLAINERS[chartId]}</Text>

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
                  <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                    {p}
                  </Text>
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

          <ActiveChart
            ticker={ticker}
            chartId={chartId}
            period={period}
            ridgeWindow={ridgeWindow}
          />
        </View>
      ) : null}
    </View>
  );
}

function ActiveChart({
  ticker,
  chartId,
  period,
  ridgeWindow,
}: {
  ticker: string;
  chartId: ChartId;
  period?: string;
  ridgeWindow: string;
}) {
  switch (chartId) {
    case "auction":
      return <AuctionBlock ticker={ticker} period={period ?? "1y"} />;
    case "performance":
      return <PerformanceBlock ticker={ticker} />;
    case "regression":
      return <RegressionBlock ticker={ticker} period={period ?? "1y"} />;
    case "ridge-growth":
      return <RidgeBlock ticker={ticker} window={ridgeWindow} />;
    case "flow-compass":
      return <FlowBlock ticker={ticker} period={period ?? "1y"} />;
    case "torque":
      return <TorqueBlock ticker={ticker} />;
    case "portfolio":
      return <PortfolioBlock ticker={ticker} />;
    case "volatility":
      return <VolatilityBlock ticker={ticker} />;
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

function AuctionBlock({ ticker, period }: { ticker: string; period: string }) {
  const q = useQuery({
    queryKey: ["underlying", "auction", ticker, period],
    queryFn: () => fetchChartData("auction", { ticker, period }),
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

function RegressionBlock({ ticker, period }: { ticker: string; period: string }) {
  const q = useQuery({
    queryKey: ["underlying", "regression", ticker, period],
    queryFn: () => fetchChartData("regression", { ticker, period }),
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

function RidgeBlock({ ticker, window }: { ticker: string; window: string }) {
  // One request returns all three windows (6mo/1y/2y); switching is local.
  const q = useQuery({
    queryKey: ["underlying", "ridge-growth", ticker],
    queryFn: () => fetchChartData("ridge-growth", { ticker }),
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

function FlowBlock({ ticker, period }: { ticker: string; period: string }) {
  const q = useQuery({
    queryKey: ["underlying", "flow-compass", ticker, period],
    queryFn: () => fetchChartData("flow-compass", { ticker, period }),
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

function TorqueBlock({ ticker }: { ticker: string }) {
  // Tool route pins a 2y daily window server-side.
  const q = useQuery({
    queryKey: ["underlying", "torque", ticker],
    queryFn: () => fetchTorqueData({ ticker }),
    enabled: !!ticker,
    staleTime: STALE_TIME,
    retry: 1,
  });
  if (q.isPending) return <ChartLoading />;
  if (q.isError) return <ChartError message={(q.error as Error).message} onRetry={q.refetch} />;
  return <TorqueDashboard data={q.data} />;
}

function PortfolioBlock({ ticker }: { ticker: string }) {
  const q = useQuery({
    queryKey: ["underlying", "portfolio", ticker],
    queryFn: () => fetchChartData("portfolio", { ticker }),
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

function VolatilityBlock({ ticker }: { ticker: string }) {
  const q = useQuery({
    queryKey: ["underlying", "volatility", ticker],
    queryFn: () => fetchChartData("volatility", { ticker }),
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  h2: { color: colors.fg, ...type.label, fontSize: 15 },
  explainer: { color: colors.fgMuted, fontSize: 12, lineHeight: 17 },
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
