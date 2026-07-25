import "server-only";

import { hashSecret } from "@/lib/inbound-crypto";
import { prisma } from "@/lib/prisma";
import type { NormalizedMessage } from "./provider";

export type LeadMatchResult =
  | {
      kind: "MATCHED";
      leadId: string;
      confidence: "HIGH";
      reason: string;
    }
  | {
      kind: "AMBIGUOUS";
      candidateLeadIds: string[];
      reason: string;
    }
  | {
      kind: "NO_MATCH";
      reason: string;
    };

export function normalizeEmailAddresses(
  value: string | string[] | null | undefined,
): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [
    ...new Set(
      values
        .flatMap((item) => item.split(","))
        .map((item) => {
          const angleAddress = item.match(/<([^<>]+)>/)?.[1];
          return (angleAddress ?? item).trim().toLowerCase();
        })
        .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)),
    ),
  ];
}

export async function findExistingInboundSubmissionMatch({
  ownerId,
  externalSubmissionId,
}: {
  ownerId: string;
  externalSubmissionId: string;
}): Promise<string | null> {
  const submission = await prisma.inboundSubmission.findFirst({
    where: {
      idempotencyHash: hashSecret(externalSubmissionId),
      source: { userId: ownerId },
    },
    select: { leadId: true },
  });
  return submission?.leadId ?? null;
}

export async function findLeadForConversation({
  ownerId,
  conversation,
  messages,
  accountAddress,
}: {
  ownerId: string;
  conversation: {
    leadId: string | null;
    manuallyDetached: boolean;
  };
  messages: NormalizedMessage[];
  accountAddress?: string | null;
}): Promise<LeadMatchResult> {
  if (conversation.leadId) {
    return {
      kind: "MATCHED",
      leadId: conversation.leadId,
      confidence: "HIGH",
      reason: "conversation already attached",
    };
  }
  if (conversation.manuallyDetached) {
    return {
      kind: "NO_MATCH",
      reason: "conversation was manually detached",
    };
  }

  const submissionIds = [
    ...new Set(
      messages
        .map((message) => message.externalSubmissionId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  for (const externalSubmissionId of submissionIds) {
    const leadId = await findExistingInboundSubmissionMatch({
      ownerId,
      externalSubmissionId,
    });
    if (leadId) {
      return {
        kind: "MATCHED",
        leadId,
        confidence: "HIGH",
        reason: "external submission ID matched a website lead",
      };
    }
  }

  const internalAddress = normalizeEmailAddresses(accountAddress)[0];
  const internalDomain = internalAddress?.split("@")[1];
  const participants = new Set<string>();
  for (const message of messages) {
    if (message.direction !== "INBOUND") continue;
    const candidates = normalizeEmailAddresses(message.replyTo ?? message.sender);
    for (const candidate of candidates) {
      const domain = candidate.split("@")[1];
      if (candidate !== internalAddress && (!internalDomain || domain !== internalDomain)) {
        participants.add(candidate);
      }
    }
  }
  if (!participants.size) {
    return { kind: "NO_MATCH", reason: "no external participant matched" };
  }

  const leads = await prisma.lead.findMany({
    where: { userId: ownerId, email: { not: null } },
    select: { id: true, email: true },
  });
  const candidateLeadIds = [
    ...new Set(
      leads
        .filter((lead) => {
          const email = normalizeEmailAddresses(lead.email)[0];
          return email ? participants.has(email) : false;
        })
        .map((lead) => lead.id),
    ),
  ];

  if (candidateLeadIds.length === 1) {
    return {
      kind: "MATCHED",
      leadId: candidateLeadIds[0],
      confidence: "HIGH",
      reason: messages.some(
        (message) =>
          message.replyTo &&
          normalizeEmailAddresses(message.replyTo).some((email) =>
            leads.some(
              (lead) =>
                lead.id === candidateLeadIds[0] &&
                normalizeEmailAddresses(lead.email).includes(email),
            ),
          ),
      )
        ? "exact reply-to email matched one lead"
        : "exact sender email matched one lead",
    };
  }
  if (candidateLeadIds.length > 1) {
    return {
      kind: "AMBIGUOUS",
      candidateLeadIds,
      reason: "multiple leads share an external participant email",
    };
  }
  return { kind: "NO_MATCH", reason: "no external participant matched" };
}

export async function findLeadForMessage({
  ownerId,
  message,
  accountAddress,
}: {
  ownerId: string;
  message: NormalizedMessage;
  accountAddress?: string | null;
}): Promise<LeadMatchResult> {
  return findLeadForConversation({
    ownerId,
    conversation: { leadId: null, manuallyDetached: false },
    messages: [message],
    accountAddress,
  });
}
