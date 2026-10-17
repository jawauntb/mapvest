import { type ResolvedQuoteSymbol, resolveQuoteSymbol } from "./futures.js";
import {
  type AccountResponse,
  type PriceHistoryResponse,
  type QuotesResponse,
  type SchwabReadOnlyClient,
  maskAccountNumber,
} from "./schwab/client.js";
import { localDate } from "./time.js";

export type Position = {
  symbol: string;
  assetType?: string;
  description?: string;
  quantity: number; // long - short
  previousSessionQuantity?: number;
  marketValue?: number; // Schwab's live value at fetch time
};

export type DailyClose = { date: string; close: number };

/** Everything one run reads from Schwab, normalized. Rules evaluate against this only. */
export type Snapshot = {
  fetchedAt: string; // ISO
  today: string; // local date of the run
  account: {
    number: string; // masked
    priorCloseValue?: number;
    currentValue?: number;
  };
  positions: Position[];
  // Completed sessions only (date < today), oldest first.
  closes: Record<string, DailyClose[]>;
  historyErrors: Record<string, string>;
  // Keyed by the symbol as written in the config ("/VX@1", "/SB", …).
  quotes: Record<string, Quote>;
  quoteErrors: Record<string, string>;
};

export type Quote = {
  symbol: string; // what Schwab was asked for
  contract?: string; // active contract Schwab reports for a root, or the computed one
  note?: string;
  last?: number;
  priorClose?: number;
};

export function normalizeAccount(res: AccountResponse): Pick<Snapshot, "account" | "positions"> {
  const acct = res.securitiesAccount;
  const positions: Position[] = (acct.positions ?? []).map((p) => {
    const quantity = (p.longQuantity ?? 0) - (p.shortQuantity ?? 0);
    const hasPrev =
      p.previousSessionLongQuantity !== undefined || p.previousSessionShortQuantity !== undefined;
    return {
      symbol: p.instrument.symbol.toUpperCase(),
      assetType: p.instrument.assetType,
      description: p.instrument.description,
      quantity,
      previousSessionQuantity: hasPrev
        ? (p.previousSessionLongQuantity ?? 0) - (p.previousSessionShortQuantity ?? 0)
        : undefined,
      marketValue: p.marketValue,
    };
  });
  return {
    account: {
      number: maskAccountNumber(acct.accountNumber),
      // initialBalances is Schwab's start-of-day snapshot, i.e. the prior session's close.
      priorCloseValue: acct.initialBalances?.liquidationValue,
      currentValue: acct.currentBalances?.liquidationValue,
    },
    positions,
  };
}

export function completedCloses(
  res: PriceHistoryResponse,
  today: string,
  timeZone: string,
): DailyClose[] {
  return res.candles
    .map((c) => ({ date: localDate(new Date(c.datetime), timeZone), close: c.close }))
    .filter((c) => c.date < today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function fetchSnapshot(opts: {
  client: SchwabReadOnlyClient;
  accountHash: string;
  symbols: string[];
  quoteSymbols?: string[];
  now: Date;
  timeZone: string;
}): Promise<Snapshot> {
  const today = localDate(opts.now, opts.timeZone);
  const accountRes = await opts.client.account(opts.accountHash);
  const closes: Snapshot["closes"] = {};
  const historyErrors: Snapshot["historyErrors"] = {};
  await Promise.all(
    opts.symbols.map(async (symbol) => {
      try {
        const res = await opts.client.dailyHistory(symbol);
        closes[symbol] = completedCloses(res, today, opts.timeZone);
      } catch (err) {
        historyErrors[symbol] = err instanceof Error ? err.message : String(err);
      }
    }),
  );
  const { quotes, quoteErrors } = await fetchQuotes(opts.client, opts.quoteSymbols ?? [], today);
  return {
    fetchedAt: opts.now.toISOString(),
    today,
    ...normalizeAccount(accountRes),
    closes,
    historyErrors,
    quotes,
    quoteErrors,
  };
}

export function normalizeQuotes(
  res: QuotesResponse,
  resolved: ResolvedQuoteSymbol[],
): Pick<Snapshot, "quotes" | "quoteErrors"> {
  const quotes: Snapshot["quotes"] = {};
  const quoteErrors: Snapshot["quoteErrors"] = {};
  for (const r of resolved) {
    const entry = res[r.symbol];
    const q = entry?.quote;
    if (!q || (q.lastPrice === undefined && q.closePrice === undefined)) {
      quoteErrors[r.requested] = `no Schwab quote for ${r.symbol}`;
      continue;
    }
    const active = entry.reference?.futureActiveSymbol;
    quotes[r.requested] = {
      symbol: r.symbol,
      contract: active && active !== r.symbol ? active : undefined,
      note: r.note,
      last: q.lastPrice ?? q.mark,
      priorClose: q.closePrice,
    };
  }
  return { quotes, quoteErrors };
}

async function fetchQuotes(
  client: SchwabReadOnlyClient,
  requested: string[],
  today: string,
): Promise<Pick<Snapshot, "quotes" | "quoteErrors">> {
  if (requested.length === 0) return { quotes: {}, quoteErrors: {} };
  const resolved: ResolvedQuoteSymbol[] = [];
  const quoteErrors: Snapshot["quoteErrors"] = {};
  for (const sym of requested) {
    try {
      resolved.push(resolveQuoteSymbol(sym, today));
    } catch (err) {
      quoteErrors[sym] = err instanceof Error ? err.message : String(err);
    }
  }
  try {
    const res = await client.quotes(resolved.map((r) => r.symbol));
    const out = normalizeQuotes(res, resolved);
    return { quotes: out.quotes, quoteErrors: { ...quoteErrors, ...out.quoteErrors } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const r of resolved) quoteErrors[r.requested] = msg;
    return { quotes: {}, quoteErrors };
  }
}

export async function resolveAccountHash(
  client: SchwabReadOnlyClient,
  configured: string | undefined,
): Promise<string> {
  if (configured) return configured;
  const accounts = await client.accountNumbers();
  if (accounts.length === 1 && accounts[0]) return accounts[0].hashValue;
  const listed = accounts.map((a) => maskAccountNumber(a.accountNumber)).join(", ");
  throw new Error(
    accounts.length === 0
      ? "Schwab returned no linked accounts."
      : `Schwab has ${accounts.length} accounts (${listed}); set SCHWAB_ACCOUNT_HASH (run \`bun run auth\` to list hashes).`,
  );
}
