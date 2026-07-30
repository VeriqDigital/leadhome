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
  dismissConversationLeadMatch: vi.fn(),
  reevaluateConversationLeadMatch: vi.fn(),
}));
const cache = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth-user", () => ({
  requireUser: vi.fn(async () => ({ id: "owner-a" })),
}));
vi.mock("@/lib/messaging/conversation-control-service", () => services);
vi.mock("@/lib/messaging/matching-service", () => matching);
vi.mock("next/cache", () => cache);

import {
  attachInboxAction,
  dismissConversationMatchAction,
  recheckConversationMatchesAction,
  statusInboxAction,
  saveInboxControlsAction,
} from "./inbox-actions";
import { initialInboxMutationState } from "@/app/inbox/mutation-state";

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

describe("Inbox server action contracts", () => {
  beforeEach(() => vi.clearAllMocks());

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
});
