import "server-only";

import type {
  Prisma,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskInput } from "./task-validation";
import { recordActivity } from "@/lib/activity-service";
import { parseConversationAnalysisOutput } from "@/lib/ai/conversation-analysis/schema";
import { z } from "zod";

const taskSelect = {
  id: true,
  title: true,
  description: true,
  type: true,
  priority: true,
  status: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  lead: { select: { id: true, name: true } },
  conversation: { select: { id: true, subject: true } },
} satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export type TaskDto = {
  id: string;
  title: string;
  description: string | null;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lead: { id: string; name: string } | null;
  conversation: { id: string; subject: string | null } | null;
};

export type TaskMutationResult =
  | { kind: "changed"; task: TaskDto }
  | { kind: "unchanged"; task: TaskDto }
  | { kind: "not-found" };

export type TaskListFilters = {
  query?: string;
  view?:
    | "open"
    | "today"
    | "upcoming"
    | "overdue"
    | "completed"
    | "cancelled"
    | "all";
  type?: TaskType;
  priority?: TaskPriority;
  sort?: TaskSort;
  leadId?: string;
  page: number;
  now?: Date;
};

export type TaskView = NonNullable<TaskListFilters["view"]>;

export type TaskSort =
  | "due-asc"
  | "due-desc"
  | "name-asc"
  | "name-desc"
  | "updated-desc"
  | "updated-asc"
  | "priority-desc"
  | "priority-asc";

export const TASK_PAGE_SIZE = 25;

const dto = (row: TaskRow): TaskDto => row;
const sameDate = (a: Date | null, b: Date | null) =>
  a?.getTime() === b?.getTime();

export function taskOrderBy(
  sort: TaskSort = "due-asc",
): Prisma.TaskOrderByWithRelationInput[] {
  switch (sort) {
    case "due-desc":
      return [
        { dueAt: { sort: "desc", nulls: "last" } },
        { id: "desc" },
      ];
    case "name-asc":
      return [{ title: "asc" }, { id: "asc" }];
    case "name-desc":
      return [{ title: "desc" }, { id: "desc" }];
    case "updated-desc":
      return [{ updatedAt: "desc" }, { id: "desc" }];
    case "updated-asc":
      return [{ updatedAt: "asc" }, { id: "asc" }];
    case "priority-desc":
      return [{ priority: "desc" }, { id: "asc" }];
    case "priority-asc":
      return [{ priority: "asc" }, { id: "asc" }];
    default:
      return [
        { dueAt: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ];
  }
}

export function taskViewWhere(
  view: TaskView,
  now: Date,
): Prisma.TaskWhereInput {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  if (view === "completed") return { status: "COMPLETED" };
  if (view === "cancelled") return { status: "CANCELLED" };
  if (view === "all") return {};
  if (view === "overdue") {
    return { status: "OPEN", dueAt: { lt: now } };
  }
  if (view === "today") {
    return {
      status: "OPEN",
      dueAt: { gte: startOfToday, lt: endOfToday },
    };
  }
  if (view === "upcoming") {
    return { status: "OPEN", dueAt: { gte: endOfToday } };
  }
  return { status: "OPEN" };
}

async function validateRelations(
  tx: Prisma.TransactionClient,
  ownerId: string,
  input: Pick<TaskInput, "leadId" | "conversationId">,
) {
  const [lead, conversation] = await Promise.all([
    input.leadId
      ? tx.lead.findFirst({
          where: { id: input.leadId, userId: ownerId },
          select: { id: true },
        })
      : null,
    input.conversationId
      ? tx.conversation.findFirst({
          where: { id: input.conversationId, ownerId },
          select: { id: true },
        })
      : null,
  ]);
  if (input.leadId && !lead) throw new Error("Linked lead not found.");
  if (input.conversationId && !conversation) {
    throw new Error("Linked conversation not found.");
  }
}

async function recalculateLeadFollowUp(
  tx: Prisma.TransactionClient,
  leadId: string | null,
  ownerId: string,
  taskId?: string | null,
) {
  if (!leadId) return;
  const [lead, earliest] = await Promise.all([
    tx.lead.findFirst({
      where: { id: leadId, userId: ownerId },
      select: { nextFollowUpDate: true },
    }),
    tx.task.findFirst({
      where: {
        ownerId,
        leadId,
        type: "FOLLOW_UP",
        status: "OPEN",
        dueAt: { not: null },
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: { dueAt: true },
    }),
  ]);
  if (!lead) return;
  const next = earliest?.dueAt ?? null;
  if (!sameDate(lead.nextFollowUpDate, next)) {
    await tx.lead.update({
      where: { id: leadId },
      data: { nextFollowUpDate: next },
    });
    await recordActivity(tx, {
      ownerId,
      leadId,
      taskId: taskId ?? null,
      type: "FOLLOW_UP_CHANGED",
      actorType: "SYSTEM",
      source: "TASK",
      title: !next
        ? "Follow-up cleared"
        : lead.nextFollowUpDate
          ? "Follow-up rescheduled"
          : "Follow-up scheduled",
      description: "Updated from open follow-up tasks",
      metadata: {
        from: lead.nextFollowUpDate?.toISOString() ?? null,
        to: next?.toISOString() ?? null,
      },
    });
  }
}

async function activity(
  tx: Prisma.TransactionClient,
  ownerId: string,
  task: {
    id: string;
    leadId: string | null;
    conversationId: string | null;
    title: string;
    type: TaskType;
    dueAt: Date | null;
  },
  type:
    | "TASK_CREATED"
    | "TASK_UPDATED"
    | "TASK_COMPLETED"
    | "TASK_REOPENED"
    | "TASK_CANCELLED"
    | "TASK_DELETED",
  title: string,
  extra: Prisma.InputJsonObject = {},
) {
  await recordActivity(tx, {
    ownerId,
    leadId: task.leadId,
    conversationId: task.conversationId,
    taskId: task.id,
    type,
    actorType: "USER",
    source: "TASK",
    title,
    description: task.title,
    metadata: {
      taskTitle: task.title,
      taskType: task.type,
      dueAt: task.dueAt?.toISOString() ?? null,
      ...extra,
    },
  });
}

const analysisProvenanceSchema = z.object({
  analysisId: z.string().cuid(),
  itemIndex: z.coerce.number().int().min(0).max(7),
});

export async function createTask(
  ownerId: string,
  input: TaskInput,
  rawProvenance?: { analysisId?: string; itemIndex?: string },
) {
  return prisma.$transaction(async (tx) => {
    await validateRelations(tx, ownerId, input);
    const parsedProvenance = analysisProvenanceSchema.safeParse(rawProvenance);
    const provenance = parsedProvenance.success
      ? await tx.conversationAnalysis.findFirst({
          where: { id: parsedProvenance.data.analysisId, ownerId },
          select: { id: true, structuredData: true },
        })
      : null;
    const provenanceOutput = provenance?.structuredData
      ? (() => {
          try {
            return parseConversationAnalysisOutput(provenance.structuredData);
          } catch {
            return null;
          }
        })()
      : null;
    const acceptedSuggestion =
      parsedProvenance.success &&
      provenance &&
      provenanceOutput?.actionItems[parsedProvenance.data.itemIndex]
        ? {
            analysisId: provenance.id,
            itemIndex: parsedProvenance.data.itemIndex,
          }
        : null;
    const created = await tx.task.create({
      data: {
        ownerId,
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        status: input.status,
        dueAt: input.dueAt,
        completedAt: input.status === "COMPLETED" ? new Date() : null,
        leadId: input.leadId,
        conversationId: input.conversationId,
      },
      select: { ...taskSelect, leadId: true, conversationId: true },
    });
    await activity(
      tx,
      ownerId,
      created,
      "TASK_CREATED",
      acceptedSuggestion ? "Task created from AI suggestion" : "Task created",
      acceptedSuggestion ? { aiSuggestion: acceptedSuggestion } : {},
    );
    if (created.type === "FOLLOW_UP") {
      await recalculateLeadFollowUp(tx, created.leadId, ownerId, created.id);
    }
    return { kind: "changed" as const, task: dto(created) };
  });
}

export async function updateTask(
  ownerId: string,
  taskId: string,
  input: TaskInput,
): Promise<TaskMutationResult> {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.task.findFirst({
      where: { id: taskId, ownerId },
      select: { ...taskSelect, leadId: true, conversationId: true },
    });
    if (!previous) return { kind: "not-found" as const };
    await validateRelations(tx, ownerId, input);
    const unchanged =
      previous.title === input.title &&
      previous.description === input.description &&
      previous.type === input.type &&
      previous.priority === input.priority &&
      previous.status === input.status &&
      sameDate(previous.dueAt, input.dueAt) &&
      previous.leadId === input.leadId &&
      previous.conversationId === input.conversationId;
    if (unchanged) return { kind: "unchanged" as const, task: dto(previous) };

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        status: input.status,
        dueAt: input.dueAt,
        completedAt:
          input.status === "COMPLETED"
            ? previous.completedAt ?? new Date()
            : null,
        leadId: input.leadId,
        conversationId: input.conversationId,
      },
      select: { ...taskSelect, leadId: true, conversationId: true },
    });
    await activity(tx, ownerId, updated, "TASK_UPDATED", "Task updated");
    const affected = new Set(
      [
        previous.type === "FOLLOW_UP" ? previous.leadId : null,
        updated.type === "FOLLOW_UP" ? updated.leadId : null,
      ].filter((id): id is string => Boolean(id)),
    );
    for (const leadId of affected) {
      await recalculateLeadFollowUp(
        tx,
        leadId,
        ownerId,
        updated.leadId === leadId ? updated.id : null,
      );
    }
    return { kind: "changed" as const, task: dto(updated) };
  });
}

async function transitionTask(
  ownerId: string,
  taskId: string,
  status: TaskStatus,
  event: "TASK_COMPLETED" | "TASK_REOPENED" | "TASK_CANCELLED",
  eventTitle: string,
): Promise<TaskMutationResult> {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.task.findFirst({
      where: { id: taskId, ownerId },
      select: { ...taskSelect, leadId: true, conversationId: true },
    });
    if (!previous) return { kind: "not-found" as const };
    if (previous.status === status) {
      return { kind: "unchanged" as const, task: dto(previous) };
    }
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : null,
      },
      select: { ...taskSelect, leadId: true, conversationId: true },
    });
    await activity(tx, ownerId, updated, event, eventTitle, {
      previousStatus: previous.status,
      newStatus: status,
    });
    if (updated.type === "FOLLOW_UP") {
      await recalculateLeadFollowUp(tx, updated.leadId, ownerId, updated.id);
    }
    return { kind: "changed" as const, task: dto(updated) };
  });
}

export const completeTask = (ownerId: string, taskId: string) =>
  transitionTask(ownerId, taskId, "COMPLETED", "TASK_COMPLETED", "Task completed");

export const reopenTask = (ownerId: string, taskId: string) =>
  transitionTask(ownerId, taskId, "OPEN", "TASK_REOPENED", "Task reopened");

export const cancelTask = (ownerId: string, taskId: string) =>
  transitionTask(ownerId, taskId, "CANCELLED", "TASK_CANCELLED", "Task cancelled");

export async function deleteTask(
  ownerId: string,
  taskId: string,
): Promise<TaskMutationResult> {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.task.findFirst({
      where: { id: taskId, ownerId },
      select: { ...taskSelect, leadId: true, conversationId: true },
    });
    if (!previous) return { kind: "not-found" as const };
    await activity(tx, ownerId, previous, "TASK_DELETED", "Task deleted", {
      previousStatus: previous.status,
    });
    const deleted = await tx.task.deleteMany({ where: { id: taskId, ownerId } });
    if (deleted.count !== 1) return { kind: "not-found" as const };
    if (previous.type === "FOLLOW_UP") {
      await recalculateLeadFollowUp(tx, previous.leadId, ownerId);
    }
    return { kind: "changed" as const, task: dto(previous) };
  });
}

export async function getTask(ownerId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, ownerId },
    select: taskSelect,
  });
  return task ? dto(task) : null;
}

export async function listTasks(ownerId: string, filters: TaskListFilters) {
  const now = filters.now ?? new Date();
  const view = filters.view ?? "open";
  const viewWhere = taskViewWhere(view, now);
  const query = filters.query?.trim().slice(0, 100);
  const page = Math.min(Math.max(filters.page, 1), 10_000);
  const rows = await prisma.task.findMany({
    where: {
      ownerId,
      ...viewWhere,
      type: filters.type,
      priority: filters.priority,
      leadId: filters.leadId,
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { lead: { is: { name: { contains: query, mode: "insensitive" } } } },
              { conversation: { is: { subject: { contains: query, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: taskOrderBy(filters.sort),
    skip: (page - 1) * TASK_PAGE_SIZE,
    take: TASK_PAGE_SIZE + 1,
    select: taskSelect,
  });
  return {
    items: rows.slice(0, TASK_PAGE_SIZE).map(dto),
    hasNext: rows.length > TASK_PAGE_SIZE,
    hasPrevious: page > 1,
  };
}

export function isOverdue(task: Pick<TaskDto, "status" | "dueAt">, now = new Date()) {
  return task.status === "OPEN" && Boolean(task.dueAt && task.dueAt < now);
}
