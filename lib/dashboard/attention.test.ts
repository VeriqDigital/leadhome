import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  task: { count: vi.fn(), findMany: vi.fn() },
  lead: { count: vi.fn(), findMany: vi.fn() },
  conversation: { count: vi.fn(), findMany: vi.fn() },
}));
const company = vi.hoisted(() => ({ getConversationCompanyView: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: database }));
vi.mock("@/lib/messaging/company-detection-service", () => company);

import {
  ATTENTION_SAMPLE_SIZE,
  COMPANY_REVIEW_SCAN_LIMIT,
  TODAY_WORK_LIMIT,
  getDashboardAttention,
  getInboxAttentionConversationIds,
  matchReviewWhere,
  parseInboxAttention,
  parseLeadAttention,
  untouchedLeadWhere,
} from "./attention";

const now = new Date("2026-07-31T17:00:00.000Z");
const suggestedView = (id: string) => ({
  conversationId: id,
  lead: { id: `lead-${id}`, name: `Lead ${id}`, email: null, company: null },
  state: "SUGGESTED" as const,
  suggestion: {
    value: "Acme",
    source: "BUSINESS_DOMAIN" as const,
    evidenceFingerprint: "a".repeat(64),
    evidenceSummary: "Detected from sender domain",
    evidenceDetails: [],
    automaticEligible: false,
  },
  canRecheck: true,
});

function resetDefaults() {
  database.$queryRaw.mockResolvedValue([]);
  database.task.count.mockResolvedValue(0);
  database.task.findMany.mockResolvedValue([]);
  database.lead.count.mockResolvedValue(0);
  database.lead.findMany.mockResolvedValue([]);
  database.conversation.count.mockResolvedValue(0);
  database.conversation.findMany.mockImplementation(({ where }) => {
    if (where?.matchKind === "AMBIGUOUS") return Promise.resolve([]);
    return Promise.resolve([]);
  });
  company.getConversationCompanyView.mockResolvedValue({
    ...suggestedView("none"),
    state: "NO_SUGGESTION",
    suggestion: null,
  });
}

describe("dashboard attention rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDefaults();
  });

  it("uses owner-scoped canonical untouched-lead exclusions", () => {
    expect(untouchedLeadWhere("owner-a")).toEqual({
      userId: "owner-a",
      status: "NEW",
      conversations: {
        none: {
          ownerId: "owner-a",
          messages: {
            some: { ownerId: "owner-a", direction: "OUTBOUND" },
          },
        },
      },
      activities: {
        none: { userId: "owner-a", type: "MESSAGE_SENT" },
      },
    });
  });

  it("counts only open tasks already past the canonical current-time boundary", async () => {
    await getDashboardAttention("owner-a", now);
    expect(database.task.count).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-a",
        status: "OPEN",
        dueAt: { lt: now },
      },
    });
    expect(database.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: "owner-a",
          status: "OPEN",
        }),
      }),
    );
  });

  it("includes only active ambiguous matches not attached or manually detached", () => {
    expect(matchReviewWhere("owner-a")).toEqual({
      ownerId: "owner-a",
      leadId: null,
      manuallyDetached: false,
      status: "OPEN",
      reviewState: "NEEDS_REVIEW",
      matchKind: "AMBIGUOUS",
    });
  });

  it("queries only active classified attached conversations whose latest message is inbound", async () => {
    await getDashboardAttention("owner-a", now);
    const sql = database.$queryRaw.mock.calls[0][0];
    const text = sql.strings.join("?");

    expect(sql.values).toContain("owner-a");
    expect(text).toContain('c."status" = \'OPEN\'');
    expect(text).toContain('c."reviewState" NOT IN');
    expect(text).toContain("'LEAD'");
    expect(text).toContain("'CUSTOMER'");
    expect(text).toContain("latest.\"direction\" = 'INBOUND'");
    expect(text).toContain('ORDER BY m."receivedAt" DESC, m."id" DESC');
  });

  it("aggregates categories in stable priority order and bounds today's work", async () => {
    database.$queryRaw.mockResolvedValue([
      {
        id: "conversation-a",
        subject: "Need help",
        lastMessageAt: new Date("2026-07-31T12:00:00.000Z"),
        leadId: "lead-a",
        leadName: "Alice",
        company: "Acme",
        sender: "alice@acme.test",
        totalCount: BigInt(3),
      },
    ]);
    database.task.count.mockResolvedValue(2);
    database.task.findMany.mockResolvedValue([
      {
        id: "task-a",
        title: "Call Alice",
        dueAt: new Date("2026-07-30T12:00:00.000Z"),
        lead: { id: "lead-a", name: "Alice", company: "Acme" },
        conversation: null,
      },
    ]);
    database.lead.count.mockResolvedValue(4);
    database.lead.findMany.mockResolvedValue([
      {
        id: "lead-b",
        name: "Bob",
        company: null,
        email: "bob@example.test",
        source: "MANUAL",
        createdAt: new Date("2026-07-30T10:00:00.000Z"),
      },
    ]);
    database.conversation.count.mockResolvedValue(2);
    database.conversation.findMany.mockImplementation(({ where }) =>
      where?.matchKind === "AMBIGUOUS"
        ? Promise.resolve([
            { id: "match-a", subject: "Hello", lastMessageAt: now },
          ])
        : Promise.resolve([
            { id: "company-a", subject: "Company", lastMessageAt: now },
          ]),
    );
    company.getConversationCompanyView.mockResolvedValue(
      suggestedView("company-a"),
    );

    const result = await getDashboardAttention("owner-a", now);

    expect(result.categories.map((category) => category.key)).toEqual([
      "AWAITING_RESPONSE",
      "OVERDUE_WORK",
      "UNTOUCHED_LEADS",
      "MATCH_REVIEW",
      "COMPANY_REVIEW",
    ]);
    expect(result.categories.map((category) => category.count)).toEqual([
      3, 2, 4, 2, 1,
    ]);
    expect(result.workItems.length).toBeLessThanOrEqual(TODAY_WORK_LIMIT);
    expect(result.workItems.map((item) => item.href)).toEqual(
      expect.arrayContaining([
        "/inbox?attention=awaiting-response&conversation=conversation-a",
        "/tasks/task-a/edit",
        "/leads/lead-b",
        "/inbox?attention=match-review&conversation=match-a",
        "/inbox?attention=company-review&conversation=company-a",
      ]),
    );
    expect(result.caughtUp).toBe(false);
    expect(result.totalCountIsLowerBound).toBe(false);
  });

  it("counts only canonical visible company suggestions and marks a bounded lower bound", async () => {
    database.conversation.findMany.mockImplementation(({ where }) =>
      where?.matchKind === "AMBIGUOUS"
        ? Promise.resolve([])
        : Promise.resolve(
            Array.from(
              { length: COMPANY_REVIEW_SCAN_LIMIT + 1 },
              (_, index) => ({
                id: `company-${index}`,
                subject: null,
                lastMessageAt: now,
              }),
            ),
          ),
    );
    company.getConversationCompanyView.mockImplementation(
      (_ownerId, id: string) =>
        Promise.resolve(
          id.endsWith("0")
            ? suggestedView(id)
            : {
                ...suggestedView(id),
                state: "NO_SUGGESTION",
                suggestion: null,
              },
        ),
    );

    const result = await getDashboardAttention("owner-a", now);
    const category = result.categories.find(
      (item) => item.key === "COMPANY_REVIEW",
    );

    expect(category).toEqual(
      expect.objectContaining({ count: 10, countIsLowerBound: true }),
    );
    expect(result.totalCountIsLowerBound).toBe(true);
    expect(company.getConversationCompanyView).toHaveBeenCalledTimes(
      COMPANY_REVIEW_SCAN_LIMIT,
    );
    const candidateQuery = database.conversation.findMany.mock.calls.find(
      ([query]) => query.where?.leadId?.not === null,
    )?.[0];
    expect(candidateQuery.where).toEqual(
      expect.objectContaining({
        ownerId: "owner-a",
        leadId: { not: null },
        lead: { is: { userId: "owner-a", company: null } },
        status: "OPEN",
        reviewState: { notIn: ["IGNORED", "RESOLVED"] },
      }),
    );
  });

  it("returns the positive zero state when no category needs action", async () => {
    const result = await getDashboardAttention("owner-a", now);
    expect(result.totalCount).toBe(0);
    expect(result.totalCountIsLowerBound).toBe(false);
    expect(result.workItems).toEqual([]);
    expect(result.caughtUp).toBe(true);
  });

  it("uses exact bookmarkable filter parsing and rejects invalid values", () => {
    expect(parseInboxAttention("awaiting-response")).toBe("awaiting-response");
    expect(parseInboxAttention("invalid")).toBeUndefined();
    expect(parseLeadAttention("untouched")).toBe("untouched");
    expect(parseLeadAttention("invalid")).toBeUndefined();
  });

  it("keeps destination ID queries owner-scoped and bounded", async () => {
    database.conversation.findMany.mockResolvedValue([
      { id: "conversation-a" },
    ]);
    await expect(
      getInboxAttentionConversationIds("owner-a", "match-review"),
    ).resolves.toEqual(["conversation-a"]);
    expect(database.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: matchReviewWhere("owner-a"),
        take: 500,
      }),
    );
  });

  it("uses bounded samples for every dashboard list", async () => {
    await getDashboardAttention("owner-a", now);
    expect(database.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: ATTENTION_SAMPLE_SIZE }),
    );
    expect(database.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: ATTENTION_SAMPLE_SIZE }),
    );
  });
});
