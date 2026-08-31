"use client";

import { type ChartImage, type ResearchArticle, agentChat, getChart } from "@/lib/mapvest-api";
import { providerPresentationLabel } from "@/lib/provider-presentation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChartFigure } from "./ChartFigure";
import { FormattedBrief } from "./FormattedBrief";
import { presentPaywallIfQuota, usePaywall } from "./Paywall";
import { withOccurrenceKeys } from "./stableListKeys";

/**
 * Progressive research surface — opened from ticker detail, not a top-level tab.
 * Renders assistant turns as short financial-news articles (lede + evidence),
 * with lazy chart embeds for cited tickers. History lives under Saved → Briefs.
 */

export function ResearchPanel({
  ticker,
  open,
  onClose,
  initialThreadId,
}: {
  ticker: string;
  open: boolean;
  onClose: () => void;
  initialThreadId?: string;
}) {
  const [threadId, setThreadId] = useState<string | undefined>(initialThreadId);
  const [turns, setTurns] = useState<ResearchArticle[]>([]);
  const [input, setInput] = useState(`What’s the story on $${ticker}?`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [charts, setCharts] = useState<Record<string, ChartImage>>({});
  const { presentPaywall } = usePaywall();

  useEffect(() => {
    if (!open) return;
    setThreadId(initialThreadId);
    if (!initialThreadId) {
      setTurns([]);
      setInput(`What’s the story on $${ticker}?`);
    }
  }, [open, ticker, initialThreadId]);

  async function ensureCharts(syms: string[]) {
    const need = syms.filter((s) => !charts[s]).slice(0, 3);
    if (!need.length) return;
    const entries = await Promise.all(
      need.map(async (s) => {
        try {
          const c = await getChart("auction", s, { period: "1mo" });
          return [s, c] as const;
        } catch {
          return null;
        }
      }),
    );
    setCharts((prev) => {
      const next = { ...prev };
      for (const e of entries) if (e) next[e[0]] = e[1];
      return next;
    });
  }

  async function onSend() {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    setErr(null);
    setStatus("Researching… tools running");
    const optimistic: ResearchArticle = {
      id: `local-${Date.now()}`,
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
      interesting: [],
      ideas: [],
      toolsUsed: [],
      sources: [],
      chartTickers: [ticker],
    };
    setTurns((t) => [...t, optimistic]);
    setInput("");
    try {
      const r = await agentChat(msg, { ticker, threadId });
      if (r.threadId) setThreadId(r.threadId);
      setTurns((t) => [...t, r.article]);
      void ensureCharts(r.article.chartTickers.length ? r.article.chartTickers : [ticker]);
      const tools = r.article.toolsUsed?.length
        ? ` · ${r.article.toolsUsed.slice(0, 3).map(providerPresentationLabel).join(", ")}`
        : "";
      setStatus(`Brief ready${tools}`);
    } catch (e) {
      if (presentPaywallIfQuota(e, presentPaywall)) {
        setErr("Free generations used. Subscribe to keep researching.");
        setStatus(null);
        return;
      }
      setErr(e instanceof Error ? e.message : "research failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <section className="app-research" aria-label="Research brief">
      <div className="app-research-bar">
        <div>
          <div className="app-research-kicker">Research · ${ticker}</div>
          <div className="app-muted" style={{ fontSize: "0.8rem" }}>
            Reads like a brief · tools run in the background · not investment advice
          </div>
        </div>
        <button type="button" className="app-btn" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="app-research-stream">
        {turns.length === 0 ? (
          <p className="app-muted">
            Ask a focused question. You’ll get a lede, evidence, optional charts, and sources — not
            a chat dump.
          </p>
        ) : null}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="app-research-q">
              {t.content}
            </div>
          ) : (
            <Article key={t.id} article={t} charts={charts} />
          ),
        )}
        {busy ? (
          <output className="app-status" aria-live="polite">
            {status ?? "Researching…"}
          </output>
        ) : status ? (
          <output className="app-status">{status}</output>
        ) : null}
        {busy ? <div className="app-chart-skel" aria-label="Researching…" /> : null}
        {err ? <p className="app-err">{err}</p> : null}
      </div>

      <div className="app-research-composer">
        <input
          className="app-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          placeholder={`Ask about $${ticker}…`}
          disabled={busy}
        />
        <button
          type="button"
          className="app-btn app-btn-primary"
          onClick={() => void onSend()}
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : "Ask"}
        </button>
      </div>
    </section>
  );
}

function Article({
  article,
  charts,
}: {
  article: ResearchArticle;
  charts: Record<string, ChartImage>;
}) {
  return (
    <article className="app-article">
      <FormattedBrief text={article.content} />

      {article.chartTickers.slice(0, 2).map((sym) => {
        const c = charts[sym];
        return (
          <div key={sym} className="app-article-chart">
            <div className="app-article-chart-cap">
              <Link href={`/app/ticker/${encodeURIComponent(sym)}`}>${sym}</Link>
              <span className="app-muted"> · 1mo auction</span>
            </div>
            {c ? (
              <ChartFigure
                src={`data:${c.image.mime};base64,${c.image.data}`}
                alt={`${sym} auction`}
                filename={c.image.filename ?? `${sym}-auction-1mo.png`}
              />
            ) : (
              <div className="app-chart-skel" style={{ maxHeight: 160 }} />
            )}
          </div>
        );
      })}

      {article.interesting.length > 0 ? (
        <ul className="app-article-bullets">
          {withOccurrenceKeys(article.interesting.slice(0, 5), (item) => item).map(
            ({ key, value: item }) => (
              <li key={key}>{item}</li>
            ),
          )}
        </ul>
      ) : null}

      {article.ideas.length > 0 ? (
        <div className="app-article-ideas">
          {withOccurrenceKeys(
            article.ideas.slice(0, 3),
            (idea) => `${idea.title}:${idea.disposition ?? ""}:${idea.thesis ?? ""}`,
          ).map(({ key, value: idea }) => (
            <div key={key} className="app-article-idea">
              <strong>{idea.title}</strong>
              {idea.disposition ? <span className="app-muted"> · {idea.disposition}</span> : null}
              {idea.thesis ? <p className="app-muted">{idea.thesis}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {article.sources.length > 0 ? (
        <div className="app-source-links">
          {withOccurrenceKeys(
            article.sources.slice(0, 6),
            (source) => `${source.url ?? ""}:${source.label}`,
          ).map(({ key, value: s }) =>
            s.url ? (
              <a
                key={key}
                className="app-source-chip"
                href={s.url}
                target="_blank"
                rel="noreferrer"
              >
                {providerPresentationLabel(s.label)}
              </a>
            ) : (
              <span key={key} className="app-source-chip">
                {providerPresentationLabel(s.label)}
              </span>
            ),
          )}
        </div>
      ) : null}

      {article.toolsUsed.length > 0 ? (
        <p className="app-article-tools">
          Tools · {article.toolsUsed.slice(0, 6).map(providerPresentationLabel).join(" · ")}
        </p>
      ) : null}
    </article>
  );
}
