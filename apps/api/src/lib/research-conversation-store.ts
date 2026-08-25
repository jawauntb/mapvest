/**
 * Owner-scoped references to durable Derivation Research Console conversations.
 *
 * The Console remains authoritative for messages, evidence, and execution. This
 * store keeps only the local metadata Mapvest needs to recover and list a
 * conversation. Owners are opaque `user:<id>` or `device:<id>` keys; there is
 * intentionally no users-table foreign key because anonymous devices use the
 * same persistence surface.
 *
 * Postgres is used when POSTGRES_URL is configured. Tests and local development
 * use the in-memory fallback, matching the other API stores.
 */
import type { ResearchConversationStatus } from "@mapvest/core";
import { dbEnabled, getSql, initDb } from "./db.js";

export type ResearchConversation = Readonly<{
  conversationId: string;
  ownerKey: string;
  title: string;
  preview: string;
  status: ResearchConversationStatus;
  createdAt: string;
  updatedAt: string;
}>;

export type ResearchConversationUpsert = Readonly<
  Pick<ResearchConversation, "conversationId" | "title" | "preview" | "status">
>;

export type ResearchConversationUpdate = Readonly<
  Partial<Pick<ResearchConversation, "title" | "preview" | "status">>
>;

/** Raised when a caller tries to bind another owner's conversation id. */
export class ResearchConversationOwnershipError extends Error {
  readonly code = "research_conversation_ownership_conflict" as const;
  readonly conversationId: string;

  constructor(conversationId: string) {
    super("Research conversation belongs to another owner");
    this.name = "ResearchConversationOwnershipError";
    this.conversationId = conversationId;
  }
}

type ResearchConversationRow = {
  conversation_id: string;
  owner_key: string;
  title: string;
  preview: string;
  status: ResearchConversationStatus;
  created_at: Date | string;
  updated_at: Date | string;
};

const memory = new Map<string, ResearchConversation>();

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToConversation(row: ResearchConversationRow): ResearchConversation {
  return {
    conversationId: row.conversation_id,
    ownerKey: row.owner_key,
    title: row.title,
    preview: row.preview,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function cache(conversation: ResearchConversation): ResearchConversation {
  memory.set(conversation.conversationId, conversation);
  return conversation;
}

function copy(conversation: ResearchConversation): ResearchConversation {
  return { ...conversation };
}

function sameMetadata(
  conversation: ResearchConversation,
  input: ResearchConversationUpsert,
): boolean {
  return (
    conversation.title === input.title &&
    conversation.preview === input.preview &&
    conversation.status === input.status
  );
}

/**
 * Create or refresh a reference. The conversation id may only ever retain its
 * original owner. An exact same-owner retry is a no-op, including updatedAt.
 */
export async function upsertResearchConversation(
  ownerKey: string,
  input: ResearchConversationUpsert,
  now: Date = new Date(),
): Promise<ResearchConversation> {
  await initDb();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        INSERT INTO research_conversations (
          conversation_id, owner_key, title, preview, status, created_at, updated_at
        ) VALUES (
          ${input.conversationId}, ${ownerKey}, ${input.title}, ${input.preview},
          ${input.status}, ${now}, ${now}
        )
        ON CONFLICT (conversation_id) DO UPDATE SET
          title = EXCLUDED.title,
          preview = EXCLUDED.preview,
          status = EXCLUDED.status,
          updated_at = CASE
            WHEN research_conversations.title IS DISTINCT FROM EXCLUDED.title
              OR research_conversations.preview IS DISTINCT FROM EXCLUDED.preview
              OR research_conversations.status IS DISTINCT FROM EXCLUDED.status
            THEN EXCLUDED.updated_at
            ELSE research_conversations.updated_at
          END
        WHERE research_conversations.owner_key = EXCLUDED.owner_key
        RETURNING conversation_id, owner_key, title, preview, status, created_at, updated_at
      `) as ResearchConversationRow[];

      const row = rows[0];
      if (!row) throw new ResearchConversationOwnershipError(input.conversationId);
      return copy(cache(rowToConversation(row)));
    }
  }

  const existing = memory.get(input.conversationId);
  if (existing && existing.ownerKey !== ownerKey) {
    throw new ResearchConversationOwnershipError(input.conversationId);
  }
  if (existing && sameMetadata(existing, input)) return copy(existing);

  const timestamp = now.toISOString();
  const conversation: ResearchConversation = {
    conversationId: input.conversationId,
    ownerKey,
    title: input.title,
    preview: input.preview,
    status: input.status,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  return copy(cache(conversation));
}

/** Update selected metadata only when the caller owns the conversation. */
export async function updateResearchConversation(
  ownerKey: string,
  conversationId: string,
  patch: ResearchConversationUpdate,
  now: Date = new Date(),
): Promise<ResearchConversation | null> {
  await initDb();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const title = patch.title ?? null;
      const preview = patch.preview ?? null;
      const status = patch.status ?? null;
      const rows = (await sql`
        UPDATE research_conversations SET
          title = COALESCE(${title}, title),
          preview = COALESCE(${preview}, preview),
          status = COALESCE(${status}, status),
          updated_at = CASE
            WHEN (${title}::text IS NOT NULL AND title IS DISTINCT FROM ${title}::text)
              OR (${preview}::text IS NOT NULL AND preview IS DISTINCT FROM ${preview}::text)
              OR (${status}::text IS NOT NULL AND status IS DISTINCT FROM ${status}::text)
            THEN ${now}
            ELSE updated_at
          END
        WHERE conversation_id = ${conversationId} AND owner_key = ${ownerKey}
        RETURNING conversation_id, owner_key, title, preview, status, created_at, updated_at
      `) as ResearchConversationRow[];
      const row = rows[0];
      return row ? copy(cache(rowToConversation(row))) : null;
    }
  }

  const existing = memory.get(conversationId);
  if (!existing || existing.ownerKey !== ownerKey) return null;
  const changed =
    (patch.title !== undefined && patch.title !== existing.title) ||
    (patch.preview !== undefined && patch.preview !== existing.preview) ||
    (patch.status !== undefined && patch.status !== existing.status);
  if (!changed) return copy(existing);

  const conversation: ResearchConversation = {
    ...existing,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.preview !== undefined ? { preview: patch.preview } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updatedAt: now.toISOString(),
  };
  return copy(cache(conversation));
}

/** Get one conversation only when it belongs to the supplied owner. */
export async function getResearchConversation(
  ownerKey: string,
  conversationId: string,
): Promise<ResearchConversation | null> {
  await initDb();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT conversation_id, owner_key, title, preview, status, created_at, updated_at
        FROM research_conversations
        WHERE conversation_id = ${conversationId} AND owner_key = ${ownerKey}
        LIMIT 1
      `) as ResearchConversationRow[];
      const row = rows[0];
      return row ? copy(cache(rowToConversation(row))) : null;
    }
  }

  const conversation = memory.get(conversationId);
  return conversation?.ownerKey === ownerKey ? copy(conversation) : null;
}

/** List one owner's conversations by latest activity, newest first. */
export async function listResearchConversations(ownerKey: string): Promise<ResearchConversation[]> {
  await initDb();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        SELECT conversation_id, owner_key, title, preview, status, created_at, updated_at
        FROM research_conversations
        WHERE owner_key = ${ownerKey}
        ORDER BY updated_at DESC, created_at DESC, conversation_id DESC
      `) as ResearchConversationRow[];
      return rows.map((row) => copy(cache(rowToConversation(row))));
    }
  }

  return [...memory.values()]
    .filter((conversation) => conversation.ownerKey === ownerKey)
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.conversationId.localeCompare(left.conversationId),
    )
    .map(copy);
}

/**
 * Move one anonymous device conversation into an authenticated user's scope.
 * Callers must prove both identities on the same request before invoking this.
 */
export async function claimResearchConversation(
  fromOwnerKey: string,
  toOwnerKey: string,
  conversationId: string,
): Promise<ResearchConversation | null> {
  if (fromOwnerKey === toOwnerKey) return getResearchConversation(toOwnerKey, conversationId);
  await initDb();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        UPDATE research_conversations
        SET owner_key = ${toOwnerKey}
        WHERE conversation_id = ${conversationId} AND owner_key = ${fromOwnerKey}
        RETURNING conversation_id, owner_key, title, preview, status, created_at, updated_at
      `) as ResearchConversationRow[];
      const row = rows[0];
      return row ? copy(cache(rowToConversation(row))) : null;
    }
  }

  const existing = memory.get(conversationId);
  if (!existing || existing.ownerKey !== fromOwnerKey) return null;
  return copy(cache({ ...existing, ownerKey: toOwnerKey }));
}

/** Claim all conversations created anonymously on the caller's current device. */
export async function claimResearchConversations(
  fromOwnerKey: string,
  toOwnerKey: string,
): Promise<number> {
  if (fromOwnerKey === toOwnerKey) return 0;
  await initDb();

  if (dbEnabled()) {
    const sql = getSql();
    if (sql) {
      const rows = (await sql`
        UPDATE research_conversations
        SET owner_key = ${toOwnerKey}
        WHERE owner_key = ${fromOwnerKey}
        RETURNING conversation_id, owner_key, title, preview, status, created_at, updated_at
      `) as ResearchConversationRow[];
      for (const row of rows) cache(rowToConversation(row));
      return rows.length;
    }
  }

  let claimed = 0;
  for (const conversation of memory.values()) {
    if (conversation.ownerKey !== fromOwnerKey) continue;
    cache({ ...conversation, ownerKey: toOwnerKey });
    claimed += 1;
  }
  return claimed;
}

/** Test-only hook for the in-memory fallback. */
export function __resetResearchConversationStore(): void {
  memory.clear();
}
