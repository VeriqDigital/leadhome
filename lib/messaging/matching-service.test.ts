import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret } from "@/lib/inbound-crypto";

const mocks = vi.hoisted(() => ({
  findLeads: vi.fn(),
  findSubmission: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findMany: mocks.findLeads },
    inboundSubmission: { findFirst: mocks.findSubmission },
  },
}));

import {
  findLeadForConversation,
  normalizeEmailAddresses,
} from "./matching-service";
import type { NormalizedMessage } from "./provider";

const inbound = (
  sender: string,
  replyTo?: string,
): NormalizedMessage => ({
  providerMessageId: "message-a",
  direction: "INBOUND",
  sender,
  recipients: ["inbox@leadhome.test"],
  replyTo,
  occurredAt: new Date("2026-07-24T12:00:00.000Z"),
});

const match = (
  messages: NormalizedMessage[],
  conversation: { leadId: string | null; manuallyDetached: boolean } = {
    leadId: null,
    manuallyDetached: false,
  },
) =>
  findLeadForConversation({
    ownerId: "owner-a",
    conversation,
    messages,
    accountAddress: "inbox@leadhome.test",
  });

beforeEach(() => {
  mocks.findLeads.mockResolvedValue([]);
  mocks.findSubmission.mockResolvedValue(null);
});

describe("deterministic lead matching", () => {
  it("normalizes display names, casing, arrays, and comma-separated addresses", () => {
    expect(normalizeEmailAddresses([
      " Jane Doe <JANE@Example.COM> ",
      "other@example.com, jane@example.com",
    ])).toEqual(["jane@example.com", "other@example.com"]);
  });

  it("matches exactly one owned lead by sender email", async () => {
    mocks.findLeads.mockResolvedValue([
      { id: "lead-a", email: "Jane@Example.com" },
    ]);
    await expect(match([inbound("Jane Doe <jane@example.com>")])).resolves.toEqual({
      kind: "MATCHED",
      leadId: "lead-a",
      confidence: "HIGH",
      reason: "exact sender email matched one lead",
    });
    expect(mocks.findLeads).toHaveBeenCalledWith({
      where: { userId: "owner-a", email: { not: null } },
      select: { id: true, email: true },
    });
  });

  it("prefers an exact reply-to address", async () => {
    mocks.findLeads.mockResolvedValue([
      { id: "lead-a", email: "customer@example.com" },
    ]);
    await expect(
      match([inbound("notifications@example.test", "Customer <customer@example.com>")]),
    ).resolves.toEqual(expect.objectContaining({
      kind: "MATCHED",
      leadId: "lead-a",
      reason: "exact reply-to email matched one lead",
    }));
  });

  it("returns ambiguous when multiple owned leads share the address", async () => {
    mocks.findLeads.mockResolvedValue([
      { id: "lead-a", email: "shared@example.com" },
      { id: "lead-b", email: "SHARED@example.com" },
    ]);
    await expect(match([inbound("shared@example.com")])).resolves.toEqual({
      kind: "AMBIGUOUS",
      candidateLeadIds: ["lead-a", "lead-b"],
      reason: "multiple leads share an external participant email",
    });
  });

  it("does not match internal senders or outbound-only conversations", async () => {
    mocks.findLeads.mockResolvedValue([
      { id: "lead-a", email: "ops@leadhome.test" },
    ]);
    await expect(match([inbound("ops@leadhome.test")])).resolves.toEqual({
      kind: "NO_MATCH",
      reason: "no external participant matched",
    });
    expect(mocks.findLeads).not.toHaveBeenCalled();
  });

  it("retains an existing attachment and honors manual detach intent", async () => {
    await expect(match([], {
      leadId: "lead-existing",
      manuallyDetached: false,
    })).resolves.toEqual(expect.objectContaining({
      kind: "MATCHED",
      leadId: "lead-existing",
      reason: "conversation already attached",
    }));
    await expect(match([], {
      leadId: null,
      manuallyDetached: true,
    })).resolves.toEqual({
      kind: "NO_MATCH",
      reason: "conversation was manually detached",
    });
  });

  it("matches a website lead through its durable external submission ID", async () => {
    mocks.findSubmission.mockResolvedValue({ leadId: "website-lead" });
    const message = {
      ...inbound("forms@website.test"),
      externalSubmissionId: "contact-12345",
    };
    await expect(match([message])).resolves.toEqual({
      kind: "MATCHED",
      leadId: "website-lead",
      confidence: "HIGH",
      reason: "external submission ID matched a website lead",
    });
    expect(mocks.findSubmission).toHaveBeenCalledWith({
      where: {
        idempotencyHash: hashSecret("contact-12345"),
        source: { userId: "owner-a" },
      },
      select: { leadId: true },
    });
  });
});
