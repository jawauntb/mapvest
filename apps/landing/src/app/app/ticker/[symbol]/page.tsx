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
import { ResearchPanel } from "../../ResearchPanel";

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

function looksLikeTicker(s: string): string | null {
  const u = s.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.]{0,5}$/.test(u) ? u : null;
}

function hostLabel(url?: string): string {
  if (!url) return "source";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
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
  const chartReqRef = useRef(0);
  const [analysis, setAnalysis] = useState<AnalysisSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [memo, setMemo] = useState<{ provider: string; text: string } | null>(null);
  const [memoSaved, setMemoSaved] = useState(false);
  const [busy, setBusy] = useState<"" | "memo" | "save" | "memoSave">("");
  const [tab, setTab] = useState<"overview" | "advanced">("overview");
  const [researchOpen, setResearchOpen] = useState(false);

  const authed = !!getToken();

  const loadChart = useCallback(async (ticker: string, type: string, per: string) => {
    const key = cacheKey(type, ticker, per);
    const hit = cacheRef.current[key];
    if (hit && hit.ticker === ticker) {
      setChart(hit);
      setChartErr(null);
      setChartLoading(false);
      return;
    }
    const reqId = ++chartReqRef.current;
    setChartLoading(true);
    setChartErr(null);
    try {
      const r = await getChart(type, ticker, { period: per });
      if (reqId !== chartReqRef.current) return;
      if (r.ticker && r.ticker !== ticker) {
        setChart(null);
        setChartErr(`Chart returned ${r.ticker}, expected ${ticker}`);
        return;
      }
      cacheRef.current[key] = r;
      setChart(r);
    } catch (e) {
      if (reqId !== chartReqRef.current) return;
      setChart(null);
      setChartErr(e instanceof Error ? e.message : "chart failed");
    } finally {
      if (reqId === chartReqRef.current) setChartLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!symbolOrBrand) return;
    cacheRef.current = {};
    chartReqRef.current += 1;
    setChart(null);
    setChartErr(null);
    setChartType("auction");
    setPeriod("1mo");
    setAnalysis(null);
    setMemo(null);
    setMemoSaved(false);
    setTab("overview");
    setData(null);
    setErr(null);
    setQuote(null);

    const urlTicker = looksLikeTicker(symbolOrBrand);

    resolveComparable(symbolOrBrand)
      .then((r) => {
        setData(r);
        // Prefer listed brand ticker, then URL symbol, then top comparable.
        // Never let a comparable steal charts for a typed ticker like MCD.
        const t =
          r.brand.ticker?.symbol ?? urlTicker ?? r.comparables[0]?.ticker ?? null;
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
        .then((wl) => {
          const key = (urlTicker ?? symbolOrBrand).toUpperCase();
          setSaved(wl.items.some((it) => it.ticker.toUpperCase() === key));
        })
        .catch(() => {});
    }
  }, [symbolOrBrand, authed, loadChart]);

  useEffect(() => {
    if (!chartTicker) return;
    void loadChart(chartTicker, chartType, period);
  }, [chartTicker, chartType, period, loadChart]);

  if (err) return <div className="app-detail"><p className="app-err">{err}</p></div>;
  if (!data) return <div className="app-detail"><p className="app-muted">Loading…</p></div>;

  const brand = data.brand;
  const ticker = brand.ticker?.symbol ?? chartTicker;
  const chipLabel = CHART_CHIPS.find((c) => c.id === chartType)?.label ?? chartType;

  const sources = [
    ...data.comparables.flatMap((c) =>
      (c.sources ?? []).map((s) => ({
        ...s,
        label: `$${c.ticker}`,
      })),
    ),
    ...data.etfs.map((e) => ({
      provider: e.source?.provider ?? "manual",
      url: e.source?.url,
      confidence: "medium",
      label: e.ticker,
    })),
    ...(analysis?.sourceUrl
      ? [{ provider: "underlying", url: analysis.sourceUrl, confidence: "high", label: "analysis" }]
      : []),
    ...(chart?.sourceUrl
      ? [{ provider: "underlying", url: chart.sourceUrl, confidence: "high", label: "chart" }]
      : []),
  ].filter((s, i, arr) => {
    const k = `${s.provider}|${s.url ?? ""}|${s.label}`;
    return arr.findIndex((x) => `${x.provider}|${x.url ?? ""}|${x.label}` === k) === i;
  });

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

  return (
    <div className="app-detail">
      <Link href="/app" className="app-back">
        ← Back to app
      </Link>

      <header className="app-detail-hero">
        <h1>{brand.name}</h1>
        <p className="app-sub">
          {ticker ? (
            <>
              <span className="app-ticker-big">${ticker}</span>
              {brand.ticker?.exchange ? ` · ${brand.ticker.exchange}` : ""}
              {!brand.isPublic ? " · private brand · chart via ticker" : ""}
            </>
          ) : (
            "private · no listed ticker"
          )}
          {brand.sector ? ` · ${brand.sector}` : ""}
        </p>
      </header>

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

      <div className="app-detail-tabs" role="tablist">
        <button
          type="button"
          className={`app-detail-tab ${tab === "overview" ? "app-detail-tab-active" : ""}`}
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={`app-detail-tab ${tab === "advanced" ? "app-detail-tab-active" : ""}`}
          onClick={() => setTab("advanced")}
        >
          Advanced
        </button>
      </div>

      {tab === "overview" ? (
        <>
          <section className="app-panel app-chart">
            <h2 className="app-chart-title">
              Auction · ${chart?.ticker ?? chartTicker ?? "…"} · 1mo
            </h2>
            {chart && !chartLoading && chartType === "auction" && period === "1mo" ? (
              <>
                <img
                  className="app-chart-img"
                  alt={`${chart.ticker} 1mo auction chart`}
                  src={`data:${chart.image.mime};base64,${chart.image.data}`}
                />
                {chart.levels ? (
                  <p className="app-muted">
                    POC {chart.levels.poc?.toFixed?.(2) ?? "—"} · VAH{" "}
                    {chart.levels.vah?.toFixed?.(2) ?? "—"} · VAL{" "}
                    {chart.levels.val?.toFixed?.(2) ?? "—"}
                  </p>
                ) : null}
              </>
            ) : chartErr && chartType === "auction" ? (
              <p className="app-err">{chartErr}</p>
            ) : (
              <div className="app-chart-skel" aria-label="Loading chart" />
            )}
            {chartTicker ? (
              <button
                type="button"
                className="app-link"
                style={{ marginTop: "0.5rem", padding: 0 }}
                onClick={() => setTab("advanced")}
              >
                More charts →
              </button>
            ) : null}
          </section>

          {analysis ? (
            <section className="app-panel">
              <h2>At a glance</h2>
              <dl className="app-snapshot">
                {analysis.sector ? (
                  <div>
                    <dt>Sector</dt>
                    <dd>{analysis.sector}</dd>
                  </div>
                ) : null}
                {analysis.annualVolatility != null ? (
                  <div>
                    <dt>Ann. vol</dt>
                    <dd>{(analysis.annualVolatility * 100).toFixed(1)}%</dd>
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
                <p className="app-muted" style={{ marginTop: "0.75rem", lineHeight: 1.5 }}>
                  {analysis.brief.slice(0, 280)}
                  {analysis.brief.length > 280 ? "…" : ""}
                </p>
              ) : null}
            </section>
          ) : null}

          {ticker ? (
            <div className="app-action-row">
              <button
                type="button"
                className="app-btn app-btn-primary"
                onClick={() => setResearchOpen(true)}
              >
                Research…
              </button>
              {authed ? (
                <button
                  className={`app-btn ${saved ? "app-btn-active" : ""}`}
                  onClick={onSave}
                  disabled={busy === "save"}
                >
                  {busy === "save" ? "…" : saved ? "★ Saved" : "☆ Save"}
                </button>
              ) : null}
              {authed ? (
                <button
                  className="app-btn"
                  onClick={onGenerateMemo}
                  disabled={busy === "memo"}
                >
                  {busy === "memo" ? "…" : memo ? "↻ Memo" : "Memo"}
                </button>
              ) : null}
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

          <section className="app-panel">
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
                    {c.sources?.length ? (
                      <div className="app-source-links">
                        {c.sources.slice(0, 3).map((s, j) =>
                          s.url ? (
                            <a
                              key={j}
                              className="app-source-chip"
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {hostLabel(s.url)}
                            </a>
                          ) : null,
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="app-panel">
            <h2>ETF exposure</h2>
            {data.etfs.length === 0 ? (
              <p className="app-muted">No ETFs matched.</p>
            ) : (
              <ul className="app-simple-list">
                {data.etfs.map((e, i) => (
                  <li key={`${e.ticker}-${i}`}>
                    <Link href={`/app/ticker/${encodeURIComponent(e.ticker)}`}>
                      <span className="app-ticker">{e.ticker}</span>
                    </Link>{" "}
                    · {e.name}
                    {e.weight > 0 ? (
                      <span className="app-score"> · {(e.weight * 100).toFixed(2)}%</span>
                    ) : null}
                    {e.source?.url ? (
                      <div className="app-source-links">
                        <a
                          className="app-source-chip"
                          href={e.source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {hostLabel(e.source.url)}
                        </a>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section className="app-panel">
          <h2>Advanced</h2>
          <dl className="app-snapshot">
            <div>
              <dt>Resolved brand</dt>
              <dd>{brand.name}</dd>
            </div>
            <div>
              <dt>Public</dt>
              <dd>{brand.isPublic ? "yes" : "no"}</dd>
            </div>
            <div>
              <dt>Chart ticker</dt>
              <dd>{chartTicker ?? "—"}</dd>
            </div>
            <div>
              <dt>Chart type / period</dt>
              <dd>
                {chartType} · {period}
              </dd>
            </div>
            {analysis?.briefProvider ? (
              <div>
                <dt>Brief provider</dt>
                <dd>{analysis.briefProvider}</dd>
              </div>
            ) : null}
            {chart?.provider ? (
              <div>
                <dt>Chart provider</dt>
                <dd>{chart.provider}</dd>
              </div>
            ) : null}
          </dl>
          <h2 style={{ marginTop: "1.25rem" }}>Sources</h2>
          {sources.length === 0 ? (
            <p className="app-muted">No cited sources yet.</p>
          ) : (
            <ul className="app-simple-list">
              {sources.map((s, i) => (
                <li key={i}>
                  <span className="app-ticker">{s.label}</span> · {s.provider}
                  {s.url ? (
                    <>
                      {" · "}
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {hostLabel(s.url)}
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
