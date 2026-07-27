/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tasks: new Map<string, any>(),
  leads: new Map<string, any>(),
  conversations: new Map<string, any>(),
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
      state.lastListQuery = query;
      return [...state.tasks.values()].map(taskRow);
    }),
  },
  leadActivity: {
    create: vi.fn(async ({ data }: any) => {
      state.activities.push(data);
      return { id: `activity-${state.activities.length}` };
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
  updateTask,
} = await import("./task-service");

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
    expect(state.activities).toHaveLength(2);
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
    expect(state.activities.at(-1)?.type).toBe("TASK_DELETED");
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
