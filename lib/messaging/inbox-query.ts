import "server-only";

import type {
  ConversationClassification,
  ConversationMatchKind,
  ConversationReviewState,
  ConversationStatus,
  MessageProvider,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const INBOX_PAGE_SIZE = 25;

export type InboxFilters = {
  query?: string;
  reviewState?: ConversationReviewState;
  classification?: ConversationClassification;
  status?: ConversationStatus;
  provider?: MessageProvider;
  attachment?: "attached" | "unattached";
  page: number;
};

export type ConversationSummaryDto = {
  id: string;
  provider: MessageProvider;
  subject: string | null;
  status: ConversationStatus;
  classification: ConversationClassification;
  reviewState: ConversationReviewState;
  matchKind: ConversationMatchKind | null;
  lead: { id: string; name: string; email: string | null } | null;
  lastMessageAt: Date | null;
  latestMessage: {
    sender: string;
    bodyPreview: string | null;
    direction: "INBOUND" | "OUTBOUND";
    receivedAt: Date;
  } | null;
};

export function conversationMessageDate(
  conversation: Pick<ConversationSummaryDto, "lastMessageAt" | "latestMessage">,
) {
  return conversation.lastMessageAt ?? conversation.latestMessage?.receivedAt ?? null;
}

function whereFor(ownerId: string, filters: InboxFilters): Prisma.ConversationWhereInput {
  const query = filters.query?.trim().slice(0, 100);
  return {
    ownerId,
    reviewState: filters.reviewState,
    classification: filters.classification,
    status: filters.status,
    provider: filters.provider,
    leadId: filters.attachment === "attached" ? { not: null } : filters.attachment === "unattached" ? null : undefined,
    ...(query ? {
      OR: [
        { subject: { contains: query, mode: "insensitive" } },
        { lead: { is: { OR: [
          { name: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
        ] } } },
        { messages: { some: { sender: { contains: query, mode: "insensitive" } } } },
      ],
    } : {}),
  };
}

export async function listConversationSummaries(ownerId: string, filters: InboxFilters) {
  const started = performance.now();
  const where = whereFor(ownerId, filters);
  const skip = (filters.page - 1) * INBOX_PAGE_SIZE;
  const rows = await prisma.conversation.findMany({
    where,
    orderBy: [
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ],
    skip,
    take: INBOX_PAGE_SIZE + 1,
    select: {
      id: true, provider: true, subject: true, status: true,
      classification: true, reviewState: true, matchKind: true,
      lastMessageAt: true,
      lead: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          sender: true,
          bodyText: true,
          direction: true,
          receivedAt: true,
        },
      },
    },
  });
  if (process.env.NODE_ENV !== "production") {
    console.info(`[Inbox] summary query: ${Math.round(performance.now() - started)}ms, ${Math.min(rows.length, INBOX_PAGE_SIZE)} rows`);
  }
  const hasNext = rows.length > INBOX_PAGE_SIZE;
  const items: ConversationSummaryDto[] = rows.slice(0, INBOX_PAGE_SIZE).map(({ messages, ...row }) => ({
    ...row,
    latestMessage: messages[0] ? {
      sender: messages[0].sender,
      bodyPreview: messages[0].bodyText?.replace(/\s+/g, " ").slice(0, 140) ?? null,
      direction: messages[0].direction,
      receivedAt: messages[0].receivedAt,
    } : null,
  }));
  return { items, hasNext, hasPrevious: filters.page > 1 };
}

export async function getConversationDetail(ownerId: string, conversationId: string) {
  const started = performance.now();
  const row = await prisma.conversation.findFirst({
    where: { id: conversationId, ownerId },
    select: {
      id: true, provider: true, subject: true, status: true,
      classification: true, reviewState: true, matchKind: true, matchReason: true,
      matchCandidateLeadIds: true, manuallyDetached: true,
      lead: { select: { id: true, name: true, email: true } },
      account: { select: { displayName: true, address: true } },
      tasks: {
        where: { status: "OPEN" },
        orderBy: [
          { dueAt: { sort: "asc", nulls: "last" } },
          { id: "asc" },
        ],
        take: 5,
        select: { id: true, title: true, dueAt: true },
      },
      messages: {
        orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
        select: {
          id: true, direction: true, sender: true, recipients: true, replyTo: true,
          bodyText: true, bodyHtml: true, receivedAt: true,
        },
      },
    },
  });
  if (process.env.NODE_ENV !== "production") {
    console.info(`[Inbox] detail query: ${Math.round(performance.now() - started)}ms, ${row?.messages.length ?? 0} messages`);
  }
  return row;
}
