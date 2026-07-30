import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const state = vi.hoisted(() => ({
  conversations: new Map<string, {
    id: string; ownerId: string; leadId: string | null;
    classification: "UNKNOWN" | "LEAD";
    reviewState: "NEEDS_REVIEW" | "MATCHED";
    status: "OPEN" | "CLOSED";
    updatedAt: Date;
  }>(),
  activities: 0,
  activityRows: [] as Record<string, unknown>[],
}));

const analysis = vi.hoisted(() => ({
  enqueue: vi.fn(),
}));

const database = vi.hoisted(() => ({
  conversation: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; ownerId: string } }) => {
      const row = state.conversations.get(where.id);
      if (!row || row.ownerId !== where.ownerId) return null;
      return {
        ...row,
        lead: row.leadId ? { id: row.leadId, name: `Lead ${row.leadId}`, email: null } : null,
      };
    }),
    findMany: vi.fn(async ({ where }: {
      where: { id: { in: string[] }; ownerId: string };
    }) =>
      [...state.conversations.values()]
        .filter(
          (row) =>
            row.ownerId === where.ownerId && where.id.in.includes(row.id),
        )
        .map((row) => ({ id: row.id, leadId: row.leadId }))),
    updateMany: vi.fn(async ({ where, data }: {
      where: { id: string; ownerId: string };
      data: Record<string, string>;
    }) => {
      const row = state.conversations.get(where.id);
      if (!row || row.ownerId !== where.ownerId) return { count: 0 };
      state.conversations.set(where.id, { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1) });
      return { count: 1 };
    }),
  },
  lead: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
      where.userId === "owner-a" ? { id: where.id } : null),
    findMany: vi.fn(async ({ where }: {
      where: { id: { in: string[] }; userId: string };
    }) =>
      where.userId === "owner-a"
        ? where.id.in.map((id) => ({ id }))
        : []),
    update: vi.fn(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
    })),
  },
  message: {
    findMany: vi.fn(async () => []),
  },
  task: {
    findMany: vi.fn(async () => []),
  },
  leadActivity: {
    createMany: vi.fn(async ({ data }: {
      data: Record<string, unknown>[];
    }) => {
      state.activityRows.push(...data);
      state.activities += data.length;
      return { count: data.length };
    }),
  },
  $transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(database)),
}));

vi.mock("@/lib/prisma", () => ({ prisma: database }));
vi.mock("@/lib/ai/conversation-analysis/job-service", () => ({
  enqueueConversationAnalysisAfterLeadLink: analysis.enqueue,
}));
vi.mock("./conversation-service", () => ({
  attachConversationToLead: vi.fn(async ({ ownerId, conversationId, leadId }) => {
    const row = state.conversations.get(conversationId);
    if (!row || row.ownerId !== ownerId) throw new Error("not found");
    if (row.leadId === leadId) return row;
    state.conversations.set(conversationId, { ...row, leadId, updatedAt: new Date(row.updatedAt.getTime() + 1) });
    state.activities++;
  }),
  detachConversation: vi.fn(async ({ ownerId, conversationId }) => {
    const row = state.conversations.get(conversationId);
    if (!row || row.ownerId !== ownerId) throw new Error("not found");
    if (!row.leadId) return row;
    state.conversations.set(conversationId, { ...row, leadId: null, updatedAt: new Date(row.updatedAt.getTime() + 1) });
    state.activities++;
  }),
}));

import {
  attachConversationControl,
  detachConversationControl,
  updateConversationClassification,
  updateConversationReviewState,
  updateConversationStatus,
  updateConversationControls,
} from "./conversation-control-service";

describe("canonical conversation control mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.activities = 0;
    state.activityRows.length = 0;
    analysis.enqueue.mockResolvedValue(undefined);
    state.conversations.clear();
    for (const id of ["conversation-a", "conversation-b"]) {
      state.conversations.set(id, {
        id, ownerId: "owner-a", leadId: null, classification: "UNKNOWN",
        reviewState: "NEEDS_REVIEW", status: "OPEN", updatedAt: new Date("2026-01-01"),
      });
    }
  });

  it("persists status and returns the canonical row, then reports a no-op", async () => {
    const changed = await updateConversationStatus({
      ownerId: "owner-a", conversationId: "conversation-b", status: "CLOSED",
    });
    expect(changed).toEqual(expect.objectContaining({
      changed: true,
      conversation: expect.objectContaining({ id: "conversation-b", status: "CLOSED" }),
    }));
    expect(state.conversations.get("conversation-a")?.status).toBe("OPEN");
    expect(state.conversations.get("conversation-b")?.status).toBe("CLOSED");

    const repeated = await updateConversationStatus({
      ownerId: "owner-a", conversationId: "conversation-b", status: "CLOSED",
    });
    expect(repeated.changed).toBe(false);
    expect(database.conversation.updateMany).toHaveBeenCalledTimes(1);
    expect(state.activityRows).toEqual([
      expect.objectContaining({
        userId: "owner-a",
        leadId: null,
        conversationId: "conversation-b",
        type: "CONVERSATION_STATUS_CHANGED",
      }),
    ]);
  });

  it("persists classification and review state independently", async () => {
    await updateConversationClassification({
      ownerId: "owner-a", conversationId: "conversation-b", classification: "LEAD",
    });
    await updateConversationReviewState({
      ownerId: "owner-a", conversationId: "conversation-b", reviewState: "MATCHED",
    });
    expect(state.conversations.get("conversation-b")).toEqual(expect.objectContaining({
      classification: "LEAD", reviewState: "MATCHED", status: "OPEN",
    }));
  });

  it("records an enriched activity for a linked conversation status change", async () => {
    const current = state.conversations.get("conversation-b")!;
    state.conversations.set("conversation-b", {
      ...current,
      leadId: "lead-b",
    });

    await updateConversationStatus({
      ownerId: "owner-a",
      conversationId: "conversation-b",
      status: "CLOSED",
    });

    expect(state.activityRows).toEqual([
      expect.objectContaining({
        userId: "owner-a",
        leadId: "lead-b",
        conversationId: "conversation-b",
        type: "CONVERSATION_STATUS_CHANGED",
        actorType: "USER",
        source: "INBOX",
        title: "Conversation status changed",
        metadata: { from: "OPEN", to: "CLOSED" },
      }),
    ]);
  });

  it("rejects a wrong-owner mutation instead of reporting success", async () => {
    await expect(updateConversationStatus({
      ownerId: "owner-b", conversationId: "conversation-b", status: "CLOSED",
    })).rejects.toThrow("Conversation not found");
    expect(state.conversations.get("conversation-b")?.status).toBe("OPEN");
  });

  it("attaches and detaches once without duplicate activity on repeats", async () => {
    const attached = await attachConversationControl({
      ownerId: "owner-a", conversationId: "conversation-b", leadId: "lead-b",
    });
    expect(attached.conversation.leadId).toBe("lead-b");
    expect((await attachConversationControl({
      ownerId: "owner-a", conversationId: "conversation-b", leadId: "lead-b",
    })).changed).toBe(false);
    expect(state.activities).toBe(1);

    expect((await detachConversationControl({
      ownerId: "owner-a", conversationId: "conversation-b",
    })).conversation.leadId).toBeNull();
    expect((await detachConversationControl({
      ownerId: "owner-a", conversationId: "conversation-b",
    })).changed).toBe(false);
    expect(state.activities).toBe(2);
  });

  it("updates only changed fields in a combined save", async () => {
    const result = await updateConversationControls({
      ownerId: "owner-a",
      conversationId: "conversation-b",
      leadId: null,
      classification: "LEAD",
      reviewState: "NEEDS_REVIEW",
      status: "OPEN",
    });
    expect(result.conversation).toEqual(expect.objectContaining({
      classification: "LEAD", reviewState: "NEEDS_REVIEW", status: "OPEN", leadId: null,
    }));
    expect(database.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conversation-b", ownerId: "owner-a" },
      data: { classification: "LEAD", classificationIsManual: true },
    });
  });

  it("records a combined status change for an unattached conversation", async () => {
    await updateConversationControls({
      ownerId: "owner-a",
      conversationId: "conversation-b",
      leadId: null,
      classification: "UNKNOWN",
      reviewState: "NEEDS_REVIEW",
      status: "CLOSED",
    });

    expect(state.activityRows).toEqual([
      expect.objectContaining({
        userId: "owner-a",
        leadId: null,
        conversationId: "conversation-b",
        type: "CONVERSATION_STATUS_CHANGED",
        metadata: { from: "OPEN", to: "CLOSED" },
      }),
    ]);
  });

  it("advances the attached lead in a combined save", async () => {
    await updateConversationControls({
      ownerId: "owner-a",
      conversationId: "conversation-b",
      leadId: "lead-b",
      classification: "UNKNOWN",
      reviewState: "NEEDS_REVIEW",
      status: "OPEN",
    });

    expect(database.lead.update).toHaveBeenCalledWith({
      where: { id: "lead-b" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(database.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conversation-b", ownerId: "owner-a" },
      data: {
        leadId: "lead-b",
        manuallyDetached: false,
        matchKind: "MATCHED",
        matchReason: "manually attached",
        matchCandidateLeadIds: Prisma.JsonNull,
        reviewState: "MATCHED",
      },
    });
    expect(state.activityRows).toEqual([
      expect.objectContaining({
        userId: "owner-a",
        leadId: "lead-b",
        conversationId: "conversation-b",
        type: "CONVERSATION_LINKED",
        actorType: "USER",
        source: "INBOX",
        title: "Conversation attached",
      }),
    ]);
    expect(analysis.enqueue).toHaveBeenCalledTimes(1);
    expect(analysis.enqueue).toHaveBeenCalledWith(
      "owner-a",
      "conversation-b",
    );
    expect(database.lead.update.mock.invocationCallOrder[0]).toBeLessThan(
      analysis.enqueue.mock.invocationCallOrder[0],
    );
  });

  it("returns a no-op for an unchanged combined save", async () => {
    const result = await updateConversationControls({
      ownerId: "owner-a",
      conversationId: "conversation-b",
      leadId: null,
      classification: "UNKNOWN",
      reviewState: "NEEDS_REVIEW",
      status: "OPEN",
    });
    expect(result.changed).toBe(false);
    expect(database.conversation.updateMany).not.toHaveBeenCalled();
    expect(analysis.enqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue analysis when a combined save detaches a lead", async () => {
    const current = state.conversations.get("conversation-b")!;
    state.conversations.set("conversation-b", {
      ...current,
      leadId: "lead-b",
      reviewState: "MATCHED",
    });

    await updateConversationControls({
      ownerId: "owner-a",
      conversationId: "conversation-b",
      leadId: null,
      classification: "UNKNOWN",
      reviewState: "MATCHED",
      status: "OPEN",
    });

    expect(state.conversations.get("conversation-b")?.leadId).toBeNull();
    expect(database.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "conversation-b", ownerId: "owner-a" },
      data: {
        leadId: null,
        manuallyDetached: true,
        matchKind: "NO_MATCH",
        matchReason: "conversation was manually detached",
        matchCandidateLeadIds: Prisma.JsonNull,
        reviewState: "RESOLVED",
      },
    });
    expect(analysis.enqueue).not.toHaveBeenCalled();
  });
});
