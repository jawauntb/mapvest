// Futures symbols for Schwab quotes.
//   "/SB", "/ZS"        a root; Schwab answers with its active contract
//   "/VXX26"            an explicit contract (root + month code + 2-digit year)
//   "/VX@1", "/VX@2"    the 1st / 2nd VIX futures contract that has not yet expired,
//                       computed from the CFE calendar below

const MONTH_CODES = "FGHJKMNQUVXZ";

const iso = (d: Date) => d.toISOString().slice(0, 10);

function thirdFriday(year: number, month: number): Date {
  // month is 1-12
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (5 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + 14));
}

/**
 * Final settlement date of the VIX futures contract for `month`: the Wednesday 30 days before
 * the third Friday of the following month. CFE moves it a business day earlier when that
 * Friday is an exchange holiday; that rare case isn't modelled.
 */
export function vixExpiry(year: number, month: number): string {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const friday = thirdFriday(nextYear, nextMonth);
  return iso(new Date(friday.getTime() - 30 * 86_400_000));
}

/** The nth (1-based) monthly VIX contract still trading after `today` (YYYY-MM-DD). */
export function vixContract(n: number, today: string): { symbol: string; expiry: string } {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  let found = 0;
  for (let i = 0; i < 24; i++) {
    const expiry = vixExpiry(year, month);
    // Settles at the open on expiry day, so a noon run already treats it as gone.
    if (expiry > today) {
      found++;
      if (found === n) {
        return { symbol: `/VX${MONTH_CODES[month - 1]}${String(year).slice(2)}`, expiry };
      }
    }
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  throw new Error(`no VIX contract #${n} after ${today}`);
}

export type ResolvedQuoteSymbol = { requested: string; symbol: string; note?: string };

export function resolveQuoteSymbol(requested: string, today: string): ResolvedQuoteSymbol {
  const vx = /^\/VX@([1-9])$/.exec(requested);
  if (vx) {
    const c = vixContract(Number(vx[1]), today);
    return { requested, symbol: c.symbol, note: `${c.symbol.slice(1)}, expires ${c.expiry}` };
  }
  if (/@/.test(requested)) {
    throw new Error(`${requested}: only /VX@n is supported; use a root like /SB or a contract`);
  }
  return { requested, symbol: requested };
}
