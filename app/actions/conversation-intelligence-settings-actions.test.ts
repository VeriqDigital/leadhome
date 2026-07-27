import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  configurationStatus: vi.fn(),
  setPreference: vi.fn(),
  revalidatePath: vi.fn(),
  reportError: vi.fn(),
}));

vi.mock("@/lib/auth-user", () => ({
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/ai/config", () => ({
  conversationAnalysisConfigurationStatus: mocks.configurationStatus,
}));
vi.mock("@/lib/ai/conversation-analysis/job-service", () => ({
  setConversationIntelligencePreference: mocks.setPreference,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/server-errors", () => ({
  reportOperationalError: mocks.reportError,
}));

import { setConversationIntelligencePreferenceAction } from "./conversation-intelligence-settings-actions";

function form(enabled: string) {
  const data = new FormData();
  data.set("enabled", enabled);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "owner-a" });
  mocks.configurationStatus.mockReturnValue({
    available: true,
    message: "OpenAI is configured for Conversation Intelligence.",
  });
  mocks.setPreference.mockResolvedValue({
    enabled: true,
    cancelled: 0,
    cancellationRequested: 0,
  });
});

describe("Conversation Intelligence Settings action", () => {
  it("enables only the authenticated owner's preference without backfilling", async () => {
    const result = await setConversationIntelligencePreferenceAction(
      { success: false, message: "" },
      form("true"),
    );

    expect(mocks.setPreference).toHaveBeenCalledWith("owner-a", true);
    expect(result).toEqual({
      success: true,
      enabled: true,
      message:
        "Conversation Intelligence enabled. Existing conversations were not queued for analysis.",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("does not enable the preference when server configuration is unavailable", async () => {
    mocks.configurationStatus.mockReturnValueOnce({
      available: false,
      message:
        "Conversation analysis is unavailable until the server configuration is completed.",
    });

    const result = await setConversationIntelligencePreferenceAction(
      { success: false, message: "" },
      form("true"),
    );

    expect(result).toEqual({
      success: false,
      enabled: false,
      message:
        "Conversation analysis is unavailable until the server configuration is completed.",
    });
    expect(mocks.setPreference).not.toHaveBeenCalled();
  });

  it("allows disabling even when configuration is unavailable", async () => {
    mocks.configurationStatus.mockReturnValueOnce({
      available: false,
      message: "Configuration unavailable.",
    });
    mocks.setPreference.mockResolvedValueOnce({
      enabled: false,
      cancelled: 2,
      cancellationRequested: 1,
    });

    const result = await setConversationIntelligencePreferenceAction(
      { success: false, message: "" },
      form("false"),
    );

    expect(mocks.configurationStatus).not.toHaveBeenCalled();
    expect(mocks.setPreference).toHaveBeenCalledWith("owner-a", false);
    expect(result.enabled).toBe(false);
    expect(result.message).toContain("Queued analyses were cancelled");
  });

  it("rejects malformed preference values", async () => {
    const result = await setConversationIntelligencePreferenceAction(
      { success: false, message: "" },
      form("yes"),
    );

    expect(result.success).toBe(false);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.setPreference).not.toHaveBeenCalled();
  });

  it("returns a safe error without exposing internal failure details", async () => {
    mocks.setPreference.mockRejectedValueOnce(
      new Error("database failure containing private job metadata"),
    );

    const result = await setConversationIntelligencePreferenceAction(
      { success: false, message: "" },
      form("false"),
    );

    expect(result).toEqual({
      success: false,
      message:
        "Conversation Intelligence could not be updated. Please try again.",
    });
    expect(mocks.reportError).toHaveBeenCalled();
  });
});
