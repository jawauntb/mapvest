"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  addToWatchlist,
  generateMemo,
  getQuote,
  getToken,
  listWatchlist,
  removeFromWatchlist,
  resolveComparable,
  saveMemoToWatchlist,
} from "@/lib/mapvest-api";

type Resolved = Awaited<ReturnType<typeof resolveComparable>>;
type Quote = NonNullable<Awaited<ReturnType<typeof getQuote>>["quote"]>;

export default function TickerDetail() {
  const params = useParams<{ symbol: string }>();
  const symbolOrBrand = decodeURIComponent(params.symbol ?? "");
  const [data, setData] = useState<Resolved | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [memo, setMemo] = useState<{ provider: string; text: string } | null>(null);
  const [memoSaved, setMemoSaved] = useState(false);
  const [busy, setBusy] = useState<"" | "memo" | "save" | "memoSave">("");

  const authed = !!getToken();

  useEffect(() => {
    if (!symbolOrBrand) return;
    resolveComparable(symbolOrBrand)
      .then((r) => setData(r))
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
                <span className="app-ticker">{c.ticker}</span> · {c.name}{" "}
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
