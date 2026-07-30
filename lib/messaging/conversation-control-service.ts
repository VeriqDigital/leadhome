import "server-only";

import {
  Prisma,
  type ConversationClassification,
  type ConversationReviewState,
  type ConversationStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  attachConversationToLead,
  detachConversation,
} from "./conversation-service";
import {
  enqueueConversationAnalysisAfterLeadLink,
} from "@/lib/ai/conversation-analysis/job-service";
import { recordActivity } from "@/lib/activity-service";

const controlsSelect = {
  id: true,
  leadId: true,
  lead: { select: { id: true, name: true, email: true } },
  classification: true,
  reviewState: true,
  status: true,
  updatedAt: true,
  subject: true,
} satisfies Prisma.ConversationSelect;

export type CanonicalConversationControlsDto = {
  id: string;
  leadId: string | null;
  lead: { id: string; name: string; email: string | null } | null;
  classification: ConversationClassification;
  reviewState: ConversationReviewState;
  status: ConversationStatus;
  updatedAt: string;
};

export type PersistedConversationMutation = {
  changed: boolean;
  conversation: CanonicalConversationControlsDto;
};

function dto(row: {
  id: string;
  leadId: string | null;
  lead: { id: string; name: string; email: string | null } | null;
  classification: ConversationClassification;
  reviewState: ConversationReviewState;
  status: ConversationStatus;
  updatedAt: Date;
  subject?: string | null;
}): CanonicalConversationControlsDto {
  return {
    id: row.id,
    leadId: row.leadId,
    lead: row.lead,
    classification: row.classification,
    reviewState: row.reviewState,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readCanonical(
  client: Pick<typeof prisma, "conversation">,
  ownerId: string,
  conversationId: string,
) {
  const conversation = await client.conversation.findFirst({
    where: { id: conversationId, ownerId },
    select: controlsSelect,
  });
  if (!conversation) throw new Error("Conversation not found.");
  return conversation;
}

async function updateField<
  K extends "classification" | "reviewState" | "status",
>({
  ownerId,
  conversationId,
  field,
  value,
}: {
  ownerId: string;
  conversationId: string;
  field: K;
  value: {
    classification: ConversationClassification;
    reviewState: ConversationReviewState;
    status: ConversationStatus;
  }[K];
}): Promise<PersistedConversationMutation> {
  return prisma.$transaction(async (tx) => {
    const current = await readCanonical(tx, ownerId, conversationId);
    if (current[field] === value) {
      return { changed: false, conversation: dto(current) };
    }
    const updated = await tx.conversation.updateMany({
      where: { id: conversationId, ownerId },
      data: { [field]: value },
    });
    if (updated.count !== 1) throw new Error("Conversation was not updated.");
    const canonical = await readCanonical(tx, ownerId, conversationId);
    if (field === "status") {
      await recordActivity(tx, {
        ownerId,
        leadId: current.leadId,
        conversationId,
        type: "CONVERSATION_STATUS_CHANGED",
        actorType: "USER",
        source: "INBOX",
        title: "Conversation status changed",
        description: `${current.status.toLowerCase()} → ${canonical.status.toLowerCase()}`,
        metadata: { from: current.status, to: canonical.status },
      });
    }
    if (canonical[field] !== value) {
      throw new Error("Persisted conversation does not match the requested value.");
    }
    return { changed: true, conversation: dto(canonical) };
  });
}

export function updateConversationClassification(input: {
  ownerId: string;
  conversationId: string;
  classification: ConversationClassification;
}) {
  return updateField({ ...input, field: "classification", value: input.classification });
}

export function updateConversationReviewState(input: {
  ownerId: string;
  conversationId: string;
  reviewState: ConversationReviewState;
}) {
  return updateField({ ...input, field: "reviewState", value: input.reviewState });
}

export function updateConversationStatus(input: {
  ownerId: string;
  conversationId: string;
  status: ConversationStatus;
}) {
  return updateField({ ...input, field: "status", value: input.status });
}

export async function attachConversationControl(input: {
  ownerId: string;
  conversationId: string;
  leadId: string;
}): Promise<PersistedConversationMutation> {
  const before = await readCanonical(prisma, input.ownerId, input.conversationId);
  if (before.leadId === input.leadId) {
    return { changed: false, conversation: dto(before) };
  }
  await attachConversationToLead(input);
  const canonical = await readCanonical(prisma, input.ownerId, input.conversationId);
  if (canonical.leadId !== input.leadId) throw new Error("Lead attachment was not persisted.");
  return { changed: true, conversation: dto(canonical) };
}

export async function detachConversationControl(input: {
  ownerId: string;
  conversationId: string;
}): Promise<PersistedConversationMutation> {
  const before = await readCanonical(prisma, input.ownerId, input.conversationId);
  if (!before.leadId) return { changed: false, conversation: dto(before) };
  await detachConversation(input);
  const canonical = await readCanonical(prisma, input.ownerId, input.conversationId);
  if (canonical.leadId) throw new Error("Lead detachment was not persisted.");
  return { changed: true, conversation: dto(canonical) };
}

export async function updateConversationControls(input: {
  ownerId: string;
  conversationId: string;
  leadId: string | null;
  classification: ConversationClassification;
  reviewState: ConversationReviewState;
  status: ConversationStatus;
}): Promise<PersistedConversationMutation> {
  const result = await prisma.$transaction(async (tx) => {
    const current = await readCanonical(tx, input.ownerId, input.conversationId);
    const leadChanged = current.leadId !== input.leadId;
    const classificationChanged = current.classification !== input.classification;
    const reviewChanged = current.reviewState !== input.reviewState;
    const statusChanged = current.status !== input.status;
    if (!leadChanged && !classificationChanged && !reviewChanged && !statusChanged) {
      return { changed: false, conversation: dto(current) };
    }

    if (input.leadId) {
      const ownedLead = await tx.lead.findFirst({
        where: { id: input.leadId, userId: input.ownerId },
        select: { id: true },
      });
      if (!ownedLead) throw new Error("Lead not found.");
    }

    const data: Prisma.ConversationUncheckedUpdateManyInput = {};
    if (classificationChanged) {
      data.classification = input.classification;
      data.classificationIsManual = true;
    }
    if (reviewChanged) data.reviewState = input.reviewState;
    if (statusChanged) data.status = input.status;
    if (leadChanged) {
      data.leadId = input.leadId;
      if (input.leadId) {
        data.manuallyDetached = false;
        data.matchKind = "MATCHED";
        data.matchReason = "manually attached";
        data.matchCandidateLeadIds = Prisma.JsonNull;
        if (!reviewChanged) data.reviewState = "MATCHED";
      } else {
        data.manuallyDetached = true;
        data.matchKind = "NO_MATCH";
        data.matchReason = "conversation was manually detached";
        data.matchCandidateLeadIds = Prisma.JsonNull;
        if (!reviewChanged) data.reviewState = "RESOLVED";
      }
    }

    const updated = await tx.conversation.updateMany({
      where: { id: input.conversationId, ownerId: input.ownerId },
      data,
    });
    if (updated.count !== 1) throw new Error("Conversation was not updated.");

    if (leadChanged && current.leadId) {
      await recordActivity(tx, {
        ownerId: input.ownerId,
        leadId: current.leadId,
        conversationId: input.conversationId,
        type: "CONVERSATION_UNLINKED",
        actorType: "USER",
        source: "INBOX",
        title: "Conversation detached",
        description: current.subject ?? "No subject",
      });
    }
    if (leadChanged && input.leadId) {
      await recordActivity(tx, {
        ownerId: input.ownerId,
        leadId: input.leadId,
        conversationId: input.conversationId,
        type: "CONVERSATION_LINKED",
        actorType: "USER",
        source: "INBOX",
        title: "Conversation attached",
        description: current.subject ?? "No subject",
      });
      await tx.lead.update({
        where: { id: input.leadId },
        data: { updatedAt: new Date() },
      });
    }
    if (statusChanged) {
      const activityLeadId = input.leadId ?? current.leadId;
      await recordActivity(tx, {
        ownerId: input.ownerId,
        leadId: activityLeadId,
        conversationId: input.conversationId,
        type: "CONVERSATION_STATUS_CHANGED",
        actorType: "USER",
        source: "INBOX",
        title: "Conversation status changed",
        description: `${current.status.toLowerCase()} → ${input.status.toLowerCase()}`,
        metadata: { from: current.status, to: input.status },
      });
    }

    const canonical = await readCanonical(tx, input.ownerId, input.conversationId);
    return {
      changed: true,
      conversation: dto(canonical),
      attached: leadChanged && Boolean(input.leadId),
    };
  });
  if (result.changed && "attached" in result && result.attached) {
    await enqueueConversationAnalysisAfterLeadLink(
      input.ownerId,
      input.conversationId,
    );
  }
  return {
    changed: result.changed,
    conversation: result.conversation,
  };
}
