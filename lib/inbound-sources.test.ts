import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  createLead: vi.fn(),
  findLeads: vi.fn(),
  createActivities: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    inboundSource: {
      updateMany: mocks.updateMany,
      findFirst: mocks.findFirst,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  createInboundTestLead,
  setInboundSourceActive,
} from "@/lib/inbound-sources";

describe("inbound source ownership", () => {
  beforeEach(() => {
    mocks.updateMany.mockImplementation(({ where, data }) => {
      const owned = where.id === "source-a" && where.userId === "user-a";
      return Promise.resolve({ count: owned ? 1 : 0, data });
    });
    mocks.findFirst.mockResolvedValue(null);
    mocks.createLead.mockResolvedValue({ id: "lead-test" });
    mocks.findLeads.mockResolvedValue([{ id: "lead-test" }]);
    mocks.createActivities.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation((operation) =>
      operation({
        lead: {
          create: mocks.createLead,
          findMany: mocks.findLeads,
        },
        leadActivity: { createMany: mocks.createActivities },
      }),
    );
  });

  it("does not let one account manage another account's source", async () => {
    const result = await setInboundSourceActive("user-b", "source-a", false);
    expect(result.count).toBe(0);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "source-a", userId: "user-b" },
      data: { isActive: false },
    });
  });

  it("creates a forced test lead only for an active owned source", async () => {
    mocks.findFirst.mockResolvedValue({ id: "source-a", name: "Veriq" });

    await expect(
      createInboundTestLead("user-a", "source-a"),
    ).resolves.toEqual({ id: "lead-test" });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "source-a", userId: "user-a", isActive: true },
      select: { id: true, name: true },
    });
    expect(mocks.createLead).toHaveBeenCalledWith({
      data: {
        userId: "user-a",
        name: "LeadHome Test Lead",
        email: "test@leadhome.local",
        message: "Test submission from Website Sources settings",
        source: "WEBSITE",
        status: "NEW",
      },
      select: { id: true },
    });
    expect(mocks.findLeads).toHaveBeenCalledWith({
      where: { id: { in: ["lead-test"] }, userId: "user-a" },
      select: { id: true },
    });
    expect(mocks.createActivities).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leadId: "lead-test",
          userId: "user-a",
          type: "WEBSITE_SUBMISSION_RECEIVED",
          actorType: "CONTACT",
          source: "WEBSITE",
          title: "Website lead created",
          description: "Submission received from Veriq",
          metadata: {
            inboundSourceId: "source-a",
            inboundSourceName: "Veriq",
            email: "test@leadhome.local",
          },
        }),
      ],
      skipDuplicates: false,
    });
  });

  it("does not create a test lead for a disabled or unowned source", async () => {
    await expect(
      createInboundTestLead("user-b", "source-a"),
    ).resolves.toBeNull();
    expect(mocks.createLead).not.toHaveBeenCalled();
  });
});
