import "server-only";

import {
  Prisma,
  type LeadSource,
  type LeadStatus,
  type MessageProvider,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/lib/inbound-crypto";
import { normalizeEmailAddresses } from "./matching-service";
import {
  enqueueConversationAnalysisAfterLeadLink,
} from "@/lib/ai/conversation-analysis/job-service";
import { recordActivity } from "@/lib/activity-service";
import { detectCompanyAfterAttachment } from "./company-detection-service";

export type ConversationLeadPrefill = {
  name: string;
  email: string;
  company: string;
  phone: string;
  source: LeadSource;
  status: LeadStatus;
  message: string;
  estimatedValue: null;
  nextFollowUp: null;
};

function plainText(html: string) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function participantIdentity(value: string | null | undefined) {
  const email = normalizeEmailAddresses(value)[0] ?? "";
  const display = value
    ?.replace(/<[^<>]+>/g, "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return {
    email,
    name: display && display !== email ? display.slice(0, 120) : "New lead",
  };
}

function sourceFor(provider: MessageProvider, sourceSystem?: string | null): LeadSource {
  if (sourceSystem?.toLowerCase().includes("website")) return "WEBSITE";
  if (provider === "GMAIL") return "GMAIL";
  if (provider === "FACEBOOK_MESSENGER" || provider === "INSTAGRAM") {
    return "FACEBOOK";
  }
  return "MANUAL";
}

export async function getConversationLeadPrefill(
  ownerId: string,
  conversationId: string,
) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, ownerId },
    select: {
      id: true,
      leadId: true,
      provider: true,
      messages: {
        where: { direction: "INBOUND" },
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        take: 1,
        select: {
          sender: true,
          replyTo: true,
          bodyText: true,
          bodyHtml: true,
          sourceSystem: true,
          externalSubmissionId: true,
        },
      },
    },
  });
  if (!conversation) return null;
  const first = conversation.messages[0];
  const identity = participantIdentity(first?.replyTo ?? first?.sender);
  const excerpt = (
    first?.bodyText?.trim() ||
    (first?.bodyHtml ? plainText(first.bodyHtml) : "")
  )
    .replace(/\s+/g, " ")
    .slice(0, 500);
  const submissionLeadId = first?.externalSubmissionId
    ? (
        await prisma.inboundSubmission.findFirst({
          where: {
            idempotencyHash: hashSecret(first.externalSubmissionId),
            source: { userId: ownerId },
          },
          select: { leadId: true },
        })
      )?.leadId
    : null;
  const duplicate = submissionLeadId
    ? await prisma.lead.findFirst({
        where: { id: submissionLeadId, userId: ownerId },
        select: { id: true, name: true, email: true },
      })
    : identity.email
      ? await prisma.lead.findFirst({
        where: {
          userId: ownerId,
          email: { equals: identity.email, mode: "insensitive" },
        },
        select: { id: true, name: true, email: true },
      })
      : null;
  return {
    conversation,
    duplicate,
    lead: {
      name: identity.name,
      email: identity.email,
      company: "",
      phone: "",
      source: sourceFor(conversation.provider, first?.sourceSystem),
      status: "NEW" as const,
      message: excerpt,
      estimatedValue: null,
      nextFollowUp: null,
    } satisfies ConversationLeadPrefill,
  };
}

export class DuplicateLeadConfirmationRequired extends Error {}

export async function createLeadFromConversation({
  ownerId,
  conversationId,
  lead,
  duplicateChoice,
  duplicateLeadId,
}: {
  ownerId: string;
  conversationId: string;
  lead: {
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    source: LeadSource;
    status: LeadStatus;
    message: string | null;
    estimatedValue: number | null;
    nextFollowUpDate: Date | null;
  };
  duplicateChoice?: "attach-existing" | "create-separate";
  duplicateLeadId?: string | null;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, ownerId },
      select: {
        id: true,
        leadId: true,
        subject: true,
        messages: {
          where: { externalSubmissionId: { not: null } },
          take: 1,
          select: { externalSubmissionId: true },
        },
      },
    });
    if (!conversation) throw new Error("Conversation not found.");
    if (conversation.leadId) throw new Error("Conversation is already attached.");

    const submissionId = conversation.messages[0]?.externalSubmissionId;
    const submission = submissionId
      ? await tx.inboundSubmission.findFirst({
          where: {
            idempotencyHash: hashSecret(submissionId),
            source: { userId: ownerId },
          },
          select: { leadId: true },
        })
      : null;
    const duplicate = submission
      ? await tx.lead.findFirst({
          where: { id: submission.leadId, userId: ownerId },
          select: { id: true },
        })
      : lead.email
        ? await tx.lead.findFirst({
          where: {
            userId: ownerId,
            email: { equals: lead.email, mode: "insensitive" },
          },
          select: { id: true },
        })
        : null;
    if (duplicate && duplicateChoice !== "create-separate") {
      if (
        duplicateChoice !== "attach-existing" ||
        duplicateLeadId !== duplicate.id
      ) {
        throw new DuplicateLeadConfirmationRequired();
      }
      await attach(tx, ownerId, conversation, duplicate.id);
      return { leadId: duplicate.id, created: false };
    }

    const created = await tx.lead.create({
      data: { ...lead, userId: ownerId },
      select: { id: true },
    });
    await recordActivity(tx, {
      ownerId,
      leadId: created.id,
      conversationId,
      type: "LEAD_CREATED",
      actorType: "USER",
      source: "INBOX",
      title: "Lead created",
      description: "Created from Inbox conversation",
    });
    await attach(tx, ownerId, conversation, created.id);
    return { leadId: created.id, created: true };
  });
  await detectCompanyAfterAttachment(ownerId, conversationId);
  await enqueueConversationAnalysisAfterLeadLink(ownerId, conversationId);
  return result;
}

async function attach(
  tx: Prisma.TransactionClient,
  ownerId: string,
  conversation: { id: string; subject: string | null },
  leadId: string,
) {
  const updated = await tx.conversation.updateMany({
    where: { id: conversation.id, ownerId, leadId: null },
    data: {
      leadId,
      manuallyDetached: false,
      reviewState: "MATCHED",
      classification: "LEAD",
      classificationIsManual: true,
      matchKind: "MATCHED",
      matchReason: "lead created or selected from conversation",
      matchCandidateLeadIds: Prisma.JsonNull,
    },
  });
  if (updated.count !== 1) throw new Error("Conversation was not attached.");
  await recordActivity(tx, {
    ownerId,
    leadId,
    conversationId: conversation.id,
    type: "CONVERSATION_LINKED",
    actorType: "USER",
    source: "INBOX",
    title: "Conversation attached",
    description: conversation.subject ?? "No subject",
    metadata: { automatic: false, source: "create-lead-from-conversation" },
  });
  await tx.lead.update({
    where: { id: leadId },
    data: { updatedAt: new Date() },
  });
}
