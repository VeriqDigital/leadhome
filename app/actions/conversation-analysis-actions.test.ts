import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  configuration: vi.fn(),
  enqueue: vi.fn(),
  findUser: vi.fn(),
  findConversation: vi.fn(),
  revalidatePath: vi.fn(),
  reportOperationalError: vi.fn(),
}));

vi.mock("@/lib/auth-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/ai/config", () => ({
  conversationAnalysisConfigurationStatus: mocks.configuration,
}));
vi.mock("@/lib/ai/conversation-analysis/job-service", () => ({
  enqueueConversationAnalysisJob: mocks.enqueue,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    conversation: { findFirst: mocks.findConversation },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server-errors", () => ({
  reportOperationalError: mocks.reportOperationalError,
}));

import { analyzeConversationAction } from "./conversation-analysis-actions";

const conversationId = "cmrzmqfg0000b9u07wgtw2me";
const initialState = { success: false, message: "" };

function form(value = conversationId) {
  const data = new FormData();
  data.set("conversationId", value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "owner-a" });
  mocks.configuration.mockReturnValue({
    available: true,
    message: "OpenAI is configured for Conversation Intelligence.",
  });
  mocks.findUser.mockResolvedValue({
    conversationIntelligenceEnabled: true,
  });
  mocks.findConversation.mockResolvedValue({ id: conversationId });
});

describe("manual Conversation Intelligence action", () => {
  it("queues an owner-scoped forced manual analysis and returns only its view", async () => {
    const job = {
      id: "job-a",
      type: "CONVERSATION_ANALYSIS",
      status: "PENDING",
      active: true,
    };
    mocks.enqueue.mockResolvedValue({ kind: "queued", job });

    await expect(
      analyzeConversationAction(initialState, form()),
    ).resolves.toEqual({
      success: true,
      message: "Analysis queued.",
      job,
    });
    expect(mocks.findConversation).toHaveBeenCalledWith({
      where: { id: conversationId, ownerId: "owner-a" },
      select: { id: true },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith({
      ownerId: "owner-a",
      conversationId,
      trigger: "MANUAL_REANALYSIS",
      force: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("rejects malformed, wrong-owner, disabled, and unavailable requests", async () => {
    await expect(
      analyzeConversationAction(initialState, form("forged")),
    ).resolves.toEqual({
      success: false,
      message: "Choose a valid conversation to analyze.",
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();

    mocks.findConversation.mockResolvedValueOnce(null);
    await expect(
      analyzeConversationAction(initialState, form()),
    ).resolves.toEqual({
      success: false,
      message: "This conversation is unavailable.",
    });

    mocks.findUser.mockResolvedValueOnce({
      conversationIntelligenceEnabled: false,
    });
    await expect(
      analyzeConversationAction(initialState, form()),
    ).resolves.toEqual({
      success: false,
      message: "Enable Conversation Intelligence in Settings first.",
    });

    mocks.configuration.mockReturnValueOnce({
      available: false,
      message: "Unavailable.",
    });
    await expect(
      analyzeConversationAction(initialState, form()),
    ).resolves.toEqual({
      success: false,
      message:
        "Conversation analysis is unavailable until the server configuration is completed.",
    });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("returns the active job for duplicate clicks and handles no-content safely", async () => {
    mocks.enqueue.mockResolvedValueOnce({
      kind: "existing",
      job: { id: "job-active", status: "RUNNING" },
    });
    await expect(
      analyzeConversationAction(initialState, form()),
    ).resolves.toEqual({
      success: true,
      message: "This analysis is already in progress.",
      job: { id: "job-active", status: "RUNNING" },
    });

    mocks.enqueue.mockResolvedValueOnce({ kind: "no-content" });
    await expect(
      analyzeConversationAction(initialState, form()),
    ).resolves.toEqual({
      success: true,
      message:
        "This conversation does not contain enough message text to analyze.",
    });
  });

  it("does not call a provider or worker from the request path", () => {
    const source = String(analyzeConversationAction);
    expect(source).not.toContain("OpenAI");
    expect(source).not.toContain("runConversationAnalysisJob");
    expect(source).not.toContain("provider.analyze");
  });
});
