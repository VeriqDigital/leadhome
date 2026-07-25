import "server-only";

import type {
  ConversationStatus,
  MessageDirection,
  MessageProvider,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CreateConversationInput = {
  ownerId: string;
  accountId: string;
  provider: MessageProvider;
  providerConversationId: string;
  subject?: string | null;
  status?: ConversationStatus;
};

export type CreateMessageInput = {
  ownerId: string;
  conversationId: string;
  providerMessageId: string;
  direction: MessageDirection;
  sender: string;
  recipients: string[];
  replyTo?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  receivedAt: Date;
  metadata?: Prisma.InputJsonValue;
};

export async function createConversation(input: CreateConversationInput) {
  const account = await prisma.communicationAccount.findFirst({
    where: { id: input.accountId, ownerId: input.ownerId, provider: input.provider },
    select: { id: true },
  });
  if (!account) throw new Error("Communication account not found.");

  return prisma.conversation.create({
    data: {
      accountId: input.accountId,
      ownerId: input.ownerId,
      provider: input.provider,
      providerConversationId: input.providerConversationId,
      subject: input.subject,
      status: input.status,
    },
  });
}

export async function createMessage(input: CreateMessageInput) {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: input.conversationId, ownerId: input.ownerId },
      select: { id: true, accountId: true, leadId: true },
    });
    if (!conversation) throw new Error("Conversation not found.");

    const message = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        accountId: conversation.accountId,
        ownerId: input.ownerId,
        providerMessageId: input.providerMessageId,
        direction: input.direction,
        sender: input.sender,
        recipients: input.recipients,
        replyTo: input.replyTo,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        receivedAt: input.receivedAt,
        metadata: input.metadata,
      },
    });
    if (conversation.leadId) {
      await tx.leadActivity.create({
        data: {
          leadId: conversation.leadId,
          userId: input.ownerId,
          conversationId: conversation.id,
          messageId: message.id,
          type: input.direction === "INBOUND" ? "MESSAGE_RECEIVED" : "MESSAGE_SENT",
          title: input.direction === "INBOUND" ? "Message received" : "Message sent",
          description: input.subject ?? "No subject",
        },
      });
    }
    return message;
  });
}

export async function attachConversationToLead({
  conversationId,
  leadId,
  ownerId,
}: {
  conversationId: string;
  leadId: string;
  ownerId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const [conversation, lead] = await Promise.all([
      tx.conversation.findFirst({
        where: { id: conversationId, ownerId },
        select: { id: true, leadId: true, subject: true },
      }),
      tx.lead.findFirst({ where: { id: leadId, userId: ownerId }, select: { id: true } }),
    ]);
    if (!conversation || !lead) throw new Error("Conversation or lead not found.");
    if (conversation.leadId === leadId) return conversation;

    if (conversation.leadId) {
      await tx.leadActivity.create({
        data: {
          leadId: conversation.leadId,
          userId: ownerId,
          conversationId,
          type: "CONVERSATION_UNLINKED",
          title: "Conversation unlinked",
          description: conversation.subject ?? "No subject",
        },
      });
    }
    const updated = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        leadId,
        manuallyDetached: false,
        reviewState: "MATCHED",
        matchKind: "MATCHED",
        matchReason: "manually attached",
      },
    });
    await tx.leadActivity.create({
      data: {
        leadId,
        userId: ownerId,
        conversationId,
        type: "CONVERSATION_LINKED",
        title: "Conversation attached",
        description: conversation.subject ?? "No subject",
      },
    });
    return updated;
  });
}

export async function detachConversation({
  conversationId,
  ownerId,
}: {
  conversationId: string;
  ownerId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, ownerId },
      select: { id: true, leadId: true, subject: true },
    });
    if (!conversation) throw new Error("Conversation not found.");
    if (!conversation.leadId) return conversation;

    const updated = await tx.conversation.update({
      where: { id: conversationId },
      data: {
        leadId: null,
        manuallyDetached: true,
        reviewState: "RESOLVED",
        matchKind: "NO_MATCH",
        matchReason: "conversation was manually detached",
      },
    });
    await tx.leadActivity.create({
      data: {
        leadId: conversation.leadId,
        userId: ownerId,
        conversationId,
        type: "CONVERSATION_UNLINKED",
        title: "Conversation unlinked",
        description: conversation.subject ?? "No subject",
      },
    });
    return updated;
  });
}

export function findConversationByProviderId({
  accountId,
  providerConversationId,
  ownerId,
}: {
  accountId: string;
  providerConversationId: string;
  ownerId: string;
}) {
  return prisma.conversation.findFirst({
    where: { accountId, providerConversationId, ownerId },
  });
}

export function findMessageByProviderId({
  conversationId,
  providerMessageId,
  ownerId,
}: {
  conversationId: string;
  providerMessageId: string;
  ownerId: string;
}) {
  return prisma.message.findFirst({
    where: { conversationId, providerMessageId, ownerId },
  });
}
