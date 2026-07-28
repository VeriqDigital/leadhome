import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  lead: { findFirst: vi.fn() },
  leadActivity: { findFirst: vi.fn(), findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: database }));

import {
  ACTIVITY_PAGE_SIZE,
  DASHBOARD_ACTIVITY_TYPES,
  getDashboardRecentActivities,
  getLeadActivityPage,
  recordActivity,
} from "./activity-service";

function client(overrides: Record<string, unknown> = {}) {
  return {
    lead: { findMany: vi.fn().mockResolvedValue([{ id: "lead-a" }]) },
    conversation: {
      findMany: vi.fn().mockResolvedValue([
        { id: "conversation-a", leadId: "lead-a" },
      ]),
    },
    task: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "task-a",
          leadId: "lead-a",
          conversationId: "conversation-a",
        },
      ]),
    },
    message: {
      findMany: vi.fn().mockResolvedValue([
        { id: "message-a", conversationId: "conversation-a" },
      ]),
    },
    leadActivity: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  database.lead.findFirst.mockResolvedValue({ id: "lead-a" });
  database.leadActivity.findFirst.mockResolvedValue(null);
  database.leadActivity.findMany.mockResolvedValue([]);
});

describe("unified activity recording", () => {
  it("validates typed owner relationships and stores a structured event", async () => {
    const tx = client();
    await expect(recordActivity(tx as never, {
      ownerId: "owner-a",
      leadId: "lead-a",
      conversationId: "conversation-a",
      messageId: "message-a",
      taskId: "task-a",
      type: "MESSAGE_RECEIVED",
      actorType: "CONTACT",
      source: "GMAIL",
      title: "  New email   received ",
      description: "  Project update  ",
      occurredAt: new Date("2026-07-27T12:00:00.000Z"),
      idempotencyKey: "message:message-a:inbound",
    })).resolves.toEqual({ created: true });

    expect(tx.lead.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["lead-a"] }, userId: "owner-a" },
      select: { id: true },
    });
    expect(tx.leadActivity.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        userId: "owner-a",
        title: "New email received",
        description: "Project update",
        actorType: "CONTACT",
        source: "GMAIL",
      })],
      skipDuplicates: true,
    });
  });

  it("rejects missing and cross-owner relationships before writing", async () => {
    const tx = client({
      lead: { findMany: vi.fn().mockResolvedValue([]) },
    });
    await expect(recordActivity(tx as never, {
      ownerId: "owner-a",
      leadId: "foreign-lead",
      type: "LEAD_CREATED",
      actorType: "USER",
      source: "MANUAL",
      title: "Lead created",
    })).rejects.toThrow("not found for this owner");
    expect(tx.leadActivity.createMany).not.toHaveBeenCalled();
  });

  it("rejects a message linked to another conversation", async () => {
    const tx = client({
      message: {
        findMany: vi.fn().mockResolvedValue([
          { id: "message-a", conversationId: "conversation-b" },
        ]),
      },
    });
    await expect(recordActivity(tx as never, {
      ownerId: "owner-a",
      conversationId: "conversation-a",
      messageId: "message-a",
      type: "MESSAGE_RECEIVED",
      actorType: "CONTACT",
      source: "GMAIL",
      title: "New email received",
    })).rejects.toThrow("does not belong to its conversation");
  });

  it("rejects a message and conversation linked to another lead", async () => {
    const tx = client({
      conversation: {
        findMany: vi.fn().mockResolvedValue([
          { id: "conversation-a", leadId: "lead-b" },
        ]),
      },
    });
    await expect(recordActivity(tx as never, {
      ownerId: "owner-a",
      leadId: "lead-a",
      conversationId: "conversation-a",
      messageId: "message-a",
      type: "MESSAGE_RECEIVED",
      actorType: "CONTACT",
      source: "GMAIL",
      title: "New email received",
    })).rejects.toThrow("does not belong to its lead");
    expect(tx.leadActivity.createMany).not.toHaveBeenCalled();
  });

  it("reports an idempotent conflict without creating a duplicate", async () => {
    const tx = client({
      leadActivity: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    await expect(recordActivity(tx as never, {
      ownerId: "owner-a",
      leadId: "lead-a",
      type: "WEBSITE_SUBMISSION_RECEIVED",
      actorType: "CONTACT",
      source: "WEBSITE",
      title: "Website lead created",
      idempotencyKey: "website:source-a:key-a",
    })).resolves.toEqual({ created: false });
  });
});

describe("unified activity queries", () => {
  const row = (index: number) => ({
    id: `activity-${String(index).padStart(2, "0")}`,
    type: "LEAD_CREATED",
    actorType: "USER",
    source: "MANUAL",
    title: `Activity ${index}`,
    description: null,
    metadata: null,
    occurredAt: new Date("2026-07-27T12:00:00.000Z"),
    lead: { id: "lead-a", name: "Acme" },
    conversation: null,
    task: null,
  });

  it("returns stable owner-scoped cursor pages with equal-time tie-breaking", async () => {
    database.leadActivity.findMany.mockResolvedValue(
      Array.from({ length: ACTIVITY_PAGE_SIZE + 1 }, (_, index) => row(index)),
    );
    const page = await getLeadActivityPage({
      ownerId: "owner-a",
      leadId: "lead-a",
    });
    expect(page?.items).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(page?.nextCursor).toBe("activity-19");
    expect(database.leadActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "owner-a", leadId: "lead-a" },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: ACTIVITY_PAGE_SIZE + 1,
      }),
    );
  });

  it("fails closed for another lead or owner's cursor", async () => {
    database.leadActivity.findFirst.mockResolvedValue(null);
    await expect(getLeadActivityPage({
      ownerId: "owner-a",
      leadId: "lead-a",
      cursor: "foreign-cursor",
    })).resolves.toBeNull();
    expect(database.leadActivity.findMany).not.toHaveBeenCalled();
  });

  it("uses a bounded meaningful owner-scoped dashboard query", async () => {
    database.leadActivity.findMany.mockResolvedValue([row(1)]);
    await expect(getDashboardRecentActivities("owner-a", 8)).resolves.toHaveLength(1);
    expect(database.leadActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "owner-a",
          type: { in: DASHBOARD_ACTIVITY_TYPES },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 8,
      }),
    );
  });
});
