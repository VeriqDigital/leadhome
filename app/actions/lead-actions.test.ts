import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  createLead: vi.fn(),
  createActivity: vi.fn(),
  findLead: vi.fn(),
  updateLead: vi.fn(),
  updateLeads: vi.fn(),
  createActivities: vi.fn(),
  deleteLeads: vi.fn(),
  currentLead: null as null | {
    [key: string]: unknown;
    id: string;
    userId: string;
    status: string;
    updatedAt: Date;
  },
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
  mocks.createLead.mockResolvedValue({ id: leadId });
  mocks.createActivity.mockResolvedValue({ id: "activity-a" });
  mocks.findLead.mockImplementation(({ where }) =>
    Promise.resolve(
      mocks.currentLead?.id === where.id &&
        mocks.currentLead?.userId === where.userId
        ? { ...mocks.currentLead }
        : null,
    ),
  );
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
  mocks.transaction.mockImplementation((operation) =>
    operation({
      lead: {
        create: mocks.createLead,
        findFirst: mocks.findLead,
        update: mocks.updateLead,
        updateMany: mocks.updateLeads,
      },
      leadActivity: {
        create: mocks.createActivity,
        createMany: mocks.createActivities,
      },
    }),
  );
});

describe("lead action activity transactions", () => {
  it("creates a manual lead and its initial activity in one transaction", async () => {
    await expect(createLeadAction({}, form())).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.createActivity).toHaveBeenCalledWith({
      data: {
        leadId,
        userId: "user-a",
        type: "LEAD_CREATED",
        title: "Lead created",
        description: "Created manually",
      },
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
    expect(mocks.createActivity).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId,
        userId: "user-a",
        type: "STATUS_CHANGED",
      }),
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
      mocks.createActivity.mock.calls.filter(
        ([input]) => input.data.type === "STATUS_CHANGED",
      ),
    ).toHaveLength(1);
  });

  it("changes follow-up without changing status", async () => {
    await expect(updateLeadAction(
      leadId,
      {},
      form({ nextFollowUp: "2026-08-12" }),
    )).resolves.toEqual(expect.objectContaining({
      success: true,
      changed: true,
      lead: expect.objectContaining({
        status: "NEW",
        nextFollowUp: "2026-08-12",
      }),
    }));
    expect(mocks.updateLead).toHaveBeenCalledWith({
      where: { id: leadId },
      data: expect.objectContaining({
        nextFollowUpDate: new Date("2026-08-12T12:00:00"),
      }),
    });
    expect(mocks.createActivities).toHaveBeenCalledWith({
      data: [expect.objectContaining({ type: "FOLLOW_UP_CHANGED" })],
    });
  });

  it("clears follow-up without altering the persisted status", async () => {
    mocks.findLead.mockResolvedValue({
      ...existing,
      status: "CONTACTED",
      nextFollowUpDate: new Date("2026-08-12T12:00:00"),
    });
    await updateLeadAction(
      leadId,
      {},
      form({ status: "CONTACTED", nextFollowUp: "" }),
    );
    expect(mocks.updateLead).toHaveBeenCalledWith({
      where: { id: leadId },
      data: expect.objectContaining({
        nextFollowUpDate: null,
      }),
    });
    expect(mocks.createActivities).toHaveBeenCalledWith({
      data: [expect.objectContaining({ type: "FOLLOW_UP_CHANGED" })],
    });
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
    mocks.createActivity.mockRejectedValue(new Error("database failure"));
    await expect(updateLeadAction(
      leadId,
      {},
      form({ status: "CONTACTED" }),
    )).resolves.toEqual({
      message: "We couldn't update this lead. Please try again.",
    });
    expect(mocks.updateLeads).toHaveBeenCalled();
    expect(mocks.createActivity).toHaveBeenCalled();
  });

  it("deletes only the owned lead so database cascades remove its activities", async () => {
    await expect(deleteLeadAction(leadId)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.deleteLeads).toHaveBeenCalledWith({
      where: { id: leadId, userId: "user-a" },
    });
  });
});
