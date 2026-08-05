"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  addToWatchlist,
  generateMemo,
  getAuctionChart,
  getQuote,
  getToken,
  listWatchlist,
  removeFromWatchlist,
  resolveComparable,
  saveMemoToWatchlist,
  type AuctionChart,
} from "@/lib/mapvest-api";

type Resolved = Awaited<ReturnType<typeof resolveComparable>>;
type Quote = NonNullable<Awaited<ReturnType<typeof getQuote>>["quote"]>;

export default function TickerDetail() {
  const params = useParams<{ symbol: string }>();
  const symbolOrBrand = decodeURIComponent(params.symbol ?? "");
  const [data, setData] = useState<Resolved | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [chart, setChart] = useState<AuctionChart | null>(null);
  const [chartErr, setChartErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [memo, setMemo] = useState<{ provider: string; text: string } | null>(null);
  const [memoSaved, setMemoSaved] = useState(false);
  const [busy, setBusy] = useState<"" | "memo" | "save" | "memoSave">("");

  const authed = !!getToken();

  useEffect(() => {
    if (!symbolOrBrand) return;
    setChart(null);
    setChartErr(null);
    resolveComparable(symbolOrBrand)
      .then((r) => {
        setData(r);
        const chartTicker =
          r.brand.ticker?.symbol ??
          r.comparables[0]?.ticker ??
          (/^[A-Z][A-Z0-9.]{0,5}$/.test(symbolOrBrand.toUpperCase())
            ? symbolOrBrand.toUpperCase()
            : null);
        if (chartTicker) {
          getAuctionChart(chartTicker, "1m")
            .then(setChart)
            .catch((e) => setChartErr(e instanceof Error ? e.message : "chart failed"));
        }
      })
      .catch((e) => setErr(e.message));
    getQuote(symbolOrBrand)
      .then((r) => r.quote && setQuote(r.quote))
      .catch(() => {}); // quote is best-effort
    if (authed) {
      listWatchlist()
        .then((wl) => setSaved(wl.items.some((it) => it.ticker.toUpperCase() === symbolOrBrand.toUpperCase())))
        .catch(() => {});
    }
  }, [symbolOrBrand, authed]);

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
      // ensure ticker is in the watchlist first (add is idempotent)
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
          Auction chart · {chart?.ticker ?? ticker ?? "…"} · {chart?.period ?? "1m"}
        </h2>
        {chart ? (
          <>
            <img
              className="app-chart-img"
              alt={`${chart.ticker} 1m auction chart`}
              src={`data:${chart.image.mime};base64,${chart.image.data}`}
            />
            {chart.levels ? (
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
          <p className="app-muted">Loading 1m auction chart…</p>
        )}
      </section>

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
