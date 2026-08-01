/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { recordGmailOutboundContactEvidence } from "./outbound-contact-service";

type LeadRow = { id: string; userId: string; email: string | null };

function harness(leads: LeadRow[] = []) {
  const activities: Record<string, any>[] = [];
  const client = {
    lead: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.email) {
          const wanted = new Set(
            where.email.in.map((email: string) => email.toLowerCase()),
          );
          return leads
            .filter(
              (lead) =>
                lead.userId === where.userId &&
                lead.email &&
                wanted.has(lead.email.toLowerCase()),
            )
            .map(({ id, email }) => ({ id, email }));
        }
        const wanted = new Set(where.id.in);
        return leads
          .filter(
            (lead) => lead.userId === where.userId && wanted.has(lead.id),
          )
          .map(({ id }) => ({ id }));
      }),
    },
    conversation: {
      findMany: vi.fn().mockResolvedValue([
        { id: "conversation-a", leadId: null },
      ]),
    },
    message: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "message-a",
          conversationId: "conversation-a",
          direction: "OUTBOUND",
        },
      ]),
    },
    task: { findMany: vi.fn().mockResolvedValue([]) },
    leadActivity: {
      createMany: vi.fn(async ({ data }: any) => {
        let count = 0;
        for (const activity of data) {
          if (
            activities.some(
              (existing) =>
                existing.userId === activity.userId &&
                existing.idempotencyKey === activity.idempotencyKey,
            )
          ) continue;
          activities.push(activity);
          count++;
        }
        return { count };
      }),
    },
  };
  return { client, activities };
}

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "message-a",
  providerMessageId: "gmail-message-a",
  direction: "OUTBOUND" as const,
  recipients: ["lead@example.com"],
  subject: "Hello",
  receivedAt: new Date("2026-08-01T12:00:00.000Z"),
  ...overrides,
});

const input = (messages = [message()]) => ({
  ownerId: "owner-a",
  accountId: "account-a",
  conversationId: "conversation-a",
  ownedMailboxAddresses: ["owner@example.com"],
  messages,
});

describe("Gmail outbound contact evidence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records one canonical activity for one unique owned lead", async () => {
    const { client, activities } = harness([
      { id: "lead-a", userId: "owner-a", email: "Lead@Example.com" },
    ]);

    await expect(recordGmailOutboundContactEvidence(
      client as never,
      input(),
    )).resolves.toEqual({ created: 1 });
    expect(activities).toEqual([
      expect.objectContaining({
        userId: "owner-a",
        leadId: "lead-a",
        conversationId: "conversation-a",
        messageId: "message-a",
        type: "MESSAGE_SENT",
        actorType: "USER",
        source: "GMAIL",
        title: "Email sent",
      }),
    ]);
  });

  it("is stable across repeated sync processing and retry", async () => {
    const { client, activities } = harness([
      { id: "lead-a", userId: "owner-a", email: "lead@example.com" },
    ]);
    await recordGmailOutboundContactEvidence(client as never, input());
    await recordGmailOutboundContactEvidence(client as never, input());
    expect(activities).toHaveLength(1);
    expect(activities[0]?.idempotencyKey).toMatch(
      /^gmail-outbound-contact:[a-f0-9]{64}$/,
    );
  });

  it.each([
    ["no matching lead", []],
    ["a matching lead owned by someone else", [
      { id: "lead-foreign", userId: "owner-b", email: "lead@example.com" },
    ]],
  ])("creates no activity for %s", async (_label, leads) => {
    const { client, activities } = harness(leads as LeadRow[]);
    await recordGmailOutboundContactEvidence(client as never, input());
    expect(activities).toHaveLength(0);
    expect(client.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "owner-a" }) }),
    );
  });

  it("does not guess when duplicate owned leads share an address", async () => {
    const { client, activities } = harness([
      { id: "lead-a", userId: "owner-a", email: "lead@example.com" },
      { id: "lead-b", userId: "owner-a", email: "LEAD@example.com" },
    ]);
    await recordGmailOutboundContactEvidence(client as never, input());
    expect(activities).toHaveLength(0);
  });

  it("excludes owned mailbox recipients and ignores inbound messages", async () => {
    const { client, activities } = harness([
      { id: "lead-owner", userId: "owner-a", email: "owner@example.com" },
      { id: "lead-alias", userId: "owner-a", email: "alias@example.com" },
      { id: "lead-a", userId: "owner-a", email: "lead@example.com" },
    ]);
    await recordGmailOutboundContactEvidence(client as never, {
      ...input([
        message({ recipients: ["owner@example.com", "alias@example.com"] }),
        message({
          id: "message-inbound",
          providerMessageId: "gmail-inbound",
          direction: "INBOUND",
        }),
      ]),
      ownedMailboxAddresses: ["owner@example.com", "alias@example.com"],
    });
    expect(activities).toHaveLength(0);
  });

  it("records each deterministic lead in a multi-recipient send", async () => {
    const { client, activities } = harness([
      { id: "lead-a", userId: "owner-a", email: "a@example.com" },
      { id: "lead-b", userId: "owner-a", email: "b@example.com" },
      { id: "duplicate-1", userId: "owner-a", email: "dup@example.com" },
      { id: "duplicate-2", userId: "owner-a", email: "dup@example.com" },
    ]);
    await recordGmailOutboundContactEvidence(
      client as never,
      input([message({ recipients: [
        "A@example.com",
        "b@example.com",
        "dup@example.com",
        "malformed",
      ] })]),
    );
    expect(activities.map((activity) => activity.leadId).sort()).toEqual([
      "lead-a",
      "lead-b",
    ]);
    expect(activities.every((activity) => activity.messageId === null)).toBe(true);
    expect(activities.every(
      (activity) => activity.conversationId === "conversation-a",
    )).toBe(true);
  });
});
