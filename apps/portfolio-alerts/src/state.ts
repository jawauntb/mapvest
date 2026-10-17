import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// Persisted between runs. On Railway this must sit on a volume (PORTFOLIO_ALERTS_STATE_DIR=/data);
// without one every run starts fresh and the position diff falls back to Schwab's
// previous-session quantities.

const stateSchema = z.object({
  version: z.literal(1),
  lastCompletedRun: z.object({ date: z.string(), at: z.string() }).optional(),
  // Newest last. One entry per local date.
  positions: z.array(z.object({ date: z.string(), quantities: z.record(z.number()) })).default([]),
  // Prior-close account values, for the Friday week-over-week line.
  accountValues: z.array(z.object({ date: z.string(), value: z.number() })).default([]),
  activeRules: z
    .record(z.object({ since: z.string(), lastSeen: z.string(), days: z.number() }))
    .default({}),
  // Only written if Schwab ever hands back a different refresh token than the one in env.
  schwab: z.object({ refreshToken: z.string(), issuedAt: z.string() }).optional(),
});
export type State = z.infer<typeof stateSchema>;

export const emptyState = (): State => ({
  version: 1,
  positions: [],
  accountValues: [],
  activeRules: {},
});

export interface StateStore {
  load(): Promise<State>;
  save(state: State): Promise<void>;
}

export class FileStateStore implements StateStore {
  private readonly file: string;
  constructor(private readonly dir: string) {
    this.file = join(dir, "portfolio-alerts-state.json");
  }

  async load(): Promise<State> {
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      return emptyState();
    }
    const parsed = stateSchema.safeParse(JSON.parse(text));
    if (!parsed.success)
      throw new Error(`Corrupt state file ${this.file}: ${parsed.error.message}`);
    return parsed.data;
  }

  async save(state: State): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

export class MemoryStateStore implements StateStore {
  constructor(public state: State = emptyState()) {}
  async load() {
    return structuredClone(this.state);
  }
  async save(state: State) {
    this.state = structuredClone(state);
  }
}

/** Latest saved quantities from a date strictly before `today`. */
export function baselineFor(state: State, today: string) {
  return [...state.positions].reverse().find((p) => p.date < today);
}

export function recordPositions(
  state: State,
  today: string,
  quantities: Record<string, number>,
  keep = 10,
) {
  state.positions = [
    ...state.positions.filter((p) => p.date !== today),
    { date: today, quantities },
  ]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-keep);
}

export function recordAccountValue(state: State, today: string, value: number, keep = 30) {
  state.accountValues = [
    ...state.accountValues.filter((v) => v.date !== today),
    { date: today, value },
  ]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-keep);
}

/** Latest recorded value at least 7 calendar days before `today`. */
export function weekAgoValue(state: State, today: string) {
  const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return [...state.accountValues].reverse().find((v) => v.date <= cutoff);
}
