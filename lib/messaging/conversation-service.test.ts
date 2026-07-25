import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accountFind: vi.fn(),
  conversationCreate: vi.fn(),
  conversationFind: vi.fn(),
  conversationUpdate: vi.fn(),
  messageCreate: vi.fn(),
  messageFind: vi.fn(),
  leadFind: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationAccount: { findFirst: mocks.accountFind },
    conversation: {
      create: mocks.conversationCreate,
      findFirst: mocks.conversationFind,
    },
    message: { findFirst: mocks.messageFind },
    $transaction: mocks.transaction,
  },
}));

import {
  attachConversationToLead,
  createConversation,
  createMessage,
  detachConversation,
  findConversationByProviderId,
  findMessageByProviderId,
} from "./conversation-service";

const ownerId = "user-a";
const conversationId = "conversation-a";
const leadId = "lead-a";

beforeEach(() => {
  mocks.accountFind.mockResolvedValue({ id: "account-a" });
  mocks.conversationCreate.mockResolvedValue({ id: conversationId });
  mocks.conversationFind.mockResolvedValue({ id: conversationId });
  mocks.messageFind.mockResolvedValue({ id: "message-a" });
  mocks.conversationUpdate.mockImplementation(({ data }) =>
    Promise.resolve({ id: conversationId, ...data }),
  );
  mocks.messageCreate.mockResolvedValue({ id: "message-a" });
  mocks.leadFind.mockResolvedValue({ id: leadId });
  mocks.activityCreate.mockResolvedValue({ id: "activity-a" });
  mocks.transaction.mockImplementation((operation) =>
    operation({
      conversation: {
        findFirst: mocks.conversationFind,
        update: mocks.conversationUpdate,
      },
      message: { create: mocks.messageCreate },
      lead: { findFirst: mocks.leadFind },
      leadActivity: { create: mocks.activityCreate },
    }),
  );
});

describe("conversation service", () => {
  it("creates a conversation only under an owned provider account", async () => {
    await createConversation({
      ownerId,
      accountId: "account-a",
      provider: "FAKE",
      providerConversationId: "provider-thread-a",
      subject: "Estimate",
    });

    expect(mocks.accountFind).toHaveBeenCalledWith({
      where: { id: "account-a", ownerId, provider: "FAKE" },
      select: { id: true },
    });
    expect(mocks.conversationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerId, accountId: "account-a" }),
    });
  });

  it("rejects conversation creation for another user's account", async () => {
    mocks.accountFind.mockResolvedValue(null);
    await expect(createConversation({
      ownerId,
      accountId: "account-b",
      provider: "FAKE",
      providerConversationId: "provider-thread-a",
    })).rejects.toThrow("Communication account not found.");
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
  });

  it("creates a message and a body-free received timeline reference", async () => {
    mocks.conversationFind.mockResolvedValue({
      id: conversationId,
      accountId: "account-a",
      leadId,
    });
    await createMessage({
      ownerId,
      conversationId,
      providerMessageId: "provider-message-a",
      direction: "INBOUND",
      sender: "customer@example.test",
      recipients: ["inbox@example.test"],
      subject: "Estimate",
      bodyText: "A private body that must not enter activity metadata.",
      receivedAt: new Date("2026-07-24T12:00:00.000Z"),
    });

    expect(mocks.messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId,
        conversationId,
        accountId: "account-a",
      }),
    });
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: {
        leadId,
        userId: ownerId,
        conversationId,
        messageId: "message-a",
        type: "MESSAGE_RECEIVED",
        title: "Message received",
        description: "Estimate",
      },
    });
  });

  it("rejects message creation when the conversation is not owned", async () => {
    mocks.conversationFind.mockResolvedValue(null);
    await expect(createMessage({
      ownerId,
      conversationId: "conversation-b",
      providerMessageId: "provider-message-a",
      direction: "INBOUND",
      sender: "customer@example.test",
      recipients: ["inbox@example.test"],
      bodyText: "Hello",
      receivedAt: new Date(),
    })).rejects.toThrow("Conversation not found.");
    expect(mocks.messageCreate).not.toHaveBeenCalled();
  });

  it("propagates duplicate provider message IDs so the transaction rolls back", async () => {
    mocks.conversationFind.mockResolvedValue({
      id: conversationId,
      accountId: "account-a",
      leadId: null,
    });
    mocks.messageCreate.mockRejectedValue(
      Object.assign(new Error("Unique constraint"), { code: "P2002" }),
    );
    await expect(createMessage({
      ownerId,
      conversationId,
      providerMessageId: "duplicate",
      direction: "INBOUND",
      sender: "customer@example.test",
      recipients: ["inbox@example.test"],
      bodyText: "Hello",
      receivedAt: new Date(),
    })).rejects.toMatchObject({ code: "P2002" });
    expect(mocks.activityCreate).not.toHaveBeenCalled();
  });

  it("attaches once, checks both owners, and writes a timeline event", async () => {
    mocks.conversationFind
      .mockResolvedValueOnce({
        id: conversationId,
        leadId: null,
        subject: "Estimate",
      })
      .mockResolvedValueOnce({
        id: conversationId,
        leadId,
        subject: "Estimate",
      });
    await attachConversationToLead({ conversationId, leadId, ownerId });
    await attachConversationToLead({ conversationId, leadId, ownerId });

    expect(mocks.conversationFind).toHaveBeenCalledWith({
      where: { id: conversationId, ownerId },
      select: { id: true, leadId: true, subject: true },
    });
    expect(mocks.leadFind).toHaveBeenCalledWith({
      where: { id: leadId, userId: ownerId },
      select: { id: true },
    });
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId,
        userId: ownerId,
        conversationId,
        type: "CONVERSATION_LINKED",
      }),
    });
    expect(mocks.activityCreate).toHaveBeenCalledTimes(1);
  });

  it("detaches an owned conversation and records the prior lead", async () => {
    mocks.conversationFind.mockResolvedValue({
      id: conversationId,
      leadId,
      subject: "Estimate",
    });
    await detachConversation({ conversationId, ownerId });

    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: conversationId },
      data: expect.objectContaining({
        leadId: null,
        manuallyDetached: true,
        reviewState: "RESOLVED",
      }),
    });
    expect(mocks.activityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId,
        type: "CONVERSATION_UNLINKED",
      }),
    });
  });

  it("scopes provider ID lookups through message and conversation ownership", async () => {
    await findConversationByProviderId({
      accountId: "account-a",
      providerConversationId: "provider-thread-a",
      ownerId,
    });
    await findMessageByProviderId({
      conversationId,
      providerMessageId: "provider-message-a",
      ownerId,
    });

    expect(mocks.conversationFind).toHaveBeenCalledWith({
      where: {
        accountId: "account-a",
        providerConversationId: "provider-thread-a",
        ownerId,
      },
    });
    expect(mocks.messageFind).toHaveBeenCalledWith({
      where: { conversationId, providerMessageId: "provider-message-a", ownerId },
    });
  });
});
