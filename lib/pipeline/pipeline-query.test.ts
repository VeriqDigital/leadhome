/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  findMany: vi.fn(),
  groupBy: vi.fn(),
  count: vi.fn(),
  aggregate: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: { lead: calls },
}));

const {
  getPipelineBoard,
  pipelineOrderBy,
  pipelineWhere,
} = await import("./pipeline-query");

function row(id: string, status: string, value: number | null = null) {
  return {
    id,
    name: `Lead ${id}`,
    company: null,
    email: `${id}@example.com`,
    source: "MANUAL",
    status,
    estimatedValue: value,
    nextFollowUpDate: null,
    updatedAt: new Date("2026-07-27T12:00:00.000Z"),
    activities: [],
    tasks: [],
    _count: { tasks: 0, conversations: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.findMany.mockImplementation(async ({ where, take }: any) =>
    where.status === "NEW"
      ? Array.from({ length: Math.min(take, 21) }, (_, index) =>
          row(`new-${index}`, "NEW", index === 0 ? null : 100),
        )
      : []);
  calls.groupBy.mockResolvedValue([
    { status: "NEW", _count: 500, _sum: { estimatedValue: 49900 } },
    { status: "WON", _count: 2, _sum: { estimatedValue: 9000 } },
    { status: "LOST", _count: 1, _sum: { estimatedValue: null } },
  ]);
  calls.count.mockResolvedValue(3);
  calls.aggregate.mockResolvedValue({ _sum: { estimatedValue: 4000 } });
});

describe("pipeline query", () => {
  it("combines owner-scoped search, value, follow-up, task, and conversation filters", () => {
    const now = new Date("2026-07-27T15:00:00.000Z");
    const where = pipelineWhere("owner-a", {
      query: "acme",
      source: "GMAIL",
      minimumValue: 100,
      maximumValue: 5000,
      followUp: "overdue",
      hasOpenTasks: true,
      hasConversation: true,
      sort: "urgency",
      now,
    });
    expect(where).toEqual(expect.objectContaining({
      userId: "owner-a",
      source: "GMAIL",
      estimatedValue: { gte: 100, lte: 5000 },
      nextFollowUpDate: { lt: now },
      tasks: { some: { status: "OPEN" } },
      conversations: { some: {} },
      OR: expect.any(Array),
    }));
  });

  it("uses stable urgency and explicit null-last value sorting", () => {
    expect(pipelineOrderBy("urgency")).toEqual([
      { nextFollowUpDate: { sort: "asc", nulls: "last" } },
      { updatedAt: "desc" },
      { id: "asc" },
    ]);
    expect(pipelineOrderBy("value-asc")).toEqual([
      { estimatedValue: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ]);
    expect(pipelineOrderBy("name-desc")).toEqual([
      { name: "desc" },
      { id: "desc" },
    ]);
    expect(pipelineOrderBy("updated-desc")).toEqual([
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
    expect(pipelineOrderBy("value-desc")).toEqual([
      { estimatedValue: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(pipelineOrderBy("name-asc")).toEqual([
      { name: "asc" },
      { id: "asc" },
    ]);
    expect(pipelineOrderBy("forged" as never)).toEqual(
      pipelineOrderBy("urgency"),
    );
  });

  it("groups stages, calculates values, and excludes terminal stages from active totals", async () => {
    const result = await getPipelineBoard("owner-a", {
      sort: "urgency",
      now: new Date("2026-07-27T15:00:00.000Z"),
    });
    expect(result.columns.find((column) => column.status === "NEW")).toEqual(
      expect.objectContaining({
        count: 500,
        value: "49900",
        hasMore: true,
      }),
    );
    expect(result.columns.find((column) => column.status === "CONTACTED"))
      .toEqual(expect.objectContaining({
        count: 0,
        value: "0",
        cards: [],
        hasMore: false,
      }));
    expect(result.summary).toEqual({
      activeOpportunityCount: 500,
      activePipelineValue: "49900",
      overdueFollowUpCount: 3,
      wonValueThisWeek: "4000",
    });
  });

  it("enforces owner scope and bounded per-stage limits with 500 leads", async () => {
    const result = await getPipelineBoard("owner-a", {
      sort: "updated-desc",
      limits: { NEW: 40 },
    });
    expect(calls.findMany).toHaveBeenCalledTimes(7);
    for (const [query] of calls.findMany.mock.calls) {
      expect(query.where.userId).toBe("owner-a");
      expect(query.take).toBeLessThanOrEqual(101);
    }
    expect(result.columns.find((column) => column.status === "NEW")?.cards)
      .toHaveLength(21);
  });
});
