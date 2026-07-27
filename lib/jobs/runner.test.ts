import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobCancelledError, JobExecutionError } from "./errors";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  completeCancelled: vi.fn(),
  retry: vi.fn(),
  recover: vi.fn(),
  purge: vi.fn(),
  runGmail: vi.fn(),
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
vi.mock("./logging", () => ({ logJobEvent: mocks.log }));

import { runJobInvocation } from "./runner";

const now = new Date("2026-07-27T20:00:00.000Z");
const job = (id: string) => ({
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
}) as never;

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

beforeEach(() => {
  mocks.recover.mockResolvedValue({ recovered: 0, retried: 0, failed: 0 });
  mocks.purge.mockResolvedValue({ deleted: 0 });
  mocks.complete.mockResolvedValue(true);
  mocks.completeCancelled.mockResolvedValue(true);
  mocks.runGmail.mockResolvedValue(result);
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
