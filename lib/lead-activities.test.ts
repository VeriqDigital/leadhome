import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: { leadActivity: { findMany: mocks.findMany } },
}));

import {
  buildLeadUpdateActivities,
  getLeadActivitiesForUser,
} from "@/lib/lead-activities";

const base = {
  name: "Jane Doe",
  email: "jane@example.com",
  phone: "555-0100",
  company: "Acme",
  source: "MANUAL" as const,
  status: "NEW" as const,
  message: "Original notes",
  estimatedValue: 3500,
  nextFollowUpDate: null,
};

describe("lead activity changes", () => {
  it("creates separate status and estimated-value activities", () => {
    const activities = buildLeadUpdateActivities(base, {
      ...base,
      status: "CONTACTED",
      estimatedValue: 7500,
    });

    expect(activities).toEqual([
      expect.objectContaining({
        type: "STATUS_CHANGED",
        description: "New → Contacted",
        metadata: { from: "NEW", to: "CONTACTED" },
      }),
      expect.objectContaining({
        type: "ESTIMATED_VALUE_CHANGED",
        description: "$3,500 → $7,500",
        metadata: { from: 3500, to: 7500 },
      }),
    ]);
  });

  it("uses the correct scheduled, rescheduled, and cleared follow-up events", () => {
    const first = new Date("2026-08-01T12:00:00.000Z");
    const second = new Date("2026-08-05T12:00:00.000Z");

    expect(buildLeadUpdateActivities(base, { ...base, nextFollowUpDate: first })[0].title)
      .toBe("Follow-up scheduled");
    expect(buildLeadUpdateActivities(
      { ...base, nextFollowUpDate: first },
      { ...base, nextFollowUpDate: second },
    )[0].title).toBe("Follow-up rescheduled");
    expect(buildLeadUpdateActivities(
      { ...base, nextFollowUpDate: first },
      base,
    )[0].title).toBe("Follow-up cleared");
  });

  it("groups changed contact fields into one activity", () => {
    const activities = buildLeadUpdateActivities(base, {
      ...base,
      name: "Jane Smith",
      email: "smith@example.com",
      phone: null,
    });

    expect(activities).toHaveLength(1);
    expect(activities[0]).toEqual(expect.objectContaining({
      type: "CONTACT_INFO_CHANGED",
      metadata: {
        name: { from: "Jane Doe", to: "Jane Smith" },
        email: { from: "jane@example.com", to: "smith@example.com" },
        phone: { from: "555-0100", to: null },
      },
    }));
  });

  it("creates no timeline noise when tracked values are unchanged", () => {
    expect(buildLeadUpdateActivities(base, { ...base })).toEqual([]);
  });

  it("creates all appropriate categories without copying note bodies", () => {
    const activities = buildLeadUpdateActivities(base, {
      ...base,
      company: "Veriq",
      message: "Short",
      source: "PHONE",
    });

    expect(activities.map(({ type }) => type)).toEqual([
      "COMPANY_CHANGED",
      "NOTES_CHANGED",
      "SOURCE_CHANGED",
    ]);
    expect(activities[1].metadata).toEqual({
      previousLength: 14,
      nextLength: 5,
    });
    expect(JSON.stringify(activities[1])).not.toContain("Original notes");
  });
});

describe("activity data access", () => {
  beforeEach(() => mocks.findMany.mockResolvedValue([]));

  it("scopes activities to both the user and their lead and orders newest first", async () => {
    await getLeadActivitiesForUser({
      leadId: "lead-a",
      userId: "user-a",
      limit: 50,
    });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { leadId: "lead-a", userId: "user-a", lead: { userId: "user-a" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        createdAt: true,
      },
    });
  });
});
