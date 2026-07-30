import { describe, expect, it } from "vitest";
import type { LeadMatchResult } from "@/lib/messaging/matching-service";
import { conversationMatchPresentation } from "./match-presentation";

const exact: LeadMatchResult = {
  kind: "MATCHED",
  automaticMatch: {
    leadId: "lead-a",
    name: "Mick Enev",
    email: "mick@example.com",
    company: "Veriq",
    confidence: "HIGH",
    reasonCodes: ["EXACT_SENDER_EMAIL"],
    reasons: ["Exact sender email"],
    matchedEvidence: ["EMAIL"],
    rankingInputs: {
      deterministicEvidence: 1,
      exactName: 0,
      normalizedName: "mick enev",
      stableId: "lead-a",
    },
    evidenceFingerprint: "candidate-a",
  },
  possibleMatches: [],
  noMatch: null,
  reason: "Exact sender email",
  evidenceFingerprint: "conversation-a",
};

const ambiguous: LeadMatchResult = {
  kind: "AMBIGUOUS",
  automaticMatch: null,
  possibleMatches: [exact.automaticMatch],
  noMatch: null,
  reason: "Multiple leads share this email",
  evidenceFingerprint: "conversation-a",
};

describe("canonical Inbox match presentation", () => {
  it("replaces a stale no-match summary with the same fresh exact result used by the panel", () => {
    expect(conversationMatchPresentation({
      leadId: null,
      manuallyDetached: false,
      persistedKind: "NO_MATCH",
      persistedReason: "No credible lead match was found",
      evaluatedMatch: exact,
    })).toEqual({
      summary: "Exact sender email",
      badge: "Exact match",
    });
  });

  it("keeps the summary, candidate panel outcome, and row badge ambiguous together", () => {
    expect(conversationMatchPresentation({
      leadId: null,
      manuallyDetached: false,
      persistedKind: "AMBIGUOUS",
      persistedReason: "Possible lead matches found",
      evaluatedMatch: ambiguous,
    })).toEqual({
      summary: "Multiple leads share this email",
      badge: "Possible match",
    });
  });

  it("keeps one remaining candidate ambiguous after another is dismissed", () => {
    expect(conversationMatchPresentation({
      leadId: null,
      manuallyDetached: false,
      persistedKind: "AMBIGUOUS",
      persistedReason: "Multiple leads share this email",
      evaluatedMatch: ambiguous,
    })).toEqual({
      summary: ambiguous.reason,
      badge: "Possible match",
    });
  });

  it("removes the badge and uses the canonical reason after the final dismissal", () => {
    const dismissed: LeadMatchResult = {
      kind: "NO_MATCH",
      automaticMatch: null,
      possibleMatches: [],
      noMatch: {
        code: "DISMISSED",
        reason: "Suggested matches were dismissed for the same evidence",
      },
      reason: "Suggested matches were dismissed for the same evidence",
      evidenceFingerprint: "conversation-a",
    };
    expect(conversationMatchPresentation({
      leadId: null,
      manuallyDetached: false,
      persistedKind: "NO_MATCH",
      persistedReason: dismissed.reason,
      evaluatedMatch: dismissed,
    })).toEqual({
      summary: dismissed.reason,
      badge: null,
    });
  });
});
