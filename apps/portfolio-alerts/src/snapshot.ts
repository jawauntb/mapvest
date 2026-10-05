import {
  type AccountResponse,
  type PriceHistoryResponse,
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
  return {
    fetchedAt: opts.now.toISOString(),
    today,
    ...normalizeAccount(accountRes),
    closes,
    historyErrors,
  };
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
