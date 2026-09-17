/**
 * Global first capture + photo gallery (capture economy Item 3,
 * packages/design/HANDOFF_CAPTURE_ECONOMY.md). Every company gets a photo
 * gallery; the first Finder to ever submit a live-camera photo of it earns a
 * permanent, company-scoped `firstCapturedBy` badge. Postgres when
 * POSTGRES_URL is set (Railway); in-memory fallback for local tests — same
 * posture as `finds-store.ts` / `progress-store.ts` (no migrations runner,
 * `CREATE TABLE IF NOT EXISTS` on first touch).
 *
 * Company identity: `canonicalCompanyId` reuses the SAME id scheme as
 * `findIdentityKey` (finds-store.ts) / `candidateIdentityKey` (territory.ts) /
 * `identityKey` (dex.ts) — ticker, else comparable, else brand, always
 * uppercase. This module does not invent a second one.
 *
 * Tables:
 *   company_captures(
 *     company_id TEXT PRIMARY KEY,
 *     first_captured_by_user_id TEXT,
 *     first_captured_at TIMESTAMPTZ,     -- serverReceivedAt of the winner
 *     first_captured_photo_id TEXT,
 *     capture_count INTEGER NOT NULL DEFAULT 0
 *   )
 *   photo_submissions(
 *     id UUID PRIMARY KEY,
 *     company_id TEXT NOT NULL,
 *     user_id TEXT NOT NULL,
 *     photo_url TEXT NOT NULL,
 *     lat DOUBLE PRECISION, lng DOUBLE PRECISION,
 *     exif_timestamp TEXT,
 *     server_received_at TIMESTAMPTZ NOT NULL,
 *     client_request_id TEXT NOT NULL,
 *     score INTEGER NOT NULL DEFAULT 0,
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     UNIQUE (user_id, client_request_id)
 *   )
 *
 * RACE ARBITRATION (non-negotiable). `company_captures.first_captured_at`
 * always holds the MINIMUM `server_received_at` ever submitted for that
 * company — `claimFirstCapture`'s atomic UPSERT compares-and-swaps on every
 * insert, so the winner is decided by earliest server receipt, never by
 * which request's write reaches the store first. `server_received_at` is
 * stamped by THIS MODULE from the server clock; nothing here ever accepts a
 * caller-supplied value in production (the route never forwards one — the
 * optional override on `SubmitPhotoInput` exists solely so
 * `photos-store.test.ts` can construct a deterministic race). Because real
 * wall-clock time only moves forward, once the true earliest submission has
 * landed no later real request can ever have an earlier timestamp, so the
 * "never override an already-set firstCapturedBy" guarantee holds in
 * steady state while still resolving in-flight races correctly.
 *
 * IDEMPOTENCY. `client_request_id` (the client's Idempotency-Key, scoped per
 * submitting user) is unique — `submitPhoto` looks up an existing row by
 * `(userId, clientRequestId)` FIRST and returns that original result
 * untouched on a retry, rather than inserting a second row or re-arbitrating
 * first capture a second time.
 */
import { dbEnabled, getSql, initDb } from "./db.js";
import { debitXp } from "./progress-store.js";

/** XP the submitter loses each time one of their photos is downvoted. */
export const PHOTO_DOWNVOTE_XP_COST = 5;

export type FirstCapturedBy = { userId: string; at: string; photoId: string } | null;

export type PhotoSubmissionRow = {
  id: string;
  companyId: string;
  userId: string;
  photoUrl: string;
  lat?: number;
  lng?: number;
  exifTimestamp?: string;
  serverReceivedAt: string; // ISO
  clientRequestId: string;
  score: number;
  createdAt: string; // ISO
};

export type CompanyCapture = {
  companyId: string;
  firstCapturedBy: FirstCapturedBy;
  captureCount: number;
};

export type GalleryPhoto = PhotoSubmissionRow & { isFirstCapture: boolean };

export type Gallery = {
  companyId: string;
  firstCapturedBy: FirstCapturedBy;
  captureCount: number;
  photos: GalleryPhoto[];
};

/**
 * Same identity convention as `findIdentityKey` — ticker, else comparable,
 * else brand, always uppercase. The route hands this whatever the client put
 * in the `:id` path segment (already URL-decoded by the router); trimming +
 * upper-casing it here reproduces that key exactly for a ticker or an
 * already-uppercase comparable, and matches `findIdentityKey`'s brand
 * fallback (`brand.trim().toUpperCase()`) for a private brand name.
 */
export function canonicalCompanyId(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Earlier `serverReceivedAt` wins. ISO 8601 timestamps compare
 * lexicographically exactly like they compare chronologically, so a plain
 * string comparison is correct and avoids a `Date` parse on every claim.
 */
export function winsCapture(candidateAt: string, existingAt: string | null | undefined): boolean {
  if (!existingAt) return true;
  return candidateAt < existingAt;
}

// ---- memory fallback (POSTGRES_URL unset: local dev + unit tests) ----

const memCaptures = new Map<string, CompanyCapture>(); // companyId -> capture
const memPhotosByCompany = new Map<string, PhotoSubmissionRow[]>(); // companyId -> rows
const memByRequestId = new Map<string, PhotoSubmissionRow>(); // "userId::clientRequestId" -> row

function requestIdKey(userId: string, clientRequestId: string): string {
  return `${userId}::${clientRequestId}`;
}

let tableEnsured = false;
async function ensureTables(): Promise<void> {
  if (tableEnsured) return;
  await initDb();
  if (!dbEnabled()) {
    tableEnsured = true;
    return;
  }
  const sql = getSql();
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS company_captures (
      company_id TEXT PRIMARY KEY,
      first_captured_by_user_id TEXT,
      first_captured_at TIMESTAMPTZ,
      first_captured_photo_id TEXT,
      capture_count INTEGER NOT NULL DEFAULT 0
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS photo_submissions (
      id UUID PRIMARY KEY,
      company_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      photo_url TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      exif_timestamp TEXT,
      server_received_at TIMESTAMPTZ NOT NULL,
      client_request_id TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS photo_submissions_company_idx
    ON photo_submissions (company_id, score DESC, created_at ASC)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS photo_submissions_request_idx
    ON photo_submissions (user_id, client_request_id)`;
  tableEnsured = true;
}

type PhotoRowShape = {
  id: string;
  company_id: string;
  user_id: string;
  photo_url: string;
  lat: number | null;
  lng: number | null;
  exif_timestamp: string | null;
  server_received_at: Date | string;
  client_request_id: string;
  score: number;
  created_at: Date | string;
};

function isoOf(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function rowToPhoto(row: PhotoRowShape): PhotoSubmissionRow {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    photoUrl: row.photo_url,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    exifTimestamp: row.exif_timestamp ?? undefined,
    serverReceivedAt: isoOf(row.server_received_at),
    clientRequestId: row.client_request_id,
    score: Number(row.score),
    createdAt: isoOf(row.created_at),
  };
}

const PHOTO_COLUMNS = `id, company_id, user_id, photo_url, lat, lng, exif_timestamp,
           server_received_at, client_request_id, score, created_at`;

async function findByClientRequestId(
  userId: string,
  clientRequestId: string,
): Promise<PhotoSubmissionRow | undefined> {
  const fromMem = memByRequestId.get(requestIdKey(userId, clientRequestId));
  if (fromMem) return fromMem;
  if (!dbEnabled()) return undefined;
  const sql = getSql();
  if (!sql) return undefined;
  const rows = await sql`
    SELECT ${sql.unsafe(PHOTO_COLUMNS)} FROM photo_submissions
    WHERE user_id = ${userId} AND client_request_id = ${clientRequestId}
    LIMIT 1
  `;
  const row = (rows as PhotoRowShape[])[0];
  return row ? rowToPhoto(row) : undefined;
}

async function findPhotoById(id: string): Promise<PhotoSubmissionRow | undefined> {
  for (const bucket of memPhotosByCompany.values()) {
    const hit = bucket.find((p) => p.id === id);
    if (hit) return hit;
  }
  if (!dbEnabled()) return undefined;
  const sql = getSql();
  if (!sql) return undefined;
  const rows = await sql`
    SELECT ${sql.unsafe(PHOTO_COLUMNS)} FROM photo_submissions WHERE id = ${id} LIMIT 1
  `;
  const row = (rows as PhotoRowShape[])[0];
  return row ? rowToPhoto(row) : undefined;
}

/**
 * Insert a brand-new submission row. Memory-mode is the store of record when
 * POSTGRES_URL is unset (tests/local dev); the Postgres insert additionally
 * guards the same `(user_id, client_request_id)` uniqueness with
 * `ON CONFLICT DO NOTHING` so a genuinely concurrent duplicate retry at the
 * database layer never creates a second row (the caller still returns its
 * own in-memory `photo` object in that rare case — a known, narrow edge case
 * of the multi-process deployment that a single-process retry never hits).
 */
async function insertPhoto(photo: PhotoSubmissionRow): Promise<void> {
  memByRequestId.set(requestIdKey(photo.userId, photo.clientRequestId), photo);
  const bucket = memPhotosByCompany.get(photo.companyId) ?? [];
  bucket.push(photo);
  memPhotosByCompany.set(photo.companyId, bucket);

  if (!dbEnabled()) return;
  const sql = getSql();
  if (!sql) return;
  await sql`
    INSERT INTO photo_submissions (
      id, company_id, user_id, photo_url, lat, lng, exif_timestamp,
      server_received_at, client_request_id, score, created_at
    ) VALUES (
      ${photo.id}, ${photo.companyId}, ${photo.userId}, ${photo.photoUrl},
      ${photo.lat ?? null}, ${photo.lng ?? null}, ${photo.exifTimestamp ?? null},
      ${new Date(photo.serverReceivedAt)}, ${photo.clientRequestId}, ${photo.score},
      ${new Date(photo.createdAt)}
    )
    ON CONFLICT (user_id, client_request_id) DO NOTHING
  `;
}

async function adjustScore(id: string, delta: number): Promise<PhotoSubmissionRow> {
  for (const bucket of memPhotosByCompany.values()) {
    const idx = bucket.findIndex((p) => p.id === id);
    const current = bucket[idx];
    if (idx >= 0 && current) {
      const updated = { ...current, score: current.score + delta };
      bucket[idx] = updated;
      return updated;
    }
  }
  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = await sql`
        UPDATE photo_submissions SET score = score + ${delta}
        WHERE id = ${id}
        RETURNING ${sql.unsafe(PHOTO_COLUMNS)}
      `;
      const row = (rows as PhotoRowShape[])[0];
      if (row) return rowToPhoto(row);
    }
  }
  throw new Error("photo not found");
}

/**
 * First-write-wins by SERVER receipt time, not by call order — see the
 * module doc's "RACE ARBITRATION" section. Postgres path is one atomic
 * UPSERT (correct under concurrent transactions: the row lock on
 * `company_id` serializes racing writers, and each sees the previous
 * writer's committed value when evaluating its own CASE); the memory path
 * mirrors the exact same comparison synchronously (no `await` between read
 * and write), which is race-safe on Bun's single-threaded event loop.
 */
async function claimFirstCapture(
  companyId: string,
  candidate: { userId: string; at: string; photoId: string },
): Promise<CompanyCapture> {
  if (!dbEnabled()) {
    const existing = memCaptures.get(companyId);
    const wins = winsCapture(candidate.at, existing?.firstCapturedBy?.at);
    const next: CompanyCapture = {
      companyId,
      firstCapturedBy: wins
        ? { userId: candidate.userId, at: candidate.at, photoId: candidate.photoId }
        : (existing?.firstCapturedBy ?? null),
      captureCount: (existing?.captureCount ?? 0) + 1,
    };
    memCaptures.set(companyId, next);
    return next;
  }

  const sql = getSql();
  if (!sql) throw new Error("db unavailable");
  const rows = await sql`
    INSERT INTO company_captures (
      company_id, first_captured_by_user_id, first_captured_at, first_captured_photo_id, capture_count
    ) VALUES (${companyId}, ${candidate.userId}, ${new Date(candidate.at)}, ${candidate.photoId}, 1)
    ON CONFLICT (company_id) DO UPDATE SET
      capture_count = company_captures.capture_count + 1,
      first_captured_by_user_id = CASE
        WHEN EXCLUDED.first_captured_at < company_captures.first_captured_at
          THEN EXCLUDED.first_captured_by_user_id
        ELSE company_captures.first_captured_by_user_id
      END,
      first_captured_photo_id = CASE
        WHEN EXCLUDED.first_captured_at < company_captures.first_captured_at
          THEN EXCLUDED.first_captured_photo_id
        ELSE company_captures.first_captured_photo_id
      END,
      first_captured_at = LEAST(company_captures.first_captured_at, EXCLUDED.first_captured_at)
    RETURNING first_captured_by_user_id, first_captured_at, first_captured_photo_id, capture_count
  `;
  const row = (
    rows as Array<{
      first_captured_by_user_id: string;
      first_captured_at: Date | string;
      first_captured_photo_id: string;
      capture_count: number;
    }>
  )[0];
  if (!row) throw new Error("claimFirstCapture: UPSERT returned no row");
  return {
    companyId,
    firstCapturedBy: {
      userId: row.first_captured_by_user_id,
      at: isoOf(row.first_captured_at),
      photoId: row.first_captured_photo_id,
    },
    captureCount: Number(row.capture_count),
  };
}

export async function getCompanyCapture(companyId: string): Promise<CompanyCapture> {
  await ensureTables();
  if (!dbEnabled()) {
    return memCaptures.get(companyId) ?? { companyId, firstCapturedBy: null, captureCount: 0 };
  }
  const sql = getSql();
  if (!sql) return { companyId, firstCapturedBy: null, captureCount: 0 };
  const rows = await sql`
    SELECT first_captured_by_user_id, first_captured_at, first_captured_photo_id, capture_count
    FROM company_captures WHERE company_id = ${companyId} LIMIT 1
  `;
  const row = (
    rows as Array<{
      first_captured_by_user_id: string | null;
      first_captured_at: Date | string | null;
      first_captured_photo_id: string | null;
      capture_count: number;
    }>
  )[0];
  if (!row || !row.first_captured_by_user_id || !row.first_captured_at) {
    return { companyId, firstCapturedBy: null, captureCount: Number(row?.capture_count ?? 0) };
  }
  return {
    companyId,
    firstCapturedBy: {
      userId: row.first_captured_by_user_id,
      at: isoOf(row.first_captured_at),
      photoId: row.first_captured_photo_id ?? "",
    },
    captureCount: Number(row.capture_count),
  };
}

export type SubmitPhotoInput = {
  companyId: string;
  userId: string;
  photoUrl: string;
  lat?: number;
  lng?: number;
  exifTimestamp?: string;
  /** The client's Idempotency-Key for this submission attempt. */
  clientRequestId: string;
  /**
   * TEST-ONLY override of the server receipt clock. Production callers
   * (the route) never pass this — `serverReceivedAt` must always be this
   * module's own clock reading, never a client-supplied value.
   */
  serverReceivedAt?: string;
};

export type SubmitPhotoResult = {
  photo: PhotoSubmissionRow;
  isFirstCapture: boolean;
  firstCapturedBy: FirstCapturedBy;
  captureCount: number;
  /** True when this call returned an EARLIER submission's result verbatim
   *  (same clientRequestId already on file) rather than creating a new row. */
  idempotentReplay: boolean;
};

/**
 * Submit one live-camera photo for a company. Idempotent on
 * `(userId, clientRequestId)`: a retried upload after a dropped connection
 * returns the ORIGINAL result — no second row, no second first-capture
 * arbitration. Otherwise inserts the row and atomically arbitrates
 * `firstCapturedBy` (see `claimFirstCapture`).
 */
export async function submitPhoto(input: SubmitPhotoInput): Promise<SubmitPhotoResult> {
  await ensureTables();

  const existing = await findByClientRequestId(input.userId, input.clientRequestId);
  if (existing) {
    const capture = await getCompanyCapture(existing.companyId);
    return {
      photo: existing,
      isFirstCapture: capture.firstCapturedBy?.photoId === existing.id,
      firstCapturedBy: capture.firstCapturedBy,
      captureCount: capture.captureCount,
      idempotentReplay: true,
    };
  }

  const serverReceivedAt = input.serverReceivedAt ?? new Date().toISOString();
  const photo: PhotoSubmissionRow = {
    id: crypto.randomUUID(),
    companyId: input.companyId,
    userId: input.userId,
    photoUrl: input.photoUrl,
    lat: input.lat,
    lng: input.lng,
    exifTimestamp: input.exifTimestamp,
    serverReceivedAt,
    clientRequestId: input.clientRequestId,
    score: 0,
    createdAt: serverReceivedAt,
  };

  await insertPhoto(photo);
  const capture = await claimFirstCapture(input.companyId, {
    userId: input.userId,
    at: serverReceivedAt,
    photoId: photo.id,
  });

  return {
    photo,
    isFirstCapture: capture.firstCapturedBy?.photoId === photo.id,
    firstCapturedBy: capture.firstCapturedBy,
    captureCount: capture.captureCount,
    idempotentReplay: false,
  };
}

/**
 * Vote on a submission. A downvote decrements `score` AND debits the
 * SUBMITTER's XP (`PHOTO_DOWNVOTE_XP_COST`, via `progress-store.debitXp`) —
 * it never touches `firstCapturedBy`, even when the downvoted submission IS
 * the first capture: this function only ever writes `photo_submissions` and
 * the submitter's XP row, never `company_captures`.
 */
export async function voteOnPhoto(
  photoId: string,
  direction: "up" | "down",
): Promise<{ photo: PhotoSubmissionRow } | null> {
  await ensureTables();
  const existing = await findPhotoById(photoId);
  if (!existing) return null;
  const delta = direction === "up" ? 1 : -1;
  const photo = await adjustScore(photoId, delta);
  if (direction === "down") {
    await debitXp(existing.userId, PHOTO_DOWNVOTE_XP_COST);
  }
  return { photo };
}

/**
 * The gallery for a company, sorted: isFirstCapture first, then score DESC,
 * then createdAt ASC as tiebreak. This ordering IS the whole ranking system
 * for v1 — there is no separate canonical-image vote.
 */
export async function listGallery(companyId: string): Promise<Gallery> {
  await ensureTables();
  const capture = await getCompanyCapture(companyId);

  let rows: PhotoSubmissionRow[];
  if (!dbEnabled()) {
    rows = memPhotosByCompany.get(companyId) ?? [];
  } else {
    const sql = getSql();
    if (!sql) {
      rows = [];
    } else {
      const dbRows = await sql`
        SELECT ${sql.unsafe(PHOTO_COLUMNS)} FROM photo_submissions WHERE company_id = ${companyId}
      `;
      rows = (dbRows as PhotoRowShape[]).map(rowToPhoto);
    }
  }

  const isFirst = (p: PhotoSubmissionRow) => capture.firstCapturedBy?.photoId === p.id;
  const sorted = [...rows].sort((a, b) => {
    const af = isFirst(a);
    const bf = isFirst(b);
    if (af !== bf) return af ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });

  return {
    companyId,
    firstCapturedBy: capture.firstCapturedBy,
    captureCount: capture.captureCount,
    photos: sorted.map((p) => ({ ...p, isFirstCapture: isFirst(p) })),
  };
}

/** Test-only reset of every in-memory table this module owns. */
export function __resetPhotosStore(): void {
  memCaptures.clear();
  memPhotosByCompany.clear();
  memByRequestId.clear();
}
