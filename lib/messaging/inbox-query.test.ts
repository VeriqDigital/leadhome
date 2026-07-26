import { beforeEach, describe, expect, it, vi } from "vitest";
import { INBOX_PAGE_SIZE, getConversationDetail, listConversationSummaries } from "./inbox-query";

const database = vi.hoisted(() => ({
  conversation: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: database }));

const row = (id: string, date: Date) => ({
  id, provider: "GMAIL", subject: `Subject ${id}`, status: "OPEN",
  classification: "UNKNOWN", reviewState: "NEEDS_REVIEW", lastMessageAt: date,
  lead: null,
  messages: [{ sender: "sender@example.com", bodyText: "A full body that becomes a bounded preview", direction: "INBOUND" }],
});

describe("inbox queries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requests only one bounded page with a narrow latest-message selection", async () => {
    database.conversation.findMany.mockResolvedValue([row("one", new Date())]);
    const result = await listConversationSummaries("owner-a", { page: 1 });
    const query = database.conversation.findMany.mock.calls[0][0];
    expect(query.where.ownerId).toBe("owner-a");
    expect(query.take).toBe(INBOX_PAGE_SIZE + 1);
    expect(query.select.messages.take).toBe(1);
    expect(query.select.messages.select).not.toHaveProperty("bodyHtml");
    expect(result.items[0]).not.toHaveProperty("messages");
  });

  it("uses stable newest-first ordering and detects the next page without returning the lookahead", async () => {
    database.conversation.findMany.mockResolvedValue(
      Array.from({ length: INBOX_PAGE_SIZE + 1 }, (_, index) => row(String(index), new Date(1000 - index))),
    );
    const result = await listConversationSummaries("owner-a", { page: 2 });
    const query = database.conversation.findMany.mock.calls[0][0];
    expect(query.orderBy).toEqual([{ lastMessageAt: "desc" }, { id: "desc" }]);
    expect(query.skip).toBe(INBOX_PAGE_SIZE);
    expect(result.items).toHaveLength(INBOX_PAGE_SIZE);
    expect(result.hasNext).toBe(true);
    expect(result.hasPrevious).toBe(true);
  });

  it("combines owner-scoped search and filters", async () => {
    database.conversation.findMany.mockResolvedValue([]);
    await listConversationSummaries("owner-a", {
      page: 1, query: "smith", reviewState: "NEEDS_REVIEW",
      classification: "LEAD", status: "OPEN", provider: "GMAIL", attachment: "attached",
    });
    expect(database.conversation.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({
      ownerId: "owner-a", reviewState: "NEEDS_REVIEW", classification: "LEAD",
      status: "OPEN", provider: "GMAIL", leadId: { not: null },
    }));
  });

  it("owner-scopes detail and orders only its messages chronologically", async () => {
    database.conversation.findFirst.mockResolvedValue(null);
    await expect(getConversationDetail("owner-a", "conversation-b")).resolves.toBeNull();
    const query = database.conversation.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: "conversation-b", ownerId: "owner-a" });
    expect(query.select.messages.orderBy).toEqual([{ receivedAt: "asc" }, { id: "asc" }]);
  });
});
