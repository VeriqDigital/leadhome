/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MessageProvider,
  NormalizedConversation,
  NormalizedMessage,
} from "./provider";

const state = vi.hoisted(() => ({
  account: null as null | Record<string, any>,
  conversations: new Map<string, Record<string, any>>(),
  messages: new Map<string, Record<string, any>>(),
  activities: [] as Record<string, any>[],
  sequence: 0,
}));

const matchMock = vi.hoisted(() => vi.fn());

function conversationKey(accountId: string, providerConversationId: string) {
  return `${accountId}:${providerConversationId}`;
}

function messageKey(accountId: string, providerMessageId: string) {
  return `${accountId}:${providerMessageId}`;
}

const database = {
  communicationAccount: {
    upsert: vi.fn(async ({ create, update }: any) => {
      state.account = state.account
        ? { ...state.account, ...update }
        : { id: "account-a", address: null, ...create };
      return state.account;
    }),
    update: vi.fn(async ({ data }: any) => {
      state.account = { ...state.account, ...data };
      return state.account;
    }),
  },
  conversation: {
    findUnique: vi.fn(async ({ where }: any) => {
      const key = where.accountId_providerConversationId;
      return state.conversations.get(
        conversationKey(key.accountId, key.providerConversationId),
      ) ?? null;
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const key = where.accountId_providerConversationId;
      const storageKey = conversationKey(key.accountId, key.providerConversationId);
      const current = state.conversations.get(storageKey);
      const next = current
        ? { ...current, ...update }
        : {
            id: `conversation-${++state.sequence}`,
            leadId: null,
            manuallyDetached: false,
            classificationIsManual: false,
            baselineImportedAt: null,
            ...create,
          };
      state.conversations.set(storageKey, next);
      return next;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const entry = [...state.conversations.entries()].find(
        ([, conversation]) => conversation.id === where.id,
      );
      if (!entry) throw new Error("missing conversation");
      const next = { ...entry[1], ...data };
      state.conversations.set(entry[0], next);
      return next;
    }),
    findFirst: vi.fn(async ({ where }: any) =>
      [...state.conversations.values()].find(
        (conversation) =>
          conversation.id === where.id && conversation.ownerId === where.ownerId,
      ) ?? null,
    ),
    findMany: vi.fn(async ({ where }: any) => {
      const ids = new Set(where.id.in);
      return [...state.conversations.values()]
        .filter(
          (conversation) =>
            conversation.ownerId === where.ownerId && ids.has(conversation.id),
        )
        .map((conversation) => ({
          id: conversation.id,
          leadId: conversation.leadId,
        }));
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const entry = [...state.conversations.entries()].find(([, conversation]) =>
        conversation.id === where.id &&
        (where.ownerId === undefined || conversation.ownerId === where.ownerId) &&
        (where.leadId === undefined || conversation.leadId === where.leadId) &&
        (where.manuallyDetached === undefined ||
          conversation.manuallyDetached === where.manuallyDetached) &&
        (where.reviewState === undefined ||
          conversation.reviewState === where.reviewState) &&
        (where.OR === undefined ||
          conversation.lastMessageAt === null ||
          conversation.lastMessageAt < where.OR[1].lastMessageAt.lt),
      );
      if (!entry) return { count: 0 };
      state.conversations.set(entry[0], { ...entry[1], ...data });
      return { count: 1 };
    }),
  },
  message: {
    findMany: vi.fn(async ({ where, select }: any) => {
      if (where.id?.in) {
        const ids = new Set(where.id.in);
        return [...state.messages.values()]
          .filter(
            (message) =>
              message.ownerId === where.ownerId && ids.has(message.id),
          )
          .map((message) => ({
            id: message.id,
            conversationId: message.conversationId,
          }));
      }
      const ids = new Set(where.providerMessageId.in);
      return [...state.messages.values()]
        .filter(
          (message) =>
            message.accountId === where.accountId &&
            ids.has(message.providerMessageId),
        )
        .map((message) =>
          select.direction
            ? {
                id: message.id,
                direction: message.direction,
                subject: message.subject,
                receivedAt: message.receivedAt,
              }
            : { providerMessageId: message.providerMessageId },
        );
    }),
    createMany: vi.fn(async ({ data }: any) => {
      let count = 0;
      for (const message of data) {
        const key = messageKey(message.accountId, message.providerMessageId);
        if (state.messages.has(key)) continue;
        state.messages.set(key, {
          id: `message-${++state.sequence}`,
          ...message,
        });
        count++;
      }
      return { count };
    }),
  },
  leadActivity: {
    createMany: vi.fn(async ({ data, skipDuplicates }: any) => {
      let count = 0;
      for (const activity of data) {
        if (
          skipDuplicates &&
          state.activities.some(
            (existing) =>
              (activity.idempotencyKey &&
                existing.userId === activity.userId &&
                existing.idempotencyKey === activity.idempotencyKey) ||
              (activity.messageId &&
                existing.messageId === activity.messageId &&
                existing.type === activity.type),
          )
        ) continue;
        state.activities.push(activity);
        count++;
      }
      return { count };
    }),
  },
  lead: {
    findMany: vi.fn(async ({ where }: any) =>
      where.userId === "owner-a"
        ? where.id.in.map((id: string) => ({ id }))
        : []),
    update: vi.fn(async ({ where, data }: any) => ({ ...where, ...data })),
  },
  task: {
    findMany: vi.fn(async () => []),
  },
};

vi.mock("server-only", () => ({}));
vi.doMock("@/lib/prisma", () => ({
  prisma: {
    ...database,
    $transaction: (operation: (tx: typeof database) => unknown) =>
      operation(database),
  },
}));
vi.mock("./matching-service", async () => {
  const actual = await vi.importActual<typeof import("./matching-service")>(
    "./matching-service",
  );
  return { ...actual, findLeadForConversation: matchMock };
});

const { importProviderAccount } = await import("./import-service");

class MutableProvider implements MessageProvider {
  readonly provider = "FAKE" as const;
  conversations: NormalizedConversation[] = [{
    providerConversationId: "thread-a",
    subject: "Inquiry",
    suggestedClassification: "LEAD",
  }];
  messages = new Map<string, NormalizedMessage[]>([[
    "thread-a",
    [
      {
        providerMessageId: "message-a",
        direction: "INBOUND",
        sender: "person@example.com",
        recipients: ["inbox@example.com"],
        bodyText: "First",
        occurredAt: new Date("2026-07-20T10:00:00.000Z"),
      },
      {
        providerMessageId: "message-b",
        direction: "INBOUND",
        sender: "person@example.com",
        recipients: ["inbox@example.com"],
        bodyText: "Second",
        occurredAt: new Date("2026-07-21T10:00:00.000Z"),
      },
    ],
  ]]);

  async getAccount() {
    return {
      provider: this.provider,
      providerAccountId: "provider-account-a",
      displayName: "Test inbox",
      address: "inbox@example.com",
    };
  }

  async listRecentConversations() {
    return this.conversations;
  }

  async getConversation(providerConversationId: string) {
    return this.conversations.find(
      (conversation) =>
        conversation.providerConversationId === providerConversationId,
    ) ?? null;
  }

  async listMessages(providerConversationId: string) {
    return this.messages.get(providerConversationId) ?? [];
  }
}

beforeEach(() => {
  state.account = null;
  state.conversations.clear();
  state.messages.clear();
  state.activities.length = 0;
  state.sequence = 0;
  vi.clearAllMocks();
  matchMock.mockResolvedValue({
    kind: "NO_MATCH",
    reason: "no external participant matched",
  });
});

describe("provider import pipeline", () => {
  it("reports bounded phase checkpoints without changing importer behavior", async () => {
    const checkpoints: Array<{
      phase: string;
      processed: number;
      total: number | null;
    }> = [];
    await importProviderAccount({
      ownerId: "owner-a",
      provider: new MutableProvider(),
      options: {
        onProgress(progress) {
          checkpoints.push(progress);
        },
      },
    });

    expect(checkpoints.map((item) => item.phase)).toEqual([
      "LISTING_THREADS",
      "IMPORTING_THREADS",
      "IMPORTING_THREADS",
      "MATCHING",
      "MATCHING",
      "FINALIZING",
    ]);
    expect(checkpoints.at(-1)).toEqual({
      phase: "FINALIZING",
      processed: 1,
      total: 1,
      message: "Saving the Gmail sync summary.",
    });
  });

  it("creates an account, conversation, messages, and an accurate summary", async () => {
    const summary = await importProviderAccount({
      ownerId: "owner-a",
      provider: new MutableProvider(),
    });
    expect(summary).toEqual({
      accountsProcessed: 1,
      conversationsCreated: 1,
      conversationsUpdated: 0,
      messagesCreated: 2,
      messagesSkipped: 0,
      conversationsMatched: 0,
      conversationsNeedingReview: 1,
    });
    expect(state.account).toEqual(expect.objectContaining({ ownerId: "owner-a" }));
    expect(state.messages).toHaveLength(2);
    const conversation = [...state.conversations.values()][0];
    expect(state.activities).toContainEqual(
      expect.objectContaining({
        userId: "owner-a",
        leadId: null,
        conversationId: conversation.id,
        type: "CONVERSATION_IMPORTED",
        actorType: "SYSTEM",
        source: "INBOX",
        title: "Conversation imported",
        idempotencyKey:
          `conversation-import:FAKE:account-a:${conversation.id}`,
      }),
    );
  });

  it("is idempotent when identical data is imported twice", async () => {
    const provider = new MutableProvider();
    await importProviderAccount({ ownerId: "owner-a", provider });
    const repeated = await importProviderAccount({ ownerId: "owner-a", provider });

    expect(state.conversations).toHaveLength(1);
    expect(state.messages).toHaveLength(2);
    expect(
      state.activities.filter(
        (activity) => activity.type === "CONVERSATION_IMPORTED",
      ),
    ).toHaveLength(1);
    expect(repeated).toEqual(expect.objectContaining({
      conversationsCreated: 0,
      conversationsUpdated: 1,
      messagesCreated: 0,
      messagesSkipped: 2,
    }));
  });

  it("imports one new reply once on an existing conversation", async () => {
    const provider = new MutableProvider();
    await importProviderAccount({ ownerId: "owner-a", provider });
    provider.messages.get("thread-a")!.push({
      providerMessageId: "message-c",
      direction: "INBOUND",
      sender: "person@example.com",
      recipients: ["inbox@example.com"],
      bodyText: "New reply",
      occurredAt: new Date("2026-07-22T10:00:00.000Z"),
    });

    const summary = await importProviderAccount({ ownerId: "owner-a", provider });
    expect(summary.messagesCreated).toBe(1);
    expect(summary.messagesSkipped).toBe(2);
    expect(state.messages).toHaveLength(3);
    expect([...state.conversations.values()][0].lastMessageAt).toEqual(
      new Date("2026-07-22T10:00:00.000Z"),
    );
  });

  it("reports only conversations where this import inserted messages", async () => {
    const provider = new MutableProvider();
    const onConversationChanged = vi.fn();

    const first = await importProviderAccount({
      ownerId: "owner-a",
      provider,
      options: { onConversationChanged },
    });
    const conversationId = [...state.conversations.values()][0].id;

    expect(onConversationChanged).toHaveBeenCalledTimes(1);
    expect(onConversationChanged).toHaveBeenCalledWith({
      conversationId,
      messagesCreated: 2,
    });
    expect(first).not.toHaveProperty("changedConversationIds");

    onConversationChanged.mockClear();
    await importProviderAccount({
      ownerId: "owner-a",
      provider,
      options: { onConversationChanged },
    });
    expect(onConversationChanged).not.toHaveBeenCalled();

    provider.messages.get("thread-a")!.push({
      providerMessageId: "message-callback",
      direction: "INBOUND",
      sender: "person@example.com",
      recipients: ["inbox@example.com"],
      bodyText: "Please send the proposal.",
      occurredAt: new Date("2026-07-24T10:00:00.000Z"),
    });
    await importProviderAccount({
      ownerId: "owner-a",
      provider,
      options: { onConversationChanged },
    });
    expect(onConversationChanged).toHaveBeenCalledOnce();
    expect(onConversationChanged).toHaveBeenCalledWith({
      conversationId,
      messagesCreated: 1,
    });
  });

  it("deduplicates provider duplicates and stores out-of-order messages chronologically", async () => {
    const provider = new MutableProvider();
    const messages = provider.messages.get("thread-a")!;
    provider.messages.set("thread-a", [messages[1], messages[0], messages[0]]);

    const summary = await importProviderAccount({ ownerId: "owner-a", provider });
    expect(summary.messagesCreated).toBe(2);
    expect(summary.messagesSkipped).toBe(1);
    expect(
      [...state.messages.values()]
        .map((message) => message.receivedAt.toISOString())
        .sort(),
    ).toEqual([
      "2026-07-20T10:00:00.000Z",
      "2026-07-21T10:00:00.000Z",
    ]);
    expect([...state.conversations.values()][0].lastMessageAt).toEqual(
      new Date("2026-07-21T10:00:00.000Z"),
    );
  });

  it("never sends lastMessageAt backwards on an older-only retry", async () => {
    const provider = new MutableProvider();
    await importProviderAccount({ ownerId: "owner-a", provider });
    provider.messages.set("thread-a", [provider.messages.get("thread-a")![0]]);

    await importProviderAccount({ ownerId: "owner-a", provider });

    expect([...state.conversations.values()][0].lastMessageAt).toEqual(
      new Date("2026-07-21T10:00:00.000Z"),
    );
    expect(database.conversation.upsert.mock.calls.at(-1)?.[0].update)
      .not.toHaveProperty("lastMessageAt");
  });

  it("preserves manual classification, ignored review, attachment, and detach intent", async () => {
    const provider = new MutableProvider();
    await importProviderAccount({ ownerId: "owner-a", provider });
    const entry = [...state.conversations.entries()][0];
    state.conversations.set(entry[0], {
      ...entry[1],
      classification: "CUSTOMER",
      classificationIsManual: true,
      reviewState: "IGNORED",
      leadId: "lead-manual",
      manuallyDetached: false,
    });
    await importProviderAccount({ ownerId: "owner-a", provider });
    expect(state.conversations.get(entry[0])).toEqual(expect.objectContaining({
      classification: "CUSTOMER",
      reviewState: "IGNORED",
      leadId: "lead-manual",
    }));

    state.conversations.set(entry[0], {
      ...state.conversations.get(entry[0]),
      leadId: null,
      manuallyDetached: true,
      reviewState: "RESOLVED",
    });
    matchMock.mockResolvedValue({
      kind: "MATCHED",
      leadId: "lead-auto",
      confidence: "HIGH",
      reason: "exact sender email matched one lead",
    });
    await importProviderAccount({ ownerId: "owner-a", provider });
    expect(state.conversations.get(entry[0])).toEqual(expect.objectContaining({
      leadId: null,
      manuallyDetached: true,
      reviewState: "RESOLVED",
    }));
  });

  it("auto-attaches once and follows the silent-baseline activity policy", async () => {
    const provider = new MutableProvider();
    matchMock.mockResolvedValue({
      kind: "MATCHED",
      leadId: "lead-a",
      confidence: "HIGH",
      reason: "exact sender email matched one lead",
    });
    await importProviderAccount({ ownerId: "owner-a", provider });
    await importProviderAccount({ ownerId: "owner-a", provider });

    expect(
      state.activities.filter((activity) => activity.type === "CONVERSATION_LINKED"),
    ).toHaveLength(1);
    expect(
      state.activities.find(
        (activity) => activity.type === "CONVERSATION_LINKED",
      ),
    ).toEqual(
      expect.objectContaining({
        userId: "owner-a",
        leadId: "lead-a",
        actorType: "SYSTEM",
        source: "GMAIL",
        title: "Conversation attached",
        idempotencyKey: expect.stringMatching(
          /^conversation-auto-link:conversation-\d+:lead-a$/,
        ),
      }),
    );
    expect(
      state.activities.filter((activity) => activity.type === "MESSAGE_RECEIVED"),
    ).toHaveLength(0);

    provider.messages.get("thread-a")!.push({
      providerMessageId: "message-new",
      direction: "INBOUND",
      sender: "person@example.com",
      recipients: ["inbox@example.com"],
      subject: "New",
      occurredAt: new Date("2026-07-23T10:00:00.000Z"),
    });
    await importProviderAccount({ ownerId: "owner-a", provider });
    expect(
      state.activities.filter((activity) => activity.type === "MESSAGE_RECEIVED"),
    ).toHaveLength(1);
    expect(
      state.activities.find(
        (activity) => activity.type === "MESSAGE_RECEIVED",
      ),
    ).toEqual(
      expect.objectContaining({
        userId: "owner-a",
        leadId: "lead-a",
        actorType: "CONTACT",
        source: "INBOX",
        title: "New email received",
        occurredAt: new Date("2026-07-23T10:00:00.000Z"),
        idempotencyKey: expect.stringMatching(
          /^message:message-\d+:INBOUND$/,
        ),
      }),
    );
  });

  it("remains duplicate-safe when two imports start together", async () => {
    const provider = new MutableProvider();
    const firstChanged = vi.fn();
    const secondChanged = vi.fn();
    await Promise.all([
      importProviderAccount({
        ownerId: "owner-a",
        provider,
        options: { onConversationChanged: firstChanged },
      }),
      importProviderAccount({
        ownerId: "owner-a",
        provider,
        options: { onConversationChanged: secondChanged },
      }),
    ]);
    expect(state.account).not.toBeNull();
    expect(state.conversations).toHaveLength(1);
    expect(state.messages).toHaveLength(2);
    expect(firstChanged.mock.calls.length + secondChanged.mock.calls.length)
      .toBe(1);
  });

  it("can retry safely after a focused conversation write fails", async () => {
    const provider = new MutableProvider();
    database.message.createMany.mockRejectedValueOnce(
      new Error("simulated database interruption"),
    );
    await expect(
      importProviderAccount({ ownerId: "owner-a", provider }),
    ).rejects.toThrow("simulated database interruption");

    await expect(
      importProviderAccount({ ownerId: "owner-a", provider }),
    ).resolves.toEqual(expect.objectContaining({ messagesCreated: 2 }));
    expect(state.conversations).toHaveLength(1);
    expect(state.messages).toHaveLength(2);
  });
});
