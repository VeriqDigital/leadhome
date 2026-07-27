import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobCancelledError, JobExecutionError } from "../errors";

const mocks = vi.hoisted(() => ({
  findAccount: vi.fn(),
  updateAccounts: vi.fn(),
  importAccount: vi.fn(),
  heartbeat: vi.fn(),
  withLease: vi.fn(),
  provider: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationAccount: {
      findFirst: mocks.findAccount,
      updateMany: mocks.updateAccounts,
    },
  },
}));
vi.mock("@/lib/messaging/import-service", () => ({
  importProviderAccount: mocks.importAccount,
}));
vi.mock("@/lib/messaging/gmail-provider", () => ({
  GmailProvider: class {
    constructor(...args: unknown[]) {
      mocks.provider(...args);
    }
  },
}));
vi.mock("@/lib/jobs/service", () => ({
  heartbeatJob: mocks.heartbeat,
  withJobLease: mocks.withLease,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  classifyGmailSyncError,
  JobLeaseLostError,
  runGmailSyncJob,
} from "./gmail-sync";

const accountId = "cm123456789012345678901234";
const timestamp = new Date("2026-07-27T20:00:00.000Z");
const baseJob = {
  id: "cm987654321098765432109876",
  ownerId: "owner-a",
  type: "GMAIL_SYNC",
  status: "RUNNING",
  payload: {
    communicationAccountId: accountId,
    requestedBy: "USER",
    threadLimit: 50,
    trigger: "MANUAL",
  },
  result: null,
  progress: null,
  attemptCount: 1,
  maxAttempts: 3,
  availableAt: timestamp,
  lockedAt: timestamp,
  lockedBy: "worker-123",
  heartbeatAt: timestamp,
  startedAt: timestamp,
  completedAt: null,
  failedAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  idempotencyKey: accountId,
  createdAt: timestamp,
  updatedAt: timestamp,
} as const;

const summary = {
  accountsProcessed: 1,
  conversationsCreated: 1,
  conversationsUpdated: 2,
  messagesCreated: 3,
  messagesSkipped: 4,
  conversationsMatched: 1,
  conversationsNeedingReview: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAccount.mockResolvedValue({
    id: accountId,
    status: "CONNECTED",
    gmailCredential: { id: "credential-a" },
  });
  mocks.updateAccounts.mockResolvedValue({ count: 1 });
  mocks.heartbeat.mockResolvedValue("ok");
  mocks.withLease.mockImplementation(
    async (
      _jobId: string,
      _workerId: string,
      mutation: (tx: unknown) => Promise<unknown>,
    ) => ({
      kind: "ok",
      value: await mutation({
        communicationAccount: {
          updateMany: mocks.updateAccounts,
        },
      }),
    }),
  );
  mocks.importAccount.mockImplementation(async ({ options }) => {
    await options.onProgress({
      phase: "LISTING_THREADS",
      processed: 0,
      total: null,
      message: "Listing threads.",
    });
    await options.onProgress({
      phase: "MATCHING",
      processed: 3,
      total: 3,
      message: "Matching conversations.",
    });
    return summary;
  });
});

describe("Gmail sync job handler", () => {
  it("uses the existing importer, checkpoints progress, and returns a bounded result", async () => {
    await expect(
      runGmailSyncJob(baseJob as never, { workerId: "worker-123" }),
    ).resolves.toEqual(expect.objectContaining({
      ...summary,
      conversationsProcessed: 3,
      errors: [],
      startedAt: timestamp.toISOString(),
      completedAt: expect.any(String),
    }));
    expect(mocks.provider).toHaveBeenCalledWith(
      accountId,
      "owner-a",
      50,
      undefined,
    );
    expect(mocks.importAccount).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: "owner-a",
      options: expect.objectContaining({
        onProgress: expect.any(Function),
        persistAccountSummary: false,
      }),
    }));
    expect(mocks.heartbeat).toHaveBeenCalledWith(
      baseJob.id,
      "worker-123",
      expect.objectContaining({ phase: "CONNECTING" }),
    );
    expect(mocks.updateAccounts).toHaveBeenLastCalledWith({
      where: { id: accountId, ownerId: "owner-a", provider: "GMAIL" },
      data: {
        lastImportedAt: expect.any(Date),
        lastImportSummary: summary,
        lastSyncError: null,
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("rejects malformed or credential-bearing payloads before account access", async () => {
    await expect(runGmailSyncJob({
      ...baseJob,
      payload: {
        ...baseJob.payload,
        accessToken: "must-never-be-stored",
      },
    } as never, { workerId: "worker-123" })).rejects.toMatchObject({
      code: "INVALID_JOB_PAYLOAD",
      retryable: false,
    });
    expect(mocks.findAccount).not.toHaveBeenCalled();
  });

  it("rejects wrong-owner, disconnected, and missing-credential accounts permanently", async () => {
    mocks.findAccount.mockResolvedValueOnce(null);
    await expect(
      runGmailSyncJob(baseJob as never, { workerId: "worker-123" }),
    ).rejects.toMatchObject({
      code: "GMAIL_ACCOUNT_UNAVAILABLE",
      retryable: false,
    });

    mocks.findAccount.mockResolvedValueOnce({
      id: accountId,
      status: "CONNECTED",
      gmailCredential: null,
    });
    await expect(
      runGmailSyncJob(baseJob as never, { workerId: "worker-123" }),
    ).rejects.toMatchObject({
      code: "GMAIL_RECONNECT_REQUIRED",
      retryable: false,
    });
    expect(mocks.updateAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RECONNECT_REQUIRED" }),
      }),
    );
  });

  it("marks invalid_grant reconnect-required without retrying", async () => {
    mocks.importAccount.mockRejectedValue({
      response: { data: { error: "invalid_grant" } },
    });
    await expect(
      runGmailSyncJob(baseJob as never, { workerId: "worker-123" }),
    ).rejects.toMatchObject({
      code: "GMAIL_RECONNECT_REQUIRED",
      retryable: false,
    });
    expect(mocks.updateAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "RECONNECT_REQUIRED",
          lastSyncError: "Google access was revoked. Reconnect Gmail.",
        }),
      }),
    );
  });

  it("classifies rate limits, provider failures, network timeouts, and database outages as retryable", () => {
    for (const error of [
      { response: { status: 429 } },
      { response: { status: 503 } },
      { code: "ETIMEDOUT" },
      { code: "P1001" },
    ]) {
      expect(classifyGmailSyncError(error)).toEqual(
        expect.objectContaining({ retryable: true }),
      );
    }
    expect(
      classifyGmailSyncError(
        new JobExecutionError("PERMANENT", "Permanent.", false),
      ),
    ).toEqual(expect.objectContaining({
      code: "PERMANENT",
      retryable: false,
    }));
  });

  it("stops cooperatively when cancellation is observed at a checkpoint", async () => {
    mocks.heartbeat.mockResolvedValueOnce("cancelled");
    await expect(
      runGmailSyncJob(baseJob as never, { workerId: "worker-123" }),
    ).rejects.toBeInstanceOf(JobCancelledError);
    expect(mocks.importAccount).not.toHaveBeenCalled();
  });

  it("does not write a final account summary after losing the job lease", async () => {
    mocks.withLease.mockResolvedValueOnce({ kind: "lost" });

    await expect(
      runGmailSyncJob(baseJob as never, { workerId: "worker-123" }),
    ).rejects.toBeInstanceOf(JobLeaseLostError);
    expect(mocks.updateAccounts).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not write reconnect state when cancellation wins the failure race", async () => {
    mocks.importAccount.mockRejectedValueOnce({
      response: { data: { error: "invalid_grant" } },
    });
    mocks.withLease.mockResolvedValueOnce({ kind: "cancelled" });

    await expect(
      runGmailSyncJob(baseJob as never, { workerId: "worker-123" }),
    ).rejects.toBeInstanceOf(JobCancelledError);
    expect(mocks.updateAccounts).not.toHaveBeenCalled();
  });

  it("returns a retryable budget error when the invocation deadline is exhausted", async () => {
    await expect(
      runGmailSyncJob(baseJob as never, {
        workerId: "worker-123",
        deadlineAt: Date.now(),
      }),
    ).rejects.toMatchObject({
      code: "JOB_TIME_BUDGET_EXCEEDED",
      retryable: true,
    });
    expect(mocks.importAccount).not.toHaveBeenCalled();
  });
});
