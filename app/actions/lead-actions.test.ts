import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  createLead: vi.fn(),
  createActivity: vi.fn(),
  findLead: vi.fn(),
  updateLead: vi.fn(),
  createActivities: vi.fn(),
  deleteLeads: vi.fn(),
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
    nextFollowUpDate: "",
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
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  mocks.createLead.mockResolvedValue({ id: leadId });
  mocks.createActivity.mockResolvedValue({ id: "activity-a" });
  mocks.findLead.mockResolvedValue(existing);
  mocks.updateLead.mockResolvedValue(existing);
  mocks.createActivities.mockResolvedValue({ count: 1 });
  mocks.deleteLeads.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation((operation) =>
    operation({
      lead: {
        create: mocks.createLead,
        findFirst: mocks.findLead,
        update: mocks.updateLead,
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
    )).resolves.toEqual({ success: true, message: "Lead updated." });

    expect(mocks.findLead).toHaveBeenCalledWith({
      where: { id: leadId, userId: "user-a" },
    });
    expect(mocks.updateLead).toHaveBeenCalled();
    expect(mocks.createActivities).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        leadId,
        userId: "user-a",
        type: "STATUS_CHANGED",
      })],
    });
  });

  it("does not create activity for an unchanged save", async () => {
    await updateLeadAction(leadId, {}, form());
    expect(mocks.updateLead).toHaveBeenCalled();
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
    expect(mocks.updateLead).toHaveBeenCalled();
    expect(mocks.createActivities).toHaveBeenCalled();
  });

  it("deletes only the owned lead so database cascades remove its activities", async () => {
    await expect(deleteLeadAction(leadId)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.deleteLeads).toHaveBeenCalledWith({
      where: { id: leadId, userId: "user-a" },
    });
  });
});
