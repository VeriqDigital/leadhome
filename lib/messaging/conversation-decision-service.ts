import "server-only";

import type {
  ConversationClassification,
  ConversationReviewState,
  ConversationStatus,
} from "@prisma/client";
import {
  updateConversationClassification,
  updateConversationReviewState,
  updateConversationStatus,
} from "./conversation-control-service";

export async function setConversationClassification({
  ownerId,
  conversationId,
  classification,
}: {
  ownerId: string;
  conversationId: string;
  classification: ConversationClassification;
}) {
  await updateConversationClassification({
    ownerId,
    conversationId,
    classification,
  });
}

export async function setConversationStatus({
  ownerId, conversationId, status,
}: {
  ownerId: string; conversationId: string; status: ConversationStatus;
}) {
  await updateConversationStatus({ ownerId, conversationId, status });
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
  await updateConversationReviewState({
    ownerId,
    conversationId,
    reviewState,
  });
}
