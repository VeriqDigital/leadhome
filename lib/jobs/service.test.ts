import { JobStatus, JobType, type Job } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobExecutionError } from "./errors";

const mocks = vi.hoisted(() => ({
  findAccount: vi.fn(),
  updateAccounts: vi.fn(),
  deleteCredentials: vi.fn(),
  createJob: vi.fn(),
  findJob: vi.fn(),
  findUniqueJob: vi.fn(),
  findJobs: vi.fn(),
  updateJobs: vi.fn(),
  updateJob: vi.fn(),
  queryRaw: vi.fn(),
  txQueryRaw: vi.fn(),
  txExecuteRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: {
      create: mocks.createJob,
      findFirst: mocks.findJob,
      findUnique: mocks.findUniqueJob,
      findMany: mocks.findJobs,
      updateMany: mocks.updateJobs,
      update: mocks.updateJob,
    },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));

import {
  cancelActiveGmailSyncJobs,
  cancelPendingJob,
  claimNextJob,
  completeJob,
  disconnectGmailAccount,
  enqueueGmailSyncJob,
  getJob,
  heartbeatJob,
  purgeExpiredJobs,
  recoverStaleJobs,
  retryDelayMs,
  retryJob,
  serializeConversationAnalysisJob,
  withJobLease,
} from "./service";

const accountId = "cmrzmqfg0000b9u07wgtw2me";
const jobId = "cmrwxawgy0005j9kc6szawqx2";
const now = new Date("2026-07-27T20:00:00.000Z");
const workerId = "worker-00000001";

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: jobId,
    ownerId: "owner-a",
    type: JobType.GMAIL_SYNC,
    status: JobStatus.PENDING,
    payload: {
      communicationAccountId: accountId,
      requestedBy: "USER",
      threadLimit: 50,
      trigger: "MANUAL",
    },
    result: null,
    progress: {
      phase: "QUEUED",
      processed: 0,
      message: "Sync queued.",
    },
    attemptCount: 0,
    maxAttempts: 3,
    availableAt: now,
    lockedAt: null,
    lockedBy: null,
    heartbeatAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    idempotencyKey: accountId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function queryText(callIndex = 0): string {
  const query = mocks.queryRaw.mock.calls[callIndex]?.[0] as
    | { strings?: readonly string[] }
    | undefined;
  return query?.strings?.join("?") ?? "";
}

function txQueryText(callIndex = 0): string {
  const query = mocks.txQueryRaw.mock.calls[callIndex]?.[0] as
    | { strings?: readonly string[] }
    | undefined;
  return query?.strings?.join("?") ?? "";
}

function txExecuteText(callIndex = 0): string {
  const query = mocks.txExecuteRaw.mock.calls[callIndex]?.[0] as
    | { strings?: readonly string[] }
    | undefined;
  return query?.strings?.join("?") ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.createJob.mockResolvedValue(job());
  mocks.findAccount.mockResolvedValue({
    id: accountId,
    gmailCredential: {
      encryptedRefreshToken: "encrypted-refresh-token",
    },
  });
  mocks.updateAccounts.mockResolvedValue({ count: 1 });
  mocks.deleteCredentials.mockResolvedValue({ count: 1 });
  mocks.findJob.mockResolvedValue(null);
  mocks.findUniqueJob.mockResolvedValue(null);
  mocks.findJobs.mockResolvedValue([]);
  mocks.updateJobs.mockResolvedValue({ count: 1 });
  mocks.updateJob.mockResolvedValue(job());
  mocks.queryRaw.mockResolvedValue([]);
  mocks.txQueryRaw.mockResolvedValue([]);
  mocks.txExecuteRaw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      $queryRaw: mocks.txQueryRaw,
      $executeRaw: mocks.txExecuteRaw,
      communicationAccount: {
        findFirst: mocks.findAccount,
        updateMany: mocks.updateAccounts,
      },
      gmailCredential: {
        deleteMany: mocks.deleteCredentials,
      },
      job: {
        create: mocks.createJob,
        findFirst: mocks.findJob,
        update: mocks.updateJob,
      },
    }),
  );
});

describe("Gmail job enqueue and owner isolation", () => {
  it("queues a bounded credential-free Gmail payload", async () => {
    await expect(
      enqueueGmailSyncJob("owner-a", accountId),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: "queued",
        job: expect.objectContaining({
          id: jobId,
          communicationAccountId: accountId,
          status: JobStatus.PENDING,
        }),
      }),
    );

    expect(txExecuteText()).toContain("pg_advisory_xact_lock");
    expect(mocks.findAccount).toHaveBeenCalledWith({
      where: {
        id: accountId,
        ownerId: "owner-a",
        provider: "GMAIL",
        status: "CONNECTED",
      },
      select: { id: true },
    });
    const payload = mocks.createJob.mock.calls[0][0].data.payload;
    expect(payload).toEqual({
      communicationAccountId: accountId,
      requestedBy: "USER",
      threadLimit: 50,
      trigger: "MANUAL",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /access.?token|refresh.?token|authorization.?code|message.?body/i,
    );
  });

  it("returns the one existing active job while holding the account mutex", async () => {
    mocks.findJob.mockResolvedValueOnce(job({ status: JobStatus.RUNNING }));

    const result = await enqueueGmailSyncJob("owner-a", accountId);

    expect(result.kind).toBe("existing");
    expect(mocks.findJob).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-a",
        type: JobType.GMAIL_SYNC,
        idempotencyKey: accountId,
        status: {
          in: ["PENDING", "RUNNING", "RETRY_SCHEDULED"],
        },
      },
    });
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(txExecuteText()).toContain("pg_advisory_xact_lock");
  });

  it("allows a later job after a terminal transition cleared its active key", async () => {
    mocks.createJob.mockResolvedValueOnce(
      job({ id: "cmrwxawgy0005j9kc6szawqx3" }),
    );

    const result = await enqueueGmailSyncJob("owner-a", accountId);

    expect(result.kind).toBe("queued");
    expect(mocks.createJob).toHaveBeenCalledOnce();
  });

  it("rejects malformed or wrong-owner accounts before creating a job", async () => {
    await expect(
      enqueueGmailSyncJob("owner-a", "forged"),
    ).rejects.toBeInstanceOf(Error);
    expect(mocks.transaction).not.toHaveBeenCalled();

    mocks.findAccount.mockResolvedValueOnce(null);
    await expect(
      enqueueGmailSyncJob("owner-a", accountId),
    ).resolves.toEqual({ kind: "not-found" });
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it("owner-scopes direct job reads", async () => {
    await getJob("owner-a", jobId);
    expect(mocks.findJob).toHaveBeenCalledWith({
      where: { id: jobId, ownerId: "owner-a" },
    });
  });

  it("keeps public analysis job views free of hashes, model names, and token usage", () => {
    const view = serializeConversationAnalysisJob(job({
      type: JobType.CONVERSATION_ANALYSIS,
      payload: {
        conversationId: accountId,
        trigger: "MANUAL_REANALYSIS",
        force: true,
        analysisVersion: "conversation-v1",
      },
      result: {
        conversationAnalysisId: jobId,
        contentHash: "a".repeat(64),
        analysisVersion: "conversation-v1",
        outcome: "COMPLETED",
        model: "private-model-name",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        durationMs: 250,
        inputTruncated: true,
      },
    }));

    expect(view.result).toEqual({
      outcome: "COMPLETED",
      inputTruncated: true,
    });
    expect(JSON.stringify(view)).not.toMatch(
      /contentHash|private-model-name|inputTokens|outputTokens|totalTokens/,
    );
  });
});

describe("atomic claiming and lifecycle fencing", () => {
  it("claims with one PostgreSQL CTE, stable ordering, and SKIP LOCKED", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      job({
        status: JobStatus.RUNNING,
        attemptCount: 1,
        lockedAt: now,
        lockedBy: workerId,
        heartbeatAt: now,
      }),
    ]);

    const claimed = await claimNextJob(workerId, now);

    expect(claimed).toEqual(
      expect.objectContaining({
        status: JobStatus.RUNNING,
        attemptCount: 1,
        lockedBy: workerId,
      }),
    );
    const sql = queryText();
    expect(sql).toContain('WITH "candidate" AS');
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain(
      'ORDER BY "availableAt" ASC, "createdAt" ASC, "id" ASC',
    );
    expect(sql).toContain('"availableAt" <= ?');
    expect(sql).toContain('"attemptCount" = job."attemptCount" + 1');
    expect(sql).toContain("'PENDING'::\"JobStatus\"");
    expect(sql).toContain("'RETRY_SCHEDULED'::\"JobStatus\"");
    expect(sql).not.toContain("'CANCELLED'::\"JobStatus\"");
  });

  it("returns no work when another worker already claimed the eligible row", async () => {
    mocks.queryRaw.mockResolvedValueOnce([job()]).mockResolvedValueOnce([]);
    expect(await claimNextJob("worker-00000001", now)).not.toBeNull();
    expect(await claimNextJob("worker-00000002", now)).toBeNull();
  });

  it("fences heartbeat updates and distinguishes cooperative cancellation", async () => {
    await expect(
      heartbeatJob(
        jobId,
        workerId,
        {
          phase: "IMPORTING_THREADS",
          processed: 5,
          total: 10,
          percent: 50,
          message: "Importing Gmail threads.",
        },
        now,
      ),
    ).resolves.toBe("ok");
    expect(mocks.updateJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: jobId,
          status: JobStatus.RUNNING,
          lockedBy: workerId,
        },
      }),
    );

    mocks.updateJobs.mockResolvedValueOnce({ count: 0 });
    mocks.findUniqueJob.mockResolvedValueOnce({
      status: JobStatus.CANCELLED,
      lockedBy: workerId,
    });
    await expect(heartbeatJob(jobId, workerId, undefined, now)).resolves.toBe(
      "cancelled",
    );

    mocks.updateJobs.mockResolvedValueOnce({ count: 0 });
    mocks.findUniqueJob.mockResolvedValueOnce({
      status: JobStatus.RUNNING,
      lockedBy: "new-worker",
    });
    await expect(heartbeatJob(jobId, workerId, undefined, now)).resolves.toBe(
      "lost",
    );
  });

  it("runs side effects only while the worker still owns the locked lease", async () => {
    const mutation = vi.fn(async () => "stored");
    mocks.txQueryRaw.mockResolvedValueOnce([
      { status: JobStatus.RUNNING, lockedBy: workerId },
    ]);

    await expect(
      withJobLease(jobId, workerId, mutation, now),
    ).resolves.toEqual({ kind: "ok", value: "stored" });
    expect(mocks.updateJob).toHaveBeenCalledWith({
      where: { id: jobId },
      data: { heartbeatAt: now },
    });
    expect(mutation).toHaveBeenCalledOnce();
    expect(txQueryText()).toContain('FROM "Job"');
    expect(txQueryText()).toContain("FOR UPDATE");

    mutation.mockClear();
    mocks.txQueryRaw.mockResolvedValueOnce([
      { status: JobStatus.CANCELLED, lockedBy: workerId },
    ]);
    await expect(
      withJobLease(jobId, workerId, mutation, now),
    ).resolves.toEqual({ kind: "cancelled" });
    expect(mutation).not.toHaveBeenCalled();
  });

  it("completes only the owned lease and clears locks and the active key", async () => {
    const result = {
      accountsProcessed: 1,
      conversationsProcessed: 2,
      conversationsCreated: 1,
      conversationsUpdated: 1,
      messagesCreated: 3,
      messagesSkipped: 2,
      conversationsMatched: 1,
      conversationsNeedingReview: 1,
      errors: [],
      startedAt: "2026-07-27T19:59:00.000Z",
      completedAt: now.toISOString(),
    };

    await expect(completeJob(jobId, workerId, result, now)).resolves.toBe(true);
    expect(mocks.updateJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: jobId,
          type: JobType.GMAIL_SYNC,
          status: JobStatus.RUNNING,
          lockedBy: workerId,
        },
        data: expect.objectContaining({
          status: JobStatus.COMPLETED,
          result,
          lockedAt: null,
          lockedBy: null,
          idempotencyKey: null,
        }),
      }),
    );
  });

  it("persists bounded Conversation Analysis progress and completion through the generic service", async () => {
    await expect(
      heartbeatJob(
        jobId,
        workerId,
        {
          phase: "ANALYZING",
          processed: 1,
          total: 3,
          percent: 30,
          message: "Analyzing the conversation.",
        },
        now,
      ),
    ).resolves.toBe("ok");
    expect(mocks.updateJobs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          progress: expect.objectContaining({ phase: "ANALYZING" }),
        }),
      }),
    );

    const analysisResult = {
      conversationAnalysisId: "cm123456789012345678901234",
      contentHash: "a".repeat(64),
      analysisVersion: "conversation-v1",
      outcome: "COMPLETED" as const,
      model: "configured-model",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      durationMs: 250,
      inputTruncated: false,
    };
    await expect(
      completeJob(
        jobId,
        workerId,
        analysisResult,
        now,
        JobType.CONVERSATION_ANALYSIS,
      ),
    ).resolves.toBe(true);
    expect(mocks.updateJobs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: jobId,
          type: JobType.CONVERSATION_ANALYSIS,
          status: JobStatus.RUNNING,
          lockedBy: workerId,
        },
        data: expect.objectContaining({
          status: JobStatus.COMPLETED,
          result: analysisResult,
          progress: expect.objectContaining({
            phase: "COMPLETED",
          }),
          idempotencyKey: null,
        }),
      }),
    );
  });
});

describe("retry policy, cancellation, stale recovery, and retention", () => {
  it("uses increasing retry delays with bounded jitter", () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(30_000);
    expect(retryDelayMs(2, () => 0.5)).toBe(120_000);
    expect(retryDelayMs(3, () => 0.5)).toBe(600_000);
    expect(retryDelayMs(1, () => 0)).toBe(24_000);
    expect(retryDelayMs(1, () => 1)).toBe(36_000);
    expect(retryDelayMs(20, () => 0.5)).toBe(3_600_000);
  });

  it("persists retry eligibility and fails after the bounded final attempt", async () => {
    mocks.findJob.mockResolvedValueOnce({
      attemptCount: 1,
      maxAttempts: 3,
    });
    const transient = new JobExecutionError(
      "GMAIL_RATE_LIMIT",
      "Gmail is temporarily unavailable.",
      true,
    );
    await expect(
      retryJob(jobId, workerId, transient, now, () => 0.5),
    ).resolves.toEqual({
      kind: "retry-scheduled",
      availableAt: new Date("2026-07-27T20:00:30.000Z"),
    });
    expect(mocks.updateJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: JobStatus.RETRY_SCHEDULED,
          availableAt: new Date("2026-07-27T20:00:30.000Z"),
          lockedAt: null,
          lockedBy: null,
        }),
      }),
    );

    vi.clearAllMocks();
    mocks.findJob.mockResolvedValueOnce({
      attemptCount: 3,
      maxAttempts: 3,
    });
    mocks.updateJobs.mockResolvedValue({ count: 1 });
    await expect(
      retryJob(jobId, workerId, transient, now, () => 0.5),
    ).resolves.toEqual({ kind: "failed" });
    expect(mocks.updateJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: JobStatus.FAILED,
          idempotencyKey: null,
        }),
      }),
    );
  });

  it("owner-scopes queued cancellation and requests running cancellation", async () => {
    await expect(
      cancelPendingJob("owner-a", jobId, now),
    ).resolves.toEqual({ kind: "cancelled" });
    expect(mocks.updateJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: jobId,
          ownerId: "owner-a",
          status: { in: [JobStatus.PENDING, JobStatus.RETRY_SCHEDULED] },
        }),
      }),
    );

    mocks.txQueryRaw.mockImplementation(async (query) =>
      (query as { strings?: readonly string[] }).strings
        ?.join("")
        .includes('WITH "active" AS')
        ? [{ cancelled: 2, cancellationRequested: 1 }]
        : [],
    );
    await expect(
      cancelActiveGmailSyncJobs("owner-a", accountId, now),
    ).resolves.toEqual({
      cancelled: 2,
      cancellationRequested: 1,
    });
    const sql = txQueryText(0);
    expect(sql).toContain('"payload"->>\'communicationAccountId\' = ?');
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("'PENDING'::\"JobStatus\"");
    expect(sql).toContain("'RUNNING'::\"JobStatus\"");
    expect(sql).toContain("'RETRY_SCHEDULED'::\"JobStatus\"");
    expect(sql).toContain('"idempotencyKey" = NULL');
  });

  it("serializes disconnect and cancels Jobs before mutating the account", async () => {
    mocks.txQueryRaw.mockImplementation(async (query) =>
      (query as { strings?: readonly string[] }).strings
        ?.join("")
        .includes('WITH "active" AS')
        ? [{ cancelled: 1, cancellationRequested: 1 }]
        : [],
    );

    await expect(
      disconnectGmailAccount("owner-a", accountId, now),
    ).resolves.toEqual({
      kind: "disconnected",
      encryptedRefreshToken: "encrypted-refresh-token",
      cancelled: 1,
      cancellationRequested: 1,
    });
    expect(txExecuteText(0)).toContain("pg_advisory_xact_lock");
    expect(txQueryText(0)).toContain('WITH "active" AS');
    expect(
      mocks.txQueryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.updateAccounts.mock.invocationCallOrder[0]);
    expect(mocks.updateAccounts).toHaveBeenCalledWith({
      where: {
        id: accountId,
        ownerId: "owner-a",
        provider: "GMAIL",
      },
      data: {
        status: "DISCONNECTED",
        disconnectedAt: now,
        tokenExpiresAt: null,
      },
    });
    expect(mocks.deleteCredentials).toHaveBeenCalledWith({
      where: { communicationAccountId: accountId },
    });
  });

  it("recovers one stale lease once across concurrent recovery invocations", async () => {
    const stale = job({
      status: JobStatus.RUNNING,
      attemptCount: 1,
      lockedAt: new Date("2026-07-27T19:00:00.000Z"),
      heartbeatAt: new Date("2026-07-27T19:00:00.000Z"),
      lockedBy: "old-worker",
    });
    let rowAvailable = true;
    const recoveredUpdates: object[] = [];
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        $queryRaw: vi.fn(async () => {
          if (!rowAvailable) return [];
          rowAvailable = false;
          return [stale];
        }),
        job: {
          update: vi.fn(async ({ data }) => {
            recoveredUpdates.push(data);
            return { ...stale, ...data };
          }),
        },
      }),
    );

    const [first, second] = await Promise.all([
      recoverStaleJobs({
        now,
        staleAfterMs: 60_000,
        limit: 1,
        random: () => 0.5,
      }),
      recoverStaleJobs({
        now,
        staleAfterMs: 60_000,
        limit: 1,
        random: () => 0.5,
      }),
    ]);

    expect(first.recovered + second.recovered).toBe(1);
    expect(first.retried + second.retried).toBe(1);
    expect(recoveredUpdates).toEqual([
      expect.objectContaining({
        status: JobStatus.RETRY_SCHEDULED,
        lockedAt: null,
        lockedBy: null,
      }),
    ]);
  });

  it("does not recover a recent heartbeat and permanently fails exhausted stale work", async () => {
    mocks.transaction.mockImplementationOnce(async (operation) =>
      operation({
        $queryRaw: vi.fn(async () => []),
        job: { update: vi.fn() },
      }),
    );
    await expect(
      recoverStaleJobs({ now, staleAfterMs: 60_000, limit: 1 }),
    ).resolves.toEqual({ recovered: 0, retried: 0, failed: 0 });

    const exhausted = job({
      status: JobStatus.RUNNING,
      attemptCount: 3,
      maxAttempts: 3,
      lockedBy: "old-worker",
    });
    const update = vi.fn(async ({ data }) => ({ ...exhausted, ...data }));
    let selected = false;
    mocks.transaction.mockImplementationOnce(async (operation) =>
      operation({
        $queryRaw: vi.fn(async () => {
          if (selected) return [];
          selected = true;
          return [exhausted];
        }),
        job: { update },
      }),
    );
    await expect(
      recoverStaleJobs({ now, staleAfterMs: 60_000, limit: 1 }),
    ).resolves.toEqual({ recovered: 1, retried: 0, failed: 1 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: JobStatus.FAILED,
          idempotencyKey: null,
        }),
      }),
    );
  });

  it("purges only a bounded terminal retention batch", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: "old-1" }, { id: "old-2" }]);

    await expect(
      purgeExpiredJobs({ now, limit: 2 }),
    ).resolves.toEqual({ deleted: 2 });

    const sql = queryText();
    expect(sql).toContain("'COMPLETED'::\"JobStatus\"");
    expect(sql).toContain("'CANCELLED'::\"JobStatus\"");
    expect(sql).toContain("'FAILED'::\"JobStatus\"");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("LIMIT ?");
  });
});
