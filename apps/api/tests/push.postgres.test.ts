import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { SQL } from "bun";
import { sign } from "hono/jwt";

const databaseUrl = process.env.POSTGRES_URL;

// Lazy DDL intentionally runs in a transaction. Under a shared CI Postgres
// service that can occasionally take longer than Bun's five-second default.
setDefaultTimeout(20_000);

// This file is run in CI's dedicated push-postgres job. Keep local `bun test`
// useful without requiring a daemon by skipping when no URL was supplied.
if (!databaseUrl) {
  describe.skip("push Postgres integration (POSTGRES_URL unset)", () => {
    test("requires the dedicated Postgres job", () => undefined);
  });
} else {
  process.env.NODE_ENV = "test";
  process.env.SESSION_SIGNING_KEY = "postgres-push-recovery-test-signing-key";
  const sql = new SQL(databaseUrl);
  const {
    _failNextPushClaimUpsertForTest,
    _resetPushTokenMemory,
    _setPushDeliveryHandoffLeaseMsForTest,
    claimPushDelivery,
    finalizePushDelivery,
    listTokensForEvent,
    listTokensForUser,
    registerPushToken,
    unregisterCurrentUsersPushTokenByExpo,
    unregisterCurrentUsersPushTokenByTokenId,
    unregisterPushToken,
    unregisterPushTokenByIdentity,
    updatePrefs,
    withPushDeliveryHandoff,
  } = await import("../src/lib/push-tokens-store.js");
  const { deliverPush } = await import("../src/lib/push-dispatcher.js");
  const { default: pushRoutes } = await import("../src/routes/push.js");

  const expoToken = () => `ExponentPushToken[${crypto.randomUUID()}]`;
  const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function oldSessionFor(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return sign(
      {
        purpose: "session",
        sub: userId,
        iat: now - 91 * 24 * 60 * 60,
        exp: now - 90 * 24 * 60 * 60 - 1,
      },
      process.env.SESSION_SIGNING_KEY!,
    );
  }

  async function expiredSessionRecovery(
    bearer: string,
    body: Record<string, string>,
  ): Promise<Response> {
    return pushRoutes.fetch(
      new Request("http://localhost/revoke-expired-session-device", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  async function resetTables(): Promise<void> {
    await sql`DROP TABLE IF EXISTS push_delivery_claims, push_token_claims, push_tokens CASCADE`;
    _resetPushTokenMemory();
  }

  async function runFreshPushInitializer(): Promise<{ exitCode: number; stderr: string }> {
    const proc = Bun.spawn({
      cmd: [
        process.execPath,
        "-e",
        `const store = await import("./apps/api/src/lib/push-tokens-store.ts"); await store.listTokensForEvent("daily_brief");`,
      ],
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test", POSTGRES_URL: databaseUrl },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    ]);
    return { exitCode, stderr };
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

  test("two fresh API initializers serialize trigger installation without an enforcement gap", async () => {
    // Initialize non-push shared tables once, then remove only the lazy push
    // schema so the two child processes race exactly the migration under test.
    await listTokensForEvent("daily_brief");
    await resetTables();

    const holder = new SQL(databaseUrl);
    let releaseGate!: () => void;
    let acquiredGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      acquiredGate = resolve;
    });
    const holding = holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${"mapvest.push-token-schema-v2"}, 0))`;
      acquiredGate();
      await gate;
    });
    await acquired;
    try {
      const first = runFreshPushInitializer();
      const second = runFreshPushInitializer();
      await sleep(75);
      releaseGate();
      await holding;
      const outcomes = await Promise.all([first, second]);
      for (const outcome of outcomes) {
        expect(outcome.exitCode, outcome.stderr).toBe(0);
      }
      const triggers = (await sql`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid IN ('push_tokens'::regclass, 'push_token_claims'::regclass)
          AND tgname IN ('push_tokens_mute_unclaimed', 'push_token_claims_mute_legacy')
          AND NOT tgisinternal
        ORDER BY tgname
      `) as Array<{ tgname: string }>;
      expect(triggers.map((trigger) => trigger.tgname)).toEqual([
        "push_token_claims_mute_legacy",
        "push_tokens_mute_unclaimed",
      ]);
    } finally {
      releaseGate();
      await holding.catch(() => undefined);
      await holder.close();
    }
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

  test("delivery holds the ownership gate through the Expo handoff before a transfer can commit", async () => {
    const physicalToken = expoToken();
    const first = await registerPushToken("account-a", physicalToken, "ios", "phone");
    await updatePrefs("account-a", first.id, { notifications_enabled: true, daily_brief: true });
    const candidates = await listTokensForEvent("daily_brief");
    const originalFetch = globalThis.fetch;
    let releaseSend!: () => void;
    let startedSend!: () => void;
    const sendReleased = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const sendStarted = new Promise<void>((resolve) => {
      startedSend = resolve;
    });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      startedSend();
      await sendReleased;
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const delivery = deliverPush({
        tokens: candidates,
        dedupe: [{ slot: "daily_brief", key: "handoff-order" }],
        eventKey: "daily_brief",
        title: "Morning read",
        body: "Ready",
        target: { type: "home", section: "daily-brief" },
      });
      await sendStarted;
      let transferred = false;
      const transfer = registerPushToken("account-b", physicalToken, "ios", "phone").finally(() => {
        transferred = true;
      });
      await sleep(75);
      expect(transferred).toBe(false);

      releaseSend();
      const [sent, nextOwner] = await Promise.all([delivery, transfer]);
      expect(calls).toBe(1);
      expect(sent.successes).toBe(1);
      expect(nextOwner.userId).toBe("account-b");
      expect(await listTokensForUser("account-a")).toEqual([]);
    } finally {
      releaseSend();
      globalThis.fetch = originalFetch;
    }
  });

  test("delivery holds the ownership gate through the Expo handoff before unlink can commit", async () => {
    const physicalToken = expoToken();
    const token = await registerPushToken("account-a", physicalToken, "ios", "phone");
    await updatePrefs("account-a", token.id, { notifications_enabled: true, daily_brief: true });
    const candidates = await listTokensForEvent("daily_brief");
    const originalFetch = globalThis.fetch;
    let releaseSend!: () => void;
    let startedSend!: () => void;
    const sendReleased = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const sendStarted = new Promise<void>((resolve) => {
      startedSend = resolve;
    });
    globalThis.fetch = (async () => {
      startedSend();
      await sendReleased;
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const delivery = deliverPush({
        tokens: candidates,
        dedupe: [{ slot: "daily_brief", key: "handoff-unlink" }],
        eventKey: "daily_brief",
        title: "Morning read",
        body: "Ready",
        target: { type: "home", section: "daily-brief" },
      });
      await sendStarted;
      let unlinked = false;
      const unlink = unregisterPushToken("account-a", token.id).finally(() => {
        unlinked = true;
      });
      await sleep(75);
      expect(unlinked).toBe(false);

      releaseSend();
      const [sent, removed] = await Promise.all([delivery, unlink]);
      expect(sent.successes).toBe(1);
      expect(removed).toBe(true);
      expect(await listTokensForUser("account-a")).toEqual([]);
    } finally {
      releaseSend();
      globalThis.fetch = originalFetch;
    }
  });

  test("a throwing handoff clears its reserved advisory session before the next transfer", async () => {
    const physicalToken = expoToken();
    const first = await registerPushToken("account-a", physicalToken, "ios", "phone");
    await updatePrefs("account-a", first.id, { notifications_enabled: true, daily_brief: true });
    const [claim] = await claimPushDelivery(
      [first],
      [{ slot: "daily_brief", key: "throwing-handoff" }],
      "daily_brief",
    );
    expect(claim).toBeDefined();

    await expect(
      withPushDeliveryHandoff([claim!], "daily_brief", async () => {
        throw new Error("simulated Expo handoff failure");
      }),
    ).rejects.toThrow("simulated Expo handoff failure");
    const nextOwner = await Promise.race([
      registerPushToken("account-b", physicalToken, "ios", "phone"),
      sleep(2_000).then(() => {
        throw new Error("transfer remained blocked after handoff cleanup");
      }),
    ]);
    expect(nextOwner.userId).toBe("account-b");
  });

  test("a delayed ownership gate renews the lease after acquisition so finalization stays durable", async () => {
    const physicalToken = expoToken();
    const token = await registerPushToken("account-a", physicalToken, "ios", "phone");
    await updatePrefs("account-a", token.id, { notifications_enabled: true, daily_brief: true });
    const [claim] = await claimPushDelivery(
      [token],
      [{ slot: "daily_brief", key: "renew-after-gate" }],
      "daily_brief",
    );
    expect(claim).toBeDefined();

    _setPushDeliveryHandoffLeaseMsForTest(6_000);
    const holder = new SQL(databaseUrl);
    let releaseGate!: () => void;
    let acquiredGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      acquiredGate = resolve;
    });
    const holding = holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${physicalToken}, 0))`;
      acquiredGate();
      await gate;
    });
    let released = false;
    await acquired;
    try {
      const handoff = withPushDeliveryHandoff([claim!], "daily_brief", async (valid) => {
        expect(valid).toHaveLength(1);
        // Cross the original pre-gate six-second window. Only a renewal that starts
        // after acquiring the advisory lock can remain valid for finalization.
        await sleep(4_000);
      });
      await sleep(3_000);
      releaseGate();
      released = true;
      await holding;
      await handoff;
      await finalizePushDelivery([claim!], new Set([physicalToken]));

      expect((await listTokensForUser("account-a"))[0]?.prefs.last_sent?.daily_brief).toBe(
        "renew-after-gate",
      );
    } finally {
      if (!released) releaseGate();
      await holding.catch(() => undefined);
      await holder.close();
      _setPushDeliveryHandoffLeaseMsForTest();
    }
  });

  test("a short caller lease cannot expire during Expo retries and duplicate the handoff", async () => {
    const physicalToken = expoToken();
    const token = await registerPushToken("account-a", physicalToken, "ios", "phone");
    await updatePrefs("account-a", token.id, { notifications_enabled: true, daily_brief: true });
    const candidates = await listTokensForEvent("daily_brief");
    const originalFetch = globalThis.fetch;
    let firstAttempt!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      firstAttempt = resolve;
    });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) firstAttempt();
      await sleep(35);
      if (calls < 3) return new Response("retry", { status: 503 });
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const first = deliverPush({
        tokens: candidates,
        dedupe: [{ slot: "daily_brief", key: "lease-retry" }],
        eventKey: "daily_brief",
        title: "Morning read",
        body: "Ready",
        target: { type: "home", section: "daily-brief" },
        leaseMs: 20,
      });
      await firstStarted;
      // This is beyond the historical 20ms test lease while the first request
      // remains in progress; a second dispatcher must still not reach Expo.
      await sleep(35);
      const second = deliverPush({
        tokens: candidates,
        dedupe: [{ slot: "daily_brief", key: "lease-retry" }],
        eventKey: "daily_brief",
        title: "Morning read",
        body: "Ready",
        target: { type: "home", section: "daily-brief" },
        leaseMs: 20,
      });
      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(calls).toBe(3);
      expect(firstResult.successes + secondResult.successes).toBe(1);
      expect((await listTokensForUser("account-a"))[0]?.prefs.last_sent?.daily_brief).toBe(
        "lease-retry",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("handoff capacity transfers reserved permits without letting new dispatchers barge", async () => {
    const previousLimit = process.env.PUSH_MAX_CONCURRENT_HANDOFFS;
    process.env.PUSH_MAX_CONCURRENT_HANDOFFS = "2";
    const originalFetch = globalThis.fetch;
    let releaseSends!: () => void;
    let reachedCapacity!: () => void;
    const sendsReleased = new Promise<void>((resolve) => {
      releaseSends = resolve;
    });
    const capacityReached = new Promise<void>((resolve) => {
      reachedCapacity = resolve;
    });
    let active = 0;
    let peak = 0;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      if (calls === 2) reachedCapacity();
      try {
        await sendsReleased;
        return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      } finally {
        active -= 1;
      }
    }) as typeof fetch;

    try {
      const tokens = [];
      for (let index = 0; index < 5; index += 1) {
        const token = await registerPushToken(
          `account-${index}`,
          expoToken(),
          "ios",
          `phone-${index}`,
        );
        await updatePrefs(`account-${index}`, token.id, {
          notifications_enabled: true,
          daily_brief: true,
        });
        tokens.push(token);
      }
      const deliveries = tokens.map((token, index) =>
        deliverPush({
          tokens: [token],
          dedupe: [{ slot: "daily_brief", key: `capacity-${index}` }],
          eventKey: "daily_brief",
          title: "Morning read",
          body: "Ready",
          target: { type: "home", section: "daily-brief" },
        }),
      );
      await Promise.race([
        capacityReached,
        sleep(2_000).then(() => {
          throw new Error("dispatchers did not reach the configured handoff capacity");
        }),
      ]);
      await sleep(75);
      expect(calls).toBe(2);
      expect(peak).toBe(2);

      releaseSends();
      const results = await Promise.all(deliveries);
      expect(results.reduce((sum, result) => sum + result.successes, 0)).toBe(5);
      expect(peak).toBeLessThanOrEqual(2);
    } finally {
      releaseSends();
      globalThis.fetch = originalFetch;
      if (previousLimit === undefined) process.env.PUSH_MAX_CONCURRENT_HANDOFFS = undefined;
      else process.env.PUSH_MAX_CONCURRENT_HANDOFFS = previousLimit;
    }
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
    const token = await registerPushToken("account-a", physicalToken, "ios", "phone");
    expect(await unregisterPushTokenByIdentity(physicalToken, token.id, "phone")).toBe("revoked");
    expect(await unregisterPushTokenByIdentity(physicalToken, token.id, "phone")).toBe(
      "already-revoked",
    );
    const claim = (await sql`
      SELECT token_id, user_id FROM push_token_claims WHERE expo_token = ${physicalToken}
    `) as Array<{ token_id: string | null; user_id: string | null }>;
    expect(claim[0]).toEqual({ token_id: null, user_id: null });
  });

  test("revocation authorization ignores a rotated advisory device ID", async () => {
    const publicExpoToken = expoToken();
    const publicToken = await registerPushToken("account-a", publicExpoToken, "ios", "phone");
    expect(
      await unregisterPushTokenByIdentity(publicExpoToken, publicToken.id, "reinstalled-phone"),
    ).toBe("revoked");

    const authenticatedExpoToken = expoToken();
    await registerPushToken("account-a", authenticatedExpoToken, "ios", "phone");
    expect(
      await unregisterCurrentUsersPushTokenByExpo(
        "account-a",
        authenticatedExpoToken,
        "reinstalled-phone",
      ),
    ).toBe("revoked");
  });

  test("token-id recovery distinguishes an idempotent retry from a later owner", async () => {
    const revokedExpoToken = expoToken();
    const revoked = await registerPushToken("account-a", revokedExpoToken, "ios", "phone");
    expect(await unregisterCurrentUsersPushTokenByTokenId("account-a", revoked.id)).toBe("revoked");
    expect(await unregisterCurrentUsersPushTokenByTokenId("account-a", revoked.id)).toBe(
      "already-revoked",
    );

    const transferredExpoToken = expoToken();
    const former = await registerPushToken("account-a", transferredExpoToken, "ios", "phone");
    const current = await registerPushToken("account-b", transferredExpoToken, "ios", "phone");
    expect(await unregisterCurrentUsersPushTokenByTokenId("account-a", former.id)).toBe(
      "claim-mismatch",
    );
    expect((await listTokensForUser("account-b")).map((token) => token.id)).toEqual([current.id]);
  });

  test("an older session needs its opaque id and cannot revoke a transferred Postgres claim", async () => {
    const formerUser = "account-a";
    const bearer = await oldSessionFor(formerUser);
    const physicalToken = expoToken();
    const registered = await registerPushToken(formerUser, physicalToken, "ios", "phone");

    const expoOnly = await expiredSessionRecovery(bearer, { token: physicalToken });
    expect(expoOnly.status).toBe(401);

    const recovered = await expiredSessionRecovery(bearer, { tokenId: registered.id });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ revoked: true, matched: true, outcome: "revoked" });

    const retry = await expiredSessionRecovery(bearer, { tokenId: registered.id });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({
      revoked: true,
      matched: false,
      outcome: "already-revoked",
    });

    const transferredExpoToken = expoToken();
    const former = await registerPushToken(formerUser, transferredExpoToken, "ios", "phone");
    const current = await registerPushToken("account-b", transferredExpoToken, "ios", "phone");
    const stale = await expiredSessionRecovery(bearer, { tokenId: former.id });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      revoked: false,
      matched: false,
      outcome: "claim-mismatch",
    });
    expect((await listTokensForUser("account-b")).map((token) => token.id)).toEqual([current.id]);
  });

  test("a stale opaque revocation id cannot unlink the account that claimed the token later", async () => {
    const physicalToken = expoToken();
    const first = await registerPushToken("account-a", physicalToken, "ios", "phone");
    const second = await registerPushToken("account-b", physicalToken, "ios", "phone");

    expect(await unregisterPushTokenByIdentity(physicalToken, first.id, "reinstalled-phone")).toBe(
      "claim-mismatch",
    );
    expect((await listTokensForUser("account-b")).map((token) => token.id)).toEqual([second.id]);
    expect(await unregisterPushTokenByIdentity(physicalToken, second.id, "phone")).toBe("revoked");
  });

  test("authenticated identity revocation distinguishes retry from a later account owner", async () => {
    const physicalToken = expoToken();
    await registerPushToken("account-a", physicalToken, "ios", "phone");
    expect(
      await unregisterCurrentUsersPushTokenByExpo("account-a", physicalToken, "reinstalled-phone"),
    ).toBe("revoked");
    expect(await unregisterCurrentUsersPushTokenByExpo("account-a", physicalToken, "phone")).toBe(
      "already-revoked",
    );

    await registerPushToken("account-b", physicalToken, "ios", "phone");
    expect(await unregisterCurrentUsersPushTokenByExpo("account-a", physicalToken, "phone")).toBe(
      "claim-mismatch",
    );
    expect(await unregisterCurrentUsersPushTokenByExpo("account-b", physicalToken, "phone")).toBe(
      "revoked",
    );
  });

  test("unlink and finalization share the advisory prefix and do not deadlock", async () => {
    const physicalToken = expoToken();
    const token = await registerPushToken("account-a", physicalToken, "ios", "phone");
    await updatePrefs("account-a", token.id, { notifications_enabled: true, daily_brief: true });
    const [claim] = await claimPushDelivery(
      [token],
      [{ slot: "daily_brief", key: "deadlock-order" }],
      "daily_brief",
    );
    expect(claim).toBeDefined();

    const holder = new SQL(databaseUrl);
    let releaseGate!: () => void;
    let acquiredGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      acquiredGate = resolve;
    });
    const holding = holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${physicalToken}, 0))`;
      acquiredGate();
      await gate;
    });
    await acquired;
    let unlinkFinished = false;
    let finalizeFinished = false;
    try {
      const unlink = unregisterPushToken("account-a", token.id).finally(() => {
        unlinkFinished = true;
      });
      const finalize = finalizePushDelivery([claim!], new Set([physicalToken])).finally(() => {
        finalizeFinished = true;
      });
      await sleep(75);
      expect(unlinkFinished).toBe(false);
      expect(finalizeFinished).toBe(false);

      releaseGate();
      await holding;
      const [unlinked] = await Promise.all([unlink, finalize]);
      expect(unlinked).toBe(true);
      expect(await listTokensForUser("account-a")).toEqual([]);
    } finally {
      releaseGate();
      await holding.catch(() => undefined);
      await holder.close();
    }
  });
}
