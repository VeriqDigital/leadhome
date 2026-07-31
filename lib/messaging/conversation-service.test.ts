import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  accountFind: vi.fn(),
  conversationCreate: vi.fn(),
  conversationFind: vi.fn(),
  conversationFindMany: vi.fn(),
  conversationUpdate: vi.fn(),
  messageCreate: vi.fn(),
  messageFind: vi.fn(),
  messageFindMany: vi.fn(),
  leadFind: vi.fn(),
  leadFindMany: vi.fn(),
  leadUpdate: vi.fn(),
  taskFindMany: vi.fn(),
  activityCreateMany: vi.fn(),
  transaction: vi.fn(),
  analysisEnqueue: vi.fn(),
  detectCompany: vi.fn(),
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
vi.mock("@/lib/ai/conversation-analysis/job-service", () => ({
  enqueueConversationAnalysisAfterLeadLink: mocks.analysisEnqueue,
}));
vi.mock("./company-detection-service", () => ({
  detectCompanyAfterAttachment: mocks.detectCompany,
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
  mocks.conversationFindMany.mockResolvedValue([
    { id: conversationId, leadId },
  ]);
  mocks.messageFind.mockResolvedValue({ id: "message-a" });
  mocks.messageFindMany.mockResolvedValue([
    { id: "message-a", conversationId },
  ]);
  mocks.conversationUpdate.mockImplementation(({ data }) =>
    Promise.resolve({ id: conversationId, ...data }),
  );
  mocks.messageCreate.mockResolvedValue({ id: "message-a" });
  mocks.leadFind.mockResolvedValue({ id: leadId });
  mocks.leadFindMany.mockResolvedValue([{ id: leadId }]);
  mocks.leadUpdate.mockResolvedValue({ id: leadId });
  mocks.taskFindMany.mockResolvedValue([]);
  mocks.activityCreateMany.mockImplementation(({ data }) =>
    Promise.resolve({ count: data.length }),
  );
  mocks.analysisEnqueue.mockResolvedValue(undefined);
  mocks.detectCompany.mockResolvedValue(null);
  mocks.transaction.mockImplementation((operation) =>
    operation({
      conversation: {
        findFirst: mocks.conversationFind,
        findMany: mocks.conversationFindMany,
        update: mocks.conversationUpdate,
      },
      message: {
        create: mocks.messageCreate,
        findMany: mocks.messageFindMany,
      },
      lead: {
        findFirst: mocks.leadFind,
        findMany: mocks.leadFindMany,
        update: mocks.leadUpdate,
      },
      task: { findMany: mocks.taskFindMany },
      leadActivity: { createMany: mocks.activityCreateMany },
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
      provider: "GMAIL",
    });
    const receivedAt = new Date("2026-07-24T12:00:00.000Z");
    await createMessage({
      ownerId,
      conversationId,
      providerMessageId: "provider-message-a",
      direction: "INBOUND",
      sender: "customer@example.test",
      recipients: ["inbox@example.test"],
      subject: "Estimate",
      bodyText: "A private body that must not enter activity metadata.",
      receivedAt,
    });

    expect(mocks.messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId,
        conversationId,
        accountId: "account-a",
      }),
    });
    expect(mocks.activityCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leadId,
          userId: ownerId,
          conversationId,
          messageId: "message-a",
          taskId: null,
          type: "MESSAGE_RECEIVED",
          actorType: "CONTACT",
          source: "GMAIL",
          title: "New email received",
          description: "Estimate",
          occurredAt: receivedAt,
          idempotencyKey: "message:message-a:INBOUND",
        }),
      ],
      skipDuplicates: true,
    });
    expect(mocks.activityCreateMany.mock.calls[0]?.[0].data[0])
      .not.toHaveProperty("bodyText");
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
    expect(mocks.activityCreateMany).not.toHaveBeenCalled();
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
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: conversationId },
      data: {
        leadId,
        manuallyDetached: false,
        reviewState: "MATCHED",
        matchKind: "MATCHED",
        matchReason: "manually attached",
        matchCandidateLeadIds: Prisma.JsonNull,
      },
    });
    expect(mocks.activityCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leadId,
          userId: ownerId,
          conversationId,
          type: "CONVERSATION_LINKED",
          actorType: "USER",
          source: "INBOX",
          title: "Conversation attached",
        }),
      ],
      skipDuplicates: false,
    });
    expect(mocks.activityCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.leadUpdate).toHaveBeenCalledWith({
      where: { id: leadId },
      data: { updatedAt: expect.any(Date) },
    });
    expect(mocks.analysisEnqueue).toHaveBeenCalledTimes(1);
    expect(mocks.analysisEnqueue).toHaveBeenCalledWith(ownerId, conversationId);
    expect(mocks.detectCompany).toHaveBeenCalledOnce();
    expect(mocks.detectCompany).toHaveBeenCalledWith(ownerId, conversationId);
    expect(mocks.leadUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.analysisEnqueue.mock.invocationCallOrder[0],
    );
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
        matchKind: "NO_MATCH",
        matchReason: "conversation was manually detached",
        matchCandidateLeadIds: Prisma.JsonNull,
      }),
    });
    expect(mocks.activityCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leadId,
          type: "CONVERSATION_UNLINKED",
          actorType: "USER",
          source: "INBOX",
          title: "Conversation detached",
        }),
      ],
      skipDuplicates: false,
    });
    expect(mocks.analysisEnqueue).not.toHaveBeenCalled();
    expect(mocks.detectCompany).not.toHaveBeenCalled();
  });

  it("does not enqueue analysis when lead attachment fails", async () => {
    mocks.conversationFind.mockResolvedValue(null);

    await expect(
      attachConversationToLead({ conversationId, leadId, ownerId }),
    ).rejects.toThrow("Conversation or lead not found");

    expect(mocks.analysisEnqueue).not.toHaveBeenCalled();
    expect(mocks.detectCompany).not.toHaveBeenCalled();
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
