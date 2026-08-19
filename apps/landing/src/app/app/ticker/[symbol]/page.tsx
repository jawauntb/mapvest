"use client";

import {
  type AnalysisSnapshot,
  type ChartImage,
  type ResearchArticle,
  addToWatchlist,
  agentChat,
  fetchSettings,
  generateMemo,
  getAnalysis,
  getChart,
  getMarketEvents,
  getQuote,
  getTickerNews,
  getToken,
  listWatchlist,
  openInRobinhood,
  removeFromWatchlist,
  resolveComparable,
  saveMemoToWatchlist,
} from "@/lib/mapvest-api";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ChartFigure } from "../../ChartFigure";
import { FormattedBrief } from "../../FormattedBrief";
import { presentPaywallIfQuota, usePaywall } from "../../Paywall";
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

class ChartRenderBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <p className="app-err">
          Chart failed to render.{" "}
          <button type="button" className="app-link" onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </p>
      );
    }
    return this.props.children;
  }
}

export default function TickerDetail() {
  const params = useParams<{ symbol: string }>();
  const { presentPaywall } = usePaywall();
  const symbolOrBrand = decodeURIComponent(params.symbol ?? "");
  const urlTicker = looksLikeTicker(symbolOrBrand);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [chartTicker, setChartTicker] = useState<string | null>(() =>
    looksLikeTicker(decodeURIComponent(params.symbol ?? "")),
  );
  const [chartType, setChartType] = useState<(typeof CHART_CHIPS)[number]["id"]>("auction");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("1mo");
  const [chart, setChart] = useState<ChartImage | null>(null);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const cacheRef = useRef<ChartCache>({});
  const chartReqRef = useRef(0);
  const [analysis, setAnalysis] = useState<AnalysisSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [memo, setMemo] = useState<{ provider: string; text: string } | null>(null);
  const [memoSaved, setMemoSaved] = useState(false);
  const [busy, setBusy] = useState<"" | "memo" | "save" | "memoSave">("");
  const [tab, setTab] = useState<"overview" | "advanced">("overview");
  const [_researchOpen, setResearchOpen] = useState(false);
  const [overview, setOverview] = useState<ResearchArticle | null>(null);
  const [overviewErr, setOverviewErr] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [wantBrief, setWantBrief] = useState(false);
  const [rhLink, setRhLink] = useState<string | null>(null);
  const [marketNews, setMarketNews] = useState<Awaited<ReturnType<typeof getTickerNews>> | null>(
    null,
  );
  const [marketEvents, setMarketEvents] = useState<Awaited<
    ReturnType<typeof getMarketEvents>
  > | null>(null);
  const [marketFeedLoading, setMarketFeedLoading] = useState(false);

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
    setResolved(null);
    setErr(null);
    setQuote(null);
    setOverview(null);
    setOverviewErr(null);
    setWantBrief(false);
    setRhLink(null);
    setMarketNews(null);
    setMarketEvents(null);
    setChartTicker(urlTicker);

    resolveComparable(symbolOrBrand)
      .then((r) => {
        setResolved(r);
        // Prefer listed brand ticker, then URL symbol, then top comparable.
        // Never let a comparable steal charts for a typed ticker like MCD.
        const t = r.brand.ticker?.symbol ?? urlTicker ?? r.comparables[0]?.ticker ?? null;
        setChartTicker(t);
        if (t) {
          getAnalysis(t)
            .then(setAnalysis)
            .catch(() => {});
          if (authed) {
            // Prefer API deep-link; fall back to public RH URL when settings
            // say MCP is connected so the CTA isn't lost on a flaky 403.
            const fallback = `https://robinhood.com/us/en/stocks/${encodeURIComponent(t)}/`;
            void Promise.all([
              openInRobinhood(t).catch(() => null),
              fetchSettings().catch(() => null),
            ]).then(([rh, settings]) => {
              if (rh?.linkOut) {
                setRhLink(rh.linkOut);
                return;
              }
              if (settings?.robinhoodMcp.configured) {
                setRhLink(fallback);
                return;
              }
              setRhLink(null);
            });
          }
        }
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "resolve failed"));

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
  }, [symbolOrBrand, authed, urlTicker]);

  useEffect(() => {
    if (!chartTicker) return;
    // Overview always pins auction 1mo; Advanced follows chip/period.
    if (tab === "overview") {
      void loadChart(chartTicker, "auction", "1mo");
      return;
    }
    void loadChart(chartTicker, chartType, period);
  }, [chartTicker, chartType, period, tab, loadChart]);

  useEffect(() => {
    if (!chartTicker) return;
    let active = true;
    setMarketFeedLoading(true);
    Promise.allSettled([getTickerNews(chartTicker, 6), getMarketEvents(chartTicker, 8)])
      .then(([newsResult, eventsResult]) => {
        if (!active) return;
        if (newsResult.status === "fulfilled") setMarketNews(newsResult.value);
        if (eventsResult.status === "fulfilled") setMarketEvents(eventsResult.value);
      })
      .finally(() => {
        if (active) setMarketFeedLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chartTicker]);

  const loadOverview = useCallback(
    (ticker: string) => {
      setWantBrief(true);
      setOverviewLoading(true);
      setOverviewErr(null);
      agentChat(
        `Write a detailed investor overview of $${ticker} for the Investable sheet. Use Markdown with blank lines between sections. Required sections with ## headings: (1) What's the story now, (2) Business & moat, (3) Catalysts & risks, (4) Valuation & market context, (5) What to watch next. 450–750 words. Use short paragraphs and a few bullets under risks/catalysts. Cite tools/sources when used. Research-only; not advice; no trades.`,
        { ticker },
      )
        .then((r) => {
          setOverview(r.article);
          setOverviewErr(null);
        })
        .catch((e) => {
          if (presentPaywallIfQuota(e, presentPaywall)) {
            setOverviewErr("Free generations used. Subscribe to keep researching.");
            return;
          }
          setOverviewErr(e instanceof Error ? e.message : "overview failed");
        })
        .finally(() => setOverviewLoading(false));
    },
    [presentPaywall],
  );

  if (!resolved && !urlTicker && !err) {
    return (
      <div className="app-detail">
        <p className="app-muted">Loading…</p>
      </div>
    );
  }

  const data: Resolved = resolved ?? {
    brand: {
      name: urlTicker ?? symbolOrBrand,
      isPublic: Boolean(urlTicker),
      ticker: urlTicker ? { symbol: urlTicker } : undefined,
    },
    comparables: [],
    etfs: [],
  };

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
    setErr(null);
    setStatus(saved ? "Removing…" : "Saving…");
    const prev = saved;
    setSaved(!saved); // optimistic
    try {
      if (prev) {
        await removeFromWatchlist(ticker);
        setStatus("Removed from watchlist");
      } else {
        await addToWatchlist({
          ticker,
          name: brand.name,
          sector: brand.sector,
          source: "detail",
        });
        setStatus("★ Saved to watchlist");
      }
    } catch (e) {
      setSaved(prev);
      setErr(e instanceof Error ? e.message : "save failed");
      setStatus(null);
    } finally {
      setBusy("");
    }
  }

  async function onGenerateMemo() {
    if (!ticker) return;
    setBusy("memo");
    setErr(null);
    setStatus("Generating memo…");
    try {
      const r = await generateMemo(ticker);
      setMemo({ provider: r.provider, text: r.memo });
      setStatus("Memo ready");
    } catch (e) {
      if (presentPaywallIfQuota(e, presentPaywall)) {
        setErr("Free generations used. Subscribe to keep generating memos.");
        setStatus(null);
        return;
      }
      setErr(e instanceof Error ? e.message : "memo failed");
      setStatus(null);
    } finally {
      setBusy("");
    }
  }

  async function onSaveMemo() {
    if (!ticker || !memo) return;
    setBusy("memoSave");
    setStatus("Saving memo…");
    try {
      await addToWatchlist({
        ticker,
        name: brand.name,
        sector: brand.sector,
        source: "detail",
      });
      await saveMemoToWatchlist(ticker, memo.text, memo.provider);
      setSaved(true);
      setMemoSaved(true);
      setStatus("✓ Memo saved");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "memo save failed");
      setStatus(null);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="app-detail">
      <Link href="/app" className="app-back">
        ← Back to app
      </Link>

      {err ? (
        <p className="app-err">
          {err}{" "}
          <button type="button" className="app-link" onClick={() => window.location.reload()}>
            Retry identity
          </button>
        </p>
      ) : null}

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
          <span className="app-quote-price">
            {typeof quote.price === "number" ? `$${quote.price.toFixed(2)}` : "—"}
          </span>
          <span
            className={`app-quote-change ${quote.change >= 0 ? "app-quote-up" : "app-quote-down"}`}
          >
            {quote.change >= 0 ? "+" : ""}
            {typeof quote.change === "number" ? quote.change.toFixed(2) : "—"} (
            {typeof quote.changePct === "number" ? `${quote.changePct.toFixed(2)}%` : "—"})
          </span>
          <span className="app-quote-disc">{quote.disclaimer}</span>
        </div>
      ) : null}

      {/* Above-the-fold CTA — do not bury under agent overview. */}
      {rhLink ? (
        <div className="app-action-row" style={{ marginBottom: "0.75rem" }}>
          <a
            className="app-btn app-btn-robinhood"
            href={rhLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Robinhood →
          </a>
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
            <h2 className="app-chart-title">Auction · ${chartTicker ?? "…"} · 1mo</h2>
            {chart && !chartLoading && chart.image?.data ? (
              <ChartRenderBoundary>
                <ChartFigure
                  src={`data:${chart.image.mime};base64,${chart.image.data}`}
                  alt={`${chart.ticker} 1mo auction chart`}
                  filename={chart.image.filename ?? `${chart.ticker}-auction-1mo.png`}
                  caption={
                    chart.levels
                      ? `POC ${chart.levels.poc?.toFixed?.(2) ?? "—"} · VAH ${chart.levels.vah?.toFixed?.(2) ?? "—"} · VAL ${chart.levels.val?.toFixed?.(2) ?? "—"} · ${chart.provider ?? "yfinance"}`
                      : chart.provider
                  }
                />
              </ChartRenderBoundary>
            ) : chartErr ? (
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

          {ticker ? (
            <section className="app-panel">
              <h2>Agent overview · ${ticker}</h2>
              {!wantBrief ? (
                <button type="button" className="app-btn" onClick={() => loadOverview(ticker)}>
                  Load full brief
                </button>
              ) : overviewLoading ? (
                <p className="app-muted">Researching a longer brief…</p>
              ) : overviewErr ? (
                <p className="app-err">{overviewErr}</p>
              ) : overview ? (
                <FormattedBrief text={overview.content} />
              ) : (
                <p className="app-muted">Overview unavailable.</p>
              )}
            </section>
          ) : null}

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
            <section className="app-panel">
              <h2>News &amp; catalysts</h2>
              {marketFeedLoading ? <p className="app-muted">Loading market events…</p> : null}
              {!marketFeedLoading && !marketNews?.items.length && !marketEvents?.events.length ? (
                <p className="app-muted">No recent headlines or corporate events.</p>
              ) : (
                <div style={{ display: "grid", gap: "0.7rem" }}>
                  {marketEvents?.events.map((event, index) => (
                    <a
                      className="app-link"
                      href={event.sourceUrl}
                      key={`${event.provider ?? "event"}-${event.date}-${index}`}
                      target={event.sourceUrl ? "_blank" : undefined}
                      rel={event.sourceUrl ? "noopener noreferrer" : undefined}
                    >
                      <strong>{event.description ?? event.type.replaceAll("_", " ")}</strong>
                      <span className="app-muted">
                        {event.date ?? "date pending"} ·{" "}
                        {event.provider === "tmx" ? "TMX" : "Massive"}
                        {event.status ? ` · ${event.status}` : ""}
                      </span>
                    </a>
                  ))}
                  {marketNews?.items.map((item, index) => (
                    <a
                      className="app-link"
                      href={item.url}
                      key={`${item.url}-${index}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <strong>{item.title}</strong>
                      <span className="app-muted">
                        {item.source} · {hostLabel(item.url)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
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
                  type="button"
                  className={`app-btn ${saved ? "app-btn-active" : ""}`}
                  onClick={onSave}
                  disabled={busy === "save"}
                  aria-busy={busy === "save"}
                  aria-pressed={saved}
                >
                  {busy === "save" ? "Saving…" : saved ? "★ Saved" : "☆ Save"}
                </button>
              ) : null}
              {authed ? (
                <button
                  type="button"
                  className="app-btn"
                  onClick={onGenerateMemo}
                  disabled={busy === "memo"}
                >
                  {busy === "memo" ? "…" : memo ? "↻ Memo" : "Memo"}
                </button>
              ) : null}
            </div>
          ) : null}

          {status ? (
            <output className="app-status" aria-live="polite">
              {status}
            </output>
          ) : null}
          {err ? <p className="app-err">{err}</p> : null}

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
                  type="button"
                  className={`app-btn ${memoSaved ? "app-btn-active" : ""}`}
                  onClick={onSaveMemo}
                  disabled={busy === "memoSave" || memoSaved}
                >
                  {busy === "memoSave" ? "Saving…" : memoSaved ? "✓ Memo saved" : "💾 Save memo"}
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
                    · {c.name} <span className="app-score">{Math.round(c.score * 100)}%</span>
                    {c.sources?.length ? (
                      <div className="app-source-links">
                        {c.sources.slice(0, 3).map((s) =>
                          s.url ? (
                            <a
                              key={s.url}
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
        <>
          <section className="app-panel app-chart">
            <h2 className="app-chart-title">
              {chipLabel} · ${chartTicker ?? "…"} · {period}
            </h2>
            <div className="app-chart-chips" role="tablist" aria-label="Chart type">
              {CHART_CHIPS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`app-chip ${chartType === c.id ? "app-chip-active" : ""}`}
                  onClick={() => setChartType(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="app-chart-chips" role="tablist" aria-label="Period">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`app-chip ${period === p ? "app-chip-active" : ""}`}
                  onClick={() => setPeriod(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            {chart && !chartLoading && chart.image?.data ? (
              <ChartRenderBoundary>
                <ChartFigure
                  src={`data:${chart.image.mime};base64,${chart.image.data}`}
                  alt={`${chart.ticker} ${chipLabel} ${period} chart`}
                  filename={chart.image.filename ?? `${chart.ticker}-${chartType}-${period}.png`}
                  caption={
                    chartType === "auction" && chart.levels
                      ? `POC ${chart.levels.poc?.toFixed?.(2) ?? "—"} · VAH ${chart.levels.vah?.toFixed?.(2) ?? "—"} · VAL ${chart.levels.val?.toFixed?.(2) ?? "—"} · ${chart.provider ?? ""}`
                      : chart.provider
                  }
                />
              </ChartRenderBoundary>
            ) : chartErr ? (
              <p className="app-err">{chartErr}</p>
            ) : (
              <div className="app-chart-skel" aria-label="Loading chart" />
            )}
          </section>

          <section className="app-panel">
            <h2>Sources</h2>
            {sources.length === 0 ? (
              <p className="app-muted">No cited sources yet.</p>
            ) : (
              <ul className="app-simple-list">
                {sources.map((s) => (
                  <li key={`${s.label}-${s.provider}-${s.url ?? ""}`}>
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
        </>
      )}
    </div>
  );
}
