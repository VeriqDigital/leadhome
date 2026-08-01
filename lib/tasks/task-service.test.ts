/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tasks: new Map<string, any>(),
  leads: new Map<string, any>(),
  conversations: new Map<string, any>(),
  analysis: null as any,
  activities: [] as any[],
  sequence: 0,
  lastListQuery: null as any,
}));

function taskRow(task: any) {
  return {
    ...task,
    lead: task.leadId
      ? { id: task.leadId, name: state.leads.get(task.leadId)?.name ?? "Lead" }
      : null,
    conversation: task.conversationId
      ? {
          id: task.conversationId,
          subject: state.conversations.get(task.conversationId)?.subject ?? null,
        }
      : null,
  };
}

const database = vi.hoisted(() => ({
  lead: {
    findFirst: vi.fn(async ({ where, select }: any) => {
      const lead = state.leads.get(where.id);
      if (!lead || lead.userId !== where.userId) return null;
      return select?.nextFollowUpDate
        ? { nextFollowUpDate: lead.nextFollowUpDate }
        : { id: lead.id };
    }),
    findMany: vi.fn(async ({ where }: any) =>
      [...state.leads.values()]
        .filter(
          (lead) =>
            lead.userId === where.userId && where.id.in.includes(lead.id),
        )
        .map((lead) => ({ id: lead.id }))),
    update: vi.fn(async ({ where, data }: any) => {
      const lead = state.leads.get(where.id);
      const next = { ...lead, ...data };
      state.leads.set(where.id, next);
      return next;
    }),
  },
  conversation: {
    findFirst: vi.fn(async ({ where }: any) => {
      const conversation = state.conversations.get(where.id);
      return conversation?.ownerId === where.ownerId ? { id: conversation.id } : null;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      [...state.conversations.values()]
        .filter(
          (conversation) =>
            conversation.ownerId === where.ownerId &&
            where.id.in.includes(conversation.id),
        )
        .map((conversation) => ({
          id: conversation.id,
          leadId: conversation.leadId ?? null,
        }))),
  },
  task: {
    create: vi.fn(async ({ data }: any) => {
      const now = new Date("2026-07-27T12:00:00.000Z");
      const task = {
        id: `task-${++state.sequence}`,
        ...data,
        createdAt: now,
        updatedAt: now,
      };
      state.tasks.set(task.id, task);
      return taskRow(task);
    }),
    findFirst: vi.fn(async ({ where, orderBy }: any) => {
      if (where.id) {
        const task = state.tasks.get(where.id);
        return task?.ownerId === where.ownerId ? taskRow(task) : null;
      }
      const matches = [...state.tasks.values()]
        .filter(
          (task) =>
            task.ownerId === where.ownerId &&
            task.leadId === where.leadId &&
            task.type === where.type &&
            task.status === where.status &&
            task.dueAt,
        )
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      return orderBy ? (matches[0] ? { dueAt: matches[0].dueAt } : null) : null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const task = state.tasks.get(where.id);
      const next = {
        ...task,
        ...data,
        updatedAt: new Date(task.updatedAt.getTime() + 1),
      };
      state.tasks.set(where.id, next);
      return taskRow(next);
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      const task = state.tasks.get(where.id);
      if (!task || task.ownerId !== where.ownerId) return { count: 0 };
      state.tasks.delete(where.id);
      return { count: 1 };
    }),
    findMany: vi.fn(async (query: any) => {
      if (query.where.id?.in) {
        return [...state.tasks.values()]
          .filter(
            (task) =>
              task.ownerId === query.where.ownerId &&
              query.where.id.in.includes(task.id),
          )
          .map((task) => ({
            id: task.id,
            leadId: task.leadId,
            conversationId: task.conversationId,
          }));
      }
      state.lastListQuery = query;
      return [...state.tasks.values()].map(taskRow);
    }),
  },
  conversationAnalysis: {
    findFirst: vi.fn(async ({ where }: any) =>
      state.analysis?.id === where.id &&
      state.analysis?.ownerId === where.ownerId
        ? {
            id: state.analysis.id,
            structuredData: state.analysis.structuredData,
          }
        : null),
  },
  leadActivity: {
    createMany: vi.fn(async ({ data }: any) => {
      state.activities.push(...data);
      return { count: data.length };
    }),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...database,
    $transaction: (operation: (tx: typeof database) => unknown) =>
      operation(database),
  },
}));

const {
  cancelTask,
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  reopenTask,
  taskOrderBy,
  taskViewWhere,
  updateTask,
} = await import("./task-service");

const analysisId = "cm987654321098765432109876";
const analysisOutput = {
  summary: "The lead needs a proposal.",
  company: {
    value: null,
    confidence: 0,
    evidenceMessageOrdinals: [],
  },
  contact: {
    name: null,
    email: null,
    phone: null,
    confidence: 0,
    evidenceMessageOrdinals: [],
  },
  projectType: {
    value: null,
    confidence: 0,
    evidenceMessageOrdinals: [],
  },
  budget: {
    minimumAmount: null,
    maximumAmount: null,
    currency: null,
    rawText: null,
    confidence: 0,
    evidenceMessageOrdinals: [],
  },
  timeline: {
    targetDate: null,
    rawText: null,
    confidence: 0,
    evidenceMessageOrdinals: [],
  },
  sentiment: {
    value: "UNKNOWN",
    confidence: 0,
  },
  actionItems: [
    {
      title: "Send proposal",
      description: null,
      owner: "USER",
      dueDate: null,
      confidence: 0.8,
      evidenceMessageOrdinals: [1],
    },
  ],
  missingInformation: [],
};

const base = {
  title: "Follow up",
  description: null,
  type: "FOLLOW_UP" as const,
  priority: "NORMAL" as const,
  status: "OPEN" as const,
  dueAt: new Date("2026-08-02T15:00:00.000Z"),
  leadId: null,
  conversationId: null,
};

beforeEach(() => {
  state.tasks.clear();
  state.leads.clear();
  state.conversations.clear();
  state.analysis = null;
  state.activities.length = 0;
  state.sequence = 0;
  state.lastListQuery = null;
  state.leads.set("lead-a", {
    id: "lead-a",
    userId: "owner-a",
    name: "A",
    nextFollowUpDate: null,
  });
  state.leads.set("lead-b", {
    id: "lead-b",
    userId: "owner-a",
    name: "B",
    nextFollowUpDate: null,
  });
  state.leads.set("foreign-lead", {
    id: "foreign-lead",
    userId: "owner-b",
    name: "Foreign",
    nextFollowUpDate: null,
  });
  state.conversations.set("conversation-a", {
    id: "conversation-a",
    ownerId: "owner-a",
    subject: "Estimate",
  });
  state.conversations.set("foreign-conversation", {
    id: "foreign-conversation",
    ownerId: "owner-b",
  });
  vi.clearAllMocks();
});

describe("task service", () => {
  it("creates standalone, lead-linked, conversation-linked, and combined tasks", async () => {
    await createTask("owner-a", base);
    await createTask("owner-a", { ...base, leadId: "lead-a" });
    await createTask("owner-a", { ...base, conversationId: "conversation-a" });
    await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      conversationId: "conversation-a",
    });
    expect(state.tasks).toHaveLength(4);
    expect(
      state.activities.filter((activity) => activity.type === "TASK_CREATED"),
    ).toHaveLength(4);
    expect(state.activities).toHaveLength(5);
    expect(state.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          leadId: null,
          conversationId: null,
          actorType: "USER",
          source: "TASK",
        }),
        expect.objectContaining({
          taskId: "task-3",
          conversationId: "conversation-a",
        }),
      ]),
    );
  });

  it("rejects cross-owner lead and conversation relationships", async () => {
    await expect(
      createTask("owner-a", { ...base, leadId: "foreign-lead" }),
    ).rejects.toThrow("Linked lead not found");
    await expect(
      createTask("owner-a", {
        ...base,
        conversationId: "foreign-conversation",
      }),
    ).rejects.toThrow("Linked conversation not found");
  });

  it("keeps the lead summary empty when there is no dated open follow-up", async () => {
    await createTask("owner-a", {
      ...base,
      type: "GENERAL",
      leadId: "lead-a",
    });
    await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: null,
    });

    expect(state.leads.get("lead-a").nextFollowUpDate).toBeNull();
    expect(
      state.activities.filter((activity) => activity.type === "FOLLOW_UP_CHANGED"),
    ).toHaveLength(0);
  });

  it("schedules the first dated follow-up exactly once", async () => {
    const result = await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
    });

    expect(state.leads.get("lead-a").nextFollowUpDate).toEqual(base.dueAt);
    expect(state.tasks).toHaveLength(1);
    expect(
      state.activities.filter((activity) => activity.type === "TASK_CREATED"),
    ).toHaveLength(1);
    expect(
      state.activities.filter((activity) => activity.type === "FOLLOW_UP_CHANGED"),
    ).toEqual([
      expect.objectContaining({
        taskId: result.task.id,
        title: "Follow-up scheduled",
      }),
    ]);
  });

  it("does not replace an earlier open follow-up with a later one", async () => {
    const earlier = new Date("2026-08-01T12:00:00.000Z");
    await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: earlier,
    });
    await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: new Date("2026-08-10T12:00:00.000Z"),
    });

    expect(state.leads.get("lead-a").nextFollowUpDate).toEqual(earlier);
    expect(
      state.activities.filter((activity) => activity.type === "FOLLOW_UP_CHANGED"),
    ).toHaveLength(1);
  });

  it("selects the next task when the earliest follow-up is edited later", async () => {
    const first = await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    const secondDate = new Date("2026-08-03T12:00:00.000Z");
    await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: secondDate,
    });

    await updateTask("owner-a", first.task.id, {
      ...base,
      leadId: "lead-a",
      dueAt: new Date("2026-08-05T12:00:00.000Z"),
    });

    expect(state.leads.get("lead-a").nextFollowUpDate).toEqual(secondDate);
  });

  it("sets the earliest open follow-up summary without unrelated task interference", async () => {
    const later = new Date("2026-08-10T12:00:00.000Z");
    const earlier = new Date("2026-08-03T12:00:00.000Z");
    await createTask("owner-a", { ...base, leadId: "lead-a", dueAt: later });
    await createTask("owner-a", { ...base, leadId: "lead-a", dueAt: earlier });
    await createTask("owner-a", {
      ...base,
      type: "GENERAL",
      leadId: "lead-a",
      dueAt: new Date("2026-07-30T12:00:00.000Z"),
    });
    expect(state.leads.get("lead-a").nextFollowUpDate).toEqual(earlier);
    expect(
      state.activities
        .filter((activity) => activity.type === "FOLLOW_UP_CHANGED")
        .map((activity) => ({
          title: activity.title,
          source: activity.source,
          actorType: activity.actorType,
          metadata: activity.metadata,
        })),
    ).toEqual([
      {
        title: "Follow-up scheduled",
        source: "TASK",
        actorType: "SYSTEM",
        metadata: {
          from: null,
          to: later.toISOString(),
        },
      },
      {
        title: "Follow-up rescheduled",
        source: "TASK",
        actorType: "SYSTEM",
        metadata: {
          from: later.toISOString(),
          to: earlier.toISOString(),
        },
      },
    ]);
  });

  it("marks a task created from a valid owner-scoped AI suggestion", async () => {
    state.analysis = {
      id: analysisId,
      ownerId: "owner-a",
      structuredData: analysisOutput,
    };

    const result = await createTask(
      "owner-a",
      { ...base, leadId: "lead-a" },
      { analysisId, itemIndex: "0" },
    );

    expect(database.conversationAnalysis.findFirst).toHaveBeenCalledWith({
      where: { id: analysisId, ownerId: "owner-a" },
      select: { id: true, structuredData: true },
    });
    expect(state.activities).toContainEqual(
      expect.objectContaining({
        taskId: result.task.id,
        type: "TASK_CREATED",
        title: "Task created from AI suggestion",
        metadata: expect.objectContaining({
          aiSuggestion: { analysisId, itemIndex: 0 },
        }),
      }),
    );
  });

  it("does not mark invalid or stale AI provenance as accepted", async () => {
    await createTask(
      "owner-a",
      { ...base, leadId: "lead-a" },
      { analysisId: "invalid", itemIndex: "0" },
    );
    await createTask(
      "owner-a",
      { ...base, leadId: "lead-a" },
      {
        analysisId: "cm111111111111111111111111",
        itemIndex: "0",
      },
    );

    const taskActivities = state.activities.filter(
      (activity) => activity.type === "TASK_CREATED",
    );
    expect(taskActivities).toHaveLength(2);
    expect(taskActivities).toEqual([
      expect.objectContaining({
        title: "Task created",
        metadata: expect.not.objectContaining({ aiSuggestion: expect.anything() }),
      }),
      expect.objectContaining({
        title: "Task created",
        metadata: expect.not.objectContaining({ aiSuggestion: expect.anything() }),
      }),
    ]);
    expect(database.conversationAnalysis.findFirst).toHaveBeenCalledTimes(1);
    expect(database.conversationAnalysis.findFirst).toHaveBeenCalledWith({
      where: {
        id: "cm111111111111111111111111",
        ownerId: "owner-a",
      },
      select: { id: true, structuredData: true },
    });
  });

  it("completes once, advances follow-up, and reopens correctly", async () => {
    const first = await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    const secondDate = new Date("2026-08-02T12:00:00.000Z");
    await createTask("owner-a", { ...base, leadId: "lead-a", dueAt: secondDate });
    expect((await completeTask("owner-a", first.task.id)).kind).toBe("changed");
    expect((await completeTask("owner-a", first.task.id)).kind).toBe("unchanged");
    expect(state.leads.get("lead-a").nextFollowUpDate).toEqual(secondDate);
    expect((await reopenTask("owner-a", first.task.id)).kind).toBe("changed");
    expect(state.leads.get("lead-a").nextFollowUpDate).toEqual(
      new Date("2026-08-01T12:00:00.000Z"),
    );
    expect(
      state.activities.filter((item) => item.type === "TASK_COMPLETED"),
    ).toHaveLength(1);
  });

  it("recalculates after cancellation and deletion", async () => {
    const first = await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    await cancelTask("owner-a", first.task.id);
    expect(state.leads.get("lead-a").nextFollowUpDate).toBeNull();

    const second = await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: new Date("2026-08-02T12:00:00.000Z"),
    });
    await deleteTask("owner-a", second.task.id);
    expect(state.leads.get("lead-a").nextFollowUpDate).toBeNull();
    expect(
      state.activities.filter((item) => item.type === "TASK_DELETED"),
    ).toHaveLength(1);
    expect(state.activities.at(-1)).toEqual(
      expect.objectContaining({
        type: "FOLLOW_UP_CHANGED",
        title: "Follow-up cleared",
      }),
    );
  });

  it("selects the next open follow-up after cancellation, then clears after deletion", async () => {
    const first = await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: new Date("2026-08-01T12:00:00.000Z"),
    });
    const secondDate = new Date("2026-08-02T12:00:00.000Z");
    const second = await createTask("owner-a", {
      ...base,
      leadId: "lead-a",
      dueAt: secondDate,
    });

    await cancelTask("owner-a", first.task.id);
    expect(state.leads.get("lead-a").nextFollowUpDate).toEqual(secondDate);

    await deleteTask("owner-a", second.task.id);
    expect(state.leads.get("lead-a").nextFollowUpDate).toBeNull();
  });

  it("recalculates both leads when a follow-up moves", async () => {
    const created = await createTask("owner-a", { ...base, leadId: "lead-a" });
    await updateTask("owner-a", created.task.id, { ...base, leadId: "lead-b" });
    expect(state.leads.get("lead-a").nextFollowUpDate).toBeNull();
    expect(state.leads.get("lead-b").nextFollowUpDate).toEqual(base.dueAt);
  });

  it("uses bounded owner-scoped null-last due ordering", async () => {
    await listTasks("owner-a", { page: 1, view: "open" });
    expect(state.lastListQuery.where).toEqual(
      expect.objectContaining({ ownerId: "owner-a", status: "OPEN" }),
    );
    expect(state.lastListQuery.take).toBe(26);
    expect(state.lastListQuery.orderBy[0]).toEqual({
      dueAt: { sort: "asc", nulls: "last" },
    });
  });

  it("defines the canonical overdue view as open work before now", () => {
    const boundary = new Date("2026-08-01T15:00:00.000Z");
    expect(taskViewWhere("overdue", boundary)).toEqual({
      status: "OPEN",
      dueAt: { lt: boundary },
    });
    expect(taskViewWhere("completed", boundary)).toEqual({
      status: "COMPLETED",
    });
    expect(taskViewWhere("cancelled", boundary)).toEqual({
      status: "CANCELLED",
    });
  });

  it("supports stable due, name, updated, and priority sorts", () => {
    expect(taskOrderBy("due-desc")).toEqual([
      { dueAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(taskOrderBy("name-asc")).toEqual([
      { title: "asc" },
      { id: "asc" },
    ]);
    expect(taskOrderBy("updated-desc")).toEqual([
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
    expect(taskOrderBy("priority-desc")).toEqual([
      { priority: "desc" },
      { id: "asc" },
    ]);
  });

  it("uses a dedicated owner-scoped cancelled view", async () => {
    await listTasks("owner-a", { page: 1, view: "cancelled" });
    expect(state.lastListQuery.where).toEqual(
      expect.objectContaining({
        ownerId: "owner-a",
        status: "CANCELLED",
      }),
    );
  });
});
