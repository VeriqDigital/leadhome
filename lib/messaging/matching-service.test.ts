import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret } from "@/lib/inbound-crypto";

const mocks = vi.hoisted(() => {
  const tx = {
    conversation: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    conversationLeadMatchDismissal: {
      createMany: vi.fn(),
    },
  };
  return {
    findLeads: vi.fn(),
    findConversation: vi.fn(),
    findDismissals: vi.fn(),
    transaction: vi.fn(),
    recordActivity: vi.fn(),
    enqueueAnalysis: vi.fn(),
    tx,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findMany: mocks.findLeads },
    conversation: { findFirst: mocks.findConversation },
    conversationLeadMatchDismissal: { findMany: mocks.findDismissals },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/activity-service", () => ({
  recordActivity: mocks.recordActivity,
}));
vi.mock("@/lib/ai/conversation-analysis/job-service", () => ({
  enqueueConversationAnalysisAfterLeadLink: mocks.enqueueAnalysis,
}));

import {
  MAX_MATCH_QUERY_ROWS,
  MAX_POSSIBLE_MATCHES,
  MAX_REEVALUATION_MESSAGES,
  applyConversationLeadMatch,
  dismissConversationLeadMatch,
  evaluateStoredConversationMatch,
  findExistingInboundSubmissionMatch,
  findLeadForConversation,
  normalizeEmailAddresses,
} from "./matching-service";
import type { NormalizedMessage } from "./provider";

type LeadRow = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
};

const lead = (
  id: string,
  name: string,
  email: string | null,
  company: string | null = null,
): LeadRow => ({ id, name, email, company });

const inbound = (
  sender: string,
  options: {
    replyTo?: string;
    externalSubmissionId?: string;
    id?: string;
  } = {},
): NormalizedMessage => ({
  providerMessageId: options.id ?? "message-a",
  direction: "INBOUND",
  sender,
  recipients: ["inbox@leadhome.test"],
  replyTo: options.replyTo,
  externalSubmissionId: options.externalSubmissionId,
  occurredAt: new Date("2026-07-24T12:00:00.000Z"),
});

const outbound = (sender: string): NormalizedMessage => ({
  ...inbound(sender),
  direction: "OUTBOUND",
});

function mockEvidenceRows({
  submissions = [],
  emails = [],
  names = [],
}: {
  submissions?: LeadRow[];
  emails?: LeadRow[];
  names?: LeadRow[];
}) {
  mocks.findLeads.mockImplementation(async (input) => {
    const where = (input as {
      where: {
        inboundSubmissions?: unknown;
        OR?: Array<{ email?: unknown; name?: unknown }>;
      };
    }).where;
    if (where.inboundSubmissions) return submissions;
    if (where.OR?.some((clause) => clause.email)) return emails;
    if (where.OR?.some((clause) => clause.name)) return names;
    return [];
  });
}

function findMatch({
  messages,
  ownerId = "owner-a",
  conversationId = "conversation-a",
  leadId = null,
  manuallyDetached = false,
  accountAddress = "inbox@leadhome.test",
}: {
  messages: NormalizedMessage[];
  ownerId?: string;
  conversationId?: string;
  leadId?: string | null;
  manuallyDetached?: boolean;
  accountAddress?: string | null;
}) {
  return findLeadForConversation({
    ownerId,
    conversation: {
      id: conversationId,
      leadId,
      manuallyDetached,
    },
    messages,
    accountAddress,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEvidenceRows({});
  mocks.findConversation.mockResolvedValue(null);
  mocks.findDismissals.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (callback) => callback(mocks.tx));
  mocks.tx.conversation.findFirst.mockResolvedValue(null);
  mocks.tx.conversation.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.lead.findFirst.mockResolvedValue(null);
  mocks.tx.lead.update.mockResolvedValue({});
  mocks.tx.conversationLeadMatchDismissal.createMany.mockResolvedValue({
    count: 1,
  });
});

describe("Smart Lead Matching", () => {
  it("normalizes display names, casing, arrays, and comma-separated addresses", () => {
    expect(normalizeEmailAddresses([
      " Jane Doe <JANE@Example.COM> ",
      "other@example.com, jane@example.com",
    ])).toEqual(["jane@example.com", "other@example.com"]);
  });

  it("auto-matches one exact owned email with explainable evidence", async () => {
    const jane = lead("lead-a", "Jane Doe", "Jane@Example.com", "Example");
    mockEvidenceRows({ emails: [jane], names: [jane] });

    const result = await findMatch({
      messages: [inbound("Jane Doe <jane@example.com>")],
    });

    expect(result).toMatchObject({
      kind: "MATCHED",
      automaticMatch: {
        leadId: "lead-a",
        confidence: "HIGH",
        reasonCodes: ["EXACT_SENDER_EMAIL", "EXACT_PARTICIPANT_NAME"],
        matchedEvidence: ["EMAIL", "NAME"],
      },
      possibleMatches: [],
      noMatch: null,
      reason: "Exact sender email",
    });
    expect(result.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("suggests a unique website-submission match without auto-attaching it", async () => {
    mockEvidenceRows({
      submissions: [
        lead("lead-submission", "Website Lead", "website@example.com"),
      ],
    });

    const result = await findMatch({
      messages: [inbound("inbox@leadhome.test", {
        externalSubmissionId: "submission-a",
      })],
    });

    expect(result).toMatchObject({
      kind: "AMBIGUOUS",
      automaticMatch: null,
      possibleMatches: [{
        leadId: "lead-submission",
        reasonCodes: ["EXACT_SUBMISSION_ID"],
        matchedEvidence: ["SUBMISSION_ID"],
      }],
    });
  });

  it("keeps conflicting website-submission and participant-email evidence ambiguous", async () => {
    mockEvidenceRows({
      submissions: [
        lead("lead-submission", "Website Lead", "website@example.com"),
      ],
      emails: [
        lead("lead-email", "Email Lead", "person@example.com"),
      ],
    });

    const result = await findMatch({
      messages: [inbound("person@example.com", {
        externalSubmissionId: "submission-a",
      })],
    });

    expect(result.kind).toBe("AMBIGUOUS");
    if (result.kind !== "AMBIGUOUS") throw new Error("Expected ambiguity");
    expect(result.automaticMatch).toBeNull();
    expect(result.possibleMatches.map(({ leadId }) => leadId)).toEqual([
      "lead-submission",
      "lead-email",
    ]);
    expect(result.reason).toBe(
      "Conflicting deterministic identity evidence requires review",
    );
  });

  it("treats duplicate exact emails as ambiguous instead of auto-attaching", async () => {
    mockEvidenceRows({
      emails: [
        lead("lead-b", "Beta Lead", "shared@example.com"),
        lead("lead-a", "Alpha Lead", "SHARED@example.com"),
      ],
    });

    const result = await findMatch({
      messages: [inbound("shared@example.com")],
    });

    expect(result.kind).toBe("AMBIGUOUS");
    if (result.kind !== "AMBIGUOUS") throw new Error("Expected ambiguity");
    expect(result.possibleMatches.map((candidate) => candidate.leadId)).toEqual([
      "lead-a",
      "lead-b",
    ]);
    expect(result.possibleMatches.every((candidate) =>
      candidate.reasonCodes.includes("MULTIPLE_LEADS_SHARE_EMAIL")
    )).toBe(true);
    expect(result.reason).toBe("Multiple leads share this email");
  });

  it("offers an exact participant-name suggestion without auto-attaching", async () => {
    mockEvidenceRows({
      names: [lead("lead-name", "Jane Doe", "other@example.com")],
    });

    const result = await findMatch({
      messages: [inbound("Jane Doe <unknown@example.com>")],
    });

    expect(result).toMatchObject({
      kind: "AMBIGUOUS",
      automaticMatch: null,
      possibleMatches: [{
        leadId: "lead-name",
        confidence: "LOW",
        reasonCodes: ["EXACT_PARTICIPANT_NAME"],
        matchedEvidence: ["NAME"],
      }],
      reason: "Exact participant name",
    });
  });

  it("returns a deterministic top three with normalized-name and stable-id ties", async () => {
    mockEvidenceRows({
      names: [
        lead("lead-d", "Same Name", null),
        lead("lead-b", "Same Name", null),
        lead("lead-c", "Same Name", null),
        lead("lead-a", "Same Name", null),
      ],
    });

    const first = await findMatch({
      messages: [inbound("Same Name <unknown@example.com>")],
    });
    const second = await findMatch({
      messages: [inbound("Same Name <unknown@example.com>")],
    });

    expect(first.kind).toBe("AMBIGUOUS");
    expect(second.kind).toBe("AMBIGUOUS");
    if (first.kind !== "AMBIGUOUS" || second.kind !== "AMBIGUOUS") {
      throw new Error("Expected ambiguity");
    }
    const ids = first.possibleMatches.map((candidate) => candidate.leadId);
    expect(ids).toEqual(["lead-a", "lead-b", "lead-c"]);
    expect(ids).toHaveLength(MAX_POSSIBLE_MATCHES);
    expect(second.possibleMatches.map((candidate) => candidate.leadId))
      .toEqual(ids);
  });

  it("keeps evidence queries owner-scoped, deterministic, and bounded", async () => {
    await findMatch({
      ownerId: "owner-b",
      messages: [inbound("Jane Doe <jane@example.com>", {
        externalSubmissionId: "submission-a",
      })],
    });

    expect(mocks.findLeads).toHaveBeenCalledTimes(3);
    for (const [query] of mocks.findLeads.mock.calls) {
      expect(query).toMatchObject({
        where: { userId: "owner-b" },
        orderBy: { id: "asc" },
        take: MAX_MATCH_QUERY_ROWS,
        select: {
          id: true,
          name: true,
          email: true,
          company: true,
        },
      });
    }
    expect(mocks.findLeads.mock.calls.map(([query]) => query).find((query) =>
      query.where.inboundSubmissions
    )).toMatchObject({
      where: {
        inboundSubmissions: {
          some: {
            idempotencyHash: { in: [hashSecret("submission-a")] },
            source: { userId: "owner-b" },
          },
        },
      },
    });

    await evaluateStoredConversationMatch("owner-b", "conversation-b");
    expect(mocks.findConversation).toHaveBeenCalledWith({
      where: { id: "conversation-b", ownerId: "owner-b" },
      select: expect.objectContaining({
        messages: expect.objectContaining({
          where: { direction: "INBOUND" },
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: MAX_REEVALUATION_MESSAGES,
        }),
      }),
    });
  });

  it("matches a contact sharing the account domain but not its mailbox", async () => {
    const contact = lead("lead-domain", "Jane Acme", "jane@acme.com");
    mockEvidenceRows({ emails: [contact], names: [contact] });

    const result = await findMatch({
      accountAddress: "owner@acme.com",
      messages: [inbound("Jane Acme <jane@acme.com>")],
    });

    expect(result).toMatchObject({
      kind: "MATCHED",
      automaticMatch: { leadId: "lead-domain" },
    });
  });

  it("requires review when sender and reply-to identify different leads", async () => {
    mockEvidenceRows({
      emails: [
        lead("lead-sender", "Sender Person", "sender@example.com"),
        lead("lead-reply", "Reply Person", "reply@example.com"),
      ],
      names: [
        lead("lead-sender", "Sender Person", "sender@example.com"),
        lead("lead-reply", "Reply Person", "reply@example.com"),
      ],
    });

    const result = await findMatch({
      messages: [inbound("Sender Person <sender@example.com>", {
        replyTo: "Reply Person <reply@example.com>",
      })],
    });

    expect(result.kind).toBe("AMBIGUOUS");
    if (result.kind !== "AMBIGUOUS") throw new Error("Expected ambiguity");
    expect(result.reason).toBe(
      "Conflicting deterministic identity evidence requires review",
    );
    expect(result.possibleMatches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        leadId: "lead-sender",
        reasonCodes: expect.arrayContaining(["EXACT_SENDER_EMAIL"]),
      }),
      expect.objectContaining({
        leadId: "lead-reply",
        reasonCodes: expect.arrayContaining(["EXACT_REPLY_TO_EMAIL"]),
      }),
    ]));
  });

  it("scopes dismissals to the exact candidate and evidence fingerprint pair", async () => {
    mockEvidenceRows({
      emails: [
        lead("lead-a", "Alpha", "shared@example.com"),
        lead("lead-b", "Beta", "shared@example.com"),
      ],
    });
    const initial = await findMatch({
      messages: [inbound("shared@example.com")],
    });
    if (initial.kind !== "AMBIGUOUS") throw new Error("Expected ambiguity");
    const alpha = initial.possibleMatches.find(({ leadId }) => leadId === "lead-a")!;
    const beta = initial.possibleMatches.find(({ leadId }) => leadId === "lead-b")!;

    mocks.findDismissals.mockResolvedValue([{
      leadId: alpha.leadId,
      evidenceFingerprint: beta.evidenceFingerprint,
    }]);
    const mismatchedPair = await findMatch({
      messages: [inbound("shared@example.com")],
    });
    expect(mismatchedPair.kind).toBe("AMBIGUOUS");
    if (mismatchedPair.kind !== "AMBIGUOUS") {
      throw new Error("Expected ambiguity");
    }
    expect(mismatchedPair.possibleMatches.map(({ leadId }) => leadId)).toEqual([
      "lead-a",
      "lead-b",
    ]);

    mocks.findDismissals.mockResolvedValue([{
      leadId: alpha.leadId,
      evidenceFingerprint: alpha.evidenceFingerprint,
    }]);
    const exactPair = await findMatch({
      messages: [inbound("shared@example.com")],
    });
    expect(exactPair.kind).toBe("AMBIGUOUS");
    if (exactPair.kind !== "AMBIGUOUS") throw new Error("Expected ambiguity");
    expect(exactPair.possibleMatches.map(({ leadId }) => leadId)).toEqual([
      "lead-b",
    ]);
    expect(mocks.findDismissals).toHaveBeenLastCalledWith({
      where: {
        ownerId: "owner-a",
        conversationId: "conversation-a",
        leadId: { in: ["lead-a", "lead-b"] },
        evidenceFingerprint: {
          in: [alpha.evidenceFingerprint, beta.evidenceFingerprint],
        },
      },
      take: MAX_MATCH_QUERY_ROWS,
      select: { leadId: true, evidenceFingerprint: true },
    });
  });

  it("resurfaces a dismissed candidate when the conversation evidence changes", async () => {
    const jane = lead("lead-a", "Jane Doe", "jane@example.com");
    mockEvidenceRows({ emails: [jane], names: [jane] });
    const initial = await findMatch({
      messages: [inbound("Jane <jane@example.com>")],
    });
    if (initial.kind !== "MATCHED") throw new Error("Expected a match");

    mocks.findDismissals.mockResolvedValue([{
      leadId: "lead-a",
      evidenceFingerprint: initial.automaticMatch.evidenceFingerprint,
    }]);
    const changed = await findMatch({
      messages: [
        inbound("Jane <jane@example.com>", { id: "message-a" }),
        inbound("Jane Doe <jane@example.com>", { id: "message-b" }),
      ],
    });

    expect(changed.kind).toBe("MATCHED");
    if (changed.kind !== "MATCHED") throw new Error("Expected a match");
    expect(changed.automaticMatch.leadId).toBe("lead-a");
    expect(changed.automaticMatch.evidenceFingerprint)
      .not.toBe(initial.automaticMatch.evidenceFingerprint);
  });

  it("preserves existing attachments and manual-detach intent without querying", async () => {
    const existing = await findMatch({
      messages: [inbound("jane@example.com")],
      leadId: "lead-existing",
    });
    const detached = await findMatch({
      messages: [inbound("jane@example.com")],
      manuallyDetached: true,
    });

    expect(existing).toMatchObject({
      kind: "NO_MATCH",
      noMatch: { code: "ALREADY_ATTACHED" },
      reason: "Conversation is already attached",
    });
    expect(detached).toMatchObject({
      kind: "NO_MATCH",
      noMatch: { code: "MANUALLY_DETACHED" },
      reason: "Conversation was manually detached",
    });
    expect(mocks.findLeads).not.toHaveBeenCalled();
    expect(mocks.findDismissals).not.toHaveBeenCalled();
  });

  it("does not overwrite an attachment or manual detach during match application", async () => {
    const jane = lead("lead-a", "Jane Doe", "jane@example.com");
    mockEvidenceRows({ emails: [jane], names: [jane] });
    const match = await findMatch({
      messages: [inbound("Jane Doe <jane@example.com>")],
    });
    if (match.kind !== "MATCHED") throw new Error("Expected a match");

    for (const current of [
      {
        id: "conversation-a",
        leadId: "lead-existing",
        subject: "Existing",
        provider: "GMAIL",
        reviewState: "MATCHED",
        manuallyDetached: false,
        matchKind: "MATCHED",
        matchReason: "Already linked",
        matchCandidateLeadIds: null,
      },
      {
        id: "conversation-a",
        leadId: null,
        subject: "Detached",
        provider: "GMAIL",
        reviewState: "NEEDS_REVIEW",
        manuallyDetached: true,
        matchKind: "NO_MATCH",
        matchReason: "Detached",
        matchCandidateLeadIds: null,
      },
    ]) {
      mocks.tx.conversation.findFirst.mockResolvedValueOnce(current);
      await expect(applyConversationLeadMatch({
        ownerId: "owner-a",
        conversationId: "conversation-a",
        match,
      })).resolves.toMatchObject({ changed: false, attached: false });
    }

    expect(mocks.tx.conversation.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.lead.findFirst).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
    expect(mocks.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it("calculates and dismisses suggestions without creating activity", async () => {
    const jane = lead("lead-a", "Jane Doe", "jane@example.com");
    mockEvidenceRows({ emails: [jane], names: [jane] });
    mocks.findConversation.mockResolvedValue({
      id: "conversation-a",
      leadId: null,
      manuallyDetached: false,
      account: { address: "inbox@leadhome.test" },
      messages: [{
        direction: "INBOUND",
        sender: "Jane Doe <jane@example.com>",
        replyTo: null,
        externalSubmissionId: null,
      }],
    });
    mocks.tx.conversation.findFirst.mockResolvedValue({
      id: "conversation-a",
    });
    mocks.tx.lead.findFirst.mockResolvedValue({ id: "lead-a" });

    const calculated = await evaluateStoredConversationMatch(
      "owner-a",
      "conversation-a",
    );
    expect(calculated?.kind).toBe("MATCHED");
    expect(mocks.recordActivity).not.toHaveBeenCalled();

    const result = await dismissConversationLeadMatch({
      ownerId: "owner-a",
      conversationId: "conversation-a",
      leadId: "lead-a",
    });

    expect(result).toMatchObject({ changed: true, remaining: [] });
    expect(mocks.tx.conversationLeadMatchDismissal.createMany)
      .toHaveBeenCalledWith({
        data: [{
          ownerId: "owner-a",
          conversationId: "conversation-a",
          leadId: "lead-a",
          evidenceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        }],
        skipDuplicates: true,
      });
    expect(mocks.tx.conversation.findFirst).toHaveBeenCalledWith({
      where: {
        id: "conversation-a",
        ownerId: "owner-a",
        leadId: null,
        manuallyDetached: false,
        reviewState: "NEEDS_REVIEW",
      },
      select: { id: true },
    });
    expect(mocks.tx.lead.findFirst).toHaveBeenCalledWith({
      where: { id: "lead-a", userId: "owner-a" },
      select: { id: true },
    });
    expect(mocks.recordActivity).not.toHaveBeenCalled();
    expect(mocks.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it("finds exactly one owner-scoped website submission and bounds ambiguity", async () => {
    mocks.findLeads.mockResolvedValueOnce([{ id: "lead-a" }]);
    await expect(findExistingInboundSubmissionMatch({
      ownerId: "owner-a",
      externalSubmissionId: "contact-12345",
    })).resolves.toBe("lead-a");
    expect(mocks.findLeads).toHaveBeenCalledWith({
      where: {
        userId: "owner-a",
        inboundSubmissions: {
          some: {
            idempotencyHash: hashSecret("contact-12345"),
            source: { userId: "owner-a" },
          },
        },
      },
      orderBy: { id: "asc" },
      take: 2,
      select: { id: true },
    });

    mocks.findLeads.mockResolvedValueOnce([
      { id: "lead-a" },
      { id: "lead-b" },
    ]);
    await expect(findExistingInboundSubmissionMatch({
      ownerId: "owner-a",
      externalSubmissionId: "contact-12345",
    })).resolves.toBeNull();
  });

  it("ignores the account mailbox and outbound-only traffic", async () => {
    const result = await findMatch({
      messages: [
        inbound("inbox@leadhome.test"),
        outbound("prospect@example.com"),
      ],
    });
    expect(result).toMatchObject({
      kind: "NO_MATCH",
      noMatch: { code: "NO_EXTERNAL_IDENTITY" },
    });
    expect(mocks.findLeads).not.toHaveBeenCalled();
  });
});
