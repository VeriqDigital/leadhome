import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  conversationAnalysis: { findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: database }));

import { getConversationAnalysisTaskPrefill } from "./task-prefill";

const analysisId = "cm123456789012345678901234";

const structuredData = {
  summary: "A customer requested a proposal.",
  company: {
    value: null,
    confidence: 0,
    evidenceMessageOrdinals: [],
  },
  contact: {
    name: null,
    email: null,
    phone: null,
    confidence: 0,
    evidenceMessageOrdinals: [],
  },
  projectType: {
    value: "Website redesign",
    confidence: 0.95,
    evidenceMessageOrdinals: [1],
  },
  budget: {
    minimumAmount: null,
    maximumAmount: null,
    currency: null,
    rawText: null,
    confidence: 0,
    evidenceMessageOrdinals: [],
  },
  timeline: {
    targetDate: "2026-08-15",
    rawText: "by August 15",
    confidence: 0.9,
    evidenceMessageOrdinals: [1],
  },
  sentiment: { value: "POSITIVE", confidence: 0.8 },
  actionItems: [
    {
      title: "Send the website proposal",
      description: "Include the requested scope.",
      owner: "USER",
      dueDate: "2026-08-01",
      confidence: 0.95,
      evidenceMessageOrdinals: [1],
    },
  ],
  missingInformation: ["Final budget"],
};

describe("Conversation Intelligence task prefill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("owner-scopes the analysis and returns an editable task prefill", async () => {
    database.conversationAnalysis.findFirst.mockResolvedValue({
      structuredData,
      conversation: { id: "conversation-a", leadId: "lead-a" },
    });

    const result = await getConversationAnalysisTaskPrefill(
      "owner-a",
      analysisId,
      "0",
    );

    expect(database.conversationAnalysis.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: analysisId, ownerId: "owner-a" },
      }),
    );
    expect(result).toMatchObject({
      title: "Send the website proposal",
      description: "Include the requested scope.",
      leadId: "lead-a",
      conversationId: "conversation-a",
      type: "FOLLOW_UP",
      priority: "NORMAL",
    });
    expect(result?.dueAt?.getHours()).toBe(12);
  });

  it("rejects forged IDs, out-of-range indexes, and missing owner rows", async () => {
    await expect(
      getConversationAnalysisTaskPrefill("owner-a", "not-an-id", "0"),
    ).resolves.toBeNull();
    await expect(
      getConversationAnalysisTaskPrefill("owner-a", analysisId, "8"),
    ).resolves.toBeNull();
    expect(database.conversationAnalysis.findFirst).not.toHaveBeenCalled();

    database.conversationAnalysis.findFirst.mockResolvedValue(null);
    await expect(
      getConversationAnalysisTaskPrefill("owner-a", analysisId, "0"),
    ).resolves.toBeNull();
  });

  it("does not prefill from malformed stored output", async () => {
    database.conversationAnalysis.findFirst.mockResolvedValue({
      structuredData: { summary: "not a complete structured analysis" },
      conversation: { id: "conversation-a", leadId: null },
    });
    await expect(
      getConversationAnalysisTaskPrefill("owner-a", analysisId, "0"),
    ).resolves.toBeNull();
  });
});
