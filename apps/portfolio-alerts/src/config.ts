import { readFileSync } from "node:fs";
import { z } from "zod";

// The whole rule set lives in one JSON document (see rules.example.json).
// Adding a tripwire means adding an entry to `rules`, never touching code.

const symbol = z
  .string()
  .trim()
  .min(1)
  .transform((s) => s.toUpperCase());

export const metricSchema = z.discriminatedUnion("metric", [
  // Liquidation value. prior_close = Schwab's start-of-day balance (yesterday's close).
  z.object({
    metric: z.literal("account_value"),
    basis: z.enum(["prior_close", "current"]).default("prior_close"),
  }),
  // Dollars below budget.startValue (negative when the account is up).
  z.object({ metric: z.literal("drawdown") }),
  // drawdown / budget.maxLoss * 100.
  z.object({ metric: z.literal("budget_used_pct") }),
  // Daily close. daysAgo 0 = the most recent completed session.
  z.object({
    metric: z.literal("close"),
    symbol,
    daysAgo: z.number().int().min(0).max(200).default(0),
  }),
  // Simple moving average of the last `period` completed closes.
  z.object({ metric: z.literal("sma"), symbol, period: z.number().int().min(2).max(200) }),
  // Percent change of the latest close vs the close `days` sessions earlier.
  z.object({ metric: z.literal("pct_change"), symbol, days: z.number().int().min(1).max(200) }),
  z.object({ metric: z.literal("position_quantity"), symbol }),
  // Quantity x prior close.
  z.object({ metric: z.literal("position_value"), symbol }),
  z.object({ metric: z.literal("sleeve_value"), symbols: z.array(symbol).min(1) }),
  // Sleeve value as a percent of prior-close account value.
  z.object({ metric: z.literal("sleeve_weight_pct"), symbols: z.array(symbol).min(1) }),
]);
export type Metric = z.infer<typeof metricSchema>;

export const comparisonOps = ["<", "<=", ">", ">="] as const;
export type ComparisonOp = (typeof comparisonOps)[number];

export type Condition =
  | { left: Metric; op: ComparisonOp; right: number | Metric }
  | { all: Condition[] }
  | { any: Condition[] }
  | { positions_changed: true };

// Input type differs from output (defaults), so annotate loosely and narrow via z.infer below.
export const conditionSchema: z.ZodType<Condition, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    z.object({
      left: metricSchema,
      op: z.enum(comparisonOps),
      right: z.union([z.number(), metricSchema]),
    }),
    z.object({ all: z.array(conditionSchema).min(1) }).strict(),
    z.object({ any: z.array(conditionSchema).min(1) }).strict(),
    z.object({ positions_changed: z.literal(true) }).strict(),
  ]),
);

export const channelSchema = z.enum(["email", "sms"]);
export type Channel = z.infer<typeof channelSchema>;

export const ruleSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase-kebab ids"),
  title: z.string().optional(),
  enabled: z.boolean().default(true),
  when: conditionSchema,
  // What to consider doing. Alerts are advice for a human; this job never trades.
  action: z.string().min(1),
  // Extra numbers printed with the alert (e.g. current sleeve value).
  show: z.array(metricSchema).default([]),
  channels: z.array(channelSchema).min(1).default(["email", "sms"]),
  // while_active: alert every run while the condition holds. on_trip: only the first run.
  repeat: z.enum(["while_active", "on_trip"]).default("while_active"),
  // Free-form owner tag, to keep track of whose tripwire it is.
  owner: z.string().optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const configSchema = z
  .object({
    version: z.literal(1),
    timezone: z.string().default("America/New_York"),
    // Local hour (in `timezone`) the job is allowed to run. Railway cron is UTC, so the
    // schedule fires at both DST offsets and the off-hour run exits early.
    runHour: z.number().int().min(0).max(23).default(12),
    budget: z.object({
      startValue: z.number().positive(),
      maxLoss: z.number().positive(),
    }),
    reauthWarnHours: z.number().positive().default(48),
    fridaySummary: z
      .object({
        enabled: z.boolean().default(true),
        channels: z.array(channelSchema).min(1).default(["email", "sms"]),
      })
      .default({}),
    rules: z.array(ruleSchema),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (const [i, rule] of cfg.rules.entries()) {
      if (seen.has(rule.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", i, "id"],
          message: `duplicate rule id "${rule.id}"`,
        });
      }
      seen.add(rule.id);
    }
  });
export type AlertConfig = z.infer<typeof configSchema>;

export function parseConfig(raw: unknown): AlertConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid portfolio alert rules:\n${issues}`);
  }
  return result.data;
}

/**
 * PORTFOLIO_RULES_JSON (inline, how Railway gets it from Doppler) wins over
 * PORTFOLIO_RULES_PATH (a local file, default ./rules.json, gitignored).
 */
export function loadConfig(env: Record<string, string | undefined>): AlertConfig {
  const inline = env.PORTFOLIO_RULES_JSON?.trim();
  if (inline) return parseConfig(JSON.parse(inline));
  const path = env.PORTFOLIO_RULES_PATH?.trim() || "rules.json";
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `No rules found: set PORTFOLIO_RULES_JSON or create ${path} (copy rules.example.json).`,
    );
  }
  return parseConfig(JSON.parse(text));
}

/** Every symbol whose daily history a config needs, and the deepest lookback. */
export function historyNeeds(cfg: AlertConfig): { symbols: string[]; lookback: number } {
  const symbols = new Set<string>();
  let lookback = 1;
  const visitMetric = (m: Metric) => {
    switch (m.metric) {
      case "close":
        symbols.add(m.symbol);
        lookback = Math.max(lookback, m.daysAgo + 1);
        break;
      case "sma":
        symbols.add(m.symbol);
        lookback = Math.max(lookback, m.period);
        break;
      case "pct_change":
        symbols.add(m.symbol);
        lookback = Math.max(lookback, m.days + 1);
        break;
      case "position_value":
        symbols.add(m.symbol);
        break;
      case "sleeve_value":
      case "sleeve_weight_pct":
        for (const s of m.symbols) symbols.add(s);
        break;
      default:
        break;
    }
  };
  const visit = (c: Condition) => {
    if ("left" in c) {
      visitMetric(c.left);
      if (typeof c.right !== "number") visitMetric(c.right);
    } else if ("all" in c) c.all.forEach(visit);
    else if ("any" in c) c.any.forEach(visit);
  };
  for (const rule of cfg.rules) {
    if (!rule.enabled) continue;
    visit(rule.when);
    rule.show.forEach(visitMetric);
  }
  return { symbols: [...symbols].sort(), lookback };
}
