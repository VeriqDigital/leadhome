import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadStatus } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  moveLeadStatus: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/pipeline/status-service", () => ({
  moveLeadStatus: mocks.moveLeadStatus,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { movePipelineLeadAction } from "@/app/actions/pipeline-actions";

const leadId = "cm123456789012345678901234";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "owner-a" });
});

describe("pipeline move server action", () => {
  it("rejects a forged destination before authentication or mutation", async () => {
    await expect(
      movePipelineLeadAction({ leadId, status: "ADMIN_ONLY" }),
    ).resolves.toEqual({
      success: false,
      message: "Choose a valid pipeline stage.",
    });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.moveLeadStatus).not.toHaveBeenCalled();
  });

  it("owner-scopes the mutation and returns canonical persisted state", async () => {
    mocks.moveLeadStatus.mockResolvedValue({
      kind: "changed",
      lead: {
        id: leadId,
        name: "Jane",
        status: LeadStatus.NEGOTIATING,
        updatedAt: new Date("2026-07-27T15:30:00.000Z"),
      },
    });

    await expect(
      movePipelineLeadAction({
        leadId,
        status: LeadStatus.NEGOTIATING,
      }),
    ).resolves.toEqual({
      success: true,
      changed: true,
      lead: {
        id: leadId,
        name: "Jane",
        status: LeadStatus.NEGOTIATING,
        updatedAt: "2026-07-27T15:30:00.000Z",
      },
    });
    expect(mocks.moveLeadStatus).toHaveBeenCalledWith(
      "owner-a",
      leadId,
      LeadStatus.NEGOTIATING,
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pipeline");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });

  it("reports unchanged and inaccessible leads explicitly", async () => {
    mocks.moveLeadStatus.mockResolvedValueOnce({
      kind: "unchanged",
      lead: {
        id: leadId,
        name: "Jane",
        status: LeadStatus.NEW,
        updatedAt: new Date("2026-07-27T15:30:00.000Z"),
      },
    });
    await expect(
      movePipelineLeadAction({ leadId, status: LeadStatus.NEW }),
    ).resolves.toEqual(expect.objectContaining({
      success: true,
      changed: false,
    }));

    mocks.moveLeadStatus.mockResolvedValueOnce({ kind: "not-found" });
    await expect(
      movePipelineLeadAction({ leadId, status: LeadStatus.WON }),
    ).resolves.toEqual({ success: false, message: "Lead not found." });
  });
});
