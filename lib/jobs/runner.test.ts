import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@prisma/client";
import {
  ConversationAnalysisAttemptError,
  JobCancelledError,
  JobExecutionError,
} from "./errors";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  completeCancelled: vi.fn(),
  retry: vi.fn(),
  recover: vi.fn(),
  purge: vi.fn(),
  runGmail: vi.fn(),
  runAnalysis: vi.fn(),
  reconcileAnalysis: vi.fn(),
  reconcileFailedAnalysis: vi.fn(),
  log: vi.fn(),
}));

vi.mock("./service", () => ({
  claimNextJob: mocks.claim,
  completeJob: mocks.complete,
  completeCancelledJob: mocks.completeCancelled,
  retryJob: mocks.retry,
  recoverStaleJobs: mocks.recover,
  purgeExpiredJobs: mocks.purge,
}));
vi.mock("./handlers/gmail-sync", () => {
  class JobLeaseLostError extends Error {}
  return {
    runGmailSyncJob: mocks.runGmail,
    JobLeaseLostError,
  };
});
vi.mock("./handlers/conversation-analysis", () => ({
  runConversationAnalysisJob: mocks.runAnalysis,
}));
vi.mock("@/lib/ai/conversation-analysis/job-service", () => ({
  reconcileConversationAnalysisAfterCompletion: mocks.reconcileAnalysis,
  reconcileConversationAnalysisAfterTerminalFailure:
    mocks.reconcileFailedAnalysis,
}));
vi.mock("./logging", () => ({ logJobEvent: mocks.log }));

import { runJobInvocation } from "./runner";

const now = new Date("2026-07-27T20:00:00.000Z");
const job = (id: string): Job => ({
  id,
  ownerId: "owner-a",
  type: "GMAIL_SYNC",
  status: "RUNNING",
  payload: {},
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
  idempotencyKey: "account-a",
  createdAt: now,
  updatedAt: now,
});

const result = {
  accountsProcessed: 1,
  conversationsProcessed: 1,
  conversationsCreated: 1,
  conversationsUpdated: 0,
  messagesCreated: 2,
  messagesSkipped: 0,
  conversationsMatched: 0,
  conversationsNeedingReview: 1,
  errors: [],
  startedAt: now.toISOString(),
  completedAt: now.toISOString(),
};

const analysisResult = {
  conversationAnalysisId: "cm123456789012345678901234",
  contentHash: "a".repeat(64),
  analysisVersion: "conversation-v1",
  outcome: "COMPLETED",
  model: "configured-model",
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  durationMs: 250,
  inputTruncated: false,
} as const;

beforeEach(() => {
  mocks.claim.mockReset();
  mocks.complete.mockReset();
  mocks.completeCancelled.mockReset();
  mocks.retry.mockReset();
  mocks.recover.mockReset();
  mocks.purge.mockReset();
  mocks.runGmail.mockReset();
  mocks.runAnalysis.mockReset();
  mocks.reconcileAnalysis.mockReset();
  mocks.reconcileFailedAnalysis.mockReset();
  mocks.recover.mockResolvedValue({ recovered: 0, retried: 0, failed: 0 });
  mocks.purge.mockResolvedValue({ deleted: 0 });
  mocks.complete.mockResolvedValue(true);
  mocks.completeCancelled.mockResolvedValue(true);
  mocks.runGmail.mockResolvedValue(result);
  mocks.runAnalysis.mockResolvedValue(analysisResult);
  mocks.reconcileAnalysis.mockResolvedValue({ kind: "unchanged" });
  mocks.reconcileFailedAnalysis.mockResolvedValue({ kind: "unchanged" });
});

describe("generic job invocation", () => {
  it("claims and completes only the bounded number of jobs", async () => {
    mocks.claim
      .mockResolvedValueOnce(job("job-a"))
      .mockResolvedValueOnce(job("job-b"))
      .mockResolvedValueOnce(job("job-c"));

    const stats = await runJobInvocation({
      workerId: "worker-123",
      maxJobs: 2,
      timeBudgetMs: 45_000,
    });

    expect(stats).toEqual(expect.objectContaining({
      claimed: 2,
      completed: 2,
      retried: 0,
      failed: 0,
    }));
    expect(mocks.runGmail).toHaveBeenCalledTimes(2);
    expect(mocks.runGmail).toHaveBeenNthCalledWith(
      1,
      job("job-a"),
      {
        workerId: "worker-123",
        deadlineAt: expect.any(Number),
      },
    );
    expect(mocks.claim).toHaveBeenCalledTimes(2);
  });

  it("dispatches Conversation Analysis through the same worker and reconciles changed content", async () => {
    const analysisJob: Job = {
      ...job("job-analysis"),
      type: "CONVERSATION_ANALYSIS",
      payload: {
        conversationId: "cm987654321098765432109876",
        trigger: "GMAIL_IMPORT",
        force: false,
        analysisVersion: "conversation-v1",
      },
      idempotencyKey: "cm987654321098765432109876",
    };
    mocks.claim.mockResolvedValueOnce(analysisJob).mockResolvedValueOnce(null);

    await expect(
      runJobInvocation({
        workerId: "worker-123",
        maxJobs: 3,
        timeBudgetMs: 45_000,
      }),
    ).resolves.toEqual(expect.objectContaining({ completed: 1 }));

    expect(mocks.runAnalysis).toHaveBeenCalledWith(analysisJob, {
      workerId: "worker-123",
      deadlineAt: expect.any(Number),
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      "job-analysis",
      "worker-123",
      analysisResult,
      undefined,
      "CONVERSATION_ANALYSIS",
    );
    expect(mocks.reconcileAnalysis).toHaveBeenCalledWith(
      "owner-a",
      "cm987654321098765432109876",
    );
  });

  it("persists retry and permanent-failure outcomes", async () => {
    mocks.claim.mockResolvedValueOnce(job("job-retry")).mockResolvedValue(null);
    mocks.runGmail.mockRejectedValueOnce(
      new JobExecutionError("TEMPORARY", "Temporary failure.", true),
    );
    mocks.retry.mockResolvedValueOnce({
      kind: "retry-scheduled",
      availableAt: new Date(now.getTime() + 30_000),
    });
    await expect(runJobInvocation({
      workerId: "worker-123",
      maxJobs: 3,
      timeBudgetMs: 45_000,
    })).resolves.toEqual(expect.objectContaining({ retried: 1 }));

    mocks.claim.mockResolvedValueOnce(job("job-fail")).mockResolvedValue(null);
    mocks.runGmail.mockRejectedValueOnce(
      new JobExecutionError("PERMANENT", "Permanent failure.", false),
    );
    mocks.retry.mockResolvedValueOnce({ kind: "failed" });
    await expect(runJobInvocation({
      workerId: "worker-123",
      maxJobs: 3,
      timeBudgetMs: 45_000,
    })).resolves.toEqual(expect.objectContaining({ failed: 1 }));
  });

  it("queues a successor after terminal analysis failure only when the handler reports newer content", async () => {
    const conversationId = "cm987654321098765432109876";
    const analysisJob: Job = {
      ...job("job-analysis-failure"),
      type: "CONVERSATION_ANALYSIS",
      payload: {
        conversationId,
        trigger: "GMAIL_IMPORT",
        force: false,
        analysisVersion: "conversation-v1",
      },
      idempotencyKey: conversationId,
    };
    const providerFailure = new JobExecutionError(
      "OPENAI_REQUEST_REJECTED",
      "The provider rejected the request.",
      false,
    );
    mocks.claim.mockResolvedValueOnce(analysisJob).mockResolvedValueOnce(null);
    mocks.runAnalysis.mockRejectedValueOnce(
      new ConversationAnalysisAttemptError(
        providerFailure,
        conversationId,
        "b".repeat(64),
      ),
    );
    mocks.retry.mockResolvedValueOnce({ kind: "failed" });

    await expect(
      runJobInvocation({
        workerId: "worker-123",
        maxJobs: 3,
        timeBudgetMs: 45_000,
      }),
    ).resolves.toEqual(expect.objectContaining({ failed: 1 }));

    expect(mocks.reconcileFailedAnalysis).toHaveBeenCalledWith(
      "owner-a",
      conversationId,
      "b".repeat(64),
    );
  });

  it("acknowledges cooperative cancellation", async () => {
    mocks.claim.mockResolvedValueOnce(job("job-cancel")).mockResolvedValue(null);
    mocks.runGmail.mockRejectedValueOnce(new JobCancelledError());
    await expect(runJobInvocation({
      workerId: "worker-123",
      maxJobs: 3,
      timeBudgetMs: 45_000,
    })).resolves.toEqual(expect.objectContaining({ cancelled: 1 }));
    expect(mocks.completeCancelled).toHaveBeenCalledWith(
      "job-cancel",
      "worker-123",
    );
  });

  it("acknowledges cancellation that wins after the final heartbeat", async () => {
    mocks.claim
      .mockResolvedValueOnce(job("job-final-race"))
      .mockResolvedValue(null);
    mocks.complete.mockResolvedValueOnce(false);

    await expect(runJobInvocation({
      workerId: "worker-123",
      maxJobs: 3,
      timeBudgetMs: 45_000,
    })).resolves.toEqual(expect.objectContaining({
      completed: 0,
      cancelled: 1,
      leaseLost: 0,
    }));
    expect(mocks.completeCancelled).toHaveBeenCalledWith(
      "job-final-race",
      "worker-123",
    );
  });

  it("stops claiming before the configured execution deadline", async () => {
    const clock = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(950)
      .mockReturnValueOnce(1_000);
    await expect(runJobInvocation({
      workerId: "worker-123",
      maxJobs: 10,
      timeBudgetMs: 1_000,
      now: clock,
    })).resolves.toEqual(expect.objectContaining({
      claimed: 0,
      stoppedForTimeBudget: true,
      durationMs: 1_000,
    }));
    expect(mocks.claim).not.toHaveBeenCalled();
  });
});
