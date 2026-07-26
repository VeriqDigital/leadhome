import "server-only";

import type {
  ConversationClassification,
  ConversationReviewState,
  ConversationStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function setConversationClassification({
  ownerId,
  conversationId,
  classification,
}: {
  ownerId: string;
  conversationId: string;
  classification: ConversationClassification;
}) {
  const updated = await prisma.conversation.updateMany({
    where: { id: conversationId, ownerId },
    data: { classification, classificationIsManual: true },
  });
  if (!updated.count) throw new Error("Conversation not found.");
}

export async function setConversationStatus({
  ownerId, conversationId, status,
}: {
  ownerId: string; conversationId: string; status: ConversationStatus;
}) {
  const updated = await prisma.conversation.updateMany({
    where: { id: conversationId, ownerId }, data: { status },
  });
  if (!updated.count) throw new Error("Conversation not found.");
}

export async function setConversationReviewState({
  ownerId,
  conversationId,
  reviewState,
}: {
  ownerId: string;
  conversationId: string;
  reviewState: ConversationReviewState;
}) {
  const updated = await prisma.conversation.updateMany({
    where: { id: conversationId, ownerId },
    data: { reviewState },
  });
  if (!updated.count) throw new Error("Conversation not found.");
}
