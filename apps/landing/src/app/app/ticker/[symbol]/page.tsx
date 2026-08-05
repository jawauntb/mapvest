"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addToWatchlist,
  generateMemo,
  getAnalysis,
  getChart,
  getQuote,
  getToken,
  listWatchlist,
  removeFromWatchlist,
  resolveComparable,
  saveMemoToWatchlist,
  type AnalysisSnapshot,
  type ChartImage,
} from "@/lib/mapvest-api";

type Resolved = Awaited<ReturnType<typeof resolveComparable>>;
type Quote = NonNullable<Awaited<ReturnType<typeof getQuote>>["quote"]>;

const CHART_CHIPS = [
  { id: "auction", label: "Auction" },
  { id: "performance", label: "Seasonality" },
  { id: "regression", label: "Regression" },
  { id: "ridge-growth", label: "Ridge" },
  { id: "flow-compass", label: "Flow" },
  { id: "torque", label: "Torque" },
] as const;

const PERIODS = ["1mo", "3mo", "1y", "2y"] as const;

type ChartCache = Record<string, ChartImage>;

function cacheKey(type: string, ticker: string, period: string) {
  return `${ticker}|${type}|${period}`;
}

export default function TickerDetail() {
  const params = useParams<{ symbol: string }>();
  const symbolOrBrand = decodeURIComponent(params.symbol ?? "");
  const [data, setData] = useState<Resolved | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [chartTicker, setChartTicker] = useState<string | null>(null);
  const [chartType, setChartType] = useState<(typeof CHART_CHIPS)[number]["id"]>("auction");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("1mo");
  const [chart, setChart] = useState<ChartImage | null>(null);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const cacheRef = useRef<ChartCache>({});
  const [analysis, setAnalysis] = useState<AnalysisSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [memo, setMemo] = useState<{ provider: string; text: string } | null>(null);
  const [memoSaved, setMemoSaved] = useState(false);
  const [busy, setBusy] = useState<"" | "memo" | "save" | "memoSave">("");

  const authed = !!getToken();

  const loadChart = useCallback(async (ticker: string, type: string, per: string) => {
    const key = cacheKey(type, ticker, per);
    const hit = cacheRef.current[key];
    if (hit) {
      setChart(hit);
      setChartErr(null);
      return;
    }
    setChartLoading(true);
    setChartErr(null);
    try {
      const r = await getChart(type, ticker, { period: per });
      cacheRef.current[key] = r;
      setChart(r);
    } catch (e) {
      setChart(null);
      setChartErr(e instanceof Error ? e.message : "chart failed");
    } finally {
      setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!symbolOrBrand) return;
    cacheRef.current = {};
    setChart(null);
    setChartErr(null);
    setChartType("auction");
    setPeriod("1mo");
    setAnalysis(null);
    resolveComparable(symbolOrBrand)
      .then((r) => {
        setData(r);
        const t =
          r.brand.ticker?.symbol ??
          r.comparables[0]?.ticker ??
          (/^[A-Z][A-Z0-9.]{0,5}$/.test(symbolOrBrand.toUpperCase())
            ? symbolOrBrand.toUpperCase()
            : null);
        setChartTicker(t);
        if (t) {
          void loadChart(t, "auction", "1mo");
          getAnalysis(t)
            .then(setAnalysis)
            .catch(() => {});
        }
      })
      .catch((e) => setErr(e.message));
    getQuote(symbolOrBrand)
      .then((r) => r.quote && setQuote(r.quote))
      .catch(() => {});
    if (authed) {
      listWatchlist()
        .then((wl) =>
          setSaved(
            wl.items.some((it) => it.ticker.toUpperCase() === symbolOrBrand.toUpperCase()),
          ),
        )
        .catch(() => {});
    }
  }, [symbolOrBrand, authed, loadChart]);

  useEffect(() => {
    if (!chartTicker) return;
    void loadChart(chartTicker, chartType, period);
  }, [chartTicker, chartType, period, loadChart]);

  if (err) return <div className="app-err">{err}</div>;
  if (!data) return <div className="app-muted">Loading…</div>;

  const brand = data.brand as unknown as {
    name: string;
    isPublic: boolean;
    ticker?: { symbol: string; exchange?: string };
    sector?: string;
  };
  const ticker = brand.ticker?.symbol;

  async function onSave() {
    if (!ticker) return;
    setBusy("save");
    try {
      if (saved) {
        await removeFromWatchlist(ticker);
        setSaved(false);
      } else {
        await addToWatchlist({
          ticker,
          name: brand.name,
          sector: brand.sector,
          source: "web",
        });
        setSaved(true);
      }
    } finally {
      setBusy("");
    }
  }

  async function onGenerateMemo() {
    if (!ticker) return;
    setBusy("memo");
    try {
      const r = await generateMemo(ticker);
      setMemo({ provider: r.provider, text: r.memo });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "memo failed");
    } finally {
      setBusy("");
    }
  }

  async function onSaveMemo() {
    if (!ticker || !memo) return;
    setBusy("memoSave");
    try {
      await addToWatchlist({
        ticker,
        name: brand.name,
        sector: brand.sector,
        source: "web",
      });
      await saveMemoToWatchlist(ticker, memo.text, memo.provider);
      setSaved(true);
      setMemoSaved(true);
    } finally {
      setBusy("");
    }
  }

  const chipLabel = CHART_CHIPS.find((c) => c.id === chartType)?.label ?? chartType;

  return (
    <div className="app-detail">
      <Link href="/app" className="app-back">
        ← back
      </Link>
      <h1>{brand.name}</h1>
      <p className="app-sub">
        {ticker ? (
          <>
            <span className="app-ticker-big">{ticker}</span>
            {brand.ticker?.exchange ? ` · ${brand.ticker.exchange}` : ""}
          </>
        ) : (
          "private"
        )}
        {brand.sector ? ` · ${brand.sector}` : ""}
      </p>

      {quote ? (
        <div className="app-quote">
          <span className="app-quote-price">${quote.price.toFixed(2)}</span>
          <span
            className={`app-quote-change ${
              quote.change >= 0 ? "app-quote-up" : "app-quote-down"
            }`}
          >
            {quote.change >= 0 ? "+" : ""}
            {quote.change.toFixed(2)} ({quote.changePct.toFixed(2)}%)
          </span>
          <span className="app-quote-disc">{quote.disclaimer}</span>
        </div>
      ) : null}

      <section className="app-chart">
        <h2>
          {chipLabel} · {chart?.ticker ?? chartTicker ?? "…"} · {period}
        </h2>
        <div className="app-chart-chips" role="tablist">
          {CHART_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`app-chip ${chartType === c.id ? "app-chip-active" : ""}`}
              onClick={() => setChartType(c.id)}
              disabled={!chartTicker}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="app-period-row">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`app-period ${period === p ? "app-period-active" : ""}`}
              onClick={() => setPeriod(p)}
              disabled={!chartTicker}
            >
              {p}
            </button>
          ))}
        </div>
        {chart && !chartLoading ? (
          <>
            <img
              className="app-chart-img"
              alt={`${chart.ticker} ${period} ${chipLabel} chart`}
              src={`data:${chart.image.mime};base64,${chart.image.data}`}
            />
            {chart.levels && chartType === "auction" ? (
              <p className="app-muted">
                POC {chart.levels.poc?.toFixed?.(2) ?? "—"} · VAH{" "}
                {chart.levels.vah?.toFixed?.(2) ?? "—"} · VAL{" "}
                {chart.levels.val?.toFixed?.(2) ?? "—"}
                {chart.provider ? ` · ${chart.provider}` : ""}
              </p>
            ) : null}
          </>
        ) : chartErr ? (
          <p className="app-err">{chartErr}</p>
        ) : (
          <p className="app-muted">Loading {chipLabel.toLowerCase()} chart…</p>
        )}
      </section>

      {analysis ? (
        <section>
          <h2>Analysis snapshot</h2>
          <dl className="app-snapshot">
            {analysis.sector ? (
              <>
                <div>
                  <dt>Sector</dt>
                  <dd>{analysis.sector}</dd>
                </div>
              </>
            ) : null}
            {analysis.industry ? (
              <div>
                <dt>Industry</dt>
                <dd>{analysis.industry}</dd>
              </div>
            ) : null}
            {analysis.annualVolatility != null ? (
              <div>
                <dt>Ann. vol</dt>
                <dd>{(analysis.annualVolatility * 100).toFixed(1)}%</dd>
              </div>
            ) : null}
            {analysis.fiftyTwoWeekLow != null || analysis.fiftyTwoWeekHigh != null ? (
              <div>
                <dt>52w</dt>
                <dd>
                  {analysis.fiftyTwoWeekLow?.toFixed?.(2) ?? "—"} –{" "}
                  {analysis.fiftyTwoWeekHigh?.toFixed?.(2) ?? "—"}
                </dd>
              </div>
            ) : null}
            {analysis.trailingPe != null ? (
              <div>
                <dt>P/E</dt>
                <dd>{analysis.trailingPe}</dd>
              </div>
            ) : null}
            {analysis.marketCap != null ? (
              <div>
                <dt>Mkt cap</dt>
                <dd>{String(analysis.marketCap)}</dd>
              </div>
            ) : null}
          </dl>
          {analysis.brief ? (
            <pre className="app-memo-body" style={{ marginTop: "0.75rem" }}>
              {analysis.brief.slice(0, 1200)}
              {analysis.brief.length > 1200 ? "…" : ""}
            </pre>
          ) : null}
        </section>
      ) : null}

      {ticker && authed ? (
        <div className="app-action-row">
          <button
            className={`app-btn ${saved ? "app-btn-active" : ""}`}
            onClick={onSave}
            disabled={busy === "save"}
          >
            {busy === "save" ? "…" : saved ? "★ Saved" : "☆ Save"}
          </button>
          <button
            className="app-btn"
            onClick={onGenerateMemo}
            disabled={busy === "memo"}
          >
            {busy === "memo" ? "Generating…" : memo ? "↻ Regenerate memo" : "📝 Generate memo"}
          </button>
        </div>
      ) : null}
      {!authed ? (
        <p className="app-muted">
          <Link href="/app">Sign in</Link> to save this ticker or generate a memo.
        </p>
      ) : null}

      {memo ? (
        <section className="app-memo">
          <div className="app-memo-header">
            <span className="app-memo-provider">{memo.provider} · investment brief</span>
            <button
              className={`app-btn ${memoSaved ? "app-btn-active" : ""}`}
              onClick={onSaveMemo}
              disabled={busy === "memoSave" || memoSaved}
            >
              {busy === "memoSave"
                ? "Saving…"
                : memoSaved
                  ? "✓ Memo saved"
                  : "💾 Save memo"}
            </button>
          </div>
          <pre className="app-memo-body">{memo.text}</pre>
        </section>
      ) : null}

      <section>
        <h2>Comparables</h2>
        {data.comparables.length === 0 ? (
          <p className="app-muted">No public comparables resolved.</p>
        ) : (
          <ul className="app-simple-list">
            {data.comparables.map((c, i) => (
              <li key={`${c.ticker}-${i}`}>
                <Link href={`/app/ticker/${encodeURIComponent(c.ticker)}`}>
                  <span className="app-ticker">${c.ticker}</span>
                </Link>{" "}
                · {c.name}{" "}
                <span className="app-score">{Math.round(c.score * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>ETF exposure</h2>
        {data.etfs.length === 0 ? (
          <p className="app-muted">No ETFs matched.</p>
        ) : (
          <ul className="app-simple-list">
            {data.etfs.map((e, i) => (
              <li key={`${e.ticker}-${i}`}>
                <span className="app-ticker">{e.ticker}</span> · {e.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
