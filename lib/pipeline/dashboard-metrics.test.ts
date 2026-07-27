import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  aggregate: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: {
      count: mocks.count,
      aggregate: mocks.aggregate,
      groupBy: mocks.groupBy,
    },
  },
}));

import { getDashboardLeadMetrics } from "@/lib/pipeline/dashboard-metrics";

beforeEach(() => {
  mocks.count
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(2);
  mocks.aggregate.mockResolvedValue({ _sum: { estimatedValue: 12500 } });
  mocks.groupBy.mockResolvedValue([{ status: "NEW", _count: 3 }]);
});

describe("Dashboard pipeline metric regression", () => {
  it("recomputes owner-scoped counts, active value, and won-this-week", async () => {
    const now = new Date("2026-07-27T15:00:00.000Z");
    await expect(
      getDashboardLeadMetrics("owner-a", now),
    ).resolves.toEqual({
      newCount: 3,
      followUpCount: 4,
      wonThisWeek: 2,
      pipelineValue: { _sum: { estimatedValue: 12500 } },
      grouped: [{ status: "NEW", _count: 3 }],
    });

    expect(mocks.count).toHaveBeenNthCalledWith(1, {
      where: { userId: "owner-a", status: "NEW" },
    });
    expect(mocks.count).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "owner-a",
          status: "WON",
          updatedAt: { gte: expect.any(Date) },
        }),
      }),
    );
    expect(mocks.aggregate).toHaveBeenCalledWith({
      where: {
        userId: "owner-a",
        status: {
          in: ["NEW", "CONTACTED", "FOLLOW_UP", "PROPOSAL_SENT", "NEGOTIATING"],
        },
      },
      _sum: { estimatedValue: true },
    });
    expect(mocks.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { userId: "owner-a" },
      _count: true,
    });
  });
});
