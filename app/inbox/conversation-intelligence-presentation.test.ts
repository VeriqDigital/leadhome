import { describe, expect, it, vi } from "vitest";
import type { ConversationAnalysisOutput } from "@/lib/ai/conversation-analysis/schema";
import {
  INITIAL_MISSING_INFORMATION_COUNT,
  SUMMARY_COLLAPSE_LENGTH,
  buildAnalysisNotes,
  copyTextToClipboard,
  formatAnalysisTimeline,
  normalizeAnalysisSummary,
  validEmailHref,
  validPhoneHref,
} from "./conversation-intelligence-presentation";

const output: ConversationAnalysisOutput = {
  summary: " Summary:  Jamie requested   a proposal.\nPlease respond soon. ",
  company: {
    value: "Acme",
    confidence: 0.9,
    evidenceMessageOrdinals: [1],
  },
  contact: {
    name: "Jamie",
    email: "jamie@example.com",
    phone: "+1 (312) 555-0199",
    confidence: 0.9,
    evidenceMessageOrdinals: [1],
  },
  projectType: {
    value: "Website",
    confidence: 0.8,
    evidenceMessageOrdinals: [1],
  },
  budget: {
    minimumAmount: null,
    maximumAmount: null,
    currency: null,
    rawText: "$8,000",
    confidence: 0.8,
    evidenceMessageOrdinals: [1],
  },
  timeline: {
    targetDate: "2026-09-15",
    rawText: "Launch by September 15",
    confidence: 0.8,
    evidenceMessageOrdinals: [1],
  },
  sentiment: { value: "POSITIVE", confidence: 0.8 },
  actionItems: [{
    title: "Send proposal",
    description: "Include the requested scope.",
    owner: "USER",
    dueDate: "2026-08-01",
    confidence: 0.9,
    evidenceMessageOrdinals: [1],
  }],
  missingInformation: ["Final page count", "Brand assets"],
};

describe("Conversation Intelligence completed-state formatting", () => {
  it("normalizes only the presented summary and exposes collapse thresholds", () => {
    expect(normalizeAnalysisSummary(output.summary)).toBe(
      "Jamie requested a proposal. Please respond soon.",
    );
    expect(SUMMARY_COLLAPSE_LENGTH).toBeGreaterThan(200);
    expect(INITIAL_MISSING_INFORMATION_COUNT).toBeGreaterThan(0);
  });

  it("does not duplicate normalized timeline dates", () => {
    expect(formatAnalysisTimeline(output.timeline)).toBe(
      "Launch by September 15, 2026",
    );
    expect(formatAnalysisTimeline({
      ...output.timeline,
      rawText: "Within 30 days",
    })).toBe("Within 30 days");
    expect(formatAnalysisTimeline({
      ...output.timeline,
      rawText: null,
    })).toBe("September 15, 2026");
    expect(formatAnalysisTimeline({
      ...output.timeline,
      rawText: null,
      targetDate: null,
    })).toBeNull();
  });

  it("creates links only for valid contact values and supports partial contacts", () => {
    expect(validEmailHref("jamie@example.com")).toBe(
      "mailto:jamie@example.com",
    );
    expect(validEmailHref("not an email")).toBeNull();
    expect(validPhoneHref("+1 (312) 555-0199")).toBe(
      "tel:+13125550199",
    );
    expect(validPhoneHref("call me")).toBeNull();
    expect(validPhoneHref(null)).toBeNull();
  });

  it("builds readable complete notes without internal metadata", () => {
    const notes = buildAnalysisNotes(output);
    expect(notes).toContain(
      "Summary:\nJamie requested a proposal. Please respond soon.",
    );
    expect(notes).toContain("Contact:\nJamie · jamie@example.com · +1 (312) 555-0199");
    expect(notes).toContain("Timeline:\nLaunch by September 15, 2026");
    expect(notes).toContain("Suggested actions:\n- Send proposal");
    expect(notes).toContain("Information to clarify:\n- Final page count");
    expect(notes).not.toMatch(
      /confidence|evidence|provider|model|token|hash|job/i,
    );
  });

  it("copies the complete value and handles unavailable or failed clipboards", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    await expect(copyTextToClipboard(clipboard, output.summary)).resolves.toBe(
      true,
    );
    expect(clipboard.writeText).toHaveBeenCalledWith(output.summary);
    await expect(copyTextToClipboard(undefined, "text")).resolves.toBe(false);
    await expect(copyTextToClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    }, "text")).resolves.toBe(false);
  });
});
