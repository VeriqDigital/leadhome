import "server-only";

import {
  type LeadActivityActorType,
  type LeadActivitySource,
  type LeadActivityType,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

type ActivityClient = Pick<
  Prisma.TransactionClient,
  "conversation" | "lead" | "leadActivity" | "message" | "task"
>;

export type RecordActivityInput = {
  ownerId: string;
  leadId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  taskId?: string | null;
  type: LeadActivityType;
  actorType: LeadActivityActorType;
  source: LeadActivitySource;
  title: string;
  description?: string | null;
  metadata?: Prisma.InputJsonValue;
  occurredAt?: Date;
  idempotencyKey?: string | null;
};

function normalized(input: RecordActivityInput) {
  const title = input.title.replace(/\s+/g, " ").trim();
  const description = input.description?.replace(/\s+/g, " ").trim() || null;
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (!title || title.length > 200) {
    throw new Error("Activity titles must contain 1 to 200 characters.");
  }
  if (description && description.length > 1_000) {
    throw new Error("Activity descriptions cannot exceed 1,000 characters.");
  }
  if (idempotencyKey && idempotencyKey.length > 200) {
    throw new Error("Activity idempotency keys cannot exceed 200 characters.");
  }
  if (!input.leadId && !input.conversationId && !input.taskId) {
    throw new Error("An activity must link to a lead, conversation, or task.");
  }
  if (input.messageId && !input.conversationId) {
    throw new Error("An activity message must link to its conversation.");
  }
  return { ...input, title, description, idempotencyKey };
}

async function validateRelationships(
  client: ActivityClient,
  inputs: ReturnType<typeof normalized>[],
  options: { allowUnattachedOutboundMessageLead?: boolean } = {},
) {
  const ownerIds = new Set(inputs.map((input) => input.ownerId));
  if (ownerIds.size !== 1) {
    throw new Error("A batch of activities must have one owner.");
  }
  const ownerId = inputs[0]?.ownerId;
  if (!ownerId) throw new Error("Activity owner is required.");

  const leadIds = [...new Set(inputs.flatMap((input) => input.leadId ?? []))];
  const conversationIds = [
    ...new Set(inputs.flatMap((input) => input.conversationId ?? [])),
  ];
  const taskIds = [...new Set(inputs.flatMap((input) => input.taskId ?? []))];
  const messageIds = [...new Set(inputs.flatMap((input) => input.messageId ?? []))];
  const [leads, conversations, tasks, messages] = await Promise.all([
    leadIds.length
      ? client.lead.findMany({
          where: { id: { in: leadIds }, userId: ownerId },
          select: { id: true },
        })
      : [],
    conversationIds.length
      ? client.conversation.findMany({
          where: { id: { in: conversationIds }, ownerId },
          select: { id: true, leadId: true },
        })
      : [],
    taskIds.length
      ? client.task.findMany({
          where: { id: { in: taskIds }, ownerId },
          select: { id: true, leadId: true, conversationId: true },
        })
      : [],
    messageIds.length
      ? client.message.findMany({
          where: { id: { in: messageIds }, ownerId },
          select: { id: true, conversationId: true, direction: true },
        })
      : [],
  ]);
  if (
    leads.length !== leadIds.length ||
    conversations.length !== conversationIds.length ||
    tasks.length !== taskIds.length ||
    messages.length !== messageIds.length
  ) {
    throw new Error("An activity relationship was not found for this owner.");
  }
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const conversationsById = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );
  for (const input of inputs) {
    const message = input.messageId
      ? messagesById.get(input.messageId)
      : null;
    if (
      message &&
      input.conversationId &&
      message.conversationId !== input.conversationId
    ) {
      throw new Error("An activity message does not belong to its conversation.");
    }
    const conversation = input.conversationId
      ? conversationsById.get(input.conversationId)
      : null;
    if (
      message &&
      input.leadId &&
      conversation?.leadId !== input.leadId &&
      !(
        options.allowUnattachedOutboundMessageLead &&
        input.type === "MESSAGE_SENT" &&
        message.direction === "OUTBOUND" &&
        conversation?.leadId === null
      )
    ) {
      throw new Error("An activity message does not belong to its lead.");
    }
    const task = input.taskId ? tasksById.get(input.taskId) : null;
    if (
      task?.leadId &&
      input.leadId &&
      task.leadId !== input.leadId
    ) {
      throw new Error("An activity task does not belong to its lead.");
    }
    if (
      task?.conversationId &&
      input.conversationId &&
      task.conversationId !== input.conversationId
    ) {
      throw new Error("An activity task does not belong to its conversation.");
    }
  }
}

async function createActivities(
  client: ActivityClient,
  rawInputs: RecordActivityInput[],
  options: { allowUnattachedOutboundMessageLead?: boolean } = {},
) {
  if (!rawInputs.length) return { count: 0 };
  const inputs = rawInputs.map(normalized);
  await validateRelationships(client, inputs, options);
  return client.leadActivity.createMany({
    data: inputs.map((input) => ({
      userId: input.ownerId,
      leadId: input.leadId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      taskId: input.taskId ?? null,
      type: input.type,
      actorType: input.actorType,
      source: input.source,
      title: input.title,
      description: input.description,
      metadata: input.metadata,
      occurredAt: input.occurredAt ?? new Date(),
      idempotencyKey: input.idempotencyKey,
    })),
    skipDuplicates: inputs.some(
      (input) => Boolean(input.idempotencyKey || input.messageId),
    ),
  });
}

export async function recordActivities(
  client: ActivityClient,
  rawInputs: RecordActivityInput[],
) {
  return createActivities(client, rawInputs);
}

/**
 * The outbound-recipient resolver is the only path allowed to relate an
 * outbound message from an unattached conversation to a uniquely identified
 * lead. Normal activity callers retain the stricter conversation/lead check.
 */
export async function recordOutboundContactActivities(
  client: ActivityClient,
  rawInputs: Array<Omit<RecordActivityInput, "type" | "actorType">>,
) {
  return createActivities(
    client,
    rawInputs.map((input) => ({
      ...input,
      type: "MESSAGE_SENT",
      actorType: "USER",
    })),
    { allowUnattachedOutboundMessageLead: true },
  );
}

export async function recordActivity(
  client: ActivityClient,
  input: RecordActivityInput,
) {
  const result = await recordActivities(client, [input]);
  return { created: result.count === 1 };
}

export type ActivityTimelineItem = {
  id: string;
  type: LeadActivityType;
  actorType: LeadActivityActorType;
  source: LeadActivitySource;
  title: string;
  description: string | null;
  metadata: unknown;
  occurredAt: Date;
  lead: { id: string; name: string } | null;
  conversation: { id: string; subject: string | null } | null;
  task: { id: string; title: string } | null;
};

const activitySelect = {
  id: true,
  type: true,
  actorType: true,
  source: true,
  title: true,
  description: true,
  metadata: true,
  occurredAt: true,
  lead: { select: { id: true, name: true } },
  conversation: { select: { id: true, subject: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.LeadActivitySelect;

export const ACTIVITY_PAGE_SIZE = 20;

export async function getLeadActivityPage({
  ownerId,
  leadId,
  cursor,
  limit = ACTIVITY_PAGE_SIZE,
}: {
  ownerId: string;
  leadId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const take = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const ownedLead = await prisma.lead.findFirst({
    where: { id: leadId, userId: ownerId },
    select: { id: true },
  });
  if (!ownedLead) return null;
  const validCursor = cursor
    ? await prisma.leadActivity.findFirst({
        where: { id: cursor, userId: ownerId, leadId },
        select: { id: true },
      })
    : null;
  if (cursor && !validCursor) return null;
  const rows = await prisma.leadActivity.findMany({
    where: { userId: ownerId, leadId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    ...(validCursor ? { cursor: { id: validCursor.id }, skip: 1 } : {}),
    take: take + 1,
    select: activitySelect,
  });
  return {
    items: rows.slice(0, take),
    nextCursor: rows.length > take ? rows[take - 1]!.id : null,
  };
}

export const DASHBOARD_ACTIVITY_TYPES = [
  "MESSAGE_RECEIVED",
  "WEBSITE_SUBMISSION_RECEIVED",
  "AI_ANALYSIS_COMPLETED",
  "STATUS_CHANGED",
  "FOLLOW_UP_CHANGED",
  "TASK_COMPLETED",
  "CONVERSATION_LINKED",
  "LEAD_CREATED",
] satisfies LeadActivityType[];

export async function getDashboardRecentActivities(
  ownerId: string,
  limit = 8,
): Promise<ActivityTimelineItem[]> {
  return prisma.leadActivity.findMany({
    where: {
      userId: ownerId,
      type: { in: DASHBOARD_ACTIVITY_TYPES },
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(Math.trunc(limit), 1), 20),
    select: activitySelect,
  });
}
