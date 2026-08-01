/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  lead: null as any,
  activities: [] as any[],
  forceZero: false,
}));

const database = vi.hoisted(() => ({
  lead: {
    findFirst: vi.fn(async ({ where }: any) =>
      state.lead?.id === where.id && state.lead?.userId === where.userId
        ? { ...state.lead }
        : null),
    findMany: vi.fn(async ({ where }: any) =>
      state.lead?.userId === where.userId &&
      (where.status === "NEW"
        ? state.lead.status === "NEW"
        : where.id.in.includes(state.lead.id))
        ? [{ id: state.lead.id }]
        : []),
    updateMany: vi.fn(async ({ where, data }: any) => {
      if (
        state.forceZero ||
        !state.lead ||
        state.lead.id !== where.id ||
        state.lead.userId !== where.userId ||
        state.lead.status !== where.status
      ) return { count: 0 };
      state.lead = {
        ...state.lead,
        ...data,
        updatedAt: new Date("2026-07-27T13:00:00.000Z"),
      };
      return { count: 1 };
    }),
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
  advanceNewLeadToContactedInTransaction,
  moveLeadStatus,
  reconcileContactedLeadStatuses,
} = await import("./status-service");

beforeEach(() => {
  state.lead = {
    id: "cm123456789012345678901234",
    userId: "owner-a",
    name: "Jane",
    status: "NEW",
    updatedAt: new Date("2026-07-27T12:00:00.000Z"),
  };
  state.activities.length = 0;
  state.forceZero = false;
  vi.clearAllMocks();
});

describe("pipeline status mutation", () => {
  it("atomically moves and rereads the canonical lead with one activity", async () => {
    const result = await moveLeadStatus(
      "owner-a",
      state.lead.id,
      "CONTACTED",
    );
    expect(result).toEqual(expect.objectContaining({
      kind: "changed",
      lead: expect.objectContaining({ status: "CONTACTED" }),
      previousStatus: "NEW",
    }));
    expect(state.activities).toEqual([
      expect.objectContaining({
        type: "STATUS_CHANGED",
        actorType: "USER",
        source: "MANUAL",
        metadata: { from: "NEW", to: "CONTACTED" },
      }),
    ]);
  });

  it("returns unchanged and creates no duplicate activity for the same stage", async () => {
    expect(
      await moveLeadStatus("owner-a", state.lead.id, "NEW"),
    ).toEqual(expect.objectContaining({ kind: "unchanged" }));
    expect(state.activities).toHaveLength(0);
  });

  it("rejects wrong-owner and zero-row updates without success", async () => {
    expect(
      await moveLeadStatus("owner-b", state.lead.id, "WON"),
    ).toEqual({ kind: "not-found" });
    state.forceZero = true;
    expect(
      await moveLeadStatus("owner-a", state.lead.id, "WON"),
    ).toEqual({ kind: "not-found" });
    expect(state.activities).toHaveLength(0);
  });

  it("allows WON and LOST to reopen into active stages", async () => {
    state.lead.status = "WON";
    expect(
      await moveLeadStatus("owner-a", state.lead.id, "CONTACTED"),
    ).toEqual(expect.objectContaining({ kind: "changed" }));
    state.lead.status = "LOST";
    expect(
      await moveLeadStatus("owner-a", state.lead.id, "FOLLOW_UP"),
    ).toEqual(expect.objectContaining({ kind: "changed" }));
    expect(state.activities).toHaveLength(2);
  });

  it("advances only New leads using the supplied contact provenance", async () => {
    await expect(advanceNewLeadToContactedInTransaction(database as never, {
      ownerId: "owner-a",
      leadId: state.lead.id,
      actorType: "SYSTEM",
      source: "GMAIL",
    })).resolves.toEqual(expect.objectContaining({ kind: "changed" }));
    expect(state.activities).toContainEqual(expect.objectContaining({
      type: "STATUS_CHANGED",
      actorType: "SYSTEM",
      source: "GMAIL",
    }));

    state.lead.status = "WON";
    state.activities.length = 0;
    await expect(advanceNewLeadToContactedInTransaction(database as never, {
      ownerId: "owner-a",
      leadId: state.lead.id,
    })).resolves.toEqual(expect.objectContaining({ kind: "unchanged" }));
    expect(state.lead.status).toBe("WON");
    expect(state.activities).toHaveLength(0);
  });

  it("reconciles previously recorded contact evidence on the next Gmail sync", async () => {
    await expect(reconcileContactedLeadStatuses("owner-a"))
      .resolves.toEqual({ changed: 1, hasMore: false });
    expect(state.lead.status).toBe("CONTACTED");
    expect(state.activities).toContainEqual(expect.objectContaining({
      type: "STATUS_CHANGED",
      source: "SYSTEM",
    }));
  });
});
