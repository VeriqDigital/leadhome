import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  updateConversationClassification: vi.fn(),
  updateConversationReviewState: vi.fn(),
  updateConversationStatus: vi.fn(),
  attachConversationControl: vi.fn(),
  detachConversationControl: vi.fn(),
  updateConversationControls: vi.fn(),
}));
vi.mock("@/lib/auth-user", () => ({
  requireUser: vi.fn(async () => ({ id: "owner-a" })),
}));
vi.mock("@/lib/messaging/conversation-control-service", () => services);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  statusInboxAction,
  saveInboxControlsAction,
} from "./inbox-actions";
import { initialInboxMutationState } from "@/app/inbox/mutation-state";

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

  it("submits one canonical combined control contract", async () => {
    services.updateConversationControls.mockResolvedValue({
      changed: true,
      conversation: {
        ...canonical,
        leadId: "cmrwxawgy0005j9kc6szawqx2",
        classification: "LEAD",
        reviewState: "MATCHED",
      },
    });
    const data = new FormData();
    data.set("conversationId", canonical.id);
    data.set("leadId", "cmrwxawgy0005j9kc6szawqx2");
    data.set("classification", "LEAD");
    data.set("reviewState", "MATCHED");
    data.set("status", "CLOSED");
    const result = await saveInboxControlsAction(initialInboxMutationState, data);
    expect(services.updateConversationControls).toHaveBeenCalledWith({
      ownerId: "owner-a",
      conversationId: canonical.id,
      leadId: "cmrwxawgy0005j9kc6szawqx2",
      classification: "LEAD",
      reviewState: "MATCHED",
      status: "CLOSED",
    });
    expect(result).toEqual(expect.objectContaining({ success: true, changed: true }));
  });
});
