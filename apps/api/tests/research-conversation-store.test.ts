import { beforeEach, describe, expect, test } from "bun:test";
import {
  ResearchConversationOwnershipError,
  __resetResearchConversationStore,
  getResearchConversation,
  listResearchConversations,
  updateResearchConversation,
  upsertResearchConversation,
} from "../src/lib/research-conversation-store.js";

const owner = (kind: "user" | "device" = "user") => `${kind}:${crypto.randomUUID()}`;

describe("research-conversation-store (in-memory)", () => {
  beforeEach(() => {
    __resetResearchConversationStore();
  });

  test("same-owner upserts are idempotent and preserve the original creation time", async () => {
    const ownerKey = owner();
    const first = await upsertResearchConversation(
      ownerKey,
      {
        conversationId: "conv_same_owner",
        title: "Initial question",
        preview: "Queued",
        status: "queued",
      },
      new Date("2026-08-24T14:00:00.000Z"),
    );
    const retried = await upsertResearchConversation(
      ownerKey,
      {
        conversationId: "conv_same_owner",
        title: "Initial question",
        preview: "Research is running",
        status: "running",
      },
      new Date("2026-08-24T14:01:00.000Z"),
    );

    expect(retried).toEqual({
      ...first,
      preview: "Research is running",
      status: "running",
      updatedAt: "2026-08-24T14:01:00.000Z",
    });
    expect(retried.createdAt).toBe("2026-08-24T14:00:00.000Z");
    const exactRetry = await upsertResearchConversation(
      ownerKey,
      {
        conversationId: "conv_same_owner",
        title: "Initial question",
        preview: "Research is running",
        status: "running",
      },
      new Date("2026-08-24T14:02:00.000Z"),
    );
    expect(exactRetry).toEqual(retried);
    expect(await listResearchConversations(ownerKey)).toEqual([retried]);
  });

  test("conversation reads and lists are invisible to a different owner", async () => {
    const ownerKey = owner("device");
    const otherOwnerKey = owner();
    await upsertResearchConversation(ownerKey, {
      conversationId: "conv_private",
      title: "Private research",
      preview: "Only this device can see it",
      status: "running",
    });

    expect(await getResearchConversation(otherOwnerKey, "conv_private")).toBeNull();
    expect(await listResearchConversations(otherOwnerKey)).toEqual([]);
    expect((await getResearchConversation(ownerKey, "conv_private"))?.title).toBe(
      "Private research",
    );
  });

  test("a different owner cannot reassign an existing conversation id", async () => {
    const ownerKey = owner();
    const otherOwnerKey = owner("device");
    const original = await upsertResearchConversation(ownerKey, {
      conversationId: "conv_owned",
      title: "Original",
      preview: "Original preview",
      status: "queued",
    });

    const reassignment = upsertResearchConversation(otherOwnerKey, {
      conversationId: "conv_owned",
      title: "Hijacked",
      preview: "Should never persist",
      status: "running",
    });
    await expect(reassignment).rejects.toBeInstanceOf(ResearchConversationOwnershipError);
    await expect(reassignment).rejects.toMatchObject({
      code: "research_conversation_ownership_conflict",
      conversationId: "conv_owned",
    });

    expect(await getResearchConversation(ownerKey, "conv_owned")).toEqual(original);
    expect(await getResearchConversation(otherOwnerKey, "conv_owned")).toBeNull();
  });

  test("owner-scoped updates change supplied fields and preserve the rest", async () => {
    const ownerKey = owner();
    const otherOwnerKey = owner("device");
    await upsertResearchConversation(
      ownerKey,
      {
        conversationId: "conv_update",
        title: "Original title",
        preview: "Queued",
        status: "queued",
      },
      new Date("2026-08-24T15:00:00.000Z"),
    );

    expect(
      await updateResearchConversation(
        otherOwnerKey,
        "conv_update",
        { status: "running" },
        new Date("2026-08-24T15:01:00.000Z"),
      ),
    ).toBeNull();

    const updated = await updateResearchConversation(
      ownerKey,
      "conv_update",
      {
        title: "Updated title",
        preview: "Evidence gathered",
        status: "conclusive",
      },
      new Date("2026-08-24T15:02:00.000Z"),
    );
    expect(updated).toMatchObject({
      conversationId: "conv_update",
      ownerKey,
      title: "Updated title",
      preview: "Evidence gathered",
      status: "conclusive",
      createdAt: "2026-08-24T15:00:00.000Z",
      updatedAt: "2026-08-24T15:02:00.000Z",
    });
  });

  test("lists only one owner and orders most recently updated first", async () => {
    const ownerKey = owner();
    const otherOwnerKey = owner("device");
    await upsertResearchConversation(
      ownerKey,
      {
        conversationId: "conv_older",
        title: "Older",
        preview: "First",
        status: "queued",
      },
      new Date("2026-08-24T16:00:00.000Z"),
    );
    await upsertResearchConversation(
      ownerKey,
      {
        conversationId: "conv_newer",
        title: "Newer",
        preview: "Second",
        status: "running",
      },
      new Date("2026-08-24T16:01:00.000Z"),
    );
    await upsertResearchConversation(otherOwnerKey, {
      conversationId: "conv_foreign",
      title: "Foreign",
      preview: "Hidden",
      status: "running",
    });
    await updateResearchConversation(
      ownerKey,
      "conv_older",
      { preview: "Now active" },
      new Date("2026-08-24T16:02:00.000Z"),
    );

    expect((await listResearchConversations(ownerKey)).map((row) => row.conversationId)).toEqual([
      "conv_older",
      "conv_newer",
    ]);
  });

  test("reset clears all in-memory conversation references", async () => {
    const ownerKey = owner();
    await upsertResearchConversation(ownerKey, {
      conversationId: "conv_reset",
      title: "Reset me",
      preview: "Temporary",
      status: "queued",
    });

    __resetResearchConversationStore();

    expect(await getResearchConversation(ownerKey, "conv_reset")).toBeNull();
    expect(await listResearchConversations(ownerKey)).toEqual([]);
  });
});
