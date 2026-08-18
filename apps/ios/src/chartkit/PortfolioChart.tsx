import type { PortfolioDataset, ValuePoint } from "@/api/underlying";
import { View } from "react-native";
import { Polygon, Polyline } from "react-native-svg";
import { PORTFOLIO_LINE_CYCLE, terminal } from "./palette";
import { ChartShell, LegendRow, Panel, XDateLabels, YGrid } from "./primitives";
import {
  decimate,
  extent,
  fmtMoney,
  fmtPct,
  indexByDate,
  linearScale,
  niceTicks,
  padDomain,
  polylinePoints,
} from "./scale";

const PANEL_HEIGHT = 240;
const MAX_POINTS = 160;

/**
 * Portfolio equity curve: thin holding lines cycling the terminal palette,
 * the portfolio sum as the amber hero line with a faint underfill, and the
 * benchmark dashed cyan when it resolved.
 */
export function PortfolioChart({ data }: { data: PortfolioDataset }) {
  const m = data.meta;
  const portfolio = decimate(data.series.portfolio, MAX_POINTS);
  const dates = portfolio.map((p) => p.date);
  const dateIndex = indexByDate(dates);
  const holdings = Object.entries(data.series.holdings);
  const benchmark = data.series.benchmark;

  const subtitleParts = [
    `${data.tickers.length} HOLDINGS`,
    `$${Math.round(m.investment_per_stock)}/STOCK`,
  ];
  if (m.benchmark_ticker && m.alpha_vs_benchmark != null) {
    const alpha = m.alpha_vs_benchmark;
    subtitleParts.push(`ALPHA VS ${m.benchmark_ticker} ${alpha >= 0 ? "+" : ""}${fmtPct(alpha)}`);
  }

  return (
    <ChartShell
      title="Portfolio equity curve"
      subtitle={subtitleParts.join(" | ")}
      footerLeft={`Return ${fmtPct(m.total_return)} | drawdown ${fmtPct(m.max_drawdown)} | vol ${fmtPct(m.annualized_volatility)}`}
      footerRight="portfolio scanner"
    >
      <Panel height={PANEL_HEIGHT}>
        {(w, h) => {
          if (portfolio.length === 0) return null;
          const x = linearScale([0, Math.max(1, dates.length - 1)], [6, w - 6]);
          const inWindow = (series: ValuePoint[]) =>
            series.filter((p) => dateIndex.has(p.date)).map((p) => p.value);
          const allValues = [
            ...portfolio.map((p) => p.value),
            ...holdings.flatMap(([, series]) => inWindow(series)),
            ...(benchmark ? inWindow(benchmark) : []),
          ];
          const domain = padDomain(extent(allValues), 0.05);
          const y = linearScale(domain, [h - 18, 8]);

          const heroPts = portfolio.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
          const floor = y(Math.min(...portfolio.map((p) => p.value)) * 0.985);
          const first = portfolio[0];
          const last = portfolio[portfolio.length - 1];
          const underfill =
            first && last
              ? [
                  `${x(0).toFixed(1)},${floor.toFixed(1)}`,
                  ...heroPts,
                  `${x(dates.length - 1).toFixed(1)},${floor.toFixed(1)}`,
                ].join(" ")
              : "";

          return (
            <>
              <YGrid width={w} ticks={niceTicks(domain, 4)} y={y} format={fmtMoney} />
              {holdings.map(([ticker, series], idx) => (
                <Polyline
                  key={ticker}
                  points={polylinePoints(series, dateIndex, x, y)}
                  fill="none"
                  stroke={PORTFOLIO_LINE_CYCLE[idx % PORTFOLIO_LINE_CYCLE.length]}
                  strokeWidth={1.2}
                  opacity={0.58}
                />
              ))}
              {benchmark ? (
                <Polyline
                  points={polylinePoints(benchmark, dateIndex, x, y)}
                  fill="none"
                  stroke={terminal.cyan}
                  strokeWidth={1.8}
                  strokeDasharray="7 4"
                />
              ) : null}
              {underfill ? (
                <Polygon points={underfill} fill={terminal.amber} opacity={0.075} />
              ) : null}
              <Polyline
                points={heroPts.join(" ")}
                fill="none"
                stroke={terminal.amberHot}
                strokeWidth={2.8}
              />
              <XDateLabels dates={dates} x={x} height={h} />
            </>
          );
        }}
      </Panel>

      <View>
        <LegendRow
          items={[
            { color: terminal.amberHot, label: "Portfolio" },
            ...(m.benchmark_ticker
              ? [{ color: terminal.cyan, label: `${m.benchmark_ticker} benchmark`, dashed: true }]
              : []),
            ...holdings.slice(0, 6).map(([ticker], idx) => ({
              color: PORTFOLIO_LINE_CYCLE[idx % PORTFOLIO_LINE_CYCLE.length] as string,
              label: ticker,
            })),
          ]}
        />
      </View>
    </ChartShell>
  );
}
