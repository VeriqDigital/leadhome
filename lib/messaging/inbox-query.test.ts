import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INBOX_PAGE_SIZE,
  conversationMessageDate,
  getConversationDetail,
  listConversationSummaries,
} from "./inbox-query";

const database = vi.hoisted(() => ({
  conversation: { findMany: vi.fn(), findFirst: vi.fn() },
}));
const attention = vi.hoisted(() => ({
  getInboxAttentionConversationIds: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: database }));
vi.mock("@/lib/dashboard/attention", () => attention);

const row = (id: string, date: Date | null, messageDate = date ?? new Date()) => ({
  id, provider: "GMAIL", subject: `Subject ${id}`, status: "OPEN",
  classification: "UNKNOWN", reviewState: "NEEDS_REVIEW", matchKind: null,
  lastMessageAt: date,
  lead: null,
  messages: [{ sender: "sender@example.com", bodyText: "A full body that becomes a bounded preview", direction: "INBOUND", receivedAt: messageDate }],
});

describe("inbox queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attention.getInboxAttentionConversationIds.mockResolvedValue([]);
  });

  it("requests only one bounded page with a narrow latest-message selection", async () => {
    database.conversation.findMany.mockResolvedValue([row("one", new Date())]);
    const result = await listConversationSummaries("owner-a", { page: 1 });
    const query = database.conversation.findMany.mock.calls[0][0];
    expect(query.where.ownerId).toBe("owner-a");
    expect(query.take).toBe(INBOX_PAGE_SIZE + 1);
    expect(query.select.matchKind).toBe(true);
    expect(query.select.lead.select).toEqual({
      id: true,
      name: true,
      email: true,
      company: true,
    });
    expect(query.select.messages.take).toBe(1);
    expect(query.select.messages.select).not.toHaveProperty("bodyHtml");
    expect(result.items[0]).not.toHaveProperty("messages");
  });

  it("returns cached possible-match state for the bounded Inbox row badge", async () => {
    database.conversation.findMany.mockResolvedValue([
      { ...row("possible", new Date()), matchKind: "AMBIGUOUS" },
    ]);

    const result = await listConversationSummaries("owner-a", { page: 1 });

    expect(result.items[0]).toEqual(expect.objectContaining({
      id: "possible",
      matchKind: "AMBIGUOUS",
      lead: null,
    }));
  });

  it("uses stable newest-first ordering and detects the next page without returning the lookahead", async () => {
    database.conversation.findMany.mockResolvedValue(
      Array.from({ length: INBOX_PAGE_SIZE + 1 }, (_, index) => row(String(index), new Date(1000 - index))),
    );
    const result = await listConversationSummaries("owner-a", { page: 2 });
    const query = database.conversation.findMany.mock.calls[0][0];
    expect(query.orderBy).toEqual([
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ]);
    expect(query.skip).toBe(INBOX_PAGE_SIZE);
    expect(result.items).toHaveLength(INBOX_PAGE_SIZE);
    expect(result.hasNext).toBe(true);
    expect(result.hasPrevious).toBe(true);
  });

  it("requests null timestamps last and exposes the newest-message date as a fallback", async () => {
    const newestMessage = new Date("2026-07-13T14:00:00.000Z");
    database.conversation.findMany.mockResolvedValue([
      row("dated", new Date("2026-07-14T14:00:00.000Z")),
      row("missing-date", null, newestMessage),
    ]);
    const result = await listConversationSummaries("owner-a", { page: 1 });
    expect(result.items[1].latestMessage?.receivedAt).toEqual(newestMessage);
  });

  it("uses descending IDs as a stable equal-timestamp tie-breaker", async () => {
    database.conversation.findMany.mockResolvedValue([]);
    await listConversationSummaries("owner-a", { page: 1 });
    expect(database.conversation.findMany.mock.calls[0][0].orderBy[1]).toEqual({
      id: "desc",
    });
  });

  it("returns no display date for conversations that truly have no messages", () => {
    expect(conversationMessageDate({
      lastMessageAt: null,
      latestMessage: null,
    })).toBeNull();
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

  it("applies bookmarkable attention IDs without weakening owner scope", async () => {
    attention.getInboxAttentionConversationIds.mockResolvedValue([
      "conversation-a",
    ]);
    database.conversation.findMany.mockResolvedValue([]);

    await listConversationSummaries("owner-a", {
      page: 1,
      attention: "awaiting-response",
    });

    expect(attention.getInboxAttentionConversationIds).toHaveBeenCalledWith(
      "owner-a",
      "awaiting-response",
    );
    expect(database.conversation.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        ownerId: "owner-a",
        id: { in: ["conversation-a"] },
      }),
    );
  });

  it("owner-scopes detail and orders only its messages chronologically", async () => {
    database.conversation.findFirst.mockResolvedValue(null);
    await expect(getConversationDetail("owner-a", "conversation-b")).resolves.toBeNull();
    const query = database.conversation.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: "conversation-b", ownerId: "owner-a" });
    expect(query.select.lead.select.company).toBe(true);
    expect(query.select.messages.orderBy).toEqual([{ receivedAt: "asc" }, { id: "asc" }]);
  });
});
