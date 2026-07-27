import { describe, expect, it } from "vitest";
import {
  conversationAnalysisOutputSchema,
  parseConversationAnalysisOutput,
} from "./schema";

function validAnalysis() {
  return {
    summary:
      "A prospect asked about a website redesign. They want a proposal after the scope is clarified.",
    company: {
      value: "Northwind Studio",
      confidence: 0.95,
      evidenceMessageOrdinals: [1],
    },
    contact: {
      name: "Alex Rivera",
      email: "alex@example.com",
      phone: null,
      confidence: 0.9,
      evidenceMessageOrdinals: [1],
    },
    projectType: {
      value: "Website redesign",
      confidence: 0.98,
      evidenceMessageOrdinals: [1],
    },
    budget: {
      minimumAmount: 10_000,
      maximumAmount: 15_000,
      currency: "USD",
      rawText: "$10,000-$15,000",
      confidence: 0.99,
      evidenceMessageOrdinals: [2],
    },
    timeline: {
      targetDate: "2026-09-15",
      rawText: "by September 15",
      confidence: 0.92,
      evidenceMessageOrdinals: [2],
    },
    sentiment: {
      value: "POSITIVE" as const,
      confidence: 0.8,
    },
    actionItems: [
      {
        title: "Send a scoped proposal",
        description: "Include the redesign phases discussed in the thread.",
        owner: "USER" as const,
        dueDate: "2026-08-01",
        confidence: 0.9,
        evidenceMessageOrdinals: [2],
      },
    ],
    missingInformation: ["Final page count"],
  };
}

describe("conversation analysis structured output", () => {
  it("accepts bounded supported details and nullable unknown values", () => {
    const fixture = validAnalysis();
    fixture.contact.phone = null;

    expect(parseConversationAnalysisOutput(fixture, 2)).toEqual(fixture);
  });

  it("rejects evidence ordinals outside the supplied messages", () => {
    const fixture = validAnalysis();
    fixture.actionItems[0].evidenceMessageOrdinals = [3];

    expect(() => parseConversationAnalysisOutput(fixture, 2)).toThrow(
      "Evidence references a message outside the supplied input.",
    );
  });

  it("rejects unbounded evidence, actions, missing information, and text", () => {
    const tooMuchEvidence = validAnalysis();
    tooMuchEvidence.company.evidenceMessageOrdinals = Array.from(
      { length: 21 },
      (_, index) => index + 1,
    );
    expect(conversationAnalysisOutputSchema.safeParse(tooMuchEvidence).success)
      .toBe(false);

    const tooManyActions = validAnalysis();
    tooManyActions.actionItems = Array.from(
      { length: 9 },
      () => ({ ...validAnalysis().actionItems[0] }),
    );
    expect(conversationAnalysisOutputSchema.safeParse(tooManyActions).success)
      .toBe(false);

    const tooManyMissing = validAnalysis();
    tooManyMissing.missingInformation = Array.from(
      { length: 13 },
      (_, index) => `Missing ${index}`,
    );
    expect(conversationAnalysisOutputSchema.safeParse(tooManyMissing).success)
      .toBe(false);

    const longSummary = validAnalysis();
    longSummary.summary = "x".repeat(1_601);
    expect(conversationAnalysisOutputSchema.safeParse(longSummary).success)
      .toBe(false);
  });

  it("rejects unsupported fields, invalid confidence, dates, and budget ranges", () => {
    expect(conversationAnalysisOutputSchema.safeParse({
      ...validAnalysis(),
      closeProbability: 0.9,
    }).success).toBe(false);

    const nestedExtra = validAnalysis();
    expect(conversationAnalysisOutputSchema.safeParse({
      ...nestedExtra,
      company: { ...nestedExtra.company, industry: "Technology" },
    }).success).toBe(false);

    const invalidConfidence = validAnalysis();
    invalidConfidence.company.confidence = 1.01;
    expect(
      conversationAnalysisOutputSchema.safeParse(invalidConfidence).success,
    ).toBe(false);

    const invalidDate = validAnalysis();
    invalidDate.timeline.targetDate = "September 15";
    expect(conversationAnalysisOutputSchema.safeParse(invalidDate).success)
      .toBe(false);

    const invalidCalendarDate = validAnalysis();
    invalidCalendarDate.timeline.targetDate = "2026-99-99";
    expect(
      conversationAnalysisOutputSchema.safeParse(invalidCalendarDate).success,
    ).toBe(false);

    const reversedBudget = validAnalysis();
    reversedBudget.budget.minimumAmount = 20_000;
    reversedBudget.budget.maximumAmount = 10_000;
    expect(conversationAnalysisOutputSchema.safeParse(reversedBudget).success)
      .toBe(false);
  });
});
