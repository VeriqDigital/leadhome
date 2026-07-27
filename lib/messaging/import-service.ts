import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findLeadForConversation, type LeadMatchResult } from "./matching-service";
import type {
  MessageProvider,
  NormalizedConversation,
  NormalizedMessage,
} from "./provider";

export type ImportSummary = {
  accountsProcessed: number;
  conversationsCreated: number;
  conversationsUpdated: number;
  messagesCreated: number;
  messagesSkipped: number;
  conversationsMatched: number;
  conversationsNeedingReview: number;
};

export type ImportProgress = {
  phase:
    | "LISTING_THREADS"
    | "IMPORTING_THREADS"
    | "MATCHING"
    | "FINALIZING";
  processed: number;
  total: number | null;
  message: string;
};

export type ImportOptions = {
  onProgress?: (progress: ImportProgress) => Promise<void> | void;
  onConversationChanged?: (change: {
    conversationId: string;
    messagesCreated: number;
  }) => Promise<void> | void;
  persistAccountSummary?: boolean;
};

const emptySummary = (): ImportSummary => ({
  accountsProcessed: 1,
  conversationsCreated: 0,
  conversationsUpdated: 0,
  messagesCreated: 0,
  messagesSkipped: 0,
  conversationsMatched: 0,
  conversationsNeedingReview: 0,
});

function distinctMessages(messages: NormalizedMessage[]) {
  const byProviderId = new Map<string, NormalizedMessage>();
  for (const message of messages) {
    if (!byProviderId.has(message.providerMessageId)) {
      byProviderId.set(message.providerMessageId, message);
    }
  }
  return [...byProviderId.values()].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  );
}

function matchData(match: LeadMatchResult) {
  return {
    matchKind: match.kind,
    matchReason: match.reason,
    matchCandidateLeadIds:
      match.kind === "AMBIGUOUS"
        ? (match.candidateLeadIds as Prisma.InputJsonValue)
        : Prisma.JsonNull,
  };
}

/**
 * Import ownership rules:
 * Provider-owned fields are account display/address, provider IDs, subject,
 * provider metadata, message contents, and last-message time.
 * User-owned fields are leadId, lifecycle status after creation,
 * classification after creation, reviewState, and manual-detach intent.
 *
 * Activity policy A: the first successful import establishes a silent
 * historical baseline. Only messages first observed on later imports can add
 * message activities, preventing a mailbox backfill from flooding timelines.
 */
export async function importProviderAccount({
  ownerId,
  provider,
  options,
}: {
  ownerId: string;
  provider: MessageProvider;
  options?: ImportOptions;
}): Promise<ImportSummary> {
  const normalizedAccount = await provider.getAccount();
  if (normalizedAccount.provider !== provider.provider) {
    throw new Error("Provider account type does not match its adapter.");
  }

  await options?.onProgress?.({
    phase: "LISTING_THREADS",
    processed: 0,
    total: null,
    message: "Listing recent Gmail threads.",
  });
  const normalizedConversations = await provider.listRecentConversations();
  await options?.onProgress?.({
    phase: "IMPORTING_THREADS",
    processed: 0,
    total: normalizedConversations.length,
    message: "Fetching recent Gmail threads.",
  });
  const fetched: Array<{ conversation: NormalizedConversation; messages: NormalizedMessage[]; rawMessageCount: number }> = [];
  // Provider calls are deliberately bounded to avoid mailbox API quota spikes.
  for (let index = 0; index < normalizedConversations.length; index += 5) {
    const batch = await Promise.all(normalizedConversations.slice(index, index + 5).map(async (conversation) => {
      const rawMessages = await provider.listMessages(
        conversation.providerConversationId,
      );
      return {
        conversation: {
          ...conversation,
          subject: conversation.subject ?? rawMessages.at(-1)?.subject ?? null,
        },
        messages: distinctMessages(rawMessages),
        rawMessageCount: rawMessages.length,
      };
    }));
    fetched.push(...batch);
    await options?.onProgress?.({
      phase: "IMPORTING_THREADS",
      processed: Math.min(index + batch.length, normalizedConversations.length),
      total: normalizedConversations.length,
      message: "Fetching recent Gmail threads.",
    });
  }

  const account = await prisma.communicationAccount.upsert({
    where: {
      ownerId_provider_providerAccountId: {
        ownerId,
        provider: provider.provider,
        providerAccountId: normalizedAccount.providerAccountId,
      },
    },
    create: {
      ownerId,
      provider: provider.provider,
      providerAccountId: normalizedAccount.providerAccountId,
      displayName: normalizedAccount.displayName,
      address: normalizedAccount.address,
    },
    update: {
      displayName: normalizedAccount.displayName,
      address: normalizedAccount.address,
    },
  });

  const summary = emptySummary();
  await options?.onProgress?.({
    phase: "MATCHING",
    processed: 0,
    total: fetched.length,
    message: "Importing and matching conversations.",
  });
  for (const [index, item] of fetched.entries()) {
    const change = await importConversation({
      ownerId,
      account: { id: account.id, address: account.address },
      provider,
      normalized: item.conversation,
      messages: item.messages,
      rawMessageCount: item.rawMessageCount,
      summary,
    });
    if (change.messagesCreated > 0) {
      await options?.onConversationChanged?.(change);
    }
    await options?.onProgress?.({
      phase: "MATCHING",
      processed: index + 1,
      total: fetched.length,
      message: "Importing and matching conversations.",
    });
  }

  await options?.onProgress?.({
    phase: "FINALIZING",
    processed: fetched.length,
    total: fetched.length,
    message: "Saving the Gmail sync summary.",
  });
  if (options?.persistAccountSummary !== false) {
    await prisma.communicationAccount.update({
      where: { id: account.id },
      data: {
        lastImportedAt: new Date(),
        lastImportSummary: summary,
      },
    });
  }
  return summary;
}

async function importConversation({
  ownerId,
  account,
  provider,
  normalized,
  messages,
  rawMessageCount,
  summary,
}: {
  ownerId: string;
  account: { id: string; address: string | null };
  provider: MessageProvider;
  normalized: NormalizedConversation;
  messages: NormalizedMessage[];
  rawMessageCount: number;
  summary: ImportSummary;
}) {
  const existing = await prisma.conversation.findUnique({
    where: {
      accountId_providerConversationId: {
        accountId: account.id,
        providerConversationId: normalized.providerConversationId,
      },
    },
    select: { id: true, baselineImportedAt: true },
  });
  const fetchedLastMessageAt = messages.reduce<Date | null>(
    (latest, message) =>
      !latest || message.occurredAt > latest ? message.occurredAt : latest,
    null,
  );
  const duplicateWithinProviderBatch = rawMessageCount - messages.length;

  const imported = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.upsert({
      where: {
        accountId_providerConversationId: {
          accountId: account.id,
          providerConversationId: normalized.providerConversationId,
        },
      },
      create: {
        accountId: account.id,
        ownerId,
        provider: provider.provider,
        providerConversationId: normalized.providerConversationId,
        subject: normalized.subject,
        status: normalized.state ?? "OPEN",
        classification: normalized.suggestedClassification ?? "UNKNOWN",
        reviewState: normalized.suggestedReviewState ?? "NEEDS_REVIEW",
        providerMetadata: normalized.metadata,
        lastMessageAt: fetchedLastMessageAt,
      },
      update: {
        subject: normalized.subject,
        providerMetadata: normalized.metadata,
      },
    });

    const providerMessageIds = messages.map((message) => message.providerMessageId);
    const alreadyImported = providerMessageIds.length
      ? await tx.message.findMany({
          where: {
            accountId: account.id,
            providerMessageId: { in: providerMessageIds },
          },
          select: { providerMessageId: true },
        })
      : [];
    const alreadyImportedIds = new Set(
      alreadyImported.map((message) => message.providerMessageId),
    );
    const newlyObserved = messages.filter(
      (message) => !alreadyImportedIds.has(message.providerMessageId),
    );
    const created = await tx.message.createMany({
      data: newlyObserved.map((message) => ({
        conversationId: conversation.id,
        accountId: account.id,
        ownerId,
        providerMessageId: message.providerMessageId,
        direction: message.direction,
        sender: message.sender,
        recipients: message.recipients,
        replyTo: message.replyTo,
        subject: message.subject,
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml,
        receivedAt: message.occurredAt,
        internetMessageId: message.internetMessageId,
        inReplyTo: message.inReplyTo,
        references: message.references,
        externalSubmissionId: message.externalSubmissionId,
        sourceSystem: message.sourceSystem,
        metadata: message.metadata,
      })),
      skipDuplicates: true,
    });
    if (fetchedLastMessageAt) {
      await tx.conversation.updateMany({
        where: {
          id: conversation.id,
          OR: [
            { lastMessageAt: null },
            { lastMessageAt: { lt: fetchedLastMessageAt } },
          ],
        },
        data: { lastMessageAt: fetchedLastMessageAt },
      });
    }

    if (conversation.baselineImportedAt && conversation.leadId && created.count) {
      const createdMessages = await tx.message.findMany({
        where: {
          accountId: account.id,
          providerMessageId: {
            in: newlyObserved.map((message) => message.providerMessageId),
          },
        },
        select: {
          id: true,
          direction: true,
          subject: true,
        },
      });
      await tx.leadActivity.createMany({
        data: createdMessages.map((message) => ({
          leadId: conversation.leadId!,
          userId: ownerId,
          conversationId: conversation.id,
          messageId: message.id,
          type:
            message.direction === "INBOUND"
              ? ("MESSAGE_RECEIVED" as const)
              : ("MESSAGE_SENT" as const),
          title:
            message.direction === "INBOUND"
              ? "Message received"
              : "Message sent",
          description: message.subject ?? "No subject",
        })),
        skipDuplicates: true,
      });
    }

    if (!conversation.baselineImportedAt) {
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { baselineImportedAt: new Date() },
      });
    }
    return { conversation, createdMessages: created.count };
  });

  if (existing) summary.conversationsUpdated++;
  else summary.conversationsCreated++;
  summary.messagesCreated += imported.createdMessages;
  summary.messagesSkipped +=
    messages.length - imported.createdMessages + Math.max(duplicateWithinProviderBatch, 0);

  const match = await findLeadForConversation({
    ownerId,
    conversation: imported.conversation,
    messages,
    accountAddress: account.address,
  });
  await applyMatch({
    ownerId,
    conversationId: imported.conversation.id,
    match,
    summary,
  });
  return {
    conversationId: imported.conversation.id,
    messagesCreated: imported.createdMessages,
  };
}

async function applyMatch({
  ownerId,
  conversationId,
  match,
  summary,
}: {
  ownerId: string;
  conversationId: string;
  match: LeadMatchResult;
  summary: ImportSummary;
}) {
  const needsReview = await prisma.$transaction(async (tx) => {
    const current = await tx.conversation.findFirst({
      where: { id: conversationId, ownerId },
      select: {
        leadId: true,
        subject: true,
        reviewState: true,
        manuallyDetached: true,
      },
    });
    if (!current) throw new Error("Imported conversation ownership changed.");

    await tx.conversation.update({
      where: { id: conversationId },
      data: matchData(match),
    });
    if (match.kind !== "MATCHED") {
      return current.reviewState === "NEEDS_REVIEW";
    }
    if (current.leadId === match.leadId) {
      if (current.reviewState === "NEEDS_REVIEW") {
        await tx.conversation.update({
          where: { id: conversationId },
          data: { reviewState: "MATCHED" },
        });
      }
      return false;
    }
    if (
      current.leadId ||
      current.manuallyDetached ||
      current.reviewState !== "NEEDS_REVIEW"
    ) {
      return false;
    }
    const attached = await tx.conversation.updateMany({
      where: {
        id: conversationId,
        ownerId,
        leadId: null,
        manuallyDetached: false,
        reviewState: "NEEDS_REVIEW",
      },
      data: { leadId: match.leadId, reviewState: "MATCHED" },
    });
    if (attached.count) {
      await tx.leadActivity.create({
        data: {
          leadId: match.leadId,
          userId: ownerId,
          conversationId,
          type: "CONVERSATION_LINKED",
          title: "Conversation attached",
          description: current.subject ?? "No subject",
          metadata: { reason: match.reason, automatic: true },
        },
      });
      await tx.lead.update({
        where: { id: match.leadId },
        data: { updatedAt: new Date() },
      });
    }
    return false;
  });

  if (match.kind === "MATCHED") summary.conversationsMatched++;
  else if (needsReview) summary.conversationsNeedingReview++;
}

// Backwards-compatible name used by the development action in Phase 1.
export const importRecentMessages = importProviderAccount;
