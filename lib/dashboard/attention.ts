import "server-only";

import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reportOperationalError } from "@/lib/server-errors";
import { taskViewWhere } from "@/lib/tasks/task-service";
import {
  getConversationCompanyView,
  type ConversationCompanyView,
} from "@/lib/messaging/company-detection-service";

export const ATTENTION_SAMPLE_SIZE = 4;
export const TODAY_WORK_LIMIT = 8;
export const INBOX_ATTENTION_LIMIT = 500;
export const COMPANY_REVIEW_SCAN_LIMIT = 100;
const COMPANY_REVIEW_CONCURRENCY = 5;

export const inboxAttentionValues = [
  "awaiting-response",
  "match-review",
  "company-review",
] as const;

export type InboxAttentionFilter =
  (typeof inboxAttentionValues)[number];
export type LeadAttentionFilter = "untouched";
export type AttentionKey =
  | "AWAITING_RESPONSE"
  | "OVERDUE_WORK"
  | "UNTOUCHED_LEADS"
  | "MATCH_REVIEW"
  | "COMPANY_REVIEW";
export type AttentionSeverity = "urgent" | "high" | "normal";

export type AttentionCategory = {
  key: AttentionKey;
  title: string;
  explanation: string;
  count: number;
  countIsLowerBound: boolean;
  severity: AttentionSeverity;
  href: string;
  actionLabel: string;
};

export type DashboardWorkItem = {
  id: string;
  category: AttentionKey;
  title: string;
  action: string;
  context: string;
  relevantAt: Date;
  href: string;
};

export type DashboardAttention = {
  categories: AttentionCategory[];
  workItems: DashboardWorkItem[];
  totalCount: number;
  totalCountIsLowerBound: boolean;
  caughtUp: boolean;
};

type AwaitingResponseRow = {
  id: string;
  subject: string | null;
  lastMessageAt: Date;
  leadId: string;
  leadName: string;
  company: string | null;
  sender: string;
  totalCount: bigint | number;
};

type CompanyReviewItem = {
  id: string;
  subject: string | null;
  lastMessageAt: Date | null;
  view: ConversationCompanyView;
};

export function parseInboxAttention(
  value: string | undefined,
): InboxAttentionFilter | undefined {
  return inboxAttentionValues.includes(value as InboxAttentionFilter)
    ? (value as InboxAttentionFilter)
    : undefined;
}

export function parseLeadAttention(
  value: string | undefined,
): LeadAttentionFilter | undefined {
  return value === "untouched" ? "untouched" : undefined;
}

export function untouchedLeadWhere(
  ownerId: string,
): PrismaTypes.LeadWhereInput {
  return {
    userId: ownerId,
    status: "NEW",
    conversations: {
      none: {
        ownerId,
        messages: { some: { ownerId, direction: "OUTBOUND" } },
      },
    },
    activities: {
      none: { userId: ownerId, type: "MESSAGE_SENT" },
    },
  };
}

export function matchReviewWhere(
  ownerId: string,
): PrismaTypes.ConversationWhereInput {
  return {
    ownerId,
    leadId: null,
    manuallyDetached: false,
    status: "OPEN",
    reviewState: "NEEDS_REVIEW",
    matchKind: "AMBIGUOUS",
  };
}

function companyReviewCandidateWhere(
  ownerId: string,
): PrismaTypes.ConversationWhereInput {
  return {
    ownerId,
    leadId: { not: null },
    lead: { is: { userId: ownerId, company: null } },
    status: "OPEN",
    reviewState: { notIn: ["IGNORED", "RESOLVED"] },
    messages: { some: { ownerId, direction: "INBOUND" } },
  };
}

async function awaitingResponseRows(
  ownerId: string,
  take: number,
): Promise<AwaitingResponseRow[]> {
  return prisma.$queryRaw<AwaitingResponseRow[]>(Prisma.sql`
    SELECT
      c."id",
      c."subject",
      latest."receivedAt" AS "lastMessageAt",
      l."id" AS "leadId",
      l."name" AS "leadName",
      l."company",
      latest."sender",
      COUNT(*) OVER() AS "totalCount"
    FROM "Conversation" c
    INNER JOIN "Lead" l
      ON l."id" = c."leadId" AND l."userId" = c."ownerId"
    INNER JOIN LATERAL (
      SELECT m."direction", m."receivedAt", m."sender"
      FROM "Message" m
      WHERE m."conversationId" = c."id"
        AND m."ownerId" = ${ownerId}
      ORDER BY m."receivedAt" DESC, m."id" DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE c."ownerId" = ${ownerId}
      AND c."status" = 'OPEN'::"ConversationStatus"
      AND c."reviewState" NOT IN (
        'IGNORED'::"ConversationReviewState",
        'RESOLVED'::"ConversationReviewState"
      )
      AND c."classification" IN (
        'LEAD'::"ConversationClassification",
        'CUSTOMER'::"ConversationClassification"
      )
      AND latest."direction" = 'INBOUND'::"MessageDirection"
    ORDER BY latest."receivedAt" ASC, c."id" ASC
    LIMIT ${take}
  `);
}

async function companyReviewItems(
  ownerId: string,
  take = COMPANY_REVIEW_SCAN_LIMIT,
): Promise<{ items: CompanyReviewItem[]; hasMoreCandidates: boolean }> {
  const candidates = await prisma.conversation.findMany({
    where: companyReviewCandidateWhere(ownerId),
    orderBy: [
      { lastMessageAt: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ],
    take: take + 1,
    select: { id: true, subject: true, lastMessageAt: true },
  });
  const inspected = candidates.slice(0, take);
  const views: ConversationCompanyView[] = [];
  let evaluationFailed = false;
  for (
    let offset = 0;
    offset < inspected.length;
    offset += COMPANY_REVIEW_CONCURRENCY
  ) {
    const batch = inspected.slice(
      offset,
      offset + COMPANY_REVIEW_CONCURRENCY,
    );
    const settled = await Promise.allSettled(
      batch.map((conversation) =>
        getConversationCompanyView(ownerId, conversation.id),
      ),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") views.push(result.value);
      else {
        evaluationFailed = true;
        views.push({
          conversationId: "unavailable",
          lead: null,
          state: "NOT_APPLICABLE",
          suggestion: null,
          canRecheck: false,
        });
      }
    }
  }
  if (evaluationFailed) {
    reportOperationalError(
      "dashboard company attention evaluation failed",
      new Error("CompanyAttentionEvaluationError"),
    );
  }
  return {
    items: inspected.flatMap((conversation, index) => {
      const view = views[index];
      return view?.state === "SUGGESTED" && view.suggestion
        ? [{ ...conversation, view }]
        : [];
    }),
    hasMoreCandidates: candidates.length > take || evaluationFailed,
  };
}

export async function getInboxAttentionConversationIds(
  ownerId: string,
  filter: InboxAttentionFilter,
) {
  if (filter === "awaiting-response") {
    return (
      await awaitingResponseRows(ownerId, INBOX_ATTENTION_LIMIT)
    ).map((row) => row.id);
  }
  if (filter === "match-review") {
    const rows = await prisma.conversation.findMany({
      where: matchReviewWhere(ownerId),
      orderBy: [
        { lastMessageAt: { sort: "desc", nulls: "last" } },
        { id: "desc" },
      ],
      take: INBOX_ATTENTION_LIMIT,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
  return (await companyReviewItems(ownerId)).items.map((item) => item.id);
}

function countFromRows(rows: AwaitingResponseRow[]) {
  if (!rows.length) return 0;
  return Number(rows[0].totalCount);
}

export async function getDashboardAttention(
  ownerId: string,
  now = new Date(),
): Promise<DashboardAttention> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  const overdueWhere = {
    ownerId,
    ...taskViewWhere("overdue", now),
  };

  const [
    awaiting,
    overdueCount,
    actionableTasks,
    untouchedCount,
    untouchedLeads,
    matchCount,
    matches,
    company,
  ] = await Promise.all([
    awaitingResponseRows(ownerId, ATTENTION_SAMPLE_SIZE),
    prisma.task.count({ where: overdueWhere }),
    prisma.task.findMany({
      where: { ownerId, status: "OPEN", dueAt: { lt: endOfToday } },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: ATTENTION_SAMPLE_SIZE,
      select: {
        id: true,
        title: true,
        dueAt: true,
        lead: { select: { id: true, name: true, company: true } },
        conversation: { select: { id: true, subject: true } },
      },
    }),
    prisma.lead.count({ where: untouchedLeadWhere(ownerId) }),
    prisma.lead.findMany({
      where: untouchedLeadWhere(ownerId),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ATTENTION_SAMPLE_SIZE,
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        source: true,
        createdAt: true,
      },
    }),
    prisma.conversation.count({ where: matchReviewWhere(ownerId) }),
    prisma.conversation.findMany({
      where: matchReviewWhere(ownerId),
      orderBy: [
        { lastMessageAt: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ],
      take: ATTENTION_SAMPLE_SIZE,
      select: { id: true, subject: true, lastMessageAt: true },
    }),
    companyReviewItems(ownerId),
  ]);

  const awaitingTotal = countFromRows(awaiting);
  const awaitingCount = Math.min(awaitingTotal, INBOX_ATTENTION_LIMIT);
  const matchReviewCount = Math.min(matchCount, INBOX_ATTENTION_LIMIT);
  const companyCount = company.items.length;
  const categories: AttentionCategory[] = [
    {
      key: "AWAITING_RESPONSE",
      title: "Customers waiting for a reply",
      explanation: "Open Lead or Customer conversations whose latest message is inbound.",
      count: awaitingCount,
      countIsLowerBound: awaitingTotal > INBOX_ATTENTION_LIMIT,
      severity: "urgent",
      href: "/inbox?attention=awaiting-response",
      actionLabel: "Open Inbox",
    },
    {
      key: "OVERDUE_WORK",
      title: "Follow-ups and tasks overdue",
      explanation: "Open tasks that are already past their due time.",
      count: overdueCount,
      countIsLowerBound: false,
      severity: "urgent",
      href: "/tasks?view=overdue",
      actionLabel: "Open tasks",
    },
    {
      key: "UNTOUCHED_LEADS",
      title: "New leads not yet contacted",
      explanation: "Leads still in New with no recorded outbound message.",
      count: untouchedCount,
      countIsLowerBound: false,
      severity: "high",
      href: "/leads?attention=untouched",
      actionLabel: "Review leads",
    },
    {
      key: "MATCH_REVIEW",
      title: "Lead matches need review",
      explanation: "Active possible matches waiting for a decision.",
      count: matchReviewCount,
      countIsLowerBound: matchCount > INBOX_ATTENTION_LIMIT,
      severity: "normal",
      href: "/inbox?attention=match-review",
      actionLabel: "Review matches",
    },
    {
      key: "COMPANY_REVIEW",
      title: "Company suggestions need approval",
      explanation: "Current company suggestions ready to apply or dismiss.",
      count: companyCount,
      countIsLowerBound: company.hasMoreCandidates,
      severity: "normal",
      href: "/inbox?attention=company-review",
      actionLabel: "Review companies",
    },
  ];

  const workCandidates: Array<DashboardWorkItem & { entityKey: string }> = [
    ...awaiting.slice(0, 2).map((row) => ({
      id: `reply:${row.id}`,
      entityKey: `conversation:${row.id}`,
      category: "AWAITING_RESPONSE" as const,
      title: row.leadName,
      action: "Reply to customer",
      context: row.company ?? row.subject ?? row.sender,
      relevantAt: row.lastMessageAt,
      href: `/inbox?attention=awaiting-response&conversation=${encodeURIComponent(row.id)}`,
    })),
    ...actionableTasks.slice(0, 2).map((task) => ({
      id: `task:${task.id}`,
      entityKey: `task:${task.id}`,
      category: "OVERDUE_WORK" as const,
      title: task.title,
      action: task.dueAt && task.dueAt < now
        ? "Complete overdue task"
        : "Complete task due today",
      context:
        task.lead?.company ??
        task.lead?.name ??
        task.conversation?.subject ??
        "Standalone task",
      relevantAt: task.dueAt ?? now,
      href: `/tasks/${encodeURIComponent(task.id)}/edit`,
    })),
    ...untouchedLeads.slice(0, 2).map((lead) => ({
      id: `lead:${lead.id}`,
      entityKey: `lead:${lead.id}`,
      category: "UNTOUCHED_LEADS" as const,
      title: lead.name,
      action: "Contact new lead",
      context: lead.company ?? lead.email ?? "No company or email",
      relevantAt: lead.createdAt,
      href: `/leads/${encodeURIComponent(lead.id)}`,
    })),
    ...matches.slice(0, 1).map((conversation) => ({
      id: `match:${conversation.id}`,
      entityKey: `conversation:${conversation.id}`,
      category: "MATCH_REVIEW" as const,
      title: conversation.subject ?? "Conversation without a subject",
      action: "Review possible lead match",
      context: "Inbox matching decision",
      relevantAt: conversation.lastMessageAt ?? now,
      href: `/inbox?attention=match-review&conversation=${encodeURIComponent(conversation.id)}`,
    })),
    ...company.items.slice(0, 1).map((conversation) => ({
      id: `company:${conversation.id}`,
      entityKey: `conversation:${conversation.id}`,
      category: "COMPANY_REVIEW" as const,
      title: conversation.view.lead?.name ?? "Attached lead",
      action: "Review company suggestion",
      context:
        conversation.view.suggestion?.value ??
        conversation.subject ??
        "Company review",
      relevantAt: conversation.lastMessageAt ?? now,
      href: `/inbox?attention=company-review&conversation=${encodeURIComponent(conversation.id)}`,
    })),
  ];
  const seenEntities = new Set<string>();
  const workItems = workCandidates.flatMap(({ entityKey, ...item }) => {
    if (seenEntities.has(entityKey)) return [];
    seenEntities.add(entityKey);
    return [item];
  }).slice(0, TODAY_WORK_LIMIT);

  const totalCount = categories.reduce(
    (total, category) => total + category.count,
    0,
  );
  const totalCountIsLowerBound = categories.some(
    (category) => category.countIsLowerBound,
  );
  return {
    categories,
    workItems,
    totalCount,
    totalCountIsLowerBound,
    caughtUp: totalCount === 0 && !totalCountIsLowerBound,
  };
}
