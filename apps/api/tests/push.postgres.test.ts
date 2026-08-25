import { beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";

const databaseUrl = process.env.POSTGRES_URL;

// This file is run in CI's dedicated push-postgres job. Keep local `bun test`
// useful without requiring a daemon by skipping when no URL was supplied.
if (!databaseUrl) {
  describe.skip("push Postgres integration (POSTGRES_URL unset)", () => {
    test("requires the dedicated Postgres job", () => undefined);
  });
} else {
  process.env.NODE_ENV = "test";
  const sql = new SQL(databaseUrl);
  const {
    _failNextPushClaimUpsertForTest,
    _resetPushTokenMemory,
    claimPushDelivery,
    finalizePushDelivery,
    listTokensForEvent,
    listTokensForUser,
    registerPushToken,
    unregisterPushToken,
    unregisterPushTokenByIdentity,
    updatePrefs,
  } = await import("../src/lib/push-tokens-store.js");

  const expoToken = () => `ExponentPushToken[${crypto.randomUUID()}]`;
  const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

  async function resetTables(): Promise<void> {
    await sql`DROP TABLE IF EXISTS push_delivery_claims, push_token_claims, push_tokens CASCADE`;
    _resetPushTokenMemory();
  }

  beforeEach(resetTables);

  test("lazy migration elects one legacy owner and mutes every unclaimed row", async () => {
    const physicalToken = expoToken();
    const older = id("old");
    const newer = id("new");
    await sql`
      CREATE TABLE push_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT,
        expo_token TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'ios',
        prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_seen_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `;
    await sql`
      INSERT INTO push_tokens
        (id, user_id, expo_token, prefs, last_seen_at, created_at)
      VALUES
        (${older}, 'account-a', ${physicalToken}, '{"notifications_enabled":true,"daily_brief":true}', now() - interval '1 hour', now()),
        (${newer}, 'account-b', ${physicalToken}, '{"notifications_enabled":true,"daily_brief":true}', now(), now())
    `;

    const selected = await listTokensForEvent("daily_brief");
    expect(selected.map((token) => token.id)).toEqual([newer]);
    const rows = (await sql`
      SELECT id, prefs FROM push_tokens WHERE expo_token = ${physicalToken} ORDER BY id
    `) as Array<{ id: string; prefs: Record<string, unknown> }>;
    expect(rows.find((row) => row.id === older)?.prefs.daily_brief).toBe(false);
    expect(rows.find((row) => row.id === older)?.prefs.notifications_enabled).toBe(false);
    expect(rows.find((row) => row.id === newer)?.prefs.daily_brief).toBe(true);
  });

  test("transfer resets consent and old direct preference writes stay muted", async () => {
    const physicalToken = expoToken();
    const first = await registerPushToken("account-a", physicalToken, "ios", "phone");
    await updatePrefs("account-a", first.id, { notifications_enabled: true, daily_brief: true });
    const second = await registerPushToken("account-b", physicalToken, "ios", "phone");
    expect(second.prefs).toMatchObject({ notifications_enabled: false, daily_brief: false });
    expect(await updatePrefs("account-a", first.id, { daily_brief: true })).toBeNull();

    await sql`
      UPDATE push_tokens
      SET prefs = '{"notifications_enabled":true,"daily_brief":true}'::jsonb
      WHERE id = ${first.id}
    `;
    const old = (await sql`SELECT prefs FROM push_tokens WHERE id = ${first.id}`) as Array<{
      prefs: Record<string, unknown>;
    }>;
    expect(old[0]?.prefs.daily_brief).toBe(false);
    expect(old[0]?.prefs.notifications_enabled).toBe(false);
    expect((await listTokensForEvent("daily_brief")).map((token) => token.userId)).toEqual([]);
  });

  test("registration waits for the token advisory lock", async () => {
    const physicalToken = expoToken();
    const holder = new SQL(databaseUrl);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${physicalToken}, 0))`;
      await held;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    let finished = false;
    const pending = registerPushToken("account-a", physicalToken).finally(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(finished).toBe(false);
    release();
    await holding;
    await pending;
  });

  test("claim-upsert failure rolls registration back", async () => {
    const physicalToken = expoToken();
    const first = await registerPushToken("account-a", physicalToken);
    await updatePrefs("account-a", first.id, { notifications_enabled: true, daily_brief: true });
    _failNextPushClaimUpsertForTest();
    await expect(registerPushToken("account-b", physicalToken)).rejects.toThrow(
      "injected push claim upsert failure",
    );
    expect((await listTokensForEvent("daily_brief")).map((token) => token.userId)).toEqual([
      "account-a",
    ]);
    expect((await listTokensForUser("account-b")).length).toBe(0);
  });

  test("unlink tombstone survives lazy reinitialization and mutes a later legacy row", async () => {
    const physicalToken = expoToken();
    const first = await registerPushToken("account-a", physicalToken);
    expect(await unregisterPushToken("account-a", first.id)).toBe(true);
    _resetPushTokenMemory();
    const legacy = id("legacy");
    await sql`
      INSERT INTO push_tokens
        (id, user_id, expo_token, prefs, last_seen_at, created_at)
      VALUES
        (${legacy}, 'account-b', ${physicalToken}, '{"notifications_enabled":true,"daily_brief":true}', now(), now())
    `;
    expect(await listTokensForEvent("daily_brief")).toEqual([]);
    const claim = (await sql`
      SELECT token_id, user_id FROM push_token_claims WHERE expo_token = ${physicalToken}
    `) as Array<{ token_id: string | null; user_id: string | null }>;
    expect(claim[0]).toEqual({ token_id: null, user_id: null });
    const row = (await sql`SELECT prefs FROM push_tokens WHERE id = ${legacy}`) as Array<{
      prefs: Record<string, unknown>;
    }>;
    expect(row[0]?.prefs.daily_brief).toBe(false);
  });

  test("Postgres delivery claims allow only one concurrent owner", async () => {
    const physicalToken = expoToken();
    const token = await registerPushToken("account-a", physicalToken);
    await updatePrefs("account-a", token.id, { notifications_enabled: true, daily_brief: true });
    const candidates = await listTokensForEvent("daily_brief");
    const [first, second] = await Promise.all([
      claimPushDelivery(
        [candidates[0]!],
        [{ slot: "daily_brief", key: "20260825" }],
        "daily_brief",
      ),
      claimPushDelivery(
        [candidates[0]!],
        [{ slot: "daily_brief", key: "20260825" }],
        "daily_brief",
      ),
    ]);
    expect(first.length + second.length).toBe(1);
    const winner = first[0] ?? second[0]!;
    await finalizePushDelivery([winner], new Set([physicalToken]));
    expect((await listTokensForUser("account-a"))[0]?.prefs.last_sent?.daily_brief).toBe(
      "20260825",
    );
  });

  test("identity revocation is idempotent on Postgres", async () => {
    const physicalToken = expoToken();
    await registerPushToken("account-a", physicalToken, "ios", "phone");
    expect(await unregisterPushTokenByIdentity(physicalToken, "phone")).toBe(true);
    expect(await unregisterPushTokenByIdentity(physicalToken, "phone")).toBe(false);
    const claim = (await sql`
      SELECT token_id, user_id FROM push_token_claims WHERE expo_token = ${physicalToken}
    `) as Array<{ token_id: string | null; user_id: string | null }>;
    expect(claim[0]).toEqual({ token_id: null, user_id: null });
  });
}
