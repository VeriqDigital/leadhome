import "server-only";

import type {
  LeadSource,
  LeadStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { statusValues } from "@/lib/lead-format";
import {
  ACTIVE_PIPELINE_STATUSES,
  startOfLocalWeek,
} from "@/lib/pipeline/metrics";

export const PIPELINE_CARD_LIMIT = 20;
export const PIPELINE_MAX_COLUMN_LIMIT = 100;

export type PipelineSort =
  | "urgency"
  | "updated-desc"
  | "value-desc"
  | "value-asc"
  | "name-asc"
  | "name-desc";

export type PipelineFilters = {
  query?: string;
  source?: LeadSource;
  minimumValue?: number;
  maximumValue?: number;
  followUp?: "overdue" | "today" | "upcoming" | "none";
  hasOpenTasks?: boolean;
  hasConversation?: boolean;
  sort: PipelineSort;
  limits?: Partial<Record<LeadStatus, number>>;
  now?: Date;
};

export type PipelineCardDto = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  source: LeadSource;
  status: LeadStatus;
  estimatedValue: string | null;
  nextFollowUpDate: Date | null;
  updatedAt: Date;
  latestActivityAt: Date | null;
  openTaskCount: number;
  overdueTaskCount: number;
  dueTodayTaskCount: number;
  nextOpenTaskAt: Date | null;
  hasOpenFollowUpTask: boolean;
  hasConversation: boolean;
};

export type PipelineColumnDto = {
  status: LeadStatus;
  count: number;
  value: string;
  cards: PipelineCardDto[];
  hasMore: boolean;
  limit: number;
};

function dayBounds(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function pipelineWhere(
  ownerId: string,
  filters: PipelineFilters,
): Prisma.LeadWhereInput {
  const query = filters.query?.trim().slice(0, 100);
  const now = filters.now ?? new Date();
  const { start, end } = dayBounds(now);
  const followUp =
    filters.followUp === "overdue"
      ? { lt: now }
      : filters.followUp === "today"
        ? { gte: start, lt: end }
        : filters.followUp === "upcoming"
          ? { gte: end }
          : filters.followUp === "none"
            ? null
            : undefined;
  return {
    userId: ownerId,
    source: filters.source,
    estimatedValue:
      filters.minimumValue !== undefined || filters.maximumValue !== undefined
        ? { gte: filters.minimumValue, lte: filters.maximumValue }
        : undefined,
    nextFollowUpDate: followUp,
    tasks: filters.hasOpenTasks ? { some: { status: "OPEN" } } : undefined,
    conversations: filters.hasConversation ? { some: {} } : undefined,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { company: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export function pipelineOrderBy(
  sort: PipelineSort,
): Prisma.LeadOrderByWithRelationInput[] {
  switch (sort) {
    case "updated-desc":
      return [{ updatedAt: "desc" }, { id: "desc" }];
    case "value-desc":
      return [
        { estimatedValue: { sort: "desc", nulls: "last" } },
        { id: "desc" },
      ];
    case "value-asc":
      return [
        { estimatedValue: { sort: "asc", nulls: "last" } },
        { id: "asc" },
      ];
    case "name-asc":
      return [{ name: "asc" }, { id: "asc" }];
    case "name-desc":
      return [{ name: "desc" }, { id: "desc" }];
    default:
      return [
        { nextFollowUpDate: { sort: "asc", nulls: "last" } },
        { updatedAt: "desc" },
        { id: "asc" },
      ];
  }
}

const cardSelect = {
  id: true,
  name: true,
  company: true,
  email: true,
  source: true,
  status: true,
  estimatedValue: true,
  nextFollowUpDate: true,
  updatedAt: true,
  activities: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: { createdAt: true },
  },
  tasks: {
    where: { status: "OPEN" as const },
    orderBy: [
      { dueAt: { sort: "asc" as const, nulls: "last" as const } },
      { id: "asc" as const },
    ],
    take: 50,
    select: { dueAt: true, type: true },
  },
  _count: {
    select: {
      tasks: { where: { status: "OPEN" as const } },
      conversations: true,
    },
  },
} satisfies Prisma.LeadSelect;

type CardRow = Prisma.LeadGetPayload<{ select: typeof cardSelect }>;

function cardDto(row: CardRow, now: Date): PipelineCardDto {
  const { start, end } = dayBounds(now);
  const datedTasks = row.tasks.flatMap((task) => task.dueAt ? [task.dueAt] : []);
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    source: row.source,
    status: row.status,
    estimatedValue: row.estimatedValue?.toString() ?? null,
    nextFollowUpDate: row.nextFollowUpDate,
    updatedAt: row.updatedAt,
    latestActivityAt: row.activities[0]?.createdAt ?? null,
    openTaskCount: row._count.tasks,
    overdueTaskCount: datedTasks.filter((dueAt) => dueAt < now).length,
    dueTodayTaskCount: datedTasks.filter(
      (dueAt) => dueAt >= start && dueAt < end,
    ).length,
    nextOpenTaskAt: datedTasks[0] ?? null,
    hasOpenFollowUpTask: row.tasks.some(
      (task) => task.type === "FOLLOW_UP",
    ),
    hasConversation: row._count.conversations > 0,
  };
}

export async function getPipelineBoard(
  ownerId: string,
  filters: PipelineFilters,
) {
  const now = filters.now ?? new Date();
  const baseWhere = pipelineWhere(ownerId, filters);
  const orderBy = pipelineOrderBy(filters.sort);
  const limits = Object.fromEntries(
    statusValues.map((status) => [
      status,
      Math.min(
        Math.max(filters.limits?.[status] ?? PIPELINE_CARD_LIMIT, PIPELINE_CARD_LIMIT),
        PIPELINE_MAX_COLUMN_LIMIT,
      ),
    ]),
  ) as Record<LeadStatus, number>;
  const startOfWeek = startOfLocalWeek(now);

  const [rowsByStatus, grouped, overdueFollowUps, wonThisWeek] =
    await Promise.all([
      Promise.all(
        statusValues.map((status) =>
          prisma.lead.findMany({
            where: { ...baseWhere, status },
            orderBy,
            take: limits[status] + 1,
            select: cardSelect,
          }),
        ),
      ),
      prisma.lead.groupBy({
        by: ["status"],
        where: baseWhere,
        _count: true,
        _sum: { estimatedValue: true },
      }),
      prisma.lead.count({
        where: {
          ...baseWhere,
          status: { in: [...ACTIVE_PIPELINE_STATUSES] },
          nextFollowUpDate: { lt: now },
        },
      }),
      prisma.lead.aggregate({
        where: {
          ...baseWhere,
          status: "WON",
          updatedAt: { gte: startOfWeek },
        },
        _sum: { estimatedValue: true },
      }),
    ]);

  const aggregate = new Map(grouped.map((row) => [row.status, row]));
  const columns: PipelineColumnDto[] = statusValues.map((status, index) => {
    const rows = rowsByStatus[index];
    const summary = aggregate.get(status);
    return {
      status,
      count: summary?._count ?? 0,
      value: summary?._sum.estimatedValue?.toString() ?? "0",
      cards: rows.slice(0, limits[status]).map((row) => cardDto(row, now)),
      hasMore: rows.length > limits[status],
      limit: limits[status],
    };
  });
  const activeColumns = columns.filter((column) =>
    ACTIVE_PIPELINE_STATUSES.includes(
      column.status as (typeof ACTIVE_PIPELINE_STATUSES)[number],
    ),
  );
  return {
    columns,
    summary: {
      activeOpportunityCount: activeColumns.reduce(
        (total, column) => total + column.count,
        0,
      ),
      activePipelineValue: activeColumns
        .reduce((total, column) => total + Number(column.value), 0)
        .toString(),
      overdueFollowUpCount: overdueFollowUps,
      wonValueThisWeek: wonThisWeek._sum.estimatedValue?.toString() ?? "0",
    },
  };
}
