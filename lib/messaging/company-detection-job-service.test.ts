import { JobStatus, JobType, type Job } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findConversation: vi.fn(),
  findJob: vi.fn(),
  createJob: vi.fn(),
  transaction: vi.fn(),
}));

const conversationId = "cm123456789012345678901234";
const now = new Date("2026-07-29T20:00:00.000Z");

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "cm987654321098765432109876",
    ownerId: "owner-a",
    type: JobType.COMPANY_DETECTION,
    status: JobStatus.PENDING,
    payload: {
      conversationId,
      trigger: "GMAIL_IMPORT",
    },
    result: null,
    progress: {
      phase: "QUEUED",
      processed: 0,
      message: "Company detection queued.",
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
    idempotencyKey: `gmail-import:${conversationId}`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import {
  companyDetectionIdempotencyKey,
  enqueueCompanyDetectionJob,
} from "./company-detection-job-service";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  mocks.findConversation.mockResolvedValue({ id: conversationId });
  mocks.findJob.mockResolvedValue(null);
  mocks.createJob.mockResolvedValue(job());
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      conversation: { findFirst: mocks.findConversation },
      job: {
        findFirst: mocks.findJob,
        create: mocks.createJob,
      },
    }),
  );
});

describe("company detection job enqueue", () => {
  it("owner-scopes a credential-free payload with a deterministic active key", async () => {
    await expect(enqueueCompanyDetectionJob({
      ownerId: "owner-a",
      conversationId,
    })).resolves.toEqual(expect.objectContaining({
      kind: "queued",
      job: expect.objectContaining({
        type: JobType.COMPANY_DETECTION,
      }),
    }));

    expect(mocks.findConversation).toHaveBeenCalledWith({
      where: {
        id: conversationId,
        ownerId: "owner-a",
        leadId: { not: null },
      },
      select: { id: true },
    });
    expect(mocks.createJob).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: "owner-a",
        type: JobType.COMPANY_DETECTION,
        payload: {
          conversationId,
          trigger: "GMAIL_IMPORT",
        },
        progress: {
          phase: "QUEUED",
          processed: 0,
          message: "Company detection queued.",
        },
        idempotencyKey: `gmail-import:${conversationId}`,
      }),
    });
    expect(JSON.stringify(mocks.createJob.mock.calls[0][0])).not.toMatch(
      /message.?body|company.?name|access.?token|refresh.?token/i,
    );
  });

  it("reuses the same active job and rejects unowned or malformed conversations", async () => {
    mocks.findJob.mockResolvedValueOnce(job({ status: JobStatus.RUNNING }));

    await expect(enqueueCompanyDetectionJob({
      ownerId: "owner-a",
      conversationId,
    })).resolves.toEqual(expect.objectContaining({ kind: "existing" }));
    expect(mocks.findJob).toHaveBeenCalledWith({
      where: {
        ownerId: "owner-a",
        type: JobType.COMPANY_DETECTION,
        idempotencyKey: companyDetectionIdempotencyKey(conversationId),
        status: {
          in: ["PENDING", "RUNNING", "RETRY_SCHEDULED"],
        },
      },
    });
    expect(mocks.createJob).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.findConversation.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        conversation: { findFirst: mocks.findConversation },
        job: {
          findFirst: mocks.findJob,
          create: mocks.createJob,
        },
      }),
    );
    await expect(enqueueCompanyDetectionJob({
      ownerId: "other-owner",
      conversationId,
    })).resolves.toEqual({ kind: "not-found" });
    expect(mocks.createJob).not.toHaveBeenCalled();

    await expect(enqueueCompanyDetectionJob({
      ownerId: "owner-a",
      conversationId: "forged",
    })).rejects.toBeInstanceOf(Error);
  });
});
