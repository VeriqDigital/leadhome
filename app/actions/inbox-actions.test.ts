import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  updateConversationClassification: vi.fn(),
  updateConversationReviewState: vi.fn(),
  updateConversationStatus: vi.fn(),
  attachConversationControl: vi.fn(),
  detachConversationControl: vi.fn(),
  updateConversationControls: vi.fn(),
}));
const matching = vi.hoisted(() => ({
  allowConversationMatchingAgain: vi.fn(),
  dismissConversationLeadMatch: vi.fn(),
  reevaluateConversationLeadMatch: vi.fn(),
}));
const company = vi.hoisted(() => ({
  applyConversationCompanySuggestion: vi.fn(),
  dismissConversationCompanySuggestion: vi.fn(),
  recheckConversationCompany: vi.fn(),
}));
const cache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth-user", () => ({
  requireUser: vi.fn(async () => ({ id: "owner-a" })),
}));
vi.mock("@/lib/messaging/conversation-control-service", () => services);
vi.mock("@/lib/messaging/matching-service", () => matching);
vi.mock(
  "@/lib/messaging/company-detection-service",
  () => company,
);
vi.mock("next/cache", () => cache);

import {
  attachInboxAction,
  allowConversationMatchingAgainAction,
  detachInboxAction,
  dismissConversationMatchAction,
  recheckConversationMatchesAction,
  mutateConversationCompanyAction,
  statusInboxAction,
  saveInboxControlsAction,
} from "./inbox-actions";
import {
  initialCompanyDetectionMutationState,
  initialInboxMutationState,
} from "@/app/inbox/mutation-state";

const leadId = "cmrwxawgy0005j9kc6szawqx2";
const canonical = {
  id: "cmrzmqfg0000b9u07wgtw2me",
  leadId: null,
  lead: null,
  classification: "UNKNOWN",
  reviewState: "NEEDS_REVIEW",
  status: "CLOSED",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as const;
const canonicalMatch = {
  id: canonical.id,
  leadId: null,
  manuallyDetached: false,
  reviewState: "NEEDS_REVIEW",
  matchKind: "AMBIGUOUS",
  matchReason: "Multiple leads share this email",
  matchCandidateLeadIds: [
    leadId,
    "cmrwxawgy0006j9kc6szawqx3",
  ],
} as const;
const companyFingerprint = "a".repeat(64);
const companyView = {
  conversationId: canonical.id,
  lead: {
    id: leadId,
    name: "Mick Enev",
    email: "mick@northstarroofing.com",
    company: null,
  },
  state: "SUGGESTED",
  suggestion: {
    value: "Northstar Roofing",
    source: "BUSINESS_DOMAIN",
    evidenceFingerprint: companyFingerprint,
    evidenceSummary: "Detected from sender domain",
    evidenceDetails: ["Email domain: northstarroofing.com"],
    automaticEligible: false,
  },
  canRecheck: true,
} as const;

describe("Inbox server action contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports only async Server Functions from the use-server module", () => {
    const source = readFileSync(
      new URL("./inbox-actions.ts", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/^"use server";/);
    expect(source).not.toMatch(/^export\s+const\s+/m);
    expect(source).not.toContain(
      "export const initialCompanyDetectionMutationState",
    );
  });

  it("submits the newly selected value and returns canonical persistence", async () => {
    services.updateConversationStatus.mockResolvedValue({
      changed: true, conversation: canonical,
    });
    const data = new FormData();
    data.set("conversationId", canonical.id);
    data.set("status", "CLOSED");
    const result = await statusInboxAction(initialInboxMutationState, data);
    expect(services.updateConversationStatus).toHaveBeenCalledWith({
      ownerId: "owner-a", conversationId: canonical.id, status: "CLOSED",
    });
    expect(result).toEqual(expect.objectContaining({
      success: true, changed: true,
      conversation: expect.objectContaining({ status: "CLOSED" }),
    }));
  });

  it("rejects a missing selected value without invoking the database service", async () => {
    const data = new FormData();
    data.set("conversationId", canonical.id);
    const result = await statusInboxAction(initialInboxMutationState, data);
    expect(result.success).toBe(false);
    expect(result.message).toContain("valid value");
    expect(services.updateConversationStatus).not.toHaveBeenCalled();
  });

  it("does not report success when the owner-scoped service rejects", async () => {
    services.updateConversationStatus.mockRejectedValue(new Error("not found"));
    const data = new FormData();
    data.set("conversationId", canonical.id);
    data.set("status", "CLOSED");
    const result = await statusInboxAction(initialInboxMutationState, data);
    expect(result).toEqual(expect.objectContaining({ success: false }));
    expect(result.message).not.toContain("updated");
  });

  it("keeps explicit suggestion confirmation on the canonical attach service", async () => {
    services.attachConversationControl.mockResolvedValue({
      changed: true,
      conversation: {
        ...canonical,
        leadId,
        lead: { id: leadId, name: "Mick Enev", email: "mick@example.com" },
        reviewState: "MATCHED",
      },
    });
    const data = new FormData();
    data.set("conversationId", canonical.id);
    data.set("leadId", leadId);

    const result = await attachInboxAction(initialInboxMutationState, data);

    expect(services.attachConversationControl).toHaveBeenCalledWith({
      ownerId: "owner-a",
      conversationId: canonical.id,
      leadId,
    });
    expect(matching.reevaluateConversationLeadMatch).not.toHaveBeenCalled();
    expect(matching.dismissConversationLeadMatch).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      success: true,
      changed: true,
      message: "Conversation attached to Mick Enev.",
    }));
    for (const path of [
      "/",
      "/inbox",
      "/leads",
      "/pipeline",
      `/leads/${leadId}`,
    ]) {
      expect(cache.revalidatePath).toHaveBeenCalledWith(path);
    }
    expect(cache.revalidatePath).toHaveBeenCalledWith(
      "/leads/[id]",
      "page",
    );
  });

  it("invalidates the previously attached lead detail after detach", async () => {
    services.detachConversationControl.mockResolvedValue({
      changed: true,
      conversation: canonical,
    });
    const data = new FormData();
    data.set("conversationId", canonical.id);

    await detachInboxAction(initialInboxMutationState, data);

    expect(services.detachConversationControl).toHaveBeenCalledWith({
      ownerId: "owner-a",
      conversationId: canonical.id,
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith(
      "/leads/[id]",
      "page",
    );
  });

  it("submits one canonical combined control contract", async () => {
    services.updateConversationControls.mockResolvedValue({
      changed: true,
      conversation: {
        ...canonical,
        leadId,
        classification: "LEAD",
        reviewState: "MATCHED",
      },
    });
    const data = new FormData();
    data.set("conversationId", canonical.id);
    data.set("leadId", leadId);
    data.set("classification", "LEAD");
    data.set("reviewState", "MATCHED");
    data.set("status", "CLOSED");
    const result = await saveInboxControlsAction(initialInboxMutationState, data);
    expect(services.updateConversationControls).toHaveBeenCalledWith({
      ownerId: "owner-a",
      conversationId: canonical.id,
      leadId,
      classification: "LEAD",
      reviewState: "MATCHED",
      status: "CLOSED",
    });
    expect(result).toEqual(expect.objectContaining({ success: true, changed: true }));
  });

  it("owner-scopes one-conversation recheck and reports possible matches", async () => {
    matching.reevaluateConversationLeadMatch.mockResolvedValue({
      changed: true,
      attached: false,
      matched: false,
      needsReview: true,
      match: {
        kind: "AMBIGUOUS",
        automaticMatch: null,
        possibleMatches: [
          { leadId },
          { leadId: "cmrwxawgy0006j9kc6szawqx3" },
        ],
        noMatch: null,
        reason: "Multiple leads share this email",
        evidenceFingerprint: "evidence-a",
      },
      conversation: canonicalMatch,
    });
    const data = new FormData();
    data.set("conversationId", canonical.id);

    const result = await recheckConversationMatchesAction(
      { success: false, message: "" },
      data,
    );

    expect(matching.reevaluateConversationLeadMatch).toHaveBeenCalledWith(
      "owner-a",
      canonical.id,
    );
    expect(cache.revalidatePath).toHaveBeenCalledWith("/inbox");
    expect(result).toEqual({
      success: true,
      changed: true,
      message: "2 possible matches found.",
      conversation: canonicalMatch,
    });
  });

  it("rejects invalid recheck input before invoking the matching service", async () => {
    const data = new FormData();
    data.set("conversationId", "not-a-conversation-id");

    const result = await recheckConversationMatchesAction(
      { success: false, message: "" },
      data,
    );

    expect(result).toEqual({
      success: false,
      message: "Choose a valid conversation.",
    });
    expect(matching.reevaluateConversationLeadMatch).not.toHaveBeenCalled();
  });

  it("returns a safe failure when the owner-scoped recheck rejects", async () => {
    matching.reevaluateConversationLeadMatch.mockRejectedValue(
      new Error("Conversation not found."),
    );
    const data = new FormData();
    data.set("conversationId", canonical.id);

    const result = await recheckConversationMatchesAction(
      { success: false, message: "" },
      data,
    );

    expect(result).toEqual({
      success: false,
      message: "Matches could not be checked. Please try again.",
    });
  });

  it("owner-scopes dismissal and does not accept arbitrary identifiers", async () => {
    matching.dismissConversationLeadMatch.mockResolvedValue({
      changed: true,
      remaining: [{ leadId: "cmrwxawgy0006j9kc6szawqx3" }],
      conversation: {
        ...canonicalMatch,
        matchCandidateLeadIds: ["cmrwxawgy0006j9kc6szawqx3"],
      },
    });
    const data = new FormData();
    data.set("conversationId", canonical.id);
    data.set("leadId", leadId);

    const result = await dismissConversationMatchAction(
      { success: false, message: "" },
      data,
    );

    expect(matching.dismissConversationLeadMatch).toHaveBeenCalledWith({
      ownerId: "owner-a",
      conversationId: canonical.id,
      leadId,
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/inbox");
    expect(result).toEqual({
      success: true,
      changed: true,
      message: "Suggestion dismissed. Other possible matches remain.",
      conversation: {
        ...canonicalMatch,
        matchCandidateLeadIds: ["cmrwxawgy0006j9kc6szawqx3"],
      },
    });

    vi.clearAllMocks();
    const invalid = new FormData();
    invalid.set("conversationId", canonical.id);
    invalid.set("leadId", "not-a-lead-id");
    await expect(
      dismissConversationMatchAction(
        { success: false, message: "" },
        invalid,
      ),
    ).resolves.toEqual({
      success: false,
      message: "Choose a valid match suggestion.",
    });
    expect(matching.dismissConversationLeadMatch).not.toHaveBeenCalled();
  });

  it("does not expose owner-scoped dismissal failures", async () => {
    matching.dismissConversationLeadMatch.mockRejectedValue(
      new Error("Match suggestion is no longer available."),
    );
    const data = new FormData();
    data.set("conversationId", canonical.id);
    data.set("leadId", leadId);

    const result = await dismissConversationMatchAction(
      { success: false, message: "" },
      data,
    );

    expect(result).toEqual({
      success: false,
      message: "That suggestion could not be dismissed.",
    });
  });

  it("owner-scopes manual-detach recovery and returns canonical suggestions", async () => {
    matching.allowConversationMatchingAgain.mockResolvedValue({
      suppressionCleared: true,
      alreadyAttached: false,
      changed: true,
      attached: false,
      matched: false,
      needsReview: true,
      match: {
        kind: "AMBIGUOUS",
        automaticMatch: null,
        possibleMatches: [{ leadId }],
        noMatch: null,
        reason: "Multiple leads share this email",
        evidenceFingerprint: "evidence-a",
      },
      conversation: {
        ...canonicalMatch,
        matchCandidateLeadIds: [leadId],
      },
    });
    const data = new FormData();
    data.set("conversationId", canonical.id);

    const result = await allowConversationMatchingAgainAction(
      { success: false, message: "" },
      data,
    );

    expect(matching.allowConversationMatchingAgain).toHaveBeenCalledWith(
      "owner-a",
      canonical.id,
    );
    expect(cache.revalidatePath).toHaveBeenCalledWith("/inbox");
    expect(result).toEqual({
      success: true,
      changed: true,
      message: "Automatic matching resumed. 1 possible match found.",
      conversation: {
        ...canonicalMatch,
        matchCandidateLeadIds: [leadId],
      },
    });
  });

  it("treats an already attached recovery request as an idempotent no-op", async () => {
    matching.allowConversationMatchingAgain.mockResolvedValue({
      suppressionCleared: false,
      alreadyAttached: true,
      changed: false,
      attached: false,
      matched: true,
      needsReview: false,
      match: null,
      conversation: {
        ...canonicalMatch,
        leadId,
        manuallyDetached: false,
        reviewState: "MATCHED",
        matchKind: "MATCHED",
        matchReason: "manually attached",
        matchCandidateLeadIds: [],
      },
    });
    const data = new FormData();
    data.set("conversationId", canonical.id);

    const result = await allowConversationMatchingAgainAction(
      { success: false, message: "" },
      data,
    );

    expect(result).toEqual(expect.objectContaining({
      success: true,
      changed: false,
      message: "Conversation is already attached.",
    }));
    for (const path of [
      "/",
      "/inbox",
      "/leads",
      "/pipeline",
      `/leads/${leadId}`,
    ]) {
      expect(cache.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("owner-scopes company application and revalidates every affected view", async () => {
    company.applyConversationCompanySuggestion.mockResolvedValue({
      changed: true,
      outcome: "APPLIED",
      companyView: {
        ...companyView,
        state: "COMPANY_PRESENT",
        lead: { ...companyView.lead, company: "Northstar Roofing" },
        suggestion: null,
        canRecheck: false,
      },
    });
    const data = new FormData();
    data.set("intent", "APPLY");
    data.set("conversationId", canonical.id);
    data.set("expectedLeadId", leadId);
    data.set("evidenceFingerprint", companyFingerprint);

    const result = await mutateConversationCompanyAction(
      initialCompanyDetectionMutationState,
      data,
    );

    expect(
      company.applyConversationCompanySuggestion,
    ).toHaveBeenCalledWith({
      ownerId: "owner-a",
      conversationId: canonical.id,
      expectedLeadId: leadId,
      evidenceFingerprint: companyFingerprint,
    });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      changed: true,
      message: "Company applied.",
    }));
    for (const path of [
      "/inbox",
      "/",
      "/leads",
      "/pipeline",
      `/leads/${leadId}`,
    ]) {
      expect(cache.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("owner-scopes company dismissal without revalidating unrelated lead views", async () => {
    company.dismissConversationCompanySuggestion.mockResolvedValue({
      changed: true,
      outcome: "DISMISSED",
      companyView: {
        ...companyView,
        state: "NO_SUGGESTION",
        suggestion: null,
      },
    });
    const data = new FormData();
    data.set("intent", "DISMISS");
    data.set("conversationId", canonical.id);
    data.set("expectedLeadId", leadId);
    data.set("evidenceFingerprint", companyFingerprint);

    const result = await mutateConversationCompanyAction(
      initialCompanyDetectionMutationState,
      data,
    );

    expect(
      company.dismissConversationCompanySuggestion,
    ).toHaveBeenCalledWith({
      ownerId: "owner-a",
      conversationId: canonical.id,
      expectedLeadId: leadId,
      evidenceFingerprint: companyFingerprint,
    });
    expect(result).toEqual(expect.objectContaining({
      success: true,
      changed: true,
      message: "Company suggestion dismissed.",
    }));
    expect(cache.revalidatePath).toHaveBeenCalledWith("/inbox");
    expect(cache.revalidatePath).not.toHaveBeenCalledWith("/leads");
  });

  it("owner-scopes company recheck and returns the canonical suggestion", async () => {
    company.recheckConversationCompany.mockResolvedValue({
      changed: false,
      outcome: "NO_CHANGE",
      companyView,
    });
    const data = new FormData();
    data.set("intent", "RECHECK");
    data.set("conversationId", canonical.id);

    const result = await mutateConversationCompanyAction(
      initialCompanyDetectionMutationState,
      data,
    );

    expect(company.recheckConversationCompany).toHaveBeenCalledWith(
      "owner-a",
      canonical.id,
    );
    expect(result).toEqual({
      success: true,
      changed: false,
      message: "Company evidence checked. A suggestion is ready for review.",
      companyView,
    });
  });

  it("rejects malformed company mutations before invoking a service", async () => {
    const data = new FormData();
    data.set("intent", "APPLY");
    data.set("conversationId", canonical.id);
    data.set("expectedLeadId", leadId);
    data.set("evidenceFingerprint", "not-a-fingerprint");

    await expect(
      mutateConversationCompanyAction(
        initialCompanyDetectionMutationState,
        data,
      ),
    ).resolves.toEqual({
      success: false,
      message: "That company suggestion is no longer available.",
    });
    expect(
      company.applyConversationCompanySuggestion,
    ).not.toHaveBeenCalled();
  });

  it("returns canonical state when a stale apply loses to a newer edit", async () => {
    const populated = {
      ...companyView,
      state: "COMPANY_PRESENT" as const,
      lead: { ...companyView.lead, company: "Manual Company" },
      suggestion: null,
      canRecheck: false,
    };
    company.applyConversationCompanySuggestion.mockResolvedValue({
      changed: false,
      outcome: "STALE",
      companyView: populated,
    });
    const data = new FormData();
    data.set("intent", "APPLY");
    data.set("conversationId", canonical.id);
    data.set("expectedLeadId", leadId);
    data.set("evidenceFingerprint", companyFingerprint);

    const result = await mutateConversationCompanyAction(
      initialCompanyDetectionMutationState,
      data,
    );

    expect(result).toEqual({
      success: false,
      changed: false,
      message:
        "The lead or company changed before this request was completed.",
      companyView: populated,
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("does not expose owner-scoped company service failures", async () => {
    company.recheckConversationCompany.mockRejectedValue(
      new Error("Conversation not found."),
    );
    const data = new FormData();
    data.set("intent", "RECHECK");
    data.set("conversationId", canonical.id);

    await expect(
      mutateConversationCompanyAction(
        initialCompanyDetectionMutationState,
        data,
      ),
    ).resolves.toEqual({
      success: false,
      message: "Company detection could not be updated. Please try again.",
    });
  });
});
