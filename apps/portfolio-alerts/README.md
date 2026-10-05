# portfolio-alerts

A read-only watcher for one Schwab account. Weekdays at 12:00 ET it reads positions and balances from the Schwab Trader API and daily closes from Schwab market data. It checks the rules in one JSON config against **prior-session closes**. When a rule trips it sends email (Resend) and SMS. On days when nothing trips it sends nothing. Every Friday it sends a summary.

Every alert carries the drawdown against the loss budget (for example: `drawdown $8,000 from $80,000 = 26.7% of $30,000 loss budget · $22,000 left`).

This is not part of the Mapvest product and imports nothing from the rest of the monorepo. To move it to a private repo, copy the folder.

## Read-only, and what that does and doesn't mean

Schwab's OAuth has no read-only scope. Any app approved for "Accounts and Trading" could trade if its code tried to. Read-only is enforced in this code instead:

- `SchwabReadOnlyClient` only issues `GET`.
- It only reaches three paths: `accounts/accountNumbers`, `accounts/{hash}` and `marketdata/pricehistory`.
- There is no order code anywhere in the app. A test asserts that a full run makes only those GETs.

The suggested actions in an alert are the text you wrote in your rules. A human decides what to move.

## Rules

There is one JSON document: `PORTFOLIO_RULES_JSON` in Doppler, or `rules.json` locally (gitignored). `rules.example.json` shows every shape.

Adding a tripwire means adding an entry to `rules`. You don't touch any code.

```jsonc
{
  "id": "aapl-150",                       // lowercase-kebab, unique
  "title": "AAPL close below $150",
  "when": { "left": { "metric": "close", "symbol": "AAPL" }, "op": "<", "right": 150 },
  "action": "add a small index hedge",
  "show": [],                             // optional extra numbers to print
  "channels": ["email", "sms"],           // default both
  "repeat": "while_active",               // or "on_trip" (first day only)
  "owner": "alex",                       // optional tag shown in the alert
  "enabled": true
}
```

`when` takes one of these forms:

- A comparison: `{ left, op, right }`. `op` is `<`, `<=`, `>` or `>=`. `right` is a number or another metric.
- `{ "all": [...] }` or `{ "any": [...] }`, to combine conditions.
- `{ "positions_changed": true }`, which trips on any new, closed, increased or decreased position since the last run.

| metric | fields | value |
|---|---|---|
| `account_value` | `basis`: `prior_close` (default) or `current` | liquidation value |
| `drawdown` | | `budget.startValue − account value` |
| `budget_used_pct` | | drawdown ÷ `budget.maxLoss` × 100 |
| `close` | `symbol`, `daysAgo` (0 = last session) | daily close |
| `sma` | `symbol`, `period` | simple moving average of completed closes |
| `pct_change` | `symbol`, `days` | % change of last close vs `days` sessions earlier |
| `position_quantity` | `symbol` | shares (long − short) |
| `position_value` | `symbol` | quantity × prior close |
| `sleeve_value` | `symbols[]` | sum of position values |
| `sleeve_weight_pct` | `symbols[]` | sleeve ÷ account value × 100 |

Top-level settings: `budget.startValue`, `budget.maxLoss`, `timezone`, `runHour`, `reauthWarnHours`, and `fridaySummary`.

Some data can't be fetched, such as missing history or not enough closes for an SMA. When that happens the rule is reported as **unchecked**. It is never reported as clear.

To change the live rules:

```
doppler secrets set PORTFOLIO_RULES_JSON --project mapvest --config prd_portfolio_alerts < rules.json
```

The next cron run uses the new rules.

## Setup

1. **Schwab app.** At developer.schwab.com, create an app with *Accounts and Trading Production* and *Market Data Production*. Set the callback URL to `https://127.0.0.1`. Approval takes a few days.
2. **Doppler.** Create config `prd_portfolio_alerts` in project `mapvest`. Fill in the variables listed in `docs/SECRETS.md` under the Schwab, Resend, Twilio and `PORTFOLIO_*` rows.
3. **Log in** on your laptop. Run this now, and again at least every 7 days:
   ```
   cd apps/portfolio-alerts
   doppler run --project mapvest --config prd_portfolio_alerts -- \
     bun run auth -- --doppler mapvest/prd_portfolio_alerts
   ```
   It prints a Schwab login URL. After you approve, paste back the `https://127.0.0.1/?code=…` address. The script writes `SCHWAB_REFRESH_TOKEN`, `SCHWAB_REFRESH_TOKEN_ISSUED_AT` and, if there is one account, `SCHWAB_ACCOUNT_HASH` to Doppler. Values go to Doppler over stdin and are never printed.
4. **Check it locally** with real data, without sending anything:
   ```
   doppler run --project mapvest --config prd_portfolio_alerts -- bun run dry-run
   ```
5. **Railway.**
   - Create service `portfolio-alerts` from `infra/railway/portfolio-alerts.railway.json`. The cron is `0 16,17 * * 1-5` UTC. Railway cron runs in UTC, so it fires at both DST offsets, and the run that isn't 12:xx ET exits right away.
   - Attach a volume at `/data` and set `PORTFOLIO_ALERTS_STATE_DIR=/data`.
   - Connect the Doppler integration to `mapvest/prd_portfolio_alerts`.

Without the volume, every run starts fresh. The position diff then falls back to Schwab's previous-session quantities, which can't see a position you closed out entirely.

## The 7-day login

Schwab refresh tokens die 7 days after the browser login that created them. Only a new login fixes that.

- When the token would expire before the next run (or within `reauthWarnHours` of it), the job sends a warning. The window includes the weekend: a Monday-morning login gets its warning on Friday.
- If the token is already dead, you get a "re-auth required — alerts are paused" email and SMS, and the run exits non-zero.

## SMS

SMS uses Twilio when `TWILIO_*` and `ALERT_SMS_TO` are set. US numbers need A2P 10DLC or toll-free verification before Twilio will deliver.

The fallback is `ALERT_SMS_GATEWAY_EMAIL`, a carrier email-to-SMS address such as `5551234567@vtext.com`, sent through Resend. It costs nothing to set up, but some carriers delay or drop these messages.

## Run states and exit codes

| outcome | exit |
|---|---|
| weekend, off-hour, or already ran today | 0, `skipped` |
| nothing tripped | 0, `silent` |
| alert or Friday summary sent | 0, `alerted` |
| Schwab token dead, API error, or every channel failed | 1, `failed` (a failure alert is still attempted) |

## Develop

```
bun test apps/portfolio-alerts
bun run --filter @mapvest/portfolio-alerts typecheck
```
