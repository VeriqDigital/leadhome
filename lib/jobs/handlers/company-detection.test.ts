import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JobCancelledError,
  JobExecutionError,
  JobLeaseLostError,
} from "../errors";

const mocks = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  detect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/service", () => ({
  heartbeatJob: mocks.heartbeat,
}));
vi.mock("@/lib/messaging/company-detection-service", () => ({
  detectAndApplyConversationCompany: mocks.detect,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { runCompanyDetectionJob } from "./company-detection";

const conversationId = "cm123456789012345678901234";
const leadId = "cm987654321098765432109876";
const timestamp = new Date("2026-07-29T20:00:00.000Z");
const baseJob = {
  id: "cm111111111111111111111111",
  ownerId: "owner-a",
  type: "COMPANY_DETECTION",
  status: "RUNNING",
  payload: {
    conversationId,
    trigger: "GMAIL_IMPORT",
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
  idempotencyKey: `gmail-import:${conversationId}`,
  createdAt: timestamp,
  updatedAt: timestamp,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.heartbeat.mockResolvedValue("ok");
  mocks.detect.mockResolvedValue({
    changed: true,
    outcome: "APPLIED",
    companyView: {
      conversationId,
      lead: {
        id: leadId,
        name: "Jane",
        email: "jane@example.com",
        company: "Example",
      },
      state: "COMPANY_PRESENT",
      suggestion: null,
      canRecheck: false,
    },
  });
});

describe("company detection job handler", () => {
  it("runs bounded owner-scoped detection and persists only a safe result", async () => {
    const result = await runCompanyDetectionJob(baseJob as never, {
      workerId: "worker-123",
    });

    expect(mocks.heartbeat).toHaveBeenCalledWith(
      baseJob.id,
      "worker-123",
      expect.objectContaining({
        phase: "DETECTING",
        total: 1,
      }),
    );
    expect(mocks.detect).toHaveBeenCalledWith("owner-a", conversationId);
    expect(result).toEqual({
      conversationId,
      changed: true,
      outcome: "APPLIED",
      companyState: "COMPANY_PRESENT",
      leadId,
      durationMs: expect.any(Number),
    });
    expect(result).not.toHaveProperty("company");
    expect(result).not.toHaveProperty("suggestion");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/leads/[id]", "page");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/leads/${leadId}`);
  });

  it("treats stale canonical work as a successful no-op", async () => {
    mocks.detect.mockResolvedValueOnce({
      changed: false,
      outcome: "NOT_APPLICABLE",
      companyView: {
        conversationId,
        lead: null,
        state: "NOT_APPLICABLE",
        suggestion: null,
        canRecheck: false,
      },
    });

    await expect(runCompanyDetectionJob(baseJob as never, {
      workerId: "worker-123",
    })).resolves.toEqual(expect.objectContaining({
      changed: false,
      outcome: "NOT_APPLICABLE",
      leadId: null,
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("rejects malformed payloads without running detection", async () => {
    await expect(runCompanyDetectionJob({
      ...baseJob,
      payload: {
        ...baseJob.payload,
        company: "must not be trusted",
      },
    } as never, {
      workerId: "worker-123",
    })).rejects.toEqual(expect.objectContaining({
      code: "INVALID_JOB_PAYLOAD",
      retryable: false,
    } satisfies Partial<JobExecutionError>));
    expect(mocks.heartbeat).not.toHaveBeenCalled();
    expect(mocks.detect).not.toHaveBeenCalled();
  });

  it("honors cancellation and lease loss before mutating", async () => {
    mocks.heartbeat.mockResolvedValueOnce("cancelled");
    await expect(runCompanyDetectionJob(baseJob as never, {
      workerId: "worker-123",
    })).rejects.toBeInstanceOf(JobCancelledError);
    expect(mocks.detect).not.toHaveBeenCalled();

    mocks.heartbeat.mockResolvedValueOnce("lost");
    await expect(runCompanyDetectionJob(baseJob as never, {
      workerId: "worker-123",
    })).rejects.toBeInstanceOf(JobLeaseLostError);
    expect(mocks.detect).not.toHaveBeenCalled();
  });

  it("lets bounded database failures reach the runner retry policy", async () => {
    const failure = new Error("simulated database outage");
    mocks.detect.mockRejectedValueOnce(failure);

    await expect(runCompanyDetectionJob(baseJob as never, {
      workerId: "worker-123",
    })).rejects.toBe(failure);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
