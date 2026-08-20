/**
 * Company value-chain edges (Universe Roadmap §3 C1).
 *
 * One row per cited company→company relationship, written by the extraction
 * pipeline in `packages/finance/src/valueChain.ts` and read by
 * `GET /v1/graph/:ticker`. Refreshed when new filings land (the route applies
 * a 30-day freshness window), not on a short TTL.
 *
 * Postgres when POSTGRES_URL is set (Railway); in-memory fallback for local
 * tests. Table is created lazily via `CREATE TABLE IF NOT EXISTS` the first
 * time the store is touched, matching `finds-store.ts`.
 *
 * Table:
 *   company_edges(
 *     id uuid PK, src_ticker text, dst_ticker text, dst_name text,
 *     edge_type text, weight double precision, reasoning text,
 *     sources jsonb, as_of text,
 *     created_at timestamptz default now()
 *   )
 */
import type { CompanyEdge, CompanyEdgeType, Source } from "@mapvest/core";
import type { CompanyEdgeInput } from "@mapvest/finance";
import { dbEnabled, getSql, initDb } from "./db.js";

/** Memory fallback keeps edges for at most this many tickers. */
const MEMORY_TICKER_CAP = 200;

// srcTicker -> edges, insertion-ordered (oldest-inserted ticker evicted first).
const memory = new Map<string, CompanyEdge[]>();

function normalizeTicker(srcTicker: string): string {
  return srcTicker.trim().toUpperCase();
}

function memPut(key: string, edges: CompanyEdge[]): void {
  if (!memory.has(key)) {
    while (memory.size >= MEMORY_TICKER_CAP) {
      const oldest = memory.keys().next();
      if (oldest.done) break;
      memory.delete(oldest.value);
    }
  }
  memory.set(key, edges);
}

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  await initDb();
  if (!dbEnabled()) {
    tableEnsured = true;
    return;
  }
  const sql = getSql();
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS company_edges (
      id UUID PRIMARY KEY,
      src_ticker TEXT NOT NULL,
      dst_ticker TEXT,
      dst_name TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      weight DOUBLE PRECISION,
      reasoning TEXT,
      sources JSONB,
      as_of TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS company_edges_src_idx
      ON company_edges (src_ticker, created_at DESC)
  `;
  tableEnsured = true;
}

type EdgeRow = {
  id: string;
  src_ticker: string;
  dst_ticker: string | null;
  dst_name: string;
  edge_type: string;
  weight: number | string | null;
  reasoning: string | null;
  sources: unknown;
  as_of: string | null;
  created_at: Date | string;
};

function rowToEdge(row: EdgeRow): CompanyEdge {
  const createdAt =
    typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString();
  const rawWeight = typeof row.weight === "string" ? Number(row.weight) : (row.weight ?? 0);
  const sources =
    typeof row.sources === "string" ? (JSON.parse(row.sources) as Source[]) : row.sources;
  return {
    id: row.id,
    srcTicker: row.src_ticker,
    dstTicker: row.dst_ticker ?? undefined,
    dstName: row.dst_name,
    edgeType: row.edge_type as CompanyEdgeType,
    weight: Number.isFinite(rawWeight) ? Math.min(1, Math.max(0, rawWeight)) : 0,
    reasoning: row.reasoning ?? "",
    sources: Array.isArray(sources) ? (sources as Source[]) : [],
    asOf: row.as_of ?? undefined,
    createdAt,
  };
}

/**
 * Replace the whole edge set for a ticker (delete-then-insert). Returns the
 * stored edges in the order they were supplied.
 */
export async function replaceEdges(
  srcTicker: string,
  edges: CompanyEdgeInput[],
): Promise<CompanyEdge[]> {
  await ensureTable();
  const key = normalizeTicker(srcTicker);
  const createdAt = new Date().toISOString();
  const stored: CompanyEdge[] = edges.map((e) => ({
    id: crypto.randomUUID(),
    srcTicker: key,
    dstTicker: e.dstTicker,
    dstName: e.dstName,
    edgeType: e.edgeType,
    weight: e.weight,
    reasoning: e.reasoning,
    sources: e.sources,
    asOf: e.asOf,
    createdAt,
  }));

  memPut(key, stored);

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      await sql`DELETE FROM company_edges WHERE src_ticker = ${key}`;
      for (const e of stored) {
        await sql`
          INSERT INTO company_edges (
            id, src_ticker, dst_ticker, dst_name, edge_type,
            weight, reasoning, sources, as_of, created_at
          ) VALUES (
            ${e.id},
            ${e.srcTicker},
            ${e.dstTicker ?? null},
            ${e.dstName},
            ${e.edgeType},
            ${e.weight},
            ${e.reasoning},
            ${JSON.stringify(e.sources)},
            ${e.asOf ?? null},
            ${new Date(e.createdAt)}
          )
        `;
      }
    }
  }
  return stored;
}

/** All stored edges for a ticker, newest batch first. */
export async function listEdges(srcTicker: string): Promise<CompanyEdge[]> {
  await ensureTable();
  const key = normalizeTicker(srcTicker);
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        SELECT id, src_ticker, dst_ticker, dst_name, edge_type,
               weight, reasoning, sources, as_of, created_at
        FROM company_edges
        WHERE src_ticker = ${key}
        ORDER BY created_at DESC
      `;
      return (rows as EdgeRow[]).map(rowToEdge);
    }
  }
  return [...(memory.get(key) ?? [])];
}
