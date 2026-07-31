import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  createLead: vi.fn(),
  findLead: vi.fn(),
  findLeads: vi.fn(),
  updateLead: vi.fn(),
  updateLeads: vi.fn(),
  createActivities: vi.fn(),
  deleteLeads: vi.fn(),
  updateConversations: vi.fn(),
  conversations: [] as Array<{
    id: string;
    ownerId: string;
    leadId: string | null;
    reviewState: string;
    manuallyDetached: boolean;
    matchKind: string;
    matchReason: string;
    matchCandidateLeadIds: string[] | typeof Prisma.JsonNull;
  }>,
  currentLead: null as null | {
    [key: string]: unknown;
    id: string;
    userId: string;
    status: string;
    updatedAt: Date;
  },
}));
const cache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-user", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-a" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    lead: { deleteMany: mocks.deleteLeads },
  },
}));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

import {
  createLeadAction,
  deleteLeadAction,
  updateLeadAction,
} from "@/app/actions/lead-actions";

const leadId = "cm123456789012345678901234";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const values = {
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "555-0100",
    company: "Acme",
    source: "MANUAL",
    status: "NEW",
    message: "Notes",
    estimatedValue: "3500",
    nextFollowUp: "",
    ...overrides,
  };
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

const existing = {
  id: leadId,
  userId: "user-a",
  name: "Jane Doe",
  email: "jane@example.com",
  phone: "555-0100",
  company: "Acme",
  source: "MANUAL",
  status: "NEW",
  message: "Notes",
  estimatedValue: 3500,
  nextFollowUpDate: null,
  createdAt: new Date("2026-07-20T12:00:00.000Z"),
  updatedAt: new Date("2026-07-24T12:00:00.000Z"),
};

const canonical = {
  id: leadId,
  name: "Jane Doe",
  company: "Acme",
  email: "jane@example.com",
  phone: "555-0100",
  source: "MANUAL",
  status: "NEW",
  estimatedValue: "3500",
  nextFollowUp: null,
  message: "Notes",
  updatedAt: "2026-07-24T12:00:00.000Z",
};

beforeEach(() => {
  mocks.currentLead = { ...existing };
  mocks.conversations = [
    {
      id: "conversation-owned",
      ownerId: "user-a",
      leadId,
      reviewState: "MATCHED",
      manuallyDetached: false,
      matchKind: "MATCHED",
      matchReason: "manually attached",
      matchCandidateLeadIds: ["lead-stale"],
    },
    {
      id: "conversation-foreign",
      ownerId: "user-b",
      leadId,
      reviewState: "MATCHED",
      manuallyDetached: false,
      matchKind: "MATCHED",
      matchReason: "manually attached",
      matchCandidateLeadIds: ["lead-foreign-candidate"],
    },
    {
      id: "conversation-other-lead",
      ownerId: "user-a",
      leadId: "cm123456789012345678901235",
      reviewState: "MATCHED",
      manuallyDetached: false,
      matchKind: "MATCHED",
      matchReason: "manually attached",
      matchCandidateLeadIds: ["lead-other-candidate"],
    },
  ];
  mocks.createLead.mockResolvedValue({ id: leadId });
  mocks.findLead.mockImplementation(({ where }) =>
    Promise.resolve(
      mocks.currentLead?.id === where.id &&
        mocks.currentLead?.userId === where.userId
        ? { ...mocks.currentLead }
        : null,
    ),
  );
  mocks.findLeads.mockImplementation(({ where }) => {
    const current = mocks.currentLead;
    return Promise.resolve(
      current !== null &&
        current.userId === where.userId &&
        where.id.in.includes(current.id)
        ? [{ id: current.id }]
        : [],
    );
  });
  mocks.updateLead.mockImplementation(({ data }) =>
    Promise.resolve((mocks.currentLead = {
      ...mocks.currentLead!,
      ...data,
      updatedAt: new Date("2026-07-24T12:05:00.000Z"),
    })),
  );
  mocks.updateLeads.mockImplementation(({ where, data }) => {
    if (
      !mocks.currentLead ||
      mocks.currentLead.id !== where.id ||
      mocks.currentLead.userId !== where.userId ||
      mocks.currentLead.status !== where.status
    ) return Promise.resolve({ count: 0 });
    mocks.currentLead = {
      ...mocks.currentLead,
      ...data,
      updatedAt: new Date("2026-07-24T12:05:00.000Z"),
    };
    return Promise.resolve({ count: 1 });
  });
  mocks.createActivities.mockResolvedValue({ count: 1 });
  mocks.deleteLeads.mockResolvedValue({ count: 1 });
  mocks.updateConversations.mockImplementation(({ where, data }) => {
    let count = 0;
    mocks.conversations = mocks.conversations.map((conversation) => {
      if (
        conversation.ownerId !== where.ownerId ||
        conversation.leadId !== where.leadId
      ) {
        return conversation;
      }
      count++;
      return { ...conversation, ...data };
    });
    return Promise.resolve({ count });
  });
  mocks.transaction.mockImplementation((operation) =>
    operation({
      conversation: {
        updateMany: mocks.updateConversations,
      },
      lead: {
        create: mocks.createLead,
        deleteMany: mocks.deleteLeads,
        findFirst: mocks.findLead,
        findMany: mocks.findLeads,
        update: mocks.updateLead,
        updateMany: mocks.updateLeads,
      },
      leadActivity: {
        createMany: mocks.createActivities,
      },
    }),
  );
});

describe("lead action activity transactions", () => {
  it("creates a manual lead and its initial activity in one transaction", async () => {
    await expect(createLeadAction({}, form())).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.findLeads).toHaveBeenCalledWith({
      where: { id: { in: [leadId] }, userId: "user-a" },
      select: { id: true },
    });
    expect(mocks.createActivities).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leadId,
          userId: "user-a",
          type: "LEAD_CREATED",
          actorType: "USER",
          source: "MANUAL",
          title: "Lead created",
          description: "Created manually",
        }),
      ],
      skipDuplicates: false,
    });
  });

  it("creates status activity in the same transaction as the owned update", async () => {
    await expect(updateLeadAction(
      leadId,
      {},
      form({ status: "CONTACTED" }),
    )).resolves.toEqual({
      success: true,
      changed: true,
      message: "Lead updated.",
      lead: {
        ...canonical,
        status: "CONTACTED",
        updatedAt: "2026-07-24T12:05:00.000Z",
      },
    });

    expect(mocks.findLead).toHaveBeenCalledWith({
      where: { id: leadId, userId: "user-a" },
    });
    expect(mocks.updateLeads).toHaveBeenCalledWith({
      where: { id: leadId, userId: "user-a", status: "NEW" },
      data: { status: "CONTACTED" },
    });
    expect(mocks.createActivities).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leadId,
          userId: "user-a",
          type: "STATUS_CHANGED",
          actorType: "USER",
          source: "MANUAL",
        }),
      ],
      skipDuplicates: false,
    });
  });

  it("normalizes textarea line endings so a status save does not change notes", async () => {
    mocks.currentLead = {
      ...existing,
      message: "Line one\n\nLine two",
    };
    await updateLeadAction(
      leadId,
      {},
      form({
        status: "WON",
        message: "Line one\r\n\r\nLine two",
      }),
    );

    expect(mocks.updateLeads).toHaveBeenCalledWith({
      where: { id: leadId, userId: "user-a", status: "NEW" },
      data: { status: "WON" },
    });
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });

  it("does not reverse a saved status on the next no-op save", async () => {
    await updateLeadAction(leadId, {}, form({ status: "CONTACTED" }));
    mocks.findLead.mockResolvedValue({
      ...existing,
      status: "CONTACTED",
      updatedAt: new Date("2026-07-24T12:05:00.000Z"),
    });

    await expect(
      updateLeadAction(leadId, {}, form({ status: "CONTACTED" })),
    ).resolves.toEqual(expect.objectContaining({
      success: true,
      changed: false,
      message: "No changes to save.",
      lead: expect.objectContaining({ status: "CONTACTED" }),
    }));
    expect(mocks.updateLeads).toHaveBeenCalledTimes(1);
    expect(
      mocks.createActivities.mock.calls.flatMap(
        ([input]) => input.data.filter(
          (activity: { type: string }) => activity.type === "STATUS_CHANGED",
        ),
      ),
    ).toHaveLength(1);
  });

  it("does not let a stale or tampered lead form schedule a follow-up", async () => {
    await expect(updateLeadAction(
      leadId,
      {},
      form({ nextFollowUp: "2026-08-12" }),
    )).resolves.toEqual({
      success: true,
      changed: false,
      message: "No changes to save.",
      lead: canonical,
    });
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.createActivities).not.toHaveBeenCalled();
  });

  it("preserves a task-derived follow-up while saving another lead field", async () => {
    const nextFollowUpDate = new Date("2026-08-12T12:00:00");
    mocks.currentLead = {
      ...existing,
      status: "CONTACTED",
      nextFollowUpDate,
    };
    await expect(updateLeadAction(
      leadId,
      {},
      form({
        company: "Updated company",
        status: "CONTACTED",
        nextFollowUp: "",
      }),
    )).resolves.toEqual(expect.objectContaining({
      success: true,
      changed: true,
      lead: expect.objectContaining({
        company: "Updated company",
        nextFollowUp: "2026-08-12",
      }),
    }));
    expect(mocks.updateLead).toHaveBeenCalledWith({
      where: { id: leadId },
      data: expect.not.objectContaining({
        nextFollowUpDate: expect.anything(),
      }),
    });
    expect(
      mocks.createActivities.mock.calls.flatMap(
        ([input]) => input.data.filter(
          (activity: { type: string }) => activity.type === "FOLLOW_UP_CHANGED",
        ),
      ),
    ).toHaveLength(0);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("returns an accurate success without writing an unchanged save", async () => {
    await expect(updateLeadAction(leadId, {}, form())).resolves.toEqual({
      success: true,
      changed: false,
      message: "No changes to save.",
      lead: canonical,
    });
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.createActivities).not.toHaveBeenCalled();
  });

  it("cannot update or create activity for another user's lead", async () => {
    mocks.findLead.mockResolvedValue(null);
    await expect(updateLeadAction(leadId, {}, form({ status: "WON" })))
      .resolves.toEqual({ message: "Lead not found." });
    expect(mocks.updateLead).not.toHaveBeenCalled();
    expect(mocks.createActivities).not.toHaveBeenCalled();
  });

  it("rolls back the update result when activity creation fails", async () => {
    mocks.createActivities.mockRejectedValue(new Error("database failure"));
    await expect(updateLeadAction(
      leadId,
      {},
      form({ status: "CONTACTED" }),
    )).resolves.toEqual({
      message: "We couldn't update this lead. Please try again.",
    });
    expect(mocks.updateLeads).toHaveBeenCalled();
    expect(mocks.createActivities).toHaveBeenCalled();
  });

  it("deletes only the owned lead and safely resets its attached conversations", async () => {
    await expect(deleteLeadAction(leadId)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.updateConversations).toHaveBeenCalledWith({
      where: {
        ownerId: "user-a",
        leadId,
        lead: { userId: "user-a" },
      },
      data: {
        leadId: null,
        reviewState: "NEEDS_REVIEW",
        manuallyDetached: false,
        matchKind: "NO_MATCH",
        matchReason: "attached lead was deleted",
        matchCandidateLeadIds: Prisma.JsonNull,
      },
    });
    expect(mocks.deleteLeads).toHaveBeenCalledWith({
      where: { id: leadId, userId: "user-a" },
    });
    expect(mocks.updateConversations.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteLeads.mock.invocationCallOrder[0],
    );
    expect(mocks.conversations).toContainEqual({
      id: "conversation-owned",
      ownerId: "user-a",
      leadId: null,
      reviewState: "NEEDS_REVIEW",
      manuallyDetached: false,
      matchKind: "NO_MATCH",
      matchReason: "attached lead was deleted",
      matchCandidateLeadIds: Prisma.JsonNull,
    });
    expect(mocks.conversations).toContainEqual({
      id: "conversation-foreign",
      ownerId: "user-b",
      leadId,
      reviewState: "MATCHED",
      manuallyDetached: false,
      matchKind: "MATCHED",
      matchReason: "manually attached",
      matchCandidateLeadIds: ["lead-foreign-candidate"],
    });
    expect(mocks.conversations).toContainEqual({
      id: "conversation-other-lead",
      ownerId: "user-a",
      leadId: "cm123456789012345678901235",
      reviewState: "MATCHED",
      manuallyDetached: false,
      matchKind: "MATCHED",
      matchReason: "manually attached",
      matchCandidateLeadIds: ["lead-other-candidate"],
    });
  });
});
