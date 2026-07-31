import {
  JobStatus,
  JobType,
  type Job,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationAnalysisOutput } from "@/lib/ai/conversation-analysis/schema";
import {
  JobCancelledError,
  JobExecutionError,
  JobLeaseLostError,
} from "@/lib/jobs/errors";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  findAnalysis: vi.fn(),
  loadSource: vi.fn(),
  prepareInput: vi.fn(),
  heartbeat: vi.fn(),
  withLease: vi.fn(),
  updateAnalyses: vi.fn(),
  updateJob: vi.fn(),
  findConversation: vi.fn(),
  findLeads: vi.fn(),
  findConversations: vi.fn(),
  createActivities: vi.fn(),
  config: vi.fn(),
  log: vi.fn(),
  revalidatePath: vi.fn(),
  detectCompany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    conversationAnalysis: { findUnique: mocks.findAnalysis },
  },
}));
vi.mock("@/lib/ai/config", () => ({
  getConversationAnalysisConfig: mocks.config,
}));
vi.mock("@/lib/ai/conversation-analysis/prepare-input", () => ({
  loadConversationAnalysisSource: mocks.loadSource,
  prepareConversationInput: mocks.prepareInput,
}));
vi.mock("@/lib/jobs/service", () => ({
  heartbeatJob: mocks.heartbeat,
  withJobLease: mocks.withLease,
}));
vi.mock("@/lib/jobs/logging", () => ({
  logJobEvent: mocks.log,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/messaging/company-detection-service", () => ({
  detectCompanyAfterAttachment: mocks.detectCompany,
}));

import { runConversationAnalysisJob } from "./conversation-analysis";

const conversationId = "cm123456789012345678901234";
const analysisId = "cm987654321098765432109876";
const jobId = "cm222222222222222222222222";
const now = new Date("2026-07-27T20:00:00.000Z");
const contentHash = "a".repeat(64);

function job(
  overrides: Partial<Job> = {},
): Job {
  return {
    id: jobId,
    ownerId: "owner-a",
    type: JobType.CONVERSATION_ANALYSIS,
    status: JobStatus.RUNNING,
    payload: {
      conversationId,
      trigger: "GMAIL_IMPORT",
      force: false,
      analysisVersion: "conversation-v1",
    },
    result: null,
    progress: null,
    attemptCount: 1,
    maxAttempts: 3,
    availableAt: now,
    lockedAt: now,
    lockedBy: "worker-123",
    heartbeatAt: now,
    startedAt: now,
    completedAt: null,
    failedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    idempotencyKey: conversationId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function validOutput(): ConversationAnalysisOutput {
  return {
    summary: "The lead requested a website redesign proposal.",
    company: {
      value: "Northwind",
      confidence: 0.9,
      evidenceMessageOrdinals: [1],
    },
    contact: {
      name: "Alex",
      email: "alex@example.com",
      phone: null,
      confidence: 0.9,
      evidenceMessageOrdinals: [1],
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
      targetDate: null,
      rawText: null,
      confidence: 0,
      evidenceMessageOrdinals: [],
    },
    sentiment: {
      value: "POSITIVE",
      confidence: 0.8,
    },
    actionItems: [{
      title: "Send the proposal",
      description: null,
      owner: "USER",
      dueDate: null,
      confidence: 0.8,
      evidenceMessageOrdinals: [1],
    }],
    missingInformation: ["Budget"],
  };
}

function providerResult() {
  return {
    analysis: validOutput(),
    model: "configured-model",
    inputTokens: 700,
    outputTokens: 180,
    totalTokens: 880,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUser.mockResolvedValue({
    conversationIntelligenceEnabled: true,
  });
  mocks.loadSource.mockResolvedValue({
    subject: "Website redesign",
    leadId: "lead-a",
    messages: [],
  });
  mocks.findAnalysis.mockResolvedValue({
    id: analysisId,
    ownerId: "owner-a",
    conversationId,
    latestJobId: jobId,
    status: "QUEUED",
    contentHash: null,
    analysisVersion: "conversation-v1",
    summary: null,
    structuredData: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    durationMs: null,
    sourceMessageCount: 1,
    inputTruncated: false,
    lastErrorCode: null,
    lastErrorMessage: null,
    queuedAt: now,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  mocks.prepareInput.mockReturnValue({
    text: "bounded conversation input",
    contentHash,
    inputTruncated: false,
    sourceMessageCount: 1,
    includedMessageCount: 1,
    hasMeaningfulContent: true,
  });
  mocks.config.mockReturnValue({
    apiKey: "test-key",
    model: "configured-model",
    maxInputChars: 60_000,
    requestTimeoutMs: 45_000,
    analysisVersion: "conversation-v1",
  });
  mocks.heartbeat.mockResolvedValue("ok");
  mocks.updateAnalyses.mockResolvedValue({ count: 1 });
  mocks.updateJob.mockResolvedValue({});
  mocks.findConversation.mockResolvedValue({
    id: conversationId,
    leadId: "lead-a",
  });
  mocks.findLeads.mockResolvedValue([{ id: "lead-a" }]);
  mocks.findConversations.mockResolvedValue([
    { id: conversationId, leadId: "lead-a" },
  ]);
  mocks.createActivities.mockResolvedValue({ count: 1 });
  mocks.detectCompany.mockResolvedValue(null);
  mocks.withLease.mockImplementation(
    async (
      _jobId: string,
      _workerId: string,
      mutation: (tx: unknown) => Promise<unknown>,
    ) => ({
      kind: "ok",
      value: await mutation({
        conversationAnalysis: {
          updateMany: mocks.updateAnalyses,
        },
        job: {
          update: mocks.updateJob,
        },
        lead: {
          findMany: mocks.findLeads,
        },
        conversation: {
          findFirst: mocks.findConversation,
          findMany: mocks.findConversations,
        },
        leadActivity: {
          createMany: mocks.createActivities,
        },
      }),
    }),
  );
});

describe("conversation analysis job handler", () => {
  it("persists validated canonical output and usage through the owned lease", async () => {
    const provider = { analyze: vi.fn().mockResolvedValue(providerResult()) };
    mocks.detectCompany.mockResolvedValueOnce({
      companyView: {
        lead: { id: "lead-b" },
      },
    });

    const result = await runConversationAnalysisJob(job(), {
      workerId: "worker-123",
      provider,
    });

    expect(result).toEqual({
      conversationAnalysisId: analysisId,
      contentHash,
      analysisVersion: "conversation-v1",
      outcome: "COMPLETED",
      model: "configured-model",
      inputTokens: 700,
      outputTokens: 180,
      totalTokens: 880,
      durationMs: expect.any(Number),
      inputTruncated: false,
    });
    expect(provider.analyze).toHaveBeenCalledWith({
      text: "bounded conversation input",
      includedMessageCount: 1,
      timeoutMs: 45_000,
    });
    expect(mocks.updateAnalyses).toHaveBeenLastCalledWith({
      where: {
        ownerId: "owner-a",
        conversationId,
        latestJobId: jobId,
      },
      data: expect.objectContaining({
        status: "COMPLETED",
        contentHash,
        analysisVersion: "conversation-v1",
        summary: validOutput().summary,
        structuredData: validOutput(),
        model: "configured-model",
        inputTokens: 700,
        outputTokens: 180,
        totalTokens: 880,
        sourceMessageCount: 1,
        inputTruncated: false,
        completedAt: expect.any(Date),
        lastErrorCode: null,
        lastErrorMessage: null,
      }),
    });
    expect(mocks.findConversation).toHaveBeenCalledWith({
      where: {
        id: conversationId,
        ownerId: "owner-a",
      },
      select: { id: true, leadId: true },
    });
    expect(mocks.createActivities).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          leadId: "lead-a",
          conversationId,
          type: "AI_ANALYSIS_COMPLETED",
          actorType: "AI",
          source: "AI",
          title: "Conversation analysis completed",
          metadata: {
            analysisId,
            actionItemCount: 1,
            inputTruncated: false,
          },
          idempotencyKey: `analysis-completed:${analysisId}:${jobId}`,
          occurredAt: expect.any(Date),
        }),
      ],
      skipDuplicates: true,
    });
    expect(mocks.heartbeat.mock.calls.map((call) => call[2].phase)).toEqual([
      "PREPARING",
      "ANALYZING",
      "SAVING",
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/leads");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/leads/[id]",
      "page",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pipeline");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/leads/lead-a");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/leads/lead-b");
    expect(mocks.detectCompany).toHaveBeenCalledWith(
      "owner-a",
      conversationId,
    );
  });

  it("skips no-content input without calling the provider", async () => {
    mocks.prepareInput.mockReturnValueOnce({
      text: "Analysis input version: conversation-v1",
      contentHash,
      inputTruncated: false,
      sourceMessageCount: 1,
      includedMessageCount: 0,
      hasMeaningfulContent: false,
    });
    const provider = { analyze: vi.fn() };

    await expect(runConversationAnalysisJob(job(), {
      workerId: "worker-123",
      provider,
    })).resolves.toEqual(expect.objectContaining({
      outcome: "SKIPPED_NO_CONTENT",
      model: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    }));

    expect(provider.analyze).not.toHaveBeenCalled();
    expect(mocks.updateAnalyses).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-a",
        conversationId,
        latestJobId: jobId,
      },
      data: expect.objectContaining({
        status: "SKIPPED",
        lastErrorCode: "AI_NO_CONTENT",
      }),
    });
  });

  it("preserves prior successful output when a retryable provider call fails", async () => {
    const failure = new JobExecutionError(
      "OPENAI_RATE_LIMITED",
      "The AI provider temporarily limited requests.",
      true,
    );
    const provider = { analyze: vi.fn().mockRejectedValue(failure) };

    await expect(runConversationAnalysisJob(job(), {
      workerId: "worker-123",
      provider,
    })).rejects.toMatchObject({
      code: "OPENAI_RATE_LIMITED",
      retryable: true,
    });

    const failureWrite = mocks.updateAnalyses.mock.calls.at(-1)?.[0];
    expect(failureWrite).toEqual({
      where: {
        ownerId: "owner-a",
        latestJobId: jobId,
      },
      data: {
        status: "FAILED",
        lastErrorCode: "OPENAI_RATE_LIMITED",
        lastErrorMessage:
          "The AI provider temporarily limited requests.",
      },
    });
    expect(failureWrite.data).not.toHaveProperty("summary");
    expect(failureWrite.data).not.toHaveProperty("structuredData");
    expect(failureWrite.data).not.toHaveProperty("contentHash");
    expect(failureWrite.data).not.toHaveProperty("completedAt");
  });

  it("keeps permanent configuration failures non-retryable and safely bounded", async () => {
    const provider = {
      analyze: vi.fn().mockRejectedValue(new JobExecutionError(
        "AI_CONFIGURATION_MISSING",
        "Conversation Intelligence is not configured on the server.",
        false,
      )),
    };

    await expect(runConversationAnalysisJob(job(), {
      workerId: "worker-123",
      provider,
    })).rejects.toMatchObject({
      code: "AI_CONFIGURATION_MISSING",
      retryable: false,
      safeMessage:
        "Conversation Intelligence is not configured on the server.",
    });
    expect(mocks.updateAnalyses).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          lastErrorCode: "AI_CONFIGURATION_MISSING",
        }),
      }),
    );
  });

  it("stops immediately when cooperative cancellation is observed", async () => {
    mocks.heartbeat.mockResolvedValueOnce("cancelled");
    const provider = { analyze: vi.fn() };

    await expect(runConversationAnalysisJob(job(), {
      workerId: "worker-123",
      provider,
    })).rejects.toBeInstanceOf(JobCancelledError);

    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.withLease).not.toHaveBeenCalled();
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("fences a newer canonical job before provider work begins", async () => {
    mocks.findAnalysis.mockResolvedValueOnce({
      ...(await mocks.findAnalysis()),
      latestJobId: "cm333333333333333333333333",
    });
    const provider = { analyze: vi.fn() };

    await expect(runConversationAnalysisJob(job(), {
      workerId: "worker-123",
      provider,
    })).rejects.toBeInstanceOf(JobLeaseLostError);

    expect(mocks.withLease).not.toHaveBeenCalled();
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it("does not persist after losing the lease during finalization", async () => {
    mocks.withLease
      .mockImplementationOnce(async (
        _jobId: string,
        _workerId: string,
        mutation: (tx: unknown) => Promise<unknown>,
      ) => ({
        kind: "ok",
        value: await mutation({
          conversationAnalysis: {
            updateMany: mocks.updateAnalyses,
          },
        }),
      }))
      .mockResolvedValueOnce({ kind: "lost" });
    const provider = { analyze: vi.fn().mockResolvedValue(providerResult()) };

    await expect(runConversationAnalysisJob(job(), {
      workerId: "worker-123",
      provider,
    })).rejects.toBeInstanceOf(JobLeaseLostError);

    expect(provider.analyze).toHaveBeenCalledOnce();
    expect(mocks.updateAnalyses).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reuses canonical success after a crash without a second provider call", async () => {
    mocks.findAnalysis.mockResolvedValueOnce({
      id: analysisId,
      ownerId: "owner-a",
      conversationId,
      latestJobId: jobId,
      status: "COMPLETED",
      contentHash,
      analysisVersion: "conversation-v1",
      summary: validOutput().summary,
      structuredData: validOutput(),
      model: "configured-model",
      inputTokens: 700,
      outputTokens: 180,
      totalTokens: 880,
      durationMs: 2_500,
      sourceMessageCount: 1,
      inputTruncated: false,
      completedAt: now,
    });
    const provider = { analyze: vi.fn() };

    await expect(runConversationAnalysisJob(job(), {
      workerId: "worker-123",
      provider,
    })).resolves.toEqual({
      conversationAnalysisId: analysisId,
      contentHash,
      analysisVersion: "conversation-v1",
      outcome: "COMPLETED",
      model: "configured-model",
      inputTokens: 700,
      outputTokens: 180,
      totalTokens: 880,
      durationMs: 2_500,
      inputTruncated: false,
    });

    expect(provider.analyze).not.toHaveBeenCalled();
    expect(mocks.withLease).not.toHaveBeenCalled();
    expect(mocks.heartbeat).toHaveBeenCalledTimes(1);
    expect(mocks.createActivities).not.toHaveBeenCalled();
  });
});
